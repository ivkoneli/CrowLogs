import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// `base` must match the repo name for GitHub Pages project sites
// (served from https://<user>.github.io/CrowLogs/).
export default defineConfig({
  plugins: [react()],
  base: '/CrowLogs/',
})
