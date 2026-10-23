import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import {
  MPLUS_DUNGEONS,
  MEDALS,
  medalIconUrl,
  dungeonIconUrl,
  dungeonBannerUrl,
  getPlayerRuns,
  getPlayerRanks,
  bestRuns,
  runScore,
  playerScore,
  formatScore,
  sortRunsByRecent,
  formatRunTime,
  formatRunDay,
  formatRunWhen,
  runFinishedAt,
  splitPlayerKey,
  memberPlayerKey,
  isMember,
} from '../lib/mythicplus.js'
import { classColor, specsOf, specIconUrl } from '../lib/classes.js'
import SpecTabs from './SpecTabs.jsx'
import { selectionToHash, inAppClick } from '../lib/router.js'
import { foldName } from '../lib/rankings.js'

const PAGE_SIZE = 10
const ROLE_ORDER = { tank: 0, healer: 1, dps: 2 }

function DungeonIcon({ mapId }) {
  return (
    <img
      className="mp-dicon"
      src={dungeonIconUrl(mapId)}
      alt=""
      onError={(e) => {
        e.currentTarget.style.visibility = 'hidden'
      }}
    />
  )
}

// Tauri's party markers: a shield before the tank, a plus before the healer.
function RoleIcon({ role }) {
  if (role === 'tank') {
    return (
      <svg className="mp-role tank" viewBox="0 0 16 16" aria-label="Tank" role="img">
        <title>Tank</title>
        <path d="M8 1 2.5 3v4.2c0 3.4 2.3 6.3 5.5 7.8 3.2-1.5 5.5-4.4 5.5-7.8V3L8 1Z" />
      </svg>
    )
  }
  if (role === 'healer') {
    return (
      <svg className="mp-role healer" viewBox="0 0 16 16" aria-label="Healer" role="img">
        <title>Healer</title>
        <path d="M6.2 2h3.6v4.2H14v3.6H9.8V14H6.2V9.8H2V6.2h4.2V2Z" />
      </svg>
    )
  }
  return null
}

export function Medal({ medal }) {
  const m = MEDALS[medal] || MEDALS[0]
  if (!m.key) {
    // Same footprint as a medal so times and affixes stay aligned down the column.
    return (
      <svg className="mp-medal mp-depleted" viewBox="0 0 24 24" role="img" aria-label="Depleted">
        <title>Depleted (over the timer)</title>
        <circle cx="12" cy="12" r="9" />
        <path d="M8.5 8.5l7 7M15.5 8.5l-7 7" />
      </svg>
    )
  }
  return <img className="mp-medal" src={medalIconUrl(m.key)} alt={m.label} title={`${m.label} (${m.note})`} />
}

// `realm` is the profile's own realm on a profile, the run's board elsewhere; a member's
// link always goes by THEIR realm (a board can mix realms).
function Member({ p, selfName, realm, onSelectPlayer }) {
  const isSelf = !!selfName && isMember(p, selfName, realm)
  const memberKey = memberPlayerKey(p.name, p.realm || realm)
  return (
    <span className={`mp-member ${isSelf ? 'self' : ''}`}>
      <RoleIcon role={p.role} />
      {isSelf || !onSelectPlayer ? (
        <span className="mp-member-name" style={{ color: classColor(p.class) }}>
          {p.name}
        </span>
      ) : (
        // A real link, so right-click → "Open in new tab" and middle-click work.
        <a
          className="mp-member-name link"
          style={{ color: classColor(p.class) }}
          href={selectionToHash({ view: 'player', player: memberKey })}
          onClick={inAppClick(() => onSelectPlayer(memberKey))}
          title={`${p.spec ? `${p.spec} ${p.class}` : p.class || ''} · open ${p.name}'s profile`}
        >
          {p.name}
        </a>
      )}
    </span>
  )
}

// Font sizes tried, largest first, until the whole party fits on one line.
const PARTY_FONT_STEPS = ['0.84rem', '0.78rem', '0.73rem', '0.68rem', '0.64rem']

