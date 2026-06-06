import { useMemo } from 'react'
import { logSummary } from '../lib/rankings.js'
import { formatDps, formatNumber, formatDuration } from '../parser.js'
import { classColor } from '../lib/classes.js'
import FactionIcon from './FactionIcon.jsx'

export default function LogPage({ fights, logId, onSelectPlayer, onBack }) {
  const log = useMemo(() => logSummary(fights, logId), [fights, logId])

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

      {log.encounters.map((enc) => {
        const maxDps = enc.rows.length ? Math.max(...enc.rows.map((r) => r.dps), 1) : 1
        return (
          <div key={enc.key} className="log-encounter">
            <div className="encounter-head">
              <h3>{enc.boss}</h3>
              <span className="kicker">
                {enc.difficulty} · {formatDuration(enc.duration)} · {enc.rows.length}{' '}
                {enc.rows.length === 1 ? 'player' : 'players'}
              </span>
            </div>
            <div className="table-scroll">
              <table className="meter boss-meter">
                <thead>
                  <tr>
                    <th className="rank">#</th>
                    <th>Player</th>
                    <th className="num">DPS</th>
                    <th className="num">Damage</th>
                    <th className="num">Duration</th>
                  </tr>
                </thead>
                <tbody>
                  {enc.rows.map((r, i) => (
                    <tr key={r.player}>
                      <td className="rank">{i + 1}</td>
                      <td className="name-cell">
                        <div className="bar-wrap">
                          <div
                            className="bar"
                            style={{
                              width: `${(r.dps / maxDps) * 100}%`,
                              background: r.class
                                ? `linear-gradient(90deg, ${classColor(r.class)}33, ${classColor(r.class)}cc)`
                                : undefined,
                            }}
                          />
                          <button
                            className="name link"
                            onClick={() => onSelectPlayer(r.player)}
                            style={r.class ? { color: classColor(r.class) } : undefined}
                          >
                            {r.faction && <FactionIcon faction={r.faction} size={14} />}
                            {r.player}
                          </button>
                          {r.spec && (
                            <span className="spec-tag">
                              {r.spec} {r.class}
                            </span>
                          )}
                          {r.pet && <span className="pet-tag">pet</span>}
                        </div>
                      </td>
                      <td className="num strong">{formatDps(r.dps)}</td>
                      <td className="num">{formatNumber(r.damage)}</td>
                      <td className="num muted">{formatDuration(r.duration)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      })}
    </div>
  )
}
