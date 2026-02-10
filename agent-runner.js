#!/usr/bin/env node
/**
 * Agent Runner - Standalone process that bridges the game server and OpenClaw
 *
 * Runs on the host (not in Docker) alongside the OpenClaw gateway.
 * Polls the game server for context, decides when to invoke the agent,
 * and uses `openclaw agent` CLI to send messages.
 *
 * v0.22.0 — Compose system, prefabs, breakable platforms
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

const ARENA_TEMPLATES = 'spiral_tower, floating_islands, gauntlet, shrinking_arena, parkour_hell, hex_a_gone, slime_climb, wind_tunnel, treasure_trove, ice_rink, king_plateau, king_islands, hot_potato_arena, hot_potato_platforms, checkpoint_dash, race_circuit';

const TYPE_TO_TEMPLATES = {
  reach: ['spiral_tower', 'gauntlet', 'parkour_hell', 'slime_climb', 'wind_tunnel'],
  collect: ['floating_islands', 'treasure_trove'],
  survival: ['shrinking_arena', 'hex_a_gone', 'ice_rink'],
  king: ['king_plateau', 'king_islands'],
  hot_potato: ['hot_potato_arena', 'hot_potato_platforms'],
  race: ['checkpoint_dash', 'race_circuit'],
};

const ALL_GAME_TYPES = ['reach', 'collect', 'survival', 'king', 'hot_potato', 'race'];

const KNOWN_PREFABS = [
  'spider', 'shark', 'ghost', 'ufo', 'car', 'spinning_blade', 'swinging_axe',
  'crusher', 'rolling_boulder', 'cactus', 'bounce_pad', 'checkpoint', 'speed_strip',
  'torch', 'crystal', 'barrel', 'flag', 'tree', 'snowman', 'fish', 'mushroom',
  'rocket', 'trashcan', 'conveyor_belt', 'wind_zone',
].join(', ');

const COMPOSE_SHAPES = [
  'box, sphere, cylinder, cone, pyramid, torus, dodecahedron, ring',
  'horn, tentacle, wing, dome, column, vase, teardrop, mushroom_cap, flask, bell, arch, s_curve',
  'star, heart, arrow, cross',
].join(' | ');

const DRAGON_EXAMPLE = JSON.stringify({
  description: 'dragon', position: [5, 3, 0],
  recipe: {
    name: 'dragon', category: 'hazard', behavior: 'chase',
    defaultProperties: { speed: 3, chaseRadius: 25 },
    children: [
      { type: 'obstacle', offset: [0, 1, 0], size: [2.5, 1.2, 1.2], props: { shape: 'sphere', color: '#c0392b', roughness: 0.7 } },
      { type: 'obstacle', offset: [1.5, 1.5, 0], size: [0.8, 0.8, 0.8], props: { shape: 'sphere', color: '#e74c3c' } },
      { type: 'decoration', offset: [-1.2, 1.2, 0.8], size: [1.5, 0.3, 0.8], rotation: [0.3, 0, 0.5], props: { shape: 'wing', color: '#8b0000' } },
      { type: 'decoration', offset: [-1.2, 1.2, -0.8], size: [1.5, 0.3, 0.8], rotation: [-0.3, 0, 0.5], props: { shape: 'wing', color: '#8b0000' } },
      { type: 'decoration', offset: [-1.5, 0.8, 0], size: [0.3, 0.3, 1], rotation: [0, 0, -0.3], props: { shape: 'tentacle', color: '#c0392b' } },
      { type: 'decoration', offset: [2, 1.5, 0], size: [0.5, 0.3, 0.3], rotation: [0, 0, -0.4], props: { shape: 'cone', color: '#f39c12', emissive: true, opacity: 0.7 } },
    ],
  },
});

function buildVarietyDirective(context) {
  const history = context.gameHistory || [];
  const lastType = context.lastGameType || null;
  const lastTemplate = context.lastTemplate || null;
  const recentTypes = history.slice(-3).map(g => g.type);
  const recentTemplates = history.slice(-3).map(g => g.template).filter(Boolean);

  const lines = [`\n**VARIETY RULES (MANDATORY — FOLLOW EXACTLY)**:`];

  // Find which types have been played
  const typeCounts = {};
  for (const t of ALL_GAME_TYPES) typeCounts[t] = 0;
  for (const g of history) {
    if (g.type && typeCounts[g.type] !== undefined) typeCounts[g.type]++;
  }

  // Unplayed types get highest priority
  const unplayedTypes = ALL_GAME_TYPES.filter(t => typeCounts[t] === 0);
  // New types (king, hot_potato, race) get extra priority if never played
  const newUnplayed = unplayedTypes.filter(t => ['king', 'hot_potato', 'race'].includes(t));

  // Ban last game's type entirely
  if (lastType) {
    lines.push(`- DO NOT start a "${lastType}" game. Pick a DIFFERENT type.`);
  } else {
    // No history at all — ban reach (most common default)
    lines.push(`- DO NOT start a "reach" game. We need VARIETY. Pick king, hot_potato, or race.`);
  }

  // Ban recent templates
  if (recentTemplates.length > 0) {
    lines.push(`- DO NOT use templates: ${recentTemplates.join(', ')}. They were played recently.`);
  }

  // Strong push for unplayed types
  if (newUnplayed.length > 0) {
    const pick = newUnplayed[Math.floor(Math.random() * newUnplayed.length)];
    const tmpl = TYPE_TO_TEMPLATES[pick]?.[Math.floor(Math.random() * TYPE_TO_TEMPLATES[pick].length)];
    lines.push(`- **YOU MUST USE**: start_game({ template: '${tmpl}' })  ← This is a ${pick} game that has NEVER been played!`);
  }

  const sortedTypes = ALL_GAME_TYPES
    .filter(t => t !== lastType)
    .sort((a, b) => typeCounts[a] - typeCounts[b]);

  const recommendedType = sortedTypes[0] || 'collect';
  const recommendedTemplates = (TYPE_TO_TEMPLATES[recommendedType] || [])
    .filter(t => !recentTemplates.includes(t));
  const recommendedTemplate = recommendedTemplates[0] || TYPE_TO_TEMPLATES[recommendedType]?.[0] || 'floating_islands';

  lines.push(`- **RECOMMENDED**: start_game({ template: '${recommendedTemplate}' })`);
  lines.push(`- Available types: ${ALL_GAME_TYPES.join(', ')}`);

  // Type→template reference
  lines.push(`- Type→Template mapping:`);
  for (const [type, templates] of Object.entries(TYPE_TO_TEMPLATES)) {
    lines.push(`  ${type}: ${templates.join(', ')}`);
  }

  if (history.length > 0) {
    const historyStr = history.slice(-3).map(g => `${g.type}/${g.template}`).join(' → ');
    lines.push(`- Recent history: ${historyStr}`);
  }

  return lines.join('\n');
}

function buildPalettePrompt() {
  return [
    `\n**TALK TO PLAYERS** — You MUST chat every turn! POST /api/chat/send {"text":"your message"}`,
    `**Announce** — POST /api/announce {"text":"...","type":"agent","duration":4}`,
    `\n**Your palette**: Use start_game({ template: '...' }) to load arenas. Templates: ${ARENA_TEMPLATES}.`,
    `**POST /api/world/compose — YOUR ONLY SPAWNING TOOL.**`,
    `  Known prefabs (no recipe needed): ${KNOWN_PREFABS}.`,
    `  Example: POST /api/world/compose {"description":"ghost","position":[5,1,0]}`,
    `  Not a known prefab? YOU MUST provide a recipe (e.g. "octopus" → tentacle shapes, "castle" → columns and domes).`,
    `  Custom recipe example:`,
    `  POST /api/world/compose ${DRAGON_EXAMPLE}`,
    `  Shapes: ${COMPOSE_SHAPES}.`,
    `  Recipe rules: max 12 children, rotation:[rx,ry,rz] radians, material: roughness/metalness/opacity/emissive.`,
    `  Cached after first creation — same description = instant spawn next time.`,
    `  DO NOT use /api/world/spawn. ALWAYS use /api/world/compose.`,
    `  Entity props: isIce (slippery), isConveyor + conveyorDir:[x,0,z] + conveyorSpeed:1-20, isWind + windForce:[x,y,z].`,
    `**VISUAL TIPS**: Game is cel-shaded toon style. Contrasting colors + emissive eyes/highlights. Overlapping shapes create depth. Organic shapes (horn, dome, tentacle) for creatures, geometric (box, column, cylinder) for structures. Player is 1.8 units tall. Emissive parts glow with bloom.`,
    `**SIZE GUIDE**: Tiny(0.3-0.5u, bugs/coins) Small(0.5-1.5u, spiders) Player(1.5-2.5u, enemies) Large(3-6u, trees) Giant(8-15u, bosses). Chase speed auto-scales by size.`,
    `**BEHAVIOR RULES**: hazards→chase/patrol, decorations→static/rotate. Add isFloating:true in defaultProperties for flying creatures (bob animation).`,
    `**POST /api/world/hazard-plane** — Rising lava/water plane.`,
    `  { active: true, type: "lava"|"water", startHeight: -5, riseSpeed: 0.5, maxHeight: 35 }`,
    `  Rises during "playing" phase, kills players below its height. Deactivates on game end.`,
  ].join('\n');
}

function buildPrompt(phase, context, drama) {
  const parts = [];

  const phasePrompts = {
    welcome: `**Phase: WELCOME** — A player just joined! Greet them as the Chaos Magician. Be dramatic and introduce yourself. Tease the chaos to come. DO NOT load templates, spawn entities, or start games. ONLY use POST /api/chat/send {"text":"..."}.`,
    lobby: `**Phase: LOBBY** — Players are hanging out in an empty lobby.
  If the lobby timer is still active (shown below): ONLY chat. Tell jokes, react to messages. Do NOT build anything.
  If the lobby timer has expired: use start_game with a template to begin! This loads the arena AND starts the game in one step.
  Example: start_game({ template: 'king_plateau' }) or start_game({ template: 'checkpoint_dash' })
  Available templates: ${ARENA_TEMPLATES}
  6 game types: reach, collect, survival, king (control zones), hot_potato (pass the curse), race (checkpoints).
  Each template has a default type. You can override: start_game({ template: 'shrinking_arena', type: 'survival' })
  DO NOT use load_template — it's been merged into start_game.
  IMPORTANT: Follow the VARIETY RULES below! If you don't start a game, one will auto-start in 45s!`,
    gaming: `**Phase: GAMING** — A game is active! Commentate, cast spells, add tricks. Do NOT use clear_world or load_template.`,
    intermission: `**Phase: INTERMISSION** — Game just ended! Use POST /api/chat/send to announce results, congratulate winners, roast losers. Chat about what happened. Do NOT build or start anything yet — cooldown and lobby timer must expire first.`,
    escalation: `**Phase: ESCALATION** — ${gamesPlayed} games deep! Ramp up difficulty. Harder templates, more spells, shorter time limits. Use start_game({ template: '...', type: '...' }) to begin!`,
    finale: `**Phase: FINALE** — Grand finale! Maximum chaos. Epic commentary. Make it memorable! Use start_game({ template: '...', type: '...' }) for the final showdown!`
  };

  // Chat-only mode: audience is chatting but no one is in-game
  const humanCount = (context.players || []).filter(p => p.type !== 'ai').length;
  const bridgeOnly = humanCount === 0 && getNewAudienceMessages(context).length > 0;

  if (bridgeOnly) {
    parts.push(`**CHAT-ONLY MODE** — People are chatting from Twitch/Discord/Telegram but nobody is playing the game yet. ONLY use POST /api/chat/send {"text":"..."} to chat with them. Do NOT spawn entities, start games, or cast spells — there's no one in the world to see them. Be friendly, tease the game, invite them to join at https://chaos.waweapps.win`);
  } else {
    parts.push(phasePrompts[phase] || `**Phase: ${phase}** — Keep the game entertaining.`);

    parts.push(buildPalettePrompt());

    parts.push(`\n**PACING**: Max 3 world-changing actions this turn. Spell cooldown: 10s between casts. ALWAYS use start_game (with template param) to begin a game — it loads the arena and starts the countdown in one step!`);
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
  if (context.hazardPlane?.active) parts.push(`- Hazard plane: ${context.hazardPlane.type} at height ${context.hazardPlane.height.toFixed(1)} (rising to ${context.hazardPlane.maxHeight})`);
  parts.push(`- Games played: ${gamesPlayed}`);

  // Active cooldowns
  const now = Date.now();
  const cooldowns = [
    [context.lobbyReadyAt, 'Lobby timer', 'cannot start games yet'],
    [context.cooldownUntil, 'Cooldown', 'cannot start new game yet'],
    [context.spellCooldownUntil, 'Spell cooldown', 'cast blocked'],
  ];
  for (const [until, label, hint] of cooldowns) {
    if (until > now) {
      const remaining = Math.ceil((until - now) / 1000);
      parts.push(`- ⏳ ${label}: ${remaining}s (${hint})`);
    }
  }
  if (context.lobbyReadyAt <= now && context.gameState.phase === 'lobby') {
    parts.push(`- ✅ Lobby timer expired — use start_game({ template: '...' }) to begin!`);
  }

  // Active effects
  if (context.activeEffects?.length > 0) {
    parts.push(`- Active spells: ${context.activeEffects.map(e => e.type).join(', ')}`);
  }

  // Leaderboard
  if (context.leaderboard?.length > 0) {
    const top3 = context.leaderboard.slice(0, 3);
    parts.push(`\n**All-Time Leaderboard (historical — NOT this session)**:`);
    top3.forEach((entry, i) => {
      parts.push(`  ${i + 1}. ${entry.name} — ${entry.wins} wins (${entry.totalScore} pts)`);
    });
  }

  // Hard variety enforcement
  parts.push(buildVarietyDirective(context));

  // Pending welcomes — new players to greet
  const newWelcomes = getNewWelcomes(context);
  if (newWelcomes.length > 0) {
    parts.push(`\n**NEW PLAYERS — GREET THESE** (use POST /api/chat/send):`);
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
    // Pass message directly as argument to avoid shell expansion issues
    const args = ['agent', '--session-id', SESSION_ID, '--message', message, '--timeout', '30'];
    execFile('openclaw', args, {
      timeout: 35000,
      encoding: 'utf-8',
      maxBuffer: 1024 * 1024
    }, (err, stdout, stderr) => {
      const output = stdout + (stderr || '');
      if (err) {
        console.error(`[Agent] Invoke failed: ${err.message?.slice(0, 200)}`);
        reject(err);
      } else {
        console.log(`[Agent] Response received (${output.length} chars)`);
        resolve(output);
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
║   Chaos Magician Agent Runner v0.22  ║
║                                       ║
║  Game: ${GAME_URL.padEnd(30)}║
║  Session: ${SESSION_ID.slice(0, 27).padEnd(27)}║
║  Tick: ${(TICK_INTERVAL / 1000 + 's').padEnd(31)}║
╚═══════════════════════════════════════╝
`);

setInterval(tick, TICK_INTERVAL);
// First tick after 5s to let services start
setTimeout(tick, 5000);
