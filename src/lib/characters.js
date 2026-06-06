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
      spec: f.spec ?? c.spec ?? null,
      faction: f.faction ?? c.faction ?? null,
      guild: f.guild ?? c.guild ?? null,
      ilvl: f.ilvl ?? c.ilvl ?? null,
      talents: f.talents && f.talents.length ? f.talents : c.talents || [],
      specIcon: f.specIcon ?? c.spec_icon ?? null,
    }
  })
}
