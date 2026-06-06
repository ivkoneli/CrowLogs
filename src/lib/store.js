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
  'duration',
  'hits',
  'day',
  'started',
  'logid',
]

function pick(rec) {
  const out = {}
  for (const f of FIELDS) out[f] = rec[f]
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
