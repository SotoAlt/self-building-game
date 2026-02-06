#!/usr/bin/env node
/**
 * Agent Runner - Standalone process that bridges the game server and OpenClaw
 *
 * Runs on the host (not in Docker) alongside the OpenClaw gateway.
 * Polls the game server for context, decides when to invoke the agent,
 * and uses `openclaw agent` CLI to send messages.
 *
 * v0.13.0 — Enriched context, faster @mention response, state tracking
 */

import { execFile } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';

const GAME_URL = process.env.GAME_SERVER_URL || 'http://localhost:3000';
const TICK_INTERVAL = parseInt(process.env.TICK_INTERVAL || '2000'); // 2s ticks (was 5s)
const SESSION_ID = process.env.OPENCLAW_SESSION_ID || `chaos-game-${Date.now().toString(36)}`;

// State
let lastInvokeTime = 0;
let gamesPlayed = 0;
let phase = 'welcome';
let sessionStartTime = Date.now();
let invoking = false;
let lastSuccessfulInvoke = 0; // suppress fetch errors right after invoke

// Tracking — avoid re-processing old data
let lastProcessedChatId = 0;
let welcomedPlayers = new Set();
let lastGameEndedPhase = false; // prevent double-counting gamesPlayed

async function gameAPI(endpoint) {
  const res = await fetch(`${GAME_URL}${endpoint}`);
  if (!res.ok) throw new Error(`${endpoint}: ${res.status}`);
  return res.json();
}

async function gameAPIWithRetry(endpoint, retries = 1) {
  try {
    return await gameAPI(endpoint);
  } catch (err) {
    if (retries > 0 && err.message?.includes('fetch failed')) {
      await new Promise(r => setTimeout(r, 2000));
      return gameAPIWithRetry(endpoint, retries - 1);
    }
    throw err;
  }
}

function calculateDrama(context) {
  let drama = 0;
  const gs = context.gameState;

  if (gs.phase === 'playing') drama += 30;
  drama += Math.min(context.playerCount * 5, 20);

  const recentDeaths = context.recentEvents?.filter(e =>
    e.type === 'player_death' && Date.now() - e.timestamp < 10000
  ).length || 0;
  drama += recentDeaths * 10;

  const recentChats = context.recentChat?.filter(m =>
    Date.now() - m.timestamp < 30000
  ).length || 0;
  drama += Math.min(recentChats * 5, 15);

  const newMentions = getNewMentions(context);
  drama += newMentions.length * 15;

  const timeSinceInvoke = (Date.now() - lastInvokeTime) / 1000;
  drama -= Math.floor(timeSinceInvoke / 10) * 2;

  return Math.max(0, Math.min(100, drama));
}

function getNewMentions(context) {
  return (context.recentChat || []).filter(m =>
    m.text?.includes('@agent') && m.id > lastProcessedChatId
  );
}

function detectPhase(context) {
  const elapsed = (Date.now() - sessionStartTime) / 1000;
  const gs = context.gameState;

  if (elapsed < 30 && gamesPlayed === 0) return 'welcome';
  if (gs.phase === 'playing') {
    if (gamesPlayed >= 6) return 'finale';
    if (gamesPlayed >= 3) return 'escalation';
    return 'gaming';
  }
  if (gs.phase === 'ended') return 'intermission';
  if (gamesPlayed === 0) return 'warmup';
  return 'intermission';
}

const PHASE_INTERVALS = {
  welcome: 25000,
  warmup: 35000,
  gaming: 30000,
  intermission: 25000,
  escalation: 25000,
  finale: 20000,
};

function shouldInvoke(phase, drama, context) {
  const humanCount = (context.players || []).filter(p => p.type !== 'ai').length;
  if (humanCount === 0) return false;

  const elapsed = Date.now() - lastInvokeTime;

  // Fast-track: @agent mentions or pending welcomes (3s minimum)
  if (elapsed >= 3000) {
    if (getNewMentions(context).length > 0) return true;
    if (getNewWelcomes(context).length > 0) return true;
  }

  // Standard minimum interval for non-urgent invocations
  if (elapsed < 15000) return false;

  // Phase-based interval
  const phaseInterval = PHASE_INTERVALS[phase] || 45000;
  if (elapsed > phaseInterval) return true;

  // Drama-driven
  if (drama > 70 && elapsed > 20000) return true;

  return elapsed > 45000;
}

function getNewWelcomes(context) {
  return (context.pendingWelcomes || []).filter(w => !welcomedPlayers.has(w.playerId || w.name));
}

