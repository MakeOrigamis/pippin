# Pippin's World

An interactive 3D experience featuring Pippin, a kawaii AI unicorn in a magical dimension. Built on the [Pippin Framework](https://pippin.love) for autonomous AI agents.

**Live:** [pippingroundhog.com](https://pippingroundhog.com)
**Ticker:** $PORLD
**CA (Solana):** `GdEAjEov4jF1v1tq4cnBJWsK4rbr8ZFs8GojWQmvpump`
**Community:** [X Community](https://x.com/i/communities/2022496056731369614)

---

## What is this?

Pippin is a kawaii unicorn lost in a strange dimension — a psychedelic river, dancing mushrooms, and an endless time loop. The community works together to make Pippin happy before the timer runs out. Each "life" gets harder, rewards get bigger, and Pippin remembers everything.

## How it works

1. **Enter the world** — move Pippin with WASD, fly with Space/Shift
2. **Register your SOL wallet** — connect and pick a display name
3. **Complete tasks** — Pippin asks you to draw, write haiku, tell stories, share opinions, answer trivia, and more
4. **Every task is AI-verified** — BabyAGI3 judges your submissions (drawings via vision, text via reasoning). Low effort = rejected. Difficulty scales with each life.
5. **Raise happiness** — each approved task fills Pippin's happiness bar and earns you a raffle entry
6. **Group puzzles** — 8 types of collaborative challenges that rotate automatically:
   - Collaborative Drawing (4 players draw one scene)
   - Exquisite Corpse (head/body/legs drawn blind)
   - Research Missions (find real facts, AI-verified)
   - Riddles & Math Puzzles
   - Debates (share real opinions with reasoning)
   - Trivia Challenges (geography, science, crypto, etc.)
   - Collaborative Stories
   - Word Chains & Caption Contests
7. **When the timer hits zero** — a winner is drawn from all raffle entries and wins SOL
8. **New life begins** — timer doubles, happiness resets, difficulty increases. Repeat forever.

## Features

- **3D World** — Three.js scene with GLTF models, particle effects, and animated characters
- **AI Chat** — Talk to Pippin in the global chat. Mention @pippin and it responds in character (Japanese-accented English)
- **AI Task Verification** — Every submission judged by BabyAGI3 with difficulty scaling per life
- **AI Drawing Reactions** — Pippin "sees" your drawings via vision API and comments on them
- **Global Chat** — Real-time chat with other players, activity feed, 6-minute auto-cleanup with archive
- **Drawing Canvas** — Full-featured: 17 colors, 5 brush sizes, 3 brush types (round/square/spray), eraser, undo (30 steps)
- **Player Profiles** — Click any name to see stats: tasks, drawings, likes, happiness, puzzles, chat messages, per-life breakdown
- **Leaderboard** — "This Life" and "All Time" views with full stats
- **Sound Effects** — Synthesized audio for task completion, likes, rejection, and sad Pippin
- **Speech** — ElevenLabs TTS with Japanese voice, toggle between JP and English
- **Mobile/iPad Optimized** — Responsive layout with touch joystick and collapsible panels
- **Share on X** — One-click share drawings with CA and task prompt

## Tech Stack

| Layer | Tech |
|-------|------|
| 3D Engine | Three.js (GLTFLoader, FBXLoader, AnimationMixer, OrbitControls) |
| AI Brain | Anthropic BabyAGI3 (chat, task verification, vision, puzzle judging) |
| Voice | ElevenLabs TTS API |
| Backend | Node.js HTTP server (proxy, API, static files) |
| Database | Supabase (PostgreSQL + Row Level Security) |
| Hosting | Railway |
| Assets | GitHub Releases CDN |
| Framework | [Pippin Framework](https://pippin.love) |

## Architecture

```
Client (pippin3d.html)
  ├── Three.js 3D scene (landscape + characters + unicorn)
  ├── Drawing canvas (HTML5 Canvas API)
  ├── Global chat (polling)
  ├── Group puzzles (8 types, AI-verified)
  └── Player profiles & leaderboard

Server (server.js)
  ├── API proxy (Anthropic, ElevenLabs)
  ├── Task verification (AI judge with difficulty scaling)
  ├── Puzzle management (rotation, contributions, rewards)
  ├── Chat (6min window + archive)
  ├── Raffle system (entries, winner draw)
  └── Static file serving

Database (Supabase)
  ├── participants (wallet, name)
  ├── tasks (type, prompt, response, happiness_reward)
  ├── drawings (image_data, likes)
  ├── global_state (happiness, timer, current_life)
  ├── raffle_entries (per-life)
  ├── chat_messages (6min live + archive)
  └── group_puzzles (type, contributions JSONB)
```

## Running Locally

```bash
# Install dependencies
npm install

# Set environment variables
export ANTHROPIC_API_KEY=your_key
export ELEVEN_API_KEY=your_key
export SUPABASE_URL=your_url
export SUPABASE_KEY=your_key
export ADMIN_KEY=your_admin_key

# Run the Supabase schema (supabase-schema.sql) in your Supabase SQL editor

# Start the server
node server.js
# Open http://localhost:3000
```

## Task Types (513 unique prompts)

Draw, Haiku, Story, Compliment, Dance, Explore, Trivia, Joke, Wish, Opinion — across 10 categories with Japanese/English bilingual prompts.

## Group Puzzle Types (8 rotating)

1. **Collab Drawing** — 2x2 grid, each person draws one section
2. **Exquisite Corpse** — head/body/legs drawn without seeing others
3. **Research Missions** — find facts about space, crypto, mythology, animals, inventions
4. **Riddles & Math** — logic puzzles, equations, code ciphers
5. **Debates** — share opinions on real topics, AI checks for reasoning
6. **Trivia** — geography, science, pop culture, tech, food, crypto
7. **Word Chain** — each word starts with the last letter of the previous
8. **Caption Contest** — funniest caption for a Pippin scenario

All non-drawing puzzle contributions are AI-verified by BabyAGI3.

## The Time Loop

| Life | Timer | Difficulty |
|------|-------|------------|
| 1 | 30 min | Lenient — any genuine attempt passes |
| 2 | 1 hour | Lenient |
| 3 | 2 hours | Moderate — must match prompt |
| 4 | 4 hours | Moderate |
| 5 | 8 hours | Strict — real effort required |
| 6 | 16 hours | Strict |
| 7+ | 32 hours | Strict |

Happiness reward per task also scales down with each life, requiring more community effort to fill the bar.

## License

MIT

---

*Built with the [Pippin Framework](https://pippin.love) — open-source autonomous AI agents.*
