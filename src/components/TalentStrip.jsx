import { TALENT_SLOTS } from '../lib/classes.js'

// Renders the chosen talent column (1-3) per row. `talents` is an array of
//   { row, col, icon? }   (col 0 = none). If `icon` is set it shows the icon with
// the column as a small badge; otherwise it just shows the column number.
// Falls back to empty placeholder slots when there's no data yet.
export default function TalentStrip({ talents }) {
  const list = Array.isArray(talents) ? talents : []

  if (list.length === 0) {
    const slots = Array.from({ length: TALENT_SLOTS }, (_, i) => i)
    return (
      <div className="talent-strip" title="Talents — not imported yet">
        {slots.map((i) => (
          <span key={i} className="talent-slot empty" title={`Row ${i + 1}`} />
        ))}
      </div>
    )
  }

  return (
    <div className="talent-strip">
      {list.map((t, i) => {
        const col = typeof t === 'object' ? t.col : t
        const row = typeof t === 'object' && t.row ? t.row : i + 1
        const icon = typeof t === 'object' ? t.icon : null
        const label = `Row ${row}: ${col ? `column ${col}` : 'none'}`
        return (
          <span
            key={i}
            className={`talent-slot ${col ? 'picked' : 'none'} col-${col || 0}`}
            title={label}
          >
            {icon ? <img src={icon} alt={label} /> : null}
            <span className="talent-col">{col || '–'}</span>
          </span>
        )
      })}
    </div>
  )
}
