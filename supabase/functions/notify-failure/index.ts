// CrowLogs — failure notifier (Supabase Edge Function, runs on Deno).
//
// The browser can't hold a Resend API key, so it pings this function (fire-and-forget)
// when something fails client-side — currently a failed log upload. This emails you.
//
// Deploy:
//   supabase functions deploy notify-failure --no-verify-jwt
// Secrets (server-side only):
//   supabase secrets set RESEND_API_KEY="re_…" NOTIFY_TO="you@example.com"
//   # optional: NOTIFY_FROM (defaults to Resend's shared onboarding sender, which can
//   #   only email the address on your Resend account — fine for alerting yourself).
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') || ''
const NOTIFY_TO = Deno.env.get('NOTIFY_TO') || ''
const NOTIFY_FROM = Deno.env.get('NOTIFY_FROM') || 'CrowLogs <onboarding@resend.dev>'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const clip = (s: unknown, n: number) => (typeof s === 'string' ? s.slice(0, n) : '')

// Best-effort per-IP throttle. This endpoint is public and sends email, so without a
// cap anyone could flood your inbox. In-memory only (resets on cold start), but enough
// to stop a trivial flood from one source.
const RATE_MAX = 5
const RATE_WINDOW_MS = 5 * 60_000 // 5 per 5 minutes per IP
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
  try {
    if (rateLimited(clientIp(req))) return json({ error: 'Rate limited.' }, 429)
    if (!RESEND_API_KEY || !NOTIFY_TO) {
      return json({ error: 'notify-failure not configured (set RESEND_API_KEY + NOTIFY_TO)' }, 500)
    }
    const b = await req.json().catch(() => ({}))
    const context = clip(b.context, 80) || 'unknown'
    const message = clip(b.message, 600) || 'No message'
    const text = [
      `Context: ${context}`,
      `Message: ${message}`,
      b.url ? `URL: ${clip(b.url, 300)}` : '',
      b.ua ? `Browser: ${clip(b.ua, 300)}` : '',
      b.details ? `Details: ${clip(JSON.stringify(b.details), 800)}` : '',
      `Time: ${new Date().toISOString()}`,
    ]
      .filter(Boolean)
      .join('\n')

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: NOTIFY_FROM, to: [NOTIFY_TO], subject: `CrowLogs failure — ${context}`, text }),
    })
    if (!res.ok) return json({ error: `Resend ${res.status}: ${clip(await res.text(), 300)}` }, 502)
    return json({ ok: true })
  } catch (e) {
    return json({ error: (e as Error).message }, 500)
  }
})
