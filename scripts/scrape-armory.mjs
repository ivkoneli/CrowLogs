// CrowLogs armory scraper — runs in CI (GitHub Action) or locally, NEVER in the browser.
//
// It logs into the Tauri armory with your own account, fetches each logged player's
// character sheet + talents, and upserts ilvl/talents/class/spec/faction into the
// Supabase `characters` table. The site then reads that cache, so page loads stay instant.
//
// Required env (set as GitHub Action repo secrets, or a local .env):
//   TAURI_COOKIE                    — your Tauri armory auth cookie. Tauri authenticates
//                                     each request off PERSISTENT credential cookies, so
//                                     use: "username=<YOU>; pasw=<hash>" (copy both from a
//                                     logged-in browser's devtools → Cookies). These don't
//                                     expire like a session — you only re-set this if you
//                                     change your Tauri password. NOTE: `pasw` is password-
//                                     equivalent; keep it in encrypted secrets only.
//   SUPABASE_URL, SUPABASE_SERVICE_KEY  — service role key (server-side only!)
//   DEFAULT_REALM                   — e.g. "[EN] Evermoon" (used when a name has no realm)
//
// Run: node scripts/scrape-armory.mjs

import 'dotenv/config' // loads .env locally; a no-op in CI (env comes from secrets)

const {
  TAURI_COOKIE,
  SUPABASE_URL,
  SUPABASE_SERVICE_KEY,
  DEFAULT_REALM = '[EN] Evermoon',
} = process.env

// The armory SPA loads data via this AJAX endpoint, returning JSON {html, callback}.
const ARMORY_AJAX = 'https://tauriwow.com/sys/mod/armory.php'

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_KEY')
  process.exit(1)
}

// Talk to Supabase via its REST (PostgREST) API directly — no SDK, so this runs on
// any Node version without the realtime/WebSocket dependency.
const REST = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1`
const dbHeaders = { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` }

async function dbSelectPlayers() {
  const res = await fetch(`${REST}/fights?select=player,pet`, { headers: dbHeaders })
  if (!res.ok) throw new Error(`select fights: HTTP ${res.status} — ${await res.text()}`)
  // Skip pet rows (e.g. an unfolded "Water Elemental") — they aren't armory characters,
  // so scraping them just wastes a request and logs a spurious not-found error.
  return [...new Set((await res.json()).filter((r) => !r.pet).map((r) => r.player))]
}

// Existing stored gear per character key — used to reuse gems/enchants for items whose
// instance id is unchanged, so we don't re-fetch ~16 tooltips per player every run.
async function dbSelectCharacters() {
  const res = await fetch(`${REST}/characters?select=key,gear`, { headers: dbHeaders })
  if (!res.ok) throw new Error(`select characters: HTTP ${res.status} — ${await res.text()}`)
  const map = new Map()
  for (const c of await res.json()) map.set(c.key, c.gear || [])
  return map
}

