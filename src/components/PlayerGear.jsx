// Fixed right-hand stats panel on the player page: equipped gear (live from the
// armory cache, refreshed by "Update profile"). Falls back to demo data until a
// real scrape has run for this character.
import { DEMO_GEAR, DEMO_ARTIFACT } from '../lib/demoGear.js'

const QUALITY_COLOR = {
  artifact: '#e6cc80',
  legendary: '#ff8000',
  epic: '#a335ee',
  rare: '#0070dd',
  uncommon: '#1eff00',
  common: '#ffffff',
}

const SLOT_LABEL = {
  head: 'Head', neck: 'Neck', shoulder: 'Shoulder', back: 'Back', chest: 'Chest',
  wrist: 'Wrist', hands: 'Hands', waist: 'Waist', legs: 'Legs', feet: 'Feet',
  finger: 'Ring', trinket: 'Trinket', mainhand: 'Main Hand', offhand: 'Off Hand',
}

export default function PlayerGear({ profile }) {
  const realGear = profile?.gear?.length ? profile.gear : null
  const items = realGear || DEMO_GEAR
  const isDemo = !realGear

  const withIlvl = items.filter((g) => g.ilvl > 1)
  const avg = isDemo
    ? Math.round(withIlvl.reduce((s, g) => s + g.ilvl, 0) / (withIlvl.length || 1)) || profile?.ilvl || 0
    : profile?.ilvl ?? Math.round(withIlvl.reduce((s, g) => s + g.ilvl, 0) / (withIlvl.length || 1))

  return (
    <aside className="player-gear">
      <div className="gear-head">
        <span className="kicker">Equipment{isDemo ? ' · demo' : ''}</span>
        <span className="gear-ilvl">{avg} ilvl</span>
      </div>

      <table className="gear-table">
        <thead>
          <tr>
            <th>Item</th>
            <th className="num">ilvl</th>
          </tr>
        </thead>
        <tbody>
          {items.map((g, i) => (
            <tr key={g.id ?? g.slot ?? i}>
              <td>
                {g.icon ? (
                  <img className="gear-icon" src={g.icon} alt="" />
                ) : (
                  <span className="gear-icon" />
                )}
                <span
                  className="gear-name"
                  style={{ color: QUALITY_COLOR[g.quality] || '#fff' }}
                  title={SLOT_LABEL[g.slot] || g.slot}
                >
                  {g.name}
                </span>
              </td>
              <td className="num gear-ilvl-cell">{g.ilvl}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="gear-head">
        <span className="kicker">Artifact</span>
        <span className="muted small">demo</span>
      </div>
      <div className="artifact-strip">
        {DEMO_ARTIFACT.map((t) => (
          <span key={t.row} className="icon-slot" title={`Trait row ${t.row}`} />
        ))}
      </div>
    </aside>
  )
}
