// One-off: add per-spec artifact trait counts (`specTraits`) to the artifact weapon of
// every character already in `characters`. Only the `gear` column is patched; nothing
// else on the row changes. New scrapes fill specTraits on their own.
//
//   node -r dotenv/config scripts/backfill-artifact-traits.mjs [Name-Realm ...]
import { getAuthCookie, fetchArmory, parseArtifact, sleep } from './armory.mjs'

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_KEY')
  process.exit(1)
}
const REST = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1`
const dbHeaders = { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` }

async function selectCharacters() {
  const rows = []
  for (let offset = 0; ; offset += 1000) {
    const res = await fetch(`${REST}/characters?select=key,name,realm,gear&order=key&offset=${offset}&limit=1000`, {
      headers: dbHeaders,
    })
    if (!res.ok) throw new Error(`select characters: HTTP ${res.status} — ${await res.text()}`)
    const page = await res.json()
    rows.push(...page)
    if (page.length < 1000) break
  }
  return rows
}

async function patchGear(key, gear) {
  const res = await fetch(`${REST}/characters?key=eq.${encodeURIComponent(key)}`, {
    method: 'PATCH',
    headers: { ...dbHeaders, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ gear }),
  })
  if (!res.ok) throw new Error(`patch ${key}: HTTP ${res.status} — ${await res.text()}`)
}

const cookie = getAuthCookie()
const only = new Set(process.argv.slice(2).map((p) => p.toLowerCase()))
const rows = (await selectCharacters()).filter((r) => !only.size || only.has(r.key))
console.log(`Backfilling ${rows.length} character(s)…`)

let done = 0
let skipped = 0
for (const row of rows) {
  const weapon = (row.gear || []).find((g) => g.quality === 'artifact')
  if (!weapon) {
    skipped += 1
    continue
  }
  const name = String(row.name || row.key).split('-')[0]
  try {
    const artifact = parseArtifact(await fetchArmory('character-artifact/ajax', name, row.realm, cookie))
    if (!artifact?.specTraits?.length) {
      console.warn(`  - ${row.name}: no artifact data`)
      skipped += 1
    } else {
      weapon.specTraits = artifact.specTraits
      await patchGear(row.key, row.gear)
      done += 1
      console.log(`  ✓ ${row.name} — ${artifact.specTraits.map((s) => `${s.spec} ${s.traits}`).join(', ')}`)
    }
  } catch (e) {
    console.warn(`  ✗ ${row.name}: ${e.message}`)
  }
  await sleep(200) // gentle on the armory
}
console.log(`Done: ${done} updated, ${skipped} skipped.`)
