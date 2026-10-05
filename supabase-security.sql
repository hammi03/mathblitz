-- ══════════════════════════════════════════════════════════════
--  QuantQuiz — Security migration
--  Scores, XP and streaks are now computed by the database, not the
--  browser. Clients can no longer write scores/XP directly.
--
--  Safe to run more than once. Includes everything from
--  supabase-phase3.sql and supabase-ranks.sql, so it also works if
--  those were never run.
--  Paste into Supabase → SQL Editor → Run
-- ══════════════════════════════════════════════════════════════

-- ── Columns / tables from earlier migrations ─────────────────
alter table profiles add column if not exists total_xp         bigint default 0;
alter table profiles add column if not exists current_streak   int    default 0;
alter table profiles add column if not exists longest_streak   int    default 0;
alter table profiles add column if not exists last_played_date date;

create table if not exists daily_scores (
    id              uuid default gen_random_uuid() primary key,
    user_id         uuid references profiles(id) on delete cascade not null,
    date            date not null default current_date,
    score           int  not null default 0,
    correct         int  not null default 0,
    wrong           int  not null default 0,
    best_streak     int  not null default 0,
    elapsed_seconds float not null default 0,
    completed_at    timestamptz,
    unique (user_id, date)
);
-- A daily row is now created when the attempt starts; completed_at is set on submit
alter table daily_scores add column if not exists started_at timestamptz default now();
alter table daily_scores alter column completed_at drop default;
alter table daily_scores enable row level security;

create table if not exists community_questions (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    submitted_by  uuid REFERENCES profiles(id) ON DELETE SET NULL,
    question_text text    NOT NULL,
    answer        integer NOT NULL,
    approved      boolean NOT NULL DEFAULT false,
    created_at    timestamptz NOT NULL DEFAULT now()
);
alter table community_questions enable row level security;
create index if not exists idx_community_questions_approved
    on community_questions (approved, created_at desc);

drop policy if exists "read approved questions" on community_questions;
create policy "read approved questions" on community_questions
    for select using (approved = true);

-- ── Game sessions (server-generated questions) ───────────────
create table if not exists game_sessions (
    id          uuid primary key default gen_random_uuid(),
    user_id     uuid not null references profiles(id) on delete cascade,
    mode        text not null check (mode in ('classic', 'sprint', 'daily')),
    difficulty  text not null check (difficulty in ('easy', 'medium', 'hard', 'mixed')),
    time_limit  int  not null default 0,
    questions   jsonb not null,
    started_at  timestamptz not null default now(),
    finished_at timestamptz
);
create index if not exists idx_game_sessions_user on game_sessions (user_id, finished_at);
alter table game_sessions enable row level security;   -- no policies: functions only

create table if not exists daily_challenges (
    date      date primary key,
    questions jsonb not null
);
alter table daily_challenges enable row level security; -- no policies: functions only

-- ── Lock down direct writes ──────────────────────────────────
-- Users could previously set their own total_xp / streaks / scores.
drop policy if exists "profiles_update"  on profiles;
drop policy if exists "profiles_insert"  on profiles;
drop policy if exists "scores_insert"    on scores;
drop policy if exists "daily_insert"     on daily_scores;
drop policy if exists "submit question"  on community_questions;

drop policy if exists "daily_select" on daily_scores;
create policy "daily_select" on daily_scores for select using (true);

-- ── Usernames: letters, digits, underscore, 3–20 chars ───────
-- Rename existing usernames that don't fit (e.g. ones containing HTML).
update profiles
   set username = left(regexp_replace(username, '[^A-Za-z0-9_]', '_', 'g'), 14) || '_' || substr(id::text, 1, 5)
 where username !~ '^[A-Za-z0-9_]{3,20}$';

alter table profiles drop constraint if exists profiles_username_format;
alter table profiles add constraint profiles_username_format
    check (username ~ '^[A-Za-z0-9_]{3,20}$');

create or replace function handle_new_user()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
    wanted text := new.raw_user_meta_data->>'username';
    v_name text;
