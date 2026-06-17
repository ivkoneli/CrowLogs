// Loading-screen quips shown while a log is analyzed — WoW-loading-tip flavor.
// A pool of generic one-liners, plus a few context-aware jabs built from the parsed
// fights (boss progress, wipes, raid size, class makeup, potions). All in good fun.
import { RAIDS } from './raids.js'

const GENERIC = [
  'Recount is still calculating. It always is.',
  'The healers remember everything.',
  'Standing in fire is a DPS loss. Allegedly.',
  'Somewhere, a hunter is still on the wrong target.',
  'Pugs: where every pull is a surprise party.',
  'Your guild bank repair fund appreciates your service.',
  'Bloodlust on pull is a personality type.',
  'The tank says they had it. The tank did not have it.',
  'Flasks up. Or don’t. The meters will tell on you.',
  'Loot drama loading… please wait.',
  'A wipe is just an unscheduled strategy meeting.',
  'Dispel it. No, the other one. Too late.',
  'Melee uptime: a myth told to children.',
  'Someone forgot to summon. It’s always someone.',
  'The world buff lasted exactly until the first pull.',
  'Interrupt rotation? In this economy?',
  'Your DPS is fine. The boss just has a lot of HP.',
  'Ret paladins have been waiting 12 years for this patch.',
  'The meter doesn’t lie, but it does exaggerate your friends.',
  'Pull timer is just a suggestion to the rogue who vanished.',
  'Every guild has that one mage who pulls early.',
  'Healing meters measure who let the most damage happen.',
  'Tank threat is a relationship, not a stat.',
  '“One more pull” is the most expensive sentence in raiding.',
  'The boss enrages. So does the raid leader.',
  'Repair, restock, regret. The raider’s creed.',
  'Did you remember your rune? Of course you didn’t.',
  'Positive: the parse can only go up from a wipe.',
  'Loading combat… and excuses.',
  'The DBM countdown is the only thing keeping us together.',
  'Cooldowns are for people who plan ahead. We press them randomly.',
  'Battle rez saved for absolutely no reason. Again.',
  'Your spec is fine. Your keybinds are the problem.',
  'Ranged stacks. Melee spreads. Chaos reigns.',
  'A good night is measured in epics and forgiven mistakes.',
  'The trash before the boss is the real final boss.',
  'Loot council deliberating… for the next three hours.',
  'Somebody pulled with a sneeze. It happens.',
  'Mana? In MY DPS rotation? Couldn’t be.',
  'The strat was perfect. The execution was abstract art.',
  'Vantus runes: paying gold to feel slightly better.',
  'Your trinket procced. On the trash. Naturally.',
  'Raid markers exist. People reading them is optional.',
  'The off-tank is just the on-tank in a relationship of convenience.',
  'Logs don’t forget. Logs never forget.',
  'Yes, that void zone was definitely your spawn point.',
  'Heroism used on trash builds character.',
  'Pretend the spreadsheet says you’re winning.',
  'The healer went OOM. The healer was you.',
  'Crunching numbers so you can argue about them later.',
]

// Fisher–Yates shuffle (returns a new array).
function shuffle(arr) {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// Jabs derived from what's actually in the log.
function contextTips(fights) {
  const tips = []
  if (!fights?.length) return tips
  const real = fights.filter((f) => !f.pet)

  // One entry per encounter (records of a pull share started/boss/raid/kill).
  const enc = new Map()
  for (const f of fights) {
    if (!enc.has(f.started)) enc.set(f.started, { boss: f.boss, raid: f.raid, kill: f.kill !== false })
  }
  const encounters = [...enc.values()]
  const kills = encounters.filter((e) => e.kill).length
  const wipes = encounters.length - kills

  // Best-effort class makeup (many records may have no class until the armory scrape).
  const classByPlayer = new Map()
  for (const f of real) if (f.class && !classByPlayer.has(f.player)) classByPlayer.set(f.player, f.class)
  const classes = [...classByPlayer.values()]
  const countClass = (k) => classes.filter((c) => c === k).length
  const playerCount = new Set(real.map((f) => f.player)).size

  // Boss progress per known raid.
  for (const raid of RAIDS) {
    const killed = new Set(encounters.filter((e) => e.kill && e.raid === raid.name).map((e) => e.boss))
    if (killed.size === 0) continue
    const total = raid.bosses.length
    const k = killed.size
    const lastBoss = raid.bosses[total - 1]
    if (k >= total) tips.push(`${raid.name} cleared, ${total}/${total}. Flawless. Probably.`)
    else if (killed.has(lastBoss)) tips.push(`Last boss of ${raid.name} dead but only ${k}/${total}? Skipping bosses like rent.`)
    else tips.push(`${k}/${total} in ${raid.name} — ${lastBoss} is still standing there, judging you.`)
  }

  if (wipes >= 5) tips.push(`${wipes} wipes this log. The repair vendor is buying a boat.`)
  else if (wipes > 0) tips.push(`${wipes} wipe${wipes > 1 ? 's' : ''} logged. Learning experiences, all of them.`)
  else if (kills > 0) tips.push('No wipes recorded. Suspicious. Were the meters even on?')

  if (playerCount && playerCount < 10) tips.push(`Only ${playerCount} in the raid. Carry mode engaged.`)
  else if (playerCount >= 25) tips.push(`${playerCount} raiders logged. That's a lot of personalities.`)

  if (classes.length >= 5) {
    const w = countClass('Warrior')
    if (w === 0) tips.push('Not one Warrior in the raid. Who’s going to Charge in and immediately die?')
    else if (w >= 4) tips.push(`${w} Warriors. Was there a sale on plate armor?`)
    const m = countClass('Mage')
    if (m >= 4) tips.push(`${m} Mages. That portal room is going to be a traffic jam.`)
    const h = countClass('Hunter')
    if (h >= 4) tips.push(`${h} Hunters. Pets everywhere, misdirects nowhere.`)
  }

  const pots = real.reduce((a, f) => a + (f.potions || 0), 0)
  if (pots === 0 && kills > 0) tips.push('Zero combat potions used all night. Cheap, but bold.')

  return tips
}

// The full shuffled tip list for a given log (context jabs mixed into the generic pool).
export function buildTips(fights) {
  return shuffle([...contextTips(fights), ...GENERIC])
}
