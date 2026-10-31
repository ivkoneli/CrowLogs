// CrowLogs — replace a log's boss-KILL numbers with Tauri's own record of the kill.
//
// Plain ES module (no Deno/Node globals): imported by the submit-log Edge Function (Deno)
// and by scripts/tauri-kills.mjs (Node, backfills already-uploaded logs).
//
// Why: a combat log only holds what happened near the person logging. Die and release
// on a boss and most of the raid's damage for the rest of the fight is missing; pets
// whose owner the log never names (Army of the Dead, warlock demons, …) can't be credited.
// Tauri's server records every kill with each member's exact damage and healing, so for
// kills its numbers replace ours. Wipes aren't recorded by Tauri and keep the log's data.
// The per-spell breakdown stays from the log. Spec/ilvl/talents/trinkets: the addon's build
// first, Tauri's record of the kill fills what it lacks (see withKillBuild).
//
// Finding the kill: `raid-rank-encounter` lists every kill of one boss on one difficulty
// (a few hundred rows, ~0.1 s). Candidates are the kills whose fight time is within 3 s of
// ours; the one whose members share at least 60% of our players' names is it.

const API = 'http://chapi.tauri.hu/apiIndex.php'
const DURATION_SLACK_MS = 3000
const MIN_NAME_OVERLAP = 0.6
// Tauri's records aren't always right: on Heroic Elerethe Renferal it credited one Fury
// warrior with ~7× and a Mistweaver with ~97× what the log shows, two weeks running, while
// everyone else matched. A player whose Tauri number is more than OUTLIER × the raid's
// typical Tauri/log ratio (and at least OUTLIER_MIN more) keeps the log's number instead.
// The typical ratio is the median, so a log short on everyone (the logger died and
// released) still takes Tauri's numbers.
const OUTLIER = 3
const OUTLIER_MIN = 20e6
// Elerethe Renferal: Tauri over-credits Shimmering Feather users by 2–3× too (2026-10-26),
// under the outlier bar and not tellable from pets the log couldn't credit. So when the log
// saw the whole kill (no disconnect, the raid's typical Tauri/log ratio ≈ 1 — the logger
// didn't die and release), every player keeps the log's numbers.
const LOG_ONLY_ENCOUNTER = 1876
const LOG_ONLY_BOSS = 'Elerethe Renferal'
const CLEAN_RATIO = 1.1
// Tauri difficulty ids a CrowLogs difficulty can be (Legion ids first, then 10/25-man).
const DIFFICULTY_IDS = { Normal: [14, 3, 4], Heroic: [15, 5, 6], Mythic: [16], LFR: [17, 7] }
// Player keys are "Name-realmslug"; Evermoon and Tauri share one API realm.
const API_REALM = { evermoon: '[HU] Tauri WoW Server', tauri: '[HU] Tauri WoW Server', wod: '[HU] Warriors of Darkness' }

