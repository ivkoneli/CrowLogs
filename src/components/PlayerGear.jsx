// Fixed right-hand stats panel on the player page: gear / gems / enchants, and
// (later) artifact traits. Currently fed by demo data — see lib/demoGear.js.
import { DEMO_GEAR, DEMO_ARTIFACT } from '../lib/demoGear.js'

const QUALITY_COLOR = {
  epic: '#a335ee',
  rare: '#0070dd',
  uncommon: '#1eff00',
  common: '#ffffff',
}

export default function PlayerGear({ profile }) {
  const avg =
    Math.round(DEMO_GEAR.filter((g) => g.ilvl > 100).reduce((s, g) => s + g.ilvl, 0) /
      DEMO_GEAR.filter((g) => g.ilvl > 100).length) || profile?.ilvl || 0

  return (
    <aside className="player-gear">
      <div className="gear-head">
        <span className="kicker">Equipment</span>
        <span className="gear-ilvl">{avg} ilvl</span>
      </div>

      <table className="gear-table">
        <thead>
          <tr>
            <th>Item</th>
            <th className="num">ilvl</th>
            <th>Gems</th>
            <th>Ench</th>
          </tr>
        </thead>
        <tbody>
          {DEMO_GEAR.map((g) => (
            <tr key={g.slot}>
              <td>
                <span className="gear-icon" />
                <span className="gear-name" style={{ color: QUALITY_COLOR[g.quality] }} title={g.slot}>
                  {g.name}
                </span>
              </td>
              <td className="num gear-ilvl-cell">{g.ilvl}</td>
              <td>
                <span className="gear-slots">
                  {Array.from({ length: g.gems }, (_, i) => (
                    <span key={i} className="gem-slot" title="Gem" />
                  ))}
                </span>
              </td>
              <td>
                {g.enchant && (
                  <span className={`ench-dot ${g.enchant}`} title={g.enchant === 'ok' ? 'Enchanted' : 'Missing enchant'} />
                )}
              </td>
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
