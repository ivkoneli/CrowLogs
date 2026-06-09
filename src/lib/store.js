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
]

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
    const { data, error } = await supabase.from('fights').select('*')
    if (error) throw error
    return data || []
  }
  return readLocal()
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

export async function clearFights() {
  if (supabase) {
    const { error } = await supabase.from('fights').delete().neq('id', '')
    if (error) throw error
    return
  }
  writeLocal([])
}

export { isShared }
