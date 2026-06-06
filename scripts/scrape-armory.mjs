// CrowLogs armory scraper — runs in CI (GitHub Action) or locally, NEVER in the browser.
//
// It logs into the Tauri armory with your own account, fetches each logged player's
// character sheet + talents, and upserts ilvl/talents/class/spec/faction into the
// Supabase `characters` table. The site then reads that cache, so page loads stay instant.
//
// Required env (set as GitHub Action repo secrets, or a local .env):
//   TAURI_USER, TAURI_PASS          — your Tauri account (or use TAURI_COOKIE instead)
//   TAURI_COOKIE                    — optional: a captured logged-in session cookie
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
  const res = await fetch(`${REST}/fights?select=player`, { headers: dbHeaders })
  if (!res.ok) throw new Error(`select fights: HTTP ${res.status} — ${await res.text()}`)
  return [...new Set((await res.json()).map((r) => r.player))]
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

// Shared key/value config in Supabase (e.g. the live Tauri session cookie),
// so the cron and the on-demand edge function use ONE self-refreshing session.
async function dbGetConfig(key) {
  const res = await fetch(`${REST}/app_config?key=eq.${encodeURIComponent(key)}&select=value`, {
    headers: dbHeaders,
  })
  if (!res.ok) return null
  const rows = await res.json()
  return rows[0]?.value || null
}
async function dbSetConfig(key, value) {
  await fetch(`${REST}/app_config`, {
    method: 'POST',
    headers: { ...dbHeaders, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify([{ key, value, updated_at: new Date().toISOString() }]),
  })
}

// If the armory rotates the session, the response carries a fresh tSessionId.
function extractSession(res) {
  const list = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : []
  for (const c of list) {
    const m = c.match(/tSessionId=([^;]+)/i)
    if (m && m[1] && m[1] !== 'deleted') return `tSessionId=${m[1]}`
  }
  return null
}

// Split "Name-Realm" → { name, realm }. Maps a realm slug back to the armory realm
// string. Extend REALМ_MAP as you add realms.
const REALM_MAP = {
  evermoon: '[EN] Evermoon',
  // tauri: '[EN] Tauri WoW', etc.
}
function splitPlayer(player) {
  const i = player.indexOf('-')
  if (i === -1) return { name: player, realm: DEFAULT_REALM }
  const name = player.slice(0, i)
  const slug = player.slice(i + 1).toLowerCase()
  return { name, realm: REALM_MAP[slug] || DEFAULT_REALM }
}

// ── AUTH ────────────────────────────────────────────────────────────────────
// Viewing a character requires a LOGGED-IN tSessionId cookie (a guest session
// returns an "Armory error" page). Provide it via TAURI_COOKIE, e.g.
//   TAURI_COOKIE="tSessionId=<value-from-your-logged-in-browser>"
// Note: sessions expire (~24h), so for the daily cron we'll likely move to a
// username/password login handshake — captured separately — to mint a fresh one.
// Prefer the shared cookie kept warm in the DB; fall back to the env secret
// (and seed the DB with it) the first time.
async function getSessionCookie() {
  const stored = await dbGetConfig('tauri_cookie')
  if (stored) return stored
  if (TAURI_COOKIE) {
    const c = TAURI_COOKIE.includes('=') ? TAURI_COOKIE : `tSessionId=${TAURI_COOKIE}`
    await dbSetConfig('tauri_cookie', c)
    return c
  }
  throw new Error('No tauri_cookie in app_config and no TAURI_COOKIE env to seed it.')
}

// ── FETCH ───────────────────────────────────────────────────────────────────
// Returns the inner rendered HTML for a character page (sheet/talents/…).
// `state` holds the live cookie; a rotated session in the response updates it.
async function fetchArmory(option, name, realm, state) {
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
      Cookie: state.cookie,
    },
    body,
  })
  if (!res.ok) throw new Error(`${option} ${name}: HTTP ${res.status}`)
  const rotated = extractSession(res)
  if (rotated) state.cookie = rotated
  const json = await res.json()
  const html = json.html || ''
  if (html.includes('armory-errorpage')) {
    throw new Error(`${name}: armory error (not logged in, or character not found)`)
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
  return { ilvl: ilvl ? +ilvl[1] : null, faction: faction ? faction[1] : null, guild, class: klass, race, spec, level }
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
  const data = part.substr(1).split('-')[0].split('|')[0] // drop glyph/honor suffixes
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

// ── MAIN ──────────────────────────────────────────────────────────────────────
async function main() {
  const state = { cookie: await getSessionCookie() }
  // Pass player name(s) as CLI args to scrape just those (handy for testing);
  // otherwise scrape everyone who has logs.
  const argPlayers = process.argv.slice(2)
  const players = argPlayers.length ? argPlayers : await dbSelectPlayers()
  console.log(`Scraping ${players.length} player(s)…`)

  const rows = []
  for (const player of players) {
    const { name, realm } = splitPlayer(player)
    try {
      const sheetRaw = await fetchArmory('character-sheet/ajax', name, realm, state)
      const talentsRaw = await fetchArmory('character-talents/ajax', name, realm, state)
      const sheet = parseSheet(sheetRaw)
      const { hash, specIcon } = parseTalents(talentsRaw, sheet.spec)
      const talents = decodeTalents(hash) // [{ row, col, icon }] — icons can be added later
      rows.push({
        key: player.toLowerCase(),
        name: player,
        realm,
        class: sheet.class,
        spec: sheet.spec,
        faction: sheet.faction,
        guild: sheet.guild,
        ilvl: sheet.ilvl,
        talents,
        talent_hash: hash,
        spec_icon: specIcon,
        updated_at: new Date().toISOString(),
      })
      console.log(`  ✓ ${player} — ${sheet.race} ${sheet.spec} ${sheet.class}, ilvl ${sheet.ilvl}`)
    } catch (e) {
      console.warn(`  ✗ ${player}: ${e.message}`)
    }
  }

  if (rows.length) {
    await dbUpsertCharacters(rows)
    console.log(`Upserted ${rows.length} character(s).`)
  }

  // Persist the (possibly refreshed) session so the next run — and the on-demand
  // edge function — keep using a live cookie. This is what avoids manual re-pasting.
  if (state.cookie) await dbSetConfig('tauri_cookie', state.cookie)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