// Keep `el`'s single line of names inside its cell: step the font down until it fits,
// and only if even the smallest step overflows (very narrow screens) let it wrap.
// Re-fits whenever the cell is resized.
function useFitOneLine(ref) {
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const fit = () => {
      el.style.flexWrap = 'nowrap'
      for (const size of PARTY_FONT_STEPS) {
        el.style.fontSize = size
        if (el.scrollWidth <= el.clientWidth + 1) return
      }
      el.style.flexWrap = 'wrap'
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el.parentElement || el)
    return () => ro.disconnect()
  }, [ref])
}

// Tauri's order: tank, healer, then the dps, on one line (see useFitOneLine).
export function Party({ party, ...memberProps }) {
  const members = [...party].sort((a, b) => (ROLE_ORDER[a.role] ?? 2) - (ROLE_ORDER[b.role] ?? 2))
  const ref = useRef(null)
  useFitOneLine(ref)
  return (
    <div className="mp-party" ref={ref}>
      {members.map((p) => (
        <Member key={p.name} p={p} {...memberProps} />
      ))}
    </div>
  )
}

// One shared clock for every "x min ago" cell, so they stay current without a timer per row.
const clock = { now: Date.now(), subs: new Set(), timer: null }
function subscribeClock(cb) {
  clock.subs.add(cb)
  if (!clock.timer) {
    clock.now = Date.now()
    clock.timer = setInterval(() => {
      clock.now = Date.now()
      clock.subs.forEach((f) => f())
    }, 30_000)
  }
  return () => {
    clock.subs.delete(cb)
    if (!clock.subs.size) {
      clearInterval(clock.timer)
      clock.timer = null
    }
  }
}
const useNow = () => useSyncExternalStore(subscribeClock, () => clock.now)

// Key / time+medal / affixes / party / date — shared by the best-runs and history tables.
export function RunCells({ run, selfName, realm, onSelectPlayer }) {
  const now = useNow()
  const at = runFinishedAt(run)
  const atTime = at ? at.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : ''
  return (
    <>
      <td className="num strong mp-key">+{run.level}</td>
      <td className="num mp-score">{formatScore(runScore(run))}</td>
      <td className="mp-time">
        <span className={run.medal ? '' : 'muted'}>{formatRunTime(run.time_ms)}</span>
        <Medal medal={run.medal} />
      </td>
      <td className="mp-affixes">
        {(run.affixes || []).map((a) => (
          <img key={a.name} className="mp-affix" src={a.icon} alt={a.name} title={a.name} />
        ))}
      </td>
      <td>
        <Party party={run.party} selfName={selfName} realm={realm} onSelectPlayer={onSelectPlayer} />
      </td>
      <td
        className="num muted mp-day"
        title={
          // The exact time once Tauri Achievements has the run (see completed_at), else when
          // the hourly scrape first saw it, in the viewer's zone.
          formatRunDay(run.day, { long: true }) +
          (run.completed_at ? ` · ${atTime}` : at ? ` · seen ${atTime}` : '')
        }
      >
        {formatRunWhen(run, now)}
      </td>
    </>
  )
}

// The best-runs table's dungeon cell: the banner art strip, or icon + level bar for
// dungeons without art (bar length = this run's key vs the table's highest key).
export function DungeonCell({ dungeon, run, topLevel }) {
  return (
    <td className={`name-cell ${dungeon.banner ? 'mp-banner-cell' : ''}`}>
      {dungeon.banner ? (
        // Art strip filling the whole cell (fixed size, so the name length never
        // changes where it starts or ends) with the name outlined on top.
        <div className={`mp-banner ${run ? '' : 'empty'}`} style={{ '--mp-banner': `url(${dungeonBannerUrl(dungeon.id)})` }}>
          <span className="mp-banner-name">{dungeon.name}</span>
        </div>
      ) : (
        <div className="bar-wrap">
          <div
            className="bar"
            style={{
              width: run ? `${(run.level / topLevel) * 100}%` : '0%',
              background: `linear-gradient(90deg, ${dungeon.colors[0]}, ${dungeon.colors[1]})`,
            }}
          />
          <DungeonIcon mapId={dungeon.id} />
          <span className="name">{dungeon.name}</span>
        </div>
      )}
    </td>
  )
}

