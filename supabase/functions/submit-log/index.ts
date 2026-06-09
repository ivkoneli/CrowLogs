// CrowLogs — server-side log ingest (Supabase Edge Function, runs on Deno).
//
// CrowLogs has no accounts, so the browser must NOT be trusted to write fight rows
// directly: the public anon key + a deterministic fight id (raid::boss::diff::player::
// start) would let anyone insert fake records or overwrite real ones. This function is
// the ONLY writer to `fights` — the table's RLS is read-only for the public, and this
// runs with the service-role key. It validates + sanitizes every row, recomputes dps/hps
// server-side (never trusts the client's numbers), caps size, and rate-limits by IP.
//
// Deploy:
//   supabase functions deploy submit-log --no-verify-jwt
// (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically.)

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const REST = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1`
const dbHeaders = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// ── Limits ──────────────────────────────────────────────────────────────────
const MAX_ROWS = 5000 // a raid night is a few hundred rows; 5000 is generous headroom
const MAX_BODY_BYTES = 4 * 1024 * 1024 // 4 MB
const MAX_DPS = 100_000_000 // sanity ceiling (ICC-era values are << this); rejects fakes
const MAX_DURATION_MS = 2 * 60 * 60 * 1000 // 2h — longer than any single encounter
const MAX_STR = 200 // cap free-text fields so nobody stuffs the DB with megabyte strings

// In-memory per-IP token bucket. Best-effort only (resets on cold start and isn't shared
// across instances), but it stops trivial floods from a single source. A persistent
// rate-limit table would be the next step if abuse gets sophisticated.
const RATE_MAX = 30 // submissions
const RATE_WINDOW_MS = 60_000 // per minute
const hits = new Map<string, number[]>()
function rateLimited(ip: string): boolean {
  const now = Date.now()
  const arr = (hits.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS)
  arr.push(now)
  hits.set(ip, arr)
  return arr.length > RATE_MAX
}

const clientIp = (req: Request) =>
  req.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
  req.headers.get('cf-connecting-ip') ||
  'unknown'

// Only these columns exist on `fights`; anything else the client sends is dropped.
const STR_FIELDS = ['id', 'raid', 'boss', 'difficulty', 'player', 'guid', 'spec', 'spec_icon', 'class', 'day', 'logid'] as const
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const str = (v: unknown) => (typeof v === 'string' ? v.slice(0, MAX_STR) : null)
const jsonOrNull = (v: unknown) => (v == null ? null : v)

// Turn one untrusted client row into a clean, server-authoritative fight row. Returns
// null if it's structurally invalid (so it's skipped, not stored).
function sanitize(row: Record<string, unknown>) {
  if (!row || typeof row !== 'object') return null
  const id = str(row.id)
  const player = str(row.player)
  if (!id || !player) return null // id + player are required to be a real record

  const duration = Math.min(Math.max(num(row.duration), 0), MAX_DURATION_MS)
  const durationSec = duration / 1000
  const damage = Math.max(num(row.damage), 0)
  const healing = Math.max(num(row.healing), 0)
  // Recompute rates from the (capped) totals + duration. The client's dps/hps are
  // ignored entirely — this is what stops "damage: 100, dps: 9999999" inflation.
  const dps = durationSec > 0 ? Math.round(damage / durationSec) : 0
  const hps = durationSec > 0 ? Math.round(healing / durationSec) : 0
  if (dps > MAX_DPS || hps > MAX_DPS) return null // implausible — reject outright

  const out: Record<string, unknown> = {}
  for (const f of STR_FIELDS) out[f] = str(row[f])
  out.id = id
  out.player = player
  out.pet = !!row.pet
  out.kill = row.kill == null ? null : !!row.kill
  out.from_addon = !!row.from_addon
  out.damage = damage
  out.healing = healing
  out.dps = dps
  out.hps = hps
  out.potions = Math.max(num(row.potions), 0)
  out.hits = Math.max(num(row.hits), 0)
  out.ilvl = row.ilvl == null ? null : num(row.ilvl)
  out.started = num(row.started)
  out.duration = duration
  out.bloodlust = jsonOrNull(row.bloodlust)
  out.talents = jsonOrNull(row.talents)
  out.trinkets = jsonOrNull(row.trinkets)
  return out
}

async function upsertFights(rows: unknown[]) {
  if (!rows.length) return
  const res = await fetch(`${REST}/fights`, {
    method: 'POST',
    headers: { ...dbHeaders, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(rows),
  })
  if (!res.ok) throw new Error(`upsert fights: HTTP ${res.status} — ${await res.text()}`)
}

// Audit row per imported log, so the owner has a list to roll back from (see delete-log).
async function upsertLog(logid: string, label: string | null, rowCount: number, ipHash: string) {
  await fetch(`${REST}/logs`, {
    method: 'POST',
    headers: { ...dbHeaders, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify([{ logid, label, row_count: rowCount, ip_hash: ipHash, created_at: new Date().toISOString() }]),
  }).catch(() => {}) // audit is best-effort — never fail an import over it
}

// SHA-256 the submitter IP (salted with the service key) so the audit table holds a
// stable pseudonymous fingerprint for moderation, not a raw IP.
async function hashIp(ip: string) {
  const data = new TextEncoder().encode(`${ip}:${SERVICE_KEY.slice(0, 16)}`)
  const buf = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(buf)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

  const ip = clientIp(req)
  if (rateLimited(ip)) return json({ error: 'Rate limit exceeded. Try again shortly.' }, 429)

  const raw = await req.text()
  if (raw.length > MAX_BODY_BYTES) return json({ error: 'Payload too large.' }, 413)

  let body: { fights?: unknown; logid?: unknown; label?: unknown }
  try {
    body = JSON.parse(raw)
  } catch {
    return json({ error: 'Invalid JSON.' }, 400)
  }

  const fights = Array.isArray(body.fights) ? body.fights : []
  if (fights.length === 0) return json({ error: 'No fights provided.' }, 400)
  if (fights.length > MAX_ROWS) return json({ error: `Too many rows (max ${MAX_ROWS}).` }, 413)

  const clean = fights.map((f) => sanitize(f as Record<string, unknown>)).filter(Boolean)
  if (clean.length === 0) return json({ error: 'No valid fight rows after validation.' }, 422)

  // Dedupe by id (a batch can resolve two segments to one id; PostgREST rejects a
  // batch that lists the same conflict key twice).
  const byId = new Map(clean.map((r) => [(r as Record<string, unknown>).id, r]))
  const deduped = [...byId.values()]

  try {
    await upsertFights(deduped)
    const logid = str(body.logid)
    if (logid) await upsertLog(logid, str(body.label), deduped.length, await hashIp(ip))
    return json({ inserted: deduped.length, skipped: fights.length - deduped.length })
  } catch (e) {
    return json({ error: (e as Error).message }, 500)
  }
})
