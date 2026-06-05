import { useMemo, useState } from 'react'
import { RAIDS } from '../lib/raids.js'
import { bossCounts, searchPlayers, extraRaids } from '../lib/rankings.js'
import logo from '../CrowsLogo.jpg'

export default function Sidebar({ fights, difficulty, selection, onSelectBoss, onSelectPlayer, onImport }) {
  const [query, setQuery] = useState('')
  const [openRaids, setOpenRaids] = useState(() => new Set(RAIDS.map((r) => r.name)))

  const knownNames = RAIDS.map((r) => r.name)
  const raids = useMemo(() => [...RAIDS, ...extraRaids(fights, knownNames)], [fights])

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
        {raids.map((raid) => {
          const counts = bossCounts(fights, raid.name, difficulty)
          const isOpen = openRaids.has(raid.name)
          return (
            <div key={raid.name} className="raid-group">
              <button className="raid-header" onClick={() => toggleRaid(raid.name)}>
                <span className={`chevron ${isOpen ? 'open' : ''}`}>▸</span>
                <span>{raid.name}</span>
                {raid.name !== 'Other' && <span className="diff-badge">{difficulty}</span>}
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
        })}
      </nav>
    </aside>
  )
}