// Placeholder cells for a dungeon with no run (matches RunCells' six columns).
export function EmptyRunCells() {
  return (
    <>
      <td className="num muted">—</td>
      <td className="num muted">—</td>
      <td className="muted" colSpan={3}>
        no run
      </td>
      <td className="num muted">—</td>
    </>
  )
}

export function Cols() {
  return (
    <colgroup>
      <col className="mp-col-dungeon" />
      <col className="mp-col-key" />
      <col className="mp-col-score" />
      <col className="mp-col-time" />
      <col className="mp-col-affixes" />
      <col />
      <col className="mp-col-day" />
    </colgroup>
  )
}

export function Head() {
  return (
    <thead>
      <tr>
        <th>Dungeon</th>
        <th className="num">Key</th>
        <th className="num" title="M+ score: 50 + 7.5 per key level, ± up to 12.5 for the clear time">
          Score
        </th>
        <th>Time</th>
        <th>Affixes</th>
        <th>Party</th>
        <th className="num">Date</th>
      </tr>
    </thead>
  )
}

const BEST_SORTS = [
  { id: 'score', label: 'Score' },
  { id: 'key', label: 'Key' },
]

// The card's three views, as one row of tabs so it is clear which one is open.
const VIEWS = [
  { id: 'best', label: 'Best runs' },
  { id: 'history', label: 'History' },
  { id: 'teammates', label: 'Teammates' },
]
const MATES_PAGE_SIZE = 15

// Everyone the player ran with, from their runs: how many runs together, how many of
// those were timed, and the best-scoring run together (ties: the faster clear). Most runs
// first, then most timed. A teammate is one realm + name, so namesakes stay apart.
function teammatesOf(runs, selfName, realm) {
  const byKey = new Map()
  for (const run of runs) {
    for (const p of run.party) {
      if (isMember(p, selfName, realm)) continue
      const memberRealm = p.realm || run.realm
      const key = `${memberRealm}|${p.name.toLowerCase()}`
      let m = byKey.get(key)
      if (!m) byKey.set(key, (m = { key, member: { ...p, realm: memberRealm }, runs: 0, timed: 0, best: null, bestScore: -1 }))
      m.runs += 1
      if (run.medal > 0) m.timed += 1
      const score = runScore(run) ?? 0
      const faster = m.best && score === m.bestScore && (run.time_ms ?? Infinity) < (m.best.time_ms ?? Infinity)
      if (score > m.bestScore || faster) {
        m.best = run
        m.bestScore = score
      }
      // Keep the most recent class/spec seen for the name colour and tooltip.
      if (!m.lastDay || run.day > m.lastDay) {
        m.lastDay = run.day
        m.member = { ...m.member, class: p.class || m.member.class, spec: p.spec || m.member.spec }
      }
    }
  }
  return [...byKey.values()].sort((x, y) => y.runs - x.runs || y.timed - x.timed || y.bestScore - x.bestScore)
}

