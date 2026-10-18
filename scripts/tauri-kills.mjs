// Replace the boss-KILL numbers of already-uploaded logs with Tauri's own record of each
// kill (same code submit-log runs on every new upload: supabase/functions/_shared/tauri-kills.js).
//
// Run: node scripts/tauri-kills.mjs <logid> [<logid> …]
// Env (.env): TAURI_API_KEY, TAURI_API_SECRET, SUPABASE_URL, SUPABASE_SERVICE_KEY

import 'dotenv/config'
import { tauriClient, applyTauriKills } from '../supabase/functions/_shared/tauri-kills.js'

const { SUPABASE_URL, SUPABASE_SERVICE_KEY, TAURI_API_KEY, TAURI_API_SECRET } = process.env
const REST = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1`
const headers = { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` }
const logids = process.argv.slice(2)
if (!logids.length) {
  console.error('Usage: node scripts/tauri-kills.mjs <logid> [<logid> …]')
  process.exit(1)
}

const client = tauriClient(TAURI_API_KEY, TAURI_API_SECRET)
for (const logid of logids) {
  const q = new URLSearchParams({ select: '*', logid: `eq.${logid}`, kill: 'eq.true' })
  const rows = await fetch(`${REST}/fights?${q}`, { headers }).then((r) => r.json())
  const { rows: next, removeIds, matched, errors } = await applyTauriKills(client, rows)
  const before = new Map(rows.map((r) => [r.id, r]))
  const changed = next.filter((r) => r.tauri_log && r.tauri_log !== before.get(r.id)?.tauri_log || r.damage !== before.get(r.id)?.damage)
  for (const r of changed) {
    const b = before.get(r.id)
    console.log(`  ${r.boss.padEnd(22)} ${r.player.padEnd(22)} dmg ${(b.damage / 1e6).toFixed(1)}M → ${(r.damage / 1e6).toFixed(1)}M   heal ${(b.healing / 1e6).toFixed(1)}M → ${(r.healing / 1e6).toFixed(1)}M`)
  }
  if (changed.length) {
    const res = await fetch(`${REST}/fights?on_conflict=id`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(changed),
    })
    if (!res.ok) throw new Error(`update: HTTP ${res.status} — ${await res.text()}`)
  }
  if (removeIds.length) {
    const list = removeIds.map((id) => `"${id.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(',')
    const res = await fetch(`${REST}/fights?id=in.(${encodeURIComponent(list)})`, { method: 'DELETE', headers })
    if (!res.ok) throw new Error(`delete pets: HTTP ${res.status} — ${await res.text()}`)
  }
  console.log(`${logid}: ${matched.length} kill(s) matched on Tauri (${matched.map((m) => `${m.boss} #${m.log_id}`).join(', ') || 'none'}), ${changed.length} rows updated, ${removeIds.length} pet rows removed${errors.length ? ` — errors: ${errors.join('; ')}` : ''}`)
}
