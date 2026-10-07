// Mythic+ (challenge mode) data: the dungeon registry shared with the scraper
// (scripts/scrape-mythic-plus.mjs), the profile query, and the best/history selectors.
//
// Runs live in the Supabase `mplus_runs` table, mirrored hourly from Tauri's armory
// leaderboards. Tauri only publishes per-dungeon boards, so the mirror is what makes a
// single player's history one indexed lookup (`members` array contains the name).
import { supabase } from './supabase.js'
import { MPLUS_DUNGEONS, MPLUS_REALMS, DEFAULT_MPLUS_REALM } from './mplusDungeons.js'

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

// Every stored run the player was in, unsorted. Pages past PostgREST's 1000-row cap.
export async function getPlayerRuns(player) {
  if (!supabase) return []
  const { name, realm } = splitPlayerKey(player)
  const PAGE = 1000
  const all = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('mplus_runs')
      .select('id, map_id, dungeon, level, time_ms, medal, affixes, party, day, first_seen')
      .eq('realm', realm)
      .contains('members', [name.toLowerCase()])
      .order('id')
      .range(from, from + PAGE - 1)
    if (error) throw error
    all.push(...(data || []))
    if (!data || data.length < PAGE) break
  }
  return all
}

const timeOrInf = (r) => (r.time_ms == null ? Infinity : r.time_ms)

// One best run per dungeon: highest key, then fastest time on that key.
// Returns MPLUS_DUNGEONS order with `run: null` for dungeons never run.
export function bestRuns(runs) {
  const best = new Map()
  for (const r of runs) {
    const cur = best.get(r.map_id)
    if (!cur || r.level > cur.level || (r.level === cur.level && timeOrInf(r) < timeOrInf(cur))) {
      best.set(r.map_id, r)
    }
  }
  return MPLUS_DUNGEONS.map((d) => ({ dungeon: d, run: best.get(d.id) || null }))
}

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

// Players seen in any M+ run whose name starts with `query` (case-insensitive), for the
// sidebar search — this is how someone with no imported raid logs can still be found.
// Returns [{ player: "Name-realmslug", name, class, runs }], most active first.
export async function searchMplusPlayers(query, limit = 8) {
  const q = (query || '').trim().toLowerCase()
  if (!supabase || q.length < 2) return []
  // Escape LIKE wildcards so a typed % or _ is matched literally.
  const pattern = `${q.replace(/[\\%_]/g, (c) => '\\' + c)}%`
  const { data, error } = await supabase
    .from('mplus_players')
    .select('realm, name, class, runs')
    .like('name_lower', pattern)
    .order('runs', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data || []).map((p) => ({ player: memberPlayerKey(p.name, p.realm), name: p.name, class: p.class, runs: p.runs }))
}
