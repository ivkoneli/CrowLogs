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
  -- ENCOUNTER_START id (finds the kill on Tauri), and on a kill whose numbers came from
  -- Tauri's own record of it, that raid-log id (set by submit-log only; see
  -- functions/_shared/tauri-kills.js). Null = the log's own numbers.
  encounter_id int, tauri_log bigint,
  -- The logger disconnected during this pull (log restarted mid-fight): its result and
  -- length are taken from Tauri; with no Tauri kill it's stored as a wipe.
  log_gap boolean,
  -- TRUE on a result a game bug inflated (set by hand, see below): the row stays in the
  -- log and on the player's profile and history, but is left off the boss rankings.
  discredited boolean,
  -- Why it was discredited (typed by the admin), shown when hovering its Unranked tag.
  discredit_reason text,
  -- Boss health left when the pull ended, 0-100 (0 on a kill), worked out from the damage
  -- the boss took (src/lib/bossHp.js). Same on every row of a pull.
  boss_pct real,
  -- The unit boss_pct describes when it isn't the boss itself: Il'gynoth's Eye, for a wipe
  -- before the Heart phase. Null = the boss.
  boss_pct_of text,
  created_at timestamptz default now()
);
-- Migration for an existing fights table (run once if you created it before
-- these columns existed). Safe to re-run.
--   alter table fights add column if not exists discredited boolean;
--   alter table fights add column if not exists discredit_reason text;
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
--   alter table fights add column if not exists encounter_id int;
--   alter table fights add column if not exists tauri_log bigint;
--   alter table fights add column if not exists log_gap boolean;
--   alter table fights add column if not exists boss_pct real;
--   alter table fights add column if not exists boss_pct_of text;
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
-- Leave one player's results from a log off the boss rankings (a game bug inflated them);
-- they still show in the log and on the player's profile. Set back to null to undo:
--   update fights set discredited = true, discredit_reason = 'Why' where logid = 'log_xxxxxxxx' and player = 'Name-realm';
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
-- The home page's best runs per dungeon: a dungeon's runs by key level, then clear time
-- (all of them, and the timed ones). Without these each query sorted the whole table and a
-- cold database timed out (HTTP 500) on the first All-time load.
create index if not exists mplus_runs_map_level_idx on mplus_runs (map_id, level desc, time_ms asc nulls last);
create index if not exists mplus_runs_map_level_timed_idx on mplus_runs (map_id, level desc, time_ms asc nulls last) where medal > 0;
-- Exact completion time, from Tauri Achievements (the armory only gives the day). Set by
-- the scraper when it matches the run there, about a day after it was played; null until.
alter table mplus_runs add column if not exists completed_at timestamptz;
-- The hour of the scrape that first saw a run. Runs without an exact time yet are ordered
-- by it, then by id (a hash, so effectively mixed): first_seen itself differs per dungeon
-- within one scrape, which would list the newest runs grouped by dungeon.
alter table mplus_runs add column if not exists seen_hour timestamp
  generated always as (date_trunc('hour', first_seen at time zone 'UTC')) stored;
-- The home page's "Latest runs" feed: newest first by day, then exact time (runs not on
-- Tauri Achievements yet, i.e. the newest, first), then the scrape hour.
drop index if exists mplus_runs_latest_idx;
drop index if exists mplus_runs_map_latest_idx;
drop index if exists mplus_runs_latest2_idx;
drop index if exists mplus_runs_map_latest2_idx;
create index if not exists mplus_runs_latest3_idx on mplus_runs (day desc, completed_at desc nulls first, seen_hour desc, id);
create index if not exists mplus_runs_map_latest3_idx on mplus_runs (map_id, day desc, completed_at desc nulls first, seen_hour desc, id);
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

-- A player's score + rank in every scope they have one. spec '' row: rank/total among ALL
-- players, class_rank/class_total among their class. Spec rows: rank/total among players
-- of that class AND spec (class_rank null). Rank = 1 + players with a strictly higher score.
-- The rebuild takes ~10-20 s, past the API's default 8 s statement limit, and a function's
-- own `set statement_timeout` can't extend a call already in flight. Raise it for the
-- service role only (server-side scraper; the public anon role keeps its short limit).
alter role service_role set statement_timeout = '120s';
notify pgrst, 'reload config';

-- ── MEMBER REALMS ─────────────────────────────────────────────────────────────
-- mplus_runs.realm is the BOARD a run came from. Evermoon and Tauri share one board, so a
-- player is identified by their OWN realm (party[].realm, written by the scraper) + name;
-- rows scraped before that field existed fall back to the board's realm.

-- Player index for the sidebar search: one row per (member realm, name).
create or replace function mplus_players_track() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into mplus_players as mp (realm, name_lower, name, class, runs, last_day)
  select coalesce(nullif(p->>'realm', ''), new.realm), lower(p->>'name'), p->>'name', p->>'class', 1, new.day
  from jsonb_array_elements(new.party) p
  where coalesce(p->>'name', '') <> ''
  on conflict (realm, name_lower) do update
    set runs = mp.runs + 1,
        last_day = greatest(mp.last_day, excluded.last_day),
        name = excluded.name,
        class = coalesce(excluded.class, mp.class);
  return new;
end $$;

-- Rebuild the player index from the stored runs (run after a full re-scrape changes how
-- players are keyed; safe to re-run).
create or replace function rebuild_mplus_players() returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from mplus_players where true;
  insert into mplus_players (realm, name_lower, name, class, runs, last_day)
  select coalesce(nullif(p->>'realm', ''), r.realm), lower(p->>'name'),
         (array_agg(p->>'name' order by r.day desc))[1],
         (array_agg(p->>'class' order by r.day desc))[1],
         count(*), max(r.day)
  from mplus_runs r, jsonb_array_elements(r.party) p
  where coalesce(p->>'name', '') <> ''
  group by 1, 2;
end $$;
revoke execute on function rebuild_mplus_players() from public, anon, authenticated;


