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
  likes INT DEFAULT 0,              -- community likes/hearts
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- If table already exists, add likes column:
-- ALTER TABLE drawings ADD COLUMN IF NOT EXISTS likes INT DEFAULT 0;

-- Global state: happiness meter, timer, current life
CREATE TABLE global_state (
  id INT PRIMARY KEY DEFAULT 1,
  happiness INT DEFAULT 0,           -- 0-100, starts unhappy!
  current_life INT DEFAULT 1,
  timer_end TIMESTAMPTZ,
  timer_duration_minutes INT DEFAULT 30,  -- Life 1: 30min, 2: 60m, 3: 120m, 4: 240m, 5: 480m, 6: 960m, 7: 1920m
  total_tasks_completed INT DEFAULT 0,
  last_winner_wallet TEXT,
  last_winner_name TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Initialize global state
INSERT INTO global_state (id, happiness, current_life, timer_end, timer_duration_minutes)
VALUES (1, 0, 1, NOW() + INTERVAL '30 minutes', 30)
ON CONFLICT (id) DO NOTHING;

-- To reset an existing game to Life #1 with correct values, run:
-- UPDATE global_state SET happiness = 0, current_life = 1, timer_end = NOW() + INTERVAL '30 minutes', timer_duration_minutes = 30 WHERE id = 1;

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
