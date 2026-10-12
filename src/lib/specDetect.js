// Spec detection from the combat log itself. A fight's per-spell totals say what the
// player actually played on that pull, which the armory can't: it only knows the spec
// they are in when it gets scraped, and a log is often imported days after the raid
// (a Holy priest who has since gone Shadow would be frozen as Shadow on a healing log).
//
// Each spec lists spell ids only it deals damage/healing with. The spec whose signature
// spells add up to the most output wins, so a few off-spec casts (druid affinities, a
// healer's filler nuke) can't outvote the real rotation. Order of trust at import is
// addon snapshot > this > armory.
//
// Ids are Legion (7.x) combat-log ids — the damage/heal event's id, which is often not
// the cast's id.
const SIGNATURES = [
  ['Death Knight', 'Blood', [195182, 206930, 50842, 206931, 45470]],
  ['Death Knight', 'Frost', [49184, 55095, 222024, 66198, 222026, 66196, 196771]],
  ['Death Knight', 'Unholy', [191587, 194311, 85948, 70890, 207311, 191685]],
  ['Demon Hunter', 'Havoc', [162243, 198030, 222031, 199547, 227518, 201428, 210153, 203796]],
  ['Demon Hunter', 'Vengeance', [228478, 228477, 203782, 204598, 207693, 203794]],
  ['Druid', 'Balance', [194153, 190984, 78674, 202771, 202768, 202767, 191037]],
  ['Druid', 'Feral', [1079, 155722, 1822, 5221, 22568, 202028, 210722]],
  ['Druid', 'Guardian', [77758, 192090, 33917, 6807, 213771, 22842]],
  ['Druid', 'Restoration', [774, 155777, 81269, 48438, 33763, 157982, 8936]],
  ['Hunter', 'Beast Mastery', [193455, 83381, 217200, 207097]],
  ['Hunter', 'Marksmanship', [19434, 191043, 212621, 185358, 204147]],
  ['Hunter', 'Survival', [186270, 190928, 185855, 202800]],
  ['Mage', 'Arcane', [30451, 7268, 44425]],
  ['Mage', 'Fire', [11366, 133, 12654, 108853, 194466]],
  ['Mage', 'Frost', [228598, 228597, 148022, 84721, 228354, 228599]],
  ['Monk', 'Brewmaster', [121253, 123725, 115181, 205523]],
  ['Monk', 'Mistweaver', [119611, 191840, 116670, 124682, 191894, 115175, 115310]],
  ['Monk', 'Windwalker', [117418, 222029, 158221, 196061]],
  ['Paladin', 'Holy', [25914, 82326, 53652, 225311]],
  ['Paladin', 'Protection', [31935, 53600, 53595, 88263, 204019]],
  ['Paladin', 'Retribution', [224266, 184575, 205273, 217020, 224239]],
  ['Priest', 'Discipline', [81751, 94472, 194509, 47666, 47750, 208771, 204213]],
  ['Priest', 'Holy', [77489, 596, 34861, 2050, 204883, 139, 2060, 64844]],
  ['Priest', 'Shadow', [8092, 15407, 34914, 205448, 228360, 228361, 148859]],
  ['Rogue', 'Assassination', [5374, 27576, 32645, 113780, 703, 192759, 222062]],
  ['Rogue', 'Outlaw', [193315, 2098, 185763, 86392, 202822]],
  ['Rogue', 'Subtlety', [185438, 53, 196819, 195452, 197835]],
  ['Shaman', 'Elemental', [8042, 77451, 45284, 45297, 188196, 188443, 117014]],
  ['Shaman', 'Enhancement', [32175, 32176, 60103, 193786, 10444, 187874]],
  ['Shaman', 'Restoration', [61295, 1064, 73921, 77472, 114942, 52042]],
  ['Warlock', 'Affliction', [980, 30108, 233490, 233496, 233497, 233498, 233499, 198590]],
  ['Warlock', 'Demonology', [686, 157695, 86040, 603, 193440]],
  ['Warlock', 'Destruction', [116858, 29722, 348, 157736, 17962, 196448]],
  ['Warrior', 'Arms', [12294, 772, 1464, 167105, 163201]],
  ['Warrior', 'Fury', [23881, 96103, 85384, 218617, 5308, 163558, 205546]],
  ['Warrior', 'Protection', [23922, 6572, 20243, 236282, 190456]],
]

const BY_SPELL = new Map()
SIGNATURES.forEach(([, , ids], i) => ids.forEach((id) => BY_SPELL.set(id, i)))

// `spells` = a fight's { dmg, heal } lists of [spellId, name, amount, school, petName].
// → { class, spec } for the spec that produced the most signature output, else null.
export function specFromSpells(spells) {
  const score = new Map()
  for (const list of [spells?.dmg, spells?.heal]) {
    for (const [id, , amount] of list || []) {
      const i = BY_SPELL.get(id)
      if (i != null) score.set(i, (score.get(i) || 0) + amount)
    }
  }
  let best = null
  let bestAmount = 0
  for (const [i, amount] of score) {
    if (amount > bestAmount) {
      bestAmount = amount
      best = i
    }
  }
  if (best == null) return null
  return { class: SIGNATURES[best][0], spec: SIGNATURES[best][1] }
}