async function dbUpsertCharacters(rows) {
  const res = await fetch(`${REST}/characters`, {
    method: 'POST',
    headers: {
      ...dbHeaders,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(rows),
  })
  if (!res.ok) throw new Error(`upsert characters: HTTP ${res.status} — ${await res.text()}`)
}

// Split "Name-Realm" → { name, realm }. Maps a realm slug back to the armory realm
// string. Extend REALМ_MAP as you add realms.
const REALM_MAP = {
  evermoon: '[EN] Evermoon',
  tauri: '[HU] Tauri WoW Server',
  // extend to Wod realm if needed 
}
function splitPlayer(player) {
  const i = player.indexOf('-')
  if (i === -1) return { name: player, realm: DEFAULT_REALM }
  const name = player.slice(0, i)
  const slug = player.slice(i + 1).toLowerCase()
  return { name, realm: REALM_MAP[slug] || DEFAULT_REALM }
}

// ── AUTH ────────────────────────────────────────────────────────────────────
// Tauri authenticates every armory request off the persistent `username`/`pasw`
// credential cookies (a guest — or a bare tSessionId — gets an "Armory error" page).
// We send TAURI_COOKIE verbatim on each request; there's no session to keep alive and
// nothing rotates, so a single value works until you change your Tauri password.
function getAuthCookie() {
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
async function fetchArmory(option, name, realm, cookie) {
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
const CLASS_BY_ID = {
  1: 'Warrior', 2: 'Paladin', 3: 'Hunter', 4: 'Rogue', 5: 'Priest', 6: 'Death Knight',
  7: 'Shaman', 8: 'Mage', 9: 'Warlock', 10: 'Monk', 11: 'Druid', 12: 'Demon Hunter',
}
const RACE_BY_ID = {
  1: 'Human', 2: 'Orc', 3: 'Dwarf', 4: 'Night Elf', 5: 'Undead', 6: 'Tauren', 7: 'Gnome',
  8: 'Troll', 9: 'Goblin', 10: 'Blood Elf', 11: 'Draenei', 22: 'Worgen',
  24: 'Pandaren', 25: 'Pandaren', 26: 'Pandaren',
}
const stripTags = (s) => s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()

// From character-sheet HTML: { ilvl, faction, class, race, spec, level }.
function parseSheet(html) {
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
function decodeTalents(talent) {
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
function parseTalents(html, activeSpec) {
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
function instanceIds(html) {
  const queue = new Map()
  let m
  while ((m = INSTANCE_RE.exec(html))) {
    const arr = queue.get(m[1]) || []
    arr.push(m[2])
    queue.set(m[1], arr)
  }
  return queue
}
const parsePcs = (html) => (html.match(/pcs=([0-9:]+)/) || [])[1] || ''

function parseGear(html) {
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
async function fetchTooltip(i, realm, pcs, cookie) {
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
function parseTooltip(html) {
  const ench = html.match(/Enchanted:\s*([^<]+)/i)
  const enchant = ench ? cleanText(ench[1]) || null : null
  const gems = []
  const re = /class="socketImg[^"]*"\s*src="([^"]+)">([^<]*)/gi
  let m
  while ((m = re.exec(html))) gems.push({ icon: m[1], stat: cleanText(m[2]) })
  return { gems, enchant }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ── MAIN ──────────────────────────────────────────────────────────────────────
async function main() {
  const cookie = getAuthCookie()
  // Pass player name(s) as CLI args to scrape just those (handy for testing);
  // otherwise scrape everyone who has logs.
  const argPlayers = process.argv.slice(2)
  const players = argPlayers.length ? argPlayers : await dbSelectPlayers()
  console.log(`Scraping ${players.length} player(s)…`)

  const existingGear = await dbSelectCharacters() // key -> stored gear[]
  // Cap tooltip (gems/enchant) fetches per run so the first run / a mass re-gear can't
  // hammer the armory; unfetched items just fill in on a later run.
  let tooltipBudget = 400

  const rows = []
  let anyAuthed = false
  for (const player of players) {
    const { name, realm } = splitPlayer(player)
    try {
      const sheetRaw = await fetchArmory('character-sheet/ajax', name, realm, cookie)
      anyAuthed = true // a real (non-error) response proves the credentials are valid
      const talentsRaw = await fetchArmory('character-talents/ajax', name, realm, cookie)
      const sheet = parseSheet(sheetRaw)
      const { hash, specIcon } = parseTalents(talentsRaw, sheet.spec)
      const talents = decodeTalents(hash) // [{ row, col, icon }] — icons can be added later
      const gear = parseGear(sheetRaw)
      // Tauri mis-reports Demon Hunter ilvl — compute it ourselves as the mean of equipped
      // item levels (DH dual-wields, so no 2H double-count). Other classes trust the sheet.
      let ilvl = sheet.ilvl
      if (sheet.class === 'Demon Hunter') {
        const eq = gear.filter((g) => g.ilvl > 1)
        if (eq.length) ilvl = Math.round(eq.reduce((s, g) => s + g.ilvl, 0) / eq.length)
      }

      // Gems/enchants: reuse stored values for any item whose instance id is unchanged
      // (no tooltip request); only fetch tooltips for changed/new items, within the budget.
      const byIid = new Map()
      for (const g of existingGear.get(player.toLowerCase()) || []) {
        if (g.instanceId) byIid.set(g.instanceId, g)
      }
      const pcs = parsePcs(sheetRaw)
      let fetched = 0
      for (const it of gear) {
        if (!it.instanceId) continue
        const cached = byIid.get(it.instanceId)
        if (cached && (cached.gems !== undefined || cached.enchant !== undefined)) {
          it.gems = cached.gems || []
          it.enchant = cached.enchant ?? null
        } else if (tooltipBudget > 0) {
          tooltipBudget -= 1
          fetched += 1
          try {
            const t = parseTooltip(await fetchTooltip(it.instanceId, realm, pcs, cookie))
            it.gems = t.gems
            it.enchant = t.enchant
            await sleep(150) // gentle on the armory
          } catch { /* leave unset; a later run retries */ }
        }
      }

      rows.push({
        key: player.toLowerCase(),
        name: player,
        realm,
        class: sheet.class,
        spec: sheet.spec,
        race: sheet.race,
        gender: sheet.gender,
        faction: sheet.faction,
        guild: sheet.guild,
        ilvl,
        talents,
        talent_hash: hash,
        spec_icon: specIcon,
        gear,
        updated_at: new Date().toISOString(),
      })
      console.log(`  ✓ ${player} — ${sheet.race} ${sheet.spec} ${sheet.class}, ilvl ${ilvl}${fetched ? ` (+${fetched} tooltips)` : ''}`)
    } catch (e) {
      console.warn(`  ✗ ${player}: ${e.message}`)
    }
  }

  if (rows.length) {
    await dbUpsertCharacters(rows)
    console.log(`Upserted ${rows.length} character(s).`)
  }

  // If NOT ONE character authenticated, the credentials are bad (e.g. you changed your
  // Tauri password) — fail loudly so GitHub emails the repo owner. Recover by re-setting
  // the TAURI_COOKIE secret to a fresh "username=…; pasw=…" from a logged-in browser.
  if (!anyAuthed) {
    throw new Error(
      'Tauri auth failed — every character returned an armory error. Re-set the ' +
        'TAURI_COOKIE secret to a fresh "username=…; pasw=…" (copy both cookies from a ' +
        'browser logged into tauriwow.com), then re-run. See scripts/scrape-armory.mjs.',
    )
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
