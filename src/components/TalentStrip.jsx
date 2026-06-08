import { TALENT_SLOTS, talentIconUrl, iconUrl } from '../lib/classes.js'

// Renders the chosen talent (col 1-3) per row as its real icon, looked up from the
// class/spec talent table. `talents` is an array of { row, col } (col 0 = none).
// If an icon is missing (unknown class/spec, or it fails to load) the slot falls
// back to the column number.
export default function TalentStrip({ talents, klass, spec }) {
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
        // Prefer the icon the addon snapshot already resolved (a bare icon name); fall
        // back to the class/spec talent table when only the column is known (armory).
        const icon = (typeof t === 'object' && t.icon && iconUrl(t.icon)) || talentIconUrl(klass, spec, row, col)
        const label = `Row ${row}: ${col ? `column ${col}` : 'none'}`
        return (
          <span
            key={i}
            className={`talent-slot ${col ? 'picked' : 'none'} col-${col || 0}`}
            title={label}
          >
            {icon && (
              <img
                src={icon}
                alt={label}
                onError={(e) => {
                  e.currentTarget.style.display = 'none'
                }}
              />
            )}
            {!icon && <span className="talent-col">{col || '–'}</span>}
          </span>
        )
      })}
    </div>
  )
}
