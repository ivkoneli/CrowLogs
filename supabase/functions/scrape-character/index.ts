// CrowLogs — on-demand armory scraper (Supabase Edge Function, runs on Deno).
//
// The browser CANNOT scrape the Tauri armory directly (CORS + it needs the
// Supabase service key and a logged-in Tauri cookie). This function does it
// server-side: given a "Name-Realm" player, it fetches their character sheet +
// talents from the Tauri armory and upserts the result into the `characters`
// table, which the site reads. It mirrors scripts/scrape-armory.mjs.
//
// Deploy:
//   supabase functions deploy scrape-character --no-verify-jwt
// Secrets (server-side only — never shipped to the browser):
//   supabase secrets set TAURI_COOKIE="tSessionId=…" DEFAULT_REALM="[EN] Evermoon"
// (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically.)
//
// Editor note: this file runs on Deno, not Node. Install the VS Code "Deno"
// extension — .vscode/settings.json enables it for supabase/functions so the
// `Deno` global resolves and the false "cannot find name 'Deno'" errors go away.

const ARMORY_AJAX = 'https://tauriwow.com/sys/mod/armory.php'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const TAURI_COOKIE = Deno.env.get('TAURI_COOKIE') || ''
const DEFAULT_REALM = Deno.env.get('DEFAULT_REALM') || '[EN] Evermoon'

