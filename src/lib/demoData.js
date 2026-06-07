// Seeded demo data so the Mythic Highmaul boss pages are populated before any
// real logs are dropped. Every record is flagged `demo: true` and can be hidden
// with the "Clear demo data" button. Numbers are deterministic (no randomness)
// so ranks stay stable across renders.
import { RAIDS } from './raids.js'
import { roleOf } from './classes.js'
import { formatDay } from '../parser.js'

const HIGHMAUL = RAIDS[0].bosses

// [name, skill multiplier, class, spec, ilvl, faction, talentColumns(1-3 per row)]
const DEMO_PLAYERS = [
  ['Ivkomdfk-evermoon', 1.0, 'Warrior', 'Fury', 905, 'Horde', [2, 3, 3, 2, 2, 3, 2]],
  ['Grimfang-Frostmourne', 1.12, 'Death Knight', 'Frost', 912, 'Horde', [1, 3, 2, 3, 1, 2, 3]],
  ['Sunweaver-Area52', 0.95, 'Paladin', 'Retribution', 901, 'Alliance', [2, 1, 3, 2, 3, 1, 2]],
  ['Throgg-Illidan', 1.05, 'Demon Hunter', 'Havoc', 908, 'Horde', [3, 2, 1, 2, 3, 2, 1]],
  ['Mistral-Tichondrius', 0.88, 'Mage', 'Fire', 898, 'Alliance', [1, 2, 2, 3, 1, 3, 2]],
  ['Vexra-Stormrage', 1.08, 'Druid', 'Balance', 910, 'Alliance', [2, 2, 3, 1, 2, 3, 3]],
  ['Bonecrush-Mal’Ganis', 0.78, 'Warlock', 'Affliction', 894, 'Horde', [3, 1, 2, 2, 3, 1, 2]],
  ['Lyandra-Kazzak', 0.92, 'Hunter', 'Marksmanship', 903, 'Alliance', [2, 3, 1, 3, 2, 2, 3]],
]

// Per-boss baseline (rough flavor) and duration in seconds.
const BOSS_PROFILE = {
  'Kargath Bladefist': { base: 38000, dur: 215 },
  'The Butcher': { base: 52000, dur: 150 },
  Tectus: { base: 41000, dur: 240 },
  Brackenspore: { base: 36000, dur: 260 },
  'Twin Ogron': { base: 44000, dur: 205 },
  "Ko'ragh": { base: 39000, dur: 280 },
  "Imperator Mar'gok": { base: 47000, dur: 360 },
}

const BASE_TS = Date.UTC(2024, 5, 1, 21, 0, 0) // 6/1 21:00, demo "raid night"

function makeDemo() {
  const records = []
  HIGHMAUL.forEach((boss, bi) => {
    const profile = BOSS_PROFILE[boss]
    const durationMs = profile.dur * 1000
    const started = BASE_TS + bi * 20 * 60 * 1000 // 20 min apart
    DEMO_PLAYERS.forEach(([player, mult, className, spec, ilvl, faction, cols], pi) => {
      // deterministic per-boss variance
      const variance = ((bi * 7 + pi * 13) % 11) / 100 // 0..0.10
      const dps = Math.round(profile.base * mult * (1 + variance - 0.05))
      const damage = Math.round(dps * profile.dur)
      // Healers heal big and do little damage; everyone else gets minor offhealing
      // so the Healing meter looks plausible in demo mode.
      const healer = roleOf(className, spec) === 'healer'
      const hps = healer ? Math.round(profile.base * 0.5 * mult * (1 + variance - 0.05)) : Math.round(dps * 0.06)
      const healing = Math.round(hps * profile.dur)
      records.push({
        id: `demo::${boss}::${player}`,
        raid: 'Highmaul',
        boss,
        difficulty: 'Mythic',
        player,
        guid: 'Player-demo',
        pet: false,
        damage,
        dps,
        healing,
        hps,
        // 2 = prepot + combat pot (most players); a couple slackers use 1.
        potions: pi % 7 === 0 ? 1 : 2,
        kill: true,
        // Demo lust on the first boss so the hint is visible before a real import.
        bloodlust: bi === 0 ? [{ player: DEMO_PLAYERS[0][0], t: 6 }] : [],
        duration: durationMs,
        hits: Math.round(profile.dur * 1.4),
        started,
        day: formatDay(started),
        logid: `demo-night::${boss}`,
        class: className,
        spec,
        faction,
        ilvl,
        talents: cols.map((col, ri) => ({ row: ri + 1, col, icon: null })),
        demo: true,
      })
    })
  })
  return records
}

export const DEMO_FIGHTS = makeDemo()
