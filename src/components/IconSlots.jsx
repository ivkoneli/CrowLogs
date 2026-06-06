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

// Two squares for the trinket slots (boss table column).
export function TrinketSlots() {
  return (
    <span className="icon-slots">
      <span className="icon-slot trinket" title="Trinket 1" />
      <span className="icon-slot trinket" title="Trinket 2" />
    </span>
  )
}
