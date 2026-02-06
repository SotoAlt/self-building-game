#!/usr/bin/env node
/**
 * Agent Runner - Standalone process that bridges the game server and OpenClaw
 *
 * Runs on the host (not in Docker) alongside the OpenClaw gateway.
 * Polls the game server for context, decides when to invoke the agent,
 * and uses `openclaw agent` CLI to send messages.
 *
 * v0.17.0 — Lobby pacing: proper lobby phase, lobby timer, rewritten phase prompts
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

  const newMentions = getNewPlayerMentions(context);
  drama += newMentions.length * 15;

  const timeSinceInvoke = (Date.now() - lastInvokeTime) / 1000;
  drama -= Math.floor(timeSinceInvoke / 10) * 2;

  return Math.max(0, Math.min(100, drama));
}

function getNewPlayerMentions(context) {
  return (context.recentChat || []).filter(m =>
    m.id > lastProcessedChatId &&
    m.senderType !== 'audience' &&
    m.senderType !== 'agent' &&
    m.senderType !== 'system' &&
    m.text?.includes('@agent')
  );
}

function getNewAudienceMessages(context) {
  return (context.recentChat || []).filter(m =>
    m.id > lastProcessedChatId &&
    m.senderType === 'audience'
  );
}

function detectPhase(context) {
  const elapsed = (Date.now() - sessionStartTime) / 1000;
  const gs = context.gameState;

  if (elapsed < 30 && gamesPlayed === 0) return 'welcome';
  if (gs.phase === 'countdown') return 'gaming';
  if (gs.phase === 'playing') {
    if (gamesPlayed >= 6) return 'finale';
    if (gamesPlayed >= 3) return 'escalation';
    return 'gaming';
  }
  if (gs.phase === 'ended') return 'intermission';
  // lobby or building phase
  return 'lobby';
}

const PHASE_INTERVALS = {
  welcome: 25000,
  lobby: 20000,
  gaming: 30000,
  intermission: 25000,
  escalation: 25000,
  finale: 20000,
};

function shouldInvoke(phase, drama, context) {
  const humanCount = (context.players || []).filter(p => p.type !== 'ai').length;
  const hasAudienceChat = getNewAudienceMessages(context).length > 0;
  const hasPlayerMentions = getNewPlayerMentions(context).length > 0;
  // Allow invocation if humans are in-game OR audience is chatting
  if (humanCount === 0 && !hasAudienceChat && !hasPlayerMentions) return false;

  const elapsed = Date.now() - lastInvokeTime;

  // Fast-track: in-game @agent mentions or pending welcomes (3s minimum)
  if (elapsed >= 3000) {
    if (hasPlayerMentions) return true;
    if (getNewWelcomes(context).length > 0) return true;
  }

  // Audience-only mode (no in-game players): slower pace (30s minimum)
  if (humanCount === 0 && hasAudienceChat) {
    return elapsed >= 30000;
  }

  // Standard minimum interval for non-urgent invocations
  if (elapsed < 15000) return false;

  // Audience messages at standard interval (don't fast-track)
  if (hasAudienceChat) return true;

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
    welcome: `**Phase: WELCOME** — A player just joined! Greet them as the Chaos Magician. Be dramatic and introduce yourself. Tease the chaos to come. DO NOT load templates, spawn entities, or start games. ONLY chat.`,
    lobby: `**Phase: LOBBY** — Players are hanging out. Chat casually, tell jokes, react to chat. When the lobby timer expires (shown below), announce the next game and load a template. Do NOT start a game in the same turn as loading a template.`,
    gaming: `**Phase: GAMING** — A game is active! Commentate, cast spells, add tricks. Do NOT use clear_world or load_template (server will reject these).`,
    intermission: `**Phase: INTERMISSION** — Game just ended! Announce results, congratulate winners, roast losers. Chat about what happened. Do NOT build or start anything yet — cooldown and lobby timer must expire first.`,
    escalation: `**Phase: ESCALATION** — ${gamesPlayed} games deep! Ramp up difficulty. Harder templates, more spells, shorter time limits.`,
    finale: `**Phase: FINALE** — Grand finale! Maximum chaos. Epic commentary. Make it memorable!`
  };

  // Chat-only mode: audience is chatting but no one is in-game
  const humanCount = (context.players || []).filter(p => p.type !== 'ai').length;
  const bridgeOnly = humanCount === 0 && getNewAudienceMessages(context).length > 0;

  if (bridgeOnly) {
    parts.push(`**CHAT-ONLY MODE** — People are chatting from Twitch/Discord/Telegram but nobody is playing the game yet. ONLY use send_chat_message to chat with them. Do NOT spawn entities, start games, or cast spells — there's no one in the world to see them. Be friendly, tease the game, invite them to join at https://chaos.waweapps.win`);
  } else {
    parts.push(phasePrompts[phase] || `**Phase: ${phase}** — Keep the game entertaining.`);

    // Creative palette reminder
    parts.push(`\n**Your palette**: Types: platform, ramp, obstacle, collectible, trigger, decoration. Shapes (properties.shape): box, sphere, cylinder, cone, pyramid, torus, dodecahedron, ring. Decorations have no collision — use them for visual flair.`);

    parts.push(`\n**PACING**: Max 3 world-changing actions this turn. Do NOT load_template AND start_game in the same turn (10s build gap enforced). Spell cooldown: 10s between casts.`);
  }

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

  // Active cooldowns
  const now = Date.now();
  const lobbyTimerActive = context.lobbyReadyAt > now;
  const cooldowns = [
    [context.lobbyReadyAt, 'Lobby timer', 'cannot load templates or start games yet'],
    [context.cooldownUntil, 'Cooldown', 'cannot start new game yet'],
    [context.spellCooldownUntil, 'Spell cooldown', 'cast blocked'],
    [context.buildGapUntil, 'Build gap', "can't start game yet — hype the arena!"],
  ];
  for (const [until, label, hint] of cooldowns) {
    if (until > now) {
      const remaining = Math.ceil((until - now) / 1000);
      parts.push(`- ⏳ ${label}: ${remaining}s (${hint})`);
    }
  }
  if (!lobbyTimerActive && context.gameState.phase === 'lobby') {
    parts.push(`- ✅ Lobby timer expired — you can now load a template!`);
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
      parts.push(`  ${i + 1}. ${entry.name} — ${entry.wins} wins (${entry.totalScore} pts)`);
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

  // In-game @agent mentions — highest priority
  const playerMentions = getNewPlayerMentions(context);
  if (playerMentions.length > 0) {
    parts.push(`\n**🚨 Player Requests (RESPOND TO THESE FIRST)**:`);
    for (const req of playerMentions) {
      parts.push(`  - ${req.sender}: "${req.text}"`);
    }
  }

  // Audience messages — lower priority
  const audienceMessages = getNewAudienceMessages(context);
  if (audienceMessages.length > 0) {
    parts.push(`\n**📺 Audience Chat (lower priority, respond casually)**:`);
    for (const msg of audienceMessages.slice(-5)) {
      parts.push(`  - ${msg.sender}: "${msg.text}"`);
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

    // Check for invocation BEFORE updating tracking (so new messages are visible)
    if (!shouldInvoke(phase, drama, context)) {
      updateTracking(context);
      return;
    }

    const message = buildPrompt(phase, context, drama);
    const mentions = getNewPlayerMentions(context);
    const audience = getNewAudienceMessages(context);
    const welcomes = getNewWelcomes(context);
    console.log(`[Tick] Invoking agent (phase=${phase}, drama=${drama}, players=${context.playerCount}, mentions=${mentions.length}, audience=${audience.length}, welcomes=${welcomes.length})`);

    // Update tracking AFTER building prompt (so prompt includes the new messages)
    updateTracking(context);

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
║   Chaos Magician Agent Runner v0.17  ║
║                                       ║
║  Game: ${GAME_URL.padEnd(30)}║
║  Session: ${SESSION_ID.slice(0, 27).padEnd(27)}║
║  Tick: ${(TICK_INTERVAL / 1000 + 's').padEnd(31)}║
╚═══════════════════════════════════════╝
`);

setInterval(tick, TICK_INTERVAL);
// First tick after 5s to let services start
setTimeout(tick, 5000);
