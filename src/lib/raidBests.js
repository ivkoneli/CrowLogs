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

// Every best of one player, with ranks: rank_all among everyone's best on that boss, and
// rank_spec within the spec.
export async function getPlayerBests(player) {
  if (!supabase) return []
  const { data, error } = await supabase.rpc('raid_player_bests', { p_player: player })
  if (error) throw error
  return (data || []).map((r) => ({
    ...toRecord(r, r.metric),
    raid: r.raid,
    boss: r.boss,
    metric: r.metric,
    rankAll: r.rank_all,
    totalAll: r.total_all,
    rankSpec: r.rank_spec,
    totalSpec: r.total_spec,
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
    if (!best) return { boss, record: null, rank: null, total: 0 }
    return spec
      ? { boss, record: best, rank: best.rankSpec, total: best.totalSpec }
      : { boss, record: best, rank: best.rankAll, total: best.totalAll }
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
