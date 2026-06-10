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
//   supabase secrets set TAURI_COOKIE="username=…; pasw=…" DEFAULT_REALM="[EN] Evermoon"
// Tauri authenticates off the persistent `username`/`pasw` cookies (not the session),
// so this value is static — re-set it only when you change your Tauri password.
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

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// This endpoint is public (--no-verify-jwt) and makes outbound armory calls with YOUR
// Tauri cookie (each character = sheet + talents + ~16 tooltip fetches). Without limits
// a few requests could hammer Tauri into rate-limiting/banning your account and burn the
// function quota. Cap the batch + throttle per IP (in-memory, best-effort).
const MAX_PLAYERS = 40
const RATE_MAX = 10
const RATE_WINDOW_MS = 60_000 // 10 requests/minute per IP
const hits = new Map<string, number[]>()
function rateLimited(ip: string): boolean {
  const now = Date.now()
  const arr = (hits.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS)
  arr.push(now)
  hits.set(ip, arr)
  return arr.length > RATE_MAX
}
const clientIp = (req: Request) =>
  req.headers.get('x-forwarded-for')?.split(',')[0].trim() || req.headers.get('cf-connecting-ip') || 'unknown'

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

// Tauri authenticates each request off the persistent `username`/`pasw` credential
// cookies (set as the TAURI_COOKIE secret). It's static — sent verbatim every time.
function authCookie(): string {
  if (!TAURI_COOKIE) throw new Error('Missing TAURI_COOKIE secret (expected "username=…; pasw=…").')
  return TAURI_COOKIE
}

