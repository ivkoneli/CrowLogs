// CrowLogs Mythic+ scraper — runs in CI (GitHub Action, hourly) or locally, NEVER in the browser.
//
// Tauri's armory "Challenge Mode" leaderboards hold EVERY timed/depleted key, but only as
// one page per dungeon: the pager on the site is client-side, so a single request returns
// the whole board (~5k rows, ~20 MB of HTML). Finding one player there means downloading
// every board, so instead we mirror all of them into the Supabase `mplus_runs` table and
// the profile page looks a player up by the indexed `members` array.
//
// Incremental: the first run (empty table, or MPLUS_FULL=1) inserts everything. After that
// only runs completed since the newest stored day (minus one day of slack) are sent, and
// existing ids are left untouched (ignore-duplicates), so `first_seen` keeps the time the
// run was first scraped — that orders same-day runs, since Tauri only reports the day.
//
// Required env (GitHub repo secrets, or a local .env):
//   TAURI_COOKIE                       — "username=…; pasw=…" (same as scrape-armory.mjs)
//   SUPABASE_URL, SUPABASE_SERVICE_KEY — service role key (server-side only!)
// Optional:
//   MPLUS_REALMS — comma-separated armory realms (default: DEFAULT_REALM or "[EN] Evermoon")
//   MPLUS_FULL=1 — re-send every run, not just recent days (backfill / repair)
//
// Run: node scripts/scrape-mythic-plus.mjs

import 'dotenv/config'
import { createHash } from 'node:crypto'
import { MPLUS_DUNGEONS, DEFAULT_MPLUS_REALM } from '../src/lib/mplusDungeons.js'
import { specsOf } from '../src/lib/classes.js'

// Tauri's leaderboard has no spec, but tauriachievements.github.io publishes every run
// with each member's spec (refreshed about once a day). Specs are matched from there.
const TA_DATA = 'https://tauriachievements.github.io/mythic-plus-data'

const { TAURI_COOKIE, SUPABASE_URL, SUPABASE_SERVICE_KEY, DEFAULT_REALM, MPLUS_FULL } = process.env
const REALMS = (process.env.MPLUS_REALMS || DEFAULT_REALM || DEFAULT_MPLUS_REALM)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

const ARMORY_AJAX = 'https://tauriwow.com/sys/mod/armory.php'
const CONCURRENCY = 3 // boards fetched at once — gentle on Tauri, still ~10 s total
const BATCH = 500 // rows per Supabase insert

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_KEY')
  process.exit(1)
}
if (!TAURI_COOKIE) {
  console.error('Missing TAURI_COOKIE (expected "username=…; pasw=…").')
  process.exit(1)
}
// Same newline-tolerant cookie cleanup as scrape-armory.mjs.
const COOKIE = TAURI_COOKIE.split(/[\r\n]+/)
  .map((line) => line.trim().replace(/;+$/, ''))
  .filter(Boolean)
  .join('; ')

const REST = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1`
const dbHeaders = { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` }

const CLASS_BY_ID = {
  1: 'Warrior', 2: 'Paladin', 3: 'Hunter', 4: 'Rogue', 5: 'Priest', 6: 'Death Knight',
  7: 'Shaman', 8: 'Mage', 9: 'Warlock', 10: 'Monk', 11: 'Druid', 12: 'Demon Hunter',
}

// ── FETCH ───────────────────────────────────────────────────────────────────
async function fetchBoard(realm, mapId) {
  const body = new URLSearchParams({
    ajax: 'true',
    option: 'challenge-leaderboard/ajax',
    'dataset[r]': realm,
    'dataset[id]': String(mapId),
  })
  const res = await fetch(ARMORY_AJAX, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
      Cookie: COOKIE,
    },
    body,
  })
  if (!res.ok) throw new Error(`board ${mapId}: HTTP ${res.status}`)
  const html = (await res.json()).html || ''
  if (html.includes('armory-errorpage') || !html.includes('challenge-mode')) {
    throw new Error(`board ${mapId}: armory error page (bad TAURI_COOKIE, or realm "${realm}" unknown)`)
  }
  return html
}

// ── PARSE ───────────────────────────────────────────────────────────────────
function decodeName(s) {
  let out = s.replace(/&amp;/g, '&').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
  try {
    out = decodeURIComponent(out)
  } catch {
    /* already plain text */
  }
  return out.trim()
}

// toolTip is "mm:ss:ms", or "hh:mm:ss:ms" past an hour.
function parseTimeMs(tip) {
  if (!tip) return null
  const p = tip.split(':').map(Number)
  if (p.length < 3 || p.some((n) => !Number.isFinite(n))) return null
  const ms = p.pop()
  const [s = 0, m = 0, h = 0] = p.reverse()
  return ((h * 60 + m) * 60 + s) * 1000 + ms
}

function runId(r) {
  const party = r.party.map((p) => p.name.toLowerCase()).sort().join(',')
  const raw = [r.realm, r.map_id, r.day, r.level, r.time_ms, party].join('|')
  return createHash('sha1').update(raw).digest('hex')
}

