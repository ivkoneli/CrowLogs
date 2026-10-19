import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Sidebar from './components/Sidebar.jsx'
import ImportPanel from './components/ImportPanel.jsx'
import HomePage from './components/HomePage.jsx'
import MythicRankingsPage from './components/MythicRankingsPage.jsx'
import BossPage from './components/BossPage.jsx'
import PlayerPage from './components/PlayerPage.jsx'
import LogPage from './components/LogPage.jsx'
import LogLoading from './components/LogLoading.jsx'
import DuplicatePrompt from './components/DuplicatePrompt.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import { getFights, addFights, isShared } from './lib/store.js'
import { findDuplicateEncounters, encounterKey, STRICT } from './lib/dedup.js'
import { getCharacters, mergeCharacters, requestCharacterScrape, charKey, trinketsOf, legendariesOf } from './lib/characters.js'
import { foldPetsByClass } from './lib/petfold.js'
import { splitByNight } from './lib/splitNights.js'
import { specIconUrl } from './lib/classes.js'
import { initAdminFromUrl } from './lib/admin.js'
import { selectionFromHash, selectionToHash, inAppClick, pushSelection, replaceSelection, canGoBack } from './lib/router.js'
import { useMediaQuery } from './lib/useMediaQuery.js'

// Narrowest window the sidebar stays docked beside the content. The player profile has a
// third column (the gear panel), so it needs far more room than the other pages; below
// its width the sidebar tucks away and the gear panel keeps its place (see index.css).
// 1660 = sidebar 230 + padding 64 + the M+ card at its full table width 957 + gap 24 +
// gear panel 360 + the page scrollbar's reserved gutter: any narrower and the M+ table
// would need its own scrollbar.
const DOCK_MIN_WIDTH = 1000
const DOCK_MIN_WIDTH_PROFILE = 1660
const NAV_COLLAPSED_KEY = 'crowlogs.nav.collapsed'

// Capture ?admin=<token> from the URL before first render (unlocks owner-only controls).
initAdminFromUrl()

