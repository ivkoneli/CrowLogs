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
} from '../lib/mythicplus.js'
import { Cols, Head, DungeonCell, RunCells } from './MythicPlusCard.jsx'

const KEY_LEVELS = [10, 15, 20]
const SORTS = [
  { id: 'date', label: 'Date' },
  { id: 'score', label: 'Score' },
]
// The armory's two leaderboards (a run's `realm` is the board it was published on).
const BOARDS = [
  { id: null, label: 'All' },
  { id: MPLUS_REALMS.evermoon, label: 'Evermoon & Tauri' },
  { id: MPLUS_REALMS.wod, label: 'WoD' },
]

// Home page feed: every run on the boards, newest first (exact completion time where
// known) or best score first, 25 at a time with "Load more". Each run carries its rank by
// score among the runs matching the filters. Same table as a profile's runs.
export default function LatestRuns({ onSelectPlayer }) {
  const [filters, setFilters] = useState({ mapId: null, minKey: null, timedOnly: false, board: null, sort: 'date' })
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
        <div className="view-toggle mr-keys" role="group" aria-label="Sort by">
          <span className="muted lr-sort-label">Sort by:</span>
          {SORTS.map((o) => (
            <button key={o.id} className={`seg ${filters.sort === o.id ? 'on' : ''}`} onClick={() => set({ sort: o.id })}>
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {error && !runs.length ? (
        <div className="error">Couldn’t load the latest runs: {error}</div>
      ) : !runs.length && !loading ? (
        <div className="empty-state mp-empty">No runs match these filters.</div>
      ) : (
        <div className="table-scroll">
          <table className="meter mp-meter">
            <Cols rank />
            <Head rank />
            <tbody>
              {runs.map((run) => {
                const dungeon = MPLUS_DUNGEONS.find((x) => x.id === run.map_id)
                return (
                  <tr key={run.id}>
                    <td className="num muted mp-rank">{run.rank != null ? run.rank.toLocaleString('en-US') : ''}</td>
                    {dungeon ? (
                      <DungeonCell dungeon={dungeon} run={run} topLevel={run.level} />
                    ) : (
                      <td className="name-cell">{run.dungeon}</td>
                    )}
                    <RunCells run={run} selfName="" realm={run.realm || DEFAULT_MPLUS_REALM} onSelectPlayer={onSelectPlayer} />
                  </tr>
                )
              })}
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
