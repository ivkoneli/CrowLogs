import { useCallback, useMemo, useRef, useState } from 'react'
import { reportFailure } from '../lib/notify.js'

// Read + parse a file on a Web Worker so a big combat log doesn't freeze the page. Resolves
// to the worker's terminal message: { ok, kind:'log'|'addon', fights, logid, text, stage,
// error }. Non-terminal { kind:'progress', pct, label } messages stream to `onProgress` as
// the parse runs. A fresh worker per file keeps it stateless; terminated once it replies.
function parseFileInWorker(file, onProgress) {
  return new Promise((resolve) => {
    const worker = new Worker(new URL('../parser.worker.js', import.meta.url), { type: 'module' })
    worker.onmessage = (e) => {
      const msg = e.data
      if (msg?.kind === 'progress') {
        onProgress?.(msg.pct, msg.label)
        return
      }
      worker.terminate()
      resolve(msg)
    }
    worker.onerror = (err) => {
      worker.terminate()
      resolve({ ok: false, stage: 'worker', error: err.message || 'Worker failed' })
    }
    worker.postMessage({ file })
  })
}

function formatRaidDuration(ms) {
  const s = Math.round(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return h ? `${h}h ${m}m` : `${m}m ${String(sec).padStart(2, '0')}s`
}

// ── inline icons (theme-colored line art) ───────────────────────────────────
const DocIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5" />
    <path d="M9 13h6M9 17h6M9 9h1" />
  </svg>
)
const GearIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
)
const UploadIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M16 16l-4-4-4 4" />
    <path d="M12 12v9" />
    <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3" />
  </svg>
)
const UsersIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
)
const SkullIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2a9 9 0 0 0-5 16.5V21a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-2.5A9 9 0 0 0 12 2z" />
    <circle cx="9" cy="12" r="1.5" />
    <circle cx="15" cy="12" r="1.5" />
    <path d="M10 21v-2M14 21v-2" />
  </svg>
)
const ClockIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
)

