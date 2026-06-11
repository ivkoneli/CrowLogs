import { useCallback, useEffect, useMemo, useState } from 'react'
import { logSummary } from '../lib/rankings.js'
import { formatDuration } from '../parser.js'
import { deleteLog } from '../lib/store.js'
import { isAdmin, adminToken } from '../lib/admin.js'
import { MeterHead, MeterRow, MetricToggle } from './Meter.jsx'

// "Iplayretail 0:04" — a lust cast and how far into the fight it landed.
const lustLabel = (l) => `${l.player.split('-')[0]} ${formatDuration(l.t * 1000)}`

// `focus` (optional) = { started }: open on the tab of the encounter with that start
// time (unique within a log) — set by ranking/history row clicks and by shared
// #/log/<id>/<started> URLs, where it arrives as a string. `onEncounterChange`
// reports tab switches so the address bar can keep pointing at the visible pull.
export default function LogPage({ fights, logId, focus, onSelectPlayer, onEncounterChange, onBack, onDeleted }) {
  const log = useMemo(() => logSummary(fights, logId), [fights, logId])
  const focusIndex = useMemo(() => {
    if (focus?.started == null) return 0
    return Math.max(0, log.encounters.findIndex((e) => String(e.started) === String(focus.started)))
  }, [log, focus])
  const [active, setActive] = useState(focusIndex)
  const [metric, setMetric] = useState('dps')
  const [rollback, setRollback] = useState(null) // { busy?, error? }

  // Re-aim the active tab if the page is reused for a different log/focus.
  useEffect(() => {
    setActive(focusIndex)
  }, [logId, focusIndex])

  // Owner-only rollback: removes every fight row from this import. Only rendered in admin
  // mode (see lib/admin.js) and uses the locally-stored token, which delete-log verifies
  // server-side — so the public never sees this and a stranger can't trigger it.
  const handleRollback = useCallback(async () => {
    if (!window.confirm('Permanently delete every fight from this log? This cannot be undone.')) return
    setRollback({ busy: true })
    try {
      const res = await deleteLog(logId, adminToken())
      onDeleted?.(res)
    } catch (e) {
      setRollback({ error: e.message || 'Delete failed.' })
    }
  }, [logId, onDeleted])
  const enc = log.encounters[active] || log.encounters[0]
  const rate = useCallback((r) => (metric === 'hps' ? r.hps : r.dps), [metric])
  // Difficulties present in this log (usually just one — e.g. "Mythic").
  const difficulty = [...new Set(log.encounters.map((e) => e.difficulty).filter(Boolean))].join(' / ')

  // Rows for the active encounter, ranked by the chosen meter.
  const rows = useMemo(() => {
    if (!enc) return []
    return [...enc.rows].filter((r) => rate(r) > 0).sort((a, b) => rate(b) - rate(a))
  }, [enc, rate])
  const maxValue = rows.length ? Math.max(...rows.map(rate), 1) : 1

  return (
    <div className="boss-page wide">
      <div className="log-topbar">
        {onBack && (
          <button className="back-link" onClick={onBack}>
            <span className="back-arrow">←</span> Back
          </button>
        )}
        {isAdmin() && (
          <button
            className="linkbtn rollback-link"
            onClick={handleRollback}
            disabled={rollback?.busy}
            title="Delete this entire log (admin)"
          >
            {rollback?.busy ? 'Deleting…' : '🗑 delete log'}
          </button>
        )}
      </div>
      {rollback?.error && <div className="error">{rollback.error}</div>}
      <div className="page-head center">
        <h2 className="log-title">
          {log.raid || 'Combat'} {difficulty && <span className="title-diff">{difficulty}</span>} Log
        </h2>
        <p className="kills">
          {log.day} · {log.encounters.length}{' '}
          {log.encounters.length === 1 ? 'encounter' : 'encounters'}
        </p>
        <MetricToggle metric={metric} onChange={setMetric} />
      </div>

      {log.encounters.length > 1 && (
        <div className="tabbar log-tabs">
          {log.encounters.map((e, i) => (
            <button
              key={e.key}
              className={`tab ${i === active ? 'active' : ''} ${e.kill ? '' : 'wipe'}`}
              onClick={() => {
                setActive(i)
                onEncounterChange?.(e.started)
              }}
            >
              {e.boss}
              {!e.kill && <span className="wipe-dot" title="Wipe">✕</span>}
            </button>
          ))}
        </div>
      )}

      {enc && (
        <div className="log-encounter">
          <div className="encounter-head">
            <h3>
              {enc.boss}
              {enc.kill ? (
                <span className="result-badge kill">Kill</span>
              ) : (
                <span className="result-badge wipe">Wipe</span>
              )}
            </h3>
            <span className="kicker">
              {enc.difficulty} · {formatDuration(enc.duration)} · {rows.length}{' '}
              {rows.length === 1 ? 'player' : 'players'}
            </span>
            {enc.bloodlust?.length > 0 && (
              <div className="lust-hint" title="Bloodlust / Heroism / Time Warp">
                <span className="lust-icon">🩸</span>
                <span className="lust-label">Lust</span>
                {enc.bloodlust.map((l, i) => (
                  <span key={i} className="lust-cast">
                    {lustLabel(l)}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="table-scroll">
            <table className="meter boss-meter">
              <MeterHead metric={metric} />
              <tbody>
                {rows.map((r, i) => (
                  <MeterRow
                    key={r.player}
                    rank={i + 1}
                    value={rate(r)}
                    maxValue={maxValue}
                    name={r.player}
                    klass={r.class}
                    spec={r.spec}
                    specIcon={r.specIcon}
                    race={r.race}
                    gender={r.gender}
                    faction={r.faction}
                    subLabel={r.spec ? [r.spec, r.class].filter(Boolean).join(' ') : null}
                    pet={r.pet}
                    noAddon={!r.pet && !r.fromAddon}
                    potions={r.potions}
                    ilvl={r.ilvl}
                    talents={r.talents}
                    trinkets={r.trinkets}
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
