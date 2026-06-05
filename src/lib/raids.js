// Raid / boss registry and combat-log difficulty mapping.

// WoW ENCOUNTER_START difficultyID values (raid):
export const DIFFICULTY_MAP = {
  14: 'Normal',
  15: 'Heroic',
  16: 'Mythic',
  17: 'LFR',
  23: 'Mythic', // Mythic dungeon (kept for completeness)
}

export const DEFAULT_DIFFICULTY = 'Mythic'
export const DIFFICULTIES = ['Mythic', 'Heroic', 'Normal']

// Bosses are listed in encounter order.
export const RAIDS = [
  {
    name: 'Highmaul',
    bosses: [
      'Kargath Bladefist',
      'The Butcher',
      'Tectus',
      'Brackenspore',
      'Twin Ogron',
      "Ko'ragh",
      "Imperator Mar'gok",
    ],
  },
]

// Aliases let us match an ENCOUNTER_START name or a boss creature name to a
// canonical boss, even if spelling/spacing differs slightly.
const ALIASES = {
  'kargath bladefist': { raid: 'Highmaul', boss: 'Kargath Bladefist' },
  kargath: { raid: 'Highmaul', boss: 'Kargath Bladefist' },
  'the butcher': { raid: 'Highmaul', boss: 'The Butcher' },
  butcher: { raid: 'Highmaul', boss: 'The Butcher' },
  tectus: { raid: 'Highmaul', boss: 'Tectus' },
  brackenspore: { raid: 'Highmaul', boss: 'Brackenspore' },
  'twin ogron': { raid: 'Highmaul', boss: 'Twin Ogron' },
  phemos: { raid: 'Highmaul', boss: 'Twin Ogron' },
  pol: { raid: 'Highmaul', boss: 'Twin Ogron' },
  "ko'ragh": { raid: 'Highmaul', boss: "Ko'ragh" },
  koragh: { raid: 'Highmaul', boss: "Ko'ragh" },
  "imperator mar'gok": { raid: 'Highmaul', boss: "Imperator Mar'gok" },
  margok: { raid: 'Highmaul', boss: "Imperator Mar'gok" },
  "mar'gok": { raid: 'Highmaul', boss: "Imperator Mar'gok" },
}

const norm = (s) => (s || '').toLowerCase().trim()

// Returns { raid, boss } for a recognized name, else null.
export function matchBoss(name) {
  const n = norm(name)
  if (!n) return null
  if (ALIASES[n]) return ALIASES[n]
  // loose contains match (e.g. "Imperator Mar'gok <Sorcerer King>")
  for (const key of Object.keys(ALIASES)) {
    if (n.includes(key)) return ALIASES[key]
  }
  return null
}

export function difficultyFromId(id) {
  return DIFFICULTY_MAP[Number(id)] || DEFAULT_DIFFICULTY
}