// Returns the inner rendered HTML for a character page. The auth cookie is sent
// verbatim every time — nothing to rotate or persist.
async function fetchArmory(option: string, name: string, realm: string, cookie: string) {
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
  const genderM = html.match(/\bgender\s*=\s*["']?([012])/i) // 0 male, 1 female
  const gender = genderM ? +genderM[1] : null
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
  return { ilvl: ilvl ? +ilvl[1] : null, faction: faction ? faction[1] : null, guild, class: klass, race, gender, spec, level }
}

const TALENT_CHARSET = '0zMcmVokRsaqbdrfwihuGINALpTjnyxtgevElBCDFHJKOPQSUWXYZ1234567_89-'
const TALENT_ROWS = 7
function decodeTalents(talent: string | null) {
  const part = (talent || '').split('&')[2] || ''
  if (!part) return []
  const version = TALENT_CHARSET.indexOf(part.substr(0, 1))
  // '|' separates an optional suffix; do NOT split on '-' — it's a valid charset
  // character (value 63), so splitting on it truncated builds that encode to a '-'.
  const data = part.substr(1).split('|')[0]
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

// Equipped gear from the character sheet's gear_list_table (mirrors the CI scraper).
// Items come in slot order; the two trinkets are what the meter shows.
const SLOT_ORDER = [
  'head', 'neck', 'shoulder', 'back', 'chest', 'wrist', 'hands', 'waist',
  'legs', 'feet', 'finger', 'finger', 'trinket', 'trinket', 'mainhand', 'offhand',
]
const QUALITY_BY_RARITY: Record<number, string> = { 1: 'common', 2: 'uncommon', 3: 'rare', 4: 'epic', 5: 'legendary', 6: 'artifact', 7: 'heirloom' }

type Gem = { icon: string; stat: string }
type GearItem = {
  slot: string; id: number; quality: string; icon: string; name: string; ilvl: number
  // `instanceId` is internal (used to fetch the per-item tooltip) and stripped before
  // storage; gems/enchant are filled from that tooltip (see scrapeOne).
  instanceId: string | null; gems?: Gem[]; enchant?: string | null
}

const GEAR_ROW_RE =
  /glist_icon[\s\S]*?\/\?item=(\d+)[\s\S]*?<img class="stats_rarity(\d+)" src="([^"]+)"[\s\S]*?glist_name[\s\S]*?<span class="stats_rarity\d+">([^<]+)<\/span>[\s\S]*?glist_ilvl">(\d+)/g

// The model-view .gearItem blocks carry, per item, the tooltip "instance id" — the
// handle the item-tooltip endpoint needs to return that item's socketed gems + applied
// enchant (the gear_list_table only has the base item). Map base item id -> instance
// id(s) in slot order; duplicates (e.g. two identical rings) are popped in order.
const INSTANCE_RE = /class="itemToolTip[^>]*?\/\?item=(\d+)"[^>]*?\bid="(\d+)/g
function instanceIds(html: string) {
  const queue = new Map<string, string[]>()
  let m: RegExpExecArray | null
  while ((m = INSTANCE_RE.exec(html))) {
    const arr = queue.get(m[1]) || []
    arr.push(m[2])
    queue.set(m[1], arr)
  }
  return queue
}
// The full equipped set (colon-joined item ids), shared by every tooltip request for
// set-bonus lines. Same value for all items on the sheet.
function parsePcs(html: string) {
  const m = html.match(/pcs=([0-9:]+)/)
  return m ? m[1] : ''
}

function parseGear(html: string): GearItem[] {
  const instances = instanceIds(html)
  const raw: GearItem[] = []
  let m: RegExpExecArray | null
  while ((m = GEAR_ROW_RE.exec(html))) {
    const id = +m[1]
    raw.push({
      slot: 'other', id, quality: QUALITY_BY_RARITY[+m[2]] || 'common',
      icon: m[3], name: m[4].trim(), ilvl: +m[5],
      instanceId: instances.get(String(id))?.shift() || null,
    })
  }
  // Drop the cosmetic shirt (always ilvl 1) + tabard (low ilvl, matched by name) so
  // the remaining items line up with SLOT_ORDER (otherwise a ring lands in a trinket slot).
  return raw
    .filter((it) => it.ilvl > 1 && !/\btabard\b/i.test(it.name))
    .map((it, i) => ({ ...it, slot: SLOT_ORDER[i] || 'other' }))
}

// Fetch one equipped item's rendered tooltip (option item-tooltip/ajax). `i` is the
// item's instance id, `pcs` the equipped set — both from the character sheet.
async function fetchTooltip(i: string, realm: string, pcs: string, cookie: string) {
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
  const json = await res.json()
  return (json.html || '') as string
}

const cleanText = (s: string) => s.replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()

// Pull gems + enchant out of an item tooltip. Enchant is the "Enchanted: <stat>" line;
// gems are <img class="socketImg …"> followed by the gem's stat text. The item's own
// "Socket bonus:" line is a bonusGreen span (no socketImg), so it isn't mistaken for a gem.
function parseTooltip(html: string): { gems: Gem[]; enchant: string | null } {
  const ench = html.match(/Enchanted:\s*([^<]+)/i)
  const enchant = ench ? cleanText(ench[1]) || null : null
  const gems: Gem[] = []
  const re = /class="socketImg[^"]*"\s*src="([^"]+)">([^<]*)/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) gems.push({ icon: m[1], stat: cleanText(m[2]) })
  return { gems, enchant }
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
async function scrapeOne(player: string, cookie: string) {
  const { name, realm } = splitPlayer(player)
  const sheetRaw = await fetchArmory('character-sheet/ajax', name, realm, cookie)
  const talentsRaw = await fetchArmory('character-talents/ajax', name, realm, cookie)
  const sheet = parseSheet(sheetRaw)
  const { hash, specIcon } = parseTalents(talentsRaw, sheet.spec)
  const talents = decodeTalents(hash)
  const gear = parseGear(sheetRaw)
  // Gems/enchants live only in each item's tooltip — one extra request per equipped
  // item. We do this on the on-demand "Update profile" path (here), NOT in the nightly
  // CI scrape (scrape-armory.mjs), so the batch run stays light. A failed tooltip just
  // leaves that item's gems/enchant unset.
  const pcs = parsePcs(sheetRaw)
  await Promise.all(
    gear.map(async (it) => {
      if (!it.instanceId) return
      try {
        const { gems, enchant } = parseTooltip(await fetchTooltip(it.instanceId, realm, pcs, cookie))
        it.gems = gems
        it.enchant = enchant
      } catch { /* tooltip fetch/parse failed — leave gems/enchant unset */ }
    }),
  )
  gear.forEach((it) => delete (it as Partial<GearItem>).instanceId)
  // Tauri's armory mis-reports Demon Hunter ilvl, so compute it ourselves: the mean of
  // equipped item levels (DH dual-wields, so there's no 2H double-count to worry about).
  let ilvl = sheet.ilvl
  if (sheet.class === 'Demon Hunter') {
    const eq = gear.filter((g) => g.ilvl > 1)
    if (eq.length) ilvl = Math.round(eq.reduce((s, g) => s + g.ilvl, 0) / eq.length)
  }
  return {
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
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })

  if (rateLimited(clientIp(req))) return json({ error: 'Rate limit exceeded. Try again shortly.' }, 429)

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
    if (players.length > MAX_PLAYERS) {
      return json({ error: `Too many players (max ${MAX_PLAYERS}).` }, 413)
    }

    const cookie = authCookie()
    const updated: unknown[] = []
    const failed: { player: string; error: string }[] = []
    for (const p of players) {
      try {
        updated.push(await scrapeOne(p, cookie))
      } catch (e) {
        failed.push({ player: p, error: (e as Error).message })
      }
    }
    await upsertCharacters(updated)
    return json({ updated, failed })
  } catch (e) {
    return json({ error: (e as Error).message }, 500)
  }
})
