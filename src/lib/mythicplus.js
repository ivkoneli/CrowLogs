// Mythic+ (challenge mode) data: the dungeon registry shared with the scraper
// (scripts/scrape-mythic-plus.mjs), the profile query, and the best/history selectors.
//
// Runs live in the Supabase `mplus_runs` table, mirrored hourly from Tauri's armory
// leaderboards. Tauri only publishes per-dungeon boards, so the mirror is what makes a
// single player's history one indexed lookup (`members` array contains the name).
import { supabase } from './supabase.js'
import { MPLUS_DUNGEONS, MPLUS_REALMS, MPLUS_BOARD_OF, DEFAULT_MPLUS_REALM } from './mplusDungeons.js'

export { MPLUS_DUNGEONS, MPLUS_REALMS, DEFAULT_MPLUS_REALM }

const SLUG_BY_REALM = Object.fromEntries(Object.entries(MPLUS_REALMS).map(([slug, realm]) => [realm, slug]))

// Medal = how far under the timer the key finished (Tauri's challengemode medals).
export const MEDALS = {
  3: { label: 'Gold', key: 'gold', note: '+3 chest' },
  2: { label: 'Silver', key: 'silver', note: '+2 chest' },
  1: { label: 'Bronze', key: 'bronze', note: '+1 chest' },
  0: { label: 'Depleted', key: null, note: 'over the timer' },
}
// Small dungeon icon (public/dungeons/<mapId>.webp, made by scripts/gen-dungeon-icons.py).
export const dungeonIconUrl = (mapId) => `${import.meta.env.BASE_URL}dungeons/${mapId}.webp`

export const dungeonBannerUrl = (mapId) => `${import.meta.env.BASE_URL}dungeons/banner/${mapId}.webp`

export const medalIconUrl = (key) => `https://tauriwow.com/sys/img/armory/images/challengemode_medal_${key}.png`

// "Ivkomdfk-evermoon" → { name: 'Ivkomdfk', realm: '[EN] Evermoon' }
export function splitPlayerKey(player) {
  const i = (player || '').lastIndexOf('-')
  if (i === -1) return { name: player || '', realm: DEFAULT_MPLUS_REALM }
  return { name: player.slice(0, i), realm: MPLUS_REALMS[player.slice(i + 1).toLowerCase()] || DEFAULT_MPLUS_REALM }
}

// A party member's profile key, in the same "Name-realmslug" form fights use.
export function memberPlayerKey(name, realm) {
  const slug = SLUG_BY_REALM[realm]
  return slug ? `${name}-${slug}` : name
}

// Is this party entry the given player? Names repeat across realms (Evermoon and Tauri
// share a leaderboard), so the member's own realm has to match too. Entries scraped before
// member realms existed have none and are matched by name alone.
export function isMember(p, name, realm) {
  return p.name.toLowerCase() === name.toLowerCase() && (!p.realm || p.realm === realm)
}

// Every stored run the player was in, unsorted. Pages past PostgREST's 1000-row cap.
export async function getPlayerRuns(player) {
  if (!supabase) return []
  const { name, realm } = splitPlayerKey(player)
  // Runs live under the BOARD they were published on, which several realms can share.
  const board = MPLUS_BOARD_OF[realm] || realm
  const PAGE = 1000
  const all = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('mplus_runs')
      .select('id, map_id, dungeon, level, time_ms, medal, affixes, party, day, first_seen')
      .eq('realm', board)
      .contains('members', [name.toLowerCase()])
      .order('id')
      .range(from, from + PAGE - 1)
    if (error) throw error
    all.push(...(data || []))
    if (!data || data.length < PAGE) break
  }
  // The index only knows names: drop runs where that name was a same-named character
  // from another realm.
  return all.filter((r) => r.party.some((p) => isMember(p, name, realm)))
}

const timeOrInf = (r) => (r.time_ms == null ? Infinity : r.time_ms)
const TIMER_BY_MAP = new Map(MPLUS_DUNGEONS.map((d) => [d.id, d.timer]))

