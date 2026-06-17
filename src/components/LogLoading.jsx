import { useEffect, useMemo, useState } from 'react'
import { buildTips } from '../lib/loadingTips.js'

// Full-screen overlay shown while a freshly imported log is analyzed: a big spinner
// plus a rotating WoW-style "Tip" line built from the log itself. Rendered on top of
// the (still-mounted) import page, so if analysis errors out the import form — with its
// file selection and error message — is right there underneath when the overlay clears.
export default function LogLoading({ fights }) {
  const tips = useMemo(() => buildTips(fights || []), [fights])
  const [i, setI] = useState(() => Math.floor(Math.random() * Math.max(1, tips.length)))

  useEffect(() => {
    if (tips.length <= 1) return
    const t = setInterval(() => setI((n) => (n + 1) % tips.length), 3800)
    return () => clearInterval(t)
  }, [tips])

  return (
    <div className="log-loading">
      <div className="log-loading-inner">
        <div className="big-spinner" />
        <h2 className="log-loading-title">Analyzing raid…</h2>
        <p className="log-loading-sub">Crunching damage, healing and questionable life choices.</p>
        <div className="log-loading-tip">
          <span className="tip-label">Tip</span>
          <span key={i} className="tip-text">{tips[i] || 'Loading…'}</span>
        </div>
      </div>
    </div>
  )
}
