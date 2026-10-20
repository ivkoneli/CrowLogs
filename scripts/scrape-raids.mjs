// CrowLogs raid scraper: every boss kill on Tauri → each player's best DPS/HPS per boss,
// difficulty and spec (`raid_bests`). Runs in CI every 30 min (scrape-raids.yml, started by
// pg_cron's dispatch_raid_scrape()), never in the browser.
//
// 1. `raid-last` (official API) lists the kills newer than the last one processed. The very
//    first run only records the newest id: tracking starts then, nothing older is fetched.
// 2. Each new kill's `raid-log` has every member's damage, healing and the build Tauri froze
//    at the kill (spec, ilvl, talents, both trinkets). A member's kill becomes a row only when
//    it beats their stored best for that boss/difficulty/spec.
// 3. Legendaries aren't in Tauri's record, so for each new best the armory sheet is read and
//    its legendaries kept only if the sheet still shows the kill's spec, trinkets and ilvl —
//    i.e. they haven't re-geared since. Otherwise the row says "unknown" instead of guessing.
//    The same armory read settles the player's realm (Evermoon and [HU] Tauri share one API
//    realm).
//
// Env: TAURI_API_KEY, TAURI_API_SECRET, TAURI_COOKIE, SUPABASE_URL, SUPABASE_SERVICE_KEY
// Run: node scripts/scrape-raids.mjs            (RAIDS_DRY=1 → fetch + print, write nothing)

import 'dotenv/config'
import { tauriClient } from '../supabase/functions/_shared/tauri-kills.js'
import { getAuthCookie, fetchArmory, parseSheet, parseGear, sleep, ICON_BASE, LEGENDARY_ILVL, CLASS_BY_ID, RACE_BY_ID } from './armory.mjs'
import { matchBoss, DIFFICULTY_MAP } from '../src/lib/raids.js'
import { foldName } from '../src/lib/rankings.js'

const { SUPABASE_URL, SUPABASE_SERVICE_KEY, TAURI_API_KEY, TAURI_API_SECRET, RAIDS_DRY } = process.env
const DRY = !!RAIDS_DRY
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_KEY')
  process.exit(1)
}
const REST = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1`
const dbHeaders = { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` }

// API realms polled, and the realm slug of their players. Evermoon's kills are listed under
// the [HU] Tauri realm, so its players start as 'evermoon' until the armory says otherwise.
const API_REALMS = [
  { api: '[HU] Tauri WoW Server', slug: 'evermoon', verified: false },
  { api: '[HU] Warriors of Darkness', slug: 'wod', verified: true },
]
const ARMORY_REALM = { evermoon: '[EN] Evermoon', tauri: '[HU] Tauri WoW Server', wod: '[HU] Warriors of Darkness' }
// Legion raid maps (Emerald Nightmare → Antorus). Anything else (old raids, test dungeons) is skipped.
const LEGION_MAPS = new Set([1520, 1530, 1648, 1676, 1712])
const PAGE = 100 // kills per raid-last call
const MAX_PAGES = 30 // a backlog of more than 3000 kills means something's off — stop and report
const ARMORY_BUDGET = 300 // sheet reads per run; the rest of the new bests get "unknown" legendaries
// A member whose number is this many times the raid's median (same role) is Tauri's bug, not
// a parse: it once credited a Fury warrior ~7× and a Mistweaver ~97× what they did.
const OUTLIER = 4
const OUTLIER_MIN_DPS = 1e6

