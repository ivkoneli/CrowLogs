import { useEffect, useState } from 'react'
import {
  MPLUS_DUNGEONS,
  DEFAULT_MPLUS_REALM,
  MPLUS_REALMS,
  LATEST_PAGE_SIZE,
  getLatestRuns,
  getLastUpdated,
  formatUpdated,
  dungeonIconUrl,
  runScore,
  formatScore,
  formatRunTime,
  formatRunDay,
  serverToday,
  addDays,
} from '../lib/mythicplus.js'
import { Medal, Party } from './MythicPlusCard.jsx'

const KEY_LEVELS = [10, 15, 20]
// The armory's two leaderboards (a run's `realm` is the board it was published on).
const BOARDS = [
  { id: null, label: 'All' },
  { id: MPLUS_REALMS.evermoon, label: 'Evermoon & Tauri' },
  { id: MPLUS_REALMS.wod, label: 'WoD' },
]

// "Today" / "Yesterday" / "Oct 12" by the game server's calendar (runs carry its date).
function dayLabel(day) {
  const today = serverToday()
  if (day === today) return 'Today'
  if (day === addDays(today, -1)) return 'Yesterday'
  return formatRunDay(day, { long: true }).replace(/, \d{4}$/, '')
}

// One run. The party sits in its own column on wide screens; on a phone it folds into a
// "5 players" button that opens it on a line under the run.
function RunRow({ run, showDay, onSelectPlayer }) {
  const [open, setOpen] = useState(false)
  const d = MPLUS_DUNGEONS.find((x) => x.id === run.map_id)
  const realm = run.realm || DEFAULT_MPLUS_REALM
  return (
    <>
      <tr className={`lr-row ${showDay ? 'lr-first' : ''}`}>
        <td className="lr-day muted" title={formatRunDay(run.day, { long: true })}>
          {showDay ? dayLabel(run.day) : ''}
        </td>
        <td>
          {/* A flex box inside the cell, not on it: a flex td drops out of the row's dividers. */}
          <div className="lr-dungeon" title={d?.name || run.dungeon}>
            <img className="mp-dicon" src={dungeonIconUrl(run.map_id)} alt="" />
            <span className="lr-dname">{d?.name || run.dungeon}</span>
            <span className="lr-dshort">{d?.short || run.dungeon}</span>
          </div>
        </td>
        <td className="num strong mp-key">+{run.level}</td>
        <td className="mp-time lr-time">
          <span className={run.medal ? '' : 'muted'}>{formatRunTime(run.time_ms)}</span>
          <Medal medal={run.medal} />
        </td>
        <td className="num mp-score">{formatScore(runScore(run))}</td>
        <td className="lr-party">
          <Party party={run.party} selfName="" realm={realm} onSelectPlayer={onSelectPlayer} />
          <button className="lr-party-btn" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
            {run.party.length} <span className={`chevron ${open ? 'open' : ''}`}>▸</span>
          </button>
        </td>
      </tr>
      {open && (
        <tr className="lr-party-row">
          <td colSpan={6}>
            <Party party={run.party} selfName="" realm={realm} onSelectPlayer={onSelectPlayer} />
          </td>
        </tr>
      )}
    </>
  )
}