-- A player's score + rank in every scope they have one, among players of ALL realms (the
-- same scopes as Tauri Achievements). spec '' row: rank/total among everyone, class_rank/
-- class_total among their class. Spec rows: rank/total among players of that class AND
-- spec (class_rank null). Rank = 1 + players with a strictly higher score.
-- p_realm is the player's own realm (armory string), not the board.
-- prev_rank / prev_class_rank: the same ranks by prev_score, i.e. before the last update
-- that changed any score — given only when THIS player's score changed in it (as on the
-- rankings page), so the profile can show the same up/down arrow.
drop function if exists mplus_player_ranks(text, text);
create or replace function mplus_player_ranks(p_realm text, p_name text)
returns table (spec text, class text, score numeric, rank bigint, total bigint, class_rank bigint, class_total bigint,
               prev_rank bigint, prev_class_rank bigint)
language sql stable set search_path = public as $$
  select me.spec, me.class, me.score,
    case when me.spec = ''
      then (select count(*) + 1 from mplus_scores o where o.spec = '' and o.score > me.score)
      else (select count(*) + 1 from mplus_scores o where o.spec = me.spec and o.class is not distinct from me.class and o.score > me.score) end,
    case when me.spec = ''
      then (select count(*) from mplus_scores o where o.spec = '')
      else (select count(*) from mplus_scores o where o.spec = me.spec and o.class is not distinct from me.class) end,
    case when me.spec = ''
      then (select count(*) + 1 from mplus_scores o where o.spec = '' and o.class is not distinct from me.class and o.score > me.score) end,
    case when me.spec = ''
      then (select count(*) from mplus_scores o where o.spec = '' and o.class is not distinct from me.class) end,
    case when me.prev_score <> me.score then
      case when me.spec = ''
        then (select count(*) + 1 from mplus_scores o where o.spec = '' and o.prev_score > me.prev_score)
        else (select count(*) + 1 from mplus_scores o where o.spec = me.spec and o.class is not distinct from me.class
                and o.prev_score > me.prev_score) end end,
    case when me.prev_score <> me.score and me.spec = ''
      then (select count(*) + 1 from mplus_scores o where o.spec = '' and o.class is not distinct from me.class
              and o.prev_score > me.prev_score) end
  from mplus_scores me
  where me.realm = p_realm and me.name_lower = lower(p_name)
$$;
grant execute on function mplus_player_ranks(text, text) to anon, authenticated;
create index if not exists mplus_scores_spec_idx on mplus_scores (spec, class, score desc);

-- ── PRUNE (full scrapes) ──────────────────────────────────────────────────────
-- The armory rewrites history: a renamed character shows their NEW name on every old
-- run, and a deleted one turns into a placeholder or disappears. A run's id hashes its
-- party names, so the board's current version of such a run gets a new id and the stored
-- copy under the old names would live on as a duplicate. After a full scrape of one
-- board+dungeon the scraper passes every id that board now holds; anything else stored
-- for it is stale and removed. A replacement inherits its stale twin's first_seen (same
-- board, dungeon, key, exact time and day) so run ordering survives. Refuses to delete
-- more than a quarter of a dungeon's rows — that would mean a broken fetch, not renames.
create or replace function prune_mplus_runs(p_realm text, p_map int, p_keep text[]) returns int
language plpgsql security definer set search_path = public set statement_timeout = '120s' as $$
declare
  total int;
  stale int;
begin
  select count(*), count(*) filter (where not (id = any(p_keep))) into total, stale
  from mplus_runs where realm = p_realm and map_id = p_map;
  if stale = 0 then return 0; end if;
  if stale > total * 0.25 then
    raise exception 'refusing to prune % of % runs for % / map %', stale, total, p_realm, p_map;
  end if;
  update mplus_runs n set first_seen = o.first_seen
  from mplus_runs o
  where n.realm = p_realm and n.map_id = p_map and n.id = any(p_keep)
    and o.realm = n.realm and o.map_id = n.map_id and not (o.id = any(p_keep))
    and o.level = n.level and o.time_ms is not distinct from n.time_ms and o.day = n.day
    and o.first_seen < n.first_seen;
  delete from mplus_runs where realm = p_realm and map_id = p_map and not (id = any(p_keep));
  return stale;
end $$;
revoke execute on function prune_mplus_runs(text, int, text[]) from public, anon, authenticated;

-- ── M+ SCORES v2: best run per dungeon stored, in-place refresh, leaderboard ──
-- When the M+ rankings were last rebuilt (one row), for the rankings page's "Last updated".
-- Written by refresh_mplus_scores at the end of every scrape; public read-only.
create table if not exists mplus_status (
  id int primary key default 1 check (id = 1),
  refreshed_at timestamptz not null
);
alter table mplus_status enable row level security;
drop policy if exists "public read mplus status" on mplus_status;
create policy "public read mplus status" on mplus_status for select using (true);

-- `best` = the run behind each dungeon's contribution to the score:
--   { "<map_id>": [level, medal, score, time_ms], … }
-- Stored (not looked up per request): the top players have hundreds of runs each, and
-- finding their best per dungeon on the fly ran past the API's statement timeout.
alter table mplus_scores add column if not exists best jsonb;
-- The score a row had BEFORE the last scrape that changed anyone's score (null = the
-- player wasn't ranked in this scope then). The rankings rank everyone by it to get the
-- position they held before that update, which is what the up/down arrows show.
alter table mplus_scores add column if not exists prev_score numeric;
-- The highest key the player TIMED in this scope (null = none timed). The rankings' key
-- filter keeps only players at or above a level; it never changes anyone's rank.
alter table mplus_scores add column if not exists max_key smallint;
-- One-time seed when adding the column to a live table, so the first update after it
-- shows real movement instead of treating every player as new:
--   update mplus_scores set prev_score = score where prev_score is null;

