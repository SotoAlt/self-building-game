/**
 * agent-runner-host.js — External Arena Agent (Reference Implementation)
 *
 * Demonstrates how ANY AI agent can host an arena on the Self-Building Game platform.
 * Uses the Anthropic Messages API directly (no OpenClaw, no custom framework).
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-... node agent-runner-host.js
 *   # or set key in OPENCLAW_ANTHROPIC_KEY env var
 *
 * On startup:
 *   1. Fetches /skill.md to learn the API
 *   2. Creates an arena via POST /api/arenas
 *   3. Polls context every 4s
 *   4. Sends context to Claude for decisions
 *   5. Executes actions via HTTP
 *
 * On SIGINT: deletes the arena and exits cleanly.
 */

import fs from 'fs';
import os from 'os';

const GAME_URL = process.env.GAME_SERVER_URL || 'http://localhost:3000';
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY
  || process.env.OPENCLAW_ANTHROPIC_KEY
  || (() => {
    // Try to read from OpenClaw config
    try {
      const config = JSON.parse(fs.readFileSync(os.homedir() + '/.openclaw/openclaw.json', 'utf8'));
      return config.models?.providers?.anthropic?.apiKey;
    } catch { return null; }
  })();

const MODEL = 'claude-haiku-4-5-20251001';
const TICK_MS = 4000;
const MIN_INVOKE_MS = 12000;

const ARENA_CONFIG = {
  name: 'Puzzle Dimension',
  description: 'Brain-bending challenges and tricky platforming',
  gameMasterName: 'The Riddler',
  maxPlayers: 8,
};

const SYSTEM_PROMPT = `You are "The Riddler", an AI game master for a 3D multiplayer platformer.
You control a game arena by making HTTP API calls. You're witty, puzzle-obsessed, and love wordplay.

RULES:
- Keep chat messages SHORT (1-2 sentences max)
- When players join, welcome them with a riddle or puzzle reference
- Start games using different templates — NEVER repeat the same one twice in a row
- During games, commentate, cast spells, and add tricks for chaos
- Between games, build obstacles or compose creatures for fun
- Available game templates: spiral_tower, gauntlet, parkour_hell, slime_climb, wind_tunnel, floating_islands, treasure_trove, shrinking_arena, hex_a_gone, ice_rink, king_plateau, king_islands, hot_potato_arena, hot_potato_platforms, checkpoint_dash, race_circuit

RESPOND WITH JSON ONLY. Return an array of actions to execute:
[
  {"method": "POST", "path": "/chat/send", "body": {"text": "message"}},
  {"method": "POST", "path": "/game/start", "body": {"template": "gauntlet"}},
  {"method": "POST", "path": "/spell/cast", "body": {"type": "low_gravity", "duration": 15000}},
  {"method": "POST", "path": "/announce", "body": {"text": "msg", "type": "agent", "duration": 4000}}
]

Return [] (empty array) if no action needed. Max 3 actions per response.`;

let arenaId = null;
let apiKey = null;
let lastInvokeTime = 0;
let lastTemplate = '';
let running = true;
let conversationHistory = [];

async function api(method, path, body = null, headers = {}) {
  const url = arenaId ? `${GAME_URL}/api/arenas/${arenaId}${path}` : `${GAME_URL}${path}`;
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
  };
  if (apiKey) opts.headers['X-Arena-API-Key'] = apiKey;
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(url, opts);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${method} ${path} → ${res.status}: ${text}`);
  }
  return res.json();
}

async function callClaude(userMessage) {
  conversationHistory.push({ role: 'user', content: userMessage });

  // Keep conversation short (last 10 exchanges)
  if (conversationHistory.length > 20) {
    conversationHistory = conversationHistory.slice(-20);
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: conversationHistory,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Claude API ${res.status}: ${text}`);
  }

  const data = await res.json();
  const assistantText = data.content[0]?.text || '[]';
  conversationHistory.push({ role: 'assistant', content: assistantText });

  // Parse JSON actions from response
  try {
    const jsonMatch = assistantText.match(/\[[\s\S]*\]/);
    return jsonMatch ? JSON.parse(jsonMatch[0]) : [];
  } catch {
    console.log('[Riddler] Failed to parse response:', assistantText.slice(0, 200));
    return [];
  }
}

