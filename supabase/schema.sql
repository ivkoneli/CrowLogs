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
  -- Equipped legendaries (frozen like trinkets) and the per-spell damage/healing
  -- breakdown the meter shows on hover ({ dmg: [[id,name,amount,school,pet]], heal: [...] }).
  legendaries jsonb, spells jsonb,
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
--   alter table fights add column if not exists legendaries jsonb;
--   alter table fights add column if not exists spells jsonb;
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

-- Mythic+ (challenge mode) runs scraped from the Tauri armory leaderboards by
-- scripts/scrape-mythic-plus.mjs (hourly GitHub Action). Tauri's leaderboard keeps EVERY
-- run, but only as one huge per-dungeon page, so we mirror it here and the profile asks
-- for one player's runs with an indexed array lookup instead of re-downloading ~170 MB.
-- Written only by the scraper (service-role key); public read-only like the other tables.
create table if not exists mplus_runs (
  -- sha1 of realm|map|day|level|exact time|sorted party. Tauri has no run id, and rank
  -- shifts as new runs land, so the id is built only from fields that never change.
  id text primary key,
  realm text not null,
  map_id int not null,
  dungeon text not null,
  level int not null,
  time_ms int,                      -- exact clear time; null only if Tauri sent none
  medal smallint not null,          -- 3 = gold (+3), 2 = silver (+2), 1 = bronze (+1), 0 = depleted
  affixes jsonb,                    -- [{ name, icon }]
  party jsonb not null,             -- [{ name, class, role }], role = tank | healer | dps
  members text[] not null,          -- lowercased party names: the player-search key
  day date not null,                -- completion day (Tauri gives no time of day)
  first_seen timestamptz not null default now() -- first scrape that saw it; orders same-day runs
);
create index if not exists mplus_runs_members_idx on mplus_runs using gin (members);
create index if not exists mplus_runs_realm_day_idx on mplus_runs (realm, day desc);
alter table mplus_runs enable row level security;
drop policy if exists "public read mplus" on mplus_runs;
create policy "public read mplus" on mplus_runs for select using (true);

-- Every player seen in any M+ run, so the sidebar search can find people who have no
-- imported raid logs. Kept in sync by a trigger on mplus_runs (no scraper changes needed);
-- name_lower + text_pattern_ops makes the prefix search (`like 'abc%'`) an index lookup.
create table if not exists mplus_players (
  realm text not null,
  name_lower text not null,
  name text not null,
  class text,
  runs int not null default 0,
  last_day date,
  primary key (realm, name_lower)
);
create index if not exists mplus_players_prefix_idx on mplus_players (name_lower text_pattern_ops);
alter table mplus_players enable row level security;
drop policy if exists "public read mplus players" on mplus_players;
create policy "public read mplus players" on mplus_players for select using (true);

create or replace function mplus_players_track() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into mplus_players as mp (realm, name_lower, name, class, runs, last_day)
  select new.realm, lower(p->>'name'), p->>'name', p->>'class', 1, new.day
  from jsonb_array_elements(new.party) p
  where coalesce(p->>'name', '') <> ''
  on conflict (realm, name_lower) do update
    set runs = mp.runs + 1,
        last_day = greatest(mp.last_day, excluded.last_day),
        name = excluded.name,
        class = coalesce(excluded.class, mp.class);
  return new;
end $$;
drop trigger if exists mplus_runs_track_players on mplus_runs;
create trigger mplus_runs_track_players after insert on mplus_runs
  for each row execute function mplus_players_track();

-- One-time backfill from runs already stored (safe to re-run: it rebuilds the counts).
insert into mplus_players (realm, name_lower, name, class, runs, last_day)
select r.realm, lower(p->>'name'),
       (array_agg(p->>'name' order by r.day desc))[1],
       (array_agg(p->>'class' order by r.day desc))[1],
       count(*), max(r.day)
from mplus_runs r, jsonb_array_elements(r.party) p
where coalesce(p->>'name', '') <> ''
group by r.realm, lower(p->>'name')
on conflict (realm, name_lower) do update
  set runs = excluded.runs, last_day = excluded.last_day, name = excluded.name, class = excluded.class;

-- Fuzzy player search: names are compared accent-free ("Rúne", "Rùne" and "Rune" all fold
-- to "rune"; ø→o, æ→ae, ß→ss …), as substrings, with a trigram similarity fallback for typos.
create extension if not exists unaccent with schema extensions;
create extension if not exists pg_trgm with schema extensions;

-- unaccent() is only STABLE; this wrapper pins the dictionary so it can feed an index.
create or replace function name_fold(t text) returns text
language sql immutable parallel safe set search_path = extensions, public as $$
  select lower(extensions.unaccent('extensions.unaccent'::regdictionary, coalesce(t, '')))
