// Mythic+ rankings: players by M+ score, 25 per page, filterable by class, spec and realm.
// Each row shows the player's best run in every dungeon as "key + medal" (hover for that
// run's score and time). Filters, page and the highlighted player all live in the URL
// (#/mplus?class=…&spec=…&realm=…&page=…&player=…), so a view can be shared and the
// profile's rank chips can link straight to a player's row.
import { useEffect, useState } from 'react'
import {
  MPLUS_DUNGEONS,
  MPLUS_REALMS,
  MEDALS,
  RANKINGS_PAGE_SIZE,
  getLeaderboard,
  dungeonIconUrl,
  formatScore,
  formatRunTime,
  splitPlayerKey,
  memberPlayerKey,
} from '../lib/mythicplus.js'
import { LEGION_CLASSES, classColor, specsOf, specIconUrl } from '../lib/classes.js'
import { selectionToHash, inAppClick } from '../lib/router.js'
import SpecTabs from './SpecTabs.jsx'
import { Medal, Pager } from './MythicPlusCard.jsx'

// Realm slug → short label for the filter and the tag after a name.
const REALM_LABELS = { evermoon: 'Evermoon', tauri: 'Tauri', wod: 'WoD' }
const SLUG_OF_REALM = Object.fromEntries(Object.entries(MPLUS_REALMS).map(([slug, realm]) => [realm, slug]))

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

export default function MythicRankingsPage({ klass, spec, realm, page, focus, onNavigate, onSelectPlayer }) {
  const [state, setState] = useState({ loading: true, rows: [], error: null })
  const armoryRealm = realm ? MPLUS_REALMS[realm] || null : null
  // A highlighted player with no explicit page = "open the page they're on".
  const find = focus && !page ? splitPlayerKey(focus) : null
  const findName = find?.name || null
  const findRealm = find?.realm || null

  useEffect(() => {
    let cancelled = false
    setState((s) => ({ ...s, loading: true, error: null }))
    getLeaderboard({ klass, spec, realm: armoryRealm, page: page || 1, findName, findRealm })
      .then((rows) => !cancelled && setState({ loading: false, rows, error: null }))
      .catch((e) => !cancelled && setState({ loading: false, rows: [], error: e.message || 'Request failed.' }))
    return () => {
      cancelled = true
    }
  }, [klass, spec, armoryRealm, page, findName, findRealm])

  const { loading, rows, error } = state
  const total = rows[0]?.total || 0
  const pages = Math.max(1, Math.ceil(total / RANKINGS_PAGE_SIZE))
  // The page actually shown: explicit, or wherever the highlighted player turned out to be.
  const shownPage = page || (rows[0] ? Math.floor((rows[0].rank - 1) / RANKINGS_PAGE_SIZE) + 1 : 1)
  const specTabs = klass ? specsOf(klass).map((s) => ({ spec: s.name, icon: specIconUrl(klass, s.name) })) : []
  const focusKey = focus ? focus.toLowerCase() : null

  // Changing a filter starts over on page 1 and drops the highlight; paging keeps both.
  const setFilter = (patch) => onNavigate({ klass, spec, realm, ...patch, page: null, focus: null })
  const setPage = (p) => onNavigate({ klass, spec, realm, focus, page: p })

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
          {total > 0 && ` · ${total.toLocaleString('en-US')} ${total === 1 ? 'player' : 'players'}`}
        </p>
      </div>

      <div className="filter-bar mr-filters">
        <Field label="Class" value={klass} onChange={(v) => setFilter({ klass: v || null, spec: null })}>
          <option value="">All classes</option>
          {LEGION_CLASSES.map((c) => (
            <option key={c.name} value={c.name}>
              {c.name}
            </option>
          ))}
        </Field>
        <Field label="Realm" value={realm} onChange={(v) => setFilter({ realm: v || null })}>
          <option value="">All realms</option>
          {Object.keys(MPLUS_REALMS).map((slug) => (
            <option key={slug} value={slug}>
              {REALM_LABELS[slug] || slug}
            </option>
          ))}
        </Field>
        {specTabs.length > 0 && (
          <div className="mr-spec">
            <span className="field-label">Spec</span>
            <SpecTabs specs={specTabs} value={spec || null} onChange={(s) => setFilter({ spec: s })} />
          </div>
        )}
      </div>

      {error ? (
        <div className="error">Couldn’t load the rankings: {error}</div>
      ) : loading && !rows.length ? (
        <div className="empty-state">Loading rankings…</div>
      ) : !rows.length ? (
        <div className="empty-state">No {scope === 'All players' ? '' : `${scope} `}players have a Mythic+ run yet.</div>
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
