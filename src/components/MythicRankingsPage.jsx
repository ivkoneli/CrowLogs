// Mythic+ rankings: players by M+ score, 25 per page, filterable by class, spec and realm
// (a dropdown that lists every class with its specs, or the population tiles below it).
// Each row shows the player's best run in every dungeon as "key + medal" (hover for that
// run's score and time). Filters, page and the highlighted player all live in the URL
// (#/mplus?class=…&spec=…&realm=…&q=…&page=…&player=…), so a view can be shared and the
// profile's rank chips can link straight to a player's row.
import { useEffect, useState } from 'react'
import {
  MPLUS_DUNGEONS,
  MPLUS_REALMS,
  MEDALS,
  RANKINGS_PAGE_SIZE,
  getLeaderboard,
  getPopulation,
  dungeonIconUrl,
  formatScore,
  formatRunTime,
  splitPlayerKey,
  memberPlayerKey,
} from '../lib/mythicplus.js'
import { LEGION_CLASSES, classColor, specsOf, specIconUrl } from '../lib/classes.js'
import { selectionToHash, inAppClick } from '../lib/router.js'
import { Medal, Pager } from './MythicPlusCard.jsx'

// Realm slug → short label for the filter and the tag after a name.
const REALM_LABELS = { evermoon: 'Evermoon', tauri: 'Tauri', wod: 'WoD' }
const SLUG_OF_REALM = Object.fromEntries(Object.entries(MPLUS_REALMS).map(([slug, realm]) => [realm, slug]))
// Non-breaking spaces that indent a spec under its class in the dropdown (a plain
// space would be collapsed by the browser).
const SPEC_INDENT = '\u00a0\u00a0\u00a0\u00a0'

function Field({ label, value, onChange, children }) {
  return (
    <label className="filter-field">
      <span className="field-label">{label}</span>
      <span className="select-wrap">
        <select value={value || ''} onChange={(e) => onChange(e.target.value)}>
          {children}
        </select>
        <span className="caret">▾</span>
      </span>
    </label>
  )
}

