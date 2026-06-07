// Small square placeholders for character icons. Empty for now — the UI is in
// place so spec/race art and trinket icons can be dropped in later.

// Two squares (spec + race), shown next to the faction icon.
export function SpecRaceSlots({ spec, race, size = 16 }) {
  const dim = { width: size, height: size }
  return (
    <span className="icon-slots">
      <span className="icon-slot" style={dim} title={spec ? `Spec: ${spec}` : 'Spec'} />
      <span className="icon-slot" style={dim} title={race ? `Race: ${race}` : 'Race'} />
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
