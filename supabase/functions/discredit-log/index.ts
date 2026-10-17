// CrowLogs — admin mark/unmark of one player's results in a log (Supabase Edge Function, Deno).
//
// Sets `fights.discredited` on every row of `player` in `logid`: a result a game bug
// inflated stays in the log and on the player's profile, but is left off the boss
// rankings (see bossRanking in src/lib/rankings.js). `reason` (optional) is stored with it
// and shown when hovering the Unranked tag. `discredited: false` clears the mark.
// Gated by the same shared ADMIN_TOKEN secret as delete-log, and run with the
// service-role key (the public RLS on `fights` is read-only).
//
// Deploy:
//   supabase functions deploy discredit-log --no-verify-jwt

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

  if (!ADMIN_TOKEN) return json({ error: 'Server missing ADMIN_TOKEN secret.' }, 500)

  const body = await req.json().catch(() => ({}))
  const token = typeof body.token === 'string' ? body.token : ''
  const logid = typeof body.logid === 'string' ? body.logid : ''
  const player = typeof body.player === 'string' ? body.player : ''

  if (!safeEqual(token, ADMIN_TOKEN)) return json({ error: 'Unauthorized.' }, 401)
  if (!logid || !player) return json({ error: 'Provide a "logid" and a "player".' }, 400)
  // null (not false) when cleared, so an unmarked row looks the same as one never marked.
  const discredited = body.discredited === false ? null : true
  // The admin's note on why (shown on hover), cleared with the mark.
  const reason = discredited && typeof body.reason === 'string' ? body.reason.trim().slice(0, 200) || null : null

  try {
    const res = await fetch(
      `${REST}/fights?logid=eq.${encodeURIComponent(logid)}&player=eq.${encodeURIComponent(player)}`,
      {
        method: 'PATCH',
        headers: { ...dbHeaders, 'Content-Type': 'application/json', Prefer: 'return=representation' },
        body: JSON.stringify({ discredited, discredit_reason: reason }),
      },
    )
    if (!res.ok) throw new Error(`update fights: HTTP ${res.status} — ${await res.text()}`)
    const updated = ((await res.json()) as unknown[]).length
    return json({ logid, player, discredited: discredited === true, updated })
  } catch (e) {
    return json({ error: (e as Error).message }, 500)
  }
})
