import { useEffect, useRef, useState } from 'react'
import { LEGION_CLASSES, classColor, classIconUrl, specIconUrl } from '../lib/classes.js'

// One dropdown for class AND spec: "All", then each class (its crest, in its color) with
// its specs indented under it ("Arms Warrior", spec icon). A native <select> can't show
// icons, so this is a small listbox styled like the other filter fields.
// value = { klass, spec } (either may be null); onChange gets the same shape.
export default function ClassSpecPicker({ label = 'Class / spec', klass, spec, onChange }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const listRef = useRef(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e) => !ref.current?.contains(e.target) && setOpen(false)
    const onKey = (e) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    // Open scrolled to the current choice.
    listRef.current?.querySelector('.csp-opt.on')?.scrollIntoView({ block: 'nearest' })
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const pick = (next) => {
    onChange(next)
    setOpen(false)
  }
  const icon = klass ? (spec ? specIconUrl(klass, spec) : classIconUrl(klass)) : null
  const text = klass ? (spec ? `${spec} ${klass}` : klass) : 'All classes'

  return (
    <div className="filter-field csp" ref={ref}>
      <span className="field-label">{label}</span>
      <button
        type="button"
        className={`csp-button ${open ? 'open' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        style={klass ? { color: classColor(klass) } : undefined}
      >
        {icon && <img className="csp-icon" src={icon} alt="" />}
        <span className="csp-text">{text}</span>
        <span className="caret">▾</span>
      </button>
      {open && (
        <ul className="csp-list" role="listbox" ref={listRef}>
          <li
            role="option"
            aria-selected={!klass}
            className={`csp-opt csp-all ${!klass ? 'on' : ''}`}
            onClick={() => pick({ klass: null, spec: null })}
          >
            All
          </li>
          {LEGION_CLASSES.map((c) => (
            <li key={c.name} className="csp-group">
              <div
                role="option"
                aria-selected={klass === c.name && !spec}
                className={`csp-opt csp-class ${klass === c.name && !spec ? 'on' : ''}`}
                style={{ color: c.color }}
                onClick={() => pick({ klass: c.name, spec: null })}
              >
                <img className="csp-icon" src={classIconUrl(c.name)} alt="" />
                {c.name}
              </div>
              {c.specs.map((s) => (
                <div
                  key={s.name}
                  role="option"
                  aria-selected={klass === c.name && spec === s.name}
                  className={`csp-opt csp-spec ${klass === c.name && spec === s.name ? 'on' : ''}`}
                  style={{ color: c.color }}
                  onClick={() => pick({ klass: c.name, spec: s.name })}
                >
                  <img className="csp-icon" src={specIconUrl(c.name, s.name)} alt="" />
                  {s.name} {c.name}
                </div>
              ))}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