// Party cell: Tauri marks the tank with fa-shield and the healer with fa-plus right
// before their name span; the span's color-cN is the class id.
const MEMBER_RE = /(fa-shield|fa-plus)|color-c(\d+)"[^>]*>\s*<a[^>]*[?&;]n=([^"&]+)"/g
const AFFIX_RE = /<img class="cm-affix-icon"[^>]*src="([^"]+)"[\s\S]*?data-affix-name="([^"]+)"/g

function parseBoard(html, realm, dungeon) {
  const runs = []
  for (const chunk of html.split('<tr class="cm-row').slice(1)) {
    const row = chunk.slice(0, chunk.indexOf('</tr>'))
    const tds = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1])
    if (tds.length < 6) continue
    const level = parseInt(tds[1], 10)
    const dateM = tds[tds.length - 1].trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
    if (!Number.isFinite(level) || !dateM) continue

    const party = []
    let role = 'dps'
    for (const m of tds[tds.length - 2].matchAll(MEMBER_RE)) {
      if (m[1]) {
        role = m[1] === 'fa-shield' ? 'tank' : 'healer'
        continue
      }
      party.push({ name: decodeName(m[3]), class: CLASS_BY_ID[+m[2]] || null, role })
      role = 'dps'
    }
    if (!party.length) continue

    const run = {
      realm,
      map_id: dungeon.id,
      dungeon: dungeon.name,
      level,
      time_ms: parseTimeMs((row.match(/toolTip="([\d:]+)"/) || [])[1]),
      medal: +((row.match(/cm-medal-(\d)/) || [])[1] || 0),
      affixes: [...row.matchAll(AFFIX_RE)].map((m) => ({ name: m[2], icon: m[1] })),
      party,
      members: party.map((p) => p.name.toLowerCase()),
      day: `${dateM[3]}-${dateM[1].padStart(2, '0')}-${dateM[2].padStart(2, '0')}`,
    }
    run.id = runId(run)
    runs.push(run)
  }
  return runs
}

// ── DB ──────────────────────────────────────────────────────────────────────
async function latestDay(realm) {
  const q = new URLSearchParams({ select: 'day', realm: `eq.${realm}`, order: 'day.desc', limit: '1' })
  const res = await fetch(`${REST}/mplus_runs?${q}`, { headers: dbHeaders })
  if (!res.ok) throw new Error(`latest day: HTTP ${res.status} — ${await res.text()}`)
  return (await res.json())[0]?.day || null
}

// Insert new runs only (existing ids are skipped); returns how many were actually new.
async function insertRuns(rows) {
  let inserted = 0
  for (let i = 0; i < rows.length; i += BATCH) {
    const res = await fetch(`${REST}/mplus_runs?on_conflict=id&select=id`, {
      method: 'POST',
      headers: {
        ...dbHeaders,
        'Content-Type': 'application/json',
        Prefer: 'resolution=ignore-duplicates,return=representation',
      },
      body: JSON.stringify(rows.slice(i, i + BATCH)),
    })
    if (!res.ok) throw new Error(`insert mplus_runs: HTTP ${res.status} — ${await res.text()}`)
    inserted += (await res.json()).length
  }
  return inserted
}

