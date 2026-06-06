import { LEGION_CLASSES, ROLES, FACTIONS, specsOf } from '../lib/classes.js'

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

// Compact dropdown filter row: Class · Spec · Role · Faction · Realm.
// (Difficulty is chosen via the Mythic/Heroic tabs.) `filter` = { class, spec, role, faction, realm }.
export default function FilterBar({ filter, onFilter, realms }) {
  const set = (patch) => onFilter({ ...filter, ...patch })
  const specs = filter.class ? specsOf(filter.class) : []

  return (
    <div className="filter-bar">
      <Field
        label="Class"
        value={filter.class}
        onChange={(v) => set({ class: v || null, spec: null })}
      >
        <option value="">All classes</option>
        {LEGION_CLASSES.map((c) => (
          <option key={c.name} value={c.name}>
            {c.name}
          </option>
        ))}
      </Field>

      <Field
        label="Spec"
        value={filter.spec}
        onChange={(v) => set({ spec: v || null })}
        disabled={!filter.class}
      >
        <option value="">{filter.class ? 'All specs' : '—'}</option>
        {specs.map((s) => (
          <option key={s.name} value={s.name}>
            {s.name}
          </option>
        ))}
      </Field>

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
