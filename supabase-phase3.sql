-- ══════════════════════════════════════════════════════════════
--  MathBlitz Phase 3 — Daily challenge + streaks
--  Paste into Supabase → SQL Editor → Run
-- ══════════════════════════════════════════════════════════════

-- ── Streak columns on profiles ────────────────────────────────
alter table profiles add column if not exists current_streak  int  default 0;
alter table profiles add column if not exists longest_streak  int  default 0;
alter table profiles add column if not exists last_played_date date;

-- ── Daily challenge scores ────────────────────────────────────
create table if not exists daily_scores (
    id              uuid default gen_random_uuid() primary key,
    user_id         uuid references profiles(id) on delete cascade not null,
    date            date not null default current_date,
    score           int  not null default 0,
    correct         int  not null default 0,
    wrong           int  not null default 0,
    best_streak     int  not null default 0,
    elapsed_seconds float not null default 0,
    completed_at    timestamptz default now(),
    unique (user_id, date)   -- one attempt per user per day
);

alter table daily_scores enable row level security;
create policy "daily_select" on daily_scores for select using (true);
create policy "daily_insert" on daily_scores for insert with check (auth.uid() = user_id);

create index if not exists idx_daily_date on daily_scores (date, score desc);
