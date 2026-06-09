// CrowLogs — admin rollback of a single imported log (Supabase Edge Function, Deno).
//
// Deletes every fight row carrying a given `logid` (and its audit row). Because the
// site has no accounts, this is gated by a shared ADMIN_TOKEN secret — the owner enters
// it at runtime; it is NEVER shipped in the browser bundle. Deletes run with the
// service-role key (the public RLS on `fights` is read-only, so the browser can't do
// this directly).
//
// Deploy:
//   supabase functions deploy delete-log --no-verify-jwt
// Secret (server-side only):
//   supabase secrets set ADMIN_TOKEN="<a long random string>"

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ADMIN_TOKEN = Deno.env.get('ADMIN_TOKEN') || ''
const REST = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1`
const dbHeaders = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// Constant-time string compare so the token can't be guessed by timing the response.
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

async function deleteWhere(table: string, logid: string, returnRows: boolean) {
  const res = await fetch(`${REST}/${table}?logid=eq.${encodeURIComponent(logid)}`, {
    method: 'DELETE',
    headers: { ...dbHeaders, Prefer: returnRows ? 'return=representation' : 'return=minimal' },
  })
  if (!res.ok) throw new Error(`delete ${table}: HTTP ${res.status} — ${await res.text()}`)
  if (!returnRows) return 0
  return ((await res.json()) as unknown[]).length
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

  if (!ADMIN_TOKEN) return json({ error: 'Server missing ADMIN_TOKEN secret.' }, 500)

  const body = await req.json().catch(() => ({}))
  const token = typeof body.token === 'string' ? body.token : ''
  const logid = typeof body.logid === 'string' ? body.logid : ''

  if (!safeEqual(token, ADMIN_TOKEN)) return json({ error: 'Unauthorized.' }, 401)
  if (!logid) return json({ error: 'Provide a "logid".' }, 400)

  try {
    const deleted = await deleteWhere('fights', logid, true)
    await deleteWhere('logs', logid, false).catch(() => {}) // audit row is best-effort
    return json({ logid, deleted })
  } catch (e) {
    return json({ error: (e as Error).message }, 500)
  }
})