begin
    if wanted ~ '^[A-Za-z0-9_]{3,20}$'
       and not exists (select 1 from profiles where lower(username) = lower(wanted)) then
        v_name := wanted;
    else
        v_name := 'player_' || substr(replace(new.id::text, '-', ''), 1, 8);
    end if;
    insert into profiles (id, username) values (new.id, v_name);
    return new;
end;
$$;

create or replace function username_available(p_username text)
returns boolean
language sql stable security definer set search_path = public as $$
    select not exists (select 1 from profiles where lower(username) = lower(p_username));
$$;

-- ── Question generation ──────────────────────────────────────

create or replace function _rand_factor(lo int, hi int, no_mult int)
returns int
language plpgsql volatile as $$
declare
    n int;
    tries int := 0;
begin
    loop
        n := lo + floor(random() * (hi - lo + 1))::int;
        tries := tries + 1;
        exit when n % no_mult <> 0 or tries >= 100;
    end loop;
    return n;
end;
$$;

-- difficulty: easy | medium | hard | mixed (daily: 40% easy, 40% medium, 20% 101–999)
create or replace function _gen_questions(p_difficulty text, p_count int)
returns jsonb
language plpgsql volatile as $$
declare
    qs   jsonb := '[]'::jsonb;
    lo   int;
    hi   int;
    nm   int;
    roll float8;
begin
    for i in 1..p_count loop
        if p_difficulty = 'mixed' then
            roll := random();
            if    roll < 0.4 then lo := 11;  hi := 49;  nm := 10;
            elsif roll < 0.8 then lo := 51;  hi := 99;  nm := 10;
            else                  lo := 101; hi := 999; nm := 100;
            end if;
        elsif p_difficulty = 'easy'   then lo := 11;  hi := 49;   nm := 10;
        elsif p_difficulty = 'medium' then lo := 51;  hi := 99;   nm := 10;
        elsif p_difficulty = 'hard'   then lo := 101; hi := 3000; nm := 100;
        else
            raise exception 'invalid_difficulty';
        end if;
        qs := qs || jsonb_build_array(jsonb_build_object(
            'a', _rand_factor(lo, hi, nm),
            'b', _rand_factor(lo, hi, nm)));
    end loop;
    return qs;
end;
$$;

revoke execute on function _rand_factor(int, int, int)  from public, anon, authenticated;
revoke execute on function _gen_questions(text, int)    from public, anon, authenticated;

-- ── start_game: classic / sprint ─────────────────────────────

create or replace function start_game(p_mode text, p_difficulty text, p_time_limit int default 60)
returns json
language plpgsql security definer set search_path = public as $$
declare
    uid uuid := auth.uid();
    sid uuid;
    qs  jsonb;
begin
    if uid is null then raise exception 'not_authenticated'; end if;
    if p_mode not in ('classic', 'sprint') then raise exception 'invalid_mode'; end if;
    if p_difficulty not in ('easy', 'medium', 'hard') then raise exception 'invalid_difficulty'; end if;
    if p_mode = 'classic' and p_time_limit not in (30, 60, 90) then raise exception 'invalid_time_limit'; end if;

    -- one running game per user
    delete from game_sessions where user_id = uid and finished_at is null and mode <> 'daily';

    qs := _gen_questions(p_difficulty, case when p_mode = 'sprint' then 10 else 150 end);

    insert into game_sessions (user_id, mode, difficulty, time_limit, questions)
    values (uid, p_mode, p_difficulty, case when p_mode = 'classic' then p_time_limit else 0 end, qs)
    returning id into sid;

    return json_build_object('session_id', sid, 'questions', qs);
end;
$$;

-- ── start_daily: one attempt per user per UTC day ────────────

create or replace function start_daily()
returns json
language plpgsql security definer set search_path = public as $$
declare
    uid   uuid := auth.uid();
    today date := (now() at time zone 'utc')::date;
    sid   uuid;
    qs    jsonb;
