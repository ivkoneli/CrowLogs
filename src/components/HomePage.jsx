import { useEffect, useState } from 'react'
import { MPLUS_DUNGEONS, DEFAULT_MPLUS_REALM, getTopRuns } from '../lib/mythicplus.js'
import { Cols, Head, DungeonCell, RunCells, EmptyRunCells } from './MythicPlusCard.jsx'
import { reportFailure } from '../lib/notify.js'
import LatestRuns from './LatestRuns.jsx'

// Which run counts as a dungeon's best: the highest score, or the highest key.
const BEST_BY = [
  { id: 'score', label: 'Score', hint: 'The highest-scoring run in each dungeon. A timed key beats a depleted key one level higher.' },
  { id: 'key', label: 'Key', hint: 'The highest key finished in each dungeon, timed or not. Ties go to the higher score.' },
]

const SCOPES = [
  { id: 'week', label: 'This week' },
  { id: 'all', label: 'All time' },
]

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
// "2026-10-07" → "Wed, Oct 7" (plain date, never shifted by timezone).
function shortDay(day) {
  const d = new Date(`${day}T00:00:00Z`)
  return `${WEEKDAYS[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`
}

// The "best run per dungeon" table: the same layout as a profile's Mythic+ best runs, with
// the same Best by Score | Key switch.
function BestTable({ title, hint, best, scopeLabel, bestBy, onBestBy, onSelectPlayer }) {
  const done = best.filter((b) => b.run).length
  const topLevel = Math.max(1, ...best.map((b) => b.run?.level || 0))
  return (
    <section className="player-card mp-card home-card">
      <div className="card-head mp-head">
        <h3 className="mp-title">
          {title}
          <span className="home-scope-pill">{scopeLabel}</span>
        </h3>
        <div className="home-best-right">
          <div className="mp-sort-toggle" role="group" aria-label="Pick each dungeon's best run by">
            <span className="mp-sort-toggle-label">Best by</span>
            {BEST_BY.map((o) => (
              <button key={o.id} className={`seg ${bestBy === o.id ? 'on' : ''}`} onClick={() => onBestBy(o.id)}>
                {o.label}
              </button>
            ))}
          </div>
          <span className="muted">
            {done} of {MPLUS_DUNGEONS.length} dungeons
          </span>
        </div>
      </div>
      <p className="home-card-hint muted">{hint}</p>
      <div className="table-scroll">
        <table className="meter mp-meter">
          <Cols />
          <Head />
          <tbody>
            {best.map(({ dungeon, run }) => (
              <tr key={dungeon.id}>
                <DungeonCell dungeon={dungeon} run={run} topLevel={topLevel} />
                {run ? (
                  <RunCells
                    run={run}
                    selfName=""
                    realm={run.realm || DEFAULT_MPLUS_REALM}
                    onSelectPlayer={onSelectPlayer}
                  />
                ) : (
                  <EmptyRunCells />
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

// Landing page: the realm's best Mythic+ run in every dungeon (by highest score or highest
// key) for the current M+ week (Wednesday → Tuesday) or all time, then every run as a
// newest-first feed (LatestRuns).
// Importing a combat log lives on its own page (#/import).
export default function HomePage({ onSelectPlayer, onImport }) {
  const [scope, setScope] = useState('week')
  const [bestBy, setBestBy] = useState('score')
  const [state, setState] = useState({ loading: true, data: null, error: null })
  const [attempt, setAttempt] = useState(0) // bumped by the Retry button

  useEffect(() => {
    let cancelled = false
    setState((s) => ({ ...s, loading: true, error: null }))
    getTopRuns(scope)
      .then((data) => !cancelled && setState({ loading: false, data, error: null }))
      .catch((e) => {
        // Already retried inside getTopRuns; report it so the real cause can be found.
        reportFailure('home-top-runs', e, { scope })
        if (!cancelled) setState((s) => ({ loading: false, data: s.data, error: e.message || 'Request failed.' }))
      })
    return () => {
      cancelled = true
    }
  }, [scope, attempt])

  const { loading, data, error } = state
  const week = data?.week
  const scopeLabel = scope === 'week' ? 'This week' : 'All time'

  return (
    <div className="home">
      <div className="page-head home-head">
        <div>
          <div className="kicker">Tauri Legion · Evermoon, Tauri &amp; WoD · Mythic+</div>
          <h2>Best Mythic+ runs</h2>
          {scope === 'week' && week ? (
            <div className="home-week">
              <span>
                Week of <strong>{shortDay(week.start)}</strong> – <strong>{shortDay(week.end)}</strong>
              </span>
              {week.affixes.length > 0 && (
                <span className="home-week-affixes">
                  {week.affixes.map((a) => (
                    <img key={a.name} className="mp-affix" src={a.icon} alt={a.name} title={a.name} />
                  ))}
                  <span className="muted">{week.affixes.map((a) => a.name).join(' · ')}</span>
                </span>
              )}
            </div>
          ) : (
            <p className="kills home-week">{scope === 'all' ? 'The best keys ever finished on the realm.' : ' '}</p>
          )}
        </div>
        <div className="home-head-right">
          <div className="mp-view-toggle" role="tablist" aria-label="Time range">
            {SCOPES.map((s) => (
              <button
                key={s.id}
                role="tab"
                aria-selected={scope === s.id}
                className={`seg ${scope === s.id ? 'on' : ''}`}
                onClick={() => setScope(s.id)}
              >
                {s.label}
              </button>
            ))}
          </div>
          <button className="home-import" onClick={onImport}>
            ＋ Import combat log
          </button>
        </div>
      </div>

      {error && !data ? (
        <div className="error home-error">
          Couldn’t load Mythic+ runs: {error}
          <button className="home-retry" onClick={() => setAttempt((n) => n + 1)}>
            Try again
          </button>
        </div>
      ) : loading && !data ? (
        <div className="empty-state mp-empty">Loading Mythic+ runs…</div>
      ) : (
        <div className={`home-cards ${loading ? 'is-loading' : ''}`}>
          <BestTable
            title="Best runs"
            hint={`${BEST_BY.find((o) => o.id === bestBy).hint.replace('each dungeon', `each dungeon (${scope === 'week' ? 'this week' : 'all time'})`)}`}
            best={bestBy === 'key' ? data.keys : data.scores}
            scopeLabel={scopeLabel}
            bestBy={bestBy}
            onBestBy={setBestBy}
            onSelectPlayer={onSelectPlayer}
          />
        </div>
      )}

      <LatestRuns onSelectPlayer={onSelectPlayer} />
    </div>
  )
}