// One drop card (required combat log / optional addon snapshot).
function DropCard({ badge, optional, title, subtitle, icon, accept, file, onPick, onClear, footnote, busy }) {
  const inputRef = useRef(null)
  const [dragging, setDragging] = useState(false)
  return (
    <div className={`import-card ${optional ? 'optional' : 'required'} ${file ? 'loaded' : ''}`}>
      <span className={`card-badge ${optional ? 'opt' : 'req'}`}>{badge}</span>
      <div className="card-emblem">{icon}</div>
      <h3 className="card-title">{title}</h3>
      <p className="card-sub muted">{subtitle}</p>

      <div
        className={`card-drop ${dragging ? 'dragging' : ''} ${busy ? 'busy' : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          onPick(e.dataTransfer.files)
        }}
        onClick={() => !file && inputRef.current?.click()}
        role="button"
        tabIndex={0}
      >
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          hidden
          onChange={(e) => onPick(e.target.files)}
        />
        {file ? (
          <div className="card-file">
            <span className="file-check">✓</span>
            <span className="file-name" title={file.name}>{file.name}</span>
            <button
              type="button"
              className="file-remove"
              onClick={(e) => {
                e.stopPropagation()
                onClear()
              }}
            >
              Remove
            </button>
          </div>
        ) : (
          <>
            <div className="drop-cloud"><UploadIcon /></div>
            <p className="drop-line">Drag &amp; drop your file here</p>
            <p className="drop-or muted">or</p>
            <button
              type="button"
              className="browse-btn"
              onClick={(e) => {
                // The whole drop area is also clickable, so without stopping propagation
                // this click bubbles up and opens the file dialog a SECOND time.
                e.stopPropagation()
                inputRef.current?.click()
              }}
            >
              Browse files
            </button>
          </>
        )}
      </div>

      <p className="card-foot muted">{footnote}</p>
    </div>
  )
}

// The worker streams the log in chunks, so V8's ~512 MiB string cap no longer applies — the
// real ceiling is now worker memory: the retained events array runs ~9× the file size, so a
// ~500 MB log already peaks several GB and bumps a browser worker's heap limit. This soft cap
// admits a heavy multi-night log while keeping truly enormous files (sure to OOM) out; the
// honest fix for those is to upload one raid night at a time.
const MAX_LOG_MB = 1000

export default function ImportPanel({ onImported, shared }) {
  const [logFile, setLogFile] = useState(null) // { name, fights, logid }
  const [addonFile, setAddonFile] = useState(null) // { name, addon }
  const [analyzing, setAnalyzing] = useState(false)
  const [progress, setProgress] = useState(null) // { pct, label }
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  // Real parse-progress for the top banner: { pct: 0..1, label }, or null when idle. Driven
  // by progress messages the worker streams while it reads + parses the file.
  const [parse, setParse] = useState(null)

  // Parse the combat log on drop (on a worker thread) so Players / Bosses / Duration preview
  // instantly without freezing the page; the addon file is parsed and validated but its merge
  // waits for Analyze.
  const ingest = useCallback(
    async (fileList) => {
      const files = Array.from(fileList || [])
      if (!files.length) return
      setBusy(true)
      setError(null)
      setParse({ pct: 0.02, label: 'Reading file…' })
      try {
        for (const file of files) {
          // Past the soft ceiling the browser is likely to run out of memory mid-parse —
          // steer to a single raid night up front rather than crash the worker.
          if (file.size > MAX_LOG_MB * 1024 * 1024) {
            setError(
              `${file.name} is ${(file.size / 1048576).toFixed(0)} MB — over the ~${MAX_LOG_MB} MB limit and likely to exhaust memory. ` +
                `Delete your WoWCombatLog.txt so the game starts a fresh one, then upload a single raid night.`,
            )
            continue
          }
          const res = await parseFileInWorker(file, (pct, label) =>
            setParse({ pct, label: label || 'Parsing…' }),
          )
          if (!res.ok) {
            setError(
              `Couldn’t parse ${file.name}: ${res.error}. ` +
                `If it's a multi-week log, delete WoWCombatLog.txt and upload one raid night at a time.`,
            )
            reportFailure('log-read', new Error(res.error || 'parse failed'), {
              file: file.name,
              size: file.size,
              stage: res.stage,
            })
            continue
          }
          if (res.kind === 'addon') {
            const { parseAddonFile } = await import('../lib/addon.js')
            const addon = parseAddonFile(res.text)
            if (!addon) {
              setError(`${file.name} isn’t a CrowLogsHelper snapshot.`)
              continue
            }
            setAddonFile({ name: file.name, addon })
          } else {
            if (res.fights.length === 0) {
              setError(`No damage events found in ${file.name}.`)
              continue
            }
            setLogFile({ name: file.name, fights: res.fights, logid: res.logid })
          }
        }
      } finally {
        setBusy(false)
        // Snap to 100% then clear, so the bar visibly completes rather than vanishing mid-run.
        setParse({ pct: 1, label: 'Done' })
        setTimeout(() => setParse(null), 450)
      }
    },
    [],
  )

  // Instant preview from the parsed combat log (no addon merge needed).
  const preview = useMemo(() => {
    const fights = logFile?.fights
    if (!fights?.length) return null
    const players = new Set(fights.filter((f) => !f.pet).map((f) => f.player)).size
    const bosses = new Set(fights.map((f) => f.boss)).size
    const enc = new Map()
    for (const f of fights) enc.set(`${f.boss}|${f.started}`, f.duration || 0)
    const duration = [...enc.values()].reduce((a, b) => a + b, 0)
    return { players, bosses, duration }
  }, [logFile])

  const analyze = useCallback(async () => {
    if (!logFile || analyzing) return
    setError(null)
    setAnalyzing(true)
    setProgress({ pct: 0.05, label: 'Preparing…' })
    try {
      const logid = logFile.logid
      let fights = logFile.fights.map((f) => ({ ...f, logid }))
      let covered = null
      if (addonFile) {
        // Freeze spec/talents/ilvl/trinkets from the snapshot (source of truth). `covered`
        // is the set of players the snapshot resolved; App decides who still needs an
        // armory scrape (uncovered players, and covered players with no bio yet).
        const { freezeFromAddon } = await import('../lib/addon.js')
        const res = freezeFromAddon(fights, addonFile.addon)
        fights = res.fights
        covered = [...res.covered]
      }
      await onImported(fights, logid, {
        covered,
        onProgress: (pct, label) => setProgress({ pct, label }),
      })
      // onImported navigates to the log view on success; this component unmounts.
    } catch (err) {
      setError('Analysis failed: ' + err.message)
      reportFailure('log-import', err, { file: logFile?.name })
      setAnalyzing(false)
      setProgress(null)
    }
  }, [logFile, addonFile, analyzing, onImported])

  const ready = !!preview && !analyzing
  const pct = Math.round((progress?.pct ?? 0) * 100)

  return (
    <div className="import-v2">
      {parse != null && (
        <div className="parse-banner" role="status" aria-live="polite">
          <div className="parse-banner-row">
            <span className="parse-spinner" />
            <span className="parse-banner-label">{parse.label} — you can keep using the site.</span>
            <span className="parse-banner-pct">{Math.round(parse.pct * 100)}%</span>
          </div>
          <div className="parse-banner-track">
            <div className="parse-banner-fill" style={{ width: `${Math.round(parse.pct * 100)}%` }} />
          </div>
        </div>
      )}
      <div className="import-head">
        <h2>Import Raid Data</h2>
        <p className="muted">Upload your combat log and optionally a build snapshot from your addon.</p>
        <p className="import-info">
          <span className="info-dot">i</span>
          Both files are used to generate accurate analytics and breakdowns.
        </p>
      </div>

      <div className="import-grid">
        <DropCard
          badge="REQUIRED"
          title="WoWCombatLog.txt"
          subtitle="Your combat log exported from World of Warcraft."
          icon={<DocIcon />}
          accept=".txt,text/plain"
          file={logFile}
          onPick={ingest}
          onClear={() => {
            setLogFile(null)
            setError(null)
          }}
          footnote="Accepted format: .txt (WoWCombatLog.txt)"
          busy={busy}
        />
        <DropCard
          badge="OPTIONAL"
          optional
          title="CrowLogsHelper.lua"
          subtitle="Build snapshot from the CrowLogsHelper addon. Used to enrich analysis with talents, gear and trinkets."
          icon={<GearIcon />}
          accept=".lua"
          file={addonFile}
          onPick={ingest}
          onClear={() => setAddonFile(null)}
          footnote="Accepted format: .lua (CrowLogsHelper.lua)"
          busy={busy}
        />
      </div>

      <div className="import-bar">
        <div className="stat">
          <span className="stat-ico"><UsersIcon /></span>
          <div className="stat-body">
            <span className="stat-label">Players</span>
            <span className="stat-value">{preview ? preview.players : '—'}</span>
            {!preview && <span className="stat-hint muted">Will be detected</span>}
          </div>
        </div>
        <div className="stat">
          <span className="stat-ico"><SkullIcon /></span>
          <div className="stat-body">
            <span className="stat-label">Bosses</span>
            <span className="stat-value">{preview ? preview.bosses : '—'}</span>
            {!preview && <span className="stat-hint muted">Will be detected</span>}
          </div>
        </div>
        <div className="stat">
          <span className="stat-ico"><ClockIcon /></span>
          <div className="stat-body">
            <span className="stat-label">Duration</span>
            <span className="stat-value">{preview ? formatRaidDuration(preview.duration) : '—'}</span>
            {!preview && <span className="stat-hint muted">Will be calculated</span>}
          </div>
        </div>

        <button className="analyze-btn" disabled={!ready} onClick={analyze}>
          <span className="analyze-main">
            <span className="analyze-ico">📊</span>
            {analyzing ? 'Analyzing…' : 'Analyze Raid'}
          </span>
          <span className="analyze-sub">
            {analyzing
              ? progress?.label || 'Working…'
              : ready
                ? addonFile
                  ? 'Combat log + addon snapshot ready'
                  : 'Add CrowLogsHelper.lua to enrich (optional)'
                : 'Upload the required file to continue'}
          </span>
        </button>
      </div>

      {analyzing && (
        <div className="analyze-progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div className="analyze-progress-fill" style={{ width: `${pct}%` }} />
        </div>
      )}

      {error && <div className="error">{error}</div>}

      <p className="import-privacy muted">
        🔒 Your combat log is parsed locally in your browser.
        {shared
          ? ' Results are then shared with everyone who visits.'
          : ' Results are saved in this browser only.'}
      </p>
    </div>
  )
}
