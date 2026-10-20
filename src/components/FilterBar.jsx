import { ROLES, FACTIONS } from '../lib/classes.js'
import { DIFFICULTY_ORDER } from '../lib/rankings.js'
import ClassSpecPicker from './ClassSpecPicker.jsx'

// A labeled dropdown, styled to match the guild theme.
function Field({ label, value, onChange, disabled, children }) {
  return (
    <label className={`filter-field ${disabled ? 'disabled' : ''}`}>
      <span className="field-label">{label}</span>
      <span className="select-wrap">
        <select value={value || ''} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
          {children}
        </select>
        <span className="caret">▾</span>
      </span>
    </label>
  )
}

// Compact dropdown filter row: Difficulty · Class / spec · Role · Faction · Realm.
// `filter` = { difficulty, class, spec, role, faction, realm }.
export default function FilterBar({ filter, onFilter, realms, difficulties = [] }) {
  const set = (patch) => onFilter({ ...filter, ...patch })
  // The picked difficulty stays listed even before any kill on it (the page opens on Mythic).
  const diffs = [...new Set([...difficulties, filter.difficulty].filter(Boolean))].sort(
    (a, b) => DIFFICULTY_ORDER.indexOf(a) - DIFFICULTY_ORDER.indexOf(b),
  )

  return (
    <div className="filter-bar">
      <Field
        label="Difficulty"
        value={filter.difficulty}
        onChange={(v) => set({ difficulty: v || null })}
        disabled={diffs.length === 0}
      >
        <option value="">All difficulties</option>
        {diffs.map((d) => (
          <option key={d} value={d}>
            {d}
          </option>
        ))}
      </Field>

      <ClassSpecPicker
        klass={filter.class}
        spec={filter.spec}
        onChange={({ klass, spec }) => set({ class: klass, spec })}
      />

      <Field label="Role" value={filter.role} onChange={(v) => set({ role: v || null })}>
        <option value="">All roles</option>
        {ROLES.map((r) => (
          <option key={r.value} value={r.value}>
            {r.label}
          </option>
        ))}
      </Field>

      <Field label="Faction" value={filter.faction} onChange={(v) => set({ faction: v || null })}>
        <option value="">All factions</option>
        {FACTIONS.map((f) => (
          <option key={f} value={f}>
            {f}
          </option>
        ))}
      </Field>

      <Field label="Realm" value={filter.realm} onChange={(v) => set({ realm: v || null })}>
        <option value="">All realms</option>
        {realms.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </Field>
    </div>
  )
}
