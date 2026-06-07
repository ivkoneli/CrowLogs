// Shared meter table (the DPS-bar leaderboard look) used by both the boss
// rankings and a player's history, so they stay visually identical. The `metric`
// prop swaps the rate column between DPS and HPS (healing).
import { classColor } from '../lib/classes.js'
import { formatDps, formatDuration } from '../parser.js'
import TalentStrip from './TalentStrip.jsx'
import FactionIcon from './FactionIcon.jsx'
import { SpecRaceSlots, TrinketSlots } from './IconSlots.jsx'

export function MeterHead({ nameLabel = 'Player', metric = 'dps' }) {
  return (
    <thead>
      <tr>
        <th className="rank">#</th>
        <th>{nameLabel}</th>
        <th className="num">{metric === 'hps' ? 'HPS' : 'DPS'}</th>
        <th className="num" title="Combat potions used">Pots</th>
        <th className="num">ilvl</th>
        <th className="talents-col">Talents</th>
        <th className="talents-col">Trinkets</th>
        <th className="num">Duration</th>
        <th className="num">When</th>
      </tr>
    </thead>
  )
}

// `klass` colors the name + bar; `subLabel` is the small grey tag after the name
// (e.g. "Fury Warrior" in rankings, "Heroic" in history). `value`/`maxValue` are
// the rate (DPS or HPS) and the group max used to size the bar.
export function MeterRow({
  rank,
  value,
  maxValue,
  name,
  klass,
  spec,
  specIcon,
  race,
  gender,
  faction,
  subLabel,
  pet,
  potions,
  ilvl,
  talents,
  trinkets,
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
              width: `${(value / maxValue) * 100}%`,
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
            <SpecRaceSlots klass={klass} spec={spec} specIcon={specIcon} race={race} gender={gender} />
            {name}
          </button>
          {subLabel && <span className="spec-tag">{subLabel}</span>}
          {pet && <span className="pet-tag">pet</span>}
        </div>
      </td>
      <td className="num strong">{formatDps(value)}</td>
      <td className={`num pots${potions ? '' : ' zero'}`}>{potions ?? 0}</td>
      <td className="num ilvl">{ilvl ?? '—'}</td>
      <td className="talents-col">
        <TalentStrip talents={talents} />
      </td>
      <td className="talents-col">
        <TrinketSlots trinkets={trinkets} />
      </td>
      <td className="num muted">{formatDuration(duration)}</td>
      <td className="num muted">{when}</td>
    </tr>
  )
}

// Segmented Damage / Healing toggle shared across pages. `healLabel` lets a page
// rename the healing side (e.g. "Absorbs" on a tank's profile, "Heals" on a healer's).
export function MetricToggle({ metric, onChange, healLabel = 'Healing' }) {
  return (
    <div className="view-toggle metric-toggle">
      <button className={`seg ${metric === 'dps' ? 'on' : ''}`} onClick={() => onChange('dps')}>
        ⚔ Damage
      </button>
      <button className={`seg ${metric === 'hps' ? 'on' : ''}`} onClick={() => onChange('hps')}>
        ✚ {healLabel}
      </button>
    </div>
  )
}
