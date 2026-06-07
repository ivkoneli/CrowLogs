// Sentry error monitoring. Only activates when VITE_SENTRY_DSN is set at build time,
// so local/dev builds without it are a complete no-op. The DSN is safe to ship in the
// frontend bundle. Keep it light: errors only — no performance tracing or replay.
import * as Sentry from '@sentry/react'

export function initSentry() {
  const dsn = import.meta.env.VITE_SENTRY_DSN
  if (!dsn) return
  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    tracesSampleRate: 0, // no perf tracing
    sendDefaultPii: false,
  })
}
