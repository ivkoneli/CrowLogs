import { useEffect, useMemo, useState } from 'react'
import { RAIDS } from '../lib/raids.js'
import { playerSummary, playerProfile, playerLogs } from '../lib/rankings.js'
import { formatDps, formatDuration } from '../parser.js'
import { classColor, specsOf, specIconUrl } from '../lib/classes.js'
import { MetricToggle } from './Meter.jsx'
import TalentStrip from './TalentStrip.jsx'
import FactionIcon from './FactionIcon.jsx'
import { SpecRaceSlots } from './IconSlots.jsx'
import PlayerGear from './PlayerGear.jsx'

// Difficulty sections inside the Rankings tab (hardest first).
const DIFF_TABS = ['Mythic', 'Heroic', 'Normal', 'LFR']

const rankClass = (rank) => {
  if (rank === 1) return 'gold'
  if (rank === 2) return 'silver'
  if (rank === 3) return 'bronze'
  return ''
}

// All | <spec> | … sub-tabs. `specs` is [{ spec, icon }]; `value` null = All.
function SpecTabs({ specs, value, onChange }) {
  return (
    <div className="spec-tabs">
      <button className={`seg ${value === null ? 'on' : ''}`} onClick={() => onChange(null)}>
        All
      </button>
      {specs.map((s) => (
        <button
          key={s.spec}
          className={`seg ${value === s.spec ? 'on' : ''}`}
          onClick={() => onChange(s.spec)}
          title={s.spec}
        >
          {s.icon && (
            <img
              className="spec-tab-icon"
              src={s.icon}
              alt=""
              onError={(e) => {
                e.currentTarget.style.display = 'none'
              }}
            />
          )}
          {s.spec}
        </button>
      ))}
    </div>
  )
}

