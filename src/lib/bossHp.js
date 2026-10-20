// Boss health, for "wipe at X%" on uploaded logs. Tauri's logs are recorded without
// advanced combat logging (no unit HP on the lines), so the boss's health is worked out
// from the damage it took during the pull: remaining = 1 − damage taken ÷ max health.
//
// Max health per difficulty is Tauri's own (legion-shoot.tauri.hu/?npc=<id>). Mythic is a
// fixed 20-player value. Normal/Heroic (and LFR) list the 10-player value and scale with
// the group: × (1 + 0.105 × (players − 10)) — checked against every kill in our logs:
// 22 players 2.26×, 23 2.365×, 24 2.47×, 25 2.575×, 30 3.10× (each within 0.1%), and the
// Mythic Nythendra kill took 1,320.3M of her 1,320,302,025.
//
// Keyed by ENCOUNTER_START id. `npcs` are the creatures whose damage counts:
//   • Dragons of Nightmare share ONE health pool across the dragons (the 30-player Heroic
//     kill took 1,391.8M across three dragons; one dragon's pool is 1,391.7M).
//   • Il'gynoth's % is the Heart's. A wipe before the Heart is ever exposed reads the Eye
//     of Il'gynoth instead (`phase`): a fixed 1,000,989,000 at every size and difficulty
//     (the 25- and 30-player kills both took 1,001.0M), labelled as the Eye on the page.
export const BOSS_HP = {
  1853: { npcs: [102672], hp: { LFR: 288982184, Normal: 412831692, Heroic: 536681200, Mythic: 1320302025 } }, // Nythendra
  1873: {
    npcs: [105393],
    hp: { LFR: 83871756, Normal: 111830491, Heroic: 139793675, Mythic: 1339801532 },
    phase: { name: "Eye of Il'gynoth", npcs: [105906], hp: 1000989000 },
  }, // Il'gynoth (Heart; the Eye before the Heart phase)
  1876: { npcs: [106087], hp: { LFR: 235870950, Normal: 315261660, Heroic: 393501780, Mythic: 1361147970 } }, // Elerethe Renferal
  1841: { npcs: [100497], hp: { LFR: 256547052, Normal: 307863366, Heroic: 427582256, Mythic: 1336525344 } }, // Ursoc
  1854: {
    npcs: [102679, 102683, 102682, 102681], // Ysondre, Emeriss, Lethon, Taerar — one shared pool
    hp: { LFR: 269364625, Normal: 359155518, Heroic: 448948712, Mythic: 1124080406 },
  }, // Dragons of Nightmare
  1877: { npcs: [104636], hp: { LFR: 211087241, Normal: 301546627, Heroic: 392006013, Mythic: 1172106033 } }, // Cenarius
  1864: { npcs: [103769], hp: { LFR: 393743404, Normal: 524996958, Heroic: 656250512, Mythic: 1923901539 } }, // Xavius
}

// Max health of an encounter's boss for a difficulty and group size, or null if unknown.
export function bossMaxHp(encounterId, difficulty, groupSize) {
  const b = BOSS_HP[encounterId]
  const base = b?.hp[difficulty]
  if (!base) return null
  if (difficulty === 'Mythic') return base
  const n = Math.min(Math.max(Number(groupSize) || 10, 10), 30)
  return base * (1 + 0.105 * (n - 10))
}

// The npc id inside a creature GUID ("Creature-0-12-1520-0-100497-00000C344E" → 100497).
export function npcIdOf(guid) {
  if (!guid || !(guid.startsWith('Creature-') || guid.startsWith('Vehicle-'))) return null
  return Number(guid.split('-')[5]) || null
}

const pctOf = (taken, max) => Math.round(Math.min(Math.max(1 - taken / max, 0), 1) * 1000) / 10

// Boss health left (0-100, one decimal) given the damage it took, or null when unknown.
export function bossPctLeft(encounterId, difficulty, groupSize, damageTaken) {
  const max = bossMaxHp(encounterId, difficulty, groupSize)
  return max ? pctOf(damageTaken, max) : null
}

// The wipe's health readout: { pct, of } — `of` names the unit when it isn't the boss itself
// (Il'gynoth's Eye, when the Heart was never hit), else null. `damage` maps npc id → taken.
export function wipeHealth(encounterId, difficulty, groupSize, damage) {
  const b = BOSS_HP[encounterId]
  if (!b) return { pct: null, of: null }
  const sum = (npcs) => npcs.reduce((s, n) => s + (damage.get(n) || 0), 0)
  const main = sum(b.npcs)
  if (b.phase && main <= 0) return { pct: pctOf(sum(b.phase.npcs), b.phase.hp), of: b.phase.name }
  return { pct: bossPctLeft(encounterId, difficulty, groupSize, main), of: null }
}
