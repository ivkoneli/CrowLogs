import { RAIDS } from '../lib/raids.js'
import { playerSummary, playerProfile } from '../lib/rankings.js'
import { formatDps, formatDuration } from '../parser.js'
import { classColor } from '../lib/classes.js'
import TalentStrip from './TalentStrip.jsx'

const rankClass = (rank) => {
  if (rank === 1) return 'gold'
  if (rank === 2) return 'silver'
  if (rank === 3) return 'bronze'
  return ''
}

export default function PlayerPage({ fights, player, difficulty, onSelectBoss }) {
  const raid = RAIDS[0] // Highmaul
  const rows = playerSummary(fights, player, raid.name, raid.bosses, difficulty)
  const ranked = rows.filter((r) => r.record)
  const bestDps = ranked.length ? Math.max(...ranked.map((r) => r.record.dps)) : 0
  const profile = playerProfile(fights, player)

  return (
    <div className="player-page">
      <div className="page-head">
        <span className="kicker">Player</span>
        <h2 style={profile.class ? { color: classColor(profile.class) } : undefined}>{player}</h2>
        <div className="player-meta">
          {profile.spec && (
            <span className="meta-item">
              {profile.spec} {profile.class}
            </span>
          )}
          <span className="meta-item ilvl-badge">
            {profile.ilvl != null ? `${profile.ilvl} ilvl` : 'ilvl —'}
          </span>
          {profile.faction && (
            <span className={`meta-item faction-${profile.faction.toLowerCase()}`}>
              {profile.faction}
            </span>
          )}
          {profile.talents.length > 0 && (
            <span className="meta-talents">
              <span className="meta-label">Talents</span>
              <TalentStrip talents={profile.talents} />
            </span>
          )}
        </div>
      </div>

      <div className="player-card">
        <div className="card-head">
          <h3>
            {difficulty} {raid.name}
          </h3>
          <span className="muted">{ranked.length} of {raid.bosses.length} bosses</span>
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
                    <div
                      className="bar"
                      style={{ width: record ? `${(record.dps / bestDps) * 100}%` : '0%' }}
                    />
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
    </div>
  )
}