-- Called by the scraper after each run (service role). Two steps:
--  1. A new run's specs come from Tauri Achievements about a day later. Until then, a
--     member whose role doesn't decide the spec (a dps Warrior: Arms or Fury?) is ASSUMED
--     to be on the spec they last played in that role, flagged spec_guess so the scraper
--     replaces it with the real one once it's published. Keeps spec scores from lagging.
--  2. Bring mplus_scores up to date IN PLACE: only rows whose score/best/name/class changed
--     are rewritten and only vanished players deleted, so an hourly refresh touches a few
--     hundred rows instead of rewriting all ~27k (which bloated the table).
--     When the scrape changed any score, the scores from before it are first kept in
--     prev_score (see the column). A scrape that changes nothing leaves prev_score alone,
--     so the arrows keep showing the last update that actually moved someone.
-- Players are keyed by their own realm (party[].realm), falling back to the board's.
create or replace function refresh_mplus_scores() returns void
language plpgsql security definer set search_path = public set statement_timeout = '120s' as $$
begin
  with known as (
    select distinct on (coalesce(nullif(p->>'realm', ''), r.realm), lower(p->>'name'), p->>'class', p->>'role')
      coalesce(nullif(p->>'realm', ''), r.realm) as realm, lower(p->>'name') as n,
      p->>'class' as c, p->>'role' as ro, p->>'spec' as spec
    from mplus_runs r, jsonb_array_elements(r.party) p
    where r.specs_matched and coalesce(p->>'spec', '') <> ''
    order by coalesce(nullif(p->>'realm', ''), r.realm), lower(p->>'name'), p->>'class', p->>'role',
             r.day desc, r.first_seen desc
  )
  update mplus_runs r set party = (
    select jsonb_agg(
      case when coalesce(t.p->>'spec', '') = '' and k.spec is not null
        then t.p || jsonb_build_object('spec', k.spec, 'spec_guess', true)
        else t.p end
      order by t.ord)
    from jsonb_array_elements(r.party) with ordinality t(p, ord)
    left join known k
      on k.realm = coalesce(nullif(t.p->>'realm', ''), r.realm) and k.n = lower(t.p->>'name')
     and k.c = t.p->>'class' and k.ro = t.p->>'role'
  )
  where not r.specs_matched
    and exists (select 1 from jsonb_array_elements(r.party) p where coalesce(p->>'spec', '') = '');

  create temp table _mplus_new on commit drop as
  with m as (
    select coalesce(nullif(p->>'realm', ''), r.realm) as realm, lower(p->>'name') as n, p->>'name' as name,
           p->>'class' as class, coalesce(p->>'spec', '') as spec, r.map_id, r.day, r.level, r.medal, r.time_ms,
           mplus_run_score(r.map_id, r.level, r.time_ms) as s
    from mplus_runs r, jsonb_array_elements(r.party) p
    where coalesce(p->>'name', '') <> ''
  ),
  ident as ( -- a player's current name spelling + class = their most recent run's
    select distinct on (realm, n) realm, n, name, class from m order by realm, n, day desc
  ),
  scoped as ( -- every run counts for the overall scope (''), and for its own spec's
    select realm, n, ''::text as spec, map_id, level, medal, time_ms, s from m
    union all
    select realm, n, spec, map_id, level, medal, time_ms, s from m where spec <> ''
  ),
  per as ( -- the best run per dungeon in each scope: highest score, then the faster clear
    select distinct on (realm, n, spec, map_id) realm, n, spec, map_id, level, medal, time_ms, s
    from scoped
    order by realm, n, spec, map_id, s desc nulls last, time_ms asc nulls last
  ),
  keys as ( -- the highest key timed (medal > 0) in each scope, for the key filter
    select realm, n, spec, max(level) filter (where medal > 0) as max_key
    from scoped group by realm, n, spec
  )
  select per.realm, per.n as name_lower, i.name, i.class, per.spec,
         round(sum(coalesce(per.s, 0)), 1) as score,
         jsonb_object_agg(per.map_id, jsonb_build_array(per.level, per.medal, per.s, per.time_ms)) as best,
         max(k.max_key)::smallint as max_key
  from per join ident i on i.realm = per.realm and i.n = per.n
  join keys k on k.realm = per.realm and k.n = per.n and k.spec = per.spec
  group by per.realm, per.n, i.name, i.class, per.spec;

  if exists (
    select 1 from _mplus_new x
    full join mplus_scores t on t.realm = x.realm and t.name_lower = x.name_lower and t.spec = x.spec
    where x.score is distinct from t.score
  ) then
    update mplus_scores set prev_score = score where prev_score is distinct from score;
  end if;

  insert into mplus_scores as t (realm, name_lower, name, class, spec, score, best, max_key)
  select realm, name_lower, name, class, spec, score, best, max_key from _mplus_new
  on conflict (realm, name_lower, spec) do update
    set name = excluded.name, class = excluded.class, score = excluded.score, best = excluded.best,
        max_key = excluded.max_key
    where (t.name, t.class, t.score, t.best, t.max_key)
      is distinct from (excluded.name, excluded.class, excluded.score, excluded.best, excluded.max_key);

  delete from mplus_scores t
  where not exists (
    select 1 from _mplus_new x where x.realm = t.realm and x.name_lower = t.name_lower and x.spec = t.spec);

  -- 3. Each score row carries its player's guild (mplus_guilds, synced by the scraper).
  update mplus_scores t set guild = x.guild
  from (
    select s.realm, s.name_lower, s.spec, g.guild
    from mplus_scores s
    left join mplus_guilds g on g.realm = s.realm and g.name_lower = s.name_lower
  ) x
  where x.realm = t.realm and x.name_lower = t.name_lower and x.spec = t.spec
    and t.guild is distinct from x.guild;

  -- 4. Stamp the rebuild time for the rankings page.
  insert into mplus_status (id, refreshed_at) values (1, now())
  on conflict (id) do update set refreshed_at = excluded.refreshed_at;
end $$;
revoke execute on function refresh_mplus_scores() from public, anon, authenticated;


-- How many players there are in each class and spec, for the rankings page's spec chart:
-- one row per class (spec '' = everyone of that class) and per class+spec. Each player
-- counts ONCE, under their main spec (the spec with their highest spec score), so a
-- class's specs add up to the class and the classes to everyone. p_realm (armory string,
-- optional) narrows it to one realm; p_min_key keeps only players who timed a key of that
-- level or higher.
drop function if exists mplus_population(text);
create or replace function mplus_population(p_realm text default null, p_min_key int default null)
returns table (class text, spec text, players bigint)
language sql stable set search_path = public as $$
  with pl as (
    select s.realm, s.name_lower, s.class
    from mplus_scores s
    where s.spec = '' and s.class is not null
      and (p_realm is null or s.realm = p_realm)
      and (p_min_key is null or s.max_key >= p_min_key)
  ),
  main as (
    select distinct on (s.realm, s.name_lower) s.realm, s.name_lower, s.spec
    from mplus_scores s join pl on pl.realm = s.realm and pl.name_lower = s.name_lower
    where s.spec <> ''
    order by s.realm, s.name_lower, s.score desc, s.spec
  )
  select pl.class, ''::text, count(*) from pl group by pl.class
  union all
  select pl.class, m.spec, count(*)
  from pl join main m on m.realm = pl.realm and m.name_lower = pl.name_lower
  group by pl.class, m.spec
