import { useMemo, useState } from 'react'
import { logSummary } from '../lib/rankings.js'
import { formatDuration } from '../parser.js'
import { MeterHead, MeterRow } from './Meter.jsx'

export default function LogPage({ fights, logId, onSelectPlayer, onBack }) {
  const log = useMemo(() => logSummary(fights, logId), [fights, logId])
  const [active, setActive] = useState(0)
  const enc = log.encounters[active] || log.encounters[0]
  const maxDps = enc && enc.rows.length ? Math.max(...enc.rows.map((r) => r.dps), 1) : 1

  return (
    <div className="boss-page wide">
      {onBack && (
        <button className="linkbtn back-link" onClick={onBack}>
          ← back
        </button>
      )}
      <div className="page-head center">
        <span className="kicker">{log.raid} · log</span>
        <h2>{log.bosses.join(', ') || 'Combat log'}</h2>
        <p className="kills">
          {log.day} · {log.encounters.length}{' '}
          {log.encounters.length === 1 ? 'encounter' : 'encounters'}
        </p>
      </div>

      {log.encounters.length > 1 && (
        <div className="tabbar log-tabs">
          {log.encounters.map((e, i) => (
            <button
              key={e.key}
              className={`tab ${i === active ? 'active' : ''}`}
              onClick={() => setActive(i)}
            >
              {e.boss}
            </button>
          ))}
        </div>
      )}

      {enc && (
        <div className="log-encounter">
          <div className="encounter-head">
            <h3>{enc.boss}</h3>
            <span className="kicker">
              {enc.difficulty} · {formatDuration(enc.duration)} · {enc.rows.length}{' '}
              {enc.rows.length === 1 ? 'player' : 'players'}
            </span>
          </div>
          <div className="table-scroll">
            <table className="meter boss-meter">
              <MeterHead />
              <tbody>
                {enc.rows.map((r, i) => (
                  <MeterRow
                    key={r.player}
                    rank={i + 1}
                    dps={r.dps}
                    maxDps={maxDps}
                    name={r.player}
                    klass={r.class}
                    spec={r.spec}
                    race={r.race}
                    faction={r.faction}
                    subLabel={r.spec ? `${r.spec} ${r.class}` : null}
                    pet={r.pet}
                    ilvl={r.ilvl}
                    talents={r.talents}
                    duration={r.duration}
                    when={enc.day}
                    onClick={() => onSelectPlayer(r.player)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
