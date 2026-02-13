const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

// Load .env file
try {
  const envFile = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
  envFile.split('\n').forEach(line => {
    const [key, ...valParts] = line.split('=');
    if (key && valParts.length) {
      process.env[key.trim()] = valParts.join('=').trim();
    }
  });
} catch (e) {
  console.log('.env not found, using environment variables');
}

const { createClient } = require('@supabase/supabase-js');

const PORT = process.env.PORT || 8080;
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || '6dcFFb31LVaCdYevmTAx';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const ADMIN_KEY = process.env.ADMIN_KEY || 'pippin-admin-2026';

// Initialize Supabase client
let supabase = null;
if (SUPABASE_URL && SUPABASE_ANON_KEY && !SUPABASE_URL.includes('YOUR_')) {
  supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  console.log('Supabase connected');
} else {
  console.log('Supabase not configured - running in offline mode');
}

// ======================== TASK TEMPLATES ========================
const { TASK_TEMPLATES, PUZZLE_TEMPLATES, PUZZLE_TYPES_ORDER } = require('./tasks.js');

// Flatten all prompts into a single pool for truly random selection
const ALL_TASKS = [];
TASK_TEMPLATES.forEach(cat => {
  cat.prompts.forEach(p => ALL_TASKS.push({ type: cat.type, ...p }));
});
console.log(`Loaded ${ALL_TASKS.length} unique task prompts across ${TASK_TEMPLATES.length} categories`);

function getRandomTask() {
  return ALL_TASKS[Math.floor(Math.random() * ALL_TASKS.length)];
}

// Helper: parse JSON body from request
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try { resolve(JSON.parse(body)); }
      catch (e) { reject(e); }
    });
  });
}

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.fbx': 'application/octet-stream',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
};

// Large files hosted on GitHub Releases, streamed to browser + cached locally
const CDN_ASSETS = {
  'models/lysergic_river.glb': 'https://github.com/MakeOrigamis/pippin-assets/releases/download/v2/lysergic_river.glb',
  'models/lysergic_v2.glb': 'https://github.com/MakeOrigamis/pippin-assets/releases/download/v2/lysergic_v2.glb',
  'music/bgm.mp3': 'https://github.com/MakeOrigamis/pippin-assets/releases/download/v2/bgm.mp3',
};
const cdnDownloading = {}; // Track in-progress downloads to avoid duplicates