// Home page feed: every run on the boards, newest first, 25 at a time with "Load more".
export default function LatestRuns({ onSelectPlayer }) {
  const [filters, setFilters] = useState({ mapId: null, minKey: null, timedOnly: false, board: null })
  const [state, setState] = useState({ runs: [], total: null, loading: true, error: null, done: false })
  const [updated, setUpdated] = useState(null)

  useEffect(() => {
    getLastUpdated()
      .then(setUpdated)
      .catch(() => {})
  }, [])

  // A filter change starts over from the newest run.
  useEffect(() => {
    let cancelled = false
    setState((s) => ({ ...s, loading: true, error: null }))
    getLatestRuns({ ...filters, offset: 0 })
      .then(({ runs, total }) => {
        if (!cancelled) setState({ runs, total, loading: false, error: null, done: runs.length < LATEST_PAGE_SIZE })
      })
      .catch((e) => !cancelled && setState((s) => ({ ...s, loading: false, error: e.message || 'Request failed.' })))
    return () => {
      cancelled = true
    }
  }, [filters])

  const loadMore = () => {
    setState((s) => ({ ...s, loading: true, error: null }))
    getLatestRuns({ ...filters, offset: state.runs.length })
      .then(({ runs }) =>
        setState((s) => ({ ...s, runs: [...s.runs, ...runs], loading: false, done: runs.length < LATEST_PAGE_SIZE })),
      )
      .catch((e) => setState((s) => ({ ...s, loading: false, error: e.message || 'Request failed.' })))
  }
  const set = (patch) => setFilters((f) => ({ ...f, ...patch }))
  const { runs, total, loading, error, done } = state

  return (
    <section className="player-card mp-card home-card lr-card">
      <div className="card-head mp-head">
        <h3 className="mp-title">Latest runs</h3>
        <span className="muted lr-meta">
          {total != null && `${total.toLocaleString('en-US')} ${total === 1 ? 'run' : 'runs'}`}
          {total != null && updated && ' · '}
          {updated && `updated ${formatUpdated(updated).split(' · ')[1]}`}
        </span>
      </div>

      <div className="lr-filters">
        <div className="mp-dfilter" role="group" aria-label="Dungeon">
          {MPLUS_DUNGEONS.map((d) => (
            <button
              key={d.id}
              className={`mp-dfilter-btn ${filters.mapId === d.id ? 'on' : ''}`}
              aria-pressed={filters.mapId === d.id}
              title={d.name}
              onClick={() => set({ mapId: filters.mapId === d.id ? null : d.id })}
            >
              <img src={dungeonIconUrl(d.id)} alt={d.name} />
            </button>
          ))}
        </div>
        <div className="view-toggle mr-keys" role="group" aria-label="Key level">
          <button className={`seg ${!filters.minKey ? 'on' : ''}`} onClick={() => set({ minKey: null })}>
            All keys
          </button>
          {KEY_LEVELS.map((k) => (
            <button key={k} className={`seg ${filters.minKey === k ? 'on' : ''}`} onClick={() => set({ minKey: filters.minKey === k ? null : k })}>
              {k}+
            </button>
          ))}
        </div>
        <button
          className={`seg lr-timed ${filters.timedOnly ? 'on' : ''}`}
          aria-pressed={filters.timedOnly}
          onClick={() => set({ timedOnly: !filters.timedOnly })}
        >
          Timed only
        </button>
        <div className="view-toggle mr-keys" role="group" aria-label="Leaderboard">
          {BOARDS.map((b) => (
            <button key={b.label} className={`seg ${filters.board === b.id ? 'on' : ''}`} onClick={() => set({ board: b.id })}>
              {b.label}
            </button>
          ))}
        </div>
      </div>

      {error && !runs.length ? (
        <div className="error">Couldn’t load the latest runs: {error}</div>
      ) : !runs.length && !loading ? (
        <div className="empty-state mp-empty">No runs match these filters.</div>
      ) : (
        <div className={`table-scroll ${loading && !runs.length ? 'is-loading' : ''}`}>
          <table className="meter lr-table">
            <thead>
              <tr>
                <th className="lr-day">When</th>
                <th>Dungeon</th>
                <th className="num">Key</th>
                <th>Time</th>
                <th className="num">Score</th>
                <th className="lr-party">Party</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run, i) => (
                <RunRow key={run.id} run={run} showDay={i === 0 || runs[i - 1].day !== run.day} onSelectPlayer={onSelectPlayer} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {runs.length > 0 && (
        <div className="lr-more">
          {!done && (
            <button className="mp-page lr-more-btn" onClick={loadMore} disabled={loading}>
              {loading ? 'Loading…' : `Load ${LATEST_PAGE_SIZE} more`}
            </button>
          )}
          <span className="muted">
            showing {runs.length.toLocaleString('en-US')}
            {total != null && ` of ${total.toLocaleString('en-US')}`}
          </span>
          {error && <span className="lr-error">Couldn’t load more: {error}</span>}
        </div>
      )}
    </section>
  )
}
