// CrowLogs — server-side log ingest (Supabase Edge Function, runs on Deno).
//
// CrowLogs has no accounts, so the browser must NOT be trusted to write fight rows
// directly: the public anon key + a deterministic fight id (raid::boss::diff::player::
// start) would let anyone insert fake records or overwrite real ones. This function is
// the ONLY writer to `fights` — the table's RLS is read-only for the public, and this
// runs with the service-role key. It validates + sanitizes every row, recomputes dps/hps
// server-side (never trusts the client's numbers), caps size, and rate-limits by IP.
//
// Boss KILLS are then rewritten from Tauri's own record of the kill (exact damage/healing
// for every member, pets included, nothing lost to combat-log range) — see
// ../_shared/tauri-kills.js. Wipes keep the log's numbers; ilvl/gear/talents never change.
//
// Deploy:
//   supabase functions deploy submit-log --no-verify-jwt
// Secrets: TAURI_API_KEY, TAURI_API_SECRET (without them kills keep the log's numbers).
// (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically.)

import { tauriClient, applyTauriKills } from '../_shared/tauri-kills.js'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const REST = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1`
const dbHeaders = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
const tauri = tauriClient(Deno.env.get('TAURI_API_KEY') || '', Deno.env.get('TAURI_API_SECRET') || '')

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// ── Limits ──────────────────────────────────────────────────────────────────
const MAX_ROWS = 5000 // a raid night is a few hundred rows; 5000 is generous headroom
const MAX_BODY_BYTES = 8 * 1024 * 1024 // 8 MB (rows carry a per-spell breakdown, ~0.6 KB each)
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
  out.encounter_id = row.encounter_id == null ? null : num(row.encounter_id) || null
  out.tauri_log = null // server-set only (applyTauriKills), never taken from the client
  out.started = num(row.started)
  out.duration = duration
  out.bloodlust = jsonOrNull(row.bloodlust)
  out.talents = jsonOrNull(row.talents)
  out.trinkets = jsonOrNull(row.trinkets)
  out.legendaries = cleanItems(row.legendaries)
  out.spells = cleanSpells(row.spells, damage, healing)
  return out
}

// Equipped legendaries: [{ id, name, icon, ilvl, quality }], at most a handful.
const MAX_LEGENDARIES = 4
function cleanItems(v: unknown) {
  if (!Array.isArray(v)) return null
  return v.slice(0, MAX_LEGENDARIES).flatMap((it) => {
    if (!it || typeof it !== 'object') return []
    const o = it as Record<string, unknown>
    return [{ id: num(o.id), name: str(o.name), icon: str(o.icon), ilvl: o.ilvl == null ? null : num(o.ilvl), quality: str(o.quality) }]
  })
}

// Per-spell breakdown: { dmg: [[spellId, name, amount, school, petName|null], …], heal: […] }.
// Capped in length, every field type-checked, and dropped entirely if a list claims more
// than the row's (already capped) total — the breakdown can't inflate what the meter shows.
const MAX_SPELLS = 40
function cleanSpellList(v: unknown, total: number) {
  if (!Array.isArray(v)) return []
  const out = v.slice(0, MAX_SPELLS).flatMap((r) => {
    if (!Array.isArray(r)) return []
    const amount = Math.max(num(r[2]), 0)
    if (amount <= 0) return []
    return [[num(r[0]), (str(r[1]) || 'Unknown').slice(0, 80), amount, num(r[3]), r[4] == null ? null : (str(r[4]) || '').slice(0, 40)]]
  })
  const sum = out.reduce((s, r) => s + (r[2] as number), 0)
  return sum > total * 1.001 + 1 ? [] : out
}
function cleanSpells(v: unknown, damage: number, healing: number) {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const dmg = cleanSpellList(o.dmg, damage)
  const heal = cleanSpellList(o.heal, healing)
  return dmg.length || heal.length ? { dmg, heal } : null
}

// A re-import whose kill now matched Tauri: drop that kill's separate pet rows.
async function deleteFights(ids: string[]) {
  if (!ids.length) return
  const list = ids.map((id) => `"${id.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(',')
  const res = await fetch(`${REST}/fights?id=in.(${encodeURIComponent(list)})`, { method: 'DELETE', headers: dbHeaders })
  if (!res.ok) throw new Error(`delete pet rows: HTTP ${res.status} — ${await res.text()}`)
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
  let deduped = [...byId.values()] as Record<string, unknown>[]

  // Kills → Tauri's numbers. Best effort: any failure keeps the log's own numbers.
  let tauriInfo: { matched: unknown[]; errors: string[] } = { matched: [], errors: [] }
  let removeIds: string[] = []
  try {
    const res = await applyTauriKills(tauri, deduped)
    deduped = res.rows.filter((r: Record<string, unknown>) => (r.dps as number) <= MAX_DPS && (r.hps as number) <= MAX_DPS)
    removeIds = res.removeIds
    tauriInfo = { matched: res.matched, errors: res.errors }
  } catch (e) {
    tauriInfo.errors.push((e as Error).message)
  }

  try {
    await upsertFights(deduped)
    await deleteFights(removeIds)
    const logid = str(body.logid)
    if (logid) await upsertLog(logid, str(body.label), deduped.length, await hashIp(ip))
    return json({ inserted: deduped.length, skipped: fights.length - deduped.length, tauri: tauriInfo })
  } catch (e) {
    return json({ error: (e as Error).message }, 500)
  }
})
