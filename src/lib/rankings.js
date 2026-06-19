// Pure selectors over the flat list of fight records.

// Difficulty ordering for "highest available" defaults / sorting.
export const DIFFICULTY_ORDER = ['Mythic', 'Heroic', 'Normal', 'LFR']

// Best record per player for a given boss, ranked by `metric` ('dps' | 'hps').
// Only KILLS count (wipes are excluded), and only players who actually did the
// thing being ranked (damage for dps, healing for hps). A falsy `difficulty`
// means "all difficulties" (best result per player across them).
export function bossRanking(fights, raid, boss, difficulty, metric = 'dps', spec = null) {
  const rate = metric === 'hps' ? 'hps' : 'dps'
  const total = metric === 'hps' ? 'healing' : 'damage'
  const best = new Map()
  for (const f of fights) {
    if (f.raid !== raid || f.boss !== boss) continue
    if (difficulty && f.difficulty !== difficulty) continue
    if (spec && f.spec !== spec) continue // a specific spec's leaderboard
    if (f.kill === false) continue // kills only
    if (!(f[total] > 0)) continue // only players who dealt damage / did healing
    const cur = best.get(f.player)
    if (!cur || f[rate] > cur[rate]) best.set(f.player, f)
  }
  return [...best.values()].sort((a, b) => b[rate] - a[rate])
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

// For a player: their best result + rank on each boss of a raid, by `metric`.
// A falsy `difficulty` ranks across all difficulties.
export function playerSummary(fights, player, raid, bosses, difficulty, metric = 'dps', spec = null) {
  const rate = metric === 'hps' ? 'hps' : 'dps'
  return bosses.map((boss) => {
    const ranking = bossRanking(fights, raid, boss, difficulty, metric, spec)
    const idx = ranking.findIndex((r) => r.player === player)
    if (idx >= 0) return { boss, record: ranking[idx], rank: idx + 1, total: ranking.length }
    // Not on the (metric > 0) leaderboard. If they still KILLED it in this spec, show
    // that kill with its (possibly 0) value, unranked — never "no kill" for a real kill
    // (e.g. an Arms warrior did 0 healing on a boss they downed).
    let killRec = null
    for (const f of fights) {
      if (f.player !== player || f.raid !== raid || f.boss !== boss) continue
      if (difficulty && f.difficulty !== difficulty) continue
      if (spec && f.spec !== spec) continue
      if (f.kill === false) continue
      if (!killRec || (f[rate] || 0) > (killRec[rate] || 0)) killRec = f
    }
    return { boss, record: killRec, rank: null, total: ranking.length }
  })
}

// Count distinct KILLS recorded per boss (for the sidebar). Wipes don't count.
// A falsy `difficulty` counts across all difficulties.
export function bossCounts(fights, raid, difficulty) {
  const seen = {} // boss -> Set(started)
  for (const f of fights) {
    if (f.raid !== raid) continue
    if (difficulty && f.difficulty !== difficulty) continue
    if (f.kill === false) continue
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
    race: first('race'),
    gender: first('gender'),
    faction: first('faction'),
    guild: first('guild'),
    // Prefer the live armory ilvl (current gear) over a frozen per-fight value, so the
    // profile + equipment panel don't show a stale ilvl next to the player's live gear.
    ilvl: first('liveIlvl') ?? first('ilvl'),
    specIcon: first('specIcon'),
    talents,
    gear: recs.find((r) => r.gear && r.gear.length)?.gear || [],
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
      kill: f.kill,
      spec: f.spec || null,
      specIcon: f.specIcon || null,
      class: f.class || null,
      damage: f.damage,
      dps: f.dps,
      healing: f.healing || 0,
      hps: f.hps || 0,
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
  const players = new Set() // distinct non-pet players in the log
  const addonPlayers = new Set() // …of those, the ones confirmed running the addon
  for (const f of fights) {
    if (f.logid !== logId) continue
    day = day ?? f.day
    raid = raid ?? f.raid
    bosses.add(f.boss)
    if (!f.pet) {
      players.add(f.player)
      if (f.from_addon === true) addonPlayers.add(f.player)
    }
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
        kill: f.kill !== false, // wipes are flagged false; legacy/unknown → kill
        bloodlust: f.bloodlust || [], // [{ player, t }] — same for the whole encounter
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
      specIcon: f.specIcon,
      race: f.race,
      gender: f.gender,
      faction: f.faction,
      ilvl: f.ilvl,
      talents: f.talents,
      trinkets: f.trinkets,
      pet: f.pet,
      // Frozen per-fight: did they run the addon on this pull? Drives the "no addon" badge.
      fromAddon: f.from_addon === true,
      // 'addon' | 'inspect' | 'armory' — where this pull's build came from (admin-only badge).
      snapshotSrc: f.snapshotSrc || null,
      damage: f.damage,
      dps: f.dps,
      healing: f.healing || 0,
      hps: f.hps || 0,
      potions: f.potions || 0,
      duration: f.duration,
      hits: f.hits || 0,
    })
  }
  // Rows are returned unsorted-by-metric; the view sorts by the active meter.
  const encounters = [...byEncounter.values()].sort((a, b) => a.started - b.started)
  return {
    logId,
    day,
    raid,
    bosses: [...bosses],
    encounters,
    playerCount: players.size,
    addonCount: addonPlayers.size,
  }
}

// Split a ranked list into spec groups (e.g. Fury Warrior / Arms Warrior),
// each internally ranked, ordered by the group's top rate for `metric`.
export function groupBySpec(ranking, metric = 'dps') {
  const rate = metric === 'hps' ? 'hps' : 'dps'
  const groups = new Map()
  for (const r of ranking) {
    const label = r.class && r.spec ? `${r.spec} ${r.class}` : r.class || 'Unknown spec'
    if (!groups.has(label)) groups.set(label, { label, class: r.class, spec: r.spec, rows: [] })
    groups.get(label).rows.push(r)
  }
  return [...groups.values()].sort((a, b) => (b.rows[0]?.[rate] || 0) - (a.rows[0]?.[rate] || 0))
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

// Number of distinct KILLS logged for a boss (by encounter start time). Wipes
// (ENCOUNTER_END success = 0) are excluded.
export function killCount(fights, raid, boss, difficulty) {
  const set = new Set()
  for (const f of fights) {
    if (f.raid !== raid || f.boss !== boss) continue
    if (difficulty && f.difficulty !== difficulty) continue
    if (f.kill === false) continue
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
