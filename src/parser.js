// CrowLogs — World of Warcraft combat log parser (runs fully in the browser).
//
// `parseLogToFights(text)` turns a raw log into a flat list of fight records,
// one per (player, encounter). It identifies the boss and difficulty from
// ENCOUNTER_START / ENCOUNTER_END markers when present, and otherwise treats the
// whole log as a single fight against whichever enemy took the most damage.
//
// Each record carries both DAMAGE (damage/dps) and HEALING (healing/hps), a `kill`
// flag (from ENCOUNTER_END's success field), and folds pet output into the owner.
//
// Field-suffix note: WoW appends a fixed-length suffix to each event, so the amount
// is always a known offset FROM THE END regardless of expansion or advanced-logging:
//   *_DAMAGE: amount, overkill, school, resisted, blocked, absorbed, crit, glancing, crushing  (9)
//   *_HEAL:   amount, overhealing, absorbed, critical                                            (4)
//   SPELL_ABSORBED: …, absorbCasterGUID, "name", flags, raidFlags, spellId, "spell", school, amount

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
const HEAL_EVENTS = new Set(['SPELL_HEAL', 'SPELL_PERIODIC_HEAL', 'SPELL_BUILDING_HEAL'])
// The only event types we actually consume. Everything else in a combat log — auras,
// cast-starts, energize, misses, etc. (often half the lines) — is gated out cheaply
// BEFORE the field split, which is the bulk of the parse cost on a big file.
const RELEVANT_EVENTS = new Set([
  ...DAMAGE_EVENTS,
  ...HEAL_EVENTS,
  'SPELL_CAST_SUCCESS', // lust + potions
  'SPELL_ABSORBED', // absorb shields → healing
  'SPELL_SUMMON', // pet → owner mapping
  'ENCOUNTER_START',
  'ENCOUNTER_END',
])
// "Lust" effects — Bloodlust/Heroism/Time Warp and the equivalent pet/drum versions.
// Keyed by spellId (string, as fields come out of the log). SPELL_CAST_SUCCESS for one
// of these names the caster + time, which is what we surface as a per-fight hint.
const BLOODLUST_SPELLS = new Set([
  '2825', // Bloodlust (Shaman, Horde)
  '32182', // Heroism (Shaman, Alliance)
  '80353', // Time Warp (Mage)
  '90355', // Ancient Hysteria (Hunter pet — Core Hound)
  '160452', // Netherwinds (Hunter pet — Nether Ray)
  '178207', // Drums of Fury
  '230935', // Drums of the Mountain
  '256740', // Drums of the Maelstrom
])
const CAST_SPELL_ID = 9 // index of spellId in SPELL_CAST_SUCCESS
const CAST_SPELL_NAME = 10 // index of spellName in SPELL_CAST_SUCCESS
// Combat throughput potions (WoD "Draenic … Potion" + Legion "Potion of …"). Matched
// by name so it survives the several spellIds the same potion can have. Mana/healing/
// utility potions are intentionally excluded — this counts DPS/tank/heal potions.
const POTION_RE = /(?:(?:Strength|Agility|Intellect|Armor) Potion)|(?:Potion of (?:the Old War|Deadly Grace|Prolonged Power|Unbending))/i
const DAMAGE_SUFFIX_LEN = 9
// *_HEAL suffix is 4 fields; effective healing = amount − overhealing.
const HEAL_AMOUNT_FROM_END = 4
const HEAL_OVERHEAL_FROM_END = 3
// SPELL_ABSORBED always ends with: absorbCasterGUID,"name",flags,raidFlags,spellId,"spell",school,amount.
// Read the caster + amount from the end so the optional triggering-spell prefix
// (present for spell hits, absent for melee) doesn't shift the offsets.
const ABSORB_CASTER_GUID_FROM_END = 8
const ABSORB_CASTER_NAME_FROM_END = 7
const ABSORB_AMOUNT_FROM_END = 1

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

