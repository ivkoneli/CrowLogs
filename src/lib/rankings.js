// Pure selectors over the flat list of fight records.

// Best (highest-DPS) record per player for a given boss + difficulty, ranked.
export function bossRanking(fights, raid, boss, difficulty) {
  const best = new Map()
  for (const f of fights) {
    if (f.raid !== raid || f.boss !== boss || f.difficulty !== difficulty) continue
    const cur = best.get(f.player)
    if (!cur || f.dps > cur.dps) best.set(f.player, f)
  }
  return [...best.values()].sort((a, b) => b.dps - a.dps)
}

// For a player: their best result + rank on each boss of a raid.
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

// Count fights recorded per boss (for the sidebar), by difficulty.
export function bossCounts(fights, raid, difficulty) {
  const counts = {}
  for (const f of fights) {
    if (f.raid !== raid || f.difficulty !== difficulty) continue
    counts[f.boss] = (counts[f.boss] || 0) + 1
  }
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

// Every uploaded log a player appears in (grouped by logid), newest first.
export function playerLogs(fights, player) {
  const byLog = new Map()
  for (const f of fights) {
    if (f.player !== player || !f.logid) continue
    let g = byLog.get(f.logid)
    if (!g) {
      g = { logId: f.logid, started: f.started, day: f.day, raid: f.raid, difficulty: f.difficulty, bosses: new Set(), damage: 0, duration: 0 }
      byLog.set(f.logid, g)
    }
    g.bosses.add(f.boss)
    g.damage += f.damage
    g.duration = Math.max(g.duration, f.duration)
    g.started = Math.min(g.started, f.started)
  }
  return [...byLog.values()]
    .map((g) => ({ ...g, bosses: [...g.bosses], dps: g.duration > 0 ? Math.round(g.damage / g.duration) : 0 }))
    .sort((a, b) => b.started - a.started)
}

// All players in one uploaded log, aggregated per player and ranked — the same
// kind of breakdown shown right after a log is imported.
export function logSummary(fights, logId) {
  const rows = new Map()
  let day = null
  let difficulty = null
  let raid = null
  const bosses = new Set()
  for (const f of fights) {
    if (f.logid !== logId) continue
    day = day ?? f.day
    difficulty = difficulty ?? f.difficulty
    raid = raid ?? f.raid
    bosses.add(f.boss)
    let r = rows.get(f.player)
    if (!r) {
      r = { player: f.player, class: f.class, spec: f.spec, faction: f.faction, pet: f.pet, damage: 0, duration: 0, hits: 0 }
      rows.set(f.player, r)
    }
    r.damage += f.damage
    r.duration = Math.max(r.duration, f.duration)
    r.hits += f.hits || 0
  }
  const ranked = [...rows.values()]
    .map((r) => ({ ...r, dps: r.duration > 0 ? Math.round(r.damage / r.duration) : 0 }))
    .sort((a, b) => b.damage - a.damage)
  return { logId, day, difficulty, raid, bosses: [...bosses], rows: ranked }
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
    if (f.raid === raid && f.boss === boss && f.difficulty === difficulty) set.add(f.started)
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
