import { useEffect, useMemo, useState } from 'react'
import { bossRanking, realmsIn, realmOf, killCount, groupBySpec, difficultiesFor, DIFFICULTY_ORDER } from '../lib/rankings.js'
import { getRaidBoard } from '../lib/raidBests.js'
import { isShared } from '../lib/store.js'
import { classColor, roleOf } from '../lib/classes.js'
import FilterBar from './FilterBar.jsx'
import { MeterHead, MeterRow, MetricToggle } from './Meter.jsx'

// Opens on Mythic; "All difficulties" is still in the dropdown.
const EMPTY = { difficulty: 'Mythic', class: null, spec: null, role: null, faction: null, realm: null }
// Realm slugs a player key can carry (the board's realm filter).
const REALMS = ['evermoon', 'tauri', 'wod']

// Map a ranking record to the shared MeterRow for the active metric. Clicking the
// name opens the player's profile; clicking anywhere else on the row opens the log
// this parse came from, on the matching encounter (only kills from an uploaded log have one).
function rowProps(r, rank, maxValue, metric, onSelectPlayer, onSelectLog) {
  return {
    rank,
    value: metric === 'hps' ? r.hps : r.dps,
    maxValue,
    name: r.player,
    klass: r.class,
    spec: r.spec,
    specIcon: r.specIcon,
    race: r.race,
    gender: r.gender,
    faction: r.faction,
    subLabel: r.spec ? [r.spec, r.class].filter(Boolean).join(' ') : null,
    pet: r.pet,
    potions: r.potions,
    ilvl: r.ilvl,
    ilvlIsLive: r.ilvlIsLive === true,
    talents: r.talents,
    trinkets: r.trinkets,
    legendaries: r.legendaries,
    fightId: r.id,
    metric,
    total: metric === 'hps' ? r.healing : r.damage,
    duration: r.duration,
    when: r.day,
    onClick: () => onSelectPlayer(r.player),
    onRowClick: r.logid ? () => onSelectLog(r.logid, { started: r.started }) : undefined,
  }
}

export default function BossPage({ fights, killCounts, raid, boss, onSelectPlayer, onSelectLog }) {
  const [filter, setFilter] = useState(EMPTY)
  const [bySpec, setBySpec] = useState(false)
  const [metric, setMetric] = useState('dps')
  const difficulty = filter.difficulty
  const rate = (r) => (metric === 'hps' ? r.hps : r.dps)

  // Server-wide board (every Tauri kill + uploaded logs), filtered on the server. Without
  // Supabase (local-only mode) the uploaded fights are ranked in the browser as before.
  const [board, setBoard] = useState({ key: null, rows: [], total: 0, error: '' })
  const boardKey = JSON.stringify([raid, boss, metric, filter])
  useEffect(() => {
    if (!isShared) return
    let cancelled = false
    getRaidBoard({ raid, boss, difficulty: filter.difficulty, metric, filter })
      .then((b) => !cancelled && setBoard({ key: boardKey, ...b, error: '' }))
      .catch((e) => !cancelled && setBoard({ key: boardKey, rows: [], total: 0, error: e.message }))
    return () => {
      cancelled = true
    }
  }, [raid, boss, metric, filter, boardKey])
  const loading = isShared && board.key !== boardKey

  // A board row from an uploaded log is matched to that fight: its id (hovering shows the
  // per-spell breakdown) and, where the stored best lacks them, the fight's merged build —
  // e.g. the live armory ilvl (flagged as such) for a pull that never froze one.
  const fightOf = useMemo(() => {
    const m = new Map()
    for (const f of fights) if (f.raid === raid && f.boss === boss && f.logid) m.set(`${f.logid}|${f.started}|${f.player.toLowerCase()}`, f)
    return m
  }, [fights, raid, boss])

  const localRanking = useMemo(
    () => (isShared ? [] : bossRanking(fights, raid, boss, difficulty, metric)),
    [fights, raid, boss, difficulty, metric],
  )
  const filtered = useMemo(() => {
    if (isShared) {
      return board.rows.map((r) => {
        const f = r.logid ? fightOf.get(`${r.logid}|${r.started}|${r.player.toLowerCase()}`) : null
        if (!f) return { ...r, id: null }
        return {
          ...r,
          id: f.id,
          ilvl: r.ilvl ?? f.ilvl ?? null,
          ilvlIsLive: r.ilvl == null && f.ilvlIsLive === true,
          talents: r.talents?.length ? r.talents : f.talents,
          trinkets: r.trinkets?.length ? r.trinkets : f.trinkets,
          legendaries: r.legendaries?.length ? r.legendaries : f.legendaries ?? r.legendaries,
          specIcon: f.specIcon,
          potions: f.potions,
        }
      })
    }
    return localRanking.filter((r) => {
      if (filter.class && r.class !== filter.class) return false
      if (filter.spec && r.spec !== filter.spec) return false
      if (filter.role && roleOf(r.class, r.spec) !== filter.role) return false
      if (filter.faction && r.faction !== filter.faction) return false
      if (filter.realm && realmOf(r.player) !== filter.realm) return false
      return true
    })
  }, [board.rows, fightOf, localRanking, filter])

  // Difficulties and kill counts: server-wide when shared (raid_kill_counts), else the logs'.
  const counts = useMemo(() => (killCounts || []).filter((k) => k.raid === raid && k.boss === boss), [killCounts, raid, boss])
  const difficulties = useMemo(() => {
    if (!isShared) return difficultiesFor(fights, raid, boss)
    const set = new Set([...counts.map((k) => k.difficulty), ...difficultiesFor(fights, raid, boss)])
    return [...set].sort((a, b) => DIFFICULTY_ORDER.indexOf(a) - DIFFICULTY_ORDER.indexOf(b))
  }, [counts, fights, raid, boss])
  const kills = isShared
    ? counts.filter((k) => !difficulty || k.difficulty === difficulty).reduce((s, k) => s + k.kills, 0)
    : killCount(fights, raid, boss, difficulty)
  const realms = isShared ? REALMS : realmsIn(localRanking)
  // Nothing on this difficulty at all (as opposed to nothing matching the other filters).
  const { difficulty: _d, ...others } = filter
  const empty = isShared ? !loading && board.total === 0 && !Object.values(others).some(Boolean) : localRanking.length === 0

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

      {board.error ? (
        <div className="error">Couldn’t load the rankings: {board.error}</div>
      ) : loading && !board.rows.length ? (
        <div className="empty-state">Loading rankings…</div>
      ) : empty ? (
        <div className="empty-state">
          <p>No {difficulty ? `${difficulty} ` : ''}kills of this boss recorded yet.</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <p>No parses match these filters yet.</p>
        </div>
      ) : (
        <div className={loading ? 'board-refreshing' : undefined}>
          {bySpec ? (
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
                          <MeterRow key={r.player} {...rowProps(r, i + 1, gMax, metric, onSelectPlayer, onSelectLog)} />
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
                    <MeterRow key={r.player} {...rowProps(r, i + 1, maxValue, metric, onSelectPlayer, onSelectLog)} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {isShared && board.total > filtered.length && (
            <p className="muted small board-more">
              Showing the top {filtered.length.toLocaleString('en-US')} of {board.total.toLocaleString('en-US')} players. Use the
              filters to narrow it down.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
