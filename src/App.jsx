import { useCallback, useEffect, useMemo, useState } from 'react'
import Sidebar from './components/Sidebar.jsx'
import ImportPanel from './components/ImportPanel.jsx'
import BossPage from './components/BossPage.jsx'
import PlayerPage from './components/PlayerPage.jsx'
import LogPage from './components/LogPage.jsx'
import { getFights, addFights, clearFights, isShared } from './lib/store.js'
import { getCharacters, mergeCharacters } from './lib/characters.js'
import { DEMO_FIGHTS } from './lib/demoData.js'
import { DEFAULT_DIFFICULTY } from './lib/raids.js'

// Highmaul is raid difficulty Mythic/Heroic — shown as tabs.
const DIFF_TABS = ['Mythic', 'Heroic']

const DEMO_DISMISS_KEY = 'crowlogs.demoDismissed'

export default function App() {
  const [stored, setStored] = useState([])
  const [characters, setCharacters] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [demoDismissed, setDemoDismissed] = useState(
    () => localStorage.getItem(DEMO_DISMISS_KEY) === '1',
  )
  const [difficulty, setDifficulty] = useState(DEFAULT_DIFFICULTY) // Mythic by default
  const [selection, setSelection] = useState({ view: 'import' })

  const reload = useCallback(async () => {
    try {
      const [data, chars] = await Promise.all([getFights(), getCharacters()])
      setStored(data)
      setCharacters(chars)
      setLoadError('')
    } catch (e) {
      setLoadError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  const fights = useMemo(() => {
    const base = demoDismissed ? stored : [...stored, ...DEMO_FIGHTS]
    return mergeCharacters(base, characters)
  }, [stored, demoDismissed, characters])

  const onImported = useCallback(
    async (records, logId) => {
      await addFights(records)
      await reload()
      // Show the freshly parsed log's full breakdown.
      if (logId) setSelection({ view: 'log', logId })
    },
    [reload],
  )

  const onSelectBoss = (raid, boss) => setSelection({ view: 'boss', raid, boss })
  const onSelectPlayer = (player) => setSelection({ view: 'player', player })
  const onSelectLog = (logId) => setSelection({ view: 'log', logId })
  const onImport = () => setSelection({ view: 'import' })

  const dismissDemo = () => {
    localStorage.setItem(DEMO_DISMISS_KEY, '1')
    setDemoDismissed(true)
  }
  const restoreDemo = () => {
    localStorage.removeItem(DEMO_DISMISS_KEY)
    setDemoDismissed(false)
  }

  const hasDemo = !demoDismissed && DEMO_FIGHTS.length > 0

  return (
    <div className="layout">
      <Sidebar
        fights={fights}
        difficulty={difficulty}
        selection={selection}
        onSelectBoss={onSelectBoss}
        onSelectPlayer={onSelectPlayer}
        onImport={onImport}
      />

      <main
        className={`content ${selection.view === 'boss' || selection.view === 'log' ? 'content-wide' : ''}`}
      >
        <div className="topbar">
          <div className="diff-tabs">
            {DIFF_TABS.map((d) => (
              <button
                key={d}
                className={`diff-tab ${difficulty === d ? 'active' : ''}`}
                onClick={() => setDifficulty(d)}
              >
                {d}
              </button>
            ))}
          </div>
          <span className={`mode-pill ${isShared ? 'shared' : 'local'}`}>
            {isShared ? '🌐 Shared rankings' : '💾 Local (this browser)'}
          </span>
          {hasDemo && (
            <span className="demo-note">
              Showing demo data ·{' '}
              <button className="linkbtn" onClick={dismissDemo}>
                clear demo data
              </button>
            </span>
          )}
          {demoDismissed && (
            <span className="demo-note">
              <button className="linkbtn" onClick={restoreDemo}>
                show demo data
              </button>
            </span>
          )}
        </div>

        {loading && <div className="empty-state">Loading rankings…</div>}
        {loadError && <div className="error">Couldn’t load rankings: {loadError}</div>}

        {!loading && selection.view === 'import' && (
          <ImportPanel onImported={onImported} shared={isShared} />
        )}
        {!loading && selection.view === 'boss' && (
          <BossPage
            fights={fights}
            raid={selection.raid}
            boss={selection.boss}
            difficulty={difficulty}
            onSelectPlayer={onSelectPlayer}
          />
        )}
        {!loading && selection.view === 'player' && (
          <PlayerPage
            fights={fights}
            player={selection.player}
            difficulty={difficulty}
            onSelectBoss={onSelectBoss}
            onSelectLog={onSelectLog}
          />
        )}
        {!loading && selection.view === 'log' && (
          <LogPage
            fights={fights}
            logId={selection.logId}
            onSelectPlayer={onSelectPlayer}
            onBack={() => setSelection({ view: 'import' })}
          />
        )}
      </main>
    </div>
  )
}
