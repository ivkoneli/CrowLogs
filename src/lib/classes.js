// All playable classes/specs in WoW: Legion (7.x). Demon Hunter is included;
// nothing newer (no Evoker). Colors are the official class colors.
// role: 'dps' | 'tank' | 'healer'.

export const LEGION_CLASSES = [
  {
    name: 'Death Knight',
    color: '#C41E3A',
    specs: [
      { name: 'Blood', role: 'tank' },
      { name: 'Frost', role: 'dps' },
      { name: 'Unholy', role: 'dps' },
    ],
  },
  {
    name: 'Demon Hunter',
    color: '#A330C9',
    specs: [
      { name: 'Havoc', role: 'dps' },
      { name: 'Vengeance', role: 'tank' },
    ],
  },
  {
    name: 'Druid',
    color: '#FF7C0A',
    specs: [
      { name: 'Balance', role: 'dps' },
      { name: 'Feral', role: 'dps' },
      { name: 'Guardian', role: 'tank' },
      { name: 'Restoration', role: 'healer' },
    ],
  },
  {
    name: 'Hunter',
    color: '#AAD372',
    specs: [
      { name: 'Beast Mastery', role: 'dps' },
      { name: 'Marksmanship', role: 'dps' },
      { name: 'Survival', role: 'dps' },
    ],
  },
  {
    name: 'Mage',
    color: '#3FC7EB',
    specs: [
      { name: 'Arcane', role: 'dps' },
      { name: 'Fire', role: 'dps' },
      { name: 'Frost', role: 'dps' },
    ],
  },
  {
    name: 'Monk',
    color: '#00FF98',
    specs: [
      { name: 'Brewmaster', role: 'tank' },
      { name: 'Mistweaver', role: 'healer' },
      { name: 'Windwalker', role: 'dps' },
    ],
  },
  {
    name: 'Paladin',
    color: '#F48CBA',
    specs: [
      { name: 'Holy', role: 'healer' },
      { name: 'Protection', role: 'tank' },
      { name: 'Retribution', role: 'dps' },
    ],
  },
  {
    name: 'Priest',
    color: '#FFFFFF',
    specs: [
      { name: 'Discipline', role: 'healer' },
      { name: 'Holy', role: 'healer' },
      { name: 'Shadow', role: 'dps' },
    ],
  },
  {
    name: 'Rogue',
    color: '#FFF468',
    specs: [
      { name: 'Assassination', role: 'dps' },
      { name: 'Outlaw', role: 'dps' },
      { name: 'Subtlety', role: 'dps' },
    ],
  },
  {
    name: 'Shaman',
    color: '#0070DD',
    specs: [
      { name: 'Elemental', role: 'dps' },
      { name: 'Enhancement', role: 'dps' },
      { name: 'Restoration', role: 'healer' },
    ],
  },
  {
    name: 'Warlock',
    color: '#8788EE',
    specs: [
      { name: 'Affliction', role: 'dps' },
      { name: 'Demonology', role: 'dps' },
      { name: 'Destruction', role: 'dps' },
    ],
  },
  {
    name: 'Warrior',
    color: '#C69B6D',
    specs: [
      { name: 'Arms', role: 'dps' },
      { name: 'Fury', role: 'dps' },
      { name: 'Protection', role: 'tank' },
    ],
  },
]

export const CLASS_COLORS = Object.fromEntries(
  LEGION_CLASSES.map((c) => [c.name, c.color]),
)

export function classColor(className) {
  return CLASS_COLORS[className] || '#8b84a6'
}

export const ROLES = [
  { value: 'tank', label: 'Tank' },
  { value: 'healer', label: 'Healer' },
  { value: 'dps', label: 'DPS' },
]

export const FACTIONS = ['Alliance', 'Horde']

export function specsOf(className) {
  const c = LEGION_CLASSES.find((c) => c.name === className)
  return c ? c.specs : []
}

export function roleOf(className, spec) {
  const c = LEGION_CLASSES.find((c) => c.name === className)
  if (!c) return null
  const s = c.specs.find((s) => s.name === spec)
  return s ? s.role : null
}

// How many talent slots a player picks (Legion talent rows + extra slot the UI shows).
export const TALENT_SLOTS = 8