// One raid's per-boss ranking for the selected difficulty + metric. `klass` colors
// the bars; `valueLabel` is the rate column header (DPS / Heals / Absorbs).
function RaidRankCard({ fights, player, raid, difficulty, metric, spec, klass, valueLabel, onSelectBoss }) {
  const rows = playerSummary(fights, player, raid.name, raid.bosses, difficulty, metric, spec)
  const rate = (rec) => (metric === 'hps' ? rec.hps : rec.dps)
  const ranked = rows.filter((r) => r.record)
  const best = ranked.length ? Math.max(...ranked.map((r) => rate(r.record)), 1) : 1
  const barBg = klass
    ? `linear-gradient(90deg, ${classColor(klass)}33, ${classColor(klass)}cc)`
    : undefined

  return (
    <div className="player-card">
      <div className="card-head">
        <h3>{raid.name}</h3>
        <span className="muted">
          {ranked.length} of {raid.bosses.length} bosses
        </span>
      </div>
      <table className="meter">
        <thead>
          <tr>
            <th>Boss</th>
            <th className="num">{valueLabel}</th>
            <th className="num">Rank</th>
            <th className="num">Duration</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ boss, record, rank, total }) => (
            <tr key={boss}>
              <td className="name-cell">
                <div className="bar-wrap">
                  <div
                    className="bar"
                    style={{ width: record ? `${(rate(record) / best) * 100}%` : '0%', background: record ? barBg : undefined }}
                  />
                  <button className="name link" onClick={() => onSelectBoss(raid.name, boss)}>
                    {boss}
                  </button>
                </div>
              </td>
              {record ? (
                <>
                  <td className="num strong">{formatDps(rate(record))}</td>
                  <td className="num">
                    {rank ? (
                      <span className={`rank-pill ${rankClass(rank)}`}>
                        #{rank}
                        <span className="of">/ {total}</span>
                      </span>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td className="num muted">{formatDuration(record.duration)}</td>
                </>
              ) : (
                <>
                  <td className="num muted">—</td>
                  <td className="num muted">—</td>
                  <td className="num muted">no kill</td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function PlayerPage({ fights, player, onSelectBoss, onSelectLog, onUpdateProfile }) {
  const [tab, setTab] = useState('rankings')
  const [diff, setDiff] = useState('Mythic')
  const [histMetric, setHistMetric] = useState('dps')
  const [histSpec, setHistSpec] = useState(null) // null = All specs
  const [rankMetric, setRankMetric] = useState('dps')
  const [rankSpec, setRankSpec] = useState(null) // null = All specs
  const [updating, setUpdating] = useState(false)
  const [updateMsg, setUpdateMsg] = useState(null) // { ok, msg }
  const profile = playerProfile(fights, player)
  const logs = useMemo(() => playerLogs(fights, player), [fights, player])

  // All of the class's specs (not just ones with logs) for the spec sub-tabs.
  const classSpecs = useMemo(
    () => specsOf(profile.class).map((s) => ({ spec: s.name, role: s.role, icon: specIconUrl(profile.class, s.name) })),
    [profile.class],
  )
  // The healing button is labelled by the selected spec's role; no role gating —
  // Damage/Healing is always available (a healer's damage / a dps's offheal both count).
  const healLabelFor = (s) => {
    const r = classSpecs.find((x) => x.spec === s)?.role
    return r === 'tank' ? 'Absorbs' : r === 'healer' ? 'Heals' : 'Healing'
  }

  // History logs filtered by the selected spec, newest-first (playerLogs already sorts
  // by time). The metric toggle only changes which value column shows, not the order.
  const histLogs = useMemo(() => (histSpec ? logs.filter((l) => l.spec === histSpec) : logs), [logs, histSpec])

  // Auto-clear the update status after 5s (the reserved row stays, so tables
  // below don't shift when it appears/disappears).
  useEffect(() => {
    if (!updateMsg) return
    const t = setTimeout(() => setUpdateMsg(null), 5000)
    return () => clearTimeout(t)
  }, [updateMsg])

  const handleUpdate = async () => {
    if (!onUpdateProfile || updating) return
    setUpdating(true)
    setUpdateMsg(null)
    try {
      await onUpdateProfile(player)
      setUpdateMsg({ ok: true, msg: 'Profile updated from the armory.' })
    } catch (e) {
      setUpdateMsg({ ok: false, msg: e.message || 'Update failed.' })
    } finally {
      setUpdating(false)
    }
  }

  return (
    <div className="player-page player-layout">
      <div className="player-main">
      <div className="page-head">
        <span className="kicker">Player</span>
        <h2 style={profile.class ? { color: classColor(profile.class) } : undefined}>
          {profile.faction && <FactionIcon faction={profile.faction} size={26} title={profile.faction} />}
          <SpecRaceSlots spec={profile.spec} race={profile.race} size={20} />
          {player}
        </h2>
        <div className="player-meta">
          {profile.guild && <span className="meta-item guild">&lt;{profile.guild}&gt;</span>}
          {profile.spec && (
            <span className="meta-item">
              {profile.spec} {profile.class}
            </span>
          )}
          <span className="meta-item ilvl-badge">
            {profile.ilvl != null ? `${profile.ilvl} ilvl` : 'ilvl —'}
          </span>
          {profile.faction && (
            <span className={`meta-item faction-${profile.faction.toLowerCase()}`}>{profile.faction}</span>
          )}
          {profile.talents.length > 0 && (
            <span className="meta-talents">
              <span className="meta-label">Talents</span>
              <TalentStrip talents={profile.talents} />
            </span>
          )}
          {onUpdateProfile && (
            <button className="update-profile-btn" onClick={handleUpdate} disabled={updating}>
              {updating ? 'Updating…' : '↻ Update profile'}
            </button>
          )}
        </div>
        <div className="update-status">
          {updateMsg && <span className={updateMsg.ok ? 'ok' : 'bad'}>{updateMsg.msg}</span>}
        </div>
      </div>

      <div className="tabbar">
            <button className={`tab ${tab === 'rankings' ? 'active' : ''}`} onClick={() => setTab('rankings')}>
              Rankings
            </button>
            <button className={`tab ${tab === 'history' ? 'active' : ''}`} onClick={() => setTab('history')}>
              History {logs.length ? `(${logs.length})` : ''}
            </button>
          </div>

          {tab === 'rankings' && (
            <>
              <div className="rank-controls">
                <div className="diff-subtabs">
                  {DIFF_TABS.map((d) => (
                    <button
                      key={d}
                      className={`seg ${diff === d ? 'on' : ''}`}
                      onClick={() => setDiff(d)}
                    >
                      {d}
                    </button>
                  ))}
                </div>
                {classSpecs.length > 0 && <SpecTabs specs={classSpecs} value={rankSpec} onChange={setRankSpec} />}
                <MetricToggle
                  metric={rankMetric}
                  onChange={setRankMetric}
                  healLabel={rankSpec ? healLabelFor(rankSpec) : 'Healing'}
                />
              </div>
              {RAIDS.map((raid) => (
                <RaidRankCard
                  key={raid.name}
                  fights={fights}
                  player={player}
                  raid={raid}
                  difficulty={diff}
                  metric={rankMetric}
                  spec={rankSpec}
                  klass={profile.class}
                  valueLabel={rankMetric === 'hps' ? (rankSpec ? healLabelFor(rankSpec) : 'Healing') : 'DPS'}
                  onSelectBoss={onSelectBoss}
                />
              ))}
            </>
          )}

          {tab === 'history' && (
            <div className="player-card">
              {logs.length === 0 ? (
                <div className="empty-state">
                  <p>No logs recorded for {player} yet. Imported logs they appear in will show here.</p>
                </div>
              ) : (
                <>
                  <div className="hist-controls">
                    {classSpecs.length > 0 && <SpecTabs specs={classSpecs} value={histSpec} onChange={setHistSpec} />}
                    <MetricToggle
                      metric={histMetric}
                      onChange={setHistMetric}
                      healLabel={histSpec ? healLabelFor(histSpec) : 'Healing'}
                    />
                  </div>
                  {histLogs.length === 0 ? (
                    <div className="empty-state">
                      <p>No {histSpec} logs for {player} yet.</p>
                    </div>
                  ) : (
                    <table className="meter">
                      <thead>
                        <tr>
                          <th>When</th>
                          <th>Encounter</th>
                          {!histSpec && <th>Spec</th>}
                          <th className="num">
                            {histMetric === 'hps' ? (histSpec ? healLabelFor(histSpec) : 'Healing') : 'DPS'}
                          </th>
                          <th className="num">Duration</th>
                        </tr>
                      </thead>
                      <tbody>
                        {histLogs.map((log) => (
                          <tr key={log.id} className="log-row" onClick={() => onSelectLog(log.logId)}>
                            <td className="muted">{log.day}</td>
                            <td className="name-cell">
                              <button className="name link boss-link">{log.boss}</button>
                              <span className="spec-tag">{log.difficulty}</span>
                              {log.kill === false && <span className="result-badge wipe sm">Wipe</span>}
                            </td>
                            {!histSpec && (
                              <td className="muted spec-cell">
                                {log.specIcon && <img className="spec-tab-icon" src={log.specIcon} alt="" />}
                                {log.spec || '—'}
                              </td>
                            )}
                            <td className="num strong">
                              {formatDps(histMetric === 'hps' ? log.hps : log.dps)}
                            </td>
                            <td className="num muted">{formatDuration(log.duration)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </>
              )}
            </div>
          )}
      </div>

      <PlayerGear profile={profile} />
    </div>
  )
}