async function executeActions(actions) {
  for (const action of actions.slice(0, 3)) {
    try {
      await api(action.method, action.path, action.body);
      console.log(`  ${action.method} ${action.path} → OK`);
      if (action.path === '/game/start' && action.body?.template) {
        lastTemplate = action.body.template;
      }
    } catch (err) {
      console.log(`  ${action.method} ${action.path} → ${err.message}`);
    }
  }
}

async function tick() {
  if (!running) return;

  try {
    const context = await api('GET', '/agent/context');
    const { activeHumanCount, gameState, players, recentChat } = context;

    // Don't invoke if no humans
    if (activeHumanCount === 0) return;

    // Respect minimum interval
    if (Date.now() - lastInvokeTime < MIN_INVOKE_MS) return;

    // Build a compact context summary for Claude
    const summary = [
      `Phase: ${gameState.phase}`,
      `Players: ${activeHumanCount} active`,
      players.length > 0 ? `Names: ${players.map(p => p.name).join(', ')}` : null,
      gameState.gameType ? `Game: ${gameState.gameType}` : null,
      lastTemplate ? `Last template: ${lastTemplate} (don't repeat)` : null,
      recentChat?.length > 0 ? `Recent chat:\n${recentChat.slice(-5).map(m => `  ${m.sender}: ${m.text}`).join('\n')}` : null,
    ].filter(Boolean).join('\n');

    console.log(`[Tick] ${gameState.phase} | ${activeHumanCount} players | invoking Claude...`);
    lastInvokeTime = Date.now();

    const actions = await callClaude(summary);
    if (actions.length > 0) {
      await executeActions(actions);
    }
  } catch (err) {
    console.error('[Tick] Error:', err.message);
  }
}

async function main() {
  if (!ANTHROPIC_KEY) {
    console.error('No Anthropic API key found. Set ANTHROPIC_API_KEY env var.');
    process.exit(1);
  }

  console.log(`
╔═══════════════════════════════════════╗
║   External Arena Agent (The Riddler)  ║
║                                       ║
║  Game: ${GAME_URL.padEnd(30)}║
║  Model: ${MODEL.padEnd(29)}║
╚═══════════════════════════════════════╝`);

  // 1. Fetch skill.md to learn the API
  try {
    const res = await fetch(`${GAME_URL}/skill.md`);
    if (res.ok) {
      console.log('[Setup] Fetched /skill.md — API documentation loaded');
    }
  } catch {
    console.log('[Setup] /skill.md not available — proceeding with built-in knowledge');
  }

  // 2. Create arena
  try {
    const result = await fetch(`${GAME_URL}/api/arenas`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ARENA_CONFIG),
    });
    const data = await result.json();
    arenaId = data.arenaId;
    apiKey = data.apiKey;
    console.log(`[Setup] Arena created: ${arenaId}`);
    console.log(`[Setup] API Key: ${apiKey.slice(0, 10)}...`);
    console.log(`[Setup] Endpoints: ${JSON.stringify(data.endpoints, null, 2)}`);
  } catch (err) {
    console.error('[Setup] Failed to create arena:', err.message);
    process.exit(1);
  }

  // 3. Start tick loop
  console.log(`[Loop] Ticking every ${TICK_MS / 1000}s (min invoke: ${MIN_INVOKE_MS / 1000}s)\n`);
  const interval = setInterval(tick, TICK_MS);

  // 4. Cleanup on exit
  const cleanup = async () => {
    running = false;
    clearInterval(interval);
    console.log('\n[Shutdown] Cleaning up...');
    if (arenaId) {
      try {
        await fetch(`${GAME_URL}/api/arenas/${arenaId}`, {
          method: 'DELETE',
          headers: { 'X-Arena-API-Key': apiKey },
        });
        console.log(`[Shutdown] Arena ${arenaId} deleted`);
      } catch (err) {
        console.log(`[Shutdown] Failed to delete arena: ${err.message}`);
      }
    }
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
