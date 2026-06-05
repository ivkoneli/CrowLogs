import { useCallback, useRef, useState } from 'react'
import { parseLogToFights } from '../parser.js'

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
          const fights = parseLogToFights(String(e.target.result))
          if (fights.length === 0) {
            setStatus({ ok: false, msg: 'No damage events found in that file.' })
            setBusy(false)
            return
          }
          const encounters = new Set(fights.map((f) => `${f.boss}|${f.started}`)).size
          await onImported(fights)
          setStatus({
            ok: true,
            msg: `Imported ${encounters} encounter${encounters === 1 ? '' : 's'} · ${fights.length} player result${fights.length === 1 ? '' : 's'} from ${file.name}.`,
          })
        } catch (err) {
          setStatus({ ok: false, msg: 'Import failed: ' + err.message })
        } finally {
          setBusy(false)
        }
      }
      reader.onerror = () => {
        setStatus({ ok: false, msg: 'Could not read that file.' })
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