// Tauri spec ids (Blizzard's) → [class, spec].
const SPEC_BY_ID = {
  250: ['Death Knight', 'Blood'], 251: ['Death Knight', 'Frost'], 252: ['Death Knight', 'Unholy'],
  577: ['Demon Hunter', 'Havoc'], 581: ['Demon Hunter', 'Vengeance'],
  102: ['Druid', 'Balance'], 103: ['Druid', 'Feral'], 104: ['Druid', 'Guardian'], 105: ['Druid', 'Restoration'],
  253: ['Hunter', 'Beast Mastery'], 254: ['Hunter', 'Marksmanship'], 255: ['Hunter', 'Survival'],
  62: ['Mage', 'Arcane'], 63: ['Mage', 'Fire'], 64: ['Mage', 'Frost'],
  268: ['Monk', 'Brewmaster'], 270: ['Monk', 'Mistweaver'], 269: ['Monk', 'Windwalker'],
  65: ['Paladin', 'Holy'], 66: ['Paladin', 'Protection'], 70: ['Paladin', 'Retribution'],
  256: ['Priest', 'Discipline'], 257: ['Priest', 'Holy'], 258: ['Priest', 'Shadow'],
  259: ['Rogue', 'Assassination'], 260: ['Rogue', 'Outlaw'], 261: ['Rogue', 'Subtlety'],
  262: ['Shaman', 'Elemental'], 263: ['Shaman', 'Enhancement'], 264: ['Shaman', 'Restoration'],
  265: ['Warlock', 'Affliction'], 266: ['Warlock', 'Demonology'], 267: ['Warlock', 'Destruction'],
  71: ['Warrior', 'Arms'], 72: ['Warrior', 'Fury'], 73: ['Warrior', 'Protection'],
}
const HEALERS = new Set([105, 270, 65, 256, 257, 264])
const ALLIANCE_RACES = new Set([1, 3, 4, 7, 11, 22, 25, 29, 30])
const HORDE_RACES = new Set([2, 5, 6, 8, 9, 10, 26, 27, 28])
const QUALITY_BY_RARITY = { 1: 'common', 2: 'uncommon', 3: 'rare', 4: 'epic', 5: 'legendary', 6: 'artifact', 7: 'heirloom' }

