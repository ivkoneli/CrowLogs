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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
  try {
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
