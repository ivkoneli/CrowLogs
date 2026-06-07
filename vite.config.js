import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// `base` must match the repo name for GitHub Pages project sites
// (served from https://<user>.github.io/CrowLogs/).
export default defineConfig({
  plugins: [react()],
  base: '/CrowLogs/',
  // Emit source maps so Sentry can un-minify stack traces. They deploy alongside the
  // bundle on GitHub Pages; fine for an open project. (To keep maps private instead,
  // switch to @sentry/vite-plugin, which uploads them to Sentry and strips them here.)
  build: { sourcemap: true },
})