// M+ score, same formula as tauriachievements.github.io/mythic-plus/scoring (verified
// identical on all 41k of their scored runs):
//   timed:    50 + 7.5 × level       + 12.5 × (1 − time ÷ timer)
//   depleted: 50 + 7.5 × (level − 1) − 20   × (time ÷ timer − 1), never below 0
// Rounded to one decimal. Null when the clear time or the dungeon's timer is unknown.
export function runScore(run) {
  const timer = TIMER_BY_MAP.get(run?.map_id)
  if (!timer || run.time_ms == null) return null
  const ratio = run.time_ms / 1000 / timer
  const raw = ratio <= 1 ? 50 + 7.5 * run.level + 12.5 * (1 - ratio) : 50 + 7.5 * (run.level - 1) - 20 * (ratio - 1)
  return Math.round(Math.max(0, raw) * 10) / 10
}

// One best run per dungeon. `by`:
//   'score' (default) — the highest-scoring run (ties: faster clear). A timed +11 beats a
//                       depleted +12; this is the rule the player's score total is built on.
//   'key'             — the highest key level, then the higher score on it (= faster clear).
// Returns MPLUS_DUNGEONS order with `run: null` for dungeons never run.
export function bestRuns(runs, by = 'score') {
  const best = new Map()
  const better =
    by === 'key'
      ? (r, cur) => r.level > cur.level || (r.level === cur.level && (runScore(r) ?? -1) > (runScore(cur) ?? -1))
      : (r, cur) => {
          const s = runScore(r) ?? -1
          const cs = runScore(cur) ?? -1
          return s > cs || (s === cs && timeOrInf(r) < timeOrInf(cur))
        }
  for (const r of runs) {
    const cur = best.get(r.map_id)
    if (!cur || better(r, cur)) best.set(r.map_id, r)
  }
  return MPLUS_DUNGEONS.map((d) => ({ dungeon: d, run: best.get(d.id) || null }))
}

// A player's M+ score: the sum of their best run score in each dungeon.
export function playerScore(best) {
  const total = best.reduce((sum, b) => sum + (b.run ? runScore(b.run) || 0 : 0), 0)
  return Math.round(total * 10) / 10
}

export const formatScore = (s) => (s == null ? '—' : s.toFixed(1))

// Most recent first. Tauri only gives the completion DAY, so same-day runs fall back
// to when the hourly scraper first saw them, then to the higher key.
export function sortRunsByRecent(runs) {
  return [...runs].sort(
    (a, b) =>
      b.day.localeCompare(a.day) ||
      (b.first_seen || '').localeCompare(a.first_seen || '') ||
      b.level - a.level ||
      timeOrInf(a) - timeOrInf(b),
  )
}