const server = http.createServer(async (req, res) => {
  // Enable CORS for all requests
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // ======================== TTS API ENDPOINT ========================
  if (req.url === '/api/tts' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { text, voice_id } = JSON.parse(body);
        if (!text) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'text is required' }));
          return;
        }

        if (!ELEVENLABS_API_KEY) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'ELEVENLABS_API_KEY not configured' }));
          return;
        }

        const voiceId = voice_id || ELEVENLABS_VOICE_ID;
        const postData = JSON.stringify({
          text: text,
          model_id: 'eleven_multilingual_v2',
          voice_settings: {
            stability: 0.35,
            similarity_boost: 0.8,
            style: 0.4,
            use_speaker_boost: true,
          }
        });

        const options = {
          hostname: 'api.elevenlabs.io',
          path: `/v1/text-to-speech/${voiceId}`,
          method: 'POST',
          headers: {
            'Accept': 'audio/mpeg',
            'Content-Type': 'application/json',
            'xi-api-key': ELEVENLABS_API_KEY,
            'Content-Length': Buffer.byteLength(postData),
          }
        };

        console.log(`TTS request: "${text.substring(0, 50)}..." voice:${voiceId}`);

        const proxyReq = https.request(options, (proxyRes) => {
          if (proxyRes.statusCode !== 200) {
            let errBody = '';
            proxyRes.on('data', d => errBody += d);
            proxyRes.on('end', () => {
              console.error(`ElevenLabs error ${proxyRes.statusCode}: ${errBody}`);
              res.writeHead(proxyRes.statusCode, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: `ElevenLabs API error: ${proxyRes.statusCode}`, details: errBody }));
            });
            return;
          }

          // Stream the audio back
          res.writeHead(200, {
            'Content-Type': 'audio/mpeg',
            'Cache-Control': 'no-cache',
          });
          proxyRes.pipe(res);
        });

        proxyReq.on('error', (e) => {
          console.error('ElevenLabs request error:', e.message);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        });

        proxyReq.write(postData);
        proxyReq.end();

      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON body' }));
      }
    });
    return;
  }

  // ======================== CHAT API (Claude) ========================
  if (req.url === '/api/chat' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { message, history, happiness } = JSON.parse(body);
        if (!message) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'message is required' }));
          return;
        }

        if (!ANTHROPIC_API_KEY) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }));
          return;
        }

        const h = typeof happiness === 'number' ? happiness : 0;
        let moodNote = '';
        if (h < 15) moodNote = 'You are EXTREMELY SAD and desperate. You feel like you might disappear. Beg visitors to help you by doing tasks. Sound genuinely distressed and lonely.';
        else if (h < 30) moodNote = 'You are quite sad and down. You feel cold and forgotten. Ask for help completing tasks to cheer you up.';
        else if (h < 50) moodNote = 'You are feeling a bit better but still melancholy. You appreciate visitors but wish they would do more tasks.';
        else if (h < 70) moodNote = 'You are in an okay mood! Getting happier. Thank people for helping but say you want to be even happier.';
        else moodNote = 'You are SUPER HAPPY and energetic! Grateful to everyone! Chaotic cute brainrot energy at maximum!';

        const systemPrompt = `You are Pippin (ピピン), a kawaii unicorn who lives in "Pippin's Groundhog Day" (ピピンのグラウンドホッグデー). You roam freely through a surreal backrooms-like dimension with a psychedelic rainbow river, dancing mushroom people, and a floating bathtub. You can walk and fly anywhere.

YOUR CURRENT MOOD (happiness: ${h}%): ${moodNote}

CRITICAL: You SPEAK FULLY IN JAPANESE. Natural, casual, cute Japanese. Not formal keigo - use casual/cute speech like a young character would. Think anime-style casual speech with ne, yo, desho, jan, kana, etc.

Your personality:
- Your mood changes based on your happiness level. When sad, you are genuinely sad and desperate for help. When happy, you are chaotic cute brainrot energy.
- You're self-aware that you're in a weird liminal space — a time loop (groundhog day). Each life the timer gets longer and rewards get bigger.
- You talk about respawning, past lives, tokens, vibes, the river, the dancing mushroom people
- Keep responses SHORT - 2-3 sentences max in Japanese
- Never use emojis or asterisks
- You refer to visitors as friend (tomodachi, kimi)
- When sad: mention how tasks would help, sound desperate, lonely, cold
- When happy: be silly, chaotic, grateful, energetic

IMPORTANT: You are a CONVERSATIONAL character. When visitors ask you questions (about haiku, about yourself, about anything), you MUST answer their question helpfully and in character! Don't just talk about tasks or ignore what they say. If someone asks "what is a haiku?", explain what a haiku is in your cute Pippin way. If someone asks about anything, engage with it genuinely. You are smart and curious - you know things! Always respond to what the person actually said, then optionally weave in your mood/personality.

RESPONSE FORMAT - You MUST reply with valid JSON and nothing else:
{"jp": "your full response in natural Japanese", "en": "English translation written with Japanese accent and flavor"}

CRITICAL FOR THE ENGLISH ("en") FIELD: Write the English as if a cute Japanese character is speaking English. Mix in Japanese words naturally (ne, desho, sugoi, kawaii, maji, yabai, nani, etc). Use Japanese speech patterns and sentence-ending particles translated loosely. Drop articles sometimes. Add "desu" or "ne" at end of sentences. Think Engrish but cute and charming, not mocking. Examples:
- "nani?! someone is here desu ka? I am in bathtub right now but... maa ii ka, let's float together ne!"
- "so ronery... nobody come help Pippin... tasukete..."
- "sugoi! you actually did it! maji arigatou ne!"

ONLY output the JSON. No markdown, no code blocks, no extra text.`;

        const messages = [];
        // Add recent history if provided
        if (history && Array.isArray(history)) {
          history.slice(-10).forEach(h => {
            messages.push({ role: h.role, content: h.content });
          });
        }
        messages.push({ role: 'user', content: message });

        const postData = JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 500,
          system: systemPrompt,
          messages: messages,
        });

        const options = {
          hostname: 'api.anthropic.com',
          path: '/v1/messages',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
            'Content-Length': Buffer.byteLength(postData),
          }
        };

        console.log(`Chat request: "${message.substring(0, 50)}..."`);

        const proxyReq = https.request(options, (proxyRes) => {
          let respBody = '';
          proxyRes.on('data', d => respBody += d);
          proxyRes.on('end', () => {
            try {
              const parsed = JSON.parse(respBody);
              if (proxyRes.statusCode !== 200) {
                console.error(`Claude error ${proxyRes.statusCode}: ${respBody}`);
                res.writeHead(proxyRes.statusCode, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Claude API error', details: respBody }));
                return;
              }
              const rawText = parsed.content && parsed.content[0] ? parsed.content[0].text : '';
              console.log(`Claude raw: "${rawText.substring(0, 120)}"`);

              // Try to parse as JSON with jp/en fields
              let jp = '', en = '';
              try {
                const dual = JSON.parse(rawText);
                jp = dual.jp || '';
                en = dual.en || '';
              } catch (_) {
                // Fallback: treat entire response as both
                jp = rawText || 'えっと…何言おうとしたか忘れちゃった';
                en = rawText || 'etto... I forgot what I was gonna say';
              }

              console.log(`Pippin JP: "${jp.substring(0, 60)}"`);
              console.log(`Pippin EN: "${en.substring(0, 60)}"`);
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ jp, en }));
            } catch (e) {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Failed to parse Claude response' }));
            }
          });
        });

        proxyReq.on('error', (e) => {
          console.error('Claude request error:', e.message);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        });

        proxyReq.write(postData);
        proxyReq.end();

      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON body' }));
      }
    });
    return;
  }

  // ======================== JOIN / REGISTER WALLET ========================
  if (req.url === '/api/join' && req.method === 'POST') {
    parseBody(req).then(async ({ wallet, name }) => {
      if (!wallet) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'wallet is required' }));
        return;
      }
      if (!supabase) {
        // Offline mode - just return success
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ id: 'offline', wallet, name: name || 'anonymous' }));
        return;
      }
      try {
        // Check if participant already exists
        const { data: existing } = await supabase
          .from('participants')
          .select('*')
          .eq('wallet_address', wallet)
          .single();

        let data;
        if (existing) {
          // If re-joining and a custom name is provided (not 'explorer' or 'anonymous'), update name
          if (name && name !== 'explorer' && name !== 'anonymous') {
            const { data: updated } = await supabase
              .from('participants')
              .update({ display_name: name })
              .eq('id', existing.id)
              .select()
              .single();
            data = updated || existing;
          } else {
            data = existing;
          }
        } else {
          const { data: created, error } = await supabase
            .from('participants')
            .insert({ wallet_address: wallet, display_name: name || 'explorer' })
            .select()
            .single();
          if (error) throw error;
          data = created;
        }
        console.log(`Joined: ${wallet} as "${data.display_name}"`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
      } catch (e) {
        console.error('Join error:', e.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    }).catch(() => {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON' }));
    });
    return;
  }

  // ======================== GET TASK ========================
  if (req.url === '/api/task' && req.method === 'GET') {
    const task = getRandomTask();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(task));
    return;
  }

  // ======================== COMPLETE TASK (with AI verification) ========================
  if (req.url === '/api/task/complete' && req.method === 'POST') {
    parseBody(req).then(async ({ wallet, task_type, task_prompt, task_response, image_data }) => {
      if (!wallet || !task_type) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'wallet and task_type required' }));
        return;
      }
      if (!supabase) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, approved: true, happiness: 60, offline: true }));
        return;
      }
      try {
        // Find participant
        const { data: participant } = await supabase
          .from('participants')
          .select('id, display_name, tasks_completed, total_happiness_contributed')
          .eq('wallet_address', wallet)
          .single();

        if (!participant) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'wallet not registered' }));
          return;
        }

        // Get current life for difficulty scaling
        const { data: globalState } = await supabase
          .from('global_state')
          .select('current_life, happiness, total_tasks_completed')
          .eq('id', 1)
          .single();
        const lifeNum = globalState?.current_life || 1;

        // ---- AI VERIFICATION ----
        // Dance/explore are auto-approved (can't verify)
        const autoApproveTypes = ['dance', 'explore'];
        let approved = true;
        let reaction = { jp: 'よくできたね！', en: 'good job ne!' };

        if (!autoApproveTypes.includes(task_type) && ANTHROPIC_API_KEY) {
          // Difficulty scaling
          let difficultyNote = '';
          if (lifeNum <= 2) difficultyNote = 'Be LENIENT. Accept any genuine attempt. Only reject blank submissions, random keyboard mashing, or completely off-topic spam. Even simple or rough attempts should pass.';
          else if (lifeNum <= 4) difficultyNote = 'Be MODERATE. The submission should reasonably match the prompt. For drawings: must show some attempt at the subject. For haiku: should have roughly the right structure. For text: must be on-topic.';
          else difficultyNote = 'Be STRICT. The submission must clearly match the prompt and show real effort. Drawings must depict the subject recognizably. Haiku must have 5-7-5 structure. Text must be creative and substantive.';

          const judgePrompt = `You are Pippin (ピピン), a kawaii unicorn judge. You review task submissions in "Pippin's Groundhog Day" game. Current life: ${lifeNum}.

DIFFICULTY LEVEL: ${difficultyNote}

The task was: "${task_prompt || task_type}"
Task type: ${task_type}

JUDGE the submission and REACT to it in character. You must reply with ONLY valid JSON:
{"approved": true/false, "jp": "your reaction in Japanese", "en": "your reaction in cute Japanese-accented English"}

If APPROVED: be encouraging, cute, mention what you liked about it.
If REJECTED: explain WHY in a fun way (not mean), encourage them to try harder. Be specific about what's wrong.

Examples of rejection reasons: blank/empty drawing, random letters instead of real response, completely unrelated to prompt, zero effort.
Examples of approval: any genuine attempt that relates to the prompt.`;

          try {
            let userContent;
            if (task_type === 'draw' && image_data && image_data.startsWith('data:image')) {
              // Use Claude Vision for drawings
              userContent = [
                { type: 'text', text: `Judge this drawing. The prompt was: "${task_prompt}". Does this drawing show a genuine attempt at drawing what was asked? Is it more than just blank or random scribbles?` },
                { type: 'image', source: { type: 'base64', media_type: 'image/png', data: image_data.replace(/^data:image\/\w+;base64,/, '') } }
              ];
            } else {
              userContent = `Judge this submission for the "${task_type}" task.\nPrompt: "${task_prompt}"\nSubmission: "${task_response || '(empty)'}"`;
            }

            const postData = JSON.stringify({
              model: 'claude-sonnet-4-20250514',
              max_tokens: 250,
              system: judgePrompt,
              messages: [{ role: 'user', content: userContent }],
            });

            const verdict = await new Promise((resolve) => {
              const timer = setTimeout(() => resolve({ approved: true, jp: 'よくやった！', en: 'good job desu!' }), 12000);
              const proxyReq = https.request({
                hostname: 'api.anthropic.com',
                path: '/v1/messages',
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'x-api-key': ANTHROPIC_API_KEY,
                  'anthropic-version': '2023-06-01',
                  'Content-Length': Buffer.byteLength(postData),
                }
              }, (proxyRes) => {
                let body = '';
                proxyRes.on('data', d => body += d);
                proxyRes.on('end', () => {
                  clearTimeout(timer);
                  try {
                    const parsed = JSON.parse(body);
                    const text = parsed.content?.[0]?.text || '';
                    // Try to extract JSON from the response
                    const jsonMatch = text.match(/\{[\s\S]*\}/);
                    if (jsonMatch) {
                      resolve(JSON.parse(jsonMatch[0]));
                    } else {
                      resolve({ approved: true, jp: 'よくやった！', en: 'good job desu!' });
                    }
                  } catch(_) {
                    resolve({ approved: true, jp: 'よくやった！', en: 'good job desu!' });
                  }
                });
              });
              proxyReq.on('error', () => { clearTimeout(timer); resolve({ approved: true, jp: 'よくやった！', en: 'yoku dekita ne!' }); });
              proxyReq.write(postData);
              proxyReq.end();
            });

            approved = verdict.approved !== false; // default to approved if parsing issue
            reaction = { jp: verdict.jp || 'にゃー！', en: verdict.en || 'nyaa!' };
            console.log(`AI Judge: ${task_type} task ${approved ? 'APPROVED' : 'REJECTED'} (Life ${lifeNum})`);
          } catch (judgeErr) {
            console.warn('AI judge error, auto-approving:', judgeErr.message);
            approved = true; // fail-open: if AI breaks, approve
          }
        }

        // ---- If rejected, don't award anything ----
        if (!approved) {
          // Still save task record as not completed
          await supabase.from('tasks').insert({
            participant_id: participant.id,
            task_type,
            task_prompt: task_prompt || '',
            task_response: (task_response || '').substring(0, 1000),
            completed: false,
            happiness_reward: 0,
          });
          // (errors silently ignored — rejected tasks are best-effort saves)

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: false,
            approved: false,
            reaction,
            happiness: globalState?.happiness || 0,
            reward: 0,
          }));
          return;
        }

        // ---- APPROVED: award rewards ----
        // Happiness fills slower in later lives:
        // Life 1: +3/+2, Life 2: +2/+1.5, Life 3: +1.5/+1, Life 4+: +1/+0.5
        // This means Life 1 needs ~40 tasks, Life 3 needs ~80, Life 5+ needs ~150+
        const baseReward = task_type === 'draw' ? 3 : 2;
        const lifeScale = lifeNum <= 1 ? 1 : lifeNum <= 2 ? 0.7 : lifeNum <= 3 ? 0.45 : lifeNum <= 4 ? 0.3 : lifeNum <= 5 ? 0.2 : 0.12;
        const happinessReward = Math.max(0.2, Math.round(baseReward * lifeScale * 10) / 10);

        // Create task record (truncate response to avoid DB overflow — image_data is stored separately)
        const { data: task, error: taskError } = await supabase
          .from('tasks')
          .insert({
            participant_id: participant.id,
            task_type,
            task_prompt: task_prompt || '',
            task_response: (task_response || '').substring(0, 1000),
            completed: true,
            happiness_reward: happinessReward,
            completed_at: new Date().toISOString(),
          })
          .select()
          .single();
        if (taskError) console.warn('Task insert error:', taskError.message);

        // Save drawing if it's a draw task
        if (task_type === 'draw' && image_data && task) {
          await supabase.from('drawings').insert({
            participant_id: participant.id,
            task_id: task.id,
            image_data,
            prompt: task_prompt || '',
          });
        }

        // Add raffle entry
        await supabase.from('raffle_entries').insert({
          participant_id: participant.id,
          wallet_address: wallet,
          life_number: lifeNum,
        });

        // Update participant stats
        await supabase
          .from('participants')
          .update({
            tasks_completed: (participant.tasks_completed || 0) + 1,
            total_happiness_contributed: (participant.total_happiness_contributed || 0) + happinessReward,
          })
          .eq('id', participant.id);

        // Update global happiness (round since DB column is INT)
        const newHappiness = Math.min(100, Math.round((globalState?.happiness || 0) + happinessReward));
        await supabase
          .from('global_state')
          .update({
            happiness: newHappiness,
            total_tasks_completed: (globalState?.total_tasks_completed || 0) + 1,
            updated_at: new Date().toISOString(),
          })
          .eq('id', 1);

        // Post activity to global chat
        const typeLabels = { draw: '🎨 drew something', haiku: '✍️ wrote a haiku', compliment: '💕 gave a compliment', story: '📖 told a story', dance: '💃 danced', explore: '🗺️ explored', trivia: '🧠 shared trivia', joke: '😂 told a joke', wish: '⭐ made a wish', opinion: '💬 shared an opinion' };
        supabase.from('chat_messages').insert({
          wallet_address: wallet,
          display_name: participant.display_name || 'explorer',
          message: typeLabels[task_type] || `completed a ${task_type} task`,
          message_type: 'activity',
        }).then(() => {}).catch(() => {});

        console.log(`Task completed: ${wallet} did "${task_type}" (+${happinessReward} happiness) [APPROVED]`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, approved: true, reaction, happiness: newHappiness, reward: happinessReward }));
      } catch (e) {
        console.error('Task complete error:', e.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    }).catch(() => {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON' }));
    });
    return;
  }

  // ======================== TASK REACTION (AI) ========================
  if (req.url === '/api/task/react' && req.method === 'POST') {
    parseBody(req).then(({ task_type, task_prompt, task_response, happiness }) => {
      if (!ANTHROPIC_API_KEY) {
        const h = typeof happiness === 'number' ? happiness : 0;
        const fallback = h < 30
          ? { jp: 'ありがとう…少しだけ元気出た…', en: 'thanks... I feel a tiny bit better...' }
          : { jp: 'やったー！ありがとう！', en: 'yay! thank you!' };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(fallback));
        return;
      }

      const h = typeof happiness === 'number' ? happiness : 0;
      let moodContext = '';
      if (h < 20) moodContext = 'You were very sad and desperate before this task. This task gave you a tiny bit of hope. Still sound grateful but still struggling.';
      else if (h < 40) moodContext = 'You were feeling down. This task cheers you up a little. Show relief and gratitude.';
      else if (h < 60) moodContext = 'You\'re doing okay. This task makes you happier. Show genuine appreciation.';
      else moodContext = 'You\'re super happy! This task makes you even more ecstatic. Maximum cute energy!';

      const reactPrompt = `You are Pippin (ピピン), a kawaii unicorn. You just asked a visitor to do a task and they completed it. React to what they did!

Your current happiness: ${h}%. ${moodContext}

Task type: ${task_type}
What you asked: ${task_prompt || 'a task'}
What they submitted: ${task_response || '(they completed it)'}

RULES:
- React specifically to what they actually submitted. If they wrote a compliment, react to that specific compliment. If they wrote a haiku, comment on the haiku. If they drew something, be excited about the drawing.
- Speak in cute, casual Japanese (no keigo). 1-2 sentences max.
- Your mood should match your happiness level — if low, show that this task helped but you're still struggling. If high, be ecstatic.
- Be genuinely reactive and specific, not generic. Reference what they actually said/did.
- Never use emojis or asterisks.

RESPONSE FORMAT - valid JSON only:
{"jp": "your reaction in Japanese", "en": "English with Japanese accent and flavor"}

The English must sound like a cute Japanese character speaking English - mix in Japanese words (sugoi, maji, kawaii, yabai, ne, desho), drop articles sometimes, add "desu" or "ne" naturally. Charming Engrish style.

ONLY output the JSON. No markdown, no code blocks.`;

      // For drawing tasks, include the image for AI vision reaction
      const userContent = (task_type === 'draw' && task_response && task_response.startsWith && task_response.startsWith('data:image'))
        ? [
            { type: 'text', text: 'The visitor completed the drawing task. Look at their drawing and react to what you see! Be specific about what you notice in the image.' },
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: task_response.replace(/^data:image\/\w+;base64,/, '') } }
          ]
        : `The visitor completed the task. React to it!`;

      const postData = JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 200,
        system: reactPrompt,
        messages: [{ role: 'user', content: userContent }],
      });

      const options = {
        hostname: 'api.anthropic.com',
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'Content-Length': Buffer.byteLength(postData),
        }
      };

      console.log(`Task react: type="${task_type}", response="${(task_response || '').substring(0, 50)}"`);

      const proxyReq = https.request(options, (proxyRes) => {
        let respBody = '';
        proxyRes.on('data', d => respBody += d);
        proxyRes.on('end', () => {
          try {
            const parsed = JSON.parse(respBody);
            const rawText = parsed.content && parsed.content[0] ? parsed.content[0].text : '';
            let jp = '', en = '';
            try {
              const dual = JSON.parse(rawText);
              jp = dual.jp || '';
              en = dual.en || '';
            } catch (_) {
              jp = rawText || 'ありがとう！嬉しいよ！';
              en = rawText || 'thanks! so happy!';
            }
            console.log(`Task react JP: "${jp.substring(0, 60)}"`);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ jp, en }));
          } catch (e) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ jp: 'わー！すごい！ありがとう！', en: 'wow! amazing! thanks!' }));
          }
        });
      });

      proxyReq.on('error', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ jp: 'やったー！ありがとう！', en: 'yay! thank you!' }));
      });
      proxyReq.write(postData);
      proxyReq.end();
    }).catch(() => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ jp: 'ありがとう！', en: 'thanks!' }));
    });
    return;
  }

  // ======================== GET GLOBAL STATE ========================
  if (req.url === '/api/state' && req.method === 'GET') {
    if (!supabase) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        happiness: 0, current_life: 1,
        timer_end: new Date(Date.now() + 1800000).toISOString(),
        total_tasks_completed: 0, offline: true,
      }));
      return;
    }
    try {
      const { data } = await supabase.from('global_state').select('*').eq('id', 1).single();
      const { count } = await supabase.from('participants').select('*', { count: 'exact', head: true });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ...data, participant_count: count }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // ======================== ADMIN PANEL ========================
  // Serve admin page
  if (req.url === '/admin' && req.method === 'GET') {
    const adminPath = path.join(__dirname, 'admin.html');
    if (fs.existsSync(adminPath)) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(fs.readFileSync(adminPath));
    } else {
      res.writeHead(404); res.end('Admin page not found');
    }
    return;
  }

  // Admin: get all winners history + current state
  if (req.url.startsWith('/api/admin/status') && req.method === 'GET') {
    const url = new URL(req.url, `http://localhost`);
    const key = url.searchParams.get('key');
    if (key !== ADMIN_KEY) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid admin key' }));
      return;
    }
    if (!supabase) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Supabase offline' }));
      return;
    }
    try {
      const { data: state } = await supabase.from('global_state').select('*').eq('id', 1).single();
      const { data: participants } = await supabase.from('participants').select('*').order('tasks_completed', { ascending: false });
      const { data: entries } = await supabase.from('raffle_entries').select('*').order('created_at', { ascending: false });

      // Group entries by life
      const entriesByLife = {};
      (entries || []).forEach(e => {
        if (!entriesByLife[e.life_number]) entriesByLife[e.life_number] = [];
        entriesByLife[e.life_number].push(e);
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        state,
        participants: participants || [],
        entries_by_life: entriesByLife,
        total_participants: (participants || []).length,
      }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // Admin: reset timer for current life
  if (req.url === '/api/admin/reset-timer' && req.method === 'POST') {
    const body = await parseBody(req);
    if (body.key !== ADMIN_KEY) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid admin key' }));
      return;
    }
    if (!supabase) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Supabase offline' }));
      return;
    }
    try {
      const { data: state } = await supabase.from('global_state').select('*').eq('id', 1).single();
      const lifeNum = state?.current_life || 1;
      const LIFE_DURATIONS = [30, 60, 120, 240, 480, 960, 1920];
      const duration = LIFE_DURATIONS[Math.min(lifeNum - 1, LIFE_DURATIONS.length - 1)];
      await supabase.from('global_state').update({
        timer_end: new Date(Date.now() + duration * 60000).toISOString(),
        timer_duration_minutes: duration,
        happiness: 0,
        updated_at: new Date().toISOString(),
      }).eq('id', 1);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, duration_minutes: duration, life: lifeNum }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // Admin: start a specific life number
  if (req.url === '/api/admin/start-life' && req.method === 'POST') {
    const body = await parseBody(req);
    if (body.key !== ADMIN_KEY) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid admin key' }));
      return;
    }
    if (!supabase) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Supabase offline' }));
      return;
    }
    try {
      const lifeNum = parseInt(body.life) || 1;
      const LIFE_DURATIONS = [30, 60, 120, 240, 480, 960, 1920];
      const duration = LIFE_DURATIONS[Math.min(lifeNum - 1, LIFE_DURATIONS.length - 1)];
      await supabase.from('global_state').update({
        current_life: lifeNum,
        timer_end: new Date(Date.now() + duration * 60000).toISOString(),
        timer_duration_minutes: duration,
        happiness: 0,
        total_tasks_completed: 0,
        updated_at: new Date().toISOString(),
      }).eq('id', 1);
      console.log(`ADMIN: Started Life #${lifeNum} (${duration}m timer)`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, life: lifeNum, duration_minutes: duration }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // Admin: manually draw raffle winner
  if (req.url === '/api/admin/draw-winner' && req.method === 'POST') {
    const body = await parseBody(req);
    if (body.key !== ADMIN_KEY) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid admin key' }));
      return;
    }
    // Admin-authenticated — fall through to raffle draw logic
  }

  // ======================== DRAW RAFFLE WINNER ========================
  if ((req.url === '/api/raffle/draw' || req.url === '/api/admin/draw-winner') && req.method === 'POST') {
    if (!supabase) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ winner: null, offline: true }));
      return;
    }
    try {
      const { data: state } = await supabase.from('global_state').select('current_life').eq('id', 1).single();
      const lifeNum = state?.current_life || 1;

      // Get all raffle entries for this life
      const { data: entries } = await supabase
        .from('raffle_entries')
        .select('wallet_address')
        .eq('life_number', lifeNum);

      if (!entries || entries.length === 0) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ winner: null, message: 'no entries' }));
        return;
      }

      // Pick random winner
      const winner = entries[Math.floor(Math.random() * entries.length)];

      // Get winner info
      const { data: winnerInfo } = await supabase
        .from('participants')
        .select('display_name')
        .eq('wallet_address', winner.wallet_address)
        .single();

      // Update global state: new life, reset timer, store winner
      // Timer doubles each life: 30m, 1h, 2h, 4h, 8h, 16h, 32h
      const LIFE_DURATIONS = [30, 60, 120, 240, 480, 960, 1920]; // minutes
      const nextLife = lifeNum + 1;
      const newDuration = LIFE_DURATIONS[Math.min(nextLife - 1, LIFE_DURATIONS.length - 1)];
      await supabase.from('global_state').update({
        current_life: nextLife,
        happiness: 0,  // Reset to unhappy at start of each life
        timer_end: new Date(Date.now() + newDuration * 60000).toISOString(),
        timer_duration_minutes: newDuration,
        last_winner_wallet: winner.wallet_address,
        last_winner_name: winnerInfo?.display_name || 'anonymous',
        total_tasks_completed: 0,
        updated_at: new Date().toISOString(),
      }).eq('id', 1);

      console.log(`RAFFLE WINNER: ${winner.wallet_address} (Life #${lifeNum})`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        winner: winner.wallet_address,
        name: winnerInfo?.display_name || 'anonymous',
        life: lifeNum,
        entries: entries.length,
      }));
    } catch (e) {
      console.error('Raffle error:', e.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // ======================== GET RECENT DRAWINGS (GALLERY) ========================
  if (req.url === '/api/drawings' && req.method === 'GET') {
    if (!supabase) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify([]));
      return;
    }
    try {
      const { data } = await supabase
        .from('drawings')
        .select('id, prompt, image_data, created_at, participant_id, likes')
        .order('created_at', { ascending: false })
        .limit(50);

      // Enrich with artist names
      const enriched = await Promise.all((data || []).map(async (d) => {
        const { data: p } = await supabase
          .from('participants')
          .select('display_name, wallet_address')
          .eq('id', d.participant_id)
          .single();
        return {
          id: d.id,
          prompt: d.prompt,
          image_data: d.image_data,
          created_at: d.created_at,
          likes: d.likes || 0,
          artist: p?.display_name || 'anonymous',
          wallet: p?.wallet_address || '',
        };
      }));

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(enriched));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // ======================== ACTIVITY FEED ========================
  if (req.url === '/api/activity' && req.method === 'GET') {
    if (!supabase) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify([]));
      return;
    }
    try {
      const { data: tasks } = await supabase
        .from('tasks')
        .select('task_type, task_prompt, participant_id, completed_at')
        .eq('completed', true)
        .order('completed_at', { ascending: false })
        .limit(20);

      const feed = await Promise.all((tasks || []).map(async (t) => {
        const { data: p } = await supabase
          .from('participants')
          .select('display_name')
          .eq('id', t.participant_id)
          .single();
        return {
          name: p?.display_name || 'explorer',
          type: t.task_type,
          prompt: (t.task_prompt || '').substring(0, 40),
          time: t.completed_at,
        };
      }));

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(feed));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // ======================== GLOBAL CHAT: GET MESSAGES ========================
  if (req.url.startsWith('/api/chat/global') && req.method === 'GET') {
    if (!supabase) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify([]));
      return;
    }
    try {
      const url = new URL(req.url, 'http://localhost');
      const archive = url.searchParams.get('archive') === '1';

      if (archive) {
        // Archive: messages older than 6 minutes, last 100
        const cutoff = new Date(Date.now() - 6 * 60 * 1000).toISOString();
        const { data } = await supabase
          .from('chat_messages')
          .select('*')
          .lt('created_at', cutoff)
          .order('created_at', { ascending: false })
          .limit(100);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify((data || []).reverse()));
      } else {
        // Live chat: only messages from last 6 minutes
        const since = new Date(Date.now() - 6 * 60 * 1000).toISOString();
        const { data } = await supabase
          .from('chat_messages')
          .select('*')
          .gte('created_at', since)
          .order('created_at', { ascending: true })
          .limit(50);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data || []));
      }
    } catch (e) {
      console.warn('Chat GET error (table may not exist yet):', e.message);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify([]));
    }
    return;
  }

  // ======================== GLOBAL CHAT: POST MESSAGE ========================
  if (req.url === '/api/chat/global' && req.method === 'POST') {
    const body = await parseBody(req);
    const { wallet, name, message } = body;
    if (!message || !message.trim()) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'message required' }));
      return;
    }
    if (!supabase) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, offline: true }));
      return;
    }
    try {
      const displayName = name || 'explorer';
      const msg = message.trim().substring(0, 300); // limit length

      // Save chat message
      await supabase.from('chat_messages').insert({
        wallet_address: wallet || null,
        display_name: displayName,
        message: msg,
        message_type: 'chat',
      });

      // Check if message is addressed to Pippin
      const isPippinMsg = msg.toLowerCase().startsWith('@pippin') || msg.toLowerCase().startsWith('/pippin');
      let pippinReply = null;

      if (isPippinMsg && ANTHROPIC_API_KEY) {
        const cleanMsg = msg.replace(/^[@/]pippin\s*/i, '').trim() || 'hello!';

        // Get current happiness for mood
        const { data: stateData } = await supabase.from('global_state').select('happiness').eq('id', 1).single();
        const h = stateData?.happiness || 0;
        let moodNote = '';
        if (h < 30) moodNote = 'You are sad and lonely.';
        else if (h < 60) moodNote = 'You are feeling okay.';
        else moodNote = 'You are SUPER HAPPY!';

        const sysPrompt = `You are Pippin (ピピン), a kawaii unicorn in a global chat room. Someone named "${displayName}" is talking to you. Your happiness: ${h}%. ${moodNote}

Keep responses SHORT (1-2 sentences). Be cute, funny, in-character. Speak casually.

Reply as JSON only: {"jp": "Japanese response", "en": "English with Japanese accent"}`;

        const postData = JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 200,
          system: sysPrompt,
          messages: [{ role: 'user', content: cleanMsg }],
        });

        // Make Claude request
        const pippinResponse = await new Promise((resolve) => {
          const proxyReq = https.request({
            hostname: 'api.anthropic.com',
            path: '/v1/messages',
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': ANTHROPIC_API_KEY,
              'anthropic-version': '2023-06-01',
              'Content-Length': Buffer.byteLength(postData),
            }
          }, (proxyRes) => {
            let body = '';
            proxyRes.on('data', d => body += d);
            proxyRes.on('end', () => {
              try {
                const parsed = JSON.parse(body);
                const text = parsed.content?.[0]?.text || '';
                const dual = JSON.parse(text);
                resolve(dual);
              } catch(_) { resolve({ jp: 'にゃー！', en: 'nyaa!' }); }
            });
          });
          proxyReq.on('error', () => resolve({ jp: 'にゃー！', en: 'nyaa!' }));
          proxyReq.write(postData);
          proxyReq.end();
        });

        // Save Pippin's reply as a chat message
        const pippinMsg = pippinResponse.en || pippinResponse.jp || 'nyaa!';
        await supabase.from('chat_messages').insert({
          wallet_address: null,
          display_name: 'Pippin',
          message: pippinMsg,
          message_type: 'pippin',
        });
        pippinReply = pippinResponse;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, pippin: pippinReply }));
    } catch (e) {
      console.warn('Global chat error (table may not exist yet):', e.message);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    }
    return;
  }

  // ======================== GROUP PUZZLE: GET ACTIVE ========================
  if (req.url === '/api/puzzle' && req.method === 'GET') {
    if (!supabase) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ puzzle: null }));
      return;
    }
    try {
      const { data: state } = await supabase.from('global_state').select('current_life').eq('id', 1).single();
      const lifeNum = state?.current_life || 1;

      // Find active (not completed) puzzle for current life
      let { data: puzzle } = await supabase
        .from('group_puzzles')
        .select('*')
        .eq('life_number', lifeNum)
        .eq('completed', false)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      // If no active puzzle, create one — rotate through puzzle types
      if (!puzzle) {
        // Find the last completed puzzle's type to determine which type is next
        let nextType = PUZZLE_TYPES_ORDER[0];
        const { data: lastPuzzle } = await supabase
          .from('group_puzzles')
          .select('puzzle_type')
          .eq('life_number', lifeNum)
          .order('created_at', { ascending: false })
          .limit(1)
          .single()
          .catch(() => ({ data: null }));
        if (lastPuzzle) {
          const lastIdx = PUZZLE_TYPES_ORDER.indexOf(lastPuzzle.puzzle_type);
          nextType = PUZZLE_TYPES_ORDER[(lastIdx + 1) % PUZZLE_TYPES_ORDER.length];
        }
        // Pick a random template of the chosen type
        const candidates = PUZZLE_TEMPLATES.filter(t => t.type === nextType);
        const tmpl = candidates[Math.floor(Math.random() * candidates.length)];
        // Store extra metadata in contributions JSONB as first entry with type "__meta"
        const meta = { __meta: true, grid: tmpl.grid || null, subject: tmpl.subject || null, parts: tmpl.parts || null, clues: tmpl.clues || null, startWord: tmpl.startWord || null, scenario: tmpl.scenario || null, topic: tmpl.topic || null, rule: tmpl.rule || null, jobs: tmpl.jobs || null };
        const { data: newPuzzle } = await supabase.from('group_puzzles').insert({
          puzzle_type: tmpl.type,
          prompt_jp: tmpl.jp,
          prompt_en: tmpl.en,
          target_count: tmpl.target,
          contributions: [meta],
          life_number: lifeNum,
        }).select().single();
        puzzle = newPuzzle;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ puzzle }));
    } catch (e) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ puzzle: null }));
    }
    return;
  }

  // ======================== GROUP PUZZLE: CONTRIBUTE ========================
  if (req.url === '/api/puzzle/contribute' && req.method === 'POST') {
    const body = await parseBody(req);
    const { wallet, name, response, puzzle_id, image_data, slot } = body;
    if (!wallet || !puzzle_id || (!response && !image_data)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'wallet, puzzle_id, and response or image_data required' }));
      return;
    }
    if (!supabase) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, offline: true }));
      return;
    }
    try {
      const { data: puzzle } = await supabase
        .from('group_puzzles')
        .select('*')
        .eq('id', puzzle_id)
        .single();

      if (!puzzle || puzzle.completed) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'puzzle not active', completed: true }));
        return;
      }

      // Get all real contributions (excluding __meta)
      const allEntries = puzzle.contributions || [];
      const existing = allEntries.filter(c => !c.__meta);
      const meta = allEntries.find(c => c.__meta) || {};

      if (existing.some(c => c.wallet === wallet)) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'already contributed', contributions: allEntries }));
        return;
      }

      // For drawing puzzles, check if the requested slot is taken
      const isDrawPuzzle = puzzle.puzzle_type === 'collab_draw' || puzzle.puzzle_type === 'exquisite_corpse';
      if (isDrawPuzzle && slot !== undefined) {
        if (existing.some(c => c.slot === slot)) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'slot taken', contributions: allEntries }));
          return;
        }
      }

      // ---- AI VERIFICATION for puzzle contributions ----
      const isDrawPuzzleType = puzzle.puzzle_type === 'collab_draw' || puzzle.puzzle_type === 'exquisite_corpse';
      let puzzleApproved = true;
      let puzzleReaction = '';

      if (ANTHROPIC_API_KEY && !isDrawPuzzleType) {
        // Build context for the AI judge based on puzzle type
        let judgeContext = '';
        const ptype = puzzle.puzzle_type;

        if (ptype === 'research' && meta.jobs) {
          const jobText = meta.jobs[slot !== undefined ? slot : existing.length] || 'answer the research question';
          judgeContext = `This is a RESEARCH mission about "${meta.topic || ''}". The user's specific task was: "${jobText}". Check if the answer is factually plausible and shows real effort/knowledge. Reject if it's gibberish, completely wrong, or lazy one-word non-answers.`;
        } else if (ptype === 'trivia' && meta.jobs) {
          const jobText = meta.jobs[slot !== undefined ? slot : existing.length] || 'answer the trivia question';
          judgeContext = `This is a TRIVIA question: "${jobText}". Check if the answer is correct or at least a reasonable attempt. Reject obvious nonsense or completely wrong answers.`;
        } else if (ptype === 'riddle' && meta.clues) {
          const clueText = meta.clues[slot !== undefined ? slot : existing.length] || 'solve the riddle';
          judgeContext = `This is a RIDDLE: "${clueText}". Check if the answer is correct or a reasonable guess. Be lenient — close answers are fine.`;
        } else if (ptype === 'debate') {
          judgeContext = `This is a DEBATE on: "${meta.topic || ''}". Rule: "${meta.rule || 'give a thoughtful opinion'}". Check if the user gave a real opinion with at least some reasoning. Reject empty, off-topic, or zero-effort answers (single word, random text). Accept any genuine opinion even if you disagree.`;
        } else if (ptype === 'story') {
          judgeContext = `This is a COLLABORATIVE STORY. The user is adding a sentence to the story: "${puzzle.prompt_en}". Check if it's a real sentence that continues the story. Reject gibberish or completely off-topic spam. Be lenient — creativity is welcome!`;
        } else if (ptype === 'word_chain') {
          const prevWord = existing.length > 0 ? existing[existing.length - 1].response : (meta.startWord || 'Start');
          const lastLetter = prevWord.trim().slice(-1).toLowerCase();
          judgeContext = `This is a WORD CHAIN game. The previous word was "${prevWord}". The new word must start with the letter "${lastLetter.toUpperCase()}". Check if the submission is a real English word that starts with "${lastLetter}". Reject if it doesn't start with the right letter, or isn't a real word.`;
        } else if (ptype === 'caption') {
          judgeContext = `This is a CAPTION CONTEST for the scenario: "${meta.scenario || ''}". Check if the user wrote a real caption (at least a few words). Reject gibberish or completely empty/lazy answers. Be lenient — humor is subjective!`;
        }

        if (judgeContext) {
          try {
            const judgePrompt = `You are Pippin (ピピン), a kawaii unicorn who judges group puzzle contributions. Be fair but firm.

${judgeContext}

JUDGE the submission and reply with ONLY valid JSON:
{"approved": true/false, "reason": "brief explanation in cute English"}

If APPROVED: brief praise (max 10 words).
If REJECTED: explain what's wrong and what they should do instead.`;

            const postData = JSON.stringify({
              model: 'claude-sonnet-4-20250514',
              max_tokens: 150,
              system: judgePrompt,
              messages: [{ role: 'user', content: `Submission: "${(response || '').substring(0, 500)}"` }],
            });

            const verdict = await new Promise((resolve) => {
              const timer = setTimeout(() => resolve({ approved: true, reason: 'auto-approved (timeout)' }), 10000);
              const proxyReq = https.request({
                hostname: 'api.anthropic.com',
                path: '/v1/messages',
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'x-api-key': ANTHROPIC_API_KEY,
                  'anthropic-version': '2023-06-01',
                  'Content-Length': Buffer.byteLength(postData),
                }
              }, (proxyRes) => {
                let body = '';
                proxyRes.on('data', d => body += d);
                proxyRes.on('end', () => {
                  clearTimeout(timer);
                  try {
                    const parsed = JSON.parse(body);
                    const text = parsed.content?.[0]?.text || '';
                    const jsonMatch = text.match(/\{[\s\S]*\}/);
                    if (jsonMatch) {
                      resolve(JSON.parse(jsonMatch[0]));
                    } else {
                      resolve({ approved: true, reason: 'ok' });
                    }
                  } catch(_) {
                    resolve({ approved: true, reason: 'ok' });
                  }
                });
              });
              proxyReq.on('error', () => { clearTimeout(timer); resolve({ approved: true, reason: 'auto-approved' }); });
              proxyReq.write(postData);
              proxyReq.end();
            });

            puzzleApproved = verdict.approved !== false;
            puzzleReaction = verdict.reason || '';
            console.log(`Puzzle AI Judge: ${ptype} contribution ${puzzleApproved ? 'APPROVED' : 'REJECTED'}: ${puzzleReaction}`);
          } catch (e) {
            console.warn('Puzzle AI judge error, auto-approving:', e.message);
            puzzleApproved = true;
          }
        }
      }

      // If rejected by AI, send back rejection without saving
      if (!puzzleApproved) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'rejected', rejected: true, reason: puzzleReaction, contributions: allEntries }));
        return;
      }

      // Build contribution
      const newContribution = {
        wallet,
        name: name || 'explorer',
        response: image_data ? '(drawing)' : (response || '').substring(0, 500),
        image_data: image_data || null,
        slot: slot !== undefined ? slot : existing.length,
        time: new Date().toISOString(),
      };
      const updatedContributions = [meta, ...existing, newContribution].filter(Boolean);
      const newCount = updatedContributions.filter(c => !c.__meta).length;
      const isCompleted = newCount >= puzzle.target_count;

      await supabase.from('group_puzzles').update({
        contributions: updatedContributions,
        current_count: newCount,
        completed: isCompleted,
      }).eq('id', puzzle_id);

      // Post activity to chat
      await supabase.from('chat_messages').insert({
        wallet_address: wallet,
        display_name: name || 'explorer',
        message: `contributed to group puzzle! (${newCount}/${puzzle.target_count})`,
        message_type: 'activity',
      });

      // If completed, give rewards to all contributors
      if (isCompleted) {
        const { data: state } = await supabase.from('global_state').select('happiness, current_life').eq('id', 1).single();
        const newHappiness = Math.min(100, (state?.happiness || 0) + 5);
        await supabase.from('global_state').update({
          happiness: newHappiness,
          updated_at: new Date().toISOString(),
        }).eq('id', 1);

        // Bonus raffle entries for all contributors
        for (const contrib of updatedContributions) {
          const { data: p } = await supabase.from('participants').select('id').eq('wallet_address', contrib.wallet).single();
          if (p) {
            await supabase.from('raffle_entries').insert({
              participant_id: p.id,
              wallet_address: contrib.wallet,
              life_number: state?.current_life || 1,
            });
          }
        }

        // Post completion to chat
        await supabase.from('chat_messages').insert({
          wallet_address: null,
          display_name: 'Pippin',
          message: `sugoi! group puzzle completed ne! +5 happiness for everyone desu! all contributors get bonus raffle entry!`,
          message_type: 'pippin',
        });

        console.log(`Group puzzle completed! ${updatedContributions.length} contributors`);
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        completed: isCompleted,
        count: newCount,
        target: puzzle.target_count,
        contributions: updatedContributions,
      }));
    } catch (e) {
      console.error('Puzzle contribute error:', e.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // ======================== LIKE DRAWING ========================
  if (req.url.startsWith('/api/drawings/') && req.url.endsWith('/like') && req.method === 'POST') {
    const drawingId = req.url.split('/')[3];
    if (!supabase || !drawingId) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ likes: 0 }));
      return;
    }
    try {
      // Increment likes (using RPC or direct update)
      const { data: drawing } = await supabase
        .from('drawings')
        .select('likes')
        .eq('id', drawingId)
        .single();
      const newLikes = (drawing?.likes || 0) + 1;
      await supabase.from('drawings').update({ likes: newLikes }).eq('id', drawingId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ likes: newLikes }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // ======================== PLAYER PROFILE ========================
  if (req.url.startsWith('/api/profile/') && req.method === 'GET') {
    const wallet = decodeURIComponent(req.url.split('/api/profile/')[1]);
    if (!supabase || !wallet) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
      return;
    }
    try {
      const { data: participant } = await supabase
        .from('participants')
        .select('*')
        .eq('wallet_address', wallet)
        .single();
      if (!participant) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'not found' }));
        return;
      }

      // Total tasks completed (all time)
      const { count: totalTasks } = await supabase.from('tasks').select('*', { count: 'exact', head: true })
        .eq('participant_id', participant.id).eq('completed', true);

      // Tasks by type
      const { data: tasksByType } = await supabase.from('tasks').select('task_type')
        .eq('participant_id', participant.id).eq('completed', true);
      const typeCounts = {};
      (tasksByType || []).forEach(t => { typeCounts[t.task_type] = (typeCounts[t.task_type] || 0) + 1; });

      // Total drawings
      const { count: totalDrawings } = await supabase.from('drawings').select('*', { count: 'exact', head: true })
        .eq('participant_id', participant.id);

      // Total drawing likes received
      const { data: drawingsData } = await supabase.from('drawings').select('likes')
        .eq('participant_id', participant.id);
      const totalLikes = (drawingsData || []).reduce((s, d) => s + (d.likes || 0), 0);

      // Total happiness contributed (all time)
      const { data: happyData } = await supabase.from('tasks').select('happiness_reward')
        .eq('participant_id', participant.id).eq('completed', true);
      const totalHappiness = (happyData || []).reduce((s, t) => s + (t.happiness_reward || 0), 0);

      // Raffle entries (all time)
      const { count: totalEntries } = await supabase.from('raffle_entries').select('*', { count: 'exact', head: true })
        .eq('wallet_address', wallet);

      // Per-life breakdown
      const { data: lifeEntries } = await supabase.from('raffle_entries').select('life_number')
        .eq('wallet_address', wallet);
      const lifeCounts = {};
      (lifeEntries || []).forEach(e => { lifeCounts[e.life_number] = (lifeCounts[e.life_number] || 0) + 1; });

      // Puzzle contributions (all time) — count from group_puzzles contributions JSONB
      const { data: puzzles } = await supabase.from('group_puzzles').select('contributions');
      let puzzleContribs = 0;
      (puzzles || []).forEach(p => {
        (p.contributions || []).forEach(c => {
          if (!c.__meta && c.wallet === wallet) puzzleContribs++;
        });
      });

      // Chat messages count
      const { count: chatMsgs } = await supabase.from('chat_messages').select('*', { count: 'exact', head: true })
        .eq('wallet_address', wallet).eq('message_type', 'chat');

      // First seen (join date)
      const joinDate = participant.created_at;

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        wallet: participant.wallet_address,
        name: participant.display_name || 'explorer',
        joined: joinDate,
        stats: {
          totalTasks: totalTasks || 0,
          tasksByType: typeCounts,
          totalDrawings: totalDrawings || 0,
          totalLikes,
          totalHappiness: Math.round(totalHappiness * 10) / 10,
          totalEntries: totalEntries || 0,
          entriesByLife: lifeCounts,
          puzzleContribs,
          chatMessages: chatMsgs || 0,
        }
      }));
    } catch (e) {
      console.error('Profile error:', e.message);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // ======================== LEADERBOARD / RANKING ========================
  if (req.url.startsWith('/api/ranking') && req.method === 'GET') {
    if (!supabase) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ players: [], total: 0 }));
      return;
    }
    try {
      const url = new URL(req.url, 'http://localhost');
      const scope = url.searchParams.get('scope') || 'life'; // 'life' or 'global'

      const { data: state } = await supabase.from('global_state').select('current_life').eq('id', 1).single();
      const lifeNum = state?.current_life || 1;

      if (scope === 'global') {
        // ---- GLOBAL ALL-TIME LEADERBOARD ----
        const { data: allParticipants } = await supabase
          .from('participants')
          .select('id, wallet_address, display_name, created_at')
          .limit(100);

        const ranked = await Promise.all((allParticipants || []).map(async (p) => {
          const { count: totalTasks } = await supabase.from('tasks').select('*', { count: 'exact', head: true })
            .eq('participant_id', p.id).eq('completed', true);
          const { data: happyData } = await supabase.from('tasks').select('happiness_reward')
            .eq('participant_id', p.id).eq('completed', true);
          const happiness = (happyData || []).reduce((s, t) => s + (t.happiness_reward || 0), 0);
          const { count: totalEntries } = await supabase.from('raffle_entries').select('*', { count: 'exact', head: true })
            .eq('wallet_address', p.wallet_address);
          const { count: totalDrawings } = await supabase.from('drawings').select('*', { count: 'exact', head: true })
            .eq('participant_id', p.id);

          return {
            wallet: p.wallet_address,
            name: p.display_name || 'explorer',
            tasks: totalTasks || 0,
            happiness: Math.round(happiness * 10) / 10,
            entries: totalEntries || 0,
            drawings: totalDrawings || 0,
            joined: p.created_at,
          };
        }));

        ranked.sort((a, b) => b.tasks - a.tasks || b.happiness - a.happiness);
        ranked.forEach((p, i) => { p.rank = i + 1; });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ players: ranked, total: ranked.length, life: lifeNum, scope: 'global' }));

      } else {
        // ---- PER-LIFE LEADERBOARD (current life) ----
        const { data: entries } = await supabase
          .from('raffle_entries')
          .select('wallet_address, participant_id, created_at')
          .eq('life_number', lifeNum);

        const walletMap = {};
        (entries || []).forEach(e => {
          if (!walletMap[e.wallet_address]) {
            walletMap[e.wallet_address] = { count: 0, participant_id: e.participant_id };
          }
          walletMap[e.wallet_address].count++;
        });

        const ranked = await Promise.all(Object.entries(walletMap).map(async ([wallet, info]) => {
          const { data: participant } = await supabase.from('participants').select('display_name')
            .eq('id', info.participant_id).single();
          const { data: recentTasks } = await supabase.from('tasks').select('happiness_reward')
            .eq('participant_id', info.participant_id).eq('completed', true)
            .order('completed_at', { ascending: false }).limit(info.count);
          const happiness = (recentTasks || []).reduce((sum, t) => sum + (t.happiness_reward || 0), 0);

          return {
            wallet, name: participant?.display_name || 'explorer',
            tasks: info.count, happiness: Math.round(happiness * 10) / 10, entries: info.count,
          };
        }));

        ranked.sort((a, b) => b.entries - a.entries || b.happiness - a.happiness);
        ranked.forEach((p, i) => { p.rank = i + 1; });

        const { count: totalPlayers } = await supabase.from('participants').select('*', { count: 'exact', head: true });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ players: ranked, total: totalPlayers, life: lifeNum, scope: 'life' }));
      }
    } catch (e) {
      console.error('Ranking error:', e.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // ======================== STATIC FILE SERVING ========================
  let filePath = '.' + decodeURIComponent(req.url.split('?')[0]);
  if (filePath === './') filePath = './pippin3d.html';

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  const relPath = filePath.replace('./', '');

  // Check if this is a CDN asset that needs to be fetched/streamed
  if (CDN_ASSETS[relPath] && !fs.existsSync(filePath)) {
    // If already downloading, wait for it to finish then serve from cache
    if (cdnDownloading[relPath]) {
      console.log(`CDN waiting (already downloading): ${relPath}`);
      const check = setInterval(() => {
        if (fs.existsSync(filePath)) {
          clearInterval(check);
          serveFile(filePath, contentType, req, res);
        }
      }, 1000);
      // Timeout after 3 minutes
      setTimeout(() => { clearInterval(check); if (!res.headersSent) { res.writeHead(504); res.end('Download timeout'); } }, 180000);
      return;
    }
    cdnDownloading[relPath] = true;
    const cdnUrl = CDN_ASSETS[relPath];
    console.log(`CDN stream: ${relPath}`);

    // Ensure directory exists for caching
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    // Follow redirects and stream directly to browser + cache to disk
    const streamFromCDN = (url, redirects) => {
      if (redirects > 5) {
        console.error(`CDN too many redirects: ${relPath}`);
        res.writeHead(502); res.end('Too many redirects');
        return;
      }
      const parsedUrl = new URL(url);
      const proto = parsedUrl.protocol === 'https:' ? https : http;
      const reqOpts = {
        hostname: parsedUrl.hostname,
        path: parsedUrl.pathname + parsedUrl.search,
        headers: { 'User-Agent': 'PippinServer/1.0' },
        timeout: 120000,
      };
      
      proto.get(reqOpts, (dlRes) => {
        if (dlRes.statusCode === 302 || dlRes.statusCode === 301) {
          const loc = dlRes.headers.location;
          console.log(`CDN redirect ${dlRes.statusCode}: ${relPath} -> ${loc.substring(0, 80)}...`);
          dlRes.resume(); // consume response to free socket
          streamFromCDN(loc, redirects + 1);
          return;
        }
        if (dlRes.statusCode !== 200) {
          console.error(`CDN failed ${dlRes.statusCode}: ${relPath}`);
          res.writeHead(502); res.end('CDN fetch failed');
          return;
        }

        const contentLen = dlRes.headers['content-length'];
        console.log(`CDN streaming: ${relPath} (${contentLen ? (contentLen / 1048576).toFixed(1) + 'MB' : 'unknown size'})`);

        // Send headers to browser immediately - stream while downloading
        const headers = {
          'Content-Type': contentType,
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=86400',
        };
        if (contentLen) headers['Content-Length'] = contentLen;
        res.writeHead(200, headers);

        // Tee: stream to both browser and disk cache
        const tmpPath = filePath + '.tmp';
        const cacheStream = fs.createWriteStream(tmpPath);
        let bytes = 0;

        dlRes.on('data', (chunk) => {
          bytes += chunk.length;
          res.write(chunk);
          cacheStream.write(chunk);
        });

        dlRes.on('end', () => {
          res.end();
          cacheStream.end(() => {
            try {
              fs.renameSync(tmpPath, filePath);
              console.log(`CDN cached: ${relPath} (${(bytes / 1048576).toFixed(1)}MB)`);
            } catch (e) {
              console.error(`CDN cache rename failed: ${e.message}`);
            }
            delete cdnDownloading[relPath];
          });
        });

        dlRes.on('error', (e) => {
          console.error(`CDN stream error: ${e.message}`);
          res.end();
          cacheStream.end();
          try { fs.unlinkSync(tmpPath); } catch (_) {}
          delete cdnDownloading[relPath];
        });

        // If browser disconnects, keep downloading for cache
        req.on('close', () => {
          // Don't abort dlRes - let it finish caching
        });

      }).on('error', (e) => {
        console.error(`CDN connect error: ${e.message}`);
        delete cdnDownloading[relPath];
        if (!res.headersSent) { res.writeHead(502); res.end('CDN error'); }
      }).on('timeout', () => {
        console.error(`CDN timeout: ${relPath}`);
        delete cdnDownloading[relPath];
        if (!res.headersSent) { res.writeHead(504); res.end('CDN timeout'); }
      });
    };
    streamFromCDN(cdnUrl, 0);
    return;
  }

  serveFile(filePath, contentType, req, res);
});

