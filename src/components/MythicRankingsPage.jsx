// Mythic+ rankings: players by M+ score, 25 per page, filterable by class, spec and realm
// (a dropdown that lists every class with its specs, or the spec-popularity chart below it).
// Each row shows the player's best run in every dungeon as "key + medal" (hover for that
// run's score and time). Filters, page and the highlighted player all live in the URL
// (#/mplus?class=…&spec=…&realm=…&guild=…&q=…&page=…&player=…), so a view can be shared and the
// profile's rank chips can link straight to a player's row.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  MPLUS_DUNGEONS,
  MPLUS_REALMS,
  MEDALS,
  RANKINGS_PAGE_SIZE,
  getLeaderboard,
  getPopulation,
  getGuilds,
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

// A "nice" axis step for a maximum of `max` percent: about four gridlines.
function niceStep(max) {
  for (const s of [0.5, 1, 2, 5, 10, 20, 25]) if (max / s <= 5) return s
  return 50
}
const pct = (v) => `${v.toFixed(1)}%`

// Spec popularity: one group of pillars per class, one pillar per spec, its height the
// share of all ranked players whose main spec it is (each player counts once, so a class's
// pillars add up to the class and the classes to 100%). With a key filter, only players
// who timed a key that high are counted. Classes are ordered by size; the number over a group is its tallest
// pillar, the one under the name the class's own share. Clicking a pillar (or its icon)
// filters the rankings to that spec, the class name to the whole class; clicking the
// active one again clears it. Colors are the game's class colors.
function PopulationChart({ population, klass, spec, minKey, onPick }) {
  const classes = LEGION_CLASSES.map((c) => ({ name: c.name, ...(population.get(c.name) || { players: 0, specs: new Map() }) }))
    .sort((a, b) => b.players - a.players)
  const total = classes.reduce((sum, c) => sum + c.players, 0)
  if (!total) return null
  const groups = classes.map((c) => ({
    ...c,
    // Every class and spec keeps its place, at 0 when nobody qualifies (e.g. no Fury
    // Warrior timed a +20), so the chart shows the gap instead of dropping the pillar.
    share: (c.players / total) * 100,
    bars: specsOf(c.name)
      .map((s) => ({ name: s.name, players: c.specs.get(s.name) || 0, share: ((c.specs.get(s.name) || 0) / total) * 100 }))
      .sort((a, b) => b.players - a.players),
  }))
  const max = Math.max(...groups.flatMap((g) => g.bars.map((b) => b.share)), 0.1)
  const step = niceStep(max)
  const top = Math.ceil(max / step) * step
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step)
  const filtered = !!klass

  return (
    <figure className="mr-chart" aria-label="Spec popularity: share of ranked players on each spec">
      <figcaption className="mr-chart-cap">
        <span className="mr-chart-title">Spec popularity</span>
        <span className="muted">
          share of {total.toLocaleString('en-US')} ranked players{minKey ? ` who timed +${minKey} or higher` : ''} · main spec ·
          click a pillar to open that spec’s rankings
        </span>
      </figcaption>
      <div className="mr-chart-grid">
        {groups.map((g) => {
          const classOn = klass === g.name
          return (
            <div
              key={g.name}
              className={`mr-chart-group ${classOn ? 'on' : ''} ${filtered && !classOn ? 'dim' : ''}`}
              style={{ '--class-color': classColor(g.name) }}
            >
              <div className="mr-chart-plot">
                {ticks.map((t) => (
                  <span key={t} className="mr-chart-line" style={{ bottom: `${(t / top) * 100}%` }}>
                    <span className="mr-chart-tick">{t}%</span>
                  </span>
                ))}
                <div className="mr-chart-bars">
                  {g.bars.map((b, i) => {
                    const on = classOn && spec === b.name
                    return (
                      <button
                        key={b.name}
                        className={`mr-chart-col ${on ? 'on' : ''} ${classOn && spec && !on ? 'dim' : ''}`}
                        onClick={() => onPick(on ? { klass: g.name, spec: null } : { klass: g.name, spec: b.name })}
                        aria-label={`${b.name} ${g.name}: ${pct(b.share)} of players (${b.players.toLocaleString('en-US')})`}
                        aria-pressed={on}
                      >
                        <span className="mr-chart-tip" role="tooltip">
                          <strong>
                            {b.name} {g.name}
                          </strong>
                          <span>
                            {pct(b.share)} · {b.players.toLocaleString('en-US')} players
                          </span>
                        </span>
                        {/* Only the group's tallest pillar is labelled; the rest are on hover. */}
                        {i === 0 && <span className="mr-chart-val">{pct(b.share)}</span>}
                        <span className="mr-chart-bar" style={{ height: `${(b.share / top) * 100}%` }} />
                      </button>
                    )
                  })}
                </div>
              </div>
              <div className="mr-chart-icons">
                {g.bars.map((b) => {
                  const on = classOn && spec === b.name
                  return (
                    <button
                      key={b.name}
                      className={`mr-chart-icon ${on ? 'on' : ''}`}
                      onClick={() => onPick(on ? { klass: g.name, spec: null } : { klass: g.name, spec: b.name })}
                      title={`${b.name} ${g.name}`}
                      tabIndex={-1}
                    >
                      <img src={specIconUrl(g.name, b.name)} alt="" />
                    </button>
                  )
                })}
              </div>
              <button
                className={`mr-chart-class ${classOn && !spec ? 'on' : ''}`}
                onClick={() => onPick(classOn && !spec ? { klass: null, spec: null } : { klass: g.name, spec: null })}
                title={`${g.name}: ${pct(g.share)} of players (${g.players.toLocaleString('en-US')}) · show all ${g.name}s`}
              >
                <span className="mr-chart-class-name">{g.name}</span>
                <span className="mr-chart-class-share">{pct(g.share)}</span>
              </button>
            </div>
          )
        })}
      </div>
    </figure>
  )
}

