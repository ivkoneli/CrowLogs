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
// Item level, gear, talents and the per-spell breakdown always stay from the log/addon.
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
// Tauri difficulty ids a CrowLogs difficulty can be (Legion ids first, then 10/25-man).
const DIFFICULTY_IDS = { Normal: [14, 3, 4], Heroic: [15, 5, 6], Mythic: [16], LFR: [17, 7] }
// Player keys are "Name-realmslug"; Evermoon and Tauri share one API realm.
const API_REALM = { evermoon: '[HU] Tauri WoW Server', tauri: '[HU] Tauri WoW Server', wod: '[HU] Warriors of Darkness' }

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
// night + party alone (a group kills a boss once per lockout and difficulty).
async function findKill(client, rows) {
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
      .filter((l) => sameNight(rows[0], l) && (gap || Math.abs(l.fight_time - duration) <= DURATION_SLACK_MS))
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
  for (const group of kills.values()) {
    let log = null
    try {
      log = await findKill(client, group)
    } catch (e) {
      out.errors.push(`${group[0].boss}: ${e.message}`)
      continue
    }
    if (!log) {
      // A disconnected pull Tauri has no kill for was a wipe (the parser had to guess).
      if (group.some((r) => r.log_gap)) for (const r of group) replaced.set(r.id, { ...r, kill: false })
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
      if (outlier(damage, logDamage(r), dmgRatio, dmgPairs.length)) {
        out.outliers.push(`${r.boss}: ${r.player} damage ${Math.round(damage / 1e6)}M on Tauri vs ${Math.round(logDamage(r) / 1e6)}M in the log`)
        damage = logDamage(r)
      }
      if (outlier(healing, logHealing(r), healRatio, healPairs.length)) {
        out.outliers.push(`${r.boss}: ${r.player} healing ${Math.round(healing / 1e6)}M on Tauri vs ${Math.round(logHealing(r) / 1e6)}M in the log`)
        healing = logHealing(r)
      }
      replaced.set(r.id, {
        ...r,
        damage,
        healing,
        duration: log.fight_time,
        dps: durationSec > 0 ? Math.round(damage / durationSec) : 0,
        hps: durationSec > 0 ? Math.round(healing / durationSec) : 0,
        tauri_log: log.log_id,
      })
    }
    out.matched.push({ boss: group[0].boss, difficulty: group[0].difficulty, log_id: log.log_id })
  }
  const drop = new Set(out.removeIds)
  out.rows = rows.filter((r) => !drop.has(r.id)).map((r) => replaced.get(r.id) || r)
  return out
}
