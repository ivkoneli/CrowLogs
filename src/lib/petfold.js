// Folding unmapped pet rows back into their owner.
//
// The parser only credits a pet to its owner when the log contains a SPELL_SUMMON
// naming that owner (see parser.js). A permanent pet that was already out before
// logging started — a frost mage's Water Elemental, an unholy DK's ghoul — has no
// summon event in the file, so it lands as its own "pet" row. Two ways to reunite it:
//
//   • by owner GUID — the CrowLogsHelper addon records petGUID→ownerGUID live, so we
//     can fold exactly, even with two mages present. Applied at import (see addon.js).
//   • by class — no addon data: map a fixed pet NAME to its owner class and fold into
//     the sole player of that class in the encounter. Applied at read time, where
//     class is known. Stays separate when 2+ of that class are present (we can't tell
//     which one owns it) — the same safety rule the parser's base fallback uses.

// Fixed-name pets whose owner class is unambiguous. Hunter/Warlock pets are left out
// on purpose: they can be renamed, so the name doesn't identify a class.
const PET_OWNER_CLASS = {
  'Water Elemental': 'Mage',
}

// The key shared by every record from the same pull.
const encKey = (f) => `${f.logid}|${f.started}|${f.boss}|${f.difficulty}`

// Merge a pet's output into its owner (mutates `owner`) and recompute the rates from
// the encounter duration they share. Safe because callers operate on fresh record
// copies (mergeCharacters / freezeFromAddon both map to new objects).
function absorb(owner, pet) {
  owner.damage = (owner.damage || 0) + (pet.damage || 0)
  owner.healing = (owner.healing || 0) + (pet.healing || 0)
  owner.hits = (owner.hits || 0) + (pet.hits || 0)
  const sec = (owner.duration || 0) / 1000
  if (sec > 0) {
    owner.dps = Math.round(owner.damage / sec)
    owner.hps = Math.round(owner.healing / sec)
  }
}

// Group records by encounter → Map(key -> records[]).
function byEncounter(fights) {
  const groups = new Map()
  for (const f of fights) {
    const k = encKey(f)
    let g = groups.get(k)
    if (!g) groups.set(k, (g = []))
    g.push(f)
  }
  return groups
}

// Fold pets whose owner GUID we know from the addon (petGUID -> ownerGUID). Exact and
// class-independent. Returns a new array with the folded pet rows removed (or the same
// array when nothing folded).
export function foldPetsByOwner(fights, petOwners) {
  if (!petOwners || !Object.keys(petOwners).length) return fights
  const dropped = new Set()
  for (const recs of byEncounter(fights).values()) {
    for (const pet of recs) {
      if (!pet.pet) continue
      const ownerGuid = petOwners[pet.guid]
      if (!ownerGuid) continue
      const owner = recs.find((r) => !r.pet && r.guid === ownerGuid)
      if (!owner) continue
      absorb(owner, pet)
      dropped.add(pet)
    }
  }
  return dropped.size ? fights.filter((f) => !dropped.has(f)) : fights
}

// Fold fixed-name pets into the only player of their owner class in the encounter.
// Used at read time, after class enrichment. Returns a new array (or the same one).
export function foldPetsByClass(fights) {
  const dropped = new Set()
  for (const recs of byEncounter(fights).values()) {
    for (const pet of recs) {
      if (!pet.pet) continue
      const klass = PET_OWNER_CLASS[pet.player]
      if (!klass) continue
      const owners = recs.filter((r) => !r.pet && r.class === klass)
      if (owners.length !== 1) continue // ambiguous (or none) — leave it as its own row
      absorb(owners[0], pet)
      dropped.add(pet)
    }
  }
  return dropped.size ? fights.filter((f) => !dropped.has(f)) : fights
}
