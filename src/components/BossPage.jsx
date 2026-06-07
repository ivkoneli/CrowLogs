import { useMemo, useState } from 'react'
import { bossRanking, realmsIn, realmOf, killCount, groupBySpec, difficultiesFor } from '../lib/rankings.js'
import { classColor, roleOf } from '../lib/classes.js'
import FilterBar from './FilterBar.jsx'
import { MeterHead, MeterRow, MetricToggle } from './Meter.jsx'

const EMPTY = { difficulty: null, class: null, spec: null, role: null, faction: null, realm: null }

// Map a ranking record to the shared MeterRow for the active metric.
function rowProps(r, rank, maxValue, metric, onSelectPlayer) {
  return {
    rank,
    value: metric === 'hps' ? r.hps : r.dps,
    maxValue,
    name: r.player,
    klass: r.class,
    spec: r.spec,
    race: r.race,
    faction: r.faction,
    subLabel: r.spec ? `${r.spec} ${r.class}` : null,
    pet: r.pet,
    potions: r.potions,
    ilvl: r.ilvl,
    talents: r.talents,
    trinkets: r.trinkets,
    duration: r.duration,
    when: r.day,
    onClick: () => onSelectPlayer(r.player),
  }
}

export default function BossPage({ fights, raid, boss, onSelectPlayer }) {
  const [filter, setFilter] = useState(EMPTY)
  const [bySpec, setBySpec] = useState(false)
  const [metric, setMetric] = useState('dps')
  const difficulty = filter.difficulty
  const rate = (r) => (metric === 'hps' ? r.hps : r.dps)

  const difficulties = useMemo(() => difficultiesFor(fights, raid, boss), [fights, raid, boss])
  const ranking = useMemo(
    () => bossRanking(fights, raid, boss, difficulty, metric),
    [fights, raid, boss, difficulty, metric],
  )
  const realms = useMemo(() => realmsIn(ranking), [ranking])
  const kills = useMemo(() => killCount(fights, raid, boss, difficulty), [fights, raid, boss, difficulty])

  const filtered = useMemo(() => {
    return ranking.filter((r) => {
      if (filter.class && r.class !== filter.class) return false
      if (filter.spec && r.spec !== filter.spec) return false
      if (filter.role && roleOf(r.class, r.spec) !== filter.role) return false
      if (filter.faction && r.faction !== filter.faction) return false
      if (filter.realm && realmOf(r.player) !== filter.realm) return false
      return true
    })
  }, [ranking, filter])

  const maxValue = filtered.length ? Math.max(...filtered.map(rate), 1) : 1
  const groups = useMemo(() => (bySpec ? groupBySpec(filtered, metric) : null), [bySpec, filtered, metric])

  return (
    <div className="boss-page wide">
      <FilterBar filter={filter} onFilter={setFilter} realms={realms} difficulties={difficulties} />

      <div className="page-head center">
        <h2>
          {boss} <span className="title-diff">{difficulty || 'All Difficulties'}</span>
        </h2>
        <p className="kills">
          {kills} {kills === 1 ? 'Kill' : 'Kills'}
        </p>
        <div className="meter-controls">
          <MetricToggle metric={metric} onChange={setMetric} />
          <div className="view-toggle">
            <button className={`seg ${!bySpec ? 'on' : ''}`} onClick={() => setBySpec(false)}>
              Overall
            </button>
            <button className={`seg ${bySpec ? 'on' : ''}`} onClick={() => setBySpec(true)}>
              By spec
            </button>
          </div>
        </div>
      </div>

      {ranking.length === 0 ? (
        <div className="empty-state">
          <p>Import a log that includes this encounter to populate the rankings.</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <p>No parses match these filters yet.</p>
        </div>
      ) : bySpec ? (
        groups.map((g) => {
          const gMax = Math.max(...g.rows.map(rate), 1)
          return (
            <div key={g.label} className="spec-section">
              <h3 className="spec-section-head" style={g.class ? { color: classColor(g.class) } : undefined}>
                {g.label} <span className="muted">· {g.rows.length}</span>
              </h3>
              <div className="table-scroll">
                <table className="meter boss-meter">
                  <MeterHead metric={metric} />
                  <tbody>
                    {g.rows.map((r, i) => (
                      <MeterRow key={r.player} {...rowProps(r, i + 1, gMax, metric, onSelectPlayer)} />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )
        })
      ) : (
        <div className="table-scroll">
          <table className="meter boss-meter">
            <MeterHead metric={metric} />
            <tbody>
              {filtered.map((r, i) => (
                <MeterRow key={r.player} {...rowProps(r, i + 1, maxValue, metric, onSelectPlayer)} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
