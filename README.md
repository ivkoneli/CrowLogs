# 🐦‍⬛ CrowLogs

A lightweight WoW combat-log DPS leaderboard you can host on **GitHub Pages**.
Drop a `WoWCombatLog.txt` and CrowLogs reads each encounter (boss + difficulty),
computes per-player DPS and fight duration, and builds per-boss rankings and
per-player pages. Character ilvl / spec / talents are pulled from the Tauri armory.

## Quick start

```bash
npm install
npm run dev      # http://localhost:5173/CrowLogs/
```

Drag a `WoWCombatLog.txt` onto the import page. With no Supabase keys set, everything
is stored in your browser (localStorage) — fine for trying it out.

## Shared mode (Supabase)

To run one leaderboard shared by everyone instead of per-browser:

1. Create a project at [supabase.com](https://supabase.com).
2. In the **SQL editor**, run [`supabase/schema.sql`](supabase/schema.sql).
3. Copy your project **URL** and **anon key** (Settings → API).
4. Local: `cp .env.example .env` and fill `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`.
5. Deploys: add those same two as repo secrets (Settings → Secrets and variables → Actions).

## Deploy (GitHub Pages)

1. Push to `main` in a repo named **`CrowLogs`** (must match `base` in
   [`vite.config.js`](vite.config.js)).
2. **Settings → Pages → Source: GitHub Actions**.
3. [`deploy.yml`](.github/workflows/deploy.yml) builds and publishes to
   `https://<your-username>.github.io/CrowLogs/`.

## Armory enrichment (ilvl / spec / talents)

The Tauri armory is login-gated, so scraping runs **server-side**, never in the browser:

- A 12h GitHub Action ([`scrape-armory.yml`](.github/workflows/scrape-armory.yml)) refreshes
  every known player.
- The player page's **Update profile** button and **log import** scrape on demand via a
  Supabase Edge Function ([`supabase/functions/scrape-character`](supabase/functions/scrape-character/index.ts)).

Setup:

```bash
# Edge function (needs the Supabase CLI):
supabase functions deploy scrape-character --project-ref <your-ref> --no-verify-jwt
supabase secrets set --project-ref <your-ref> TAURI_COOKIE="tSessionId=…" DEFAULT_REALM="[EN] Evermoon"

# GitHub Action secrets: TAURI_COOKIE, SUPABASE_SERVICE_KEY, VITE_SUPABASE_URL
```

`TAURI_COOKIE` is a one-time seed — it's stored in `app_config` and kept alive by the cron,
so you don't re-paste it. (Editing the edge function in VS Code? Install the **Deno**
extension; the files run on Deno, not Node.)
