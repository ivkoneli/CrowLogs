// Cross-logger duplicate detection.
//
// A fight's id ends in `started` (the encounter's first-activity timestamp), which comes from
// the LOGGING machine's wall clock. So two people who both logged the same raid night produce
// different ids for the same pull — exact-id upsert won't dedupe them, and the encounter ends
// up double-counted. This finds those near-misses so the import flow can offer to skip them.
//
// "Same pull" = same boss + difficulty, start times within `windowMs`, and a roster overlap of
// at least `minOverlap` (intersection / larger roster, so the two rosters must be both
// overlapping AND similar in size). A genuine wipe→re-pull of the same boss is normally minutes
// apart, so a tight window keeps those distinct.

// One stable key per encounter within a single log (all of a pull's player rows share it).
export function encounterKey(r) {
  return `${r.boss}|${r.difficulty}|${r.started}`
}

function groupEncounters(records) {
  const map = new Map()
  for (const r of records) {
    const key = encounterKey(r)
    let g = map.get(key)
    if (!g) {
      g = {
        key,
        boss: r.boss,
        difficulty: r.difficulty,
        started: r.started,
        day: r.day,
        logid: r.logid,
        roster: new Set(),
      }
      map.set(key, g)
    }
    if (!r.pet && r.player) g.roster.add(r.player) // pets aren't part of the raid roster
  }
  return map
}

function overlapRatio(a, b) {
  const [small, big] = a.size <= b.size ? [a, b] : [b, a]
  let inter = 0
  for (const x of small) if (big.has(x)) inter++
  return { inter, ratio: inter / (Math.max(a.size, b.size) || 1) }
}

export const STRICT = { windowMs: 60_000, minOverlap: 0.8 }
export const BALANCED = { windowMs: 180_000, minOverlap: 0.7 }
export const LOOSE = { windowMs: 600_000, minOverlap: 0.6 }

// Return the incoming encounters that look like duplicates of already-stored ones. Each entry:
// { key, boss, difficulty, started, day, rosterSize, matched, gapMs, existingLogid }.
export function findDuplicateEncounters(incoming, stored, opts = STRICT) {
  const { windowMs, minOverlap } = opts
  const storedGroups = [...groupEncounters(stored).values()]
  if (!storedGroups.length) return []
  const storedKeys = new Set(storedGroups.map((g) => g.key))

  const dups = []
  for (const inc of groupEncounters(incoming).values()) {
    if (storedKeys.has(inc.key)) continue // identical encounter — exact-id upsert handles it
    if (inc.roster.size === 0) continue

    let best = null
    for (const st of storedGroups) {
      if (st.boss !== inc.boss || st.difficulty !== inc.difficulty) continue
      const gap = Math.abs(inc.started - st.started)
      if (gap > windowMs) continue
      const { inter, ratio } = overlapRatio(inc.roster, st.roster)
      if (ratio < minOverlap) continue
      if (!best || ratio > best.ratio || (ratio === best.ratio && gap < best.gap)) {
        best = { st, gap, inter, ratio }
      }
    }
    if (best) {
      dups.push({
        key: inc.key,
        boss: inc.boss,
        difficulty: inc.difficulty,
        started: inc.started,
        day: inc.day,
        rosterSize: inc.roster.size,
        matched: best.inter,
        gapMs: best.gap,
        existingLogid: best.st.logid,
      })
    }
  }
  return dups
}
