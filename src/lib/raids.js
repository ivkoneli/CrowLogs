// Raid / boss registry and combat-log difficulty mapping.

// WoW ENCOUNTER_START difficultyID values (raid).
// Two schemes appear in logs:
//   • MoP/Cata-era 10/25-man raids use 3-7.
//   • WoD+ flexible raids use 14-17.
export const DIFFICULTY_MAP = {
  3: 'Normal', // 10 Player
  4: 'Normal', // 25 Player
  5: 'Heroic', // 10 Player Heroic
  6: 'Heroic', // 25 Player Heroic
  7: 'LFR', // Looking For Raid
  14: 'Normal',
  15: 'Heroic',
  16: 'Mythic',
  17: 'LFR',
  23: 'Mythic', // Mythic dungeon (kept for completeness)
}

export const DEFAULT_DIFFICULTY = 'Mythic'
export const DIFFICULTIES = ['Mythic', 'Heroic', 'Normal']

// `section` decides where a raid sits in the sidebar:
//   'main'  → its own top-level group, expanded by default (current progression).
//   'other' → tucked inside the collapsed "Other" section with the unrecognized
//             encounters. Retired content stays reachable but out of the way.
// Order within a section is the render order. Bosses are listed in encounter order.
export const RAIDS = [
  {
    name: 'The Emerald Nightmare',
    section: 'main',
    bosses: [
      'Nythendra',
      "Il'gynoth",
      'Elerethe Renferal',
      'Ursoc',
      'Dragons of Nightmare',
      'Cenarius',
      'Xavius',
    ],
  },
  {
    name: 'Highmaul',
    section: 'other',
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

// Raids grouped by sidebar section (see `section` above).
export const MAIN_RAIDS = RAIDS.filter((r) => r.section !== 'other')
export const OTHER_RAIDS = RAIDS.filter((r) => r.section === 'other')

// Aliases let us match an ENCOUNTER_START name or a boss creature name to a
// canonical boss, even if spelling/spacing differs slightly.
//
// Keys are matched exactly first, then by a loose `includes` pass in insertion
// order — so keep keys distinctive enough that they can't appear inside an
// unrelated encounter name.
const ALIASES = {
  // ── The Emerald Nightmare ──
  nythendra: { raid: 'The Emerald Nightmare', boss: 'Nythendra' },
  "il'gynoth, heart of corruption": { raid: 'The Emerald Nightmare', boss: "Il'gynoth" },
  "il'gynoth": { raid: 'The Emerald Nightmare', boss: "Il'gynoth" },
  ilgynoth: { raid: 'The Emerald Nightmare', boss: "Il'gynoth" },
  // The killable target in the Il'gynoth encounter is the Eye; the Horror is the
  // outer-phase add that shares the encounter.
  'eye of il\'gynoth': { raid: 'The Emerald Nightmare', boss: "Il'gynoth" },
  'nightmare horror': { raid: 'The Emerald Nightmare', boss: "Il'gynoth" },
  'elerethe renferal': { raid: 'The Emerald Nightmare', boss: 'Elerethe Renferal' },
  elerethe: { raid: 'The Emerald Nightmare', boss: 'Elerethe Renferal' },
  renferal: { raid: 'The Emerald Nightmare', boss: 'Elerethe Renferal' },
  ursoc: { raid: 'The Emerald Nightmare', boss: 'Ursoc' },
  // Dragons of Nightmare is one encounter with four bosses — any of them maps to it.
  'dragons of nightmare': { raid: 'The Emerald Nightmare', boss: 'Dragons of Nightmare' },
  ysondre: { raid: 'The Emerald Nightmare', boss: 'Dragons of Nightmare' },
  lethon: { raid: 'The Emerald Nightmare', boss: 'Dragons of Nightmare' },
  emeriss: { raid: 'The Emerald Nightmare', boss: 'Dragons of Nightmare' },
  taerar: { raid: 'The Emerald Nightmare', boss: 'Dragons of Nightmare' },
  cenarius: { raid: 'The Emerald Nightmare', boss: 'Cenarius' },
  xavius: { raid: 'The Emerald Nightmare', boss: 'Xavius' },

  // ── Highmaul ──
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
