// Hover panel for a meter row: the player's damage (or healing) split by spell, with each
// spell's share of their total. The breakdown is fetched on first hover (getSpells caches
// it), so the meter itself never pays for it. Rendered in a portal with fixed positioning
// so the table's scroll container can't clip it.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { getSpells } from '../lib/store.js'
import { formatDps } from '../parser.js'

const MAX_ROWS = 14

// WoW spell-school bitmask → bar color (the colors damage meters traditionally use).
// Multi-school spells take the color of their lowest school bit.
const SCHOOL_COLORS = [
  [1, '#d6c28a'], // Physical
  [2, '#ffe680'], // Holy
  [4, '#ff8a1f'], // Fire
  [8, '#5fe35f'], // Nature
  [16, '#7fe6ff'], // Frost
  [32, '#9a8cff'], // Shadow
  [64, '#ff8cf0'], // Arcane
]
function schoolColor(school) {
  for (const [bit, color] of SCHOOL_COLORS) if (school & bit) return color
  return '#a78bfa'
}

function compact(n) {
  return formatDps(n)
}

export function SpellPanel({ fightId, metric, total, durationMs, name, anchor }) {
  const [state, setState] = useState({ loading: true, spells: null, error: null })
  const ref = useRef(null)
  const [pos, setPos] = useState({ left: -9999, top: -9999 })

  useEffect(() => {
    let cancelled = false
    getSpells(fightId)
      .then((spells) => !cancelled && setState({ loading: false, spells, error: null }))
      .catch((e) => !cancelled && setState({ loading: false, spells: null, error: e.message || 'Request failed.' }))
    return () => {
      cancelled = true
    }
  }, [fightId])

  // Place the panel just below the hovered row's name cell; flip above it when there's no
  // room underneath, and keep it inside the viewport horizontally.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !anchor) return
    const r = anchor.getBoundingClientRect()
    const w = el.offsetWidth
    const h = el.offsetHeight
    const gap = 6
    let top = r.bottom + gap
    if (top + h > window.innerHeight - 8 && r.top - gap - h > 8) top = r.top - gap - h
    const left = Math.max(8, Math.min(r.left + 24, window.innerWidth - w - 8))
    setPos({ left, top })
  }, [anchor, state])

  const list = state.spells ? (metric === 'hps' ? state.spells.heal : state.spells.dmg) || [] : []
  const shown = list.slice(0, MAX_ROWS)
  const rest = list.slice(MAX_ROWS).reduce((s, r) => s + r[2], 0)
  const sum = total || list.reduce((s, r) => s + r[2], 0) || 1
  const top = shown[0]?.[2] || 1
  const secs = durationMs > 0 ? durationMs / 1000 : 0
  const label = metric === 'hps' ? 'Healing' : 'Damage'

  let body
  if (state.loading) body = <div className="sb-note">Loading breakdown…</div>
  else if (state.error) body = <div className="sb-note">Couldn’t load the breakdown.</div>
  else if (!state.spells) body = <div className="sb-note">No spell breakdown for this pull. It was imported before breakdowns existed.</div>
  else if (!shown.length) body = <div className="sb-note">No {label.toLowerCase()} done on this pull.</div>
  else
    body = (
      <table className="sb-table">
        <tbody>
          {shown.map(([id, spell, amount, school, pet], i) => (
            <tr key={`${id}-${pet || ''}-${i}`}>
              <td className="sb-name">
                <div className="sb-bar" style={{ width: `${(amount / top) * 100}%`, background: schoolColor(school) }} />
                <span className="sb-label">
                  {spell}
                  {pet && <span className="sb-pet"> ({pet})</span>}
                </span>
              </td>
              <td className="sb-pct">{((amount / sum) * 100).toFixed(1)}%</td>
              <td className="sb-amt">{compact(amount)}</td>
              {secs > 0 && <td className="sb-rate">{compact(amount / secs)}</td>}
            </tr>
          ))}
          {rest > 0 && (
            <tr className="sb-rest">
              <td className="sb-name">
                <span className="sb-label">{list.length - MAX_ROWS} more</span>
              </td>
              <td className="sb-pct">{((rest / sum) * 100).toFixed(1)}%</td>
              <td className="sb-amt">{compact(rest)}</td>
              {secs > 0 && <td className="sb-rate">{compact(rest / secs)}</td>}
            </tr>
          )}
        </tbody>
      </table>
    )

  return createPortal(
    <div className="spell-panel" ref={ref} style={pos} role="tooltip">
      <div className="sb-head">
        <span className="sb-title">{label} by spell</span>
        <span className="sb-who">{name}</span>
      </div>
      {shown.length > 0 && (
        <div className="sb-cols">
          <span>Spell</span>
          <span>%</span>
          <span>Total</span>
          {secs > 0 && <span>{metric === 'hps' ? 'HPS' : 'DPS'}</span>}
        </div>
      )}
      {body}
    </div>,
    document.body,
  )
}
