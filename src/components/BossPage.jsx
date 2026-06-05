import { useMemo, useState } from 'react'
import { bossRanking, realmsIn, realmOf, killCount } from '../lib/rankings.js'
import { formatDps, formatDuration } from '../parser.js'
import { classColor, roleOf } from '../lib/classes.js'
import FilterBar from './FilterBar.jsx'
import TalentStrip from './TalentStrip.jsx'

const EMPTY = { class: null, spec: null, role: null, faction: null, realm: null }

export default function BossPage({ fights, raid, boss, difficulty, onDifficulty, onSelectPlayer }) {
  const [filter, setFilter] = useState(EMPTY)

  const ranking = useMemo(
    () => bossRanking(fights, raid, boss, difficulty),
    [fights, raid, boss, difficulty],
  )

  const realms = useMemo(() => realmsIn(ranking), [ranking])
  const kills = useMemo(
    () => killCount(fights, raid, boss, difficulty),
    [fights, raid, boss, difficulty],
  )

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
  const filterActive = filter.class || filter.role || filter.faction || filter.realm

  return (
    <div className="boss-page wide">
      <FilterBar
        difficulty={difficulty}
        onDifficulty={onDifficulty}
        filter={filter}
        onFilter={setFilter}
        realms={realms}
      />

      <div className="page-head center">
        <h2>
          {boss} <span className="title-diff">{difficulty}</span>
        </h2>
        <p className="kills">
          {kills} {kills === 1 ? 'Kill' : 'Kills'}
        </p>
      </div>

      {ranking.length === 0 ? (
        <div className="empty-state">
          <p>Import a log that includes this encounter to populate the rankings.</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <p>No parses match these filters yet.</p>
        </div>
      ) : (
        <div className="table-scroll">
        <table className="meter boss-meter">
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
          <tbody>
            {filtered.map((r, i) => (
              <tr key={r.player} className={r.demo ? 'is-demo' : ''}>
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
            ))}
          </tbody>
        </table>
        </div>
      )}

      {filterActive && (
        <p className="muted filter-foot">
          Class/role/faction filters hide imported logs that don't yet have that info wired up.
          Realm and difficulty work on every log.
        </p>
      )}
    </div>
  )
}
