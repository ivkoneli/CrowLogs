// A combat log file that wasn't reset between raids holds several raids: last week's clear,
// a Heroic run on an alt before tonight's Mythic, two alt runs back to back… Its NEW pulls
// (those still carrying this file's logid) are split into one log per raid RUN; the newest
// run keeps the file's own logid. Pulls are walked in time order and a new run starts when:
//   • the raid or difficulty changes,
//   • more than 3 h passed since the previous pull (another night or another session —
//     a raid crossing midnight stays one run),
//   • the roster changed: under half of the smaller group was in the previous pull
//     (a different character's group, e.g. the next alt),
//   • a boss already killed in this run is pulled again (only possible in a new lockout).
// `started` is the log's wall clock (ms); only differences between pulls matter.
const RUN_GAP_MS = 3 * 3600 * 1000
const MIN_OVERLAP = 0.5

export function splitByRun(recs, fileLogId) {
  // One entry per pull: its roster (players, not pets) and result.
  const pulls = new Map()
  for (const r of recs) {
    if (r.logid !== fileLogId) continue
    const k = `${r.boss}|${r.difficulty}|${r.started}`
    let p = pulls.get(k)
    if (!p) {
      p = { key: k, raid: r.raid, boss: r.boss, difficulty: r.difficulty || '', started: r.started || 0, end: 0, kill: false, players: new Set() }
      pulls.set(k, p)
    }
    p.end = Math.max(p.end, p.started + (r.duration || 0))
    if (r.kill !== false) p.kill = true
    if (!r.pet) p.players.add(r.player)
  }
  if (pulls.size < 2) return recs

  const runs = []
  let run = null
  for (const p of [...pulls.values()].sort((a, b) => a.started - b.started)) {
    const prev = run?.last
    const shared = prev ? [...p.players].filter((x) => prev.players.has(x)).length : 0
    const smaller = prev ? Math.min(p.players.size, prev.players.size) : 0
    const newRun =
      !run ||
      p.raid !== run.raid ||
      p.difficulty !== run.difficulty ||
      p.started - prev.end > RUN_GAP_MS ||
      (smaller > 0 && shared / smaller < MIN_OVERLAP) ||
      run.killed.has(p.boss)
    if (newRun) {
      run = { raid: p.raid, difficulty: p.difficulty, first: p.started, newest: p.started, killed: new Set(), keys: [], last: p }
      runs.push(run)
    }
    run.keys.push(p.key)
    run.last = p
    run.newest = p.started
    if (p.kill) run.killed.add(p.boss)
  }
  if (runs.length < 2) return recs

  // The newest run keeps the file's logid; the others get ids derived from the file + the
  // run's first pull, so re-uploading the same file lands each run in the same log.
  const newest = runs.reduce((a, b) => (b.newest > a.newest ? b : a))
  const idOf = new Map()
  for (const r of runs) {
    let id = fileLogId
    if (r !== newest) {
      let h = 2166136261
      for (const ch of `${fileLogId}|${r.difficulty}|${r.first}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0
      id = `log_${h.toString(16).padStart(8, '0')}`
    }
    for (const k of r.keys) idOf.set(k, id)
  }
  return recs.map((r) => (r.logid === fileLogId ? { ...r, logid: idOf.get(`${r.boss}|${r.difficulty}|${r.started}`) || fileLogId } : r))
}
