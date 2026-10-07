// Mythic+ dungeon + realm registry. Plain data with no browser imports, so both the
// site (src/lib/mythicplus.js) and the Node scraper (scripts/scrape-mythic-plus.mjs) use it.

// Tauri armory map ids, in the armory's own order. Karazhan (227/234), Cathedral (233)
// and Seat (239) exist on the armory but aren't implemented on the server yet — add them
// here when they open and both the scraper and the profile pick them up.
export const MPLUS_DUNGEONS = [
  { id: 197, name: 'Eye of Azshara' },
  { id: 198, name: 'Darkheart Thicket' },
  { id: 199, name: 'Black Rook Hold' },
  { id: 200, name: 'Halls of Valor' },
  { id: 206, name: "Neltharion's Lair" },
  { id: 207, name: 'Vault of the Wardens' },
  { id: 208, name: 'Maw of Souls' },
  { id: 209, name: 'The Arcway' },
  { id: 210, name: 'Court of Stars' },
]

// Realm slug used in fight `player` keys ("Name-evermoon") ↔ armory realm string.
export const MPLUS_REALMS = {
  evermoon: '[EN] Evermoon',
}
export const DEFAULT_MPLUS_REALM = '[EN] Evermoon'
