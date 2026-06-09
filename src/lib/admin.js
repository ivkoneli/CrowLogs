// Owner "admin mode" for the account-free site. There are no logins; admin affordances
// (e.g. the per-log rollback button) are simply hidden unless an admin token is stored
// locally. You unlock it once by visiting the site with `?admin=<TOKEN>` — the token is
// saved to localStorage and stripped from the URL. The token is still verified
// server-side on every privileged call (delete-log), so this only controls VISIBILITY,
// not authorization — a hidden control is not a security boundary, the edge function is.
const KEY = 'crowlogs.admin'

// Capture `?admin=<token>` from the URL on load, persist it, and remove it from the
// address bar/history. `?admin=` (empty) logs out. Call once at app start.
export function initAdminFromUrl() {
  try {
    const u = new URL(window.location.href)
    if (!u.searchParams.has('admin')) return
    const t = u.searchParams.get('admin') || ''
    if (t) localStorage.setItem(KEY, t)
    else localStorage.removeItem(KEY)
    u.searchParams.delete('admin')
    window.history.replaceState({}, '', u.pathname + u.search + u.hash)
  } catch {
    /* non-browser / blocked storage — admin mode just stays off */
  }
}

export function adminToken() {
  try {
    return localStorage.getItem(KEY) || ''
  } catch {
    return ''
  }
}

export function isAdmin() {
  return !!adminToken()
}