// A guild name in its fixed-width cell. The column is sized for about 25 letters at the
// normal size; a longer (or wider — capitals, CJK) name is MEASURED and its font scaled
// down just enough to fit, to a readable floor, so no name widens the column or stands
// out. Only a name too long even at the floor is cut with an ellipsis (full name on hover).
const GUILD_FONT_PX = 13
const GUILD_FONT_MIN_PX = 8.5
function GuildName({ name, active, onClick }) {
  const ref = useRef(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const fit = () => {
      el.style.fontSize = `${GUILD_FONT_PX}px`
      // Two passes: glyph widths don't scale perfectly linearly with the font size.
      for (let i = 0; i < 2 && el.scrollWidth > el.clientWidth + 0.5; i++) {
        const size = parseFloat(el.style.fontSize)
        el.style.fontSize = `${Math.max(GUILD_FONT_MIN_PX, (size * el.clientWidth) / el.scrollWidth - 0.1)}px`
      }
    }
    fit()
    // Web fonts / a late CJK fallback font can change the width after first paint.
    document.fonts?.ready?.then(fit)
  }, [name])
  return (
    <button
      ref={ref}
      className={`mr-guild-name ${active ? 'on' : ''}`}
      onClick={onClick}
      title={`<${name}> · ${active ? 'clear the guild filter' : 'show only this guild'}`}
    >
      {name}
    </button>
  )
}

// Guild filter: a text box backed by the list of guilds (biggest first). Picking or typing
// an exact guild name applies it; the ✕ clears it. Anything else typed is just a search
// through the suggestions and is dropped on blur.
function GuildFilter({ value, guilds, onChange }) {
  const [text, setText] = useState(value || '')
  useEffect(() => setText(value || ''), [value])
  const byLower = useMemo(() => new Map(guilds.map((g) => [g.guild.toLowerCase(), g.guild])), [guilds])
  const apply = (raw) => {
    const t = raw.trim()
    if (!t) return value ? onChange(null) : undefined
    const match = byLower.get(t.toLowerCase())
    if (match && match !== value) onChange(match)
    return match
  }
  return (
    <label className="filter-field mr-search mr-guild-filter">
      <span className="field-label">Guild</span>
      <span className="mr-search-box">
        <input
          type="text"
          list="mr-guild-list"
          placeholder="All guilds"
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            // Choosing a suggestion arrives as a change to the full name: apply at once.
            if (byLower.has(e.target.value.trim().toLowerCase())) apply(e.target.value)
          }}
          onKeyDown={(e) => e.key === 'Enter' && !apply(text) && setText(value || '')}
          onBlur={() => !apply(text) && setText(value || '')}
          aria-label="Filter by guild"
          autoComplete="off"
          spellCheck={false}
        />
        {value && (
          <button
            type="button"
            className="mr-clear"
            onClick={(e) => {
              e.preventDefault()
              onChange(null)
            }}
            aria-label="Clear guild filter"
            title="Clear guild filter"
          >
            ✕
          </button>
        )}
      </span>
      <datalist id="mr-guild-list">
        {guilds.map((g) => (
          <option key={g.guild} value={g.guild}>
            {g.players} {g.players === 1 ? 'player' : 'players'}
          </option>
        ))}
      </datalist>
    </label>
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

