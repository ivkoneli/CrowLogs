import { useMemo, useState } from 'react'
import { RAIDS, MAIN_RAIDS, OTHER_RAIDS } from '../lib/raids.js'
import { bossCounts, searchPlayers, extraRaids } from '../lib/rankings.js'
import logo from '../CrowsLogo.jpg'

const KNOWN_RAID_NAMES = RAIDS.map((r) => r.name)

// One collapsible raid → boss list. Shared by the main sections and the
// "Other" drawer so both render identically.
function RaidGroup({ raid, fights, selection, isOpen, onToggle, onSelectBoss }) {
  const counts = bossCounts(fights, raid.name)
  return (
    <div className="raid-group">
      <button className="raid-header" onClick={() => onToggle(raid.name)}>
        <span className={`chevron ${isOpen ? 'open' : ''}`}>▸</span>
        <span>{raid.name}</span>
      </button>
      {isOpen && (
        <ul className="boss-list">
          {raid.bosses.map((boss) => {
            const active =
              selection?.view === 'boss' &&
              selection.boss === boss &&
              selection.raid === raid.name
            const count = counts[boss] || 0
            return (
              <li key={boss}>
                <button
                  className={`boss-item ${active ? 'active' : ''}`}
                  onClick={() => onSelectBoss(raid.name, boss)}
                >
                  <span className="boss-name">{boss}</span>
                  <span className={`boss-count ${count ? '' : 'zero'}`}>{count}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

export default function Sidebar({ fights, selection, onSelectBoss, onSelectPlayer, onImport }) {
  const [query, setQuery] = useState('')
  // Current progression starts expanded; everything under "Other" starts collapsed.
  const [openRaids, setOpenRaids] = useState(() => new Set(MAIN_RAIDS.map((r) => r.name)))
  const [otherOpen, setOtherOpen] = useState(false)

  // Retired raids plus any raid not in the registry (unrecognized encounters,
  // target dummies) share the "Other" drawer.
  const otherGroups = useMemo(
    () => [...OTHER_RAIDS, ...extraRaids(fights, KNOWN_RAID_NAMES)],
    [fights],
  )

  const matches = useMemo(
    () => (query ? searchPlayers(fights, query).slice(0, 8) : []),
    [fights, query],
  )

  const toggleRaid = (name) => {
    setOpenRaids((prev) => {
      const next = new Set(prev)
      next.has(name) ? next.delete(name) : next.add(name)
      return next
    })
  }

  return (
    <aside className="sidebar">
      <div className="brand" onClick={() => onImport()} role="button" tabIndex={0}>
        <img className="brand-logo" src={logo} alt="Crows' Nest" />
        <span className="brand-name">CrowLogs</span>
      </div>

      <button className="import-btn" onClick={() => onImport()}>
        ＋ Import combat log
      </button>

      <div className="search">
        <input
          type="text"
          placeholder="Search player…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {matches.length > 0 && (
          <ul className="search-results">
            {matches.map((p) => (
              <li
                key={p}
                onClick={() => {
                  onSelectPlayer(p)
                  setQuery('')
                }}
              >
                {p}
              </li>
            ))}
          </ul>
        )}
        {query && matches.length === 0 && <p className="no-match">No player found</p>}
      </div>

      <nav className="raid-nav">
        {MAIN_RAIDS.map((raid) => (
          <RaidGroup
            key={raid.name}
            raid={raid}
            fights={fights}
            selection={selection}
            isOpen={openRaids.has(raid.name)}
            onToggle={toggleRaid}
            onSelectBoss={onSelectBoss}
          />
        ))}

        {otherGroups.length > 0 && (
          <div className="other-section">
            <button
              className="raid-header other-header"
              onClick={() => setOtherOpen((v) => !v)}
            >
              <span className={`chevron ${otherOpen ? 'open' : ''}`}>▸</span>
              <span>Other</span>
            </button>
            {otherOpen && (
              <div className="other-body">
                {otherGroups.map((raid) => (
                  <RaidGroup
                    key={raid.name}
                    raid={raid}
                    fights={fights}
                    selection={selection}
                    isOpen={openRaids.has(raid.name)}
                    onToggle={toggleRaid}
                    onSelectBoss={onSelectBoss}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </nav>
    </aside>
  )
}