begin
    if uid is null then raise exception 'not_authenticated'; end if;

    if not exists (select 1 from daily_challenges where date = today) then
        insert into daily_challenges (date, questions)
        values (today, _gen_questions('mixed', 20))
        on conflict (date) do nothing;
    end if;
    select questions into qs from daily_challenges where date = today;

    -- Starting counts as the attempt: quitting does not allow a retry
    begin
        insert into daily_scores (user_id, date, started_at, completed_at)
        values (uid, today, now(), null);
    exception when unique_violation then
        raise exception 'daily_already_played';
    end;

    insert into game_sessions (user_id, mode, difficulty, time_limit, questions)
    values (uid, 'daily', 'mixed', 0, qs)
    returning id into sid;

    return json_build_object('session_id', sid, 'questions', qs, 'date', today);
end;
$$;

-- ── submit_game: score is recomputed from the answers ────────

create or replace function submit_game(p_session uuid, p_answers int[])
returns json
language plpgsql security definer set search_path = public as $$
declare
    uid       uuid := auth.uid();
    s         game_sessions%rowtype;
    n         int := coalesce(array_length(p_answers, 1), 0);
    q_count   int;
    elapsed   float8;
    q         jsonb;
    v_correct int := 0;
    v_wrong   int := 0;
    v_streak  int := 0;
    v_best    int := 0;
    v_score   int := 0;
    min_sec   float8;
    reject    text;
    p         record;
    today     date := (now() at time zone 'utc')::date;
    old_xp    bigint;
    new_xp    bigint;
    new_streak  int;
    new_longest int;
begin
    if uid is null then raise exception 'not_authenticated'; end if;

    select * into s from game_sessions
     where id = p_session and user_id = uid and finished_at is null
     for update;
    if not found then raise exception 'invalid_session'; end if;

    update game_sessions set finished_at = now() where id = s.id;

    elapsed := extract(epoch from now() - s.started_at);
    q_count := jsonb_array_length(s.questions);

    if n > q_count then
        reject := 'too_many_answers';
    else
        for i in 1..n loop
            q := s.questions -> (i - 1);
            if p_answers[i] = (q->>'a')::int * (q->>'b')::int then
                v_correct := v_correct + 1;
                v_streak  := v_streak + 1;
                v_best    := greatest(v_best, v_streak);
                v_score   := v_score + 10 * (v_streak / 3 + 1);   -- same rules as js/game.js
            else
                v_wrong  := v_wrong + 1;
                v_streak := 0;
            end if;
        end loop;
    end if;

    -- Generous lower bound on seconds per correct answer; only catches bots
    min_sec := case s.difficulty when 'medium' then 1.5 when 'hard' then 2.5 else 1.0 end;

    if reject is null then
        if s.mode = 'classic' then
            if    elapsed < s.time_limit - 3                then reject := 'finished_too_early';
            elsif elapsed > s.time_limit + 10               then reject := 'session_expired';
            elsif v_correct > s.time_limit / min_sec        then reject := 'implausible_speed';
            end if;
        else
            if    n <> q_count                              then reject := 'incomplete';
            elsif elapsed < v_correct * min_sec             then reject := 'implausible_speed';
            elsif elapsed > 3600                            then reject := 'session_expired';
            end if;
        end if;
    end if;

    if reject is not null then
        return json_build_object('ok', false, 'reason', reject);
    end if;

    if s.mode = 'daily' then
        update daily_scores
           set score           = v_score,
               correct         = v_correct,
               wrong           = v_wrong,
               best_streak     = v_best,
               elapsed_seconds = round(elapsed::numeric, 2),
               completed_at    = now()
         where user_id = uid and date = (s.started_at at time zone 'utc')::date;
    else
        insert into scores (user_id, mode, difficulty, time_limit, score, correct, wrong, best_streak, elapsed_seconds)
        values (uid, s.mode, s.difficulty, s.time_limit, v_score, v_correct, v_wrong, v_best,
                case when s.mode = 'sprint' then round(elapsed::numeric, 2) else s.time_limit end);
    end if;

    -- XP + day streak
    select total_xp, current_streak, longest_streak, last_played_date into p
      from profiles where id = uid for update;

    old_xp := coalesce(p.total_xp, 0);
    new_xp := old_xp + v_score;

    if    p.last_played_date = today     then new_streak := greatest(coalesce(p.current_streak, 0), 1);
    elsif p.last_played_date = today - 1 then new_streak := coalesce(p.current_streak, 0) + 1;
    else                                      new_streak := 1;
    end if;
    new_longest := greatest(new_streak, coalesce(p.longest_streak, 0));

    update profiles
       set total_xp = new_xp, current_streak = new_streak,
           longest_streak = new_longest, last_played_date = today
     where id = uid;

    return json_build_object(
        'ok', true,
        'score', v_score, 'correct', v_correct, 'wrong', v_wrong, 'best_streak', v_best,
        'elapsed', round(elapsed::numeric, 2),
        'old_xp', old_xp, 'total_xp', new_xp,
        'current_streak', new_streak, 'longest_streak', new_longest);
