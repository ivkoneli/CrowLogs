// CrowLogs Mythic+ scraper — runs in CI (GitHub Action, hourly) or locally, NEVER in the browser.
//
// Tauri's official API (chapi.tauri.hu, `challenge-leaderboard`) returns EVERY timed/depleted
// key on a dungeon's board in one call (~7k runs, ~16 MB of JSON), each with its exact
// completion time and every member's spec, realm and guild. Finding one player there means
// downloading every board, so instead we mirror all of them into the Supabase `mplus_runs`
// table and the profile page looks a player up by the indexed `members` array.
//
// Incremental: the first run (empty table, or MPLUS_FULL=1) inserts everything. After that
// only runs completed since the newest stored day (minus one day of slack) are sent, and
// existing ids are left untouched (ignore-duplicates), so `first_seen` keeps the time the
// run was first scraped.
//
// Required env (GitHub repo secrets, or a local .env):
//   TAURI_API_KEY, TAURI_API_SECRET    — from tauriwow.com/account → API
//   SUPABASE_URL, SUPABASE_SERVICE_KEY — service role key (server-side only!)
// Optional:
//   MPLUS_REALMS — comma-separated leaderboards to mirror (default: every board in
//                  MPLUS_BOARDS — Evermoon+Tauri share one, Warriors of Darkness has its own)
//   MPLUS_FULL=1 — re-send every run, not just recent days (backfill / repair). Existing
//                  runs are UPDATED too, and runs the board no longer lists are pruned.
//
// Run: node scripts/scrape-mythic-plus.mjs

import 'dotenv/config'
import { createHash } from 'node:crypto'
import { MPLUS_DUNGEONS, MPLUS_BOARDS } from '../src/lib/mplusDungeons.js'

const { SUPABASE_URL, SUPABASE_SERVICE_KEY, MPLUS_FULL } = process.env
// Pasted secrets often carry a stray newline, space or quotes; the API rejects any of them.
const clean = (v) => (v || '').trim().replace(/^["']|["']$/g, '').trim()
const TAURI_API_KEY = clean(process.env.TAURI_API_KEY)
const TAURI_API_SECRET = clean(process.env.TAURI_API_SECRET)
// Boards, not realms: DEFAULT_REALM (set for the armory scraper) is deliberately ignored
// here, or the Warriors of Darkness board would silently never be mirrored.
const REALMS = (process.env.MPLUS_REALMS || MPLUS_BOARDS.join(','))
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

const TAURI_API = 'http://chapi.tauri.hu/apiIndex.php'
const ICON_URL = 'https://legion-static.tauri.hu/images/icons/large'
const CONCURRENCY = 3 // boards fetched at once — gentle on Tauri
const BATCH = 500 // rows per Supabase insert

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_KEY')
  process.exit(1)
}
if (!TAURI_API_KEY || !TAURI_API_SECRET) {
  console.error('Missing TAURI_API_KEY / TAURI_API_SECRET (tauriwow.com/account → API).')
  process.exit(1)
}

const REST = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1`
const dbHeaders = { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` }

const CLASS_BY_ID = {
  1: 'Warrior', 2: 'Paladin', 3: 'Hunter', 4: 'Rogue', 5: 'Priest', 6: 'Death Knight',
  7: 'Shaman', 8: 'Mage', 9: 'Warlock', 10: 'Monk', 11: 'Druid', 12: 'Demon Hunter',
}
const ROLE_BY_ID = { 0: 'tank', 1: 'healer', 2: 'dps' }
const ROLE_ORDER = { tank: 0, healer: 1, dps: 2 }

