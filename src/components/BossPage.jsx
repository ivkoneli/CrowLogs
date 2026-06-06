import { useMemo, useState } from 'react'
import { bossRanking, realmsIn, realmOf, killCount, groupBySpec } from '../lib/rankings.js'
import { formatDps, formatDuration } from '../parser.js'
import { classColor, roleOf } from '../lib/classes.js'
import FilterBar from './FilterBar.jsx'
import TalentStrip from './TalentStrip.jsx'
import FactionIcon from './FactionIcon.jsx'

const EMPTY = { class: null, spec: null, role: null, faction: null, realm: null }

function Row({ r, rank, maxDps, onSelectPlayer }) {
  return (
    <tr className={r.demo ? 'is-demo' : ''}>
      <td className="rank">{rank}</td>
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
          {r.demo && <span className="pet-tag demo">demo</span>}
        </div>
      </td>
      <td className="num strong">{formatDps(r.dps)}</td>
      <td className="num ilvl">{r.ilvl ?? '—'}</td>
      <td className="talents-col">
        <TalentStrip talents={r.talents} />
      </td>
      <td className="num muted">{formatDuration(r.duration)}</td>
      <td className="num muted">{r.day}</td>
    </tr>
  )
}

const HEAD = (
  <thead>
    <tr>
      <th className="rank">#</th>
      <th>Player</th>
      <th className="num">DPS</th>
      <th className="num">ilvl</th>
      <th className="talents-col">Talents</th>
      <th className="num">Duration</th>
      <th className="num">When</th>
    </tr>
  </thead>
)

export default function BossPage({ fights, raid, boss, difficulty, onSelectPlayer }) {
  const [filter, setFilter] = useState(EMPTY)
  const [bySpec, setBySpec] = useState(false)

  const ranking = useMemo(() => bossRanking(fights, raid, boss, difficulty), [fights, raid, boss, difficulty])
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

  const maxDps = filtered.length ? Math.max(...filtered.map((r) => r.dps), 1) : 1
  const groups = useMemo(() => (bySpec ? groupBySpec(filtered) : null), [bySpec, filtered])

  return (
    <div className="boss-page wide">
      <FilterBar filter={filter} onFilter={setFilter} realms={realms} />

      <div className="page-head center">
        <h2>
          {boss} <span className="title-diff">{difficulty}</span>
        </h2>
        <p className="kills">
          {kills} {kills === 1 ? 'Kill' : 'Kills'}
        </p>
        <div className="view-toggle">
          <button className={`seg ${!bySpec ? 'on' : ''}`} onClick={() => setBySpec(false)}>
            Overall
          </button>
          <button className={`seg ${bySpec ? 'on' : ''}`} onClick={() => setBySpec(true)}>
            By spec
          </button>
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
          const gMax = Math.max(...g.rows.map((r) => r.dps), 1)
          return (
            <div key={g.label} className="spec-section">
              <h3 className="spec-section-head" style={g.class ? { color: classColor(g.class) } : undefined}>
                {g.label} <span className="muted">· {g.rows.length}</span>
              </h3>
              <div className="table-scroll">
                <table className="meter boss-meter">
                  {HEAD}
                  <tbody>
                    {g.rows.map((r, i) => (
                      <Row key={r.player} r={r} rank={i + 1} maxDps={gMax} onSelectPlayer={onSelectPlayer} />
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
            {HEAD}
            <tbody>
              {filtered.map((r, i) => (
                <Row key={r.player} r={r} rank={i + 1} maxDps={maxDps} onSelectPlayer={onSelectPlayer} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
