-- ============================================================
-- ピピンの世界 - Supabase Schema
-- Run this in your Supabase SQL editor to set up the database
-- ============================================================

-- Participants: users who join with their wallet
CREATE TABLE participants (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  wallet_address TEXT UNIQUE NOT NULL,
  display_name TEXT DEFAULT 'anonymous',
  tasks_completed INT DEFAULT 0,
  total_happiness_contributed INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tasks: jobs Pippin gives to the community
CREATE TABLE tasks (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  participant_id UUID REFERENCES participants(id),
  task_type TEXT NOT NULL,          -- 'draw', 'chat', 'dance', 'explore', 'compliment', 'haiku', 'story'
  task_prompt TEXT NOT NULL,         -- what Pippin asked them to do
  task_response TEXT,                -- text response or drawing data URL
  completed BOOLEAN DEFAULT FALSE,
  happiness_reward INT DEFAULT 10,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- Drawings: stored separately for gallery
CREATE TABLE drawings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  participant_id UUID REFERENCES participants(id),
  task_id UUID REFERENCES tasks(id),
  image_data TEXT NOT NULL,          -- base64 data URL from canvas
  prompt TEXT NOT NULL,              -- what Pippin asked them to draw
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Global state: happiness meter, timer, current life
CREATE TABLE global_state (
  id INT PRIMARY KEY DEFAULT 1,
  happiness INT DEFAULT 50,          -- 0-100
  current_life INT DEFAULT 1,
  timer_end TIMESTAMPTZ,
  timer_duration_minutes INT DEFAULT 60,
  total_tasks_completed INT DEFAULT 0,
  last_winner_wallet TEXT,
  last_winner_name TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Initialize global state
INSERT INTO global_state (id, happiness, current_life, timer_end, timer_duration_minutes)
VALUES (1, 50, 1, NOW() + INTERVAL '60 minutes', 60)
ON CONFLICT (id) DO NOTHING;

-- Raffle entries: one entry per task completed
CREATE TABLE raffle_entries (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  participant_id UUID REFERENCES participants(id),
  wallet_address TEXT NOT NULL,
  life_number INT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE drawings ENABLE ROW LEVEL SECURITY;
ALTER TABLE global_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE raffle_entries ENABLE ROW LEVEL SECURITY;

-- Public read/write policies (since we use anon key through server proxy)
CREATE POLICY "Allow all" ON participants FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON tasks FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON drawings FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON global_state FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON raffle_entries FOR ALL USING (true) WITH CHECK (true);