// 1_234_567 ms → "20:34"; past an hour → "1:00:48".
export function formatRunTime(ms) {
  if (ms == null) return '—'
  const total = Math.floor(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = String(total % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}

// "2026-10-07" → "10/7/2026" (month first, like the Tauri armory), or "Oct 7, 2026" with
// { long: true } for tooltips. Parsed as a plain date, never shifted by timezone.
export function formatRunDay(day, { long = false } = {}) {
  const [y, mo, d] = (day || '').split('-').map(Number)
  if (!y) return day || ''
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return long ? `${MONTHS[mo - 1]} ${d}, ${y}` : `${mo}/${d}/${y}`
}

// Players seen in any M+ run matching `query` (accent-free, fuzzy), for the
// sidebar search — this is how someone with no imported raid logs can still be found.
// Returns [{ player: "Name-realmslug", name, class, runs }], most active first.
export async function searchMplusPlayers(query, limit = 8) {
  const q = (query || '').trim()
  if (!supabase || q.length < 2) return []
  // Fuzzy on the server (search_mplus_players in schema.sql): accent-free, substring, and
  // trigram-similar for typos, so "bomba" finds "Bömba". Best matches come back first.
  const { data, error } = await supabase.rpc('search_mplus_players', { q, lim: limit })
  if (error) throw error
  return (data || []).map((p) => ({ player: memberPlayerKey(p.name, p.realm), name: p.name, class: p.class, runs: p.runs }))
}

// ---------- Site-wide best runs (home page) ----------
//
// The M+ week runs Wednesday → Tuesday (server time, Europe/Budapest). Tauri only gives a
// run's completion DAY, so Wednesday is ambiguous: keys finished after midnight on Tuesday
// night still carry LAST week's affixes but are dated Wednesday. Affixes settle it: a
// Wednesday run whose affixes match last week's set belongs to last week. Keys below +4
// have no affixes at all, so a Wednesday run without affixes can't be placed and is left
// out of the week (it never matters: anything +4 or higher outranks it).

const SERVER_TZ = 'Europe/Budapest'
const RUN_COLS = 'id, realm, map_id, dungeon, level, time_ms, medal, affixes, party, day'

// Today's date on the game server, "YYYY-MM-DD".
export function serverToday(now = new Date()) {
  // Built from parts: a locale's own date format isn't guaranteed to be YYYY-MM-DD.
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: SERVER_TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(now)
    .reduce((o, p) => ({ ...o, [p.type]: p.value }), {})
  return `${parts.year}-${parts.month}-${parts.day}`
}

// Plain-date arithmetic in UTC, so no timezone or DST shift ever moves the day.
export function addDays(day, n) {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

// The Wednesday a day's M+ week starts on.
export function weekStartOf(day) {
  const dow = new Date(`${day}T00:00:00Z`).getUTCDay() // 0 = Sunday … 3 = Wednesday
  return addDays(day, -((dow - 3 + 7) % 7))
}

const affixNames = (run) => (run?.affixes || []).map((a) => a.name)

// True when `run`'s affixes are (a prefix of) `set` — lower keys carry only the first
// one or two affixes of the week, in the same order.
function matchesAffixSet(run, set) {
  const names = affixNames(run)
  return names.length > 0 && set.length > 0 && names.every((n, i) => set[i] === n)
}

// The full affix set of the week that ends on `lastDay` (a Tuesday), from its highest key.
async function affixSetEndingOn(lastDay, realm) {
  const { data, error } = await supabase
    .from('mplus_runs')
    .select('affixes, level')
    .eq('realm', realm)
    .eq('day', lastDay)
    .gte('level', 4)
    .order('level', { ascending: false })
    .limit(1)
  if (error) throw error
  return affixNames(data?.[0])
}

// Is `run` part of the week starting on `start`? `prevSet` = the previous week's affixes.
function inWeek(run, start, prevSet) {
  if (run.day < start || run.day > addDays(start, 6)) return false
  if (run.day !== start) return true
  // Wednesday: only runs that visibly carry the NEW week's affixes.
  return affixNames(run).length > 0 && !matchesAffixSet(run, prevSet)
}

// The current M+ week: { start, end, prevSet }. On a Wednesday before anyone has finished
// a key on the new affixes, it's still last week's (the reset hasn't really happened yet
// as far as the boards can tell), so the window stays on last week until it does.
async function currentWeek(realm) {
  const today = serverToday()
  let start = weekStartOf(today)
  let prevSet = await affixSetEndingOn(addDays(start, -1), realm)
  if (today === start) {
    const { data, error } = await supabase
      .from('mplus_runs')
      .select('affixes, day')
      .eq('realm', realm)
      .eq('day', start)
      .gte('level', 4)
      .order('level', { ascending: false })
      .limit(200)
    if (error) throw error
    if (!(data || []).some((r) => inWeek(r, start, prevSet))) {
      start = addDays(start, -7)
      prevSet = await affixSetEndingOn(addDays(start, -1), realm)
    }
  }
  return { start, end: addDays(start, 6), prevSet }
}

// A dungeon's top runs in a day range: the highest keys (incl. depleted) plus the best
// timed keys, so both the "highest key" and "highest score" picks are always in the set.
// Every board counts (Evermoon+Tauri's shared one and Warriors of Darkness's).
async function topRunsForDungeon(mapId, from, to) {
  const base = () => {
    let q = supabase.from('mplus_runs').select(RUN_COLS).eq('map_id', mapId)
    if (from) q = q.gte('day', from)
    if (to) q = q.lte('day', to)
    return q.order('level', { ascending: false }).order('time_ms', { ascending: true, nullsFirst: false })
  }
  const [top, timed] = await Promise.all([base().limit(100), base().gt('medal', 0).limit(25)])
  if (top.error) throw top.error
  if (timed.error) throw timed.error
  return [...new Map([...(top.data || []), ...(timed.data || [])].map((r) => [r.id, r])).values()]
}

// Run `fn` again (up to twice, after a short wait) if it fails: a dropped request or a
// slow first query on a cold connection shouldn't leave the page on an error.
async function withRetry(fn, tries = 3) {
  for (let i = 1; ; i++) {
    try {
      return await fn()
    } catch (e) {
      if (i >= tries) throw e
      await new Promise((r) => setTimeout(r, 700 * i))
    }
  }
}

// Best run per dungeon, site-wide, for `scope` = 'week' | 'all':
//   { keys: bestRuns(…,'key'), scores: bestRuns(…,'score'), week: { start, end, affixes } | null }
// `week.affixes` is the current week's full affix set (icons), for the header.
const scopeCache = new Map()
export function getTopRuns(scope = 'week', realm = DEFAULT_MPLUS_REALM) {
  const ck = `${scope}|${realm}`
  if (!scopeCache.has(ck)) {
    const p = withRetry(() => loadTopRuns(scope, realm))
    p.catch(() => scopeCache.delete(ck)) // let a failed load retry
    scopeCache.set(ck, p)
  }
  return scopeCache.get(ck)
}

async function loadTopRuns(scope, realm) {
  if (!supabase) return { keys: bestRuns([], 'key'), scores: bestRuns([], 'score'), week: null }
  const week = scope === 'week' ? await currentWeek(realm) : null
  const lists = await Promise.all(
    MPLUS_DUNGEONS.map((d) => topRunsForDungeon(d.id, week?.start, week?.end)),
  )
  let runs = lists.flat()
  let weekInfo = null
  if (week) {
    runs = runs.filter((r) => inWeek(r, week.start, week.prevSet))
    // The week's affixes = the most affixes any of its runs shows (its highest keys).
    const full = runs.reduce((a, r) => ((r.affixes?.length || 0) > (a?.affixes?.length || 0) ? r : a), null)
    weekInfo = { start: week.start, end: week.end, affixes: full?.affixes || [] }
  }
  return { keys: bestRuns(runs, 'key'), scores: bestRuns(runs, 'score'), week: weekInfo }
}

// A player's M+ rankings, from the mplus_scores table the scraper rebuilds (schema.sql):
//   { '': { score, rank, total, classRank, classTotal, class }, Fury: { score, rank, total, class }, … }
// The '' entry ranks the overall score among all players and within the class; a spec entry
// ranks that spec's score among players of the same class and spec. {} when unranked.
export async function getPlayerRanks(player) {
  if (!supabase) return {}
  const { name, realm } = splitPlayerKey(player)
  const { data, error } = await supabase.rpc('mplus_player_ranks', { p_realm: realm, p_name: name })
  if (error) throw error
  const out = {}
  for (const r of data || []) {
    out[r.spec] = {
      score: Number(r.score),
      rank: r.rank,
      total: r.total,
      classRank: r.class_rank,
      classTotal: r.class_total,
      class: r.class,
      // Ranks before the last update that changed their score (null when it didn't).
      prevRank: r.prev_rank ?? null,
      prevClassRank: r.prev_class_rank ?? null,
    }
  }
  return out
}

// One page of the M+ rankings (see mplus_leaderboard in schema.sql). `klass`/`spec` pick
// the scope (none = everyone's overall score, class = that class by overall score, class +
// spec = that spec's score), `realm` (armory string) narrows it. With findName/findRealm
// the page that player is on is returned instead of `page`. `search` (2+ characters) keeps
// only names containing it; ranks stay the player's real rank in the scope, and `total`
// becomes the number of matches. `guild` narrows the scope: an exact guild name to that guild,
// any other text (2+ characters) to every guild whose name contains it;
// each row carries the player's `guild` (null when they have none). `minKey` keeps only
// players who timed a key of that level or higher; like the search, ranks are unchanged.
// `prev_rank` is the rank they held in the same list before the last update that changed a
// score, for the up/down arrows; null unless their own score changed in that update.
// → [{ rank, prev_rank, total, realm, name, class, spec, score, best: { mapId: [level, medal, score, ms] } }]
export const RANKINGS_PAGE_SIZE = 25
export async function getLeaderboard({ klass = null, spec = null, realm = null, page = 1, findName = null, findRealm = null, search = null, guild = null, minKey = null } = {}) {
  if (!supabase) return []
  const { data, error } = await supabase.rpc('mplus_leaderboard', {
    p_class: klass,
    p_spec: klass ? spec : null,
    p_realm: realm,
    p_limit: RANKINGS_PAGE_SIZE,
    p_offset: (Math.max(1, page) - 1) * RANKINGS_PAGE_SIZE,
    p_find_realm: findName ? findRealm : null,
    p_find_name: findName,
    p_search: search || null,
    p_guild: guild || null,
    p_min_key: minKey || null,
  })
  if (error) throw error
  return (data || []).map((r) => ({ ...r, score: Number(r.score) }))
}

// "Oct 17, 14:23 · 2 h ago" in the viewer's own time zone.
export function formatUpdated(d) {
  const when = d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
  const min = Math.max(0, Math.round((Date.now() - d.getTime()) / 60000))
  const ago =
    min < 1 ? 'just now' : min < 60 ? `${min} min ago` : min < 48 * 60 ? `${Math.round(min / 60)} h ago` : `${Math.round(min / 1440)} days ago`
  return `${when} · ${ago}`
}

// Every stored run, newest first (by day, then the scrape that first saw it), one page at
// a time for the home page's "Latest runs". Filters: `mapId` one dungeon, `minKey` key
// level and up, `timedOnly` medal runs only, `board` the leaderboard a run came from
// (armory string). `total` (the filtered count) only comes with the first page.
export const LATEST_PAGE_SIZE = 25
export function getLatestRuns(opts = {}) {
  return withRetry(() => loadLatestRuns(opts))
}
async function loadLatestRuns({ mapId = null, minKey = null, timedOnly = false, board = null, offset = 0 } = {}) {
  if (!supabase) return { runs: [], total: 0 }
  let q = supabase.from('mplus_runs').select(`${RUN_COLS}, first_seen`, offset === 0 ? { count: 'exact' } : undefined)
  if (mapId) q = q.eq('map_id', mapId)
  if (minKey) q = q.gte('level', minKey)
  if (timedOnly) q = q.gt('medal', 0)
  if (board) q = q.eq('realm', board)
  const { data, error, count } = await q
    .order('day', { ascending: false })
    .order('first_seen', { ascending: false })
    .order('id', { ascending: true })
    .range(offset, offset + LATEST_PAGE_SIZE - 1)
  if (error) throw error
  return { runs: data || [], total: count ?? null }
}

// When the rankings were last rebuilt (the end of the last scrape), as a Date, or null.
export async function getLastUpdated() {
  if (!supabase) return null
  const { data, error } = await supabase.from('mplus_status').select('refreshed_at').eq('id', 1).maybeSingle()
  if (error) throw error
  return data?.refreshed_at ? new Date(data.refreshed_at) : null
}

// Players per class and per class+spec, for the rankings page's spec chart (see
// mplus_population in schema.sql): each player counts once, under their main spec.
// `realm` (armory string) narrows it to one realm, `minKey` to players who timed a key
// of that level or higher.
// → Map("Warrior" → { players, specs: Map("Fury" → players) }). Cached per realm + key.
const populationCache = new Map()
export function getPopulation(realm = null, minKey = null) {
  const key = `${realm || ''}|${minKey || ''}`
  if (!populationCache.has(key)) {
    const p = (async () => {
      if (!supabase) return new Map()
      const { data, error } = await supabase.rpc('mplus_population', { p_realm: realm, p_min_key: minKey || null })
      if (error) throw error
      const out = new Map()
      for (const r of data || []) {
        const c = out.get(r.class) || { players: 0, specs: new Map() }
        if (r.spec) c.specs.set(r.spec, r.players)
        else c.players = r.players
        out.set(r.class, c)
      }
      return out
    })()
    p.catch(() => populationCache.delete(key))
    populationCache.set(key, p)
  }
  return populationCache.get(key)
}

// Guilds with at least one ranked player, biggest first, for the rankings' guild filter:
// [{ guild, players }]. `realm` (armory string) narrows it to one realm. Cached per realm.
const guildListCache = new Map()
export function getGuilds(realm = null) {
  const key = realm || ''
  if (!guildListCache.has(key)) {
    const p = (async () => {
      if (!supabase) return []
      const { data, error } = await supabase.rpc('mplus_guild_list', { p_realm: realm })
      if (error) throw error
      return data || []
    })()
    p.catch(() => guildListCache.delete(key))
    guildListCache.set(key, p)
  }
  return guildListCache.get(key)
}
