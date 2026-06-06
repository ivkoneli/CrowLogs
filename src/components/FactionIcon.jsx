// Small inline-SVG faction crest (no external assets). Swap for real art later.
export default function FactionIcon({ faction, size = 18, title }) {
  if (faction !== 'Alliance' && faction !== 'Horde') return null
  const shield = 'M12 2 L20 5 V12 C20 17 16 21 12 22 C8 21 4 17 4 12 V5 Z'
  if (faction === 'Alliance') {
    return (
      <svg className="faction-icon" width={size} height={size} viewBox="0 0 24 24" aria-label={title || 'Alliance'}>
        <path d={shield} fill="#1f4fa0" stroke="#c9a84a" strokeWidth="1.3" />
        <circle cx="12" cy="10.5" r="3" fill="#e1c66e" />
        <rect x="11.1" y="10" width="1.8" height="8" rx="0.6" fill="#e1c66e" />
      </svg>
    )
  }
  return (
    <svg className="faction-icon" width={size} height={size} viewBox="0 0 24 24" aria-label={title || 'Horde'}>
      <path d={shield} fill="#9b2b22" stroke="#2c0c09" strokeWidth="1.3" />
      <path d="M7.5 8.5 q4.5 -3.5 9 0 q-1.6 2.4 -4.5 2.4 q-2.9 0 -4.5 -2.4 Z" fill="#1c0a08" />
      <path d="M12 11 L10.6 17 L12 15.7 L13.4 17 Z" fill="#1c0a08" />
    </svg>
  )
}
