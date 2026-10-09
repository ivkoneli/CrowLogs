import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  MPLUS_DUNGEONS,
  MEDALS,
  medalIconUrl,
  dungeonIconUrl,
  dungeonBannerUrl,
  getPlayerRuns,
  bestRuns,
  runScore,
  playerScore,
  formatScore,
  sortRunsByRecent,
  formatRunTime,
  formatRunDay,
  splitPlayerKey,
  memberPlayerKey,
} from '../lib/mythicplus.js'
import { classColor, specsOf, specIconUrl } from '../lib/classes.js'
import SpecTabs from './SpecTabs.jsx'
import { selectionToHash, inAppClick } from '../lib/router.js'

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

function Medal({ medal }) {
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

function Member({ p, selfName, realm, onSelectPlayer }) {
  const isSelf = p.name.toLowerCase() === selfName
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
          href={selectionToHash({ view: 'player', player: memberPlayerKey(p.name, realm) })}
          onClick={inAppClick(() => onSelectPlayer(memberPlayerKey(p.name, realm)))}
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
function Party({ party, ...memberProps }) {
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

// Key / time+medal / affixes / party / date — shared by the best-runs and history tables.
export function RunCells({ run, selfName, realm, onSelectPlayer }) {
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
      <td className="num muted mp-day" title={formatRunDay(run.day, { long: true })}>
        {formatRunDay(run.day)}
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
  { id: 'score', label: 'Highest score' },
  { id: 'key', label: 'Highest key' },
]

// The "best runs" half of the view toggle, as a dropdown: picking a sort also switches to
// the best-runs view. Closes on outside click and Escape.
function BestSortDropdown({ active, sort, onPick }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e) => !ref.current?.contains(e.target) && setOpen(false)
    const onKey = (e) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  const current = BEST_SORTS.find((s) => s.id === sort) || BEST_SORTS[0]
  return (
    <div className="mp-sort" ref={ref}>
      <button
        className={`seg mp-sort-btn ${active ? 'on' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {current.label}
        <span className={`mp-sort-caret ${open ? 'open' : ''}`}>▾</span>
      </button>
      {open && (
        <ul className="mp-sort-menu" role="listbox">
          {BEST_SORTS.map((s) => (
            <li key={s.id} role="option" aria-selected={s.id === sort}>
              <button
                className={s.id === sort && active ? 'on' : ''}
                onClick={() => {
                  onPick(s.id)
                  setOpen(false)
                }}
              >
                {s.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
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

function Pager({ page, pages, onChange }) {
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

// The profile's Mythic+ section: best run per dungeon (highest score, then fastest time)
// with the player's total M+ score, or the full run history, newest first, 10 per page. Paging and the Best/History
// switch only re-render this card; the runs are fetched once per player. The parent keys
// it by player, so opening another profile starts fresh on Best runs, page 1.
export default function MythicPlusCard({ player, klass, onSelectPlayer }) {
  const { name, realm } = splitPlayerKey(player)
  const selfName = name.toLowerCase()
  const [state, setState] = useState({ loading: true, runs: [], error: null })
  const [view, setView] = useState('best')
  const [bestSort, setBestSort] = useState('score') // 'score' | 'key'
  const [spec, setSpec] = useState(null) // null = All specs
  const [page, setPage] = useState(1)

  useEffect(() => {
    let cancelled = false
    getPlayerRuns(player)
      .then((runs) => !cancelled && setState({ loading: false, runs, error: null }))
      .catch((e) => !cancelled && setState({ loading: false, runs: [], error: e.message || 'Request failed.' }))
    return () => {
      cancelled = true
    }
  }, [player])

  const { loading, runs: allRuns } = state
  // This player's own party entry in a run (carries the spec they played).
  const selfIn = (run) => run.party.find((p) => p.name.toLowerCase() === selfName)
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
  // The total is always built from the best SCORE per dungeon, whichever sort is shown.
  const bestByScore = useMemo(() => bestRuns(runs, 'score'), [runs])
  const best = useMemo(() => (bestSort === 'key' ? bestRuns(runs, 'key') : bestByScore), [runs, bestSort, bestByScore])
  const history = useMemo(() => sortRunsByRecent(runs), [runs])
  const pages = Math.max(1, Math.ceil(history.length / PAGE_SIZE))
  const pageRuns = history.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const done = best.filter((b) => b.run).length
  const total = playerScore(bestByScore)
  const topLevel = Math.max(1, ...best.map((b) => b.run?.level || 0))
  const cellProps = { selfName, realm, onSelectPlayer }

  let body
  if (loading) {
    body = <div className="empty-state mp-empty">Loading Mythic+ runs…</div>
  } else if (state.error) {
    body = <div className="error">Couldn’t load Mythic+ runs: {state.error}</div>
  } else if (!runs.length) {
    body = (
      <div className="empty-state mp-empty">
        <p>{spec ? `No ${spec} runs for ${name} yet.` : `No Mythic+ runs on the Tauri armory for ${name} yet.`}</p>
      </div>
    )
  } else if (view === 'best') {
    body = (
      <div className="table-scroll">
        <table className="meter mp-meter">
          <Cols />
          <Head />
          <tbody>
            {best.map(({ dungeon, run }) => (
              <tr key={dungeon.id}>
                <DungeonCell dungeon={dungeon} run={run} topLevel={topLevel} />
                {run ? (
                  <RunCells run={run} {...cellProps} />
                ) : (
                  <EmptyRunCells />
                )}
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
                <tr key={run.id}>
                  <td className="name-cell">
                    <div className="mp-dname">
                      <DungeonIcon mapId={run.map_id} />
                      <span className="name">{run.dungeon}</span>
                    </div>
                  </td>
                  <RunCells run={run} {...cellProps} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pager page={page} pages={pages} onChange={setPage} />
      </>
    )
  }

  return (
    <div className="player-card mp-card">
      <div className="card-head mp-head">
        <h3 className="mp-title">
          Mythic+
          {!loading && !state.error && runs.length > 0 && (
            <span
              className="mp-total"
              title="M+ score: the sum of the best run score in each dungeon (same scoring as Tauri Achievements)"
            >
              <span className="mp-total-label">Score</span>
              {formatScore(total)}
            </span>
          )}
        </h3>
        <div className="mp-head-right">
          {!loading && !state.error && (
            <span className="muted">
              {view === 'best'
                ? `${done} of ${MPLUS_DUNGEONS.length} dungeons`
                : `${history.length} ${history.length === 1 ? 'run' : 'runs'} · page ${page} of ${pages}`}
            </span>
          )}
          <div className="mp-view-toggle">
            {/* Absolutely positioned above the toggle, so the header keeps its height. */}
            <span className="mp-sort-label" aria-hidden="true">
              Sort by
            </span>
            <BestSortDropdown
              active={view === 'best'}
              sort={bestSort}
              onPick={(s) => {
                setBestSort(s)
                setView('best')
              }}
            />
            <button className={`seg ${view === 'history' ? 'on' : ''}`} onClick={() => setView('history')}>
              History{runs.length ? ` (${runs.length})` : ''}
            </button>
          </div>
        </div>
      </div>
      {!loading && !state.error && allRuns.length > 0 && specTabs.length > 0 && (
        <div className="mp-spec-row">
          <SpecTabs
            specs={specTabs}
            value={spec}
            onChange={(s) => {
              setSpec(s)
              setPage(1)
            }}
          />
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
