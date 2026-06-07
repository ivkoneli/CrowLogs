// Fire-and-forget failure reporting. Pings the `notify-failure` edge function, which
// emails via Resend (the API key stays server-side). Never throws and never blocks —
// if Supabase isn't configured, or the report fails, it's silently ignored.
import { supabase } from './supabase.js'

export function reportFailure(context, error, details) {
  if (!supabase) return
  const message = error?.message || String(error || 'Unknown error')
  supabase.functions
    .invoke('notify-failure', {
      body: {
        context,
        message,
        details: details || null,
        url: typeof location !== 'undefined' ? location.href : null,
        ua: typeof navigator !== 'undefined' ? navigator.userAgent : null,
      },
    })
    .catch(() => {})
}
