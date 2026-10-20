import { useMemo } from 'react'
import { logSummary } from '../lib/rankings.js'
import { selectionToHash, inAppClick } from '../lib/router.js'

// After an upload that held several raids (e.g. two Heroic alt runs and tonight's Mythic),
// each was saved as its own log; this page lists them to pick from. It's a real history
// entry, so Back from an opened log returns here.
export default function UploadPicker({ fights, logIds, onSelectLog }) {
  const logs = useMemo(
    () =>
      (logIds || [])
        .map((id) => {
          const s = logSummary(fights, id)
          if (!s.encounters.length) return null
          const diffs = [...new Set(s.encounters.map((e) => e.difficulty).filter(Boolean))]
          const killed = new Set(s.encounters.filter((e) => e.kill).map((e) => e.boss))
          const wipes = s.encounters.filter((e) => !e.kill).length
          const first = s.encounters[0]
          const last = s.encounters[s.encounters.length - 1]
          return {
            id,
            raid: s.raid,
            diffs,
            date: (first.day || '').split(' ')[0],
            from: (first.day || '').split(' ')[1] || '',
            to: (last.day || '').split(' ')[1] || '',
            killed: killed.size,
            bosses: [...killed],
            wipes,
            players: s.playerCount,
          }
        })
        .filter(Boolean),
    [fights, logIds],
  )

  return (
    <div className="upload-picker">
      <div className="page-head center">
        <span className="kicker">Upload</span>
        <h2>This combat log held {logs.length} raids</h2>
        <p className="muted">Each one was saved as its own log. Pick one to open it.</p>
      </div>
      {logs.length === 0 ? (
        <div className="empty-state">These logs aren’t available any more.</div>
      ) : (
        <ul className="upload-list">
          {logs.map((l) => (
            <li key={l.id}>
              <a
                className="upload-item"
                href={selectionToHash({ view: 'log', logId: l.id })}
                onClick={inAppClick(() => onSelectLog(l.id))}
              >
                <span className="upload-title">
                  {l.diffs.map((d) => (
                    <span key={d} className={`upload-diff diff-${d.toLowerCase()}`}>
                      {d}
                    </span>
                  ))}
                  <span className="upload-date">{l.date}</span>
                </span>
                <span className="upload-raid">{l.raid}</span>
                <span className="upload-meta">
                  {l.from && `${l.from}–${l.to} · `}
                  {l.killed} {l.killed === 1 ? 'boss' : 'bosses'} killed
                  {l.wipes > 0 && ` · ${l.wipes} ${l.wipes === 1 ? 'wipe' : 'wipes'}`} · {l.players} players
                </span>
                {l.bosses.length > 0 && <span className="upload-bosses">{l.bosses.join(' · ')}</span>}
                <span className="upload-open" aria-hidden="true">
                  Open ›
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
