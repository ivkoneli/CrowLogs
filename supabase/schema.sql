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
alter table fights enable row level security;
create policy "public read"   on fights for select using (true);
create policy "public insert" on fights for insert with check (true);
create policy "public update" on fights for update using (true) with check (true);

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