function buildPrompt(phase, context, drama) {
  const parts = [];

  const phasePrompts = {
    welcome: `**Phase: WELCOME** — Players are joining! Greet them dramatically. Introduce yourself as the Chaos Magician. Tease what's coming. Use send_chat_message and announce tools. If you have enough players, start building an arena (clear_world, then spawn entities or load_template).`,
    warmup: `**Phase: WARMUP** — Time to build an arena! Use clear_world first, then either load_template or spawn entities manually. Set the respawn point with set_respawn. When ready, start a game with start_game. Keep chatting to build hype.`,
    gaming: `**Phase: GAMING** — A game is active! Commentate, cast spells, add tricks, modify physics. Do NOT use clear_world or load_template (server will reject these).`,
    intermission: `**Phase: INTERMISSION** — Game just ended. Cooldown is active for a few seconds. Chat about the results, congratulate winners. After cooldown, build a new arena and start the next game.`,
    escalation: `**Phase: ESCALATION** — ${gamesPlayed} games deep! Ramp up difficulty. Harder templates (parkour_hell, gauntlet). More spells, more tricks, shorter time limits.`,
    finale: `**Phase: FINALE** — Grand finale! Maximum chaos. Multiple spells active. Hardest arenas. Epic commentary. Make it memorable!`
  };

  parts.push(phasePrompts[phase] || `**Phase: ${phase}** — Keep the game entertaining.`);

  // Creative palette reminder
  parts.push(`\n**Your palette**: Types: platform, ramp, obstacle, collectible, trigger, decoration. Shapes (properties.shape): box, sphere, cylinder, cone, pyramid, torus, dodecahedron, ring. Decorations have no collision — use them for visual flair.`);

  // Drama level
  let dramaLabel;
  if (drama >= 80) dramaLabel = '(EXPLOSIVE!)';
  else if (drama >= 60) dramaLabel = '(intense)';
  else if (drama >= 40) dramaLabel = '(building)';
  else if (drama >= 20) dramaLabel = '(warming up)';
  else dramaLabel = '(quiet - liven things up!)';
  parts.push(`\n**Drama Level**: ${drama}/100 ${dramaLabel}`);

  // World state
  parts.push(`\n**World State**:`);
  parts.push(`- Players: ${context.playerCount} online`);
  if (context.players?.length > 0) {
    parts.push(`- Player list: ${context.players.map(p => `${p.name} (${p.state})`).join(', ')}`);
  }
  parts.push(`- Entities: ${context.entityCount} in world`);
  parts.push(`- Game phase: ${context.gameState.phase}`);
  if (context.gameState.gameType) parts.push(`- Current game: ${context.gameState.gameType}`);
  parts.push(`- Games played: ${gamesPlayed}`);

  // Cooldown
  if (context.cooldownUntil > Date.now()) {
    const remaining = Math.ceil((context.cooldownUntil - Date.now()) / 1000);
    parts.push(`- ⏳ Cooldown: ${remaining}s remaining (cannot start new game yet)`);
  }

  // Active effects
  if (context.activeEffects?.length > 0) {
    parts.push(`- Active spells: ${context.activeEffects.map(e => e.type).join(', ')}`);
  }

  // Leaderboard
  if (context.leaderboard?.length > 0) {
    const top3 = context.leaderboard.slice(0, 3);
    parts.push(`\n**Leaderboard (Top 3)**:`);
    top3.forEach((entry, i) => {
      parts.push(`  ${i + 1}. ${entry.name} — ${entry.wins}W/${entry.losses}L`);
    });
  }

  // Game variety hint
  if (context.lastGameType) {
    const suggested = (context.suggestedGameTypes || []).join(', ');
    parts.push(`\n**Variety**: Last game was "${context.lastGameType}". Try: ${suggested}`);
  }

  // Pending welcomes — new players to greet
  const newWelcomes = getNewWelcomes(context);
  if (newWelcomes.length > 0) {
    parts.push(`\n**NEW PLAYERS — GREET THESE** (use send_chat_message):`);
    for (const w of newWelcomes) {
      parts.push(`  - ${w.name} just joined!`);
    }
  }

  // Recent chat (last 10 messages, only ones we haven't processed)
  const newMessages = (context.recentChat || []).filter(m => m.id > lastProcessedChatId);
  if (newMessages.length > 0) {
    parts.push(`\n**Recent Chat** (new since last check):`);
    for (const msg of newMessages.slice(-10)) {
      parts.push(`  [${msg.senderType}] ${msg.sender}: ${msg.text}`);
    }
  } else if (context.recentChat?.length > 0) {
    // Show last few for context even if already processed
    parts.push(`\n**Recent Chat**:`);
    for (const msg of context.recentChat.slice(-5)) {
      parts.push(`  [${msg.senderType}] ${msg.sender}: ${msg.text}`);
    }
  }

  // @agent mentions — urgent requests
  const mentions = getNewMentions(context);
  if (mentions.length > 0) {
    parts.push(`\n**🚨 Player Requests (RESPOND TO THESE FIRST)**:`);
    for (const req of mentions) {
      parts.push(`  - ${req.sender}: "${req.text}"`);
    }
  }

  // Recent deaths
  const recentDeaths = (context.recentEvents || []).filter(e =>
    e.type === 'player_death' && Date.now() - e.timestamp < 15000
  );
  if (recentDeaths.length > 0) {
    parts.push(`\n**Recent Deaths** (last 15s): ${recentDeaths.length} player(s) died`);
  }

  return parts.join('\n');
}

