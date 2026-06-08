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

export async function addFights(records) {
  const clean = records.map(pick)
  if (supabase) {
    const { error } = await supabase.from('fights').upsert(clean, { onConflict: 'id' })
    if (error) throw error
    return
  }
  const map = new Map(readLocal().map((f) => [f.id, f]))
  for (const r of clean) map.set(r.id, r)
  writeLocal([...map.values()])
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
