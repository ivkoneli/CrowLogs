// Placeholder character gear for the player page's fixed stats panel, shown only
// until the armory scrape fills in a player's real equipment.
//
// These are deliberately NOT plausible items: every slot reads "—" at ilvl 999,
// so a placeholder can never be mistaken for a real scrape. (It used to list real
// WoD epics around ilvl 710-720, which looked exactly like genuine gear.)
// quality: epic | rare | uncommon | common.  enchant: 'ok' | 'missing' | null.

const SLOTS = [
  'Head',
  'Neck',
  'Shoulder',
  'Back',
  'Chest',
  'Shirt',
  'Tabard',
  'Wrist',
  'Hands',
  'Waist',
  'Legs',
  'Feet',
  'Finger 1',
  'Finger 2',
  'Trinket 1',
  'Trinket 2',
  'Main Hand',
  'Off Hand',
]

// PLACEHOLDER_ILVL is intentionally out of range for any real item, so the
// summary average reads 999 and flags the panel as unscraped at a glance.
export const PLACEHOLDER_ILVL = 999

export const DEMO_GEAR = SLOTS.map((slot) => ({
  slot,
  name: '—',
  ilvl: PLACEHOLDER_ILVL,
  quality: 'common',
  gems: 0,
  enchant: null,
}))

// A Legion artifact has exactly THREE relic slots, so the placeholder shows three.
// Real relics come from the armory's artifact page (see scripts/scrape-armory.mjs).
export const ARTIFACT_RELIC_SLOTS = 3
export const DEMO_ARTIFACT = Array.from({ length: ARTIFACT_RELIC_SLOTS }, (_, i) => ({
  slot: i + 1,
  name: null,
  icon: null,
}))
