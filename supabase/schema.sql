-- CrowLogs Supabase schema. Run once in the SQL editor.

-- Per (player, encounter) fight records, read+written by the browser.
create table fights (
  id text primary key,
  raid text, boss text, difficulty text, player text, guid text,
  pet boolean, damage bigint, dps double precision,
  healing bigint, hps double precision, kill boolean,
  bloodlust jsonb, potions int,
  -- Frozen at import so an old log keeps the gear/talents/ilvl/spec/class you had then.
  -- `class` is frozen too because the CrowLogsHelper addon supplies it for players the
  -- armory never scraped (otherwise they'd render "<spec> undefined").
  class text, ilvl int, talents jsonb, trinkets jsonb, spec text, spec_icon text,
  -- Did the player run the CrowLogsHelper addon on this pull? Frozen at import (not
  -- retroactive); drives the "no addon" badge in the log view.
  from_addon boolean,
  duration bigint, hits int, day text, started bigint, logid text,
  created_at timestamptz default now()
);
-- Migration for an existing fights table (run once if you created it before
-- these columns existed). Safe to re-run.
--   alter table fights add column if not exists healing bigint;
--   alter table fights add column if not exists hps double precision;
--   alter table fights add column if not exists kill boolean;
--   alter table fights add column if not exists bloodlust jsonb;
--   alter table fights add column if not exists potions int;
--   alter table fights add column if not exists ilvl int;
--   alter table fights add column if not exists talents jsonb;
--   alter table fights add column if not exists trinkets jsonb;
--   alter table fights add column if not exists spec text;
--   alter table fights add column if not exists spec_icon text;
--   alter table fights add column if not exists class text;
--   alter table fights add column if not exists from_addon boolean;
alter table fights enable row level security;
-- The public (browser anon key) may ONLY read. All writes go through the `submit-log`
-- edge function (service-role key), which validates, recomputes dps/hps, and rate-limits.
-- This is what stops anyone with the public anon key from inserting fake records or — via
-- the deterministic fight id (raid::boss::difficulty::player::start) — overwriting real
-- ones. Deletes happen only through the `delete-log` function (ADMIN_TOKEN-gated).
create policy "public read" on fights for select using (true);
-- ── RLS LOCKDOWN MIGRATION ────────────────────────────────────────────────────
-- If your fights table still has the old open write policies, drop them. Run this
-- ONLY AFTER the submit-log function is deployed and the site is updated to call it,
-- otherwise live imports will fail. Safe to re-run.
--   drop policy if exists "public insert" on fights;
--   drop policy if exists "public update" on fights;

-- Per-import audit row, written by submit-log; gives the owner a list to roll back from.
-- Public can read it (to surface logs in the UI); only the functions write/delete it.
create table logs (
  logid text primary key,
  label text,
  row_count int,
  ip_hash text,
  created_at timestamptz default now()
);
alter table logs enable row level security;
create policy "public read logs" on logs for select using (true);

-- ── ROLLBACK / RECOVERY (run manually in the SQL editor when needed) ───────────
-- Delete one imported log by id (same as the in-app "delete log" button):
--   delete from fights where logid = 'log_xxxxxxxx';
--   delete from logs   where logid = 'log_xxxxxxxx';
-- Find recent imports to identify a logid:
--   select logid, label, row_count, created_at from logs order by created_at desc limit 50;
-- BACKUPS: enable scheduled backups / PITR in the Supabase dashboard
--   (Project Settings → Database → Backups) so a mass-poisoning is recoverable even
--   without per-log rollback.

-- Armory cache (ilvl / talents / class / spec / faction), keyed by "Name-Realm".
-- Written only by the scraper / edge function via the service-role key.
create table characters (
  key text primary key,
  name text, realm text,
  class text, spec text, faction text, guild text,
  ilvl int, talents jsonb, talent_hash text, spec_icon text,
  gear jsonb, race text, gender int,
  updated_at timestamptz default now()
);
--   alter table characters add column if not exists gear jsonb;
--   alter table characters add column if not exists race text;
--   alter table characters add column if not exists gender int;
alter table characters enable row level security;
create policy "public read characters" on characters for select using (true);

-- Server-side key/value config (the live Tauri session cookie). No public
-- policies — only the scraper + edge function touch it (service-role key).
create table app_config (
  key text primary key,
  value text,
  updated_at timestamptz default now()
);
alter table app_config enable row level security;