// ── FETCH ───────────────────────────────────────────────────────────────────
// The API takes a URL-encoded JSON body { secret, url: <method>, params } and answers
// { success, errorcode, errorstring, response }.
async function tauriApi(method, params, what) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(`${TAURI_API}?apikey=${encodeURIComponent(TAURI_API_KEY)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: encodeURIComponent(JSON.stringify({ secret: TAURI_API_SECRET, url: method, params })),
      })
      const text = await res.text()
      let json = null
      try {
        json = JSON.parse(text)
      } catch {
        /* not JSON: reported below */
      }
      // errorcode 2 = "invalid authentication data": the key/secret are wrong, retrying won't help.
      if (json?.errorcode === 2) {
        const err = new Error(`${what}: ${json.errorstring} (check TAURI_API_KEY / TAURI_API_SECRET)`)
        err.fatal = true
        throw err
      }
      if (!res.ok || !json?.success) throw new Error(`HTTP ${res.status} — ${json?.errorstring || text.slice(0, 200)}`)
      return json.response
    } catch (e) {
      if (e.fatal) throw e
      if (attempt >= 3) throw new Error(`${what}: ${e.message}`)
      await new Promise((r) => setTimeout(r, 2000 * attempt))
    }
  }
}

const fetchBoard = async (realm, mapId) =>
  (await tauriApi('challenge-leaderboard', { r: realm, id: mapId }, `board ${mapId}`)).challengesdata || []

// ── PARSE ───────────────────────────────────────────────────────────────────
// The armory dates a run by the server's day (Budapest), and run ids were built from that
// day before we used the API — keep it so existing rows keep their ids.
const DAY_FMT = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Budapest', year: 'numeric', month: '2-digit', day: '2-digit' })
function serverDay(ts) {
  const p = Object.fromEntries(DAY_FMT.formatToParts(new Date(ts * 1000)).map((x) => [x.type, x.value]))
  return `${p.year}-${p.month}-${p.day}`
}

function runId(r) {
  const party = r.party.map((p) => p.name.toLowerCase()).sort().join(',')
  const raw = [r.realm, r.map_id, r.day, r.level, r.time_ms, party].join('|')
  return createHash('sha1').update(raw).digest('hex')
}

// API run → mplus_runs row. Members without playerinfo are deleted characters; the armory
// left them out too (and so did the ids). Returns null for a run with nobody left.
function toRun(api, realm, dungeon) {
  const party = (api.players || [])
    .filter((p) => p.playerinfo?.charname)
    .map((p) => ({
      name: p.playerinfo.charname.trim(),
      // A board can mix realms (Evermoon + Tauri share one), so each member keeps their own.
      realm: p.playerinfo.realm || realm,
      class: CLASS_BY_ID[p.playerinfo.class] || null,
      role: ROLE_BY_ID[p.specializationrole] || 'dps',
      spec: p.specializationname || null,
      guild: p.playerinfo.guildname?.trim() || null, // for sync_mplus_guilds; not stored
    }))
    .sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role])
  if (!party.length || !api.completedtime || !Number.isFinite(api.level)) return null

  const run = {
    realm,
    map_id: dungeon.id,
    dungeon: dungeon.name,
    level: api.level,
    time_ms: api.completiontime || null,
    medal: api.medal || 0,
    affixes: (api.affixes || []).filter((a) => a.id && a.icon).map((a) => ({ name: a.name, icon: `${ICON_URL}/${a.icon}.png` })),
    party,
    members: party.map((p) => p.name.toLowerCase()),
    day: serverDay(api.completedtime),
    completed_at: new Date(api.completedtime * 1000).toISOString(),
    specs_matched: party.every((p) => p.spec),
  }
  run.id = runId(run)
  return run
}

// The row as stored: everything but the members' guilds (those go to mplus_guilds).
const stored = (run) => ({ ...run, party: run.party.map(({ guild: _guild, ...p }) => p) })

// ── DB ──────────────────────────────────────────────────────────────────────
async function latestDay(realm) {
  const q = new URLSearchParams({ select: 'day', realm: `eq.${realm}`, order: 'day.desc', limit: '1' })
  const res = await fetch(`${REST}/mplus_runs?${q}`, { headers: dbHeaders })
  if (!res.ok) throw new Error(`latest day: HTTP ${res.status} — ${await res.text()}`)
  return (await res.json())[0]?.day || null
}

// Database writes run ONE AT A TIME even though boards download in parallel: every insert
// fires the mplus_players trigger, and the same players appear in several dungeons, so two
// concurrent inserts can lock those player rows in opposite orders and deadlock (Postgres
// 40P01 — it killed whole dungeons' inserts in the hourly runs on 2026-10-08).
let writeChain = Promise.resolve()
function serialWrite(fn) {
  const run = writeChain.then(fn, fn)
  writeChain = run.catch(() => {})
  return run
}

// POST to PostgREST, retrying a deadlock (40P01) a few times with a short backoff.
async function postWithRetry(url, init, what) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, init)
    if (res.ok) return res
    const body = await res.text()
    if (attempt < 4 && body.includes('40P01')) {
      await new Promise((r) => setTimeout(r, 500 * attempt))
      continue
    }
    throw new Error(`${what}: HTTP ${res.status} — ${body}`)
  }
}

// Insert new runs only (existing ids are skipped); returns how many were actually new.
async function insertRuns(rows) {
  return serialWrite(async () => {
    let inserted = 0
    for (let i = 0; i < rows.length; i += BATCH) {
      const res = await postWithRetry(
        `${REST}/mplus_runs?on_conflict=id&select=id`,
        {
          method: 'POST',
          headers: {
            ...dbHeaders,
            'Content-Type': 'application/json',
            Prefer: 'resolution=ignore-duplicates,return=representation',
          },
          body: JSON.stringify(rows.slice(i, i + BATCH)),
        },
        'insert mplus_runs',
      )
      inserted += (await res.json()).length
    }
    return inserted
  })
}

// Full-row upsert that UPDATES existing runs. first_seen is never sent, so an update keeps
// it and the player-index insert trigger doesn't fire.
async function updateRuns(rows) {
  return serialWrite(async () => {
    for (let i = 0; i < rows.length; i += BATCH) {
      await postWithRetry(
        `${REST}/mplus_runs?on_conflict=id`,
        {
          method: 'POST',
          headers: {
            ...dbHeaders,
            'Content-Type': 'application/json',
            Prefer: 'resolution=merge-duplicates,return=minimal',
          },
          body: JSON.stringify(rows.slice(i, i + BATCH)),
        },
        'update mplus_runs',
      )
    }
  })
}

// Ids of stored runs still missing their specs or exact time (stored before the API was
// used, or a member's spec was unknown then).
async function pendingIds(realm) {
  const out = new Set()
  for (let offset = 0; ; offset += 1000) {
    const q = new URLSearchParams({
      select: 'id',
      realm: `eq.${realm}`,
      or: '(specs_matched.eq.false,completed_at.is.null)',
      order: 'id',
      offset: String(offset),
      limit: '1000',
    })
    const res = await fetch(`${REST}/mplus_runs?${q}`, { headers: dbHeaders })
    if (!res.ok) throw new Error(`pending: HTTP ${res.status} — ${await res.text()}`)
    const page = await res.json()
    page.forEach((r) => out.add(r.id))
    if (page.length < 1000) break
  }
  return out
}

// Call a Postgres function through PostgREST (service role); returns its JSON result.
async function rpc(fn, args = {}) {
  const res = await fetch(`${REST}/rpc/${fn}`, {
    method: 'POST',
    headers: { ...dbHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  })
  if (!res.ok) throw new Error(`${fn}: HTTP ${res.status} — ${await res.text()}`)
  const text = await res.text()
  return text ? JSON.parse(text) : null
}

// Run `fn` over `items` with at most `n` in flight.
async function pool(items, n, fn) {
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) await fn(items[next++])
    }),
  )
}

// Tauri being down: a 5xx, an HTML error page where JSON was expected, or no connection.
const isOutage = (e) => /HTTP 5\d\d|Bad Gateway|Unexpected token '?<|ECONNREFUSED|ETIMEDOUT|fetch failed|Failed to connect/i.test(e?.message || '')

// ── MAIN ────────────────────────────────────────────────────────────────────
async function main() {
  let failed = false
  let incomplete = false // some board was skipped because Tauri was down
  const guilds = new Map() // "realm|name" → { realm, name, guild }, from every board
  for (const realm of REALMS) {
    const latest = MPLUS_FULL === '1' ? null : await latestDay(realm)
    // One day of slack: a run finished just before midnight may land after the last scrape.
    const cutoff = latest
      ? new Date(Date.parse(`${latest}T00:00:00Z`) - 86400000).toISOString().slice(0, 10)
      : null
    console.log(`\n${realm}: ${cutoff ? `incremental, runs since ${cutoff}` : 'full backfill'}`)

    // Stored runs still missing specs / exact time: filled from the boards in the same pass.
    let pending = new Set()
    try {
      pending = await pendingIds(realm)
    } catch (e) {
      failed = true
      console.error(`  pending: ${e.message}`)
    }

    let seen = 0
    let sent = 0
    let added = 0
    let stale = 0
    let filled = 0
    await pool(MPLUS_DUNGEONS, CONCURRENCY, async (dungeon) => {
      try {
        // The same id twice in one insert makes Postgres reject the whole batch.
        const board = [...new Map((await fetchBoard(realm, dungeon.id)).map((r) => toRun(r, realm, dungeon)).filter(Boolean).map((r) => [r.id, r])).values()]
        for (const r of board) {
          for (const p of r.party) if (p.guild) guilds.set(`${p.realm}|${p.name.toLowerCase()}`, { realm: p.realm, name: p.name, guild: p.guild })
        }
        const fresh = board.filter((r) => !cutoff || r.day >= cutoff).map(stored)
        const n = fresh.length ? await insertRuns(fresh) : 0
        if (MPLUS_FULL === '1') {
          // A full run rewrites the runs that already existed too (specs, member realms,
          // exact times); `first_seen` is never sent, so it's kept…
          if (fresh.length) await updateRuns(fresh)
          // …and drops stored runs the board no longer lists (renamed/deleted characters
          // give a run a new id; see prune_mplus_runs in schema.sql). `fresh` is the whole
          // board here: a full run has no day cutoff. Never prune against an empty board.
          if (fresh.length) {
            // Awaited into a local first: dungeons run concurrently, and `stale += await …`
            // would read the total before the wait and drop the other dungeons' counts.
            const pruned = await serialWrite(() => rpc('prune_mplus_runs', { p_realm: realm, p_map: dungeon.id, p_keep: fresh.map((r) => r.id) }))
            stale += pruned
          }
        } else {
          // Stored runs the board now has full data for (the insert above skips existing ids).
          const fill = board.filter((r) => pending.has(r.id)).map(stored)
          if (fill.length) await updateRuns(fill)
          filled += fill.length
        }
        seen += board.length
        sent += fresh.length
        added += n
        console.log(`  ${dungeon.name.padEnd(22)} ${String(board.length).padStart(6)} on board, ${String(n).padStart(5)} new`)
      } catch (e) {
        // A Tauri outage (5xx / an HTML error page / no connection) isn't our failure: the
        // board is just skipped this hour. Anything else fails the run loudly.
        if (isOutage(e)) incomplete = true
        else failed = true
        console.error(`  ${dungeon.name}: ${e.message}`)
      }
    })
    console.log(
      `  total: ${seen} on boards, ${sent} checked, ${added} new` +
        (MPLUS_FULL === '1' ? `, ${stale} stale removed` : `, ${filled} older runs filled in (specs/exact time)`),
    )
    // Every board parsing to nothing means the API changed, not that nobody played —
    // unless Tauri was down. Then stop quietly WITHOUT refreshing: mplus_status keeps its
    // old time, so dispatch_mplus_scrape() emails once if the outage passes 3 h.
    if (seen === 0 && incomplete && !failed) {
      console.warn('Tauri unavailable, skipping this run.')
      return
    }
    if (seen === 0) {
      failed = true
      console.error('  no runs from any board — has the API response changed?')
    }
  }

  // Guilds (every member's current one, from the boards) → mplus_guilds. Only after a clean
  // pass over EVERY board: sync_mplus_guilds drops everyone not listed, so a failed or
  // skipped board (MPLUS_REALMS) would wipe that board's guilds.
  const allBoards = MPLUS_BOARDS.every((b) => REALMS.includes(b))
  if (!failed && !incomplete && allBoards && guilds.size) {
    try {
      const n = await rpc('sync_mplus_guilds', { p: [...guilds.values()] })
      console.log(`guilds: ${n} players in a guild`)
    } catch (e) {
      console.warn(`guilds: ${e.message}`)
    }
  }

  // Once every board is in: after a full run the player search index is rebuilt (pruned
  // and re-keyed runs change who exists), then the score table the profile rankings read.
  // A failure leaves the previous index/scores in place.
  for (const fn of MPLUS_FULL === '1' ? ['rebuild_mplus_players', 'refresh_mplus_scores'] : ['refresh_mplus_scores']) {
    try {
      await rpc(fn)
      console.log(`${fn}: done`)
    } catch (e) {
      failed = true
      console.error(`${fn}: ${e.message}`)
    }
  }
  // Fail loudly (GitHub emails the owner) instead of silently leaving the mirror stale.
  if (failed) process.exit(1)
}

await main()