export default function App() {
  const [stored, setStored] = useState([])
  const [characters, setCharacters] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  // While an import is being analyzed, holds the (class-enriched) fights so the loading
  // overlay can show log-specific tips. Null when not analyzing.
  const [analyzing, setAnalyzing] = useState(null)
  // 'working' = spinner + tips over the skeleton; 'reveal' = skeleton alone for a beat
  // after the log mounts underneath, so the cut to real data is a soft fade.
  const [analyzePhase, setAnalyzePhase] = useState('working')
  // Suspected cross-logger duplicates awaiting the user's skip/keep decision. The promise
  // returned by confirmDuplicates resolves when they act on the modal.
  const [dupPrompt, setDupPrompt] = useState(null)
  const dupResolver = useRef(null)

  const confirmDuplicates = useCallback((duplicates, total) => {
    return new Promise((resolve) => {
      dupResolver.current = resolve
      setDupPrompt({ duplicates, total })
    })
  }, [])
  const resolveDuplicates = useCallback((decision) => {
    setDupPrompt(null)
    const r = dupResolver.current
    dupResolver.current = null
    r?.(decision)
  }, [])
  // The current page comes from the URL hash so deep links land on the right page.
  const [selection, setSelection] = useState(() => selectionFromHash(window.location.hash))

  // Navigate: update state AND the address bar, so every page is shareable.
  // Extra fields on `sel` beyond the route (e.g. a log's `focus` encounter) stay
  // in memory only — shared links open the page in its default state.
  const navigate = useCallback((sel) => {
    pushSelection(sel)
    setSelection(sel)
  }, [])

  // Back/forward (popstate also fires on manual hash edits) re-derive the page from the URL.
  useEffect(() => {
    const onPop = () => setSelection(selectionFromHash(window.location.hash))
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

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

  // Enrich with armory/addon character data, then fold any leftover permanent-pet rows
  // (e.g. a Water Elemental with no SPELL_SUMMON) into the sole player of their class.
  const fights = useMemo(
    () => foldPetsByClass(mergeCharacters(stored, characters)),
    [stored, characters],
  )

  // Persist parsed fights, enrich players from the armory, then open the new log.
  // `opts.covered` (when an addon file was imported) is the set of players the snapshot
  // resolved; null means "no addon — scrape everyone". `opts.onProgress(fraction, label)`
  // drives the import progress bar.
  const onImported = useCallback(
    async (records, logId, opts = {}) => {
      const { covered = null, onProgress = () => {} } = opts
      // Keep already-imported encounters under their ORIGINAL log instead of moving them to
      // this file's logid — so re-uploading a combat log that still holds last week's raid
      // (the .txt wasn't reset) only adds the new night, never re-creates the old one.
      const priorLogid = new Map(stored.map((f) => [f.id, f.logid]))
      let recs = splitByNight(
        records.map((r) => {
          const prev = priorLogid.get(r.id)
          return prev && prev !== r.logid ? { ...r, logid: prev } : r
        }),
        logId,
      )

      // Cross-logger duplicate guard: flag incoming encounters that match ones already saved
      // (same boss/difficulty, near-identical start + roster) but under a different id — these
      // would otherwise double-count, since exact-id upsert can't catch them. Let the user skip.
      const dups = findDuplicateEncounters(recs, stored, STRICT)
      if (dups.length) {
        const totalEncounters = new Set(recs.map(encounterKey)).size
        const decision = await confirmDuplicates(dups, totalEncounters)
        if (decision.action === 'skip' && decision.keys.size) {
          recs = recs.filter((r) => !decision.keys.has(encounterKey(r)))
        }
        if (!recs.length) {
          // The user skipped every encounter — they were all already imported. Report it back
          // so the import page can say "nothing new to add" instead of silently navigating.
          return { nothingNew: true }
        }
      }

      // Open this file's log when it brought new encounters; otherwise (a pure re-upload)
      // open the log those encounters already live in, so we never land on an empty page.
      const hasNew = recs.some((r) => !priorLogid.has(r.id))
      // Re-uploading a log whose encounters are ALL already imported (same file, identical
      // timestamps → identical ids — the fuzzy guard skips these by design) brings nothing new.
      // Say so instead of silently re-running. An addon file (covered != null) is the exception:
      // it can refresh frozen build data on existing rows, so let that proceed.
      if (!hasNew && covered == null) {
        return { nothingNew: true }
      }
      const newest = recs.length ? recs.reduce((a, b) => (b.started > a.started ? b : a)) : null
      // A file holding several nights is split into one log per night (splitByNight): open
      // the newest night's.
      const newestNew = recs.filter((r) => !priorLogid.has(r.id)).reduce((a, b) => (!a || b.started > a.started ? b : a), null)
      const openLogId = hasNew ? newestNew?.logid || logId : newest?.logid || logId

      // Show the full-screen loading overlay immediately, with tips drawn from this log
      // (enriched with any character data we already have for sharper jabs).
      setAnalyzing(mergeCharacters(recs, characters))
      setAnalyzePhase('working')
      const startedAt = Date.now()
      try {
      onProgress(0.15, 'Saving encounters…')
      await addFights(recs)
      await reload()

      // Best-effort armory enrichment: FREEZE each scraped player's current ilvl/talents/
      // trinkets onto these rows so the log keeps that snapshot forever (the armory keeps
      // changing as people re-gear). Lua-first — a value already frozen from the addon wins.
      // Scrape players the addon didn't cover, plus covered players we've never scraped
      // before: the addon supplies their build, but race/faction/guild only come from the
      // armory, so a brand-new addon-only player still needs one bio scrape.
      const allPlayers = [...new Set(recs.filter((r) => !r.pet).map((r) => r.player))]
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
          const frozen = recs.map((r) => {
            const c = byKey.get(charKey(r.player))
            if (!c) return r
            // The log (or addon) says they played another spec than the armory shows now:
            // the armory's talents and spec icon belong to that other spec, so leave them off.
            const offSpec = r.spec != null && c.spec != null && r.spec !== c.spec
            return {
              ...r,
              ilvl: r.ilvl ?? c.ilvl,
              talents: r.talents?.length || offSpec ? r.talents : c.talents,
              trinkets: r.trinkets?.length ? r.trinkets : trinketsOf(c.gear),
              legendaries: r.legendaries?.length ? r.legendaries : legendariesOf(c.gear),
              spec: r.spec ?? c.spec,
              spec_icon: r.spec_icon ?? (offSpec ? specIconUrl(c.class, r.spec) : c.spec_icon) ?? null,
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
      // Analysis is usually near-instant (localStorage) or a few seconds (Supabase +
      // armory scrape). Hold the overlay for at least 5s so the loading tips actually
      // get read. Skipped on error — the catch path surfaces the failure right away.
      const elapsed = Date.now() - startedAt
      if (elapsed < 5000) await new Promise((r) => setTimeout(r, 5000 - elapsed))
      // Open the log's full breakdown (this file's, or the existing one on a pure re-upload).
      if (openLogId) navigate({ view: 'log', logId: openLogId })
      // Drop the spinner/tips but keep the skeleton over the now-mounted log for ~1s, so
      // the real meters fade in instead of snapping in the instant analysis finishes.
      setAnalyzePhase('reveal')
      await new Promise((r) => setTimeout(r, 1000))
      } finally {
        // Clear the overlay last — after navigate, so the log view is already underneath
        // (on error, the import page with its file selection/error is revealed instead).
        setAnalyzing(null)
      }
    },
    [reload, characters, navigate, stored, confirmDuplicates],
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

  // ── Sidebar: docked beside the content, or tucked away behind the ☰ button ──────────
  // Docked when the window is wide enough for this page AND the user hasn't closed it
  // (remembered across visits). Otherwise it's hidden, and ☰ opens it as a drawer over the
  // page (or re-docks it, if only the user's own ✕ was keeping it closed).
  const canDock = useMediaQuery(
    `(min-width: ${selection.view === 'player' ? DOCK_MIN_WIDTH_PROFILE : DOCK_MIN_WIDTH}px)`,
  )
  const [navCollapsed, setNavCollapsed] = useState(() => {
    try {
      return localStorage.getItem(NAV_COLLAPSED_KEY) === '1'
    } catch {
      return false
    }
  })
  const [drawerOpen, setDrawerOpen] = useState(false)
  const navDocked = canDock && !navCollapsed
  const setCollapsed = (v) => {
    setNavCollapsed(v)
    try {
      localStorage.setItem(NAV_COLLAPSED_KEY, v ? '1' : '0')
    } catch {
      /* private mode: the choice just isn't remembered */
    }
  }
  const openNav = () => (canDock ? setCollapsed(false) : setDrawerOpen(true))
  const closeNav = () => (navDocked ? setCollapsed(true) : setDrawerOpen(false))
  // Picking anything in the drawer (or the window growing enough to dock) closes it.
  useEffect(() => {
    setDrawerOpen(false)
  }, [selection, navDocked])
  useEffect(() => {
    if (!drawerOpen) return
    const onKey = (e) => e.key === 'Escape' && setDrawerOpen(false)
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [drawerOpen])
  const navMode = navDocked ? 'nav-docked' : drawerOpen ? 'nav-drawer' : 'nav-hidden'

  const onSelectBoss = (raid, boss) => navigate({ view: 'boss', raid, boss })
  const onSelectPlayer = (player) => navigate({ view: 'player', player })
  // `focus` (optional) = { started } — opens the log on that encounter's tab.
  const onSelectLog = (logId, focus = null) => navigate({ view: 'log', logId, focus })
  const onImport = () => navigate({ view: 'import' })
  const onHome = () => navigate({ view: 'home' })
  // M+ rankings; `sel` = { klass, spec, realm, page, focus } (all optional).
  // `replace` rewrites the current history entry instead of adding one (typing in the
  // rankings search shouldn't leave a back-button step per keystroke).
  const onRankings = useCallback(
    (sel = {}, { replace = false } = {}) => {
      const next = { view: 'mplus', ...sel }
      if (!replace) return navigate(next)
      replaceSelection(next)
      setSelection(next)
    },
    [navigate],
  )

  // Switching encounter tabs inside a log rewrites the URL in place (no history spam),
  // so copying the address always shares the boss you're looking at.
  const onLogEncounterChange = useCallback((started) => {
    setSelection((sel) => {
      if (sel.view !== 'log') return sel
      return { ...sel, focus: { started } }
    })
  }, [])
  useEffect(() => {
    if (selection.view === 'log') replaceSelection(selection)
  }, [selection])

  return (
    <div className={`layout ${navMode}`}>
      {!navDocked && (
        <header className="topbar">
          <button className="nav-toggle" onClick={openNav} aria-label="Open menu" aria-expanded={drawerOpen}>
            <span aria-hidden="true">☰</span>
          </button>
          <a className="topbar-brand" href={selectionToHash({ view: 'home' })} onClick={inAppClick(onHome)}>
            CrowLogs
          </a>
        </header>
      )}
      {!navDocked && drawerOpen && <div className="nav-backdrop" onClick={closeNav} aria-hidden="true" />}
      <Sidebar
        onClose={closeNav}
        fights={fights}
        selection={selection}
        onSelectBoss={onSelectBoss}
        onSelectPlayer={onSelectPlayer}
        onImport={onImport}
        onHome={onHome}
        onRankings={() => onRankings()}
      />

      <main
        className={`content ${selection.view === 'boss' || selection.view === 'log' || selection.view === 'player' || selection.view === 'import' || selection.view === 'home' || selection.view === 'mplus' ? 'content-wide' : ''}`}
      >
        {loading && selection.view !== 'home' && selection.view !== 'mplus' && <div className="empty-state">Loading rankings…</div>}
        {loadError && <div className="error">Couldn’t load rankings: {loadError}</div>}

        <ErrorBoundary resetKey={JSON.stringify(selection)}>
          {selection.view === 'home' && <HomePage onSelectPlayer={onSelectPlayer} onImport={onImport} />}
          {selection.view === 'mplus' && (
            <MythicRankingsPage
              klass={selection.klass}
              spec={selection.spec}
              realm={selection.realm}
              guild={selection.guild}
              minKey={selection.minKey}
              search={selection.search}
              page={selection.page}
              focus={selection.focus}
              onNavigate={onRankings}
              onSelectPlayer={onSelectPlayer}
            />
          )}
          {!loading && selection.view === 'import' && (
            <ImportPanel onImported={onImported} shared={isShared} />
          )}
          {!loading && selection.view === 'boss' && (
            <BossPage
              fights={fights}
              raid={selection.raid}
              boss={selection.boss}
              onSelectPlayer={onSelectPlayer}
              onSelectLog={onSelectLog}
            />
          )}
          {!loading && selection.view === 'player' && (
            <PlayerPage
              fights={fights}
              characters={characters}
              player={selection.player}
              onSelectBoss={onSelectBoss}
              onSelectLog={onSelectLog}
              onSelectPlayer={onSelectPlayer}
              onUpdateProfile={onUpdateProfile}
              onSelectRankings={onRankings}
            />
          )}
          {!loading && selection.view === 'log' && (
            <LogPage
              fights={fights}
              logId={selection.logId}
              focus={selection.focus}
              onSelectPlayer={onSelectPlayer}
              onEncounterChange={onLogEncounterChange}
              // Real back when we navigated here in-app (history/rankings click);
              // home when the log was opened cold from a shared link.
              onBack={() => (canGoBack() ? window.history.back() : onHome())}
              onChanged={reload}
              onDeleted={async () => {
                await reload()
                onHome()
              }}
            />
          )}
        </ErrorBoundary>
      </main>

      {analyzing && <LogLoading fights={analyzing} phase={analyzePhase} />}
      {dupPrompt && (
        <DuplicatePrompt
          duplicates={dupPrompt.duplicates}
          total={dupPrompt.total}
          onResolve={resolveDuplicates}
        />
      )}
    </div>
  )
}
