// Tauri armory fetch + parse, shared by the armory cron (scrape-armory.mjs) and the raid
// scraper (scrape-raids.mjs). The Edge Function scrape-character has its own copy of the
// parse logic (Deno) — keep them in sync.

import { RELIC_ICONS } from '../src/lib/itemIcons.js'

export const ARMORY_AJAX = 'https://tauriwow.com/sys/mod/armory.php'
export const ICON_BASE = 'https://legion-static.tauri.hu/images/icons/large/'

// Tauri's armory reports every Legion legendary as ilvl 910. On this server they are
// actually 895, and the wrong number inflates both the item row and the character's
// average ilvl. Correct it on the way in (verified against the in-game item).
export const LEGENDARY_ILVL = 895

// ── AUTH ────────────────────────────────────────────────────────────────────
// Tauri authenticates every armory request off the persistent `username`/`pasw`
// credential cookies (a guest — or a bare tSessionId — gets an "Armory error" page).
// We send TAURI_COOKIE verbatim on each request; there's no session to keep alive and
// nothing rotates, so a single value works until you change your Tauri password.
export function getAuthCookie(TAURI_COOKIE = process.env.TAURI_COOKIE) {
  if (!TAURI_COOKIE) throw new Error('Missing TAURI_COOKIE (expected "username=…; pasw=…").')
  // A pasted secret often carries a trailing/embedded newline (e.g. username and pasw
  // landed on separate lines). A raw CR/LF makes fetch's Headers reject the Cookie value
  // ("invalid header value") for EVERY request, which masquerades as an auth failure.
  // Rejoin any lines with the cookie separator "; " so a stray newline is harmless whether
  // it was a trailing newline or split the two cookies onto separate lines.
  return TAURI_COOKIE.split(/[\r\n]+/)
    .map((line) => line.trim().replace(/;+$/, '')) // drop blank lines + trailing ';'
    .filter(Boolean)
    .join('; ')
}

// ── FETCH ───────────────────────────────────────────────────────────────────
// Returns the inner rendered HTML for a character page (sheet/talents/…). The auth
// cookie is sent verbatim every time — nothing to rotate or persist.
export async function fetchArmory(option, name, realm, cookie) {
  const body = new URLSearchParams()
  body.set('ajax', 'true')
  body.set('option', option) // e.g. "character-sheet/ajax"
  body.set('dataset[r]', realm)
  body.set('dataset[n]', name)

  const res = await fetch(ARMORY_AJAX, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
      Cookie: cookie,
    },
    body,
  })
  if (!res.ok) throw new Error(`${option} ${name}: HTTP ${res.status}`)
  const json = await res.json()
  const html = json.html || ''
  if (html.includes('armory-errorpage')) {
    throw new Error(`${name}: armory error (bad credentials, or character not found)`)
  }
  return html
}

// ── PARSE ─────────────────────────────────────────────────────────────────────
// The response embeds the data as rendered HTML. Verified against a real Legion
// armory page (Warrior/Fury, ilvl 716, Alliance).
export const CLASS_BY_ID = {
  1: 'Warrior', 2: 'Paladin', 3: 'Hunter', 4: 'Rogue', 5: 'Priest', 6: 'Death Knight',
  7: 'Shaman', 8: 'Mage', 9: 'Warlock', 10: 'Monk', 11: 'Druid', 12: 'Demon Hunter',
}
export const RACE_BY_ID = {
  1: 'Human', 2: 'Orc', 3: 'Dwarf', 4: 'Night Elf', 5: 'Undead', 6: 'Tauren', 7: 'Gnome',
  8: 'Troll', 9: 'Goblin', 10: 'Blood Elf', 11: 'Draenei', 22: 'Worgen',
  24: 'Pandaren', 25: 'Pandaren', 26: 'Pandaren',
  27: 'Nightborne', 28: 'Highmountain Tauren', 29: 'Void Elf', 30: 'Lightforged Draenei',
}
const stripTags = (s) => s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()

