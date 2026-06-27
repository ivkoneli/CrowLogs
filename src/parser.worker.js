// Web Worker: reads an uploaded file and parses a combat log OFF the main thread, so a big
// log (100 MB–1 GB+, tens of seconds of CPU) no longer freezes the page while it churns.
//
// The combat log is STREAMED in chunks and fed line-by-line into createLogParser, so we never
// hold the whole file as one string — that's what lets a log past V8's ~512 MB string cap
// import at all. A combat log comes back as fight records plus a content hash (computed here
// so the source never has to be cloned back across the thread boundary). A CrowLogsHelper
// .lua snapshot is detected from the file's head and handed back whole (it's small) for the
// main thread to parse with parseAddonFile, next to the rest of the addon-merge flow.
import { createLogParser } from './parser.js'

// FNV-1a, fed incrementally so the hash is computed over the streamed chunks without ever
// concatenating them. Same id the import flow uses to dedupe re-uploads of the same log.
function createHasher() {
  let h = 0x811c9dc5
  return {
    update(s) {
      for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i)
        h = Math.imul(h, 0x01000193)
      }
    },
    digest() {
      return 'log_' + (h >>> 0).toString(16)
    },
  }
}

// Progress messages stream to the main thread as the parse runs — postMessage queues to the
// main event loop without the worker having to yield, so the bar moves while we churn.
const progress = (pct, label) => self.postMessage({ kind: 'progress', pct, label })

// A .lua snapshot declares `CrowLogsHelperDB` right at the top, so the first chunk is enough
// to classify the file without reading a multi-hundred-MB log whole.
const ADDON_MARKER = 'CrowLogsHelperDB'

self.onmessage = async (e) => {
  const { file } = e.data || {}
  if (!file) {
    self.postMessage({ ok: false, stage: 'read', error: 'No file supplied.' })
    return
  }

  try {
    progress(0.02, 'Reading file…')

    // Peek the head to tell an addon snapshot from a combat log.
    const head = await file.slice(0, 65536).text()
    if (head.includes(ADDON_MARKER)) {
      const text = await file.text() // addon files are small — safe to read whole
      self.postMessage({ ok: true, kind: 'addon', text })
      return
    }

    const parser = createLogParser()
    const hasher = createHasher()
    const size = file.size || 1
    const decoder = new TextDecoder('utf-8')
    const reader = file.stream().getReader()
    let bytesRead = 0
    let remainder = '' // bytes after the last newline in the previous chunk

    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      bytesRead += value.byteLength
      const chunk = decoder.decode(value, { stream: true })
      hasher.update(chunk)
      const combined = remainder + chunk
      const parts = combined.split('\n')
      remainder = parts.pop() // last element is an incomplete line (or '' if chunk ended on \n)
      for (let i = 0; i < parts.length; i++) {
        let line = parts[i]
        if (line.charCodeAt(line.length - 1) === 13) line = line.slice(0, -1) // strip \r
        parser.pushLine(line)
      }
      // Streaming the bytes owns 0.05→0.9; per-encounter aggregation in finish() owns the rest.
      progress(0.05 + (bytesRead / size) * 0.85, 'Parsing combat events…')
    }

    // Flush the decoder (any bytes held back for an incomplete multibyte char at EOF — almost
    // always empty for an ASCII combat log) and push the trailing partial line. `remainder` was
    // already hashed as part of its chunk; only the freshly-flushed bytes are new to the hash.
    const flushed = decoder.decode()
    if (flushed) hasher.update(flushed)
    const tail = remainder + flushed
    if (tail) {
      for (let line of tail.split('\n')) {
        if (line.charCodeAt(line.length - 1) === 13) line = line.slice(0, -1)
        parser.pushLine(line)
      }
    }

    const fights = parser.finish({ onProgress: (f) => progress(0.9 + f * 0.08, 'Finishing up…') })
    self.postMessage({ ok: true, kind: 'log', fights, logid: hasher.digest() })
  } catch (err) {
    // OOM on a genuinely enormous log surfaces here; a borderline read failure does too.
    self.postMessage({ ok: false, stage: 'parse', error: err.message })
  }
}
