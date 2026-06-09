import { useCallback, useEffect, useMemo, useState } from 'react'
import Sidebar from './components/Sidebar.jsx'
import ImportPanel from './components/ImportPanel.jsx'
import BossPage from './components/BossPage.jsx'
import PlayerPage from './components/PlayerPage.jsx'
import LogPage from './components/LogPage.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import { getFights, addFights, isShared } from './lib/store.js'
import { getCharacters, mergeCharacters, requestCharacterScrape, charKey, trinketsOf } from './lib/characters.js'

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

  // Persist parsed fights, enrich players from the armory, then open the new log.
  // `opts.covered` (when an addon file was imported) is the set of players the snapshot
  // resolved; null means "no addon — scrape everyone". `opts.onProgress(fraction, label)`
  // drives the import progress bar.
  const onImported = useCallback(
    async (records, logId, opts = {}) => {
      const { covered = null, onProgress = () => {} } = opts
      onProgress(0.15, 'Saving encounters…')
      await addFights(records)
      await reload()

      // Best-effort armory enrichment: FREEZE each scraped player's current ilvl/talents/
      // trinkets onto these rows so the log keeps that snapshot forever (the armory keeps
      // changing as people re-gear). Lua-first — a value already frozen from the addon wins.
      // Scrape players the addon didn't cover, plus covered players we've never scraped
      // before: the addon supplies their build, but race/faction/guild only come from the
      // armory, so a brand-new addon-only player still needs one bio scrape.
      const allPlayers = [...new Set(records.filter((r) => !r.pet).map((r) => r.player))]
      let players
      if (covered == null) {
        players = allPlayers
      } else {
        const coveredSet = new Set(covered.map(charKey))
        const known = new Set(characters.map((c) => charKey(c.key || c.name)))
        players = allPlayers.filter((p) => !coveredSet.has(charKey(p)) || !known.has(charKey(p)))
      }
      if (players.length) {
        onProgress(0.45, `Fetching ${players.length} armory profile${players.length === 1 ? '' : 's'}…`)
        try {
          const res = await requestCharacterScrape(players)
          const byKey = new Map((res?.updated || []).map((c) => [charKey(c.name || c.key), c]))
          const frozen = records.map((r) => {
            const c = byKey.get(charKey(r.player))
            if (!c) return r
            return {
              ...r,
              ilvl: r.ilvl ?? c.ilvl,
              talents: r.talents?.length ? r.talents : c.talents,
              trinkets: r.trinkets?.length ? r.trinkets : trinketsOf(c.gear),
              spec: r.spec ?? c.spec,
              spec_icon: r.spec_icon ?? c.spec_icon ?? null,
            }
          })
          onProgress(0.8, 'Applying profiles…')
          await addFights(frozen)
        } catch {
          /* armory enrichment is best-effort */
        }
        await reload()
      }

      onProgress(1, 'Done')
      // Open the freshly parsed log's full breakdown.
      if (logId) setSelection({ view: 'log', logId })
    },
    [reload, characters],
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
        className={`content ${selection.view === 'boss' || selection.view === 'log' || selection.view === 'player' || selection.view === 'import' ? 'content-wide' : ''}`}
      >
        {loading && <div className="empty-state">Loading rankings…</div>}
        {loadError && <div className="error">Couldn’t load rankings: {loadError}</div>}

        <ErrorBoundary resetKey={JSON.stringify(selection)}>
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
              onDeleted={async () => {
                await reload()
                setSelection({ view: 'import' })
              }}
            />
          )}
        </ErrorBoundary>
      </main>
    </div>
  )
}
