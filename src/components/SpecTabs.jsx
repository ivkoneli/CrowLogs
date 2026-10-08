// Shared spec filter buttons (raid rankings, raid history, M+).
// All | <spec> | … sub-tabs. `specs` is [{ spec, icon }]; `value` null = All.
export default function SpecTabs({ specs, value, onChange }) {
  return (
    <div className="spec-tabs">
      <button className={`seg ${value === null ? 'on' : ''}`} onClick={() => onChange(null)}>
        All
      </button>
      {specs.map((s) => (
        <button
          key={s.spec}
          className={`seg ${value === s.spec ? 'on' : ''}`}
          onClick={() => onChange(s.spec)}
          title={s.spec}
        >
          {s.icon && (
            <img
              className="spec-tab-icon"
              src={s.icon}
              alt=""
              onError={(e) => {
                e.currentTarget.style.display = 'none'
              }}
            />
          )}
          {s.spec}
        </button>
      ))}
    </div>
  )
}
