// Character armory cache (ilvl / talents / class / spec / faction), keyed by the
// in-game "Name-Realm" string so it joins directly onto fight records' `player`.
//
// Populated by the scheduled scraper (scripts/scrape-armory.mjs) writing into the
// Supabase `characters` table; falls back to localStorage when Supabase isn't set.
import { supabase } from './supabase.js'

const LS_KEY = 'crowlogs.characters.v1'

export function charKey(nameRealm) {
  return (nameRealm || '').trim().toLowerCase()
}

// The two trinkets out of a full gear array (slot-tagged by the scraper).
export function trinketsOf(gear) {
  return (gear || []).filter((g) => g.slot === 'trinket')
}

function readLocal() {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || '[]')
  } catch {
    return []
  }
}

export async function getCharacters() {
  if (supabase) {
    const { data, error } = await supabase.from('characters').select('*')
    if (error) throw error
    return data || []
  }
  return readLocal()
}

// Scrape one or more characters from the armory via the Supabase Edge Function
// (`scrape-character`), which holds the service key + Tauri cookie server-side.
// Accepts a single "Name-Realm" string (the Update button) or an array of them
// (post-import enrichment). Returns { updated, failed }. Requires Supabase.
export async function requestCharacterScrape(playerOrPlayers) {
  if (!supabase) {
    throw new Error('Profile updates require Supabase (armory scraping runs server-side).')
  }
  const players = Array.isArray(playerOrPlayers) ? playerOrPlayers : [playerOrPlayers]
  const { data, error } = await supabase.functions.invoke('scrape-character', {
    body: { players },
  })
  if (error) {
    // Edge functions return error detail in the response body on non-2xx.
    const detail = await error.context?.text?.().catch(() => null)
    throw new Error(detail || error.message)
  }
  if (data && data.error) throw new Error(data.error)
  // Surface a single-character failure (e.g. the Update button) as an error.
  if (data?.failed?.length && !data?.updated?.length) {
    throw new Error(data.failed[0].error || 'Armory scrape failed.')
  }
  return data
}

// Fill in any missing class/spec/faction/ilvl/talents on fight records from the
// armory cache. Never overwrites values a record already has (e.g. demo data).
export function mergeCharacters(fights, characters) {
  if (!characters || characters.length === 0) return fights
  const byKey = new Map(characters.map((c) => [charKey(c.key || c.name), c]))
  return fights.map((f) => {
    const c = byKey.get(charKey(f.player))
    if (!c) return f
    return {
      ...f,
      class: f.class ?? c.class ?? null,
      // Frozen per-fight spec (the spec they played that log) wins over the live spec.
      spec: f.spec ?? c.spec ?? null,
      faction: f.faction ?? c.faction ?? null,
      guild: f.guild ?? c.guild ?? null,
      ilvl: f.ilvl ?? c.ilvl ?? null,
      talents: f.talents && f.talents.length ? f.talents : c.talents || [],
      // Frozen trinkets win; otherwise derive from the live armory gear. `gear` is
      // the live equipped set (for the gear tab), never frozen per-fight.
      trinkets: f.trinkets && f.trinkets.length ? f.trinkets : trinketsOf(c.gear),
      gear: c.gear || f.gear || [],
      specIcon: f.spec_icon ?? f.specIcon ?? c.spec_icon ?? null,
    }
  })
}
