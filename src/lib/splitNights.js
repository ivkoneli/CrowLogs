// A combat log file that wasn't reset between raids holds several nights (and LFR next to
// a real clear). Its NEW pulls (those still carrying this file's logid) become one log per
// raid night + difficulty; the newest group keeps the file's own logid. A night runs until
// 06:00, so a raid crossing midnight stays one log. `started` is the log's wall clock.
export function splitByNight(recs, fileLogId) {
  const nightOf = (r) => {
    const d = new Date((r.started || 0) - 6 * 3600 * 1000)
    return `${d.getUTCMonth() + 1}/${d.getUTCDate()}|${r.difficulty || ''}`
  }
  const groups = new Map()
  for (const r of recs) {
    if (r.logid !== fileLogId) continue
    const k = nightOf(r)
    groups.set(k, Math.max(groups.get(k) ?? -Infinity, r.started || 0))
  }
  if (groups.size < 2) return recs
  const newestKey = [...groups.entries()].sort((a, b) => b[1] - a[1])[0][0]
  // Derived ids are stable per file + night, so re-uploading the same file lands each night
  // in the same log.
  const idFor = (k) => {
    if (k === newestKey) return fileLogId
    let h = 2166136261
    for (const ch of `${fileLogId}|${k}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0
    return `log_${h.toString(16).padStart(8, '0')}`
  }
  return recs.map((r) => (r.logid === fileLogId ? { ...r, logid: idFor(nightOf(r)) } : r))
}
