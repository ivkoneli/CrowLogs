import { useState } from 'react'

// "4s apart" / "1m 20s apart" — how far the incoming pull's start is from the saved one.
function gapLabel(ms) {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s apart`
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s apart`
}

// Shown before an import when some incoming encounters look like duplicates of ones already
// saved (see lib/dedup.js). Every suspected duplicate is pre-checked to skip; the user unchecks
// any they actually want to keep, then chooses "Skip checked" (drop the still-checked ones) or
// "Import all" (keep everything). Nothing is ever silently merged.
export default function DuplicatePrompt({ duplicates, total, onResolve }) {
  const [skip, setSkip] = useState(() => new Set(duplicates.map((d) => d.key)))

  const toggle = (key) => {
    setSkip((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  // Every encounter in this upload was flagged — there's nothing new in it at all.
  const allDuplicate = total != null && duplicates.length >= total
  // How many encounters would actually be imported given the current checkboxes (non-flagged
  // encounters always import; flagged-and-checked ones get skipped).
  const importCount = (total ?? duplicates.length) - skip.size

  return (
    <div className="dup-backdrop" role="dialog" aria-modal="true" aria-label="Possible duplicate encounters">
      <div className="dup-modal">
        <h2 className="dup-title">Possible duplicates found</h2>
        <p className="dup-sub muted">
          {duplicates.length} {duplicates.length === 1 ? 'encounter' : 'encounters'} in this upload look like
          pulls already imported from another log. Checked ones will be skipped so they aren’t counted twice.
        </p>

        {allDuplicate && (
          <p className="dup-allnote">
            Every encounter in this upload appears to be already imported — skipping them all imports nothing new.
          </p>
        )}

        <ul className="dup-list">
          {duplicates.map((d) => (
            <li key={d.key} className={`dup-row ${skip.has(d.key) ? 'skipping' : ''}`}>
              <label className="dup-check">
                <input type="checkbox" checked={skip.has(d.key)} onChange={() => toggle(d.key)} />
                <span className="dup-box" aria-hidden="true" />
              </label>
              <div className="dup-info">
                <span className="dup-boss">
                  {d.boss} <span className="dup-diff">{d.difficulty}</span>
                </span>
                <span className="dup-meta muted">
                  {d.day} · {d.matched}/{d.rosterSize} players match · {gapLabel(d.gapMs)}
                </span>
              </div>
            </li>
          ))}
        </ul>

        <div className="dup-actions">
          <button className="dup-btn ghost" onClick={() => onResolve({ action: 'import-all' })}>
            Import all anyway
          </button>
          <button className="dup-btn primary" onClick={() => onResolve({ action: 'skip', keys: skip })}>
            {skip.size === 0
              ? 'Import (nothing skipped)'
              : importCount <= 0
                ? `Skip all ${skip.size} — nothing to import`
                : `Skip ${skip.size} & import ${importCount}`}
          </button>
        </div>
      </div>
    </div>
  )
}
