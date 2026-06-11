// Tiny hash router: maps the app's `selection` state to shareable URLs and back.
// Hash-based (#/boss/…) because GitHub Pages can't rewrite deep paths to index.html.
// Only the page identity goes in the URL — filters/tabs/metrics stay client-side
// on purpose, so a shared link always lands on the page's default view.
//
//   #/                        import (home)
//   #/boss/<raid>/<boss>      boss rankings
//   #/player/<name>           player profile
//   #/log/<logId>             uploaded log breakdown (first encounter)
//   #/log/<logId>/<started>   …opened on the encounter with that start time

const seg = encodeURIComponent

export function selectionToHash(sel) {
  switch (sel?.view) {
    case 'boss':
      return `#/boss/${seg(sel.raid)}/${seg(sel.boss)}`
    case 'player':
      return `#/player/${seg(sel.player)}`
    case 'log':
      return (
        `#/log/${seg(sel.logId)}` + (sel.focus?.started != null ? `/${seg(sel.focus.started)}` : '')
      )
    default:
      return '#/'
  }
}

export function selectionFromHash(hash) {
  // Split BEFORE decoding so encoded slashes inside a name don't create segments.
  const parts = (hash || '')
    .replace(/^#\/?/, '')
    .split('/')
    .filter(Boolean)
    .map(decodeURIComponent)
  const [view, a, b] = parts
  if (view === 'boss' && a && b) return { view: 'boss', raid: a, boss: b }
  if (view === 'player' && a) return { view: 'player', player: a }
  if (view === 'log' && a) return { view: 'log', logId: a, focus: b ? { started: b } : null }
  return { view: 'import' }
}

// Push the selection's URL onto the history stack (no-op if already there),
// so back/forward walk through pages instead of leaving the site. The entry is
// stamped `inApp` so canGoBack() knows the previous entry is one of ours.
export function pushSelection(sel) {
  const hash = selectionToHash(sel)
  if (window.location.hash === hash || (hash === '#/' && !window.location.hash)) return
  window.history.pushState({ inApp: true }, '', hash)
}

// Rewrite the current entry instead of pushing a new one — for sub-state like
// the active encounter tab, so back still leaves the page in one step. Keeps
// the entry's state (the inApp stamp) intact.
export function replaceSelection(sel) {
  window.history.replaceState(window.history.state, '', selectionToHash(sel))
}

// True when the current entry was created by in-app navigation, i.e. going
// back lands on another page of this site rather than leaving it (false on a
// fresh tab / shared deep link, where back should fall back to home instead).
export function canGoBack() {
  return window.history.state?.inApp === true
}
