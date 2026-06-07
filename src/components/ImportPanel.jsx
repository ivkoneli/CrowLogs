import { useCallback, useRef, useState } from 'react'
import { parseLogToFights } from '../parser.js'
import { reportFailure } from '../lib/notify.js'

// Stable id for an uploaded file (FNV-1a over its content) so re-importing the
// same log doesn't create a duplicate "log" in history.
function hashLog(text) {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return 'log_' + (h >>> 0).toString(16)
}

export default function ImportPanel({ onImported, shared }) {
  const [dragging, setDragging] = useState(false)
  const [status, setStatus] = useState(null) // { ok, msg }
  const [busy, setBusy] = useState(false)
  const inputRef = useRef(null)

  const handleFile = useCallback(
    (file) => {
      if (!file) return
      setBusy(true)
      setStatus(null)
      const reader = new FileReader()
      reader.onload = async (e) => {
        try {
          const text = String(e.target.result)
          const logid = hashLog(text)
          const fights = parseLogToFights(text).map((f) => ({ ...f, logid }))
          if (fights.length === 0) {
            setStatus({ ok: false, msg: 'No damage events found in that file.' })
            reportFailure('log-import', new Error('No damage events found'), { file: file.name, size: file.size })
            setBusy(false)
            return
          }
          const encounters = new Set(fights.map((f) => `${f.boss}|${f.started}`)).size
          await onImported(fights, logid)
          setStatus({
            ok: true,
            msg: `Imported ${encounters} encounter${encounters === 1 ? '' : 's'} · ${fights.length} player result${fights.length === 1 ? '' : 's'} from ${file.name}.`,
          })
        } catch (err) {
          setStatus({ ok: false, msg: 'Import failed: ' + err.message })
          reportFailure('log-import', err, { file: file.name, size: file.size })
        } finally {
          setBusy(false)
        }
      }
      reader.onerror = () => {
        setStatus({ ok: false, msg: 'Could not read that file.' })
        reportFailure('log-read', new Error('Could not read file'), { file: file.name })
        setBusy(false)
      }
      reader.readAsText(file)
    },
    [onImported],
  )

  return (
    <div className="import-page">
      <h2>Import a combat log</h2>
      <p className="muted">
        Drop a <code>WoWCombatLog.txt</code>. CrowLogs reads the boss and difficulty from the
        log's encounter markers, computes each player's DPS, and adds it to the rankings.
        {shared
          ? ' Results are shared with everyone who visits.'
          : ' Results are saved in this browser only (add Supabase keys to share — see README).'}
      </p>

      <div
        className={`dropzone ${dragging ? 'dragging' : ''} ${busy ? 'busy' : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          handleFile(e.dataTransfer.files?.[0])
        }}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".txt,text/plain"
          hidden
          onChange={(e) => handleFile(e.target.files?.[0])}
        />
        <div className="drop-icon">{busy ? '⏳' : '📄'}</div>
        <p>
          <strong>{busy ? 'Parsing…' : 'Drop your WoWCombatLog.txt here'}</strong>
        </p>
        {!busy && <p className="muted">or click to browse</p>}
      </div>

      {status && <div className={status.ok ? 'success' : 'error'}>{status.msg}</div>}
    </div>
  )
}
