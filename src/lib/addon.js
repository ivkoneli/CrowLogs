// CrowLogsHelper addon ingest. The addon snapshots each raider's spec/talents/ilvl/gear
// per pull into CrowLogsHelper.lua (see Capture.lua/Storage.lua). This module turns that
// file into per-fight "frozen" character data and joins it onto parsed combat-log fights,
// so the Lua snapshot — not the armory — is the source of truth for what a player ran on a
// given pull (people swap talents/specs/trinkets between fights).
//
// Talents are GetTalentInfo talentIDs (resolved via TALENT_BY_ID); trinkets are the item
// in equip slots 13/14 (resolved via ITEM_ICONS). Both come from static wago.tools maps,
// so this runs fully in the browser with no armory/Wowhead call.

import { parseLua, luaArray } from './luaParse.js'
import { TALENT_BY_ID } from './talentIcons.js'
import { ITEM_ICONS } from './itemIcons.js'
import { iconUrl, specIconUrl } from './classes.js'

// WoW class token (UnitClass's second return) -> our display name.
const CLASS_TOKEN = {
  WARRIOR: 'Warrior', PALADIN: 'Paladin', HUNTER: 'Hunter', ROGUE: 'Rogue',
  PRIEST: 'Priest', DEATHKNIGHT: 'Death Knight', SHAMAN: 'Shaman', MAGE: 'Mage',
  WARLOCK: 'Warlock', MONK: 'Monk', DRUID: 'Druid', DEMONHUNTER: 'Demon Hunter',
}
const TALENT_ROWS = 7

// Parse a SavedVariables file into { loadouts: {hash->loadout}, pulls: [pull] }.
// Returns null if it doesn't look like a CrowLogsHelper DB.
export function parseAddonFile(text) {
  let db
  try {
    db = parseLua(text).CrowLogsHelperDB
  } catch {
    return null
  }
  if (!db || typeof db !== 'object' || !db.loadouts) return null
  return { loadouts: db.loadouts || {}, pulls: luaArray(db.pulls) }
}

// Item-link string "item:128024:..." -> numeric item id (or null).
function itemId(link) {
  const m = /^item:(\d+)/.exec(link || '')
  return m ? m[1] : null
}

// One equipped trinket -> { name, icon, ilvl, quality } via the static item map.
function trinket(link) {
  const id = itemId(link)
  const it = id && ITEM_ICONS[id]
  if (!it) return null
  return { id: +id, name: it.name, icon: iconUrl(it.icon), ilvl: it.ilvl, quality: it.quality }
}

// Turn a Lua loadout into the frozen character fields a fight row carries.
export function loadoutSnapshot(loadout) {
  if (!loadout) return null
  const klass = CLASS_TOKEN[loadout.class] || null
  const spec = loadout.specName || null
  // 7 rows in tier order; loadout.talents is keyed by tier (1..7) = the chosen talentID.
  const talents = []
  for (let tier = 1; tier <= TALENT_ROWS; tier++) {
    const t = TALENT_BY_ID[loadout.talents?.[tier]]
    talents.push(t ? { row: tier, col: t.col, icon: t.icon } : { row: tier, col: 0, icon: '' })
  }
  const gear = loadout.gear || {}
  const trinkets = [trinket(gear[13]), trinket(gear[14])].filter(Boolean)
  const ilvl = loadout.ilvl || null
  // "Complete" = has the fields inspect can't give (real ilvl + both trinkets). Comm/self
  // snapshots are complete; inspect ones (ilvl 0, sometimes a half-read gear set) are not,
  // so they still get armory-backfilled for ilvl/trinkets/race while the Lua owns spec+talents.
  const complete = ilvl != null && ilvl > 0 && trinkets.length >= 2
  return {
    class: klass,
    spec,
    spec_icon: specIconUrl(klass, spec),
    ilvl,
    talents,
    trinkets,
    complete,
  }
}

// "06/08 00:45:05" -> ms in the SAME synthetic-2024 frame the log parser uses, so a pull's
// start clock is directly comparable to a fight's `started` for nearest-in-time matching.
function clockToMs(clock) {
  const [date, time] = (clock || '').split(' ')
  if (!time) return NaN
  const [mm, dd] = date.split('/').map(Number)
  const [h, m, s] = time.split(':').map(Number)
  return Date.UTC(2024, (mm || 1) - 1, dd || 1, h || 0, m || 0, s || 0)
}

const norm = (s) => (s || '').toLowerCase().trim()

// Does a pull describe the same boss as a fight? Prefer encounterID (exact); fall back to
// the encounter name when the addon opened a pull without an id (so a Lady Deathwhisper
// snapshot can't bleed onto a Lord Marrowgar fight just because it's the nearest in time).
function sameEncounter(pull, fight) {
  if (pull.encounterID != null && fight.encounterID != null) {
    return +pull.encounterID === +fight.encounterID
  }
  const pn = norm(pull.encounterName)
  const fn = norm(fight.boss)
  if (pn && fn) return pn === fn || pn.includes(fn) || fn.includes(pn)
  return true // not enough info to exclude
}

// Pick the pull a fight belongs to: same boss (encounterID or name), the player must be a
// participant, and among those the one whose start clock is nearest the fight.
function matchPull(fight, pulls) {
  let best = null
  let bestDist = Infinity
  for (const p of pulls) {
    if (!p.participants || !p.participants[fight.guid]) continue
    if (!sameEncounter(p, fight)) continue
    const dist = Math.abs(clockToMs(p.startClock) - fight.started)
    if (dist < bestDist) {
      bestDist = dist
      best = p
    }
  }
  return best
}

// Join parsed combat-log fights with an addon DB, freezing each matched fight's
// spec/talents/ilvl/trinkets from the Lua snapshot. Unmatched fights pass through
// unchanged (the armory cache still fills them in at read time). Pets are skipped.
// Returns { fights, covered } — `covered` is the set of player names the snapshot
// resolved, so the caller can armory-scrape only the players it didn't cover.
export function freezeFromAddon(fights, addon) {
  const covered = new Set()
  if (!addon || !addon.pulls?.length) return { fights, covered }
  const cache = new Map() // loadout hash -> snapshot (built once per loadout)
  const snapshotFor = (hash) => {
    if (!cache.has(hash)) cache.set(hash, loadoutSnapshot(addon.loadouts[hash]))
    return cache.get(hash)
  }
  const out = fights.map((f) => {
    if (f.pet) return f
    const pull = matchPull(f, addon.pulls)
    if (!pull) return f
    const snap = snapshotFor(pull.participants[f.guid])
    if (!snap) return f
    // Only a COMPLETE snapshot marks the player covered (skips the armory). A partial one
    // (inspect) still freezes the reliable spec/talents, but leaves ilvl/trinkets unset so
    // the armory backfills them — better current data than a half-captured set.
    if (snap.complete) covered.add(f.player)
    return {
      ...f,
      class: snap.class ?? f.class,
      spec: snap.spec ?? f.spec,
      spec_icon: snap.spec_icon ?? f.spec_icon ?? null,
      ilvl: snap.ilvl ?? f.ilvl,
      talents: snap.talents.length ? snap.talents : f.talents,
      trinkets: snap.trinkets.length >= 2 ? snap.trinkets : f.trinkets,
    }
  })
  return { fights: out, covered }
}
