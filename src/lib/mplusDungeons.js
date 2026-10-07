// Mythic+ dungeon + realm registry. Plain data with no browser imports, so both the
// site (src/lib/mythicplus.js) and the Node scraper (scripts/scrape-mythic-plus.mjs) use it.

// Tauri armory map ids, in the armory's own order. Karazhan (227/234), Cathedral (233)
// and Seat (239) exist on the armory but aren't implemented on the server yet — add them
// here when they open and both the scraper and the profile pick them up.
// `banner: true` = has a wide art strip (public/dungeons/banner/<id>.webp) used as the whole
// dungeon cell's background in the best-runs table instead of icon + colored bar.
// `colors` = [dark, light] gradient for the dungeon's bar on the profile, picked from
// each dungeon's look (Azshara's sea, Halls' gold, the Arcway's arcane purple, …).
export const MPLUS_DUNGEONS = [
  { id: 197, name: 'Eye of Azshara', colors: ['#14607e', '#3fc6d1'], banner: true },
  { id: 198, name: 'Darkheart Thicket', colors: ['#3d5a1e', '#8fbf3a'], banner: true },
  { id: 199, name: 'Black Rook Hold', colors: ['#3c4654', '#93a3b8'], banner: true },
  { id: 200, name: 'Halls of Valor', colors: ['#8a6410', '#f2c94c'], banner: true },
  { id: 206, name: "Neltharion's Lair", colors: ['#8a3512', '#f08a3c'], banner: true },
  { id: 207, name: 'Vault of the Wardens', colors: ['#1f6b2a', '#6ee05a'], banner: true },
  { id: 208, name: 'Maw of Souls', colors: ['#24486e', '#7fb3e0'], banner: true },
  { id: 209, name: 'The Arcway', colors: ['#5a1f86', '#c77dff'], banner: true },
  { id: 210, name: 'Court of Stars', colors: ['#27307f', '#7c8cff'], banner: true },
]

// Realm slug used in fight `player` keys ("Name-evermoon") ↔ armory realm string.
export const MPLUS_REALMS = {
  evermoon: '[EN] Evermoon',
}
export const DEFAULT_MPLUS_REALM = '[EN] Evermoon'
