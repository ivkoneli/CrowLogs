// Persistence layer. Uses Supabase when configured (shared across everyone),
// otherwise localStorage (per-browser). Same async API either way.
import { supabase, isShared } from './supabase.js'

const LS_KEY = 'crowlogs.fights.v1'

// Only the columns that exist on the `fights` table. Character info
// (class/spec/faction/ilvl/talents) is NOT stored per-fight — it lives in the
// `characters` cache and is merged in at read time (see lib/characters.js).
const FIELDS = [
  'id',
  'raid',
  'boss',
  'difficulty',
  'player',
  'guid',
  'pet',
  'damage',
  'dps',
  'healing',
  'hps',
  'kill',
  'bloodlust',
  'potions',
  // Frozen character snapshot, written at import time (see App.jsx onImported).
  // `class` is persisted because the addon snapshot supplies it for players the armory
  // never scraped (no `characters` cache row to merge it from at read time).
  'class',
  'ilvl',
  'talents',
  'trinkets',
  'legendaries',
  'spec',
  'spec_icon',
  // Whether the player ran the CrowLogsHelper addon on this pull (frozen at import).
  // Drives the "no addon" badge in the log view.
  'from_addon',
  'duration',
  'hits',
  'day',
  'started',
  'logid',
  // Set by hand in the database on a result that a game bug inflated: it stays in the
  // log and on the player's profile but is left off the boss rankings. Never sent by an
  // import (submit-log drops it), so re-importing the log keeps the mark.
  'discredited',
  'discredit_reason',
  // Per-spell damage/healing totals for the meter's hover breakdown (see parser.js).
  // Persisted with the row, but NOT loaded in bulk: getSpells fetches it on hover.
  'spells',
]
// Everything the app loads up front (all of FIELDS except the heavy per-spell breakdown).
const LIST_COLUMNS = FIELDS.filter((f) => f !== 'spells').join(',')

function pick(rec) {
  const out = {}
  // Coerce undefined → null so every persisted row has the same keys (a bulk upsert
  // with mismatched keys is rejected by PostgREST with "All object keys must match").
  for (const f of FIELDS) out[f] = rec[f] ?? null
  return out
}

function readLocal() {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || '[]')
  } catch {
    return []
  }
}

function writeLocal(list) {
  localStorage.setItem(LS_KEY, JSON.stringify(list))
}

export async function getFights() {
  if (supabase) {
    // PostgREST silently caps any single select at 1000 rows (Supabase's default
    // max-rows), so once the table outgrows that, an unpaged select('*') returns an
    // ARBITRARY 1000 — freshly imported fights just don't show up. Page through in
    // 1000-row windows (ordered, so pages can't skip/duplicate rows) until a short page.
    const PAGE = 1000
    const all = []
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from('fights')
        .select(LIST_COLUMNS)
        .order('id')
        .range(from, from + PAGE - 1)
      if (error) throw error
      all.push(...(data || []))
      if (!data || data.length < PAGE) break
    }
    return all
  }
  return readLocal()
}

// Per-spell breakdown for one fight row, fetched on demand (hover) and cached.
// Resolves { dmg: [[spellId, name, amount, school, petName], …], heal: […] } or null when
// the row predates the breakdown (logs imported before it existed have none).
const spellCache = new Map()
export function getSpells(id) {
  if (!spellCache.has(id)) {
    const p = (async () => {
      if (!supabase) return readLocal().find((f) => f.id === id)?.spells || null
      const { data, error } = await supabase.from('fights').select('spells').eq('id', id).maybeSingle()
      if (error) throw error
      return data?.spells || null
    })()
    p.catch(() => spellCache.delete(id)) // a failed fetch can be retried on the next hover
    spellCache.set(id, p)
  }
  return spellCache.get(id)
}

// A short human label for a batch, stored on the logs audit row so the owner can tell
// which import to roll back (e.g. "Icecrown Citadel · 06/09").
function logLabel(rows) {
  const r = rows.find((x) => x.raid) || rows[0] || {}
  return [r.raid, r.day].filter(Boolean).join(' · ') || null
}

export async function addFights(records) {
  // Dedupe by id (last wins) before persisting. Two encounter segments from one log can
  // resolve to the same id (raid::boss::difficulty::player::start); Supabase rejects a
  // batch that lists the same conflict key twice ("ON CONFLICT DO UPDATE command cannot
  // affect row a second time"). The localStorage path already collapsed dupes this way.
  const byId = new Map(records.map((r) => [r.id, pick(r)]))
  const clean = [...byId.values()]
  if (supabase) {
    // Writes go through the `submit-log` edge function, NOT a direct table upsert: the
    // public anon key must not be able to write/overwrite `fights` (the table is RLS
    // read-only). The function validates, recomputes dps/hps, caps, and rate-limits.
    const logid = clean.find((r) => r.logid)?.logid || null
    const { data, error } = await supabase.functions.invoke('submit-log', {
      body: { fights: clean, logid, label: logLabel(clean) },
    })
    if (error) {
      const detail = await error.context?.text?.().catch(() => null)
      throw new Error(detail || error.message)
    }
    if (data?.error) throw new Error(data.error)
    return
  }
  const map = new Map(readLocal().map((f) => [f.id, f]))
  for (const r of clean) map.set(r.id, r)
  writeLocal([...map.values()])
}

// Roll back a previously imported log: deletes every fight row carrying `logid`. Gated
// server-side by ADMIN_TOKEN (entered at runtime, never shipped in the bundle) via the
// `delete-log` edge function. Requires Supabase. Returns { logid, deleted }.
export async function deleteLog(logid, token) {
  if (!supabase) {
    // localStorage fallback: just drop the rows locally (no auth needed for your own browser).
    const remaining = readLocal().filter((f) => f.logid !== logid)
    writeLocal(remaining)
    return { logid, deleted: 0 }
  }
  const { data, error } = await supabase.functions.invoke('delete-log', { body: { logid, token } })
  if (error) {
    const detail = await error.context?.text?.().catch(() => null)
    throw new Error(detail || error.message)
  }
  if (data?.error) throw new Error(data.error)
  return data
}

// Mark (or unmark) one player's results in a log as discredited: kept in the log and on
// their profile, left off the boss rankings. Gated server-side by ADMIN_TOKEN via the
// `discredit-log` edge function. Requires Supabase. Returns { updated }.
export async function discreditLog(logid, player, discredited, token, reason = null) {
  if (!supabase) throw new Error('Marking results requires Supabase.')
  const { data, error } = await supabase.functions.invoke('discredit-log', {
    body: { logid, player, discredited, token, reason },
  })
  if (error) {
    const detail = await error.context?.text?.().catch(() => null)
    throw new Error(detail || error.message)
  }
  if (data?.error) throw new Error(data.error)
  return data
}

export async function clearFights() {
  if (supabase) {
    const { error } = await supabase.from('fights').delete().neq('id', '')
    if (error) throw error
    return
  }
  writeLocal([])
}

export { isShared }