function TeammatesTable({ mates, realm, onSelectPlayer }) {
  return (
    <table className="meter mp-mates">
      <thead>
        <tr>
          <th>Teammate</th>
          <th className="num">Runs</th>
          <th className="num">Timed</th>
          <th>Best run together</th>
        </tr>
      </thead>
      <tbody>
        {mates.map((m) => {
          const d = MPLUS_DUNGEONS.find((x) => x.id === m.best.map_id)
          return (
            <tr key={m.key}>
              <td className="mp-mate-name">
                {/* No role marker: it would only be their role in one of the runs. */}
                <Member p={{ ...m.member, role: null }} realm={realm} onSelectPlayer={onSelectPlayer} />
              </td>
              <td className="num strong">{m.runs}</td>
              <td className="num">{m.timed}</td>
              <td>
                <span className="mp-mate-best" title={`${d?.name || m.best.dungeon} +${m.best.level} · ${formatScore(m.bestScore)} score · ${formatRunDay(m.best.day, { long: true })}`}>
                  <DungeonIcon mapId={m.best.map_id} />
                  <span className="mp-mate-dname">{d?.short || d?.name || m.best.dungeon}</span>
                  <span className="mp-key strong">+{m.best.level}</span>
                  <span className={m.best.medal ? '' : 'muted'}>{formatRunTime(m.best.time_ms)}</span>
                  <Medal medal={m.best.medal} />
                </span>
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

// Page buttons: always first + last, plus a window around the current page.
function pageList(page, pages) {
  const out = []
  for (let p = 1; p <= pages; p++) {
    if (p === 1 || p === pages || Math.abs(p - page) <= 1) out.push(p)
    else if (out[out.length - 1] !== '…') out.push('…')
  }
  return out
}

export function Pager({ page, pages, onChange }) {
  if (pages <= 1) return null
  return (
    <div className="mp-pager">
      <button className="mp-page" disabled={page === 1} onClick={() => onChange(page - 1)}>
        ‹ Prev
      </button>
      {pageList(page, pages).map((p, i) =>
        p === '…' ? (
          <span key={`gap${i}`} className="mp-page-gap">
            …
          </span>
        ) : (
          <button key={p} className={`mp-page ${p === page ? 'on' : ''}`} onClick={() => onChange(p)}>
            {p}
          </button>
        ),
      )}
      <button className="mp-page" disabled={page === pages} onClick={() => onChange(page + 1)}>
        Next ›
      </button>
    </div>
  )
}

// Green up / red down arrow with the number of places a player moved in a ranking in the
// last rankings update, shown only when their own score changed in it (prev is null for
// players who were merely passed). The slot is always rendered so rank numbers line up.
export function RankMove({ rank, prev, keepSlot = true }) {
  const moved = prev == null || rank == null ? 0 : prev - rank
  if (!moved) return keepSlot ? <span className="mr-move" /> : null
  const places = Math.abs(moved).toLocaleString('en-US')
  return (
    <span
      className={`mr-move ${moved > 0 ? 'up' : 'down'}`}
      title={`${moved > 0 ? 'Up' : 'Down'} ${places} since the last update (was #${prev.toLocaleString('en-US')})`}
    >
      {moved > 0 ? '▲' : '▼'}
      {places}
    </span>
  )
}

// "#12" chip with what the rank is among, e.g. label "Fury" → "#12 Fury" (of 348 in the tooltip).
// With `to` (a rankings selection) the chip is a link that opens the M+ rankings on that
// list, on the page this player is on.
function RankChip({ label, rank, prev, total, title, to, onOpen }) {
  if (!rank) return null
  const tip = `${title}: #${rank.toLocaleString('en-US')} of ${total.toLocaleString('en-US')}`
  const inner = (
    <>
      <span className="mp-rank-num">#{rank.toLocaleString('en-US')}</span>
      <span className="mp-rank-label">{label}</span>
      <RankMove rank={rank} prev={prev} keepSlot={false} />
    </>
  )
  if (!to || !onOpen) {
    return (
      <span className="mp-rank" title={tip}>
        {inner}
      </span>
    )
  }
  return (
    <a
      className="mp-rank link"
      title={`${tip} · open the rankings`}
      href={selectionToHash({ view: 'mplus', ...to })}
      onClick={inAppClick(() => onOpen(to))}
    >
      {inner}
    </a>
  )
}

// History's dungeon filter: one small icon per dungeon; click to show only that dungeon's
// runs, click it again (or another) to change. Dungeons with no runs are greyed out.
function DungeonFilter({ value, counts, onChange }) {
  return (
    <div className="mp-dfilter" role="group" aria-label="Filter history by dungeon">
      {MPLUS_DUNGEONS.map((d) => {
        const n = counts.get(d.id) || 0
        return (
          <button
            key={d.id}
            className={`mp-dfilter-btn ${value === d.id ? 'on' : ''}`}
            disabled={!n && value !== d.id}
            aria-pressed={value === d.id}
            title={`${d.name}: ${n} ${n === 1 ? 'run' : 'runs'}`}
            onClick={() => onChange(value === d.id ? null : d.id)}
          >
            <img src={dungeonIconUrl(d.id)} alt={d.name} />
          </button>
        )
      })}
    </div>
  )
}

// The profile's Mythic+ section: best run per dungeon (highest score, then fastest time)
// with the player's total M+ score and rankings, or the full run history, newest first,
// 10 per page, optionally narrowed to one dungeon. Paging and the Best/History switch only
// re-render this card; the runs are fetched once per player. The parent keys it by player,
// so opening another profile starts fresh on Best runs, page 1.
export default function MythicPlusCard({ player, klass, onSelectPlayer, onSelectRankings }) {
  const { name, realm } = splitPlayerKey(player)
  const selfName = name.toLowerCase()
  const [state, setState] = useState({ loading: true, runs: [], error: null })
  const [ranks, setRanks] = useState({})
  const [view, setView] = useState('best')
  const [bestSort, setBestSort] = useState('score') // 'score' | 'key'
  const [spec, setSpec] = useState(null) // null = All specs
  const [dungeon, setDungeon] = useState(null) // history only: a map id, null = all dungeons
  const [page, setPage] = useState(1)
  // Teammates search: find one name among everyone they've run with (accent-free).
  const [mateQuery, setMateQuery] = useState('')

  useEffect(() => {
    let cancelled = false
    getPlayerRuns(player)
      .then((runs) => !cancelled && setState({ loading: false, runs, error: null }))
      .catch((e) => !cancelled && setState({ loading: false, runs: [], error: e.message || 'Request failed.' }))
    // Rankings are a nice-to-have next to the score: if they fail, the card just omits them.
    getPlayerRanks(player)
      .then((r) => !cancelled && setRanks(r))
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [player])

  const { loading, runs: allRuns } = state
  // This player's own party entry in a run (carries the spec they played).
  const selfIn = (run) => run.party.find((p) => isMember(p, selfName, realm))
  // Class from the profile, else from the runs themselves (M+-only players have no profile).
  const playerClass = klass || allRuns.map(selfIn).find((p) => p?.class)?.class || null
  const specTabs = useMemo(
    () => specsOf(playerClass).map((s) => ({ spec: s.name, icon: specIconUrl(playerClass, s.name) })),
    [playerClass],
  )
  // A spec filter narrows EVERYTHING below: best runs, history and the score total.
  // Runs whose spec isn't known yet (see scrape-mythic-plus.mjs) only show under All.
  const runs = useMemo(
    () => (spec ? allRuns.filter((r) => selfIn(r)?.spec === spec) : allRuns),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allRuns, spec, selfName],
  )
  const unknownSpec = spec ? allRuns.filter((r) => !selfIn(r)?.spec).length : 0
  // Runs counted under this spec on an ASSUMED spec (the player's last known one), because
  // Tauri Achievements hasn't published the real one yet. See refresh_mplus_scores.
  const assumedSpec = spec ? runs.filter((r) => selfIn(r)?.spec_guess).length : 0
  // The total is always built from the best SCORE per dungeon, whichever sort is shown.
  const bestByScore = useMemo(() => bestRuns(runs, 'score'), [runs])
  const best = useMemo(() => (bestSort === 'key' ? bestRuns(runs, 'key') : bestByScore), [runs, bestSort, bestByScore])
  // History: the spec's runs, optionally one dungeon's. Counts feed the filter's tooltips.
  const dungeonCounts = useMemo(() => {
    const m = new Map()
    for (const r of runs) m.set(r.map_id, (m.get(r.map_id) || 0) + 1)
    return m
  }, [runs])
  const history = useMemo(
    () => sortRunsByRecent(dungeon ? runs.filter((r) => r.map_id === dungeon) : runs),
    [runs, dungeon],
  )
  const allMates = useMemo(() => teammatesOf(runs, selfName, realm), [runs, selfName, realm])
  const mates = useMemo(() => {
    const q = foldName(mateQuery.trim())
    return q ? allMates.filter((m) => foldName(m.member.name).includes(q)) : allMates
  }, [allMates, mateQuery])
  const pageSize = view === 'teammates' ? MATES_PAGE_SIZE : PAGE_SIZE
  const pages = Math.max(1, Math.ceil((view === 'teammates' ? mates.length : history.length) / pageSize))
  const pageRuns = history.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const pageMates = mates.slice((page - 1) * MATES_PAGE_SIZE, page * MATES_PAGE_SIZE)
  // The history table always shows as many rows as an unfiltered page would (blank filler
  // rows make up the difference), so a short last page, a spec with few runs or a dungeon
  // filter never changes the card's height and the page doesn't jump under the cursor.
  const historyRows = Math.min(PAGE_SIZE, allRuns.length)
  const fillers = Math.max(0, historyRows - (history.length ? pageRuns.length : 1))
  const done = best.filter((b) => b.run).length
  const total = playerScore(bestByScore)
  const topLevel = Math.max(1, ...best.map((b) => b.run?.level || 0))
  const cellProps = { selfName, realm, onSelectPlayer }
  const dungeonName = dungeon ? MPLUS_DUNGEONS.find((d) => d.id === dungeon)?.name : null
  const rank = ranks[spec || '']
  // The class the rankings file this player under (their most recent run's).
  const rankClass = rank?.class || playerClass || null

  let body
  if (loading) {
    body = <div className="empty-state mp-empty">Loading Mythic+ runs…</div>
  } else if (state.error) {
    body = <div className="error">Couldn’t load Mythic+ runs: {state.error}</div>
  } else if (!allRuns.length) {
    body = (
      <div className="empty-state mp-empty">
        <p>No Mythic+ runs on the Tauri armory for {name} yet.</p>
      </div>
    )
  } else if (view === 'teammates') {
    const search = allMates.length > 0 && (
      <div className="mp-mate-search">
        <input
          type="search"
          placeholder="Search teammates…"
          value={mateQuery}
          onChange={(e) => {
            setMateQuery(e.target.value)
            setPage(1)
          }}
          aria-label="Search teammates"
        />
        {mateQuery.trim() && (
          <span className="muted small">
            {mates.length ? `${mates.length} of ${allMates.length}` : `Not in any of ${name}’s ${spec ? `${spec} ` : ''}runs`}
          </span>
        )}
      </div>
    )
    body = mates.length ? (
      <>
        {search}
        <div className="table-scroll">
          <TeammatesTable mates={pageMates} realm={realm} onSelectPlayer={onSelectPlayer} />
        </div>
        <Pager page={page} pages={pages} onChange={setPage} />
      </>
    ) : allMates.length ? (
      search
    ) : (
      <div className="empty-state mp-empty">
        <p>No {spec ? `${spec} ` : ''}runs with a party yet.</p>
      </div>
    )
  } else if (view === 'best') {
    // A spec with no runs keeps the same table, every dungeon greyed out as "no run".
    body = (
      <div className="table-scroll">
        <table className="meter mp-meter">
          <Cols />
          <Head />
          <tbody>
            {best.map(({ dungeon: d, run }) => (
              <tr key={d.id}>
                <DungeonCell dungeon={d} run={run} topLevel={topLevel} />
                {run ? <RunCells run={run} {...cellProps} /> : <EmptyRunCells />}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  } else {
    body = (
      <>
        <div className="table-scroll">
          <table className="meter mp-meter">
            <Cols />
            <Head />
            <tbody>
              {pageRuns.map((run) => (
                <tr key={run.id} className="mp-hrow">
                  <td className="name-cell">
                    <div className="mp-dname">
                      <DungeonIcon mapId={run.map_id} />
                      <span className="name">{run.dungeon}</span>
                    </div>
                  </td>
                  <RunCells run={run} {...cellProps} />
                </tr>
              ))}
              {!history.length && (
                <tr className="mp-filler">
                  <td className="muted" colSpan={7}>
                    No {spec ? `${spec} ` : ''}runs{dungeonName ? ` in ${dungeonName}` : ''} yet.
                  </td>
                </tr>
              )}
              {Array.from({ length: fillers }, (_, i) => (
                <tr key={`filler${i}`} className="mp-filler" aria-hidden="true">
                  <td colSpan={7}>&nbsp;</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/* The pager's space is kept whenever the unfiltered history has one, so filtering
            down to a single page doesn't shrink the card. */}
        {allRuns.length > PAGE_SIZE &&
          (pages > 1 ? (
            <Pager page={page} pages={pages} onChange={setPage} />
          ) : (
            <div className="mp-pager mp-pager-ghost" aria-hidden="true">
              <button className="mp-page" disabled tabIndex={-1}>
                ‹ Prev
              </button>
              <button className="mp-page on" disabled tabIndex={-1}>
                1
              </button>
            </div>
          ))}
      </>
    )
  }

  return (
    <div className="player-card mp-card">
      <div className="card-head mp-head">
        <h3 className="mp-title">
          Mythic+
          {!loading && !state.error && allRuns.length > 0 && (
            <span
              className="mp-total"
              title="M+ score: the sum of the best run score in each dungeon (same scoring as Tauri Achievements)"
            >
              <span className="mp-total-label">Score</span>
              {runs.length ? formatScore(total) : '—'}
            </span>
          )}
          {!loading && !state.error && runs.length > 0 && rank && (
            <span className="mp-ranks">
              {spec ? (
                <RankChip
                  label={`${spec}${playerClass ? ` ${playerClass}` : ''}`}
                  rank={rank.rank}
                  prev={rank.prevRank}
                  total={rank.total}
                  title={`${spec}${playerClass ? ` ${playerClass}s` : ''} by ${spec} score`}
                  to={rankClass ? { klass: rankClass, spec, focus: player } : null}
                  onOpen={onSelectRankings}
                />
              ) : (
                <>
                  <RankChip
                    label="Overall"
                    rank={rank.rank}
                    prev={rank.prevRank}
                    total={rank.total}
                    title="All players by M+ score"
                    to={{ focus: player }}
                    onOpen={onSelectRankings}
                  />
                  <RankChip
                    label={rank.class || playerClass || 'Class'}
                    rank={rank.classRank}
                    prev={rank.prevClassRank}
                    total={rank.classTotal || 0}
                    title={`${rank.class || playerClass || 'Class'} players by M+ score`}
                    to={rankClass ? { klass: rankClass, focus: player } : null}
                    onOpen={onSelectRankings}
                  />
                </>
              )}
            </span>
          )}
        </h3>
        <div className="mp-head-right">
          {!loading && !state.error && (
            <span className="muted">
              {view === 'best'
                ? `${done} of ${MPLUS_DUNGEONS.length} dungeons`
                : view === 'teammates'
                  ? `${allMates.length} ${allMates.length === 1 ? 'teammate' : 'teammates'}`
                  : `${history.length} ${history.length === 1 ? 'run' : 'runs'} · page ${page} of ${pages}`}
            </span>
          )}
          <div className="mp-view-toggle" role="tablist" aria-label="Mythic+ view">
            {VIEWS.map((v) => (
              <button
                key={v.id}
                role="tab"
                aria-selected={view === v.id}
                className={`seg ${view === v.id ? 'on' : ''}`}
                onClick={() => {
                  setView(v.id)
                  setPage(1)
                }}
              >
                {v.label}
                {v.id === 'history' && runs.length ? ` (${runs.length})` : ''}
              </button>
            ))}
          </div>
        </div>
      </div>
      {!loading && !state.error && allRuns.length > 0 && (

        <div className="mp-spec-row">
          {specTabs.length > 0 && (
            <SpecTabs
              specs={specTabs}
              value={spec}
              onChange={(s) => {
                setSpec(s)
                setPage(1)
              }}
            />
          )}
          {view === 'best' && (
            <div className="mp-sort-toggle" role="group" aria-label="Pick each dungeon's best run by">
              <span className="mp-sort-toggle-label">Best by</span>
              {BEST_SORTS.map((o) => (
                <button key={o.id} className={`seg ${bestSort === o.id ? 'on' : ''}`} onClick={() => setBestSort(o.id)}>
                  {o.label}
                </button>
              ))}
            </div>
          )}
          {view === 'history' && (
            <DungeonFilter
              value={dungeon}
              counts={dungeonCounts}
              onChange={(d) => {
                setDungeon(d)
                setPage(1)
              }}
            />
          )}
          {assumedSpec > 0 && (
            <span
              className="muted mp-spec-note"
              title="Tauri Achievements publishes each run's spec about a day later. Until then a new run counts for the spec last played in that role, and is corrected if that turns out wrong."
            >
              {assumedSpec} recent {assumedSpec === 1 ? 'run is' : 'runs are'} assumed {spec}
            </span>
          )}
          {unknownSpec > 0 && (
            <span className="muted mp-spec-note" title="Specs come from Tauri Achievements, which updates about once a day">
              {unknownSpec} recent {unknownSpec === 1 ? 'run has' : 'runs have'} no spec yet
            </span>
          )}
        </div>
      )}
      {body}
    </div>
  )
}
