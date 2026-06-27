import { useEffect, useMemo, useState } from 'react'
import { buildTips } from '../lib/loadingTips.js'
import LogSkeleton from './LogSkeleton.jsx'

// Full-screen overlay shown while a freshly imported log is analyzed. The backdrop is a
// skeleton of the log page (so the content visibly "materializes"); the spinner + rotating
// WoW-style "Tip" line sit on a translucent scrim on top of it.
//
// `phase` drives a two-step reveal:
//   'working' — spinner + tips scrim over the shimmering skeleton (the analysis itself)
//   'reveal'  — scrim gone, skeleton alone for a beat, so the jump to real data is a soft
//               fade rather than a hard cut. App flips to 'reveal' once the log is mounted
//               underneath, then unmounts this overlay ~1s later.
export default function LogLoading({ fights, phase = 'working' }) {
  const tips = useMemo(() => buildTips(fights || []), [fights])
  const [i, setI] = useState(() => Math.floor(Math.random() * Math.max(1, tips.length)))

  useEffect(() => {
    if (tips.length <= 1) return
    const t = setInterval(() => setI((n) => (n + 1) % tips.length), 3800)
    return () => clearInterval(t)
  }, [tips])

  const revealing = phase === 'reveal'

  return (
    <div className={`log-loading-host ${revealing ? 'revealing' : ''}`}>
      <div className="log-loading-skeleton">
        <LogSkeleton />
      </div>
      {!revealing && (
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
      )}
    </div>
  )
}
