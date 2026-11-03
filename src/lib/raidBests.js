// Server-wide raid bests: every boss kill on Tauri since 2026-10-20 (scripts/scrape-raids.mjs)
// plus the bests from uploaded logs, one row per player × boss × difficulty × metric × spec.
// The boss board and the profile's Rankings tab read these instead of the uploaded fights,
// which stay the source of logs, history and per-spell breakdowns.
import { supabase } from './supabase.js'
import { LEGION_CLASSES } from './classes.js'

// Spec names → role is unique in Legion (every "Holy" heals, every "Protection" tanks), so a
// role filter becomes a list of spec names for the server.
const SPECS_BY_ROLE = {}
for (const c of LEGION_CLASSES) for (const s of c.specs) (SPECS_BY_ROLE[s.role] ||= new Set()).add(s.name)

// A board/profile row in the same shape the meter and rankings use for fight records.
function toRecord(r, metric) {
  const rate = r.value
  return {
    player: r.player,
    class: r.class,
    spec: r.spec || null,
    race: r.race,
    gender: r.gender,
    faction: r.faction,
    guild: r.guild,
    difficulty: r.difficulty,
    dps: metric === 'dps' ? rate : 0,
    hps: metric === 'hps' ? rate : 0,
    damage: metric === 'dps' ? r.amount : 0,
    healing: metric === 'hps' ? r.amount : 0,
    duration: r.duration,
    day: r.day,
    ilvl: r.ilvl,
    talents: r.talents || [],
    trinkets: r.trinkets || [],
    // null = Tauri's record has none and the armory no longer matched the kill's build.
    legendaries: r.legendaries ?? null,
    legendaryStatus: r.legendary_status || null,
    logid: r.logid || null,
    started: r.started ?? null,
  }
}

// The boss board: each player's best (`limit` rows from `offset`), filtered on the server. Returns
// { rows, total } where total counts every matching player, not just the rows returned.
export async function getRaidBoard({ raid, boss, difficulty, metric, filter = {}, limit = 500, offset = 0 }) {
  if (!supabase) return { rows: [], total: 0 }
  let specs = null
  if (filter.spec) specs = [filter.spec]
  if (filter.role) {
    const roleSpecs = [...(SPECS_BY_ROLE[filter.role] || [])]
    specs = specs ? specs.filter((s) => roleSpecs.includes(s)) : roleSpecs
  }
  const { data, error } = await supabase.rpc('raid_board', {
    p_raid: raid,
    p_boss: boss,
    p_difficulty: difficulty || null,
    p_metric: metric,
    p_specs: specs,
    p_class: filter.class || null,
    p_faction: filter.faction || null,
    p_realm: filter.realm || null,
    p_limit: limit,
    p_offset: offset,
  })
  if (error) throw error
  const rows = (data || []).map((r) => toRecord(r, metric))
  return { rows, total: data?.[0]?.total ?? 0 }
}

// Last profiles' bests, remembered in this browser: a profile shows them at once and
// refreshes in the background, and a failed refresh keeps them instead of going blank.
const BESTS_CACHE_KEY = 'crowlogs.playerBests.v1'
const BESTS_CACHE_MAX = 40 // players kept (most recently opened)
function readBestsCache() {
  try {
    return JSON.parse(localStorage.getItem(BESTS_CACHE_KEY) || '{}') || {}
  } catch {
    return {}
  }
}
export function cachedPlayerBests(player) {
  return readBestsCache()[(player || '').toLowerCase()]?.rows || null
}
function cachePlayerBests(player, rows) {
  try {
    const all = readBestsCache()
    all[player.toLowerCase()] = { at: Date.now(), rows }
    const keep = Object.entries(all).sort((a, b) => b[1].at - a[1].at).slice(0, BESTS_CACHE_MAX)
    localStorage.setItem(BESTS_CACHE_KEY, JSON.stringify(Object.fromEntries(keep)))
  } catch {
    /* storage full or blocked: caching is only a convenience */
  }
}

// Every best of one player, with ranks: rank_all among everyone's best on that boss, and
// rank_spec within the spec. Saves the result for cachedPlayerBests.
export async function getPlayerBests(player) {
  const rows = await fetchPlayerBests(player)
  cachePlayerBests(player, rows)
  return rows
}

async function fetchPlayerBests(player) {
  if (!supabase) return []
  // The public role gets 3 s per query, and this one can take 2+ s on a cold cache, so a
  // busy moment times it out (the profile then showed no rankings). Retry before failing.
  let data = null
  for (let attempt = 0; ; attempt++) {
    const res = await supabase.rpc('raid_player_bests', { p_player: player })
    if (!res.error) {
      data = res.data
      break
    }
    if (attempt >= 2) throw res.error
    await new Promise((r) => setTimeout(r, 800 * (attempt + 1)))
  }
  return (data || []).map((r) => ({
    ...toRecord(r, r.metric),
    raid: r.raid,
    boss: r.boss,
    metric: r.metric,
    rankAll: r.rank_all,
    totalAll: r.total_all,
    rankSpec: r.rank_spec,
    totalSpec: r.total_spec,
    topAll: r.top_all ?? null,
    topSpec: r.top_spec ?? null,
  }))
}

// For the profile: per boss, the best of `bests` on `difficulty`/`metric` (optionally one
// spec) and its rank. Same shape as rankings.playerSummary: [{ boss, record, rank, total }].
export function playerBestSummary(bests, raid, bosses, difficulty, metric, spec = null) {
  return bosses.map((boss) => {
    let best = null
    for (const b of bests) {
      if (b.raid !== raid || b.boss !== boss || b.difficulty !== difficulty || b.metric !== metric) continue
      if (spec && b.spec !== spec) continue
      if (!best || b[metric] > best[metric]) best = b
    }
    if (!best) return { boss, record: null, rank: null, total: 0, top: null }
    // `top` = rank 1's value on the same board the rank is from (all specs, or this spec).
    return spec
      ? { boss, record: best, rank: best.rankSpec, total: best.totalSpec, top: best.topSpec }
      : { boss, record: best, rank: best.rankAll, total: best.totalAll, top: best.topAll }
  })
}

// Kills per raid → boss → difficulty (Tauri kills since tracking started + uploaded ones).
export async function getKillCounts() {
  if (!supabase) return []
  const { data, error } = await supabase.rpc('raid_kill_counts')
  if (error) throw error
  return data || []
}

// Raiders seen on Tauri whose name matches `query` (accent-free, fuzzy), for the sidebar.
export async function searchRaidPlayers(query, limit = 8) {
  const q = (query || '').trim()
  if (!supabase || q.length < 2) return []
  const { data, error } = await supabase.rpc('search_raid_players', { q, lim: limit })
  if (error) throw error
  return data || []
}