$$;

alter table mplus_players add column if not exists name_fold text;
update mplus_players set name_fold = name_fold(name) where name_fold is distinct from name_fold(name);
create index if not exists mplus_players_fold_trgm_idx
  on mplus_players using gin (name_fold extensions.gin_trgm_ops);

-- Keep name_fold filled for players the insert trigger adds or renames.
create or replace function mplus_players_fold() returns trigger
language plpgsql set search_path = public as $$
begin
  new.name_fold := name_fold(new.name);
  return new;
end $$;
drop trigger if exists mplus_players_set_fold on mplus_players;
create trigger mplus_players_set_fold before insert or update of name on mplus_players
  for each row execute function mplus_players_fold();

-- search_mplus_players('rune') → best matches first: name starts with the query, then
-- contains it, then (3+ letters) trigram-similar names, each tier ordered by activity.
create or replace function search_mplus_players(q text, lim int default 8)
returns table (realm text, name text, class text, runs int)
language sql stable set search_path = extensions, public as $$
  with p as (
    select name_fold(q) as fq,
           replace(replace(replace(name_fold(q), '\', '\'), '%', '\%'), '_', '\_') as esc
  )
  select m.realm, m.name, m.class, m.runs
  from mplus_players m, p
  where length(p.fq) >= 2
    and (m.name_fold like '%' || p.esc || '%'
         or (length(p.fq) >= 3 and similarity(m.name_fold, p.fq) >= 0.35))
  order by
    case when m.name_fold like p.esc || '%' then 0
         when m.name_fold like '%' || p.esc || '%' then 1
         else 2 end,
    similarity(m.name_fold, p.fq) desc,
    m.runs desc
  limit least(greatest(lim, 1), 25)
$$;
grant execute on function search_mplus_players(text, int) to anon, authenticated;

-- Per-run specs. Tauri's leaderboard has no spec, so scrape-mythic-plus.mjs copies each
-- member's spec from tauriachievements.github.io's daily M+ data (matched on dungeon, key,
-- exact clear time and party) into party[].spec. Until a run is matched, a spec the role
-- alone decides (a Warrior tank is Protection) is filled in and specs_matched stays false,
-- so every scrape re-checks it.
alter table mplus_runs add column if not exists specs_matched boolean not null default false;
create index if not exists mplus_runs_specs_pending_idx on mplus_runs (id) where not specs_matched;

-- ── M+ SCORES + RANKINGS ──────────────────────────────────────────────────────
-- A run's M+ score — the same formula as src/lib/mythicplus.js runScore (and Tauri
-- Achievements): timed 50 + 7.5×level + 12.5×(1 − time÷timer); depleted
-- 50 + 7.5×(level − 1) − 20×(time÷timer − 1), never below 0. Timers = MPLUS_DUNGEONS.
create or replace function mplus_run_score(p_map int, p_level int, p_time_ms int) returns numeric
language sql immutable parallel safe as $$
  select case
    when t.timer is null or p_time_ms is null then null
    else round(greatest(0, case
      when p_time_ms / 1000.0 / t.timer <= 1 then 50 + 7.5 * p_level + 12.5 * (1 - p_time_ms / 1000.0 / t.timer)
      else 50 + 7.5 * (p_level - 1) - 20 * (p_time_ms / 1000.0 / t.timer - 1)
    end)::numeric, 1)
  end
  from (select (case p_map
    when 197 then 2100 when 198 then 1800 when 199 then 2340 when 200 then 2700 when 206 then 1980
    when 207 then 1980 when 208 then 1440 when 209 then 2700 when 210 then 1800 end)::numeric as timer) t
$$;

-- One row per player per scope: spec '' = their overall score (best run per dungeon, any
-- spec), spec 'Fury' etc. = best run per dungeon played AS that spec. Rebuilt by
-- refresh_mplus_scores() after every scrape; the profile reads ranks from it.
create table if not exists mplus_scores (
  realm text not null,
  name_lower text not null,
  name text not null,
  class text,
  spec text not null default '',
  score numeric not null,
  primary key (realm, name_lower, spec)
);
create index if not exists mplus_scores_rank_idx on mplus_scores (realm, spec, class, score desc);
alter table mplus_scores enable row level security;
drop policy if exists "public read mplus scores" on mplus_scores;
create policy "public read mplus scores" on mplus_scores for select using (true);

-- Called by the scraper after each run (service role). Two steps:
--  1. A new run's specs come from Tauri Achievements about a day later. Until then, a
--     member whose role doesn't decide the spec (a dps Warrior: Arms or Fury?) is ASSUMED
--     to be on the spec they last played in that role, flagged spec_guess so the scraper
--     replaces it with the real one once it's published. Keeps spec scores from lagging.
--  2. Rebuild mplus_scores.
create or replace function refresh_mplus_scores() returns void
language plpgsql security definer set search_path = public set statement_timeout = '120s' as $
begin
  with known as (
    select distinct on (r.realm, lower(p->>'name'), p->>'class', p->>'role')
      r.realm, lower(p->>'name') as n, p->>'class' as c, p->>'role' as ro, p->>'spec' as spec
    from mplus_runs r, jsonb_array_elements(r.party) p
    where r.specs_matched and coalesce(p->>'spec', '') <> ''
    order by r.realm, lower(p->>'name'), p->>'class', p->>'role', r.day desc, r.first_seen desc
  )
  update mplus_runs r set party = (
    select jsonb_agg(
      case when coalesce(t.p->>'spec', '') = '' and k.spec is not null
        then t.p || jsonb_build_object('spec', k.spec, 'spec_guess', true)
        else t.p end
      order by t.ord)
    from jsonb_array_elements(r.party) with ordinality t(p, ord)
    left join known k
      on k.realm = r.realm and k.n = lower(t.p->>'name') and k.c = t.p->>'class' and k.ro = t.p->>'role'
  )
  where not r.specs_matched
    and exists (select 1 from jsonb_array_elements(r.party) p where coalesce(p->>'spec', '') = '');

  delete from mplus_scores where true;
  insert into mplus_scores (realm, name_lower, name, class, spec, score)
  with m as (
    select r.realm, lower(p->>'name') as n, p->>'name' as name, p->>'class' as class,
           coalesce(p->>'spec', '') as spec, r.map_id, r.day,
           mplus_run_score(r.map_id, r.level, r.time_ms) as s
    from mplus_runs r, jsonb_array_elements(r.party) p
    where coalesce(p->>'name', '') <> ''
  ),
  ident as ( -- a player's current name spelling + class = their most recent run's
    select distinct on (realm, n) realm, n, name, class from m order by realm, n, day desc
  ),
  per as (
    select realm, n, ''::text as spec, map_id, max(s) as best from m group by realm, n, map_id
    union all
    select realm, n, spec, map_id, max(s) from m where spec <> '' group by realm, n, spec, map_id
  )
  select per.realm, per.n, i.name, i.class, per.spec, round(sum(coalesce(per.best, 0)), 1)
  from per join ident i on i.realm = per.realm and i.n = per.n
  group by per.realm, per.n, i.name, i.class, per.spec;
end $$;
revoke execute on function refresh_mplus_scores() from public, anon, authenticated;

-- A player's score + rank in every scope they have one. spec '' row: rank/total among ALL
-- players, class_rank/class_total among their class. Spec rows: rank/total among players
-- of that class AND spec (class_rank null). Rank = 1 + players with a strictly higher score.
create or replace function mplus_player_ranks(p_realm text, p_name text)
returns table (spec text, class text, score numeric, rank bigint, total bigint, class_rank bigint, class_total bigint)
language sql stable set search_path = public as $$
  select me.spec, me.class, me.score,
    case when me.spec = ''
      then (select count(*) + 1 from mplus_scores o where o.realm = me.realm and o.spec = '' and o.score > me.score)
      else (select count(*) + 1 from mplus_scores o where o.realm = me.realm and o.spec = me.spec and o.class is not distinct from me.class and o.score > me.score) end,
    case when me.spec = ''
      then (select count(*) from mplus_scores o where o.realm = me.realm and o.spec = '')
      else (select count(*) from mplus_scores o where o.realm = me.realm and o.spec = me.spec and o.class is not distinct from me.class) end,
    case when me.spec = ''
      then (select count(*) + 1 from mplus_scores o where o.realm = me.realm and o.spec = '' and o.class is not distinct from me.class and o.score > me.score) end,
    case when me.spec = ''
      then (select count(*) from mplus_scores o where o.realm = me.realm and o.spec = '' and o.class is not distinct from me.class) end
  from mplus_scores me
  where me.realm = p_realm and me.name_lower = lower(p_name)
$$;
grant execute on function mplus_player_ranks(text, text) to anon, authenticated;
-- The rebuild takes ~10-20 s, past the API's default 8 s statement limit, and a function's
-- own `set statement_timeout` can't extend a call already in flight. Raise it for the
-- service role only (server-side scraper; the public anon role keeps its short limit).
alter role service_role set statement_timeout = '120s';
notify pgrst, 'reload config';
