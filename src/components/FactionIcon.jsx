// Faction crest, from the Tauri icon CDN (no more inline SVG).
import { factionIconUrl } from '../lib/classes.js'

export default function FactionIcon({ faction, size = 18, title }) {
  const url = factionIconUrl(faction)
  if (!url) return null
  return (
    <img
      className="faction-icon"
      src={url}
      width={size}
      height={size}
      alt={title || faction}
      title={title || faction}
      onError={(e) => {
        e.currentTarget.style.display = 'none'
      }}
    />
  )
}
