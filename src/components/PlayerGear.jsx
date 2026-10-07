// Fixed right-hand stats panel on the player page: equipped gear (live from the
// armory cache, refreshed by "Update profile"). Falls back to demo data until a
// real scrape has run for this character.
import { useEffect, useState } from 'react'
import { DEMO_GEAR, DEMO_ARTIFACT, ARTIFACT_RELIC_SLOTS } from '../lib/demoGear.js'

const ICON_BASE = 'https://legion-static.tauri.hu/images/icons/large/'

// The on-demand "Update profile" scrape (edge function) stores relics as bare item ids,
// because the id -> name/icon map is too big to bundle there. Resolve those here from the
// same RELIC_ICONS map, loaded lazily only when a profile actually has unnamed relics.
function useResolvedRelics(relics) {
  const needs = (relics || []).some((r) => r?.id && !r.name)
  const [map, setMap] = useState(null)
  useEffect(() => {
    if (!needs || map) return
    let cancelled = false
    import('../lib/itemIcons.js')
      .then((m) => !cancelled && setMap(m.RELIC_ICONS))
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [needs, map])
  if (!needs || !map) return relics || []
  return relics.map((r) => {
    if (!r?.id || r.name) return r
    const meta = map[String(r.id)]
    return meta ? { ...r, name: meta.name, icon: meta.icon ? `${ICON_BASE}${meta.icon}.png` : null } : r
  })
}

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

// Gems come from the armory as [{ icon, stat }]; the demo data uses a bare count.
// Render real gem icons when we have them, otherwise the count as placeholder slots.
function Gems({ gems }) {
  if (Array.isArray(gems)) {
    if (!gems.length) return null
    return (
      <span className="gear-slots">
        {gems.map((g, i) => (
          <img key={i} className="gem-icon" src={g.icon} alt="" title={g.stat} />
        ))}
      </span>
    )
  }
  if (typeof gems === 'number' && gems > 0) {
    return (
      <span className="gear-slots">
        {Array.from({ length: gems }, (_, i) => (
          <span key={i} className="gem-slot" />
        ))}
      </span>
    )
  }
  return null
}

// Enchant is the armory's "Enchanted: <stat>" text (a string) or null. The demo also
// uses 'missing' to show a slot that should be enchanted but isn't (red).
function Enchant({ enchant }) {
  if (enchant === 'missing') return <span className="ench-dot missing" title="Not enchanted" />
  if (enchant) return <span className="ench-dot ok" title={`Enchanted: ${enchant}`} />
  return null
}

export default function PlayerGear({ profile }) {
  const realGear = profile?.gear?.length ? profile.gear : null
  const items = realGear || DEMO_GEAR
  const isDemo = !realGear

  // Relics hang off the artifact weapon; a Legion artifact always has three slots, so
  // pad to three and let unfilled ones render as empty.
  const artifact = items.find((g) => g.quality === 'artifact') || null
  const resolved = useResolvedRelics(artifact?.relics)
  // Exactly three slots: a Legion artifact never has more, whatever the data says.
  const relics = Array.from({ length: ARTIFACT_RELIC_SLOTS }, (_, i) => resolved[i] || DEMO_ARTIFACT[i])

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
            <th>Gems</th>
            <th>Ench</th>
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
              {/* An artifact's sockets are its relics — listed under Artifact, never as gems
                  (rows saved by older scrapes may still carry them in `gems`). */}
              <td className="gear-gems">{g.quality !== 'artifact' && <Gems gems={g.gems} />}</td>
              <td className="gear-ench"><Enchant enchant={g.enchant} /></td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="gear-head">
        <span className="kicker">Artifact</span>
        {artifact?.artifactName ? (
          <span className="artifact-name" style={{ color: QUALITY_COLOR.artifact }}>
            {artifact.artifactName}
          </span>
        ) : (
          <span className="muted small">{isDemo ? 'demo' : 'none'}</span>
        )}
      </div>
      <ul className="relic-list">
        {relics.map((r, i) => (
          <li key={r?.id ?? i} className="relic-row">
            {r?.icon ? (
              <img className="relic-icon" src={r.icon} alt="" />
            ) : (
              <span className="relic-icon empty" />
            )}
            <span className={`relic-name${r?.name ? '' : ' muted'}`}>
              {r?.name || 'Empty socket'}
            </span>
          </li>
        ))}
      </ul>
    </aside>
  )
}
