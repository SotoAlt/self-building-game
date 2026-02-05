#!/usr/bin/env node
/**
 * Agent Runner - Standalone process that bridges the game server and OpenClaw
 *
 * Runs on the host (not in Docker) alongside the OpenClaw gateway.
 * Polls the game server for context, decides when to invoke the agent,
 * and uses `openclaw agent` CLI to send messages.
 */

import { execSync } from 'child_process';

const GAME_URL = process.env.GAME_SERVER_URL || 'http://localhost:3000';
const TICK_INTERVAL = parseInt(process.env.TICK_INTERVAL || '8000');
const SESSION_ID = process.env.OPENCLAW_SESSION_ID || `chaos-game-${Date.now().toString(36)}`;

// State
let lastInvokeTime = 0;
let gamesPlayed = 0;
let phase = 'welcome';
let sessionStartTime = Date.now();
let invoking = false;

async function gameAPI(endpoint) {
  const res = await fetch(`${GAME_URL}${endpoint}`);
  if (!res.ok) throw new Error(`${endpoint}: ${res.status}`);
  return res.json();
}

function calculateDrama(context) {
  let drama = 0;
  const gs = context.gameState;

  if (gs.phase === 'playing') drama += 30;
  drama += Math.min(context.playerCount * 5, 20);

  const recentDeaths = context.events?.filter(e =>
    e.type === 'player_death' && Date.now() - e.timestamp < 10000
  ).length || 0;
  drama += recentDeaths * 10;

  const recentChats = context.recentChat?.filter(m =>
    Date.now() - m.timestamp < 30000
  ).length || 0;
  drama += Math.min(recentChats * 5, 15);

  const agentMentions = context.recentChat?.filter(m =>
    m.text?.includes('@agent') && Date.now() - m.timestamp < 30000
  ).length || 0;
  drama += agentMentions * 15;

  const timeSinceInvoke = (Date.now() - lastInvokeTime) / 1000;
  drama -= Math.floor(timeSinceInvoke / 10) * 2;

  return Math.max(0, Math.min(100, drama));
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

function shouldInvoke(phase, drama, context) {
  const humanCount = (context.players || []).filter(p => p.type !== 'ai').length;
  if (humanCount === 0) return false;

  const elapsed = Date.now() - lastInvokeTime;
  if (elapsed < 15000) return false; // minimum 15s between invocations

  // Always invoke on @agent mentions
  const hasAgentMention = context.recentChat?.some(m =>
    m.text?.includes('@agent') && m.timestamp > lastInvokeTime
  );
  if (hasAgentMention) return true;

  // Invoke based on phase (conservative intervals)
  if (phase === 'welcome' && elapsed > 25000) return true;
  if (phase === 'warmup' && elapsed > 35000) return true;
  if (phase === 'gaming' && elapsed > 30000) return true;
  if (phase === 'intermission' && elapsed > 25000) return true;
  if (phase === 'escalation' && elapsed > 25000) return true;
  if (phase === 'finale' && elapsed > 20000) return true;

  // Drama-driven
  if (drama > 70 && elapsed > 20000) return true;

  return elapsed > 45000; // default: every 45s
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

  let dramaLabel;
  if (drama >= 80) dramaLabel = '(EXPLOSIVE!)';
  else if (drama >= 60) dramaLabel = '(intense)';
  else if (drama >= 40) dramaLabel = '(building)';
  else if (drama >= 20) dramaLabel = '(warming up)';
  else dramaLabel = '(quiet - liven things up!)';
  parts.push(`\n**Drama Level**: ${drama}/100 ${dramaLabel}`);

  parts.push(`\n**World State**:`);
  parts.push(`- Players: ${context.playerCount} online`);
  if (context.players?.length > 0) {
    parts.push(`- Player list: ${context.players.map(p => `${p.name} (${p.state})`).join(', ')}`);
  }
  parts.push(`- Entities: ${context.entityCount} in world`);
  parts.push(`- Game phase: ${context.gameState.phase}`);
  if (context.gameState.gameType) parts.push(`- Game type: ${context.gameState.gameType}`);
  parts.push(`- Games played: ${gamesPlayed}`);
  if (context.cooldownUntil > Date.now()) {
    const remaining = Math.ceil((context.cooldownUntil - Date.now()) / 1000);
    parts.push(`- Cooldown: ${remaining}s remaining (cannot start new game yet)`);
  }

  if (context.recentChat?.length > 0) {
    parts.push(`\n**Recent Chat**:`);
    for (const msg of context.recentChat.slice(-5)) {
      parts.push(`  [${msg.senderType}] ${msg.sender}: ${msg.text}`);
    }
  }

  const requests = context.recentChat?.filter(m =>
    m.text?.includes('@agent') && m.timestamp > lastInvokeTime
  ) || [];
  if (requests.length > 0) {
    parts.push(`\n**Player Requests (RESPOND TO THESE)**:`);
    for (const req of requests) {
      parts.push(`  - ${req.sender}: "${req.text}"`);
    }
  }

  return parts.join('\n');
}

async function invokeAgent(message) {
  // Write message to temp file to avoid shell escaping issues
  const tmpFile = `/tmp/agent-msg-${Date.now()}.txt`;
  const { writeFileSync, unlinkSync } = await import('fs');
  writeFileSync(tmpFile, message);

  try {
    const result = execSync(
      `openclaw agent --session-id "${SESSION_ID}" --message "$(cat ${tmpFile})" --timeout 30 2>&1`,
      { timeout: 35000, encoding: 'utf-8' }
    );
    console.log(`[Agent] Response received (${result.length} chars)`);
    return result;
  } catch (err) {
    console.error(`[Agent] Invoke failed: ${err.message?.slice(0, 200)}`);
    throw err;
  } finally {
    try { unlinkSync(tmpFile); } catch {}
  }
}

async function tick() {
  if (invoking) return;

  try {
    const context = await gameAPI('/api/agent/context');
    const drama = calculateDrama(context);
    const newPhase = detectPhase(context);

    if (newPhase !== phase) {
      console.log(`[Phase] ${phase} → ${newPhase}`);
      phase = newPhase;
    }

    if (context.gameState.phase === 'ended' && phase === 'intermission') {
      gamesPlayed++;
    }

    if (!shouldInvoke(phase, drama, context)) return;

    const message = buildPrompt(phase, context, drama);
    console.log(`[Tick] Invoking agent (phase=${phase}, drama=${drama}, players=${context.playerCount})`);

    invoking = true;
    lastInvokeTime = Date.now();

    try {
      await invokeAgent(message);
    } finally {
      invoking = false;
    }
  } catch (err) {
    invoking = false;
    if (err.message?.includes('ECONNREFUSED')) {
      // Game server not ready yet
    } else {
      console.error(`[Tick] Error: ${err.message?.slice(0, 200)}`);
    }
  }
}

// Start
console.log(`
╔═══════════════════════════════════════╗
║     Chaos Magician Agent Runner       ║
║                                       ║
║  Game: ${GAME_URL.padEnd(30)}║
║  Session: ${SESSION_ID.slice(0, 27).padEnd(27)}║
║  Tick: ${(TICK_INTERVAL / 1000 + 's').padEnd(31)}║
╚═══════════════════════════════════════╝
`);

setInterval(tick, TICK_INTERVAL);
// First tick after 5s to let services start
setTimeout(tick, 5000);
