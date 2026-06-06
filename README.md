# 🐦‍⬛ CrowLogs

A lightweight WoW combat-log site you can host on **GitHub Pages**. Drop a
`WoWCombatLog.txt` and CrowLogs:

- identifies **which boss** was fought and at **what difficulty** (from the log's
  `ENCOUNTER_START` / `ENCOUNTER_END` markers; falls back to the most-damaged enemy),
- computes each player's **DPS** and **fight duration**,
- builds **per-boss rankings** and **per-player pages**.

Left sidebar: pick a raid → its bosses appear → click a boss to see everyone ranked by
DPS with fight duration. Search a player to open their page: one **Mythic Highmaul** card
listing their DPS and rank on each of the 7 bosses.

> Difficulty is detected from the log, but the UI is pinned to **Mythic** for now
> (a difficulty switch is easy to add later — `DIFFICULTIES` already exists in
> [`src/lib/raids.js`](src/lib/raids.js)).

## Shared rankings (Supabase) vs local

CrowLogs talks to a database directly from the browser, so it stays a static site.

- **No keys set** → it runs in **local mode**: imports are saved in *your* browser
  (localStorage). Great for trying it out.
- **Supabase keys set** → it runs in **shared mode**: everyone who visits reads and writes
  the same rankings (a real guild leaderboard).

A top-bar pill shows which mode is active. Demo data for all 7 Highmaul bosses is shown
until you click **clear demo data**.

### Set up shared mode

1. Create a free project at [supabase.com](https://supabase.com).
2. In the Supabase **SQL editor**, run:

   ```sql
   create table fights (
     id text primary key,
     raid text, boss text, difficulty text, player text, guid text,
     pet boolean, damage bigint, dps double precision,
     duration bigint, hits int, day text, started bigint, logid text,
     created_at timestamptz default now()
   );
   alter table fights enable row level security;
   create policy "public read"   on fights for select using (true);
   create policy "public insert" on fights for insert with check (true);
   create policy "public update" on fights for update using (true) with check (true);

   -- Armory cache (ilvl / talents / class / spec / faction), filled by the scraper.
   create table characters (
     key text primary key,        -- lowercased "Name-Realm", joins onto fights.player
     name text, realm text,
     class text, spec text, faction text, guild text,
     ilvl int, talents jsonb, talent_hash text, spec_icon text,
     updated_at timestamptz default now()
   );
   alter table characters enable row level security;
   create policy "public read characters" on characters for select using (true);
   ```

   Only the CI scraper writes to `characters` (using the service-role key), so it
   needs no public insert/update policy.

   (These policies let anyone read/write — fine for a guild tool. Lock them down later if
   you want.)
3. Copy your project **URL** and **anon public key** (Settings → API).
4. Local dev: `cp .env.example .env` and fill both values.
5. Deploys: add the same two as **repo secrets** (Settings → Secrets and variables →
   Actions): `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. The deploy workflow passes
   them into the build.

## Develop locally

```bash
npm install
npm run dev      # http://localhost:5173/CrowLogs/
```

Drag your `WoWCombatLog.txt` onto the import page.

## Deploy to GitHub Pages

1. Create a repo named **`CrowLogs`** and push to `main`.
   (Repo name must match `base` in [`vite.config.js`](vite.config.js); change it if you
   rename the repo.)
2. Repo **Settings → Pages → Source: GitHub Actions**.
3. Push to `main` → [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) builds and
   publishes to `https://<your-username>.github.io/CrowLogs/`.

## Armory scraping (ilvl + talents)

The armory is login-gated, so this runs **server-side**, never in the browser
([`scripts/scrape-armory.mjs`](scripts/scrape-armory.mjs), scheduled by
[`.github/workflows/scrape-armory.yml`](.github/workflows/scrape-armory.yml)). It logs in
with your Tauri account, reads each player who has logs, fetches their character sheet +
talents, and upserts ilvl/talents/class/spec/faction into the `characters` table. The site
merges that cache onto fight rows by name+realm ([`src/lib/characters.js`](src/lib/characters.js)).

Add these repo secrets: `TAURI_COOKIE` (or `TAURI_USER` + `TAURI_PASS`) and
`SUPABASE_SERVICE_KEY` (Supabase → Settings → API → service_role — **server-side only**,
never in the frontend). The login handshake and response parsing are stubbed until a real
authenticated response confirms the exact format.

## How parsing works

See [`src/parser.js`](src/parser.js). Each line is `timestamp  EVENT,field,…`. CrowLogs
splits quote-aware (names contain commas), reads the damage amount as the 9th field from the
end (that suffix is identical across expansions), attributes damage to player/pet sources,
and segments the log by encounter. `parseLogToFights(text)` returns one record per
(player, encounter); selectors in [`src/lib/rankings.js`](src/lib/rankings.js) build the
boss rankings and player summaries.

## Notes / limits

- Rankings keep each player's **best** result per boss.
- A log with no `ENCOUNTER_START` (e.g. a target-dummy session) becomes a single fight under
  an **"Other"** raid, named after the enemy hit.
- Timestamps have no year; only time *differences* are used, so a fight crossing midnight
  isn't handled.
