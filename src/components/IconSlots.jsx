import { specIconUrl, raceIconUrl } from '../lib/classes.js'

// Spec + race icons shown next to the name. Each sits inside its placeholder
// square, so if an image is missing/blocked the square shows through (rather than
// a broken image). `specIcon` is the frozen armory icon; we fall back to the
// per-class spec-icon map.
export function SpecRaceSlots({ klass, spec, specIcon, race, gender, size = 16 }) {
  const dim = { width: size, height: size }
  const sIcon = specIcon || specIconUrl(klass, spec)
  const rIcon = raceIconUrl(race, gender)
  const hide = (e) => {
    e.currentTarget.style.display = 'none'
  }
  return (
    <span className="icon-slots">
      <span className="icon-slot" style={dim} title={spec ? `Spec: ${spec}` : 'Spec'}>
        {sIcon && <img src={sIcon} alt="" onError={hide} />}
      </span>
      <span className="icon-slot" style={dim} title={race ? `Race: ${race}` : 'Race'}>
        {rIcon && <img src={rIcon} alt="" onError={hide} />}
      </span>
    </span>
  )
}

// The two trinket icons (boss table column). `trinkets` is [{ name, ilvl, icon }]
// frozen from the armory at import; falls back to empty squares when unknown.
export function TrinketSlots({ trinkets }) {
  const list = Array.isArray(trinkets) ? trinkets : []
  return (
    <span className="icon-slots">
      {[0, 1].map((i) => {
        const t = list[i]
        return t && t.icon ? (
          <img
            key={i}
            className="icon-slot trinket"
            src={t.icon}
            alt=""
            title={`${t.name}${t.ilvl ? ` (${t.ilvl})` : ''}`}
          />
        ) : (
          <span key={i} className="icon-slot trinket" title={`Trinket ${i + 1}`} />
        )
      })}
    </span>
  )
}