// Green up / red down arrow with the number of places a player moved in this list in the
// last rankings update, shown only when their own score changed in it (prev is null for
// players who were merely passed). The slot is always rendered so rank numbers line up.
function RankMove({ rank, prev }) {
  const moved = prev == null ? 0 : prev - rank
  if (!moved) return <span className="mr-move" />
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

// Key levels the rankings can be narrowed to: players who TIMED a key this high or higher.
const KEY_LEVELS = [10, 15, 20]

export default function MythicRankingsPage({ klass, spec, realm, guild, minKey, search, page, focus, onNavigate, onSelectPlayer }) {
  const [state, setState] = useState({ loading: true, rows: [], error: null })
  const [population, setPopulation] = useState(null)
  const [guilds, setGuilds] = useState([])
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
    getLeaderboard({ klass, spec, realm: armoryRealm, guild, minKey, page: page || 1, findName, findRealm, search: query })
      .then((rows) => !cancelled && setState({ loading: false, rows, error: null }))
      .catch((e) => !cancelled && setState({ loading: false, rows: [], error: e.message || 'Request failed.' }))
    return () => {
      cancelled = true
    }
  }, [klass, spec, armoryRealm, guild, minKey, page, findName, findRealm, query])

  // The spec chart follows the realm and key filters (not class/spec/search: it IS the
  // class picker).
  useEffect(() => {
    let cancelled = false
    getPopulation(armoryRealm, minKey)
      .then((p) => !cancelled && setPopulation(p))
      .catch(() => !cancelled && setPopulation(null))
    return () => {
      cancelled = true
    }
  }, [armoryRealm, minKey])
  useEffect(() => {
    let cancelled = false
    getGuilds(armoryRealm)
      .then((g) => !cancelled && setGuilds(g))
      .catch(() => !cancelled && setGuilds([]))
    return () => {
      cancelled = true
    }
  }, [armoryRealm])

  const { loading, rows, error } = state
  // A page past the end (an old link, or a search that now has fewer matches) has no rows:
  // fall back to page 1 rather than showing an empty list.
  const pastEnd = !loading && !error && rows.length === 0 && page > 1
  useEffect(() => {
    if (pastEnd) onNavigate({ klass, spec, realm, guild, minKey, search, focus, page: null }, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pastEnd])
  const total = rows[0]?.total || 0
  const pages = Math.max(1, Math.ceil(total / RANKINGS_PAGE_SIZE))
  // The page actually shown: explicit, or wherever the highlighted player turned out to be.
  const shownPage = page || (rows[0] ? Math.floor((rows[0].rank - 1) / RANKINGS_PAGE_SIZE) + 1 : 1)
  const focusKey = focus ? focus.toLowerCase() : null

  // Changing a filter starts over on page 1 and drops the highlight; paging keeps both.
  const setFilter = (patch) => onNavigate({ klass, spec, realm, guild, minKey, search, ...patch, page: null, focus: null })
  const setPage = (p) => onNavigate({ klass, spec, realm, guild, minKey, search, focus, page: p })

  // Apply the typed search once typing pauses. It replaces the current history entry, so
  // a search is one Back step however many letters it took.
  useEffect(() => {
    const next = text.trim() || null
    if (next === (search || null)) return
    const t = setTimeout(
      () => onNavigate({ klass, spec, realm, guild, minKey, search: next, page: null, focus: null }, { replace: true }),
      300,
    )
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text])

  const scope =
    [realm ? REALM_LABELS[realm] : null, spec, klass, guild ? `in <${guild}>` : null].filter(Boolean).join(' ') || 'All players'
  // Shown after the scope in the subtitle while the key filter is on.
  const keyNote = minKey ? ` · timed +${minKey} or higher` : ''
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
          {keyNote}
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
        <Field label="Keys" value={minKey ? String(minKey) : ''} onChange={(v) => setFilter({ minKey: +v || null })}>
          <option value="">Any key</option>
          {KEY_LEVELS.map((k) => (
            <option key={k} value={k}>
              +{k} and up
            </option>
          ))}
        </Field>
        <GuildFilter value={guild} guilds={guilds} onChange={(g) => setFilter({ guild: g })} />
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

      {population && <PopulationChart population={population} klass={klass} spec={spec} minKey={minKey} onPick={setFilter} />}

      {error ? (
        <div className="error">Couldn’t load the rankings: {error}</div>
      ) : loading && !rows.length ? (
        <div className="empty-state">Loading rankings…</div>
      ) : !rows.length ? (
        <div className="empty-state">
          {query
            ? `No player matching “${query}” in ${scope === 'All players' ? 'the rankings' : `the ${scope} rankings`}.`
            : minKey
              ? `No ${scope === 'All players' ? 'player' : scope} has timed a +${minKey} or higher yet.`
              : `No ${scope === 'All players' ? '' : `${scope} `}players have a Mythic+ run yet.`}
        </div>
      ) : (
        <>
          <div className={`table-scroll ${loading ? 'mr-loading' : ''}`}>
            <table className="meter mr-table">
              <thead>
                <tr>
                  <th className="rank">
                    <span className="mr-rank-num">#</span>
                    <span className="mr-move" />
                  </th>
                  <th>Player</th>
                  <th className="mr-guild-head">Guild</th>
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
                      <td className="rank">
                        <span className="mr-rank-num">{r.rank.toLocaleString('en-US')}</span>
                        <RankMove rank={r.rank} prev={r.prev_rank} />
                      </td>
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
                      <td className="mr-guild">
                        {r.guild ? (
                          <GuildName
                            name={r.guild}
                            active={guild === r.guild}
                            onClick={() => setFilter({ guild: guild === r.guild ? null : r.guild })}
                          />
                        ) : (
                          <span className="mr-guild-none">—</span>
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