const REST = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1`
const dbHeaders = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }

// Shared, self-refreshing Tauri session cookie (kept warm by the 12h cron and
// updated here on rotation), so neither side needs a manual re-paste.
async function dbGetConfig(key: string): Promise<string | null> {
  const res = await fetch(`${REST}/app_config?key=eq.${encodeURIComponent(key)}&select=value`, {
    headers: dbHeaders,
  })
  if (!res.ok) return null
  const rows = await res.json()
  return rows[0]?.value || null
}
async function dbSetConfig(key: string, value: string) {
  await fetch(`${REST}/app_config`, {
    method: 'POST',
    headers: { ...dbHeaders, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify([{ key, value, updated_at: new Date().toISOString() }]),
  })
}
function extractSession(res: Response): string | null {
  const list = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : []
  for (const c of list) {
    const m = c.match(/tSessionId=([^;]+)/i)
    if (m && m[1] && m[1] !== 'deleted') return `tSessionId=${m[1]}`
  }
  return null
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const REALM_MAP: Record<string, string> = {
  evermoon: '[EN] Evermoon',
}
function splitPlayer(player: string) {
  const i = player.indexOf('-')
  if (i === -1) return { name: player, realm: DEFAULT_REALM }
  const name = player.slice(0, i)
  const slug = player.slice(i + 1).toLowerCase()
  return { name, realm: REALM_MAP[slug] || DEFAULT_REALM }
}

// Prefer the shared cookie kept warm in the DB; fall back to the env secret
// (and seed the DB with it) the first time.
async function sessionCookie(): Promise<string> {
  const stored = await dbGetConfig('tauri_cookie')
  if (stored) return stored
  if (TAURI_COOKIE) {
    const c = TAURI_COOKIE.includes('=') ? TAURI_COOKIE : `tSessionId=${TAURI_COOKIE}`
    await dbSetConfig('tauri_cookie', c)
    return c
  }
  throw new Error('No tauri_cookie in app_config and no TAURI_COOKIE secret to seed it.')
}

// `state` holds the live cookie; a rotated session in the response updates it.
async function fetchArmory(option: string, name: string, realm: string, state: { cookie: string }) {
  const body = new URLSearchParams()
  body.set('ajax', 'true')
  body.set('option', option)
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
    throw new Error(`${name}: armory error (session expired, or character not found)`)
  }
  return html as string
}

const CLASS_BY_ID: Record<number, string> = {
  1: 'Warrior', 2: 'Paladin', 3: 'Hunter', 4: 'Rogue', 5: 'Priest', 6: 'Death Knight',
  7: 'Shaman', 8: 'Mage', 9: 'Warlock', 10: 'Monk', 11: 'Druid', 12: 'Demon Hunter',
}
const RACE_BY_ID: Record<number, string> = {
  1: 'Human', 2: 'Orc', 3: 'Dwarf', 4: 'Night Elf', 5: 'Undead', 6: 'Tauren', 7: 'Gnome',
  8: 'Troll', 9: 'Goblin', 10: 'Blood Elf', 11: 'Draenei', 22: 'Worgen',
  24: 'Pandaren', 25: 'Pandaren', 26: 'Pandaren',
}
const stripTags = (s: string) => s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()

function parseSheet(html: string) {
  const ilvl = html.match(/(\d+)\s*ilvl/i)
  const faction = html.match(/type_(Alliance|Horde)/i)
  const guildM = html.match(/gn=([^&"]+)/i)
  const guild = guildM ? guildM[1].trim() : null
  const raceId = html.match(/RaceId\s*=\s*(\d+)/i)
  const span = html.match(/level-race-talent-class[^>]*>([\s\S]*?)<\/span>/i)
  const cls = html.match(/level-race-talent-class[^>]*color-c(\d+)/i)
  const klass = cls ? CLASS_BY_ID[+cls[1]] || null : null
  const race = raceId ? RACE_BY_ID[+raceId[1]] || null : null
  let level: number | null = null
  let spec: string | null = null
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

const TALENT_CHARSET = '0zMcmVokRsaqbdrfwihuGINALpTjnyxtgevElBCDFHJKOPQSUWXYZ1234567_89-'
const TALENT_ROWS = 7
function decodeTalents(talent: string | null) {
  const part = (talent || '').split('&')[2] || ''
  if (!part) return []
  const version = TALENT_CHARSET.indexOf(part.substr(0, 1))
  const data = part.substr(1).split('-')[0].split('|')[0]
  const cols = new Array(TALENT_ROWS).fill(0)
  for (let i = 0; i < data.length && i < Math.ceil(TALENT_ROWS / 3); i++) {
    const ch = data[i]
    let aU: number
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

function parseTalents(html: string, activeSpec: string | null) {
  let hash: string | null = null
  const tm = html.match(/var trees\s*=\s*(\[[\s\S]*?\]);/)
  if (tm) {
    try {
      const trees = JSON.parse(tm[1])
      const key = (activeSpec || '').toLowerCase().replace(/\s+/g, '')
      hash = (trees.find((t: { talent: string }) => t.talent.toLowerCase().includes(`&${key}&`)) || trees[0])?.talent || null
    } catch { /* ignore */ }
  }
  const icons: Record<string, string> = {}
  const re = /spec-image"\s*src="([^"]+)"[^>]*>\s*<div class="spec-name">([^<]+)</gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) icons[m[2].trim().toLowerCase()] = m[1]
  return { hash, specIcon: activeSpec ? icons[activeSpec.toLowerCase()] || null : null }
}

async function upsertCharacters(rows: unknown[]) {
  if (rows.length === 0) return
  const res = await fetch(`${REST}/characters`, {
    method: 'POST',
    headers: {
      ...dbHeaders,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(rows),
  })
  if (!res.ok) throw new Error(`upsert: HTTP ${res.status} — ${await res.text()}`)
}

// Scrape one "Name-Realm" character into a `characters` row.
async function scrapeOne(player: string, state: { cookie: string }) {
  const { name, realm } = splitPlayer(player)
  const sheetRaw = await fetchArmory('character-sheet/ajax', name, realm, state)
  const talentsRaw = await fetchArmory('character-talents/ajax', name, realm, state)
  const sheet = parseSheet(sheetRaw)
  const { hash, specIcon } = parseTalents(talentsRaw, sheet.spec)
  const talents = decodeTalents(hash)
  return {
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
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })

  try {
    const body = await req.json().catch(() => ({}))
    // Accept a single { player } (the Update button) or { players: [...] } (import).
    const players: string[] = Array.isArray(body.players)
      ? body.players.filter((p: unknown) => typeof p === 'string')
      : typeof body.player === 'string'
        ? [body.player]
        : []
    if (players.length === 0) {
      return json({ error: 'Provide a "player" name or "players" array.' }, 400)
    }

    const state = { cookie: await sessionCookie() }
    const updated: unknown[] = []
    const failed: { player: string; error: string }[] = []
    for (const p of players) {
      try {
        updated.push(await scrapeOne(p, state))
      } catch (e) {
        failed.push({ player: p, error: (e as Error).message })
      }
    }
    await upsertCharacters(updated)
    // Persist any refreshed session so the cookie stays alive without re-pasting.
    await dbSetConfig('tauri_cookie', state.cookie)
    return json({ updated, failed })
  } catch (e) {
    return json({ error: (e as Error).message }, 500)
  }
})
