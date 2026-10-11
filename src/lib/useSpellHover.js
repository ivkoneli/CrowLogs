import { useEffect, useRef, useState } from 'react'

// Hover state for a row: shows the panel after a short delay (so sweeping the mouse down
// the meter doesn't fire a fetch per row) and hides it on leave.
export function useSpellHover(enabled) {
  const [anchor, setAnchor] = useState(null)
  const timer = useRef(null)
  useEffect(() => () => clearTimeout(timer.current), [])
  if (!enabled) return { anchor: null, handlers: {} }
  return {
    anchor,
    handlers: {
      onMouseEnter: (e) => {
        const el = e.currentTarget
        clearTimeout(timer.current)
        timer.current = setTimeout(() => setAnchor(el), 180)
      },
      onMouseLeave: () => {
        clearTimeout(timer.current)
        setAnchor(null)
      },
    },
  }
}
