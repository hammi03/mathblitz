-- ── MathBlitz: Ranks + Community Questions ────────────────────────────────
-- Run this in the Supabase SQL Editor after the existing schema is set up.

-- 1. Add total_xp to profiles (cumulative XP across all modes)
ALTER TABLE profiles
    ADD COLUMN IF NOT EXISTS total_xp bigint DEFAULT 0;

-- 2. Community questions table
CREATE TABLE IF NOT EXISTS community_questions (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    submitted_by  uuid REFERENCES profiles(id) ON DELETE SET NULL,
    question_text text    NOT NULL,   -- e.g. "47 × 83"
    answer        integer NOT NULL,
    approved      boolean NOT NULL DEFAULT false,
    created_at    timestamptz NOT NULL DEFAULT now()
);

-- Index for fast lookup of approved questions
CREATE INDEX IF NOT EXISTS idx_community_questions_approved
    ON community_questions (approved, created_at DESC);

-- Row Level Security
ALTER TABLE community_questions ENABLE ROW LEVEL SECURITY;

-- Anyone can read approved questions
CREATE POLICY "read approved questions"
    ON community_questions FOR SELECT
    USING (approved = true);

-- Logged-in users can insert (pending review)
CREATE POLICY "submit question"
    ON community_questions FOR INSERT
    WITH CHECK (auth.uid() = submitted_by);
