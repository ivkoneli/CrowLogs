# 🐦‍⬛ CrowLogs

A lightweight World of Warcraft combat-log DPS/HPS leaderboard. Drop a
`WoWCombatLog.txt` and [CrowLogs](https://ivkoneli.github.io/CrowLogs/) reads each encounter (boss + difficulty), computes
per-player damage, healing, and fight duration, and builds per-boss rankings and
per-player profile pages — with character ilvl, spec, talents, and gear pulled from
the Tauri armory.

## Features

- **Per-boss leaderboards** by difficulty and spec, ranked on DPS or HPS.
- **Player profiles** — rankings, log history, talents, and full equipment (gems & enchants).
- **Optional companion addon** (CrowLogsHelper) freezes each pull's exact spec/talents/gear,
  so old logs keep the build you actually ran.
- **Open contribution** — no accounts; anyone can import a log and the rankings update for all.
- Runs entirely in your browser on local data, or shared across everyone via Supabase.

## Quick start

```bash
npm install
npm run dev      # http://localhost:5173/CrowLogs/
```

Drag a `WoWCombatLog.txt` onto the import page. With no backend configured, everything is
stored locally in your browser — fine for trying it out.

## Hosting your own

CrowLogs is a static site that deploys to **GitHub Pages**, optionally backed by
[Supabase](https://supabase.com) for a shared, multi-user leaderboard. Armory enrichment,
the open-contribution write path, automated backups, and error monitoring all run
server-side. Setup and operational details are kept in the project's dev notes.
