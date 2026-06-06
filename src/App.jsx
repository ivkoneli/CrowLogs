import { useCallback, useEffect, useMemo, useState } from 'react'
import Sidebar from './components/Sidebar.jsx'
import ImportPanel from './components/ImportPanel.jsx'
import BossPage from './components/BossPage.jsx'
import PlayerPage from './components/PlayerPage.jsx'
import LogPage from './components/LogPage.jsx'
import { getFights, addFights, isShared } from './lib/store.js'
import { getCharacters, mergeCharacters, requestCharacterScrape } from './lib/characters.js'

export default function App() {
  const [stored, setStored] = useState([])
  const [characters, setCharacters] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
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

  const fights = useMemo(() => mergeCharacters(stored, characters), [stored, characters])

  const onImported = useCallback(
    async (records, logId) => {
      await addFights(records)
      await reload()
      // Show the freshly parsed log's full breakdown.
      if (logId) setSelection({ view: 'log', logId })
      // Best-effort: enrich every (non-pet) player in this log from the armory,
      // then refresh so class/spec/ilvl/talents fill in. Failures are ignored —
      // the table still shows name / DPS / duration.
      const players = [...new Set(records.filter((r) => !r.pet).map((r) => r.player))]
      if (players.length) {
        requestCharacterScrape(players)
          .then(reload)
          .catch(() => {})
      }
    },
    [reload],
  )

  // Scrape one character's armory profile on demand, then refresh the cache.
  const onUpdateProfile = useCallback(
    async (player) => {
      const data = await requestCharacterScrape(player)
      await reload()
      return data
    },
    [reload],
  )

  const onSelectBoss = (raid, boss) => setSelection({ view: 'boss', raid, boss })
  const onSelectPlayer = (player) => setSelection({ view: 'player', player })
  const onSelectLog = (logId) => setSelection({ view: 'log', logId })
  const onImport = () => setSelection({ view: 'import' })

  return (
    <div className="layout">
      <Sidebar
        fights={fights}
        selection={selection}
        onSelectBoss={onSelectBoss}
        onSelectPlayer={onSelectPlayer}
        onImport={onImport}
      />

      <main
        className={`content ${selection.view === 'boss' || selection.view === 'log' || selection.view === 'player' ? 'content-wide' : ''}`}
      >
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
            onSelectPlayer={onSelectPlayer}
          />
        )}
        {!loading && selection.view === 'player' && (
          <PlayerPage
            fights={fights}
            player={selection.player}
            onSelectBoss={onSelectBoss}
            onSelectLog={onSelectLog}
            onUpdateProfile={onUpdateProfile}
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