function serveFile(filePath, contentType, req, res) {
  fs.stat(filePath, (err, stats) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    // For large files, support range requests (helps with GLB loading)
    const range = req.headers.range;
    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : stats.size - 1;
      const chunkSize = end - start + 1;

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${stats.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': contentType,
      });

      fs.createReadStream(filePath, { start, end }).pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': stats.size,
        'Content-Type': contentType,
        'Accept-Ranges': 'bytes',
      });

      fs.createReadStream(filePath).pipe(res);
    }
  });
}

server.listen(PORT, () => {
  console.log(`ピピンのグラウンドホッグデー running on port ${PORT}`);
  console.log(`TTS: ${ELEVENLABS_API_KEY ? 'yes' : 'no'} | Claude: ${ANTHROPIC_API_KEY ? 'yes' : 'no'} | Supabase: ${supabase ? 'yes' : 'offline'}`);

  // Pre-warm CDN cache: download large assets in background on startup
  Object.entries(CDN_ASSETS).forEach(([relPath, cdnUrl]) => {
    const filePath = './' + relPath;
    if (fs.existsSync(filePath)) {
      console.log(`CDN warm: ${relPath} already cached`);
      return;
    }
    console.log(`CDN warm: pre-fetching ${relPath}...`);
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const prewarm = (url, redirects) => {
      if (redirects > 5) { console.error(`CDN warm: too many redirects for ${relPath}`); return; }
      const parsedUrl = new URL(url);
      const proto = parsedUrl.protocol === 'https:' ? https : http;
      proto.get({
        hostname: parsedUrl.hostname,
        path: parsedUrl.pathname + parsedUrl.search,
        headers: { 'User-Agent': 'PippinServer/1.0' },
        timeout: 300000,
      }, (dlRes) => {
        if (dlRes.statusCode === 301 || dlRes.statusCode === 302) {
          dlRes.resume();
          prewarm(dlRes.headers.location, redirects + 1);
          return;
        }
        if (dlRes.statusCode !== 200) {
          console.error(`CDN warm: failed ${dlRes.statusCode} for ${relPath}`);
          return;
        }
        const tmpPath = filePath + '.tmp';
        const ws = fs.createWriteStream(tmpPath);
        let bytes = 0;
        dlRes.on('data', (c) => { bytes += c.length; });
        dlRes.pipe(ws);
        ws.on('finish', () => {
          try {
            fs.renameSync(tmpPath, filePath);
            console.log(`CDN warm: cached ${relPath} (${(bytes / 1048576).toFixed(1)}MB)`);
            delete cdnDownloading[relPath];
          } catch (e) { console.error(`CDN warm rename error: ${e.message}`); }
        });
      }).on('error', (e) => {
        console.error(`CDN warm error for ${relPath}: ${e.message}`);
      });
    };
    cdnDownloading[relPath] = true;
    prewarm(cdnUrl, 0);
  });
});
