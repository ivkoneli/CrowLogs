// CrowLogs — World of Warcraft combat log parser (runs fully in the browser).
//
// `parseLogToFights(text)` turns a raw log into a flat list of fight records,
// one per (player, encounter). It identifies the boss and difficulty from
// ENCOUNTER_START / ENCOUNTER_END markers when present, and otherwise treats the
// whole log as a single fight against whichever enemy took the most damage.
//
// Damage amounts: for every *_DAMAGE event WoW appends the same 9-field suffix
//   amount, overkill, school, resisted, blocked, absorbed, critical, glancing, crushing
// so the amount is reliably the 9th field from the end regardless of expansion.

import { matchBoss, difficultyFromId, DEFAULT_DIFFICULTY } from './lib/raids.js'

const DAMAGE_EVENTS = new Set([
  'SWING_DAMAGE',
  'SPELL_DAMAGE',
  'RANGE_DAMAGE',
  'SPELL_PERIODIC_DAMAGE',
  'SPELL_BUILDING_DAMAGE',
  'DAMAGE_SHIELD',
  'DAMAGE_SPLIT',
])
const DAMAGE_SUFFIX_LEN = 9

function splitFields(record) {
  const out = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < record.length; i++) {
    const ch = record[i]
    if (ch === '"') inQuotes = !inQuotes
    else if (ch === ',' && !inQuotes) {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  out.push(cur)
  return out
}

function parseTimestamp(stamp) {
  const [date, time] = stamp.split(' ')
  if (!time) return NaN
  const [mm, dd] = date.split('/').map(Number)
  const [h, m, rest] = time.split(':')
  const [s, ms] = rest.split('.')
  return Date.UTC(2024, (mm || 1) - 1, dd || 1, +h, +m, +s, +(ms || 0))
}

function isPlayerGuid(guid) {
  return guid.startsWith('Player-') || guid.startsWith('Pet-')
}

function isEnemyGuid(guid) {
  return guid.startsWith('Creature-') || guid.startsWith('Vehicle-')
}

export function formatDay(ms) {
  const d = new Date(ms)
  const mm = d.getUTCMonth() + 1
  const dd = d.getUTCDate()
  const hh = String(d.getUTCHours()).padStart(2, '0')
  const mi = String(d.getUTCMinutes()).padStart(2, '0')
  return `${mm}/${dd} ${hh}:${mi}`
}

// Aggregate one encounter window into per-player records.
function buildRecords({ raid, boss, difficulty, startMs, endMs, events }) {
  const players = new Map()
  let firstDmg = null
  let lastDmg = null

  const lo = Number.isFinite(startMs) ? startMs : -Infinity
  const hi = Number.isFinite(endMs) ? endMs : Infinity
  for (const ev of events) {
    if (ev.ts < lo || ev.ts > hi) continue
    if (!DAMAGE_EVENTS.has(ev.event)) continue
    const amount = parseInt(ev.fields[ev.fields.length - DAMAGE_SUFFIX_LEN], 10)
    if (!Number.isFinite(amount) || amount <= 0) continue
    const srcGuid = ev.fields[1]
    if (!isPlayerGuid(srcGuid)) continue
    const name = ev.fields[2]
    let p = players.get(name)
    if (!p) {
      p = { player: name, guid: srcGuid, pet: srcGuid.startsWith('Pet-'), damage: 0, hits: 0 }
      players.set(name, p)
    }
    p.damage += amount
    p.hits += 1
    if (firstDmg === null) firstDmg = ev.ts
    lastDmg = ev.ts
  }

  // Encounter duration: prefer the explicit window, else first→last damage.
  const start = Number.isFinite(startMs) ? startMs : firstDmg
  const end = Number.isFinite(endMs) && endMs !== Infinity ? endMs : lastDmg
  const durationMs = start !== null && end !== null ? Math.max(end - start, 0) : 0
  const durationSec = durationMs / 1000
  const startedMs = firstDmg ?? start ?? 0

  return [...players.values()]
    .filter((p) => p.damage > 0)
    .map((p) => ({
      id: `${raid}::${boss}::${difficulty}::${p.player}::${startedMs}::${p.damage}`,
      raid,
      boss,
      difficulty,
      player: p.player,
      guid: p.guid,
      pet: p.pet,
      damage: p.damage,
      dps: durationSec > 0 ? Math.round(p.damage / durationSec) : 0,
      duration: durationMs,
      hits: p.hits,
      started: startedMs,
      day: formatDay(startedMs),
      // Populated later from COMBATANT_INFO (advanced logging). Null/empty for now.
      class: null,
      spec: null,
      faction: null,
      ilvl: null,
      talents: [],
    }))
}

export function parseLogToFights(text) {
  const lines = text.split(/\r?\n/)
  const events = []
  const encounters = [] // { boss, raid, difficulty, startMs, endMs }
  let open = null
  let firstTs = null
  let lastTs = null

  for (const line of lines) {
    if (!line) continue
    const gap = line.indexOf('  ')
    if (gap === -1) continue
    const stamp = line.slice(0, gap)
    const ts = parseTimestamp(stamp)
    if (Number.isNaN(ts)) continue
    const fields = splitFields(line.slice(gap + 2))
    const event = fields[0]
    if (!event || event === 'COMBAT_LOG_VERSION') continue

    if (firstTs === null) firstTs = ts
    lastTs = ts

    if (event === 'ENCOUNTER_START') {
      // ENCOUNTER_START,encounterID,"name",difficultyID,groupSize,instanceID
      const name = fields[2]
      const matched = matchBoss(name)
      open = {
        boss: matched ? matched.boss : name,
        raid: matched ? matched.raid : 'Other',
        difficulty: difficultyFromId(fields[3]),
        startMs: ts,
        endMs: Infinity,
      }
      encounters.push(open)
      continue
    }
    if (event === 'ENCOUNTER_END') {
      if (open) {
        open.endMs = ts
        open = null
      }
      continue
    }

    events.push({ ts, event, fields })
  }

  // Close a dangling encounter (log cut off mid-fight).
  if (open) open.endMs = lastTs ?? open.startMs

  let segments = []
  if (encounters.length > 0) {
    segments = encounters
  } else if (events.length > 0) {
    // No encounter markers: one fight against the most-damaged enemy.
    const enemyDamage = new Map()
    for (const ev of events) {
      if (!DAMAGE_EVENTS.has(ev.event)) continue
      const srcGuid = ev.fields[1]
      if (!isPlayerGuid(srcGuid)) continue
      const dstGuid = ev.fields[5]
      const dstName = ev.fields[6]
      if (!isEnemyGuid(dstGuid)) continue
      const amount = parseInt(ev.fields[ev.fields.length - DAMAGE_SUFFIX_LEN], 10)
      if (!Number.isFinite(amount) || amount <= 0) continue
      enemyDamage.set(dstName, (enemyDamage.get(dstName) || 0) + amount)
    }
    let topTarget = 'Unknown Target'
    let max = -1
    for (const [name, dmg] of enemyDamage) {
      if (dmg > max) {
        max = dmg
        topTarget = name
      }
    }
    const matched = matchBoss(topTarget)
    segments = [
      {
        boss: matched ? matched.boss : topTarget,
        raid: matched ? matched.raid : 'Other',
        difficulty: DEFAULT_DIFFICULTY,
        // No explicit encounter window: let buildRecords use the active
        // first→last damage window so pre-pull/post-fight noise doesn't count.
        startMs: null,
        endMs: null,
      },
    ]
  }

  const records = []
  for (const seg of segments) {
    for (const rec of buildRecords({ ...seg, events })) records.push(rec)
  }
  return records
}

export function formatNumber(n) {
  return Math.round(n).toLocaleString('en-US')
}

export function formatDps(n) {
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k'
  return Math.round(n).toString()
}

export function formatDuration(ms) {
  const totalSec = Math.round(ms / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}
