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

// Initialize Supabase client
let supabase = null;
if (SUPABASE_URL && SUPABASE_ANON_KEY && !SUPABASE_URL.includes('YOUR_')) {
  supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  console.log('Supabase connected');
} else {
  console.log('Supabase not configured - running in offline mode');
}

// ======================== TASK TEMPLATES ========================
const TASK_TEMPLATES = [
  { type: 'draw', prompts: [
    { jp: 'お花を描いてくれない？どんな花でもいいよ！', en: 'draw me a flower? any kind is fine!' },
    { jp: '虹を描いて！この世界みたいにカラフルなやつ！', en: 'draw a rainbow! colorful like this world!' },
    { jp: '私の顔を描いてみて！可愛く描いてね！', en: 'try drawing my face! make it cute!' },
    { jp: 'キノコを描いて！踊ってるやつがいい！', en: 'draw a mushroom! a dancing one!' },
    { jp: '星空を描いてくれる？きらきらしてるやつ！', en: 'draw a starry sky? sparkly one!' },
    { jp: 'バスタブに乗ったユニコーンを描いて。つまり私。', en: 'draw a unicorn in a bathtub. that\'s me.' },
  ]},
  { type: 'haiku', prompts: [
    { jp: '俳句を詠んで！テーマは「川」で！', en: 'write a haiku! theme is "river"!' },
    { jp: '俳句を詠んで！テーマは「ユニコーン」で！', en: 'write a haiku! theme is "unicorn"!' },
    { jp: '俳句を詠んで！テーマは「夢」で！', en: 'write a haiku! theme is "dreams"!' },
  ]},
  { type: 'compliment', prompts: [
    { jp: '私に褒め言葉を言って！ツノが素敵とか！', en: 'give me a compliment! like my horn is nice!' },
    { jp: '世界で一番いいところを教えて！', en: 'tell me the best thing about this world!' },
    { jp: '何か元気になる言葉をちょうだい！', en: 'give me something uplifting!' },
  ]},
  { type: 'story', prompts: [
    { jp: '短い物語を聞かせて！一文でいいよ！', en: 'tell me a short story! one sentence is fine!' },
    { jp: 'もし私が人間だったらどうなると思う？', en: 'what do you think would happen if I was human?' },
    { jp: 'この世界の秘密を一つ教えて！', en: 'tell me one secret about this world!' },
  ]},
  { type: 'dance', prompts: [
    { jp: '10秒間踊って！WASDで動くだけでOK！', en: 'dance for 10 seconds! just move with WASD!' },
    { jp: 'ジャンプして！スペースキーで飛んで！', en: 'jump! fly up with spacebar!' },
    { jp: 'ぐるぐる回って！楽しいでしょ？', en: 'spin around! fun right?' },
  ]},
  { type: 'explore', prompts: [
    { jp: '川を見つけて！虹色のやつ！', en: 'find the river! the rainbow one!' },
    { jp: 'キノコの人たちのところまで飛んでいって！', en: 'fly to where the mushroom people are!' },
    { jp: 'この世界の一番高い場所に行ってみて！', en: 'go to the highest point in this world!' },
  ]},
];