// Population tiles: every class as a block, split into its specs, each sized by how many
// players have a score in it (a spec's width within its class, a class's share of its
// row). Clicking a class header filters to the class, a spec tile to that spec; clicking
// the active one again clears it.
function PopulationTiles({ population, klass, spec, onPick }) {
  const classes = LEGION_CLASSES.map((c) => ({ name: c.name, ...(population.get(c.name) || { players: 0, specs: new Map() }) }))
    .filter((c) => c.players > 0)
    .sort((a, b) => b.players - a.players)
  if (!classes.length) return null
  // Every block's starting width is its share of ALL players, times the number of rows the
  // CSS wants (--mr-rows): blocks then wrap into about that many rows on one common scale,
  // so sizes compare across rows too, not just inside a row.
  const total = classes.reduce((sum, c) => sum + c.players, 0)
  const share = (c) => ((c.players / total) * 100).toFixed(3)
  return (
    <div className="mr-pop" role="group" aria-label="Filter by class and spec">
      {classes.map((c) => {
        const color = classColor(c.name)
        const specs = specsOf(c.name)
          .map((s) => ({ name: s.name, players: c.specs.get(s.name) || 0 }))
          .filter((s) => s.players > 0)
          .sort((a, b) => b.players - a.players)
        const classOn = klass === c.name
        return (
          <div
            key={c.name}
            className={`mr-pop-class ${classOn ? 'on' : ''}`}
            style={{
              flexGrow: c.players,
              // 0.9: slack for the space a wrapped row can't use, so the blocks really fit in
              // --mr-rows rows. A block may grow to fill its row, but only by a fifth — a
              // class left alone on the last row stays its true size instead of spanning it.
              flexBasis: `calc(${share(c)}% * var(--mr-rows) * 0.9)`,
              maxWidth: `calc(${share(c)}% * var(--mr-rows) * 0.9 * 1.2)`,
              '--class-color': color,
            }}
          >
            <button
              className={`mr-pop-head ${classOn && !spec ? 'on' : ''}`}
              onClick={() => onPick(classOn && !spec ? { klass: null, spec: null } : { klass: c.name, spec: null })}
              title={`${c.name}: ${c.players.toLocaleString('en-US')} players · show all ${c.name}s`}
            >
              <span className="mr-pop-name">{c.name}</span>
              <span className="mr-pop-count">{c.players.toLocaleString('en-US')}</span>
            </button>
            <div className="mr-pop-specs">
              {specs.map((s) => {
                const on = classOn && spec === s.name
                return (
                  <button
                    key={s.name}
                    className={`mr-pop-spec ${on ? 'on' : ''}`}
                    style={{ flexGrow: s.players }}
                    onClick={() => onPick(on ? { klass: c.name, spec: null } : { klass: c.name, spec: s.name })}
                    title={`${s.name} ${c.name}: ${s.players.toLocaleString('en-US')} players`}
                  >
                    <img src={specIconUrl(c.name, s.name)} alt="" />
                    <span className="mr-pop-spec-name">{s.name}</span>
                    <span className="mr-pop-spec-count">{s.players.toLocaleString('en-US')}</span>
                  </button>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// One dungeon's best run for a player: "+14" and the medal. `run` = [level, medal, score, ms].
function BestCell({ dungeon, run }) {
  if (!run) return <td className="mr-cell empty">—</td>
  const [level, medal, score, ms] = run
  const m = MEDALS[medal] || MEDALS[0]
  return (
    <td
      className={`mr-cell ${medal ? '' : 'depleted'}`}
      title={`${dungeon.name} +${level}\nScore ${formatScore(score)}\n${formatRunTime(ms)} · ${m.label}${m.note ? ` (${m.note})` : ''}`}
    >
      <span className="mr-key">+{level}</span>
      <Medal medal={medal} />
    </td>
  )
}

export default function MythicRankingsPage({ klass, spec, realm, search, page, focus, onNavigate, onSelectPlayer }) {
  const [state, setState] = useState({ loading: true, rows: [], error: null })
  const [population, setPopulation] = useState(null)
  // What's typed in the search box. The applied search lives in the URL (`search`); typing
  // updates it after a short pause, and Back/Forward or a shared link fills the box.
  const [text, setText] = useState(search || '')
  useEffect(() => setText(search || ''), [search])
  const query = (search || '').trim().length >= 2 ? search.trim() : null
  const armoryRealm = realm ? MPLUS_REALMS[realm] || null : null
  // A highlighted player with no explicit page = "open the page they're on".
  const find = focus && !page ? splitPlayerKey(focus) : null
  const findName = find?.name || null
  const findRealm = find?.realm || null

  useEffect(() => {
    let cancelled = false
    setState((s) => ({ ...s, loading: true, error: null }))
    getLeaderboard({ klass, spec, realm: armoryRealm, page: page || 1, findName, findRealm, search: query })
      .then((rows) => !cancelled && setState({ loading: false, rows, error: null }))
      .catch((e) => !cancelled && setState({ loading: false, rows: [], error: e.message || 'Request failed.' }))
    return () => {
      cancelled = true
    }
  }, [klass, spec, armoryRealm, page, findName, findRealm, query])

  // Tile sizes follow the realm filter (not class/spec/search: they ARE the class picker).
  useEffect(() => {
    let cancelled = false
    getPopulation(armoryRealm)
      .then((p) => !cancelled && setPopulation(p))
      .catch(() => !cancelled && setPopulation(null))
    return () => {
      cancelled = true
    }
  }, [armoryRealm])

  const { loading, rows, error } = state
  // A page past the end (an old link, or a search that now has fewer matches) has no rows:
  // fall back to page 1 rather than showing an empty list.
  const pastEnd = !loading && !error && rows.length === 0 && page > 1
  useEffect(() => {
    if (pastEnd) onNavigate({ klass, spec, realm, search, focus, page: null }, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pastEnd])
  const total = rows[0]?.total || 0
  const pages = Math.max(1, Math.ceil(total / RANKINGS_PAGE_SIZE))
  // The page actually shown: explicit, or wherever the highlighted player turned out to be.
  const shownPage = page || (rows[0] ? Math.floor((rows[0].rank - 1) / RANKINGS_PAGE_SIZE) + 1 : 1)
  const focusKey = focus ? focus.toLowerCase() : null

  // Changing a filter starts over on page 1 and drops the highlight; paging keeps both.
  const setFilter = (patch) => onNavigate({ klass, spec, realm, search, ...patch, page: null, focus: null })
  const setPage = (p) => onNavigate({ klass, spec, realm, search, focus, page: p })

  // Apply the typed search once typing pauses. It replaces the current history entry, so
  // a search is one Back step however many letters it took.
  useEffect(() => {
    const next = text.trim() || null
    if (next === (search || null)) return
    const t = setTimeout(
      () => onNavigate({ klass, spec, realm, search: next, page: null, focus: null }, { replace: true }),
      300,
    )
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text])

  const scope = [realm ? REALM_LABELS[realm] : null, spec, klass].filter(Boolean).join(' ') || 'All players'
  const scoreTitle = spec
    ? `${spec} score: the sum of the best run played as ${spec} in each dungeon`
    : 'M+ score: the sum of the best run in each dungeon'

  return (
    <div className="mr-page">
      <div className="page-head">
        <div className="kicker">Tauri Legion · Mythic+</div>
        <h2>Mythic+ rankings</h2>
        <p className="kills">
          {scope}
          {query
            ? ` · ${total.toLocaleString('en-US')} ${total === 1 ? 'match' : 'matches'} for “${query}”`
            : total > 0 && ` · ${total.toLocaleString('en-US')} ${total === 1 ? 'player' : 'players'}`}
        </p>
      </div>

      <div className="filter-bar mr-filters">
        {/* One dropdown for class AND spec: each class, then its specs indented under it. */}
        <Field
          label="Class / spec"
          value={klass ? (spec ? `${klass}|${spec}` : klass) : ''}
          onChange={(v) => {
            const [c, s] = v.split('|')
            setFilter({ klass: c || null, spec: s || null })
          }}
        >
          <option value="">All classes</option>
          {LEGION_CLASSES.flatMap((c) => [
            <option key={c.name} value={c.name}>
              {c.name}
            </option>,
            ...specsOf(c.name).map((s) => (
              <option key={`${c.name}|${s.name}`} value={`${c.name}|${s.name}`}>
                {SPEC_INDENT}
                {s.name}
              </option>
            )),
          ])}
        </Field>
        <Field label="Realm" value={realm} onChange={(v) => setFilter({ realm: v || null })}>
          <option value="">All realms</option>
          {Object.keys(MPLUS_REALMS).map((slug) => (
            <option key={slug} value={slug}>
              {REALM_LABELS[slug] || slug}
            </option>
          ))}
        </Field>
        <label className="filter-field mr-search">
          <span className="field-label">Player</span>
          <span className="mr-search-box">
            <input
              type="search"
              placeholder="Search this list…"
              value={text}
              onChange={(e) => setText(e.target.value)}
              aria-label="Search players in this ranking"
            />
          </span>
        </label>
      </div>

      {population && <PopulationTiles population={population} klass={klass} spec={spec} onPick={setFilter} />}

      {error ? (
        <div className="error">Couldn’t load the rankings: {error}</div>
      ) : loading && !rows.length ? (
        <div className="empty-state">Loading rankings…</div>
      ) : !rows.length ? (
        <div className="empty-state">
          {query
            ? `No player matching “${query}” in ${scope === 'All players' ? 'the rankings' : `the ${scope} rankings`}.`
            : `No ${scope === 'All players' ? '' : `${scope} `}players have a Mythic+ run yet.`}
        </div>
      ) : (
        <>
          <div className={`table-scroll ${loading ? 'mr-loading' : ''}`}>
            <table className="meter mr-table">
              <thead>
                <tr>
                  <th className="rank">#</th>
                  <th>Player</th>
                  <th className="num" title={scoreTitle}>
                    Score
                  </th>
                  {MPLUS_DUNGEONS.map((d) => (
                    <th key={d.id} className="mr-dhead" title={d.name}>
                      <img src={dungeonIconUrl(d.id)} alt="" />
                      <span>{d.short}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const key = memberPlayerKey(r.name, r.realm)
                  const rowSpec = r.spec || null
                  return (
                    <tr key={`${r.realm}|${r.name}`} className={key.toLowerCase() === focusKey ? 'mr-focus' : undefined}>
                      <td className="rank">{r.rank.toLocaleString('en-US')}</td>
                      <td className="mr-player">
                        {rowSpec && <img className="mr-spec-icon" src={specIconUrl(r.class, rowSpec)} alt="" title={`${rowSpec} ${r.class || ''}`} />}
                        <a
                          className="name link"
                          style={r.class ? { color: classColor(r.class) } : undefined}
                          href={selectionToHash({ view: 'player', player: key })}
                          onClick={inAppClick(() => onSelectPlayer(key))}
                          title={`${[rowSpec, r.class].filter(Boolean).join(' ')} · open ${r.name}'s profile`}
                        >
                          {r.name}
                        </a>
                        {/* The realm is only worth a tag when the list mixes realms. */}
                        {!realm && SLUG_OF_REALM[r.realm] !== 'evermoon' && (
                          <span className="mr-realm">{REALM_LABELS[SLUG_OF_REALM[r.realm]] || r.realm}</span>
                        )}
                      </td>
                      <td className="num mp-score">{formatScore(r.score)}</td>
                      {MPLUS_DUNGEONS.map((d) => (
                        <BestCell key={d.id} dungeon={d} run={r.best?.[d.id]} />
                      ))}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <Pager page={shownPage} pages={pages} onChange={setPage} />
        </>
      )}
    </div>
  )
}