// ── DB ──────────────────────────────────────────────────────────────────────
async function db(path, init = {}) {
  const res = await fetch(`${REST}/${path}`, { ...init, headers: { ...dbHeaders, ...(init.headers || {}) } })
  if (!res.ok) throw new Error(`${init.method || 'GET'} ${path.split('?')[0]}: HTTP ${res.status} — ${await res.text()}`)
  return res.status === 204 || init.method === 'POST' ? null : res.json()
}
const upsert = (table, rows, conflict) =>
  rows.length && !DRY
    ? db(`${table}${conflict ? `?on_conflict=${conflict}` : ''}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(rows),
      })
    : null
const inList = (vals) => `(${vals.map((v) => `"${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(',')})`

// ── TAURI RECORD → ROWS ─────────────────────────────────────────────────────
// "Za!1212.12": class + spec letters, then the column picked on each tier counted from 0,
// '.' for none → [{ row, col }] with col 1-3 (0 = none), the shape fights.talents uses.
function parseTalentCode(code) {
  const cols = String(code || '').split('!')[1] || ''
  if (!/^[.0-2]{1,7}$/.test(cols)) return null
  return [...cols].map((c, i) => ({ row: i + 1, col: c === '.' ? 0 : +c + 1 }))
}
const trinketOf = (t) =>
  t?.entry
    ? { id: t.entry, name: t.name || t.originalname || null, icon: t.icon ? `${ICON_BASE}${t.icon}.png` : null, ilvl: t.ilevel || null, quality: QUALITY_BY_RARITY[t.rarity] || null }
    : null

function median(xs) {
  const v = xs.filter((x) => x > 0).sort((a, b) => a - b)
  return v.length ? v[Math.floor(v.length / 2)] : 0
}

// One kill's members → candidate rows (without player key/realm, filled in later).
function rowsOfKill(log, where) {
  const sec = (log.fight_time || 0) / 1000
  if (!(sec > 0)) return []
  const members = (log.members || []).filter((m) => SPEC_BY_ID[m.spec] && m.name)
  const dps = (m) => Math.max(+m.dmg_done || 0, 0) / sec
  const hps = (m) => (Math.max(+m.heal_done || 0, 0) + Math.max(+m.absorb_done || 0, 0)) / sec
  // Tauri's bug inflates one or two members; judge each against the raid's typical number:
  // damage against the damage dealers' median, healing against the healers' (when 2+).
  const dpsMedian = median(members.filter((m) => !HEALERS.has(m.spec)).map(dps))
  const healers = members.filter((m) => HEALERS.has(m.spec))
  const hpsMedian = healers.length >= 2 ? median(healers.map(hps)) : 0
  const rows = []
  for (const m of members) {
    const [klass, spec] = SPEC_BY_ID[m.spec]
    const base = {
      name: m.name.trim(),
      class: klass,
      spec,
      race: RACE_BY_ID[m.race] || null,
      gender: m.gender === 1 ? 1 : 0,
      faction: ALLIANCE_RACES.has(m.race) ? 'Alliance' : HORDE_RACES.has(m.race) ? 'Horde' : null,
      guild: m.guildName || log.guilddata?.name || null,
      duration: log.fight_time,
      ilvl: m.ilvl || null,
      talents: parseTalentCode(m.talents),
      trinkets: [trinketOf(m.trinket_0), trinketOf(m.trinket_1)].filter(Boolean),
      log_id: log.log_id,
      day: new Date(log.killtime * 1000).toISOString().slice(0, 10),
      ...where,
    }
    for (const [metric, value, amount, typical] of [
      ['dps', dps(m), Math.round(Math.max(+m.dmg_done || 0, 0)), dpsMedian],
      ['hps', hps(m), Math.round(Math.max(+m.heal_done || 0, 0) + Math.max(+m.absorb_done || 0, 0)), HEALERS.has(m.spec) ? hpsMedian : 0],
    ]) {
      if (!(value > 0)) continue
      if (typical > 0 && value > typical * OUTLIER && value > OUTLIER_MIN_DPS) {
        console.log(`  ! skipped ${m.name} ${metric} ${Math.round(value)} on ${where.boss} (#${log.log_id}): ${Math.round(value / typical)}× the raid's median`)
        continue
      }
      rows.push({ ...base, metric, value, amount })
    }
  }
  return rows
}

// ── ARMORY CHECK ────────────────────────────────────────────────────────────
// Read the sheet; resolve the realm when it isn't settled yet (Evermoon first, then [HU] Tauri).
async function readSheet(cookie, name, slug, verified) {
  const tries = verified ? [slug] : [slug, ...Object.keys(ARMORY_REALM).filter((s) => s !== slug && s !== 'wod')]
  for (const s of tries) {
    try {
      const html = await fetchArmory('character-sheet/ajax', name, ARMORY_REALM[s], cookie)
      return { slug: s, sheet: parseSheet(html), gear: parseGear(html) }
    } catch (e) {
      if (!/armory error/.test(e.message)) throw e
    }
  }
  return null
}

// Does the armory still show the build the kill recorded? Spec, both trinkets (by item id)
// and item level (±1) must all match before its legendaries can stand for the kill's.
function sameBuild(row, armory) {
  if (armory.sheet.spec !== row.spec) return false
  const want = row.trinkets.map((t) => t.id).sort().join(',')
  const have = armory.gear.filter((g) => g.slot === 'trinket').map((g) => g.id).sort().join(',')
  if (!want || want !== have) return false
  return row.ilvl == null || armory.sheet.ilvl == null || Math.abs(armory.sheet.ilvl - row.ilvl) <= 1
}
const legendariesOf = (gear) =>
  gear
    .filter((g) => g.quality === 'legendary')
    .map((g) => ({ id: g.id, name: g.name, icon: g.icon, ilvl: LEGENDARY_ILVL, quality: 'legendary' }))

// ── MAIN ────────────────────────────────────────────────────────────────────
async function main() {
  const client = tauriClient(TAURI_API_KEY, TAURI_API_SECRET)
  if (!client.enabled) throw new Error('Missing TAURI_API_KEY / TAURI_API_SECRET')
  const cookie = getAuthCookie()
  const status = new Map((await db('raid_status?select=*')).map((s) => [s.api_realm, s]))

  for (const realm of API_REALMS) {
    const st = status.get(realm.api)
    if (!st) {
      // First run: remember where "now" is. Tracking starts here, nothing older is read.
      const newest = (await client.call('raid-last', { r: realm.api, from: 0, limit: 1 }))?.logs?.[0]?.log_id
      if (!newest) throw new Error(`${realm.api}: raid-last returned no kills`)
      console.log(`${realm.api}: starting from raid-log #${newest}`)
      await upsert('raid_status', [{ api_realm: realm.api, last_log_id: newest, refreshed_at: new Date().toISOString() }])
      continue
    }

    // New kills since the last processed id, oldest first.
    let last = +st.last_log_id
    const kills = []
    for (let page = 0; ; page++) {
      if (page >= MAX_PAGES) throw new Error(`${realm.api}: more than ${PAGE * MAX_PAGES} new kills — check raid-last's paging`)
      const logs = ((await client.call('raid-last', { r: realm.api, from: last, limit: PAGE }))?.logs || [])
        .filter((l) => +l.log_id > last)
        .sort((a, b) => a.log_id - b.log_id)
      if (!logs.length) break
      kills.push(...logs)
      last = +logs.at(-1).log_id
      if (logs.length < PAGE) break
    }
    const raidKills = kills.filter((l) => LEGION_MAPS.has(+l.map_id) && DIFFICULTY_MAP[l.difficulty] && [14, 15, 16, 17].includes(+l.difficulty))
    console.log(`${realm.api}: ${kills.length} new log(s) since #${st.last_log_id}, ${raidKills.length} Legion raid kill(s)`)

    // Each kill's members → candidate rows.
    const cands = []
    const killRows = []
    for (const k of raidKills) {
      const log = await client.call('raid-log', { r: realm.api, id: k.log_id })
      const encName = (log.encounter_data?.encounter_name || k.encounter_data?.encounter_name || '').trim()
      const hit = matchBoss(encName)
      const where = {
        raid: hit?.raid || log.mapentry?.name || k.mapentry?.name || 'Unknown raid',
        boss: hit?.boss || encName,
        difficulty: DIFFICULTY_MAP[log.difficulty],
        api_realm: realm.api,
      }
      killRows.push({
        api_realm: realm.api,
        log_id: log.log_id,
        raid: where.raid,
        boss: where.boss,
        difficulty: where.difficulty,
        killed_at: new Date(log.killtime * 1000).toISOString(),
        fight_time: log.fight_time,
        guild: log.guilddata?.name || null,
        members: log.member_count || log.members?.length || null,
      })
      cands.push(...rowsOfKill(log, where))
    }

    // Realm per name: known players keep theirs; new ones start on the realm's default.
    const names = [...new Set(cands.map((r) => r.name))]
    const known = new Map()
    for (let i = 0; i < names.length; i += 100) {
      const q = `raid_players?select=name,slug,verified&api_realm=eq.${encodeURIComponent(realm.api)}&name=in.${encodeURIComponent(inList(names.slice(i, i + 100)))}`
      for (const p of await db(q)) known.set(p.name, p)
    }
    const realmOf = (name) => known.get(name) || { name, slug: realm.slug, verified: realm.verified }
    const keyOf = (r) => `${r.name}-${realmOf(r.name).slug}`.toLowerCase()

    // Keep the best candidate per row key, then drop the ones the stored best already beats.
    const rowKey = (r) => [keyOf(r), r.raid, r.boss, r.difficulty, r.metric, r.spec].join('|')
    const bestCand = new Map()
    for (const r of cands) if (!bestCand.has(rowKey(r)) || bestCand.get(rowKey(r)).value < r.value) bestCand.set(rowKey(r), r)
    const stored = new Map()
    const keys = [...new Set([...bestCand.values()].map(keyOf))]
    for (let i = 0; i < keys.length; i += 100) {
      const q = `raid_bests?select=player_key,raid,boss,difficulty,metric,spec,value&player_key=in.${encodeURIComponent(inList(keys.slice(i, i + 100)))}`
      for (const s of await db(q)) stored.set([s.player_key, s.raid, s.boss, s.difficulty, s.metric, s.spec].join('|'), s.value)
    }
    const newBests = [...bestCand.entries()].filter(([k, r]) => !(stored.get(k) >= r.value)).map(([, r]) => r)

    // Armory: one sheet per player with a new best (realm + legendaries check).
    let budget = ARMORY_BUDGET
    const sheets = new Map()
    const players = new Map()
    for (const r of newBests) {
      const p = realmOf(r.name)
      if (!sheets.has(r.name)) {
        let armory = null
        if (budget > 0) {
          budget--
          try {
            armory = await readSheet(cookie, r.name, p.slug, p.verified)
          } catch (e) {
            console.log(`  armory ${r.name}: ${e.message}`)
          }
          await sleep(150)
        }
        sheets.set(r.name, armory)
        if (armory && (!p.verified || armory.slug !== p.slug)) known.set(r.name, { name: r.name, slug: armory.slug, verified: true })
      }
    }
    // Everyone seen in these kills goes into raid_players (realm + search), verified or not.
    for (const r of cands) {
      const p = realmOf(r.name)
      players.set(r.name, { api_realm: realm.api, name: r.name, slug: p.slug, verified: !!p.verified, class: r.class, name_fold: foldName(r.name), updated_at: new Date().toISOString() })
    }

    // The armory may have moved someone to [HU] Tauri, which changes their key: compare
    // against the stored bests under the final keys.
    const finalKeys = [...new Set(newBests.map(keyOf))].filter((k) => !keys.includes(k))
    for (let i = 0; i < finalKeys.length; i += 100) {
      const q = `raid_bests?select=player_key,raid,boss,difficulty,metric,spec,value&player_key=in.${encodeURIComponent(inList(finalKeys.slice(i, i + 100)))}`
      for (const s of await db(q)) stored.set([s.player_key, s.raid, s.boss, s.difficulty, s.metric, s.spec].join('|'), s.value)
    }

    let legOk = 0
    const out = []
    for (const r of newBests) {
      if (stored.get(rowKey(r)) >= r.value) continue
      const armory = sheets.get(r.name)
      const match = armory ? sameBuild(r, armory) : false
      if (match) legOk++
      const slug = realmOf(r.name).slug
      out.push({
        player_key: keyOf(r),
        player: `${r.name}-${slug}`,
        raid: r.raid,
        boss: r.boss,
        difficulty: r.difficulty,
        metric: r.metric,
        spec: r.spec,
        class: r.class,
        race: r.race,
        gender: r.gender,
        faction: r.faction,
        guild: r.guild,
        value: r.value,
        amount: r.amount,
        duration: r.duration,
        day: r.day,
        ilvl: r.ilvl,
        talents: r.talents,
        trinkets: r.trinkets,
        legendaries: match ? legendariesOf(armory.gear) : null,
        legendary_status: match ? 'ok' : armory ? 'mismatch' : 'unknown',
        source: 'tauri',
        api_realm: realm.api,
        log_id: r.log_id,
        logid: null,
        started: null,
        updated_at: new Date().toISOString(),
      })
    }

    console.log(`  ${cands.length} member result(s) → ${out.length} new best(s); legendaries confirmed on ${legOk}, armory reads ${ARMORY_BUDGET - budget}`)
    if (DRY) {
      for (const r of out.slice(0, 15)) console.log(`   ${r.player.padEnd(24)} ${r.boss.padEnd(20)} ${r.difficulty.padEnd(7)} ${r.metric} ${Math.round(r.value)} ${r.spec} ilvl ${r.ilvl} leg:${r.legendary_status}`)
      continue
    }
    for (let i = 0; i < out.length; i += 500) await upsert('raid_bests', out.slice(i, i + 500), 'player_key,raid,boss,difficulty,metric,spec')
    await upsert('raid_kills', killRows, 'api_realm,log_id')
    const pl = [...players.values()]
    for (let i = 0; i < pl.length; i += 500) await upsert('raid_players', pl.slice(i, i + 500), 'api_realm,name')
    await upsert('raid_status', [{ api_realm: realm.api, last_log_id: last, refreshed_at: new Date().toISOString() }])
  }
}

main().catch((e) => {
  // Tauri's API has outages (HTML error pages / connection refused). Those end the run
  // quietly: the next one picks up from the same last id, and dispatch_raid_scrape() emails
  // the owner if nothing has finished for 2 h. Anything else fails the job loudly.
  if (/Unexpected token <|Failed to connect|ECONNREFUSED|fetch failed|Bad Gateway/i.test(e.message)) {
    console.warn(`Tauri unavailable, skipping this run: ${e.message}`)
    return
  }
  console.error(e)
  process.exit(1)
})
