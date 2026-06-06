// Pure selectors over the flat list of fight records.

// Difficulty ordering for "highest available" defaults / sorting.
export const DIFFICULTY_ORDER = ['Mythic', 'Heroic', 'Normal', 'LFR']

// Best (highest-DPS) record per player for a given boss, ranked. A falsy
// `difficulty` means "all difficulties" (best result per player across them).
export function bossRanking(fights, raid, boss, difficulty) {
  const best = new Map()
  for (const f of fights) {
    if (f.raid !== raid || f.boss !== boss) continue
    if (difficulty && f.difficulty !== difficulty) continue
    const cur = best.get(f.player)
    if (!cur || f.dps > cur.dps) best.set(f.player, f)
  }
  return [...best.values()].sort((a, b) => b.dps - a.dps)
}

// Difficulties actually present for a boss, ordered hardest-first.
export function difficultiesFor(fights, raid, boss) {
  const set = new Set()
  for (const f of fights) {
    if (f.raid === raid && f.boss === boss && f.difficulty) set.add(f.difficulty)
  }
  return [...set].sort(
    (a, b) => DIFFICULTY_ORDER.indexOf(a) - DIFFICULTY_ORDER.indexOf(b),
  )
}

// For a player: their best result + rank on each boss of a raid. A falsy
// `difficulty` ranks across all difficulties.
export function playerSummary(fights, player, raid, bosses, difficulty) {
  return bosses.map((boss) => {
    const ranking = bossRanking(fights, raid, boss, difficulty)
    const idx = ranking.findIndex((r) => r.player === player)
    return {
      boss,
      record: idx >= 0 ? ranking[idx] : null,
      rank: idx >= 0 ? idx + 1 : null,
      total: ranking.length,
    }
  })
}

// Count distinct kills/pulls recorded per boss (for the sidebar). A falsy
// `difficulty` counts across all difficulties.
export function bossCounts(fights, raid, difficulty) {
  const seen = {} // boss -> Set(started)
  for (const f of fights) {
    if (f.raid !== raid) continue
    if (difficulty && f.difficulty !== difficulty) continue
    ;(seen[f.boss] = seen[f.boss] || new Set()).add(f.started)
  }
  const counts = {}
  for (const boss of Object.keys(seen)) counts[boss] = seen[boss].size
  return counts
}

// Unique player names, optionally filtered by a search query.
export function searchPlayers(fights, query) {
  const seen = new Set()
  for (const f of fights) seen.add(f.player)
  const all = [...seen].sort((a, b) => a.localeCompare(b))
  if (!query) return all
  const q = query.toLowerCase()
  return all.filter((p) => p.toLowerCase().includes(q))
}

// Character info for a player, gathered from their fight records (which the
// armory cache enriches). Picks the first non-empty value for each field.
export function playerProfile(fights, player) {
  const recs = fights.filter((f) => f.player === player)
  const first = (k) => {
    for (const r of recs) if (r[k] != null && r[k] !== '') return r[k]
    return null
  }
  const talents = recs.find((r) => r.talents && r.talents.length)?.talents || []
  return {
    class: first('class'),
    spec: first('spec'),
    faction: first('faction'),
    guild: first('guild'),
    ilvl: first('ilvl'),
    specIcon: first('specIcon'),
    talents,
  }
}

// A player's history: one entry per boss kill/pull they appear in (kept
// separate, not merged per log), newest first. DPS/duration come straight from
// the per-fight record so they match the ranking pages exactly.
export function playerLogs(fights, player) {
  return fights
    .filter((f) => f.player === player && f.logid)
    .map((f) => ({
      id: f.id,
      logId: f.logid,
      started: f.started,
      day: f.day,
      raid: f.raid,
      difficulty: f.difficulty,
      boss: f.boss,
      damage: f.damage,
      dps: f.dps,
      duration: f.duration,
    }))
    .sort((a, b) => b.started - a.started)
}

// One uploaded log, broken out into separate encounters (boss kills/pulls).
// Each encounter is its own ranked player table — kills are kept distinct, not
// merged. DPS comes straight from the per-fight record (already correct).
export function logSummary(fights, logId) {
  const byEncounter = new Map() // key -> { boss, difficulty, raid, started, day, duration, rows[] }
  let day = null
  let raid = null
  const bosses = new Set()
  for (const f of fights) {
    if (f.logid !== logId) continue
    day = day ?? f.day
    raid = raid ?? f.raid
    bosses.add(f.boss)
    const key = `${f.boss}|${f.difficulty}|${f.started}`
    let enc = byEncounter.get(key)
    if (!enc) {
      enc = {
        key,
        boss: f.boss,
        difficulty: f.difficulty,
        raid: f.raid,
        started: f.started,
        day: f.day,
        duration: 0,
        rows: [],
      }
      byEncounter.set(key, enc)
    }
    enc.duration = Math.max(enc.duration, f.duration)
    enc.rows.push({
      player: f.player,
      class: f.class,
      spec: f.spec,
      faction: f.faction,
      pet: f.pet,
      damage: f.damage,
      dps: f.dps,
      duration: f.duration,
      hits: f.hits || 0,
    })
  }
  const encounters = [...byEncounter.values()]
    .map((enc) => ({ ...enc, rows: enc.rows.sort((a, b) => b.damage - a.damage) }))
    .sort((a, b) => a.started - b.started)
  return { logId, day, raid, bosses: [...bosses], encounters }
}

// Split a ranked list into spec groups (e.g. Fury Warrior / Arms Warrior),
// each internally ranked, ordered by the group's top DPS.
export function groupBySpec(ranking) {
  const groups = new Map()
  for (const r of ranking) {
    const label = r.class && r.spec ? `${r.spec} ${r.class}` : r.class || 'Unknown spec'
    if (!groups.has(label)) groups.set(label, { label, class: r.class, spec: r.spec, rows: [] })
    groups.get(label).rows.push(r)
  }
  return [...groups.values()].sort((a, b) => (b.rows[0]?.dps || 0) - (a.rows[0]?.dps || 0))
}

// Realm is the part of a WoW name after the dash ("Name-Realm").
export function realmOf(name) {
  const i = (name || '').indexOf('-')
  return i >= 0 ? name.slice(i + 1) : ''
}

// Unique realms present in a list of records, sorted.
export function realmsIn(records) {
  const set = new Set()
  for (const r of records) {
    const realm = realmOf(r.player)
    if (realm) set.add(realm)
  }
  return [...set].sort((a, b) => a.localeCompare(b))
}

// Number of distinct kills/pulls logged for a boss (by encounter start time).
export function killCount(fights, raid, boss, difficulty) {
  const set = new Set()
  for (const f of fights) {
    if (f.raid !== raid || f.boss !== boss) continue
    if (difficulty && f.difficulty !== difficulty) continue
    set.add(f.started)
  }
  return set.size
}

// Any raids that aren't in the known registry (e.g. "Other" target dummies).
export function extraRaids(fights, knownRaidNames) {
  const map = new Map() // raidName -> Set(bosses)
  for (const f of fights) {
    if (knownRaidNames.includes(f.raid)) continue
    if (!map.has(f.raid)) map.set(f.raid, new Set())
    map.get(f.raid).add(f.boss)
  }
  return [...map.entries()].map(([name, bosses]) => ({ name, bosses: [...bosses] }))
}
