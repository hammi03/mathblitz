-- ══════════════════════════════════════════════════════════════
--  MathBlitz — Supabase schema
--  Paste this entire file into Supabase → SQL Editor → Run
-- ══════════════════════════════════════════════════════════════

-- ── Profiles (public user data) ───────────────────────────────
create table if not exists profiles (
    id          uuid references auth.users on delete cascade primary key,
    username    text unique not null,
    created_at  timestamptz default now()
);

-- ── Scores ────────────────────────────────────────────────────
create table if not exists scores (
    id              uuid default gen_random_uuid() primary key,
    user_id         uuid references profiles(id) on delete cascade not null,
    mode            text not null check (mode in ('classic', 'sprint', 'zen')),
    difficulty      text not null check (difficulty in ('easy', 'medium', 'hard')),
    time_limit      int  not null default 60,
    score           int  not null default 0,
    correct         int  not null default 0,
    wrong           int  not null default 0,
    best_streak     int  not null default 0,
    elapsed_seconds float not null default 0,
    created_at      timestamptz default now()
);

-- ── Row Level Security ────────────────────────────────────────
alter table profiles enable row level security;
alter table scores   enable row level security;

-- Profiles: anyone can read, only owner can write
create policy "profiles_select" on profiles for select using (true);
create policy "profiles_insert" on profiles for insert with check (auth.uid() = id);
create policy "profiles_update" on profiles for update using (auth.uid() = id);

-- Scores: anyone can read, only owner can insert
create policy "scores_select" on scores for select using (true);
create policy "scores_insert" on scores for insert with check (auth.uid() = user_id);

-- ── Indexes for leaderboard queries ──────────────────────────
create index if not exists idx_scores_classic
    on scores (mode, difficulty, time_limit, score desc)
    where mode = 'classic';

create index if not exists idx_scores_sprint
    on scores (mode, difficulty, elapsed_seconds asc)
    where mode = 'sprint';

create index if not exists idx_scores_zen
    on scores (mode, difficulty, score desc)
    where mode = 'zen';

create index if not exists idx_scores_user
    on scores (user_id);

-- ── Auto-create profile on signup ────────────────────────────
create or replace function handle_new_user()
returns trigger as $$
begin
    insert into public.profiles (id, username)
    values (new.id, coalesce(new.raw_user_meta_data->>'username', 'player_' || substr(new.id::text, 1, 6)));
    return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
    after insert on auth.users
    for each row execute procedure handle_new_user();
