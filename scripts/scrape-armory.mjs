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

import {
  getAuthCookie,
  fetchArmory,
  parseSheet,
  parseTalents,
  decodeTalents,
  parseGear,
  parseArtifact,
  parsePcs,
  fetchTooltip,
  parseTooltip,
  sleep,
  LEGENDARY_ILVL,
} from './armory.mjs'

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_KEY,
  DEFAULT_REALM = '[EN] Evermoon',
} = process.env


if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_KEY')
  process.exit(1)
}

// Talk to Supabase via its REST (PostgREST) API directly — no SDK, so this runs on
// any Node version without the realtime/WebSocket dependency.
const REST = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1`
const dbHeaders = { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` }

// PostgREST silently caps a select at 1000 rows, so this pages until a short page
// comes back. Without it the scraper only ever saw the players in the first 1000
// fights — 30 of 110 raiders were never scraped at all, and their ilvl stayed blank
// site-wide no matter how often this ran. (Same cap `getFights` pages past in store.js.)
const PAGE = 1000

async function dbSelectPlayers() {
  const rows = []
  for (let offset = 0; ; offset += PAGE) {
    const res = await fetch(`${REST}/fights?select=player,pet&order=id&offset=${offset}&limit=${PAGE}`, {
      headers: dbHeaders,
    })
    if (!res.ok) throw new Error(`select fights: HTTP ${res.status} — ${await res.text()}`)
    const page = await res.json()
    rows.push(...page)
    if (page.length < PAGE) break
  }
  // Skip pet rows (e.g. an unfolded "Water Elemental") — they aren't armory characters,
  // so scraping them just wastes a request and logs a spurious not-found error.
  return [...new Set(rows.filter((r) => !r.pet).map((r) => r.player))]
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
  wod: '[HU] Warriors of Darkness',
}
function splitPlayer(player) {
  const i = player.indexOf('-')
  if (i === -1) return { name: player, realm: DEFAULT_REALM }
  const name = player.slice(0, i)
  const slug = player.slice(i + 1).toLowerCase()
  return { name, realm: REALM_MAP[slug] || DEFAULT_REALM }
}

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
      // Legendaries come off the armory at 910 but are 895 here; fix the rows first so
      // any average computed below is built from corrected numbers.
      let fixedLegendaries = 0
      for (const g of gear) {
        if (g.quality === 'legendary' && g.ilvl !== LEGENDARY_ILVL) {
          g.ilvl = LEGENDARY_ILVL
          fixedLegendaries += 1
        }
      }
      // Tauri mis-reports Demon Hunter ilvl — compute it ourselves as the mean of equipped
      // item levels (DH dual-wields, so no 2H double-count). Other classes trust the sheet,
      // EXCEPT when a corrected legendary means the sheet's average was built from 910s.
      let ilvl = sheet.ilvl
      if (sheet.class === 'Demon Hunter' || fixedLegendaries) {
        const eq = gear.filter((g) => g.ilvl > 1)
        if (eq.length) ilvl = Math.round(eq.reduce((s, g) => s + g.ilvl, 0) / eq.length)
      }

      // Gems/enchants: reuse stored values for any item whose instance id is unchanged
      // (no tooltip request); only fetch tooltips for changed/new items, within the budget.
      const byIid = new Map()
      for (const g of existingGear.get(player.toLowerCase()) || []) {
        if (g.instanceId) byIid.set(g.instanceId, g)
      }
      // Equipped relics. The artifact's tooltip "sockets" ARE its relic slots, so they
      // must not be rendered as gems; they get attached to the artifact item instead.
      let artifact = null
      try {
        artifact = parseArtifact(await fetchArmory('character-artifact/ajax', name, realm, cookie))
      } catch { /* no artifact page (e.g. never picked one up) — not an error */ }
      if (artifact) {
        const weapon = gear.find((g) => g.quality === 'artifact')
        if (weapon) {
          weapon.artifactName = artifact.artifactName
          weapon.relics = artifact.relics
        }
      }

      const pcs = parsePcs(sheetRaw)
      let fetched = 0
      for (const it of gear) {
        if (!it.instanceId) continue
        const cached = byIid.get(it.instanceId)
        if (cached && (cached.gems !== undefined || cached.enchant !== undefined)) {
          // Drop relic sockets cached as gems by an earlier version of this script.
          it.gems = it.quality === 'artifact' ? [] : cached.gems || []
          it.enchant = cached.enchant ?? null
        } else if (tooltipBudget > 0) {
          tooltipBudget -= 1
          fetched += 1
          try {
            const t = parseTooltip(await fetchTooltip(it.instanceId, realm, pcs, cookie))
            // On an artifact those "sockets" are relic slots — kept in `relics`, not `gems`.
            it.gems = it.quality === 'artifact' ? [] : t.gems
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
      const relicNote = artifact?.relics?.length ? `, ${artifact.relics.length} relic(s)` : ''
      const legNote = fixedLegendaries ? `, ${fixedLegendaries} legendary→${LEGENDARY_ILVL}` : ''
      console.log(
        `  ✓ ${player} — ${sheet.race} ${sheet.spec} ${sheet.class}, ilvl ${ilvl}${legNote}${relicNote}${fetched ? ` (+${fetched} tooltips)` : ''}`,
      )
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
