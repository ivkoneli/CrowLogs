// Shared meter table (the DPS-bar leaderboard look) used by both the boss
// rankings and a player's history, so they stay visually identical.
import { classColor } from '../lib/classes.js'
import { formatDps, formatDuration } from '../parser.js'
import TalentStrip from './TalentStrip.jsx'
import FactionIcon from './FactionIcon.jsx'
import { SpecRaceSlots, TrinketSlots } from './IconSlots.jsx'

export function MeterHead({ nameLabel = 'Player' }) {
  return (
    <thead>
      <tr>
        <th className="rank">#</th>
        <th>{nameLabel}</th>
        <th className="num">DPS</th>
        <th className="num">ilvl</th>
        <th className="talents-col">Talents</th>
        <th className="talents-col">Trinkets</th>
        <th className="num">Duration</th>
        <th className="num">When</th>
      </tr>
    </thead>
  )
}

// `klass` colors the name + DPS bar; `subLabel` is the small grey tag after the
// name (e.g. "Fury Warrior" in rankings, "Heroic" in history).
export function MeterRow({
  rank,
  dps,
  maxDps,
  name,
  klass,
  spec,
  race,
  faction,
  subLabel,
  pet,
  ilvl,
  talents,
  duration,
  when,
  onClick,
}) {
  return (
    <tr>
      <td className="rank">{rank}</td>
      <td className="name-cell">
        <div className="bar-wrap">
          <div
            className="bar"
            style={{
              width: `${(dps / maxDps) * 100}%`,
              background: klass
                ? `linear-gradient(90deg, ${classColor(klass)}33, ${classColor(klass)}cc)`
                : undefined,
            }}
          />
          <button
            className="name link"
            onClick={onClick}
            style={klass ? { color: classColor(klass) } : undefined}
          >
            {faction && <FactionIcon faction={faction} size={14} />}
            <SpecRaceSlots spec={spec} race={race} />
            {name}
          </button>
          {subLabel && <span className="spec-tag">{subLabel}</span>}
          {pet && <span className="pet-tag">pet</span>}
        </div>
      </td>
      <td className="num strong">{formatDps(dps)}</td>
      <td className="num ilvl">{ilvl ?? '—'}</td>
      <td className="talents-col">
        <TalentStrip talents={talents} />
      </td>
      <td className="talents-col">
        <TrinketSlots />
      </td>
      <td className="num muted">{formatDuration(duration)}</td>
      <td className="num muted">{when}</td>
    </tr>
  )
}