function isPetGuid(guid) {
  return guid.startsWith('Pet-')
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

// Pet GUIDs are "Pet-0-srv-inst-zone-npcId-spawnUID"; the spawnUID (last segment)
// changes on every re-summon, but the rest is stable per pet type+instance. We use
// the exact GUID when a SPELL_SUMMON named the owner, and otherwise fall back to that
// stable "base" — but only when the base maps to a single owner, so two mages' Water
// Elementals can never be credited to the wrong one.
function petBase(guid) {
  const i = guid.lastIndexOf('-')
  return i > 0 ? guid.slice(0, i) : guid
}

// Resolve a combatant to the player it should be credited under. Pets are folded
// into their owner (via the SPELL_SUMMON map); unmapped pets stay as themselves.
function resolveActor(guid, name, petOwners, petBaseOwners) {
  if (isPetGuid(guid)) {
    const owner = petOwners.get(guid) || petBaseOwners.get(petBase(guid))
    if (owner) return { guid: owner.guid, name: owner.name, pet: false }
    return { guid, name, pet: true } // unknown owner — keep as its own row
  }
  return { guid, name, pet: false }
}

// Events are appended in chronological (file) order, so a time window is a contiguous
// slice. Binary-search the [loTs, hiTs] bounds so each encounter scans only its own
// events instead of all of them — turns the O(encounters × events) rescan into O(events).
function eventsInWindow(events, loTs, hiTs) {
  if (loTs === -Infinity && hiTs === Infinity) return events
  let a = 0
  let b = events.length
  while (a < b) {
    const m = (a + b) >> 1
    if (events[m].ts < loTs) a = m + 1
    else b = m
  }
  const start = a
  b = events.length
  while (a < b) {
    const m = (a + b) >> 1
    if (events[m].ts <= hiTs) a = m + 1
    else b = m
  }
  return events.slice(start, a)
}

// Aggregate one encounter window into per-player records.
function buildRecords({ raid, boss, difficulty, encounterID, kill, startMs, endMs, events, petOwners, petBaseOwners }) {
  const players = new Map()
  const lusts = [] // { name, ts } — Bloodlust/Heroism/Time Warp casts this fight
  let firstActivity = null
  let lastActivity = null

  const credit = (guid, name) => {
    let p = players.get(name)
    if (!p) {
      p = { player: name, guid, pet: false, damage: 0, hits: 0, healing: 0, potions: 0 }
      players.set(name, p)
    }
    return p
  }

  const lo = Number.isFinite(startMs) ? startMs : -Infinity
  const hi = Number.isFinite(endMs) ? endMs : Infinity
  // Count lust from ~20s before the pull so a pre-pull Bloodlust still shows (@0:00).
  const lustLo = Number.isFinite(lo) ? lo - 20000 : lo
  for (const ev of events) {
    const f = ev.fields

    if (ev.event === 'SPELL_CAST_SUCCESS') {
      // Lust + potions are counted from ~20s pre-pull so pull-timed casts/prepots count.
      const inLustWindow = ev.ts >= lustLo && ev.ts <= hi && f[1]?.startsWith('Player-')
      if (BLOODLUST_SPELLS.has(f[CAST_SPELL_ID])) {
        if (inLustWindow) lusts.push({ name: f[2], ts: ev.ts })
        continue
      }
      if (POTION_RE.test(f[CAST_SPELL_NAME])) {
        if (inLustWindow) credit(f[1], f[2]).potions += 1
        continue
      }
    }
    if (ev.ts < lo || ev.ts > hi) continue

    if (DAMAGE_EVENTS.has(ev.event)) {
      const srcGuid = f[1]
      if (!isPlayerGuid(srcGuid)) continue
      const amount = parseInt(f[f.length - DAMAGE_SUFFIX_LEN], 10)
      if (!Number.isFinite(amount) || amount <= 0) continue
      const who = resolveActor(srcGuid, f[2], petOwners, petBaseOwners)
      const p = credit(who.guid, who.name)
      if (who.pet) p.pet = true
      p.damage += amount
      p.hits += 1
      if (firstActivity === null) firstActivity = ev.ts
      lastActivity = ev.ts
    } else if (HEAL_EVENTS.has(ev.event)) {
      const srcGuid = f[1]
      if (!isPlayerGuid(srcGuid)) continue
      const amount = parseInt(f[f.length - HEAL_AMOUNT_FROM_END], 10)
      const overheal = parseInt(f[f.length - HEAL_OVERHEAL_FROM_END], 10) || 0
      const effective = (Number.isFinite(amount) ? amount : 0) - overheal
      if (effective <= 0) continue
      const who = resolveActor(srcGuid, f[2], petOwners, petBaseOwners)
      const p = credit(who.guid, who.name)
      if (who.pet) p.pet = true
      p.healing += effective
      if (firstActivity === null) firstActivity = ev.ts
      lastActivity = ev.ts
    } else if (ev.event === 'SPELL_ABSORBED') {
      // Absorbed damage counts as healing, credited to the shield's caster.
      const casterGuid = f[f.length - ABSORB_CASTER_GUID_FROM_END]
      if (!casterGuid || !isPlayerGuid(casterGuid)) continue
      const amount = parseInt(f[f.length - ABSORB_AMOUNT_FROM_END], 10)
      if (!Number.isFinite(amount) || amount <= 0) continue
      const who = resolveActor(casterGuid, f[f.length - ABSORB_CASTER_NAME_FROM_END], petOwners, petBaseOwners)
      const p = credit(who.guid, who.name)
      if (who.pet) p.pet = true
      p.healing += amount
      if (firstActivity === null) firstActivity = ev.ts
      lastActivity = ev.ts
    }
  }

  // Encounter duration: prefer the explicit window, else first→last activity.
  const start = Number.isFinite(startMs) ? startMs : firstActivity
  const end = Number.isFinite(endMs) && endMs !== Infinity ? endMs : lastActivity
  const durationMs = start !== null && end !== null ? Math.max(end - start, 0) : 0
  const durationSec = durationMs / 1000
  const startedMs = firstActivity ?? start ?? 0

  // Lust casts as { player, t } where t = seconds into the fight (clamped at 0).
  const base = Number.isFinite(start) ? start : startedMs
  const bloodlust = lusts
    .sort((a, b) => a.ts - b.ts)
    .map((l) => ({ player: l.name, t: Math.max(0, Math.round((l.ts - base) / 1000)) }))

  return [...players.values()]
    .filter((p) => p.damage > 0 || p.healing > 0)
    .map((p) => ({
      id: `${raid}::${boss}::${difficulty}::${p.player}::${startedMs}`,
      raid,
      boss,
      difficulty,
      // Numeric ENCOUNTER_START id (null when the log had no markers). Used to join
      // fights onto CrowLogsHelper addon pulls (see lib/addon.js).
      encounterID: encounterID ?? null,
      kill,
      bloodlust,
      player: p.player,
      guid: p.guid,
      pet: p.pet,
      damage: p.damage,
      dps: durationSec > 0 ? Math.round(p.damage / durationSec) : 0,
      healing: p.healing,
      hps: durationSec > 0 ? Math.round(p.healing / durationSec) : 0,
      potions: p.potions,
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

// Incremental log parser. Feed it raw lines one at a time with `pushLine` (in file order),
// then call `finish()` to get the fight records. Splitting consumption from finalization is
// what lets the worker STREAM a file in chunks instead of materializing the whole thing as
// one string — a log past V8's ~512 MB string cap can't be read whole, but it can be read a
// chunk at a time. `parseLogToFights` below is just this fed from an in-memory string.
export function createLogParser() {
  const events = []
  const encounters = [] // { boss, raid, difficulty, kill, startMs, endMs }
  const petOwners = new Map() // petGUID -> { guid, name } of the owning player
  const baseSeen = new Map() // pet base -> { owners:Set<guid>, last:{guid,name} }
  const openStack = [] // encounters started but not yet matched to an ENCOUNTER_END
  let firstTs = null
  let lastTs = null

  function pushLine(line) {
    if (!line) return
    const gap = line.indexOf('  ')
    if (gap === -1) return
    const rest = line.slice(gap + 2)
    // Event type is the first field (no quotes/commas in it). Read it cheaply and skip
    // the lines we don't use before paying for parseTimestamp + the full field split.
    const comma = rest.indexOf(',')
    const event = comma === -1 ? rest : rest.slice(0, comma)
    if (!RELEVANT_EVENTS.has(event)) return
    const ts = parseTimestamp(line.slice(0, gap))
    if (Number.isNaN(ts)) return
    const fields = splitFields(rest)

    if (firstTs === null) firstTs = ts
    lastTs = ts

    if (event === 'ENCOUNTER_START') {
      // ENCOUNTER_START,encounterID,"name",difficultyID,groupSize,instanceID
      const name = fields[2]
      const encId = Number(fields[1]) || null
      // Ignore a duplicate START for an encounter that's already open. A merged or
      // double-recorded log can emit the same ENCOUNTER_START twice (you can't be in
      // one encounter twice at once); a second segment would overlap the first, double
      // the fight, and collide on its id (raid::boss::diff::player::start) at upsert.
      if (encId != null && openStack.some((s) => s.encounterID === encId)) return
      const matched = matchBoss(name)
      const seg = {
        boss: matched ? matched.boss : name,
        raid: matched ? matched.raid : 'Other',
        difficulty: difficultyFromId(fields[3]),
        encounterID: encId,
        kill: false, // set true if ENCOUNTER_END reports success
        startMs: ts,
        endMs: Infinity,
      }
      encounters.push(seg)
      openStack.push(seg)
      return
    }
    if (event === 'ENCOUNTER_END') {
      // ENCOUNTER_END,encounterID,"name",difficultyID,groupSize,success
      // Match the END to its START by encounterID. WoW occasionally fires a stray boss
      // START+END *inside* another fight's window (e.g. a 1s Valithria Dreamwalker burst
      // mid Lady Deathwhisper); a single "open" slot would let that steal the close and
      // drop the real boss's result, turning a kill into a wipe. Fall back to the most
      // recent open encounter when the id isn't found.
      const id = Number(fields[1]) || null
      let idx = -1
      for (let k = openStack.length - 1; k >= 0; k--) {
        if (openStack[k].encounterID === id) {
          idx = k
          break
        }
      }
      if (idx === -1) idx = openStack.length - 1
      if (idx !== -1) {
        const seg = openStack[idx]
        seg.endMs = ts
        seg.kill = fields[5] === '1'
        openStack.splice(idx, 1)
      }
      return
    }

    // Map pets to their owner so their output folds into the player.
    // SPELL_SUMMON,ownerGUID,"ownerName",…,petGUID,"petName",…
    if (event === 'SPELL_SUMMON' && isPetGuid(fields[5]) && fields[1]?.startsWith('Player-')) {
      const owner = { guid: fields[1], name: fields[2] }
      petOwners.set(fields[5], owner)
      const base = petBase(fields[5])
      let b = baseSeen.get(base)
      if (!b) baseSeen.set(base, (b = { owners: new Set(), last: owner }))
      b.owners.add(owner.guid)
      b.last = owner
    }

    events.push({ ts, event, fields })
  }

  // Resolve encounters into per-player fight records. `onProgress(frac)` (optional) reports
  // 0→1 across the per-encounter aggregation. Safe to call once.
  function finish({ onProgress } = {}) {
    const report = typeof onProgress === 'function' ? onProgress : () => {}

    // Close any encounters left open (log cut off mid-fight) — unknown result, treat as kill.
    for (const seg of openStack) {
      seg.endMs = lastTs ?? seg.startMs
      seg.kill = true
    }

    // Base→owner fallback, kept only where a base belongs to exactly one owner, so an
    // unmapped pet GUID (summoned before the log started) folds in without ambiguity.
    const petBaseOwners = new Map()
    for (const [base, b] of baseSeen) if (b.owners.size === 1) petBaseOwners.set(base, b.last)

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
          kill: true, // no marker to tell — assume a kill so it shows
          // No explicit encounter window: let buildRecords use the active
          // first→last activity window so pre-pull/post-fight noise doesn't count.
          startMs: null,
          endMs: null,
        },
      ]
    }

    const records = []
    const segTotal = segments.length || 1
    for (let s = 0; s < segments.length; s++) {
      const seg = segments[s]
      // Pass only this encounter's events. The lower bound includes the ~20s pre-pull pad
      // buildRecords uses for lust/prepot detection (lustLo = startMs − 20000).
      const winLo = Number.isFinite(seg.startMs) ? seg.startMs - 20000 : -Infinity
      const winHi = Number.isFinite(seg.endMs) ? seg.endMs : Infinity
      const segEvents = eventsInWindow(events, winLo, winHi)
      for (const rec of buildRecords({ ...seg, events: segEvents, petOwners, petBaseOwners })) records.push(rec)
      report((s + 1) / segTotal)
    }
    return records
  }

  return { pushLine, finish }
}

// Parse a whole log already held as one string. `onProgress(fraction)` (optional) reports a
// 0→1 estimate: the line scan owns 0→0.8, per-encounter aggregation the rest. The worker uses
// the streaming `createLogParser` directly for big files; this stays for Node + small inputs.
export function parseLogToFights(text, { onProgress } = {}) {
  const report = typeof onProgress === 'function' ? onProgress : () => {}
  const parser = createLogParser()
  const lines = text.split(/\r?\n/)
  const total = lines.length || 1
  for (let li = 0; li < lines.length; li++) {
    // Report every ~262k lines — cheap enough to be invisible, frequent enough for a smooth bar.
    if ((li & 0x3ffff) === 0) report((li / total) * 0.8)
    parser.pushLine(lines[li])
  }
  report(0.8)
  return parser.finish({ onProgress: (f) => report(0.8 + f * 0.2) })
}

export function formatNumber(n) {
  return Math.round(n).toLocaleString('en-US')
}

// Compact rate formatter, used for both DPS and HPS (e.g. 12.3k, 1.2m). Millions get
// an 'm' suffix so Legion-scale numbers stay short (10.0m, not 10000.0k) and the meter
// column width stays bounded.
export function formatDps(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(2) + 'm'
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k'
  return Math.round(n).toString()
}
export const formatHps = formatDps

export function formatDuration(ms) {
  const totalSec = Math.round(ms / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}
