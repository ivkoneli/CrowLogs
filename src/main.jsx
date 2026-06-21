import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import { initSentry } from './lib/sentry.js'

initSentry()

// After a redeploy, a page left open from the old build references lazy chunks whose
// filename hashes no longer exist (e.g. addon-OLD.js → 404), so a dynamic import fails
// with "error loading dynamically imported module". Vite fires `vite:preloadError` for
// exactly this — reload once to pull the fresh build. The one-shot session guard avoids
// a reload loop if the failure is something else (then the normal error surfaces).
window.addEventListener('vite:preloadError', () => {
  if (!sessionStorage.getItem('clh-chunk-reload')) {
    sessionStorage.setItem('clh-chunk-reload', '1')
    window.location.reload()
  }
})

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