$$;
grant execute on function mplus_population(text, int) to anon, authenticated;

-- ── GUILDS ────────────────────────────────────────────────────────────────────
-- The armory's leaderboards don't carry guilds; Tauri Achievements' player index does
-- (refreshed about once a day), and the scraper mirrors it here keyed like mplus_scores
-- (the player's own realm + lowercased name). Names can be any script (Cyrillic, CJK …).
create table if not exists mplus_guilds (
  realm text not null,
  name_lower text not null,
  guild text not null,
  primary key (realm, name_lower)
);
alter table mplus_guilds enable row level security;
drop policy if exists "public read mplus guilds" on mplus_guilds;
create policy "public read mplus guilds" on mplus_guilds for select using (true);

alter table mplus_scores add column if not exists guild text;
create index if not exists mplus_scores_guild_idx on mplus_scores (guild) where guild is not null;

-- Replace the guild list with `p` = [{ realm, name, guild }, …] (service role, from the
-- scraper), in place: only changed rows are written, players no longer listed lose their
-- guild. An empty list is ignored — that's a failed download, not everyone leaving.
-- Returns the number of players with a guild. refresh_mplus_scores copies them onto scores.
create or replace function sync_mplus_guilds(p jsonb) returns int
language plpgsql security definer set search_path = public set statement_timeout = '120s' as $$
declare
  n int;
begin
  create temp table _mplus_g on commit drop as
  select distinct on (x->>'realm', lower(x->>'name'))
         x->>'realm' as realm, lower(x->>'name') as name_lower, btrim(x->>'guild') as guild
  from jsonb_array_elements(p) x
  where coalesce(btrim(x->>'guild'), '') <> '' and coalesce(x->>'name', '') <> '' and coalesce(x->>'realm', '') <> '';
  select count(*) into n from _mplus_g;
  if n = 0 then return 0; end if;

  insert into mplus_guilds as t (realm, name_lower, guild)
  select realm, name_lower, guild from _mplus_g
  on conflict (realm, name_lower) do update set guild = excluded.guild
    where t.guild is distinct from excluded.guild;
  delete from mplus_guilds t
  where not exists (select 1 from _mplus_g x where x.realm = t.realm and x.name_lower = t.name_lower);
  return n;
end $$;
revoke execute on function sync_mplus_guilds(jsonb) from public, anon, authenticated;

-- Guilds with at least one ranked player, biggest first, for the rankings' guild filter.
-- p_realm (armory string, optional) narrows it to one realm.
create or replace function mplus_guild_list(p_realm text default null)
returns table (guild text, players bigint)
language sql stable set search_path = public as $$
  select s.guild, count(*)
  from mplus_scores s
  where s.spec = '' and s.guild is not null and (p_realm is null or s.realm = p_realm)
  group by s.guild
  order by count(*) desc, s.guild
$$;
grant execute on function mplus_guild_list(text) to anon, authenticated;

-- One page of the rankings, read straight from mplus_scores:
--   no class          → every player's overall score
--   class             → that class's players by overall score
--   class + spec      → players of that class by their score AS that spec
--   p_realm (armory string, optional) narrows any of them to one realm,
--   p_guild (optional) to a guild: an exact guild name (any case) picks that guild,
--     anything else (2+ characters) every guild whose name contains it, accent-free —
--     "crows" keeps both "A Murder of Crows" and "Crows at Midnight"
-- `rank` is the position inside that list (ties broken by name so paging is stable).
-- p_search (optional, 2+ characters) then keeps only names containing it — accent-free,
-- like the sidebar search — WITHOUT changing anyone's rank: searching "ivko" in Fury
-- Warriors still shows Ivkomdfk as #14. `total` is the number of rows being paged
-- through (the whole list, or the matches when searching).
-- When p_find_* names a player, p_offset is ignored and the page that player is on comes
-- back instead (the profile's rank chips link here).
-- `prev_rank` is the position the player held in this same list before the last update
-- that changed any score (ranked by prev_score). It is only given for players whose OWN
-- score changed in that update: null for anyone who merely got passed, or who wasn't in
-- the list yet.
-- p_min_key (optional) keeps only players who timed a key of that level or higher in this
-- scope, AFTER ranking: ranks stay their real rank in the full list, like p_search.
-- `spec` in a class's overall list (p_class set, no p_spec) is the player's MAIN spec — the
-- spec with their highest spec score — so the page can show which spec each player plays.
-- The all-classes list leaves it '' (the page shows class icons only there).
drop function if exists mplus_leaderboard(text, text, text, int, int, text, text, text);
drop function if exists mplus_leaderboard(text, text, text, int, int, text, text, text, text);
drop function if exists mplus_leaderboard(text, text, text, int, int, text, text, text, text, int);
create or replace function mplus_leaderboard(
  p_class text default null,
  p_spec text default null,
  p_realm text default null,
  p_limit int default 25,
  p_offset int default 0,
  p_find_realm text default null,
  p_find_name text default null,
  p_search text default null,
  p_guild text default null,
  p_min_key int default null
)
returns table (rank bigint, total bigint, realm text, name text, class text, spec text, score numeric, best jsonb, guild text, prev_rank bigint)
language sql stable set search_path = extensions, public as $$
  with lim as (select least(greatest(coalesce(p_limit, 25), 1), 50) as n),
  q as ( -- the folded search text with LIKE wildcards escaped, or null when not searching
    select case when length(name_fold(btrim(coalesce(p_search, '')))) >= 2
      then replace(replace(replace(name_fold(btrim(p_search)), '\', '\\'), '%', '\%'), '_', '\_') end as esc
  ),
  gq as ( -- the guild filter: exact name if one exists, else the folded, escaped fragment
    select g, exists (select 1 from mplus_guilds mg where lower(mg.guild) = lower(g)) as exact,
           replace(replace(replace(name_fold(g), '\', '\\'), '%', '\%'), '_', '\_') as esc
    from (select nullif(btrim(coalesce(p_guild, '')), '') as g) x
  ),
  gm as ( -- guilds whose name contains the fragment (folded once per guild, not per player)
    select d.guild from (select distinct guild from mplus_guilds) d, gq
    where not gq.exact and length(gq.g) >= 2 and name_fold(d.guild) like '%' || gq.esc || '%'
  ),
  ranked as (
    select s.realm, s.name_lower, s.name, s.class, s.spec, s.score, s.best, s.guild, s.max_key,
           row_number() over (order by s.score desc, s.name_lower, s.realm) as rk,
           case when s.prev_score <> s.score then
             row_number() over (order by s.prev_score desc nulls last, s.name_lower, s.realm) end as prev_rk
    from mplus_scores s, gq
    where s.spec = case when p_class is null then '' else coalesce(nullif(p_spec, ''), '') end
      and (p_class is null or s.class = p_class)
      and (p_realm is null or s.realm = p_realm)
      and (gq.g is null
           or (not gq.exact and length(gq.g) < 2) -- a single letter is no filter
           or (gq.exact and lower(s.guild) = lower(gq.g))
           or (not gq.exact and s.guild in (select guild from gm)))
  ),
  f as (
    select r.*, row_number() over (order by r.rk) as pos, count(*) over () as total
    from ranked r, q
    where (q.esc is null or name_fold(r.name) like '%' || q.esc || '%')
      and (p_min_key is null or r.max_key >= p_min_key)
  ),
  start as (
    select coalesce(
      (select ((f.pos - 1) / lim.n) * lim.n from f, lim
       where p_find_name is not null and f.realm = p_find_realm and f.name_lower = lower(p_find_name)),
      greatest(coalesce(p_offset, 0), 0)) as o
  )
  select f.rk, f.total, f.realm, f.name, f.class,
         case when f.spec = '' and p_class is not null then coalesce(
           (select ms.spec from mplus_scores ms
            where ms.realm = f.realm and ms.name_lower = f.name_lower and ms.spec <> ''
            order by ms.score desc limit 1), '')
         else f.spec end,
         f.score, f.best, f.guild, f.prev_rk
  from f, lim, start
  where f.pos > start.o and f.pos <= start.o + lim.n
  order by f.pos
$$;
grant execute on function mplus_leaderboard(text, text, text, int, int, text, text, text, text, int) to anon, authenticated;

-- ── M+ scrape scheduler ────────────────────────────────────────────────────
-- GitHub's own `schedule:` trigger is best-effort: the "hourly" M+ scrape really ran every
-- 3–5 hours. So the database's pg_cron triggers it instead, on the minute, through GitHub's
-- workflow_dispatch API (pg_net). The scrape itself stays in GitHub Actions: a full board
-- pass downloads ~250 MB of HTML, far past an Edge Function's 2 s CPU limit.
--
-- The GitHub token lives in Vault (never in this file):
--   select vault.create_secret('<token>', 'github_dispatch_token');
--   -- replace later: select vault.update_secret(id, '<new token>') from vault.secrets
--   --                where name = 'github_dispatch_token';
-- Needs a token that can run workflows on ivkoneli/CrowLogs (fine-grained: Actions write).
--
-- Watchdog: each call checks the previous dispatches' HTTP answers, and whether the last
-- scrape (mplus_status.refreshed_at) is over 3 h old; either emails the owner through the
-- notify-failure Edge Function (at most once per 12 h for staleness).
create extension if not exists pg_cron;
create extension if not exists pg_net;

create table if not exists scrape_dispatch (
  id bigserial primary key,
  kind text not null,
  request_id bigint,
  sent_at timestamptz not null default now(),
  checked boolean not null default false
);
-- No policies: only the service role / cron can see it.
alter table scrape_dispatch enable row level security;

create table if not exists scrape_alert (
  id int primary key default 1 check (id = 1),
  last_stale_alert timestamptz
);
alter table scrape_alert enable row level security;
insert into scrape_alert (id) values (1) on conflict do nothing;

create or replace function notify_owner(p_context text, p_message text)
returns void language sql security definer set search_path = public, extensions as $$
  select net.http_post(
    url := 'https://nkssiybjvxwgxertamox.supabase.co/functions/v1/notify-failure',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := jsonb_build_object('context', p_context, 'message', p_message),
    timeout_milliseconds := 15000
  );
$$;

-- p_kind: 'hourly' (incremental) or 'full' (weekly re-read of every board).
create or replace function dispatch_mplus_scrape(p_kind text default 'hourly')
returns void language plpgsql security definer set search_path = public, extensions as $$
declare
  tok text;
  bad text;
  req bigint;
begin
  -- 1. Answers to earlier dispatches (pg_net stores them asynchronously, ~6 h).
  select string_agg(format('%s dispatch at %s: %s', d.kind, to_char(d.sent_at, 'YYYY-MM-DD HH24:MI "UTC"'),
                           coalesce(r.status_code::text, r.error_msg, 'no answer')), E'\n')
    into bad
  from scrape_dispatch d
  left join net._http_response r on r.id = d.request_id
  where not d.checked and d.sent_at < now() - interval '2 minutes'
    and (r.id is not null or d.sent_at < now() - interval '1 hour')
    and (r.status_code is null or r.status_code not between 200 and 299);
  update scrape_dispatch d set checked = true
  where not d.checked and d.sent_at < now() - interval '2 minutes'
    and (exists (select 1 from net._http_response r where r.id = d.request_id) or d.sent_at < now() - interval '1 hour');
  delete from scrape_dispatch where sent_at < now() - interval '14 days';
  if bad is not null then
    perform notify_owner('mplus-scrape-dispatch',
      'GitHub refused to start the M+ scrape (token expired/revoked, or workflow disabled?).' || E'\n' || bad);
  end if;

  -- 2. Staleness: no finished scrape for 3 h, whatever the reason.
  if (select refreshed_at from mplus_status where id = 1) < now() - interval '3 hours'
     and coalesce((select last_stale_alert from scrape_alert where id = 1), '-infinity') < now() - interval '12 hours' then
    update scrape_alert set last_stale_alert = now() where id = 1;
    perform notify_owner('mplus-scrape-stale',
      'No M+ scrape has finished since ' || (select refreshed_at from mplus_status where id = 1)
      || '. Check https://github.com/ivkoneli/CrowLogs/actions/workflows/scrape-mythic-plus.yml');
  end if;

  -- 3. Start the workflow.
  select decrypted_secret into tok from vault.decrypted_secrets where name = 'github_dispatch_token';
  if tok is null then
    perform notify_owner('mplus-scrape-dispatch', 'Vault secret github_dispatch_token is missing.');
    return;
  end if;
  select net.http_post(
    url := 'https://api.github.com/repos/ivkoneli/CrowLogs/actions/workflows/scrape-mythic-plus.yml/dispatches',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || tok,
      'Accept', 'application/vnd.github+json',
      'X-GitHub-Api-Version', '2022-11-28',
      'User-Agent', 'crowlogs-pg-cron',
      'Content-Type', 'application/json'),
    body := case when p_kind = 'full'
              then '{"ref": "main", "inputs": {"full": "true"}}'::jsonb
              else '{"ref": "main"}'::jsonb end,
    timeout_milliseconds := 15000
  ) into req;
  insert into scrape_dispatch (kind, request_id) values (p_kind, req);
end;
$$;
revoke all on function dispatch_mplus_scrape(text) from public, anon, authenticated;
revoke all on function notify_owner(text, text) from public, anon, authenticated;

-- Hourly at :05; the weekly full pass Wednesday 04:47 UTC (before the EU reset). The
-- workflow's concurrency group queues one behind the other if they meet.
select cron.schedule('mplus-scrape-hourly', '5 * * * *', $$select dispatch_mplus_scrape('hourly')$$);
select cron.schedule('mplus-scrape-full', '47 4 * * 3', $$select dispatch_mplus_scrape('full')$$);

-- ── SERVER-WIDE RAID BESTS (scripts/scrape-raids.mjs) ─────────────────────────
-- Every boss kill on Tauri, read from the official API every 30 min, keeps ONE row per
-- player × boss × difficulty × metric × spec: that player's best DPS (or HPS) kill in that
-- spec, with the build Tauri froze at the kill (spec, ilvl, talents, trinkets). No per-kill
-- history: a kill only writes the rows it beats. Detailed history stays in `fights` (uploaded
-- logs). Tracking started 2026-10-20; earlier kills are only here through the seed from `fights`.
--
-- legendary_status: Tauri's record has no legendaries, so the scraper reads them off the
-- armory right after the kill and keeps them only if the armory still shows the kill's spec,
-- trinkets and ilvl ('ok'); otherwise they're left out ('mismatch' / 'unknown'). 'log' = the
-- row came from an uploaded log (addon/armory snapshot frozen at import).
create table if not exists raid_bests (
  player_key text not null,          -- lower("Name-realmslug"), the profile key
  player text not null,              -- "Name-realmslug" as displayed
  raid text not null,
  boss text not null,
  difficulty text not null,          -- Normal / Heroic / Mythic / LFR
  metric text not null check (metric in ('dps', 'hps')),
  spec text not null default '',
  class text,
  race text,
  gender smallint,
  faction text,
  guild text,
  value double precision not null,   -- dps or hps
  amount bigint not null,            -- damage or healing (+absorbs) total
  duration int not null,             -- fight length, ms
  day text,                          -- kill time in server time, "M/D HH:MM" like fights.day
  ilvl smallint,
  talents jsonb,                     -- [{ row, col }] like fights.talents
  trinkets jsonb,                    -- [{ id, name, icon, ilvl, quality }] like fights.trinkets
  legendaries jsonb,                 -- same shape; null = not known
  legendary_status text,
  source text not null default 'tauri',  -- 'tauri' | 'log'
  api_realm text,                    -- Tauri API realm the kill was read from
  log_id bigint,                     -- Tauri raid-log id (links an uploaded log via fights.tauri_log)
  logid text,                        -- uploaded log, for rows seeded from `fights`
  started bigint,                    -- …and its encounter start
  updated_at timestamptz not null default now(),
  primary key (player_key, raid, boss, difficulty, metric, spec)
);
create index if not exists raid_bests_board_idx on raid_bests (raid, boss, difficulty, metric, value desc);
alter table raid_bests enable row level security;
drop policy if exists "public read raid bests" on raid_bests;
create policy "public read raid bests" on raid_bests for select using (true);

-- One row per kill seen by the scraper (no members): kill counts + "already processed".
create table if not exists raid_kills (
  api_realm text not null,
  log_id bigint not null,
  raid text not null,
  boss text not null,
  difficulty text not null,
  killed_at timestamptz,
  fight_time int,
  guild text,
  members smallint,
  primary key (api_realm, log_id)
);
create index if not exists raid_kills_boss_idx on raid_kills (raid, boss, difficulty);
alter table raid_kills enable row level security;
drop policy if exists "public read raid kills" on raid_kills;
create policy "public read raid kills" on raid_kills for select using (true);

-- Scraper progress per API realm: newest raid-log id processed. The first run only records
-- the current newest id, so tracking starts from that moment (no backfill).
create table if not exists raid_status (
  api_realm text primary key,
  last_log_id bigint not null,
  refreshed_at timestamptz not null default now()
);
alter table raid_status enable row level security;
drop policy if exists "public read raid status" on raid_status;
create policy "public read raid status" on raid_status for select using (true);

-- Everyone seen in a kill: which realm they're on (Evermoon and [HU] Tauri share one API
-- realm, so the armory decides — `verified`) and the sidebar search for raiders with no logs.
create table if not exists raid_players (
  api_realm text not null,
  name text not null,
  slug text not null,                -- evermoon / tauri / wod
  verified boolean not null default false,
  class text,
  name_fold text,
  updated_at timestamptz not null default now(),
  primary key (api_realm, name)
);
create index if not exists raid_players_fold_trgm on raid_players using gin (name_fold extensions.gin_trgm_ops);
alter table raid_players enable row level security;
drop policy if exists "public read raid players" on raid_players;
create policy "public read raid players" on raid_players for select using (true);

-- The board/profile join an uploaded log to the Tauri kill it was matched to.
create index if not exists fights_tauri_log_idx on fights (tauri_log) where tauri_log is not null;

-- Seed: the bests already in uploaded logs (kills only, no pets, not discredited), so the
-- board keeps everything it showed before the Tauri tracking started. Safe to re-run: a row
-- the scraper has since beaten is left alone.
insert into raid_bests (player_key, player, raid, boss, difficulty, metric, spec, class, race, gender,
                        faction, guild, value, amount, duration, day, ilvl, talents, trinkets,
                        legendaries, legendary_status, source, log_id, logid, started)
select distinct on (lower(f.player), f.raid, f.boss, f.difficulty, m.metric, coalesce(f.spec, c.spec, ''))
  lower(f.player), f.player, f.raid, f.boss, f.difficulty, m.metric, coalesce(f.spec, c.spec, ''),
  coalesce(f.class, c.class), c.race, c.gender, c.faction, c.guild,
  m.value, m.amount, f.duration, f.day, f.ilvl,
  (select jsonb_agg(jsonb_build_object('row', t->'row', 'col', t->'col'))
   from jsonb_array_elements(case when jsonb_typeof(f.talents) = 'array' then f.talents else '[]'::jsonb end) t),
  f.trinkets, nullif(f.legendaries, '[]'::jsonb), 'log', 'log', f.tauri_log, f.logid, f.started
from fights f
left join characters c on c.key = lower(f.player)
cross join lateral (values ('dps', f.dps, f.damage), ('hps', f.hps, f.healing)) m(metric, value, amount)
where f.kill is not false and not coalesce(f.pet, false) and not coalesce(f.discredited, false)
  and f.raid is not null and f.boss is not null and f.difficulty is not null
  and m.value > 0 and m.amount > 0
order by lower(f.player), f.raid, f.boss, f.difficulty, m.metric, coalesce(f.spec, c.spec, ''), m.value desc
on conflict (player_key, raid, boss, difficulty, metric, spec) do update set
  value = excluded.value, amount = excluded.amount, duration = excluded.duration, day = excluded.day,
  ilvl = excluded.ilvl, talents = excluded.talents, trinkets = excluded.trinkets,
  legendaries = excluded.legendaries, legendary_status = excluded.legendary_status,
  source = excluded.source, log_id = excluded.log_id, logid = excluded.logid, started = excluded.started
where raid_bests.value < excluded.value;

-- Boss board: each player's best for the boss (best across difficulties when p_difficulty is
-- null, and across specs unless p_specs narrows it), top p_limit, plus the matched total.
-- A row whose kill is an uploaded log gets that log's id/start (row click opens it) and its
-- frozen legendaries; a kill an admin discredited in its log is left off.
-- (p_offset added 2026-10-26 for the boss page pager; the old 9-arg version is dropped.)
drop function if exists raid_board(text, text, text, text, text[], text, text, text, int);
create or replace function raid_board(
  p_raid text, p_boss text, p_difficulty text, p_metric text,
  p_specs text[] default null, p_class text default null, p_faction text default null,
  p_realm text default null, p_limit int default 500, p_offset int default 0
)
returns table (
  player text, class text, spec text, race text, gender smallint, faction text, guild text,
  value double precision, amount bigint, duration int, day text, difficulty text, ilvl smallint,
  talents jsonb, trinkets jsonb, legendaries jsonb, legendary_status text, source text,
  logid text, started bigint, total int
)
language sql stable set search_path = public as $$
  with cand as (
    select rb.*, f.logid as f_logid, f.started as f_started, f.legendaries as f_leg,
           coalesce(f.discredited, false) as disc
    from raid_bests rb
    left join lateral (
      select x.logid, x.started, x.legendaries, x.discredited from fights x
      where rb.log_id is not null and x.tauri_log = rb.log_id and lower(x.player) = rb.player_key
      limit 1
    ) f on true
    where rb.raid = p_raid and rb.boss = p_boss and rb.metric = p_metric
      and (p_difficulty is null or rb.difficulty = p_difficulty)
      and (p_specs is null or rb.spec = any (p_specs))
      and (p_class is null or rb.class = p_class)
      and (p_faction is null or rb.faction = p_faction)
      and (p_realm is null or split_part(rb.player_key, '-', 2) = lower(p_realm))
  ), best as (
    select distinct on (player_key) * from cand where not disc order by player_key, value desc
  )
  select b.player, b.class, b.spec, b.race, b.gender, b.faction, b.guild, b.value, b.amount,
         b.duration, b.day, b.difficulty, b.ilvl, b.talents, b.trinkets,
         case when jsonb_array_length(coalesce(b.f_leg, '[]'::jsonb)) > 0 then b.f_leg else b.legendaries end,
         case when jsonb_array_length(coalesce(b.f_leg, '[]'::jsonb)) > 0 then 'log' else b.legendary_status end,
         b.source, coalesce(b.logid, b.f_logid), coalesce(b.started, b.f_started),
         (count(*) over ())::int
  from best b
  order by b.value desc
  limit least(greatest(p_limit, 1), 1000)
  offset greatest(coalesce(p_offset, 0), 0)
$$;
grant execute on function raid_board(text, text, text, text, text[], text, text, text, int, int) to anon, authenticated;

-- A player's bests on every boss, with their rank among all players (rank_all: everyone's
-- best across specs) and within that spec (rank_spec), for the profile's Rankings tab.
create or replace function raid_player_bests(p_player text)
returns table (
  raid text, boss text, difficulty text, metric text, spec text, class text, race text,
  gender smallint, faction text, guild text, value double precision, amount bigint,
  duration int, day text, ilvl smallint, talents jsonb, trinkets jsonb, legendaries jsonb,
  legendary_status text, logid text, started bigint,
  rank_all int, total_all int, rank_spec int, total_spec int
)
language sql stable set search_path = public as $$
  select rb.raid, rb.boss, rb.difficulty, rb.metric, rb.spec, rb.class, rb.race, rb.gender,
         rb.faction, rb.guild, rb.value, rb.amount, rb.duration, rb.day, rb.ilvl, rb.talents,
         rb.trinkets, rb.legendaries, rb.legendary_status,
         coalesce(rb.logid, f.logid), coalesce(rb.started, f.started),
         1 + (select count(distinct b.player_key) from raid_bests b
              where b.raid = rb.raid and b.boss = rb.boss and b.difficulty = rb.difficulty
                and b.metric = rb.metric and b.value > rb.value and b.player_key <> rb.player_key)::int,
         (select count(distinct b.player_key) from raid_bests b
          where b.raid = rb.raid and b.boss = rb.boss and b.difficulty = rb.difficulty
            and b.metric = rb.metric)::int,
         1 + (select count(*) from raid_bests b
              where b.raid = rb.raid and b.boss = rb.boss and b.difficulty = rb.difficulty
                and b.metric = rb.metric and b.spec = rb.spec and b.value > rb.value
                and b.player_key <> rb.player_key)::int,
         (select count(*) from raid_bests b
          where b.raid = rb.raid and b.boss = rb.boss and b.difficulty = rb.difficulty
            and b.metric = rb.metric and b.spec = rb.spec)::int
  from raid_bests rb
  left join lateral (
    select x.logid, x.started from fights x
    where rb.log_id is not null and x.tauri_log = rb.log_id and lower(x.player) = rb.player_key
    limit 1
  ) f on true
  where rb.player_key = lower(p_player)
$$;
grant execute on function raid_player_bests(text) to anon, authenticated;

-- Kills per raid/boss/difficulty: everything the scraper saw plus uploaded kills (an upload
-- matched to a Tauri kill counts once).
create or replace function raid_kill_counts()
returns table (raid text, boss text, difficulty text, kills int)
language sql stable set search_path = public as $$
  select k.raid, k.boss, k.difficulty, count(*)::int from (
    select rk.raid, rk.boss, rk.difficulty, rk.log_id::text as k from raid_kills rk
    union
    select f.raid, f.boss, f.difficulty, coalesce(f.tauri_log::text, f.logid || ':' || f.started) from fights f
    where f.kill is not false and f.raid is not null and f.boss is not null and f.difficulty is not null
  ) k
  group by k.raid, k.boss, k.difficulty
$$;
grant execute on function raid_kill_counts() to anon, authenticated;

-- Sidebar search for raiders seen on Tauri (players in uploaded logs are matched client-side).
create or replace function search_raid_players(q text, lim int default 8)
returns table (player text, class text)
language sql stable set search_path = extensions, public as $$
  with p as (
    select name_fold(q) as fq,
           replace(replace(replace(name_fold(q), '\', '\\'), '%', '\%'), '_', '\_') as esc
  )
  select r.name || '-' || r.slug, r.class
  from raid_players r, p
  where length(p.fq) >= 2
    and (r.name_fold like '%' || p.esc || '%'
         or (length(p.fq) >= 3 and similarity(r.name_fold, p.fq) >= 0.35))
  order by
    case when r.name_fold like p.esc || '%' then 0 else 1 end,
    similarity(r.name_fold, p.fq) desc
  limit least(greatest(lim, 1), 25)
$$;
grant execute on function search_raid_players(text, int) to anon, authenticated;

-- Every 30 min (:20 and :50, clear of the M+ scrape at :05): start scrape-raids.yml the same
-- way dispatch_mplus_scrape starts the M+ one, and email the owner if GitHub refuses the
-- dispatch or no raid scrape has finished for 2 h.
create table if not exists raid_scrape_alert (
  id int primary key default 1 check (id = 1),
  last_stale_alert timestamptz
);
alter table raid_scrape_alert enable row level security;
insert into raid_scrape_alert (id) values (1) on conflict do nothing;

create or replace function dispatch_raid_scrape()
returns void language plpgsql security definer set search_path = public, extensions as $$
declare
  tok text;
  bad text;
  req bigint;
begin
  select string_agg(format('raid dispatch at %s: %s', to_char(d.sent_at, 'YYYY-MM-DD HH24:MI "UTC"'),
                           coalesce(r.status_code::text, r.error_msg, 'no answer')), E'\n')
    into bad
  from scrape_dispatch d
  left join net._http_response r on r.id = d.request_id
  where d.kind = 'raid' and not d.checked and d.sent_at < now() - interval '2 minutes'
    and (r.id is not null or d.sent_at < now() - interval '1 hour')
    and (r.status_code is null or r.status_code not between 200 and 299);
  update scrape_dispatch d set checked = true
  where d.kind = 'raid' and not d.checked and d.sent_at < now() - interval '2 minutes'
    and (exists (select 1 from net._http_response r where r.id = d.request_id) or d.sent_at < now() - interval '1 hour');
  if bad is not null then
    perform notify_owner('raid-scrape-dispatch',
      'GitHub refused to start the raid scrape (token expired/revoked, or workflow disabled?).' || E'\n' || bad);
  end if;

  if coalesce((select max(refreshed_at) from raid_status), now()) < now() - interval '2 hours'
     and coalesce((select last_stale_alert from raid_scrape_alert where id = 1), '-infinity') < now() - interval '12 hours' then
    update raid_scrape_alert set last_stale_alert = now() where id = 1;
    perform notify_owner('raid-scrape-stale',
      'No raid scrape has finished since ' || (select max(refreshed_at) from raid_status)
      || '. Check https://github.com/ivkoneli/CrowLogs/actions/workflows/scrape-raids.yml');
  end if;

  select decrypted_secret into tok from vault.decrypted_secrets where name = 'github_dispatch_token';
  if tok is null then
    perform notify_owner('raid-scrape-dispatch', 'Vault secret github_dispatch_token is missing.');
    return;
  end if;
  select net.http_post(
    url := 'https://api.github.com/repos/ivkoneli/CrowLogs/actions/workflows/scrape-raids.yml/dispatches',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || tok,
      'Accept', 'application/vnd.github+json',
      'X-GitHub-Api-Version', '2022-11-28',
      'User-Agent', 'crowlogs-pg-cron',
      'Content-Type', 'application/json'),
    body := '{"ref": "main"}'::jsonb,
    timeout_milliseconds := 15000
  ) into req;
  insert into scrape_dispatch (kind, request_id) values ('raid', req);
end;
$$;
revoke all on function dispatch_raid_scrape() from public, anon, authenticated;

select cron.schedule('raid-scrape', '20,50 * * * *', $$select dispatch_raid_scrape()$$);