function invokeAgent(message) {
  return new Promise((resolve, reject) => {
    const tmpFile = `/tmp/agent-msg-${Date.now()}.txt`;
    writeFileSync(tmpFile, message);

    execFile('sh', ['-c', `openclaw agent --session-id "${SESSION_ID}" --message "$(cat ${tmpFile})" --timeout 30 2>&1`], {
      timeout: 35000,
      encoding: 'utf-8',
      maxBuffer: 1024 * 1024
    }, (err, stdout) => {
      try { unlinkSync(tmpFile); } catch {}
      if (err) {
        console.error(`[Agent] Invoke failed: ${err.message?.slice(0, 200)}`);
        reject(err);
      } else {
        console.log(`[Agent] Response received (${stdout.length} chars)`);
        resolve(stdout);
      }
    });
  });
}

function updateTracking(context) {
  // Track highest chat message ID we've seen
  if (context.recentChat?.length > 0) {
    const maxId = Math.max(...context.recentChat.map(m => m.id));
    if (maxId > lastProcessedChatId) lastProcessedChatId = maxId;
  }

  // Track welcomed players
  for (const w of getNewWelcomes(context)) {
    welcomedPlayers.add(w.playerId || w.name);
  }

  // Track game count (prevent double-counting)
  const gameEnded = context.gameState.phase === 'ended';
  if (gameEnded && !lastGameEndedPhase) {
    gamesPlayed++;
    console.log(`[Game] Game #${gamesPlayed} ended`);
  }
  lastGameEndedPhase = gameEnded;
}

async function tick() {
  if (invoking) return;

  try {
    const context = await gameAPIWithRetry('/api/agent/context');
    const drama = calculateDrama(context);
    const newPhase = detectPhase(context);

    if (newPhase !== phase) {
      console.log(`[Phase] ${phase} → ${newPhase}`);
      phase = newPhase;
    }

    // Update tracking before invoke decision
    updateTracking(context);

    if (!shouldInvoke(phase, drama, context)) return;

    const message = buildPrompt(phase, context, drama);
    const mentions = getNewMentions(context);
    const welcomes = getNewWelcomes(context);
    console.log(`[Tick] Invoking agent (phase=${phase}, drama=${drama}, players=${context.playerCount}, mentions=${mentions.length}, welcomes=${welcomes.length})`);

    invoking = true;
    lastInvokeTime = Date.now();

    try {
      await invokeAgent(message);
      lastSuccessfulInvoke = Date.now();
    } finally {
      invoking = false;
    }
  } catch (err) {
    invoking = false;
    if (err.message?.includes('ECONNREFUSED')) {
      // Game server not ready yet — silent
    } else if (err.message?.includes('fetch failed') && Date.now() - lastSuccessfulInvoke < 5000) {
      // Suppress fetch errors immediately after successful invoke (server busy)
      console.log(`[Tick] Context fetch failed (post-invoke, suppressed)`);
    } else {
      console.error(`[Tick] Error: ${err.message?.slice(0, 200)}`);
    }
  }
}

// Start
console.log(`
╔═══════════════════════════════════════╗
║   Chaos Magician Agent Runner v0.15  ║
║                                       ║
║  Game: ${GAME_URL.padEnd(30)}║
║  Session: ${SESSION_ID.slice(0, 27).padEnd(27)}║
║  Tick: ${(TICK_INTERVAL / 1000 + 's').padEnd(31)}║
╚═══════════════════════════════════════╝
`);

setInterval(tick, TICK_INTERVAL);
// First tick after 5s to let services start
setTimeout(tick, 5000);