// From character-sheet HTML: { ilvl, faction, class, race, spec, level }.
export function parseSheet(html) {
  const ilvl = html.match(/(\d+)\s*ilvl/i)
  const faction = html.match(/type_(Alliance|Horde)/i)
  const guildM = html.match(/gn=([^&"]+)/i)
  const guild = guildM ? guildM[1].trim() : null
  const raceId = html.match(/RaceId\s*=\s*(\d+)/i)
  const genderM = html.match(/\bgender\s*=\s*["']?([012])/i) // 0 male, 1 female
  const gender = genderM ? +genderM[1] : null
  const span = html.match(/level-race-talent-class[^>]*>([\s\S]*?)<\/span>/i)
  const cls = html.match(/level-race-talent-class[^>]*color-c(\d+)/i)
  const klass = cls ? CLASS_BY_ID[+cls[1]] || null : null
  const race = raceId ? RACE_BY_ID[+raceId[1]] || null : null
  let level = null
  let spec = null
  if (span) {
    const t = stripTags(span[1]) // e.g. "100 Human Fury Warrior"
    const l = t.match(/^(\d+)/)
    if (l) level = +l[1]
    let rest = t.replace(/^\d+\s*/, '')
    if (race && rest.startsWith(race)) rest = rest.slice(race.length).trim()
    if (klass && rest.endsWith(klass)) rest = rest.slice(0, -klass.length).trim()
    spec = rest || null
  }
  return { ilvl: ilvl ? +ilvl[1] : null, faction: faction ? faction[1] : null, guild, class: klass, race, gender, spec, level }
}

// Decode a talent build hash (e.g. "warrior&fury&c96M") into the chosen column
// (1-3, 0 = none) per talent row. This ports wowhead/Tauri's TalentCalc.js exactly:
// the first char after the spec is a version marker, the rest are base-4 packed
// (3 rows per char, low bits first) indexed through this CUSTOM charset — NOT
// standard base64. Verified against real Fury-warrior and Enhancement-shaman builds.
const TALENT_CHARSET = '0zMcmVokRsaqbdrfwihuGINALpTjnyxtgevElBCDFHJKOPQSUWXYZ1234567_89-'
const TALENT_ROWS = 7
export function decodeTalents(talent) {
  const part = (talent || '').split('&')[2] || ''
  if (!part) return []
  const version = TALENT_CHARSET.indexOf(part.substr(0, 1))
  // '|' separates an optional suffix; do NOT split on '-' — it's a valid charset
  // character (value 63), so splitting on it truncated builds that encode to a '-'.
  const data = part.substr(1).split('|')[0]
  const cols = new Array(TALENT_ROWS).fill(0)
  for (let i = 0; i < data.length && i < Math.ceil(TALENT_ROWS / 3); i++) {
    const ch = data[i]
    let aU
    if (version === 0) aU = ch.charCodeAt(0) - 47
    else if (version === 2) aU = TALENT_CHARSET.indexOf(ch) + 1
    else aU = TALENT_CHARSET.indexOf(ch)
    for (let k = 0; k < 3; k++) {
      const idx = i * 3 + k
      if (idx < TALENT_ROWS) cols[idx] = (aU >> (2 * k)) & 3
    }
  }
  return cols.map((col, i) => ({ row: i + 1, col, icon: null }))
}

// From character-talents HTML + the active spec: { hash, specIcon }.
export function parseTalents(html, activeSpec) {
  let hash = null
  const tm = html.match(/var trees\s*=\s*(\[[\s\S]*?\]);/)
  if (tm) {
    try {
      const trees = JSON.parse(tm[1])
      const key = (activeSpec || '').toLowerCase().replace(/\s+/g, '')
      hash = (trees.find((t) => t.talent.toLowerCase().includes(`&${key}&`)) || trees[0])?.talent || null
    } catch {
      /* ignore */
    }
  }
  const icons = {}
  const re = /spec-image"\s*src="([^"]+)"[^>]*>\s*<div class="spec-name">([^<]+)</gi
  let m
  while ((m = re.exec(html))) icons[m[2].trim().toLowerCase()] = m[1]
  return { hash, specIcon: activeSpec ? icons[activeSpec.toLowerCase()] || null : null }
}

// Equipped gear, parsed from the character sheet's gear_list_table. Rows are in
// slot order, so we tag each with a slot name (the two trinkets are what the meter
// shows). Each item: { slot, name, ilvl, icon, id, quality }.
const SLOT_ORDER = [
  'head', 'neck', 'shoulder', 'back', 'chest', 'wrist', 'hands', 'waist',
  'legs', 'feet', 'finger', 'finger', 'trinket', 'trinket', 'mainhand', 'offhand',
]
const QUALITY_BY_RARITY = { 1: 'common', 2: 'uncommon', 3: 'rare', 4: 'epic', 5: 'legendary', 6: 'artifact', 7: 'heirloom' }
const GEAR_ROW_RE =
  /glist_icon[\s\S]*?\/\?item=(\d+)[\s\S]*?<img class="stats_rarity(\d+)" src="([^"]+)"[\s\S]*?glist_name[\s\S]*?<span class="stats_rarity\d+">([^<]+)<\/span>[\s\S]*?glist_ilvl">(\d+)/g

// The model-view .gearItem blocks carry each item's tooltip "instance id" — the handle
// the item-tooltip endpoint needs, and our change-detection key (it changes whenever the
// item's gems/enchant change). Map base item id -> instance id(s) in slot order.
const INSTANCE_RE = /class="itemToolTip[^>]*?\/\?item=(\d+)"[^>]*?\bid="(\d+)/g
export function instanceIds(html) {
  const queue = new Map()
  let m
  while ((m = INSTANCE_RE.exec(html))) {
    const arr = queue.get(m[1]) || []
    arr.push(m[2])
    queue.set(m[1], arr)
  }
  return queue
}
export const parsePcs = (html) => (html.match(/pcs=([0-9:]+)/) || [])[1] || ''

// The artifact page embeds its data as a JS literal:
//   var artifactData = [{"class":11,"powers":{…},"relics":[{"item":141274,…}],"artifactName":"…"}]
// The item tooltip only ever labels a relic socket "Relic Enhancement" with no name or
// item level, so the equipped relics' item ids can ONLY be had from here.
export function parseArtifact(html) {
  const m = html.match(/var\s+artifactData\s*=\s*(\[[\s\S]*?\]);/)
  if (!m) return null
  let data
  try {
    data = JSON.parse(m[1])
  } catch {
    return null
  }
  const a = Array.isArray(data) ? data[0] : data
  if (!a) return null
  const relics = (a.relics || [])
    .map((r) => {
      const meta = RELIC_ICONS[String(r.item)]
      if (!meta) return { id: r.item, name: null, icon: null }
      // Relic item levels on the armory are wrong too, so only name + icon are kept.
      return { id: r.item, name: meta.name, icon: meta.icon ? `${ICON_BASE}${meta.icon}.png` : null }
    })
    .filter(Boolean)
  return { artifactName: a.artifactName || null, relics }
}

export function parseGear(html) {
  const instances = instanceIds(html)
  const raw = []
  let m
  while ((m = GEAR_ROW_RE.exec(html))) {
    const id = +m[1]
    raw.push({
      id,
      quality: QUALITY_BY_RARITY[+m[2]] || 'common',
      icon: m[3],
      name: m[4].trim(),
      ilvl: +m[5],
      instanceId: (instances.get(String(id)) || []).shift() || null,
    })
  }
  // The cosmetic shirt + tabard sit between chest and wrist and would shift every
  // later slot. The shirt is always ilvl 1; the tabard is low-ilvl but identified by
  // name (e.g. "Tabard of the Kirin Tor", ilvl 75). Drop both so positions line up.
  return raw
    .filter((it) => it.ilvl > 1 && !/\btabard\b/i.test(it.name))
    .map((it, i) => ({ slot: SLOT_ORDER[i] || 'other', ...it }))
}

// Gems + enchant live in each item's tooltip, not the gear list. `i` is the item instance
// id, `pcs` the equipped set — both from the character sheet.
export async function fetchTooltip(i, realm, pcs, cookie) {
  const body = new URLSearchParams()
  body.set('ajax', 'true')
  body.set('option', 'item-tooltip/ajax')
  body.set('dataset[i]', i)
  body.set('dataset[r]', realm)
  body.set('dataset[pcs]', pcs)
  const res = await fetch(ARMORY_AJAX, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
      Cookie: cookie,
    },
    body,
  })
  if (!res.ok) throw new Error(`tooltip ${i}: HTTP ${res.status}`)
  return (await res.json()).html || ''
}
const cleanText = (s) => s.replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
export function parseTooltip(html) {
  const ench = html.match(/Enchanted:\s*([^<]+)/i)
  const enchant = ench ? cleanText(ench[1]) || null : null
  const gems = []
  const re = /class="socketImg[^"]*"\s*src="([^"]+)">([^<]*)/gi
  let m
  while ((m = re.exec(html))) gems.push({ icon: m[1], stat: cleanText(m[2]) })
  return { gems, enchant }
}
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