// Full-row upsert that UPDATES existing runs (used to write specs onto them). first_seen
// is never sent, so an update keeps it and the player-index insert trigger doesn't fire.
async function updateRuns(rows) {
  for (let i = 0; i < rows.length; i += BATCH) {
    const res = await fetch(`${REST}/mplus_runs?on_conflict=id`, {
      method: 'POST',
      headers: {
        ...dbHeaders,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(rows.slice(i, i + BATCH)),
    })
    if (!res.ok) throw new Error(`update mplus_runs: HTTP ${res.status} — ${await res.text()}`)
  }
}

// Every stored run whose specs aren't matched yet (all columns but first_seen).
async function pendingSpecRuns(realm) {
  const cols = 'id,realm,map_id,dungeon,level,time_ms,medal,affixes,party,members,day,specs_matched'
  const out = []
  for (let offset = 0; ; offset += 1000) {
    const q = new URLSearchParams({ select: cols, realm: `eq.${realm}`, specs_matched: 'eq.false', order: 'id', offset: String(offset), limit: '1000' })
    const res = await fetch(`${REST}/mplus_runs?${q}`, { headers: dbHeaders })
    if (!res.ok) throw new Error(`pending specs: HTTP ${res.status} — ${await res.text()}`)
    const page = await res.json()
    out.push(...page)
    if (page.length < 1000) break
  }
  return out
}

// ── SPECS ───────────────────────────────────────────────────────────────────
// tauriachievements' data: index.json lists players ([name, realm, …]) and specs
// ([{ class, name, role }]); <dungeon>.json has runs as
// [level, clearMs, timestamp, score, affixIds, [[playerIndex, specIndex] × 5]].
// Returns lookup(run) → Map(lowercased name → spec) for the matching run, or null.
// No realm filter: Legion realms share groups, so an Evermoon board run can hold players
// from [HU] Tauri. Dungeon + key + exact clear time + 3 shared names is specific enough.
async function loadSpecSource() {
  const get = async (path) => {
    const res = await fetch(`${TA_DATA}/${path}`)
    if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`)
    return res.json()
  }
  const index = await get('index.json')
  const byKey = new Map() // "mapId|level|clearMs" → [Map(name → spec)]
  for (const d of index.dungeons) {
    if (!MPLUS_DUNGEONS.some((x) => x.id === d.challengeId)) continue
    const file = await get(`${d.id}.json`)
    for (const r of file.runs) {
      const specs = new Map()
      for (const [pi, si] of r[5]) {
        const p = index.players[pi]
        const s = index.specs[si]
        if (p && s) specs.set(p[0].toLowerCase(), s.name)
      }
      if (!specs.size) continue
      const key = `${d.challengeId}|${r[0]}|${r[1]}`
      const list = byKey.get(key) || []
      list.push(specs)
      byKey.set(key, list)
    }
  }
  console.log(`  spec source: ${byKey.size} runs (tauriachievements, generated ${index.generatedAt})`)
  return (run) => {
    // Same dungeon, key and exact clear time; then the candidate sharing the most party
    // names. Needs 3+ shared names: a renamed character can differ, a different group can't.
    let best = null
    let bestHits = 0
    for (const specs of byKey.get(`${run.map_id}|${run.level}|${run.time_ms}`) || []) {
      const hits = run.party.filter((p) => specs.has(p.name.toLowerCase())).length
      if (hits > bestHits) {
        best = specs
        bestHits = hits
      }
    }
    return bestHits >= 3 ? best : null
  }
}

// The one spec a class can play in a role, or null when the role leaves a choice
// (a Warrior tank is Protection; a Warrior dps could be Arms or Fury).
function specFromRole(klass, role) {
  const fits = specsOf(klass).filter((s) => s.role === role)
  return fits.length === 1 ? fits[0].name : null
}

// Returns the run with party[].spec filled and specs_matched set. Matched specs win;
// otherwise a spec the role decides; otherwise whatever was already stored.
function withSpecs(run, lookup) {
  const matched = lookup ? lookup(run) : null
  const party = run.party.map((p) => ({
    ...p,
    spec: matched?.get(p.name.toLowerCase()) || specFromRole(p.class, p.role) || p.spec || null,
  }))
  return { ...run, party, specs_matched: !!matched }
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

// ── MAIN ────────────────────────────────────────────────────────────────────
async function main() {
  let failed = false
  for (const realm of REALMS) {
    const latest = MPLUS_FULL === '1' ? null : await latestDay(realm)
    // One day of slack: a run finished just before midnight may land after the last scrape.
    const cutoff = latest
      ? new Date(Date.parse(`${latest}T00:00:00Z`) - 86400000).toISOString().slice(0, 10)
      : null
    console.log(`\n${realm}: ${cutoff ? `incremental, runs since ${cutoff}` : 'full backfill'}`)

    // Best effort: without the spec source, runs still land (with role-decided specs only)
    // and stay pending, so a later scrape fills them in.
    let lookup = null
    try {
      lookup = await loadSpecSource()
    } catch (e) {
      console.warn(`  spec source unavailable (${e.message}) — specs will be filled on a later run`)
    }

    let seen = 0
    let sent = 0
    let added = 0
    await pool(MPLUS_DUNGEONS, CONCURRENCY, async (dungeon) => {
      try {
        const runs = parseBoard(await fetchBoard(realm, dungeon.id), realm, dungeon)
        // The same id twice in one insert makes Postgres reject the whole batch.
        const fresh = [
          ...new Map(runs.filter((r) => !cutoff || r.day >= cutoff).map((r) => [r.id, withSpecs(r, lookup)])).values(),
        ]
        const n = fresh.length ? await insertRuns(fresh) : 0
        seen += runs.length
        sent += fresh.length
        added += n
        console.log(`  ${dungeon.name.padEnd(22)} ${String(runs.length).padStart(6)} on board, ${String(n).padStart(5)} new`)
      } catch (e) {
        failed = true
        console.error(`  ${dungeon.name}: ${e.message}`)
      }
    })
    console.log(`  total: ${seen} on boards, ${sent} checked, ${added} new`)

    // Specs for runs stored before they could be matched (the source updates daily).
    try {
      const pending = await pendingSpecRuns(realm)
      const changed = []
      for (const r of pending) {
        const next = withSpecs(r, lookup)
        const specsChanged = next.party.some((p, i) => p.spec !== (r.party[i]?.spec ?? null))
        if (next.specs_matched || specsChanged) changed.push(next)
      }
      if (changed.length) await updateRuns(changed)
      const nowMatched = changed.filter((r) => r.specs_matched).length
      console.log(`  specs: ${pending.length} pending, ${nowMatched} matched now, ${pending.length - nowMatched} still pending`)
    } catch (e) {
      failed = true
      console.error(`  specs: ${e.message}`)
    }
    // Every board parsing to nothing means Tauri changed the page, not that nobody played.
    if (seen === 0) {
      failed = true
      console.error('  no runs parsed from any board — has the leaderboard HTML changed?')
    }
  }
  // Fail loudly (GitHub emails the owner) instead of silently leaving the mirror stale.
  if (failed) process.exit(1)
}

await main()