// ── A member's build on the kill (shared with scripts/scrape-raids.mjs) ──────────────
export const ICON_BASE = 'https://legion-static.tauri.hu/images/icons/large/'
// Tauri spec ids (Blizzard's) → [class, spec].
export const SPEC_BY_ID = {
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
export const QUALITY_BY_RARITY = { 1: 'common', 2: 'uncommon', 3: 'rare', 4: 'epic', 5: 'legendary', 6: 'artifact', 7: 'heirloom' }
// "Za!1212.12": class + spec letters, then the column picked on each tier counted from 0,
// '.' for none → [{ row, col }] with col 1-3 (0 = none), the shape fights.talents uses.
export function parseTalentCode(code) {
  const cols = String(code || '').split('!')[1] || ''
  if (!/^[.0-2]{1,7}$/.test(cols)) return null
  return [...cols].map((c, i) => ({ row: i + 1, col: c === '.' ? 0 : +c + 1 }))
}
export const trinketOf = (t) =>
  t?.entry
    ? { id: t.entry, name: t.name || t.originalname || null, icon: t.icon ? `${ICON_BASE}${t.icon}.png` : null, ilvl: t.ilevel || null, quality: QUALITY_BY_RARITY[t.rarity] || null }
    : null

// Spec / ilvl / talents / trinkets from Tauri's record of this kill — exact for the pull.
// A build the addon froze (broadcast or inspect) wins field by field; Tauri fills its gaps
// (an inspect has no ilvl). A row with no addon build takes Tauri's over the armory's,
// which is only "what they wear now".
function withKillBuild(r, m) {
  const snap = r.from_addon === true || r.class != null
  const keep = (v) => snap && v != null && !(Array.isArray(v) && !v.length)
  const spec = SPEC_BY_ID[m.spec]?.[1] || null
  const talents = parseTalentCode(m.talents)
  const trinkets = [trinketOf(m.trinket_0), trinketOf(m.trinket_1)].filter(Boolean)
  const next = { ...r }
  if (spec && !keep(r.spec)) {
    if (r.spec !== spec) next.spec_icon = null // the stored icon belongs to the other spec
    next.spec = spec
  }
  if (m.ilvl > 0 && !keep(r.ilvl)) next.ilvl = m.ilvl
  if (talents && !keep(r.talents)) next.talents = talents
  if (trinkets.length >= 2 && !(snap && r.trinkets?.length >= 2)) next.trinkets = trinkets
  return next
}

const norm = (s) => (s || '').normalize('NFC').toLowerCase()
const nameOf = (player) => norm(String(player).split('-')[0])
const slugOf = (player) => String(player).split('-')[1]?.toLowerCase() || 'evermoon'

export function tauriClient(apiKey, secret) {
  const key = (apiKey || '').trim().replace(/^["']|["']$/g, '')
  const sec = (secret || '').trim().replace(/^["']|["']$/g, '')
  const cache = new Map()
  const call = async (url, params) => {
    const ck = url + JSON.stringify(params)
    if (!cache.has(ck)) {
      cache.set(
        ck,
        (async () => {
          // The API has short outages: an HTML error page, or a false "raid log not found"
          // for a log it returned a minute earlier (2026-10-20). Retry those; bad credentials
          // (errorcode 2) won't fix themselves.
          for (let attempt = 1; ; attempt++) {
            let err
            try {
              const res = await fetch(`${API}?apikey=${encodeURIComponent(key)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: encodeURIComponent(JSON.stringify({ secret: sec, url, params })),
              })
              const json = JSON.parse(await res.text())
              if (json.success) return json.response
              err = new Error(`${url}: ${json.errorstring}`)
              if (json.errorcode === 2) throw err
            } catch (e) {
              if (e === err && err.message.includes('authentication')) throw e
              err = e
            }
            if (attempt >= 3) throw err
            await new Promise((r) => setTimeout(r, 1500 * attempt))
          }
        })(),
      )
      cache.get(ck).catch(() => cache.delete(ck))
    }
    return cache.get(ck)
  }
  return { call, enabled: !!(key && sec) }
}

// Encounter id by boss name, for rows uploaded before encounter_id was stored. Our boss
// names are Tauri's or a prefix of them ("Il'gynoth" → "Il'gynoth, The Heart of Corruption").
async function encounterIdByName(client, realm, boss) {
  const maps = await client.call('raid-maps', { r: realm })
  const want = norm(boss)
  for (const exp of Object.values(maps || {})) {
    for (const raid of Object.values(exp || {})) {
      for (const e of Object.values(raid?.encounters || {})) {
        const n = norm(e.encounter_name)
        if (n === want || n.startsWith(want + ',') || n.startsWith(want + ' ')) return e.encounter_id
      }
    }
  }
  return null
}

// Our `started` is the log's local wall clock stored as if UTC, in a fixed year (the log has
// none). Tauri's start (killtime − fight_time) is real UTC. Same date and time within a
// time-zone's reach (±14 h) = the same night; a different week's kill of the same boss by
// the same group is days away.
const SAME_NIGHT_MS = 14 * 3600 * 1000
function sameNight(row, tauriLog) {
  const ours = new Date(row.started || 0)
  const tauriStart = tauriLog.killtime * 1000 - (tauriLog.fight_time || 0)
  const year = new Date(tauriStart).getUTCFullYear()
  const guess = Date.UTC(year, ours.getUTCMonth(), ours.getUTCDate(), ours.getUTCHours(), ours.getUTCMinutes(), ours.getUTCSeconds())
  return Math.abs(guess - tauriStart) <= SAME_NIGHT_MS
}

// One kill (rows of the same boss/difficulty/start, kill = true) → Tauri's raid-log, or null.
// A pull the logger disconnected during (log_gap) has no usable length: it's matched by
// night + party alone (a group kills a boss once per lockout and difficulty). `taken` holds
// the Tauri kills other pulls of this upload already matched: a disconnected WIPE before the
// real kill (Mythic Nythendra, 2026-10-21) would otherwise claim that kill too.
async function findKill(client, rows, taken = new Set()) {
  const players = rows.filter((r) => !r.pet)
  if (!players.length) return null
  const names = new Set(players.map((r) => nameOf(r.player)))
  const slugs = players.map((r) => slugOf(r.player))
  const slug = slugs.sort((a, b) => slugs.filter((x) => x === b).length - slugs.filter((x) => x === a).length)[0]
  const realm = API_REALM[slug] || API_REALM.evermoon
  const duration = Math.max(...rows.map((r) => r.duration || 0))
  const encId = rows.find((r) => r.encounter_id)?.encounter_id || (await encounterIdByName(client, realm, rows[0].boss))
  const gap = rows.some((r) => r.log_gap)
  if (!encId || (!duration && !gap)) return null

  for (const difficulty of DIFFICULTY_IDS[rows[0].difficulty] || []) {
    const list = (await client.call('raid-rank-encounter', { r: realm, encounter: encId, difficulty, from: 0, limit: 0 }))?.logs || []
    const cands = list
      .filter((l) => !taken.has(l.log_id) && sameNight(rows[0], l) && (gap || Math.abs(l.fight_time - duration) <= DURATION_SLACK_MS))
      .sort((a, b) => Math.abs(a.fight_time - duration) - Math.abs(b.fight_time - duration))
      .slice(0, gap ? 20 : 6)
    for (const c of cands) {
      const log = await client.call('raid-log', { r: realm, id: c.log_id })
      const hit = (log?.members || []).filter((m) => names.has(norm(m.name))).length
      if (hit / names.size >= MIN_NAME_OVERLAP) return log
    }
  }
  return null
}

// What the combat log itself measured for a row: its own totals, or (for a row already
// rewritten from Tauri) the per-spell breakdown, which always stays from the log.
const spellSum = (list) => (Array.isArray(list) ? list.reduce((s, x) => s + (+x?.[2] || 0), 0) : 0)
const logDamage = (r) => (r.tauri_log ? spellSum(r.spells?.dmg) : +r.damage || 0)
const logHealing = (r) => (r.tauri_log ? spellSum(r.spells?.heal) : +r.healing || 0)

function median(xs) {
  const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b)
  return v.length ? v[Math.floor(v.length / 2)] : 1
}

// rows: sanitized fight rows of one upload (or one stored log). Returns the rows to keep
// (kills rewritten from Tauri, each tagged with tauri_log), the ids of rows to delete (a
// matched kill's separate pet rows: Tauri already counts pets under their owner), and what
// matched. Never throws: a kill that can't be looked up keeps the log's numbers.
export async function applyTauriKills(client, rows) {
  const out = { rows, removeIds: [], matched: [], errors: [], outliers: [] }
  if (!client?.enabled) return out
  const kills = new Map()
  for (const r of rows) {
    if (r.kill !== true) continue
    const k = `${r.boss}|${r.difficulty}|${r.started}`
    if (!kills.has(k)) kills.set(k, [])
    kills.get(k).push(r)
  }
  const replaced = new Map() // row id → new row
  // Pulls with a real length first (matched exactly), disconnected ones last: they may only
  // take a kill nobody else in the upload matched.
  const taken = new Set()
  const ordered = [...kills.values()].sort((a, b) => Number(a.some((r) => r.log_gap)) - Number(b.some((r) => r.log_gap)))
  for (const group of ordered) {
    let log = null
    try {
      log = await findKill(client, group, taken)
    } catch (e) {
      out.errors.push(`${group[0].boss}: ${e.message}`)
      continue
    }
    if (!log) {
      // A disconnected pull Tauri has no kill for was a wipe (the parser had to guess).
      // Its boss % was the kill's 0; the log missed part of the pull, so the real % is unknown.
      if (group.some((r) => r.log_gap)) for (const r of group) replaced.set(r.id, { ...r, kill: false, boss_pct: null, boss_pct_of: null })
      continue
    }
    const byName = new Map(log.members.map((m) => [norm(m.name), m]))
    const pairs = group.filter((r) => !r.pet).map((r) => [r, byName.get(nameOf(r.player))]).filter(([, m]) => m)
    const tauriHeal = (m) => (+m.heal_done || 0) + (+m.absorb_done || 0)
    const dmgPairs = pairs.filter(([r]) => logDamage(r) > 5e6)
    const healPairs = pairs.filter(([r]) => logHealing(r) > 5e6)
    const dmgRatio = median(dmgPairs.map(([r, m]) => m.dmg_done / logDamage(r)))
    const healRatio = median(healPairs.map(([r, m]) => tauriHeal(m) / logHealing(r)))
    // No log number to compare (no breakdown) or too few players to know what's typical:
    // nothing to judge by, so Tauri's number stands.
    const outlier = (tauri, mine, ratio, n) => n >= 5 && mine > 0 && tauri > mine * ratio * OUTLIER && tauri - mine * ratio > OUTLIER_MIN
    const logOnly =
      (+group[0].encounter_id === LOG_ONLY_ENCOUNTER || group[0].boss === LOG_ONLY_BOSS) &&
      !group.some((r) => r.log_gap) &&
      dmgPairs.length >= 5 &&
      dmgRatio <= CLEAN_RATIO
    for (const r of group) {
      if (r.pet) {
        out.removeIds.push(r.id)
        continue
      }
      const m = byName.get(nameOf(r.player))
      if (!m) continue // in our log but not in Tauri's kill (outside the instance): keep ours
      const durationSec = log.fight_time / 1000
      let damage = Math.max(+m.dmg_done || 0, 0)
      let healing = Math.max(tauriHeal(m), 0)
      // A row already rewritten with no breakdown has no log number left: keep Tauri's.
      if (logOnly && (!r.tauri_log || Array.isArray(r.spells?.dmg))) {
        damage = logDamage(r)
        healing = logHealing(r)
      } else if (outlier(damage, logDamage(r), dmgRatio, dmgPairs.length)) {
        out.outliers.push(`${r.boss}: ${r.player} damage ${Math.round(damage / 1e6)}M on Tauri vs ${Math.round(logDamage(r) / 1e6)}M in the log`)
        damage = logDamage(r)
      }
      if (outlier(healing, logHealing(r), healRatio, healPairs.length)) {
        out.outliers.push(`${r.boss}: ${r.player} healing ${Math.round(healing / 1e6)}M on Tauri vs ${Math.round(logHealing(r) / 1e6)}M in the log`)
        healing = logHealing(r)
      }
      replaced.set(r.id, {
        ...withKillBuild(r, m),
        damage,
        healing,
        duration: log.fight_time,
        dps: durationSec > 0 ? Math.round(damage / durationSec) : 0,
        hps: durationSec > 0 ? Math.round(healing / durationSec) : 0,
        tauri_log: log.log_id,
      })
    }
    taken.add(log.log_id)
    out.matched.push({ boss: group[0].boss, difficulty: group[0].difficulty, log_id: log.log_id })
  }
  const drop = new Set(out.removeIds)
  out.rows = rows.filter((r) => !drop.has(r.id)).map((r) => replaced.get(r.id) || r)
  return out
}
