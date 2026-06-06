// Placeholder character gear for the player page's fixed stats panel. Demo only
// — real gear/gems/enchants/artifact traits will come from the armory scrape.
// quality: epic | rare | uncommon | common.  enchant: 'ok' | 'missing' | null.

export const DEMO_GEAR = [
  { slot: 'Head', name: "Warmongering Gladiator's Plate Helm", ilvl: 710, quality: 'epic', gems: 0, enchant: null },
  { slot: 'Neck', name: 'Studded Choker of the Accursed', ilvl: 720, quality: 'epic', gems: 1, enchant: 'missing' },
  { slot: 'Shoulder', name: 'Uncrushable Shoulderplates', ilvl: 720, quality: 'epic', gems: 0, enchant: null },
  { slot: 'Back', name: 'Marked Cloak of Command', ilvl: 720, quality: 'epic', gems: 0, enchant: 'missing' },
  { slot: 'Chest', name: 'Chestplate of Arcane Volatility', ilvl: 720, quality: 'epic', gems: 0, enchant: 'ok' },
  { slot: 'Shirt', name: 'Wraps of the Blood-Soaked Brawler', ilvl: 1, quality: 'common', gems: 0, enchant: null },
  { slot: 'Tabard', name: 'Tabard of the Lightbringer', ilvl: 80, quality: 'uncommon', gems: 0, enchant: null },
  { slot: 'Wrist', name: 'Bracers of Mirrored Flame', ilvl: 720, quality: 'epic', gems: 0, enchant: 'ok' },
  { slot: 'Hands', name: "Warmongering Gladiator's Plate Gauntlets", ilvl: 710, quality: 'epic', gems: 0, enchant: null },
  { slot: 'Waist', name: "Warmongering Gladiator's Plate Girdle", ilvl: 710, quality: 'epic', gems: 1, enchant: null },
  { slot: 'Legs', name: "Warmongering Gladiator's Plate Legguards", ilvl: 710, quality: 'epic', gems: 0, enchant: 'ok' },
  { slot: 'Feet', name: 'Mosscrusher Sabatons', ilvl: 720, quality: 'epic', gems: 0, enchant: 'ok' },
  { slot: 'Finger 1', name: "Grunt's Solid Signet", ilvl: 720, quality: 'epic', gems: 0, enchant: null },
  { slot: 'Finger 2', name: 'Gutwrench Ring', ilvl: 720, quality: 'epic', gems: 0, enchant: null },
  { slot: 'Trinket 1', name: 'Stone of the Elements', ilvl: 715, quality: 'epic', gems: 0, enchant: null },
  { slot: 'Trinket 2', name: 'Mark of Supreme Doom', ilvl: 720, quality: 'epic', gems: 0, enchant: null },
  { slot: 'Main Hand', name: "Warmongering Gladiator's Greatsword", ilvl: 710, quality: 'epic', gems: 0, enchant: 'missing' },
  { slot: 'Off Hand', name: "Warmongering Gladiator's Greatsword", ilvl: 710, quality: 'epic', gems: 0, enchant: 'missing' },
]

// A few placeholder artifact traits (Legion). Empty for now — just the UI.
export const DEMO_ARTIFACT = Array.from({ length: 6 }, (_, i) => ({ row: i + 1, points: 0 }))
