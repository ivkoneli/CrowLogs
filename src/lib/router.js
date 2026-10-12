// Tiny hash router: maps the app's `selection` state to shareable URLs and back.
// Hash-based (#/boss/…) because GitHub Pages can't rewrite deep paths to index.html.
// Only the page identity goes in the URL — filters/tabs/metrics stay client-side
// on purpose, so a shared link always lands on the page's default view.
//
//   #/                        home (best M+ runs)
//   #/import                  import a combat log
//   #/mplus?class=&spec=&realm=&page=&player=   M+ rankings (every part optional)
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
    case 'import':
      return '#/import'
    case 'mplus': {
      // Filters, page and the highlighted player are all part of the address, so a
      // rankings view can be shared as-is. `realm` is a slug (evermoon / tauri / wod).
      const q = new URLSearchParams()
      if (sel.klass) q.set('class', sel.klass)
      if (sel.klass && sel.spec) q.set('spec', sel.spec)
      if (sel.realm) q.set('realm', sel.realm)
      if (sel.page > 1) q.set('page', String(sel.page))
      if (sel.focus) q.set('player', sel.focus)
      const qs = q.toString()
      return qs ? `#/mplus?${qs}` : '#/mplus'
    }
    default:
      return '#/'
  }
}

// Click handler for an in-app <a href={selectionToHash(…)}>: a plain left click navigates
// in place (no reload), while ctrl/cmd/shift/middle click and the right-click menu keep
// the browser's own behaviour — "open in new tab" works because the href is real.
export function inAppClick(navigate) {
  return (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    e.preventDefault()
    navigate()
  }
}

export function selectionFromHash(hash) {
  const mplus = /^#\/?mplus(?:\?(.*))?$/.exec(hash || '')
  if (mplus) {
    const q = new URLSearchParams(mplus[1] || '')
    const page = parseInt(q.get('page'), 10)
    const klass = q.get('class') || null
    return {
      view: 'mplus',
      klass,
      spec: (klass && q.get('spec')) || null,
      realm: q.get('realm') || null,
      // Only an explicit page > 1 is kept: no page + a player means "find their page".
      page: page > 1 ? page : q.get('player') ? null : 1,
      focus: q.get('player') || null,
    }
  }
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
  if (view === 'import') return { view: 'import' }
  return { view: 'home' }
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
