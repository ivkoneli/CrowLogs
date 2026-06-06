import { useEffect, useMemo, useState } from 'react'
import { RAIDS } from '../lib/raids.js'
import { playerSummary, playerProfile, playerLogs } from '../lib/rankings.js'
import { formatDps, formatDuration } from '../parser.js'
import { classColor } from '../lib/classes.js'
import TalentStrip from './TalentStrip.jsx'
import FactionIcon from './FactionIcon.jsx'
import { SpecRaceSlots } from './IconSlots.jsx'

const rankClass = (rank) => {
  if (rank === 1) return 'gold'
  if (rank === 2) return 'silver'
  if (rank === 3) return 'bronze'
  return ''
}

export default function PlayerPage({ fights, player, onSelectBoss, onSelectLog, onUpdateProfile }) {
  const [tab, setTab] = useState('rankings')
  const [updating, setUpdating] = useState(false)
  const [updateMsg, setUpdateMsg] = useState(null) // { ok, msg }
  const raid = RAIDS[0] // Highmaul
  const rows = playerSummary(fights, player, raid.name, raid.bosses, null)
  const ranked = rows.filter((r) => r.record)
  const bestDps = ranked.length ? Math.max(...ranked.map((r) => r.record.dps)) : 0
  const profile = playerProfile(fights, player)
  const logs = useMemo(() => playerLogs(fights, player), [fights, player])

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
    <div className="player-page">
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
          {updateMsg && (
            <span className={updateMsg.ok ? 'ok' : 'bad'}>{updateMsg.msg}</span>
          )}
        </div>
      </div>

      <div className="tabbar">
        <button className={`tab ${tab === 'rankings' ? 'active' : ''}`} onClick={() => setTab('rankings')}>
          {raid.name}
        </button>
        <button className={`tab ${tab === 'history' ? 'active' : ''}`} onClick={() => setTab('history')}>
          History {logs.length ? `(${logs.length})` : ''}
        </button>
      </div>

      {tab === 'rankings' && (
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
                <th className="num">DPS</th>
                <th className="num">Rank</th>
                <th className="num">Duration</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ boss, record, rank, total }) => (
                <tr key={boss}>
                  <td className="name-cell">
                    <div className="bar-wrap">
                      <div className="bar" style={{ width: record ? `${(record.dps / bestDps) * 100}%` : '0%' }} />
                      <button className="name link" onClick={() => onSelectBoss(raid.name, boss)}>
                        {boss}
                      </button>
                    </div>
                  </td>
                  {record ? (
                    <>
                      <td className="num strong">{formatDps(record.dps)}</td>
                      <td className="num">
                        <span className={`rank-pill ${rankClass(rank)}`}>
                          #{rank}
                          <span className="of">/ {total}</span>
                        </span>
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
      )}

      {tab === 'history' && (
        <div className="player-card">
          {logs.length === 0 ? (
            <div className="empty-state">
              <p>No logs recorded for {player} yet. Imported logs they appear in will show here.</p>
            </div>
          ) : (
            <table className="meter">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Encounter</th>
                  <th className="num">DPS</th>
                  <th className="num">Duration</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id} className="log-row" onClick={() => onSelectLog(log.logId)}>
                    <td className="muted">{log.day}</td>
                    <td className="name-cell">
                      <button className="name link">{log.boss}</button>
                      <span className="spec-tag">
                        {log.difficulty} {log.raid}
                      </span>
                    </td>
                    <td className="num strong">{formatDps(log.dps)}</td>
                    <td className="num muted">{formatDuration(log.duration)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}