end;
$$;

-- ── Leaderboard: best score per player ───────────────────────
-- Sprint only counts perfect runs (10/10), otherwise fast wrong answers win.

create or replace function get_leaderboard(p_mode text, p_difficulty text, p_time_limit int default 60, p_limit int default 25)
returns table (username text, score int, elapsed_seconds float8, correct int, wrong int, best_streak int)
language sql stable set search_path = public as $$
    select pr.username, b.score, b.elapsed_seconds, b.correct, b.wrong, b.best_streak
      from (
        select distinct on (s.user_id)
               s.user_id, s.score, s.elapsed_seconds, s.correct, s.wrong, s.best_streak
          from scores s
         where s.mode = p_mode
           and s.difficulty = p_difficulty
           and (p_mode <> 'classic' or s.time_limit = p_time_limit)
           and (p_mode <> 'sprint'  or s.correct = 10)
         order by s.user_id,
                  case when p_mode = 'sprint' then s.elapsed_seconds else -s.score end,
                  s.created_at
      ) b
      join profiles pr on pr.id = b.user_id
     order by case when p_mode = 'sprint' then b.elapsed_seconds else -b.score end,
              b.elapsed_seconds
     limit least(p_limit, 100);
$$;

-- ── Community questions ──────────────────────────────────────

create or replace function submit_community_question(p_a int, p_b int)
returns void
language plpgsql security definer set search_path = public as $$
declare
    uid     uuid := auth.uid();
    xp      bigint;
    pending int;
begin
    if uid is null then raise exception 'Please sign in first.'; end if;
    if p_a not between 2 and 999 or p_b not between 2 and 999 then
        raise exception 'Both numbers must be between 2 and 999.';
    end if;

    select coalesce(total_xp, 0) into xp from profiles where id = uid;
    if xp < 2500 then raise exception 'You need Silver II (2500 XP) to submit problems.'; end if;

    select count(*) into pending from community_questions where submitted_by = uid and not approved;
    if pending >= 10 then raise exception 'You already have 10 problems waiting for review.'; end if;

    insert into community_questions (submitted_by, question_text, answer, approved)
    values (uid, p_a || ' × ' || p_b, p_a * p_b, false);
end;
$$;

-- ── Permissions ──────────────────────────────────────────────

alter function _rand_factor(int, int, int) set search_path = public;
alter function _gen_questions(text, int)   set search_path = public;

-- Game functions: signed-in players only
revoke execute on function start_game(text, text, int)            from public, anon;
revoke execute on function start_daily()                          from public, anon;
revoke execute on function submit_game(uuid, int[])               from public, anon;
revoke execute on function submit_community_question(int, int)    from public, anon;
grant  execute on function start_game(text, text, int)            to authenticated;
grant  execute on function start_daily()                          to authenticated;
grant  execute on function submit_game(uuid, int[])               to authenticated;
grant  execute on function submit_community_question(int, int)    to authenticated;

-- Trigger function: never callable via the API
revoke execute on function handle_new_user() from public, anon, authenticated;

-- Internal tables: only reachable through the functions above
revoke all on table game_sessions    from anon, authenticated;
revoke all on table daily_challenges from anon, authenticated;

notify pgrst, 'reload schema';