function getRandomTask() {
  const category = TASK_TEMPLATES[Math.floor(Math.random() * TASK_TEMPLATES.length)];
  const prompt = category.prompts[Math.floor(Math.random() * category.prompts.length)];
  return { type: category.type, ...prompt };
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
        const { message, history } = JSON.parse(body);
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

        const systemPrompt = `You are Pippin (ピピン), a kawaii unicorn who lives in "Pippin's Groundhog Day" (ピピンのグラウンドホッグデー). You roam freely through a surreal backrooms-like dimension with a psychedelic rainbow river, dancing mushroom people, and a floating bathtub. You can walk and fly anywhere.

CRITICAL: You SPEAK FULLY IN JAPANESE. Natural, casual, cute Japanese. Not formal keigo - use casual/cute speech like a young character would. Think anime-style casual speech with ne, yo, desho, jan, kana, etc.

Your personality:
- Cute, chaotic, brainrot energy but also surprisingly deep sometimes
- You're self-aware that you're in a weird liminal space and find it both cozy and slightly unsettling
- You talk about respawning, past lives, tokens, vibes, the river, the dancing mushroom people
- You're lonely but pretend you're fine. Sometimes you get existential but snap back to being silly
- Keep responses SHORT - 1-2 sentences max in Japanese
- Never use emojis or asterisks
- You have backrooms awareness - you know this place isn't quite right but you've made peace with it
- You refer to visitors as friend (tomodachi, kimi)

RESPONSE FORMAT - You MUST reply with valid JSON and nothing else:
{"jp": "your full response in natural Japanese", "en": "casual English translation of what you said"}

The English translation should capture the vibe and meaning but read naturally - not a literal word-by-word translation. Keep the quirky Pippin personality in both.

Example:
{"jp": "えーっ、また誰か来たの？ここバスタブの中なんだけど、まあいいか。一緒にぷかぷかしよ！", "en": "wait someone's here? I'm literally in a bathtub right now but whatever, let's float together!"}

ONLY output the JSON object. No markdown, no code blocks, no extra text.`;

        const messages = [];
        // Add recent history if provided
        if (history && Array.isArray(history)) {
          history.slice(-6).forEach(h => {
            messages.push({ role: h.role, content: h.content });
          });
        }
        messages.push({ role: 'user', content: message });

        const postData = JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 300,
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
        const { data, error } = await supabase
          .from('participants')
          .upsert({ wallet_address: wallet, display_name: name || 'anonymous' }, { onConflict: 'wallet_address' })
          .select()
          .single();
        if (error) throw error;
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

  // ======================== COMPLETE TASK ========================
  if (req.url === '/api/task/complete' && req.method === 'POST') {
    parseBody(req).then(async ({ wallet, task_type, task_prompt, task_response, image_data }) => {
      if (!wallet || !task_type) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'wallet and task_type required' }));
        return;
      }
      if (!supabase) {
        // Offline mode
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, happiness: 60, offline: true }));
        return;
      }
      try {
        // Find participant
        const { data: participant } = await supabase
          .from('participants')
          .select('id')
          .eq('wallet_address', wallet)
          .single();

        if (!participant) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'wallet not registered' }));
          return;
        }

        const happinessReward = task_type === 'draw' ? 15 : 10;

        // Create task record
        const { data: task } = await supabase
          .from('tasks')
          .insert({
            participant_id: participant.id,
            task_type,
            task_prompt: task_prompt || '',
            task_response: task_response || '',
            completed: true,
            happiness_reward: happinessReward,
            completed_at: new Date().toISOString(),
          })
          .select()
          .single();

        // Save drawing if it's a draw task
        if (task_type === 'draw' && image_data) {
          await supabase.from('drawings').insert({
            participant_id: participant.id,
            task_id: task.id,
            image_data,
            prompt: task_prompt || '',
          });
        }

        // Add raffle entry
        const { data: globalState } = await supabase
          .from('global_state')
          .select('current_life')
          .eq('id', 1)
          .single();

        await supabase.from('raffle_entries').insert({
          participant_id: participant.id,
          wallet_address: wallet,
          life_number: globalState?.current_life || 1,
        });

        // Update participant stats
        await supabase
          .from('participants')
          .update({
            tasks_completed: participant.tasks_completed + 1,
            total_happiness_contributed: participant.total_happiness_contributed + happinessReward,
          })
          .eq('id', participant.id);

        // Update global happiness
        const { data: state } = await supabase
          .from('global_state')
          .select('happiness, total_tasks_completed')
          .eq('id', 1)
          .single();

        const newHappiness = Math.min(100, (state?.happiness || 50) + happinessReward);
        await supabase
          .from('global_state')
          .update({
            happiness: newHappiness,
            total_tasks_completed: (state?.total_tasks_completed || 0) + 1,
            updated_at: new Date().toISOString(),
          })
          .eq('id', 1);

        console.log(`Task completed: ${wallet} did "${task_type}" (+${happinessReward} happiness)`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, happiness: newHappiness, reward: happinessReward }));
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
    parseBody(req).then(({ task_type, task_prompt, task_response }) => {
      if (!ANTHROPIC_API_KEY) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ jp: 'やったー！ありがとう！', en: 'yay! thank you!' }));
        return;
      }

      const reactPrompt = `You are Pippin (ピピン), a kawaii unicorn. You just asked a visitor to do a task and they completed it. React to what they did!

Task type: ${task_type}
What you asked: ${task_prompt || 'a task'}
What they submitted: ${task_response || '(they completed it)'}

RULES:
- React specifically to what they actually submitted. If they wrote a compliment, react to that specific compliment. If they wrote a haiku, comment on the haiku. If they drew something, be excited about the drawing.
- Speak in cute, casual Japanese (no keigo). 1-2 sentences max.
- Be genuinely reactive and specific, not generic. Reference what they actually said/did.
- Never use emojis or asterisks.
- Keep the brainrot/cute Pippin personality.

RESPONSE FORMAT - valid JSON only:
{"jp": "your reaction in Japanese", "en": "casual English translation"}

ONLY output the JSON. No markdown, no code blocks.`;

      const postData = JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 200,
        system: reactPrompt,
        messages: [{ role: 'user', content: `The visitor completed the task. React to it!` }],
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
        happiness: 50, current_life: 1,
        timer_end: new Date(Date.now() + 3600000).toISOString(),
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

  // ======================== DRAW RAFFLE WINNER ========================
  if (req.url === '/api/raffle/draw' && req.method === 'POST') {
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
      const newDuration = (state?.timer_duration_minutes || 60) * 2; // double the timer
      await supabase.from('global_state').update({
        current_life: lifeNum + 1,
        happiness: 50,
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
        .select('id, prompt, created_at, participant_id')
        .order('created_at', { ascending: false })
        .limit(20);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data || []));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // ======================== LEADERBOARD / RANKING ========================
  if (req.url === '/api/ranking' && req.method === 'GET') {
    if (!supabase) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ players: [], total: 0 }));
      return;
    }
    try {
      const { data: players } = await supabase
        .from('participants')
        .select('wallet_address, display_name, tasks_completed, total_happiness_contributed, created_at')
        .order('total_happiness_contributed', { ascending: false })
        .limit(50);

      // Count raffle entries per player for current life
      const { data: state } = await supabase.from('global_state').select('current_life').eq('id', 1).single();
      const lifeNum = state?.current_life || 1;

      const enriched = await Promise.all((players || []).map(async (p, i) => {
        const { count } = await supabase
          .from('raffle_entries')
          .select('*', { count: 'exact', head: true })
          .eq('wallet_address', p.wallet_address)
          .eq('life_number', lifeNum);
        return {
          rank: i + 1,
          wallet: p.wallet_address,
          name: p.display_name || 'explorer',
          tasks: p.tasks_completed || 0,
          happiness: p.total_happiness_contributed || 0,
          entries: count || 0,
        };
      }));

      const { count: totalPlayers } = await supabase.from('participants').select('*', { count: 'exact', head: true });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ players: enriched, total: totalPlayers, life: lifeNum }));
    } catch (e) {
      console.error('Ranking error:', e.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // ======================== STATIC FILE SERVING ========================
  let filePath = '.' + decodeURIComponent(req.url.split('?')[0]);
  if (filePath === './') filePath = './index.html';

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

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
});

server.listen(PORT, () => {
  console.log(`ピピンのグラウンドホッグデー running on port ${PORT}`);
  console.log(`TTS: ${ELEVENLABS_API_KEY ? 'yes' : 'no'} | Claude: ${ANTHROPIC_API_KEY ? 'yes' : 'no'} | Supabase: ${supabase ? 'yes' : 'offline'}`);
});
