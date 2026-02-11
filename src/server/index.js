/**
 * Self-Building Game Server — Multi-Arena Platform
 *
 * HTTP API for agent control + WebSocket for real-time sync.
 * Supports multiple concurrent arenas, each with its own world state,
 * game lifecycle, SSE stream, and agent loop.
 */

import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import Colyseus from 'colyseus';
import WSTransport from '@colyseus/ws-transport';
const { Server } = Colyseus;
const { WebSocketTransport } = WSTransport;
import { createServer } from 'http';
import { GameRoom } from './GameRoom.js';
import { WorldState } from './WorldState.js';
import { createGameSync, GAME_TYPES } from './games/index.js';
import { initDB, getStats, upsertUser, findUser, saveTransaction, getTransactionsByUser, findTransactionByTxHash, updateTransactionStatus, loadVerifiedTxHashes, loadArenas, saveArena, deleteArenaFromDB } from './db.js';
import { initAuth, verifyPrivyToken, signToken, requireAuth } from './auth.js';
import { AgentLoop } from './AgentLoop.js';
import { AIPlayer } from './AIPlayer.js';
import { MockChainInterface } from './blockchain/ChainInterface.js';
import { MonadChainInterface } from './blockchain/MonadChainInterface.js';
import { getPrefabInfo } from './Prefabs.js';
import { compose, loadCacheFromDisk, getComposerStats } from './Composer.js';
import { randomizeTemplate } from './ArenaTemplates.js';
import { ArenaManager } from './ArenaManager.js';
import { createArenaMiddleware, requireArenaKey } from './arenaMiddleware.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;
const MIN_LOBBY_MS = 15000;
const AUTO_START_DELAY = 45000;
const ANNOUNCEMENT_COOLDOWN = 5000;
const AGENT_CHAT_COOLDOWN = 3000;
const AFK_IDLE_MS = 120000;
const AFK_KICK_MS = 15000;
const AFK_CHECK_INTERVAL = 5000;

const NEW_TYPE_TEMPLATES = ['king_plateau', 'king_islands', 'hot_potato_arena', 'hot_potato_platforms', 'checkpoint_dash', 'race_circuit'];
const ALL_TEMPLATES = ['spiral_tower', 'floating_islands', 'gauntlet', 'shrinking_arena', 'parkour_hell', 'hex_a_gone', 'slime_climb', 'wind_tunnel', 'treasure_trove', 'ice_rink', ...NEW_TYPE_TEMPLATES];

function getTemplateGameType(templateName) {
  if (templateName.includes('king')) return 'king';
  if (templateName.includes('hot_potato')) return 'hot_potato';
  if (templateName.includes('checkpoint') || templateName.includes('race_circuit')) return 'race';
  if (templateName.includes('shrinking') || templateName.includes('hex_a_gone') || templateName.includes('ice_rink') || templateName === 'blank_canvas') return 'survival';
  if (templateName.includes('floating') || templateName.includes('treasure')) return 'collect';
  return 'reach';
}

const app = express();
app.use(cors());
app.use(express.json());

// Serve static files in production
const distPath = path.join(__dirname, '../../dist');
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(distPath));
}

// Self-documenting API — any AI agent can discover our API by fetching /skill.md
app.get('/skill.md', (req, res) => res.sendFile(path.join(__dirname, '../../docs/ARENA-HOST-SKILL.md')));

// ============================================
// Global Singletons (shared across all arenas)
// ============================================

const isRealChain = !!process.env.TREASURY_ADDRESS;
const chain = isRealChain
  ? new MonadChainInterface({
      rpcUrl: process.env.MONAD_RPC_URL || 'https://rpc.monad.xyz',
      treasuryAddress: process.env.TREASURY_ADDRESS
    })
  : new MockChainInterface();

const BRIBE_OPTIONS = {
  spawn_obstacles: {
    label: 'Spawn Obstacles', description: 'Obstacles near other players',
    cost: 50, costMON: '0.002', costWei: '2000000000000000'
  },
  lava_floor: {
    label: 'Turn Floor to Lava', description: 'Floor becomes deadly lava',
    cost: 100, costMON: '0.005', costWei: '5000000000000000'
  },
  random_spell: {
    label: 'Cast Random Spell', description: 'Random spell on all players',
    cost: 30, costMON: '0.001', costWei: '1000000000000000'
  },
  move_goal: {
    label: 'Move the Goal', description: 'Relocate the goal (reach games)',
    cost: 75, costMON: '0.003', costWei: '3000000000000000'
  },
  extra_time: {
    label: 'Extra Time (+15s)', description: 'Add 15 seconds to the clock',
    cost: 40, costMON: '0.002', costWei: '2000000000000000'
  },
  custom: {
    label: 'Custom Request', description: 'Free-text request for the Magician',
    cost: 200, costMON: '0.01', costWei: '10000000000000000'
  }
};

// ============================================
// Arena Manager
// ============================================

const arenaManager = new ArenaManager();
const defaultArena = arenaManager.createDefaultArena();

// ============================================
// Helper Functions (arena-parameterized)
// ============================================

function rejectIfActiveGame(arena, res) {
  const phase = arena.worldState.gameState.phase;
  if (phase === 'countdown' || phase === 'playing') {
    res.status(400).json({ error: `Cannot perform this action during ${phase} phase` });
    return true;
  }
  return false;
}

function rejectIfLobbyTimer(arena, res) {
  const ws = arena.worldState;
  if (ws.gameState.phase !== 'lobby') return false;
  const timeSinceLobby = Date.now() - ws.lobbyEnteredAt;
  if (timeSinceLobby < MIN_LOBBY_MS) {
    const remaining = Math.ceil((MIN_LOBBY_MS - timeSinceLobby) / 1000);
    res.status(400).json({ error: `Lobby phase: ${remaining}s until games can start` });
    return true;
  }
  return false;
}

function applyTemplate(arena, tmpl, doRandomize = true) {
  const ws = arena.worldState;
  const broadcast = arena.broadcastToRoom.bind(arena);
  const finalTmpl = doRandomize ? randomizeTemplate(tmpl) : tmpl;
  const cleared = ws.clearEntities();
  for (const id of cleared) broadcast('entity_destroyed', { id });

  const spawned = [];
  for (const entityDef of finalTmpl.entities) {
    const entity = ws.spawnEntity(entityDef.type, entityDef.position, entityDef.size, entityDef.properties || {});
    broadcast('entity_spawned', entity);
    spawned.push(entity.id);
  }

  if (finalTmpl.respawnPoint) {
    ws.setRespawnPoint(finalTmpl.respawnPoint);
    broadcast('respawn_point_changed', { position: finalTmpl.respawnPoint });
  }
  if (finalTmpl.floorType) {
    ws.setFloorType(finalTmpl.floorType);
    broadcast('floor_changed', { type: finalTmpl.floorType });
  }
  if (finalTmpl.environment) {
    const env = ws.setEnvironment(finalTmpl.environment);
    broadcast('environment_changed', env);
  }
  if (finalTmpl.hazardPlane) {
    ws.setHazardPlane(finalTmpl.hazardPlane);
    broadcast('hazard_plane_changed', { ...ws.hazardPlane });
  }

  return spawned;
}

function doStartGame(arena, gameType, options) {
  const ws = arena.worldState;
  const broadcast = arena.broadcastToRoom.bind(arena);

  const gameTypeDef = GAME_TYPES[gameType];
  const minRequired = gameTypeDef?.minPlayers || 1;
  const humanPlayers = ws.getPlayers().filter(p => p.type !== 'ai');

  if (humanPlayers.length < minRequired) {
    const gameName = gameTypeDef?.name || gameType;
    return { success: false, status: 400, error: `${gameName} requires ${minRequired}+ players (${humanPlayers.length} connected)` };
  }

  const { timeLimit, targetEntityId, goalPosition, collectibleCount, countdownTime } = options;

  try {
    arena.currentMiniGame = createGameSync(gameType, ws, broadcast, {
      timeLimit, targetEntityId, goalPosition, collectibleCount, countdownTime
    });

    arena.currentMiniGame.onEnd = () => {
      if (arena.agentLoop) arena.agentLoop.onGameEnded();
      arena.currentMiniGame = null;
    };

    arena.currentMiniGame.start();
    broadcast('game_state_changed', ws.getGameState());

    const startMsg = ws.addMessage('System', 'system', `Game started: ${gameType}`);
    broadcast('chat_message', startMsg);
    ws.addEvent('game_start', { type: gameType, gameId: arena.currentMiniGame.id });

    return { success: true, gameId: arena.currentMiniGame.id, gameState: ws.getGameState() };
  } catch (error) {
    return { success: false, status: 400, error: error.message };
  }
}

function scheduleAutoStart(arena) {
  clearTimeout(arena.autoStartTimer);
  const ws = arena.worldState;
  const delay = arena.config.autoStartDelay || AUTO_START_DELAY;

  ws.autoStartTargetTime = Date.now() + delay;
  arena.broadcastToRoom('lobby_countdown', {
    targetTime: ws.autoStartTargetTime,
    duration: delay,
    lobbyReadyAt: ws.lobbyEnteredAt + MIN_LOBBY_MS,
  });

  arena.autoStartTimer = setTimeout(async () => {
    if (ws.gameState.phase !== 'lobby') return;
    const humanPlayers = ws.getPlayers().filter(p => p.type !== 'ai');
    if (humanPlayers.length === 0) return;

    const playerCount = humanPlayers.length;
    const recentTemplates = ws.gameHistory.slice(-3).map(g => g.template);
    const playedTypes = new Set(ws.gameHistory.map(g => g.type));

    const playableTemplates = ALL_TEMPLATES.filter(t => {
      const minRequired = GAME_TYPES[getTemplateGameType(t)]?.minPlayers || 1;
      return playerCount >= minRequired;
    });

    const unplayedNewTemplates = NEW_TYPE_TEMPLATES.filter(t =>
      playableTemplates.includes(t) &&
      !recentTemplates.includes(t) &&
      !playedTypes.has(getTemplateGameType(t))
    );

    const availableTemplates = playableTemplates.filter(t => !recentTemplates.includes(t));

    // Prefer unplayed new types, then non-recent, then any playable, then all
    const pool = unplayedNewTemplates.length > 0 ? unplayedNewTemplates
      : availableTemplates.length > 0 ? availableTemplates
      : playableTemplates.length > 0 ? playableTemplates
      : ALL_TEMPLATES;

    const template = pool[Math.floor(Math.random() * pool.length)];
    console.log(`[AutoStart:${arena.id}] Agent didn't start a game in ${delay / 1000}s — auto-starting with ${template}`);

    try {
      const { TEMPLATES } = await import('./ArenaTemplates.js');
      const tmpl = TEMPLATES[template];
      if (!tmpl) return;
      applyTemplate(arena, tmpl);
      ws.setLastTemplate(template);
      doStartGame(arena, tmpl.gameType || 'reach', {});
    } catch (e) {
      console.error(`[AutoStart:${arena.id}] Failed:`, e.message);
    }
  }, delay);
}

async function executeAutoBribe(arena, bribeType, bribeId) {
  const ws = arena.worldState;
  const broadcast = arena.broadcastToRoom.bind(arena);

  switch (bribeType) {
    case 'spawn_obstacles':
      for (let i = 0; i < 3; i++) {
        const x = (Math.random() - 0.5) * 30;
        const z = (Math.random() - 0.5) * 30;
        const entity = ws.spawnEntity('obstacle', [x, 2, z], [1.5, 2, 1.5], {
          color: '#e74c3c', rotating: true, speed: 3
        });
        broadcast('entity_spawned', entity);
      }
      break;

    case 'lava_floor':
      ws.setFloorType('lava');
      broadcast('floor_changed', { type: 'lava' });
      break;

    case 'random_spell': {
      const spellTypes = Object.keys(WorldState.SPELL_TYPES);
      const randomType = spellTypes[Math.floor(Math.random() * spellTypes.length)];
      try {
        const spell = ws.castSpell(randomType);
        broadcast('spell_cast', spell);
      } catch (e) {
        broadcast('announcement', ws.announce('The magic fizzles... try again soon!', 'agent', 3000));
        return false;
      }
      break;
    }

    case 'move_goal': {
      if (arena.currentMiniGame?.isActive && arena.currentMiniGame.type === 'reach' && arena.currentMiniGame.targetEntityId) {
        const newPos = [
          (Math.random() - 0.5) * 40,
          3 + Math.random() * 8,
          (Math.random() - 0.5) * 40
        ];
        const updated = ws.modifyEntity(arena.currentMiniGame.targetEntityId, { position: newPos });
        if (updated) {
          broadcast('entity_modified', updated);
          broadcast('announcement', ws.announce('A BRIBE MOVES THE GOAL!', 'system', 5000));
        }
      } else {
        broadcast('announcement', ws.announce('The Magician notes your bribe... the goal will shift next game!', 'agent', 5000));
      }
      break;
    }

    case 'extra_time': {
      if (arena.currentMiniGame?.isActive) {
        arena.currentMiniGame.timeLimit += 15000;
        broadcast('announcement', ws.announce('EXTRA TIME! +15 seconds!', 'system', 5000));
      } else {
        broadcast('announcement', ws.announce('The Magician pockets the bribe... extra time next game!', 'agent', 5000));
      }
      break;
    }

    default:
      return false;
  }

  await chain.acknowledgeBribe(bribeId, true);
  return true;
}

function spawnAIPlayers(arena) {
  if (arena.aiPlayers.length > 0) return;
  const broadcast = arena.broadcastToRoom.bind(arena);
  const explorer = new AIPlayer(arena.worldState, broadcast, 'explorer');
  const chaotic = new AIPlayer(arena.worldState, broadcast, 'chaotic');
  arena.aiPlayers.push(explorer, chaotic);
  console.log(`[AI:${arena.id}] Spawned 2 AI players`);
}

function despawnAIPlayers(arena) {
  const broadcast = arena.broadcastToRoom.bind(arena);
  for (const ai of arena.aiPlayers) {
    arena.worldState.removePlayer(ai.id);
    broadcast('player_left', { id: ai.id });
  }
  arena.aiPlayers.length = 0;
  console.log(`[AI:${arena.id}] Despawned all AI players`);
}

function setupArenaCallbacks(arena) {
  const ws = arena.worldState;

  ws.onPlayerJoin = function onPlayerJoin(player) {
    if (player.type === 'ai') return;
    if (ws.gameState.phase === 'lobby' && !ws.autoStartTargetTime) {
      scheduleAutoStart(arena);
    }
  };

  ws.onPhaseChange = function onPhaseChange(gameState) {
    const broadcast = arena.broadcastToRoom.bind(arena);
    broadcast('game_state_changed', gameState);

    if (gameState.phase === 'lobby') {
      broadcast('world_cleared', {});
      broadcast('physics_changed', ws.physics);
      broadcast('environment_changed', ws.environment);
      broadcast('floor_changed', { type: ws.floorType });
      broadcast('hazard_plane_changed', { ...ws.hazardPlane });
      broadcast('effects_cleared', {});

      const activated = ws.activateSpectators();
      if (activated > 0) {
        broadcast('player_activated', {});
      }

      scheduleAutoStart(arena);
    } else {
      clearTimeout(arena.autoStartTimer);
      ws.autoStartTargetTime = null;
    }
  };
}

// Setup callbacks for default arena
setupArenaCallbacks(defaultArena);

// ============================================
// Auth Endpoints (platform-level, on app)
// ============================================

app.post('/api/auth/privy', async (req, res) => {
  const { accessToken } = req.body;
  if (!accessToken) return res.status(400).json({ error: 'Missing accessToken' });

  const privyResult = await verifyPrivyToken(accessToken);
  if (!privyResult) return res.status(401).json({ error: 'Invalid Privy token' });

  const { privyUserId, twitterUsername, twitterAvatar, displayName, walletAddress } = privyResult;
  const name = twitterUsername || displayName || `User-${privyUserId.slice(-6)}`;

  upsertUser(privyUserId, name, 'authenticated', { privyUserId, twitterUsername, twitterAvatar, walletAddress });

  const token = signToken(privyUserId);
  res.json({
    token,
    user: { id: privyUserId, name, type: 'authenticated', twitterUsername, twitterAvatar, walletAddress }
  });
});

app.post('/api/auth/guest', (req, res) => {
  const name = req.body.name || `Guest-${Date.now().toString(36)}`;
  const guestId = `guest-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

  upsertUser(guestId, name, 'guest');

  const token = signToken(guestId);
  res.json({ token, user: { id: guestId, name, type: 'guest' } });
});

app.get('/api/me', requireAuth, async (req, res) => {
  const user = await findUser(req.user.id);
  if (!user) {
    const id = req.user.id;
    const type = id.startsWith('guest-') ? 'guest' : 'authenticated';
    const name = id.startsWith('guest-') ? `Guest-${id.split('-')[1]}` : id;
    return res.json({ id, name, type });
  }
  res.json(user);
});

// ============================================
// Arena CRUD (platform-level, on app)
// ============================================

app.get('/api/arenas', (req, res) => {
  res.json({ arenas: arenaManager.listArenas() });
});

app.post('/api/arenas', (req, res) => {
  try {
    const { arena, apiKey } = arenaManager.createArena(req.body);
    setupArenaCallbacks(arena);

    // Persist to DB
    saveArena(arena);

    res.json({
      arenaId: arena.id,
      apiKey,
      name: arena.name,
      endpoints: {
        context: `/api/arenas/${arena.id}/agent/context`,
        compose: `/api/arenas/${arena.id}/world/compose`,
        startGame: `/api/arenas/${arena.id}/game/start`,
        endGame: `/api/arenas/${arena.id}/game/end`,
        castSpell: `/api/arenas/${arena.id}/spell/cast`,
        announce: `/api/arenas/${arena.id}/announce`,
        chat: `/api/arenas/${arena.id}/chat/send`,
        gameState: `/api/arenas/${arena.id}/game/state`,
      }
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/arenas/:id/info', (req, res) => {
  const arena = arenaManager.getArena(req.params.id);
  if (!arena) return res.status(404).json({ error: `Arena not found: ${req.params.id}` });
  res.json(arena.getPublicInfo());
});

app.patch('/api/arenas/:id', (req, res) => {
  const arena = arenaManager.getArena(req.params.id);
  if (!arena) return res.status(404).json({ error: `Arena not found: ${req.params.id}` });
  if (arena.isDefault) return res.status(403).json({ error: 'Cannot modify default arena' });

  const apiKey = req.headers['x-arena-api-key'];
  if (!apiKey || apiKey !== arena.apiKey) {
    return res.status(401).json({ error: 'Invalid or missing X-Arena-API-Key' });
  }

  const { name, description, gameMasterName, config } = req.body;
  if (name) arena.name = name;
  if (description !== undefined) arena.description = description;
  if (gameMasterName) arena.gameMasterName = gameMasterName;
  if (config) Object.assign(arena.config, config);

  saveArena(arena);
  res.json({ success: true, arena: arena.getPublicInfo() });
});

app.delete('/api/arenas/:id', (req, res) => {
  const arena = arenaManager.getArena(req.params.id);
  if (!arena) return res.status(404).json({ error: `Arena not found: ${req.params.id}` });

  const apiKey = req.headers['x-arena-api-key'];
  if (!apiKey || apiKey !== arena.apiKey) {
    return res.status(401).json({ error: 'Invalid or missing X-Arena-API-Key' });
  }

  try {
    arenaManager.deleteArena(req.params.id);
    deleteArenaFromDB(req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/arenas/:id/upvote', (req, res) => {
  const arena = arenaManager.getArena(req.params.id);
  if (!arena) return res.status(404).json({ error: `Arena not found: ${req.params.id}` });
  arena.upvotes++;
  res.json({ success: true, upvotes: arena.upvotes });
});

// ============================================
// Game Router (per-arena endpoints)
// ============================================

const gameRouter = express.Router({ mergeParams: true });

// Require API key for all write operations (POST/PATCH/DELETE) except player-facing endpoints.
// Default arena (chaos) passes through automatically — requireArenaKey skips it.
const PLAYER_PATHS = new Set(['/chat/send', '/chat/bridge', '/bribe', '/tokens/faucet',
  '/agent-player/join', '/agent-player/move', '/agent-player/chat', '/agent-player/leave']);
gameRouter.use((req, res, next) => {
  if (req.method === 'GET') return next();
  // Player-facing endpoints don't need arena key (have their own auth)
  if (PLAYER_PATHS.has(req.path)) return next();
  // Bribe honor needs key (agent operation)
  requireArenaKey(req, res, next);
});

// Health check
gameRouter.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now(), arenaId: req.arena.id });
});

// Unified agent context
gameRouter.get('/agent/context', (req, res) => {
  const arena = req.arena;
  const ws = arena.worldState;
  const sinceMessage = parseInt(req.query.since_message) || 0;
  const sinceEvent = parseInt(req.query.since_event) || 0;

  const players = ws.getPlayers().map(p => ({
    id: p.id, name: p.name, type: p.type, position: p.position, state: p.state,
    lastActivity: p.lastActivity
  }));

  const allMessages = ws.getMessages(sinceMessage);
  const audienceChat = allMessages.filter(m => m.senderType === 'audience');
  const spectatorCount = players.filter(p => p.state === 'spectating').length;

  res.json({
    arenaId: arena.id,
    players,
    playerCount: players.length,
    activeHumanCount: ws.getActiveHumanCount(),
    gameState: ws.getGameState(),
    entities: Array.from(ws.entities.values()).map(e => ({
      id: e.id, type: e.type, position: e.position,
      groupId: e.properties?.groupId || null
    })),
    availablePrefabs: getPrefabInfo(),
    composerCache: getComposerStats(),
    entityCount: ws.entities.size,
    physics: { ...ws.physics },
    activeEffects: ws.getActiveEffects(),
    recentChat: allMessages,
    audienceChat,
    audienceCount: spectatorCount + audienceChat.length,
    recentEvents: ws.getEvents(sinceEvent),
    leaderboard: ws.getLeaderboard(),
    cooldownUntil: ws.gameState.cooldownUntil,
    lobbyReadyAt: ws.lobbyEnteredAt + MIN_LOBBY_MS,
    spellCooldownUntil: ws.lastSpellCastTime + WorldState.SPELL_COOLDOWN,
    environment: { ...ws.environment },
    hazardPlane: { ...ws.hazardPlane },
    pendingWelcomes: arena.agentLoop?.pendingWelcomes || [],
    lastGameType: ws.lastGameType || null,
    lastGameEndTime: ws.lastGameEndTime || null,
    suggestedGameTypes: ['reach', 'collect', 'survival', 'king', 'hot_potato', 'race'].filter(t => t !== ws.lastGameType),
    gameHistory: ws.gameHistory.map(g => ({ type: g.type, template: g.template })),
    lastTemplate: ws.lastTemplate || null
  });
});

// World state
gameRouter.get('/world/state', (req, res) => {
  res.json(req.arena.worldState.getState());
});

// Spawn entity (BLOCKED — use compose)
gameRouter.post('/world/spawn', (req, res) => {
  return res.status(400).json({
    error: 'DEPRECATED — use POST /api/world/compose instead. Example: POST /api/world/compose {"description":"spider","position":[5,1,0]}',
    hint: 'compose handles ALL spawning — prefabs like spider, ghost, shark AND custom creations'
  });
});

// Modify entity
gameRouter.post('/world/modify', (req, res) => {
  const arena = req.arena;
  const { id, changes } = req.body;
  if (!id || !changes) {
    return res.status(400).json({ error: 'Missing required: id, changes' });
  }
  try {
    const entity = arena.worldState.modifyEntity(id, changes);
    arena.broadcastToRoom('entity_modified', entity);
    res.json({ success: true, entity });
  } catch (error) {
    res.status(404).json({ success: false, error: error.message });
  }
});

// Destroy entity
gameRouter.post('/world/destroy', (req, res) => {
  const arena = req.arena;
  const { id } = req.body;
  if (!id) {
    return res.status(400).json({ error: 'Missing required: id' });
  }
  try {
    arena.worldState.destroyEntity(id);
    arena.broadcastToRoom('entity_destroyed', { id });
    res.json({ success: true });
  } catch (error) {
    res.status(404).json({ success: false, error: error.message });
  }
});

// Clear all entities
gameRouter.post('/world/clear', (req, res) => {
  const arena = req.arena;
  if (rejectIfActiveGame(arena, res)) return;
  if (rejectIfLobbyTimer(arena, res)) return;

  const ids = arena.worldState.clearEntities();
  for (const id of ids) {
    arena.broadcastToRoom('entity_destroyed', { id });
  }
  arena.broadcastToRoom('physics_changed', arena.worldState.physics);
  arena.broadcastToRoom('environment_changed', arena.worldState.environment);
  res.json({ success: true, cleared: ids.length });
});

// Spawn prefab (BLOCKED — use compose)
gameRouter.post('/world/spawn-prefab', (req, res) => {
  return res.status(400).json({
    error: 'DEPRECATED — use POST /api/world/compose instead. Example: POST /api/world/compose {"description":"spider","position":[5,1,0]}',
    hint: 'compose auto-resolves prefabs by name — spider, ghost, bounce_pad, etc.'
  });
});

// Compose
gameRouter.post('/world/compose', (req, res) => {
  const arena = req.arena;
  if (rejectIfLobbyTimer(arena, res)) return;

  const { description, position, recipe, properties } = req.body;
  if (!description || !position) {
    return res.status(400).json({ error: 'Missing required: description, position' });
  }

  const broadcast = arena.broadcastToRoom.bind(arena);
  const result = compose(description, position, recipe, properties, arena.worldState, broadcast);
  if (!result.success) {
    return res.status(400).json(result);
  }

  if (arena.agentLoop) arena.agentLoop.notifyAgentAction();
  res.json(result);
});

// Destroy prefab group
gameRouter.post('/world/destroy-group', (req, res) => {
  const arena = req.arena;
  const { groupId } = req.body;
  if (!groupId) {
    return res.status(400).json({ error: 'Missing required: groupId' });
  }

  const ids = arena.worldState.destroyGroup(groupId);
  if (ids.length === 0) {
    return res.status(404).json({ error: `No entities found with groupId: ${groupId}` });
  }

  for (const id of ids) {
    arena.broadcastToRoom('entity_destroyed', { id });
  }
  res.json({ success: true, destroyed: ids.length, entityIds: ids });
});

// Floor type
gameRouter.post('/world/floor', (req, res) => {
  const arena = req.arena;
  const { type } = req.body;
  try {
    const floorType = arena.worldState.setFloorType(type);
    arena.broadcastToRoom('floor_changed', { type: floorType });
    res.json({ success: true, floorType });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

gameRouter.get('/world/floor', (req, res) => {
  res.json({ floorType: req.arena.worldState.floorType });
});

// Hazard plane
gameRouter.post('/world/hazard-plane', (req, res) => {
  const arena = req.arena;
  try {
    const state = arena.worldState.setHazardPlane(req.body);
    arena.broadcastToRoom('hazard_plane_changed', state);
    res.json({ success: true, hazardPlane: state });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

gameRouter.get('/world/hazard-plane', (req, res) => {
  res.json({ hazardPlane: { ...req.arena.worldState.hazardPlane } });
});

// Environment
gameRouter.post('/world/environment', (req, res) => {
  const arena = req.arena;
  try {
    const env = arena.worldState.setEnvironment(req.body);
    arena.broadcastToRoom('environment_changed', env);
    res.json({ success: true, environment: env });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

gameRouter.get('/world/environment', (req, res) => {
  res.json({ environment: { ...req.arena.worldState.environment } });
});

// Respawn point
gameRouter.post('/world/respawn', (req, res) => {
  const arena = req.arena;
  const { position } = req.body;
  if (!position || !Array.isArray(position) || position.length !== 3) {
    return res.status(400).json({ error: 'Missing required: position [x,y,z]' });
  }
  const rp = arena.worldState.setRespawnPoint(position);
  arena.broadcastToRoom('respawn_point_changed', { position: rp });
  res.json({ success: true, respawnPoint: rp });
});

// Load arena template
gameRouter.post('/world/template', (req, res) => {
  const arena = req.arena;
  const phase = arena.worldState.gameState.phase;
  if (phase === 'lobby' || phase === 'building') {
    return res.status(400).json({
      error: 'Cannot load template during lobby. Use start_game with a template parameter instead. Example: POST /api/game/start { "template": "parkour_hell" }'
    });
  }
  if (rejectIfActiveGame(arena, res)) return;

  const { name } = req.body;
  if (!name) {
    return res.status(400).json({ error: 'Missing required: name' });
  }

  import('./ArenaTemplates.js').then(({ TEMPLATES }) => {
    const template = TEMPLATES[name];
    if (!template) {
      return res.status(404).json({
        error: `Template not found: ${name}. Available: ${Object.keys(TEMPLATES).join(', ')}`
      });
    }

    const spawned = applyTemplate(arena, template);
    arena.worldState.lastTemplateLoadTime = Date.now();

    res.json({
      success: true, template: name, name: template.name,
      gameType: template.gameType, floorType: template.floorType || 'solid',
      entitiesSpawned: spawned.length, goalPosition: template.goalPosition || null
    });
  }).catch(err => {
    res.status(500).json({ error: err.message });
  });
});

// Physics
gameRouter.post('/physics/set', (req, res) => {
  const arena = req.arena;
  const { gravity, friction, bounce } = req.body;
  try {
    const physics = arena.worldState.setPhysics({ gravity, friction, bounce });
    arena.broadcastToRoom('physics_changed', physics);
    res.json({ success: true, physics });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Players
gameRouter.get('/players', (req, res) => {
  res.json({ players: req.arena.worldState.getPlayers() });
});

// Challenge
gameRouter.post('/challenge/create', (req, res) => {
  const arena = req.arena;
  const { type, target, description, reward } = req.body;
  if (!type) {
    return res.status(400).json({ error: 'Missing required: type' });
  }
  try {
    const challenge = arena.worldState.createChallenge(type, target, description, reward);
    arena.broadcastToRoom('challenge_created', challenge);
    res.json({ success: true, id: challenge.id, challenge });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

gameRouter.get('/challenge/status', (req, res) => {
  res.json({ challenges: req.arena.worldState.getChallenges() });
});

// Announcements
gameRouter.post('/announce', (req, res) => {
  const arena = req.arena;
  const now = Date.now();
  if (now - arena.lastAnnouncementTime < ANNOUNCEMENT_COOLDOWN) {
    return res.status(429).json({ error: 'Announcement rate limit: wait before announcing again' });
  }
  arena.lastAnnouncementTime = now;

  const { text, type, duration } = req.body;
  if (!text) {
    return res.status(400).json({ error: 'Missing required: text' });
  }

  const announcement = arena.worldState.announce(text, type || 'agent', duration || 5000);
  arena.broadcastToRoom('announcement', announcement);
  res.json({ success: true, announcement });
});

gameRouter.get('/announcements', (req, res) => {
  res.json({ announcements: req.arena.worldState.getAnnouncements() });
});

// Game types
gameRouter.get('/game/types', (req, res) => {
  res.json({ gameTypes: GAME_TYPES });
});

// Start game
gameRouter.post('/game/start', (req, res) => {
  const arena = req.arena;
  const ws = arena.worldState;
  const { type, template } = req.body;

  if (!type && !template) {
    return res.status(400).json({ error: 'Missing required: type or template' });
  }

  if (arena.currentMiniGame?.isActive) {
    return res.status(400).json({ error: 'A game is already in progress' });
  }

  const phase = ws.gameState.phase;
  if (phase !== 'lobby' && phase !== 'building') {
    return res.status(400).json({ error: `Cannot start game during ${phase} phase` });
  }

  if (rejectIfLobbyTimer(arena, res)) return;

  if (ws.isInCooldown()) {
    const remaining = Math.ceil((ws.gameState.cooldownUntil - Date.now()) / 1000);
    return res.status(400).json({ error: `Cooldown active — wait ${remaining}s` });
  }

  const humanPlayers = ws.getPlayers().filter(p => p.type !== 'ai');
  if (humanPlayers.length === 0) {
    return res.status(400).json({ error: 'Cannot start game: no players connected' });
  }

  if (template) {
    import('./ArenaTemplates.js').then(({ TEMPLATES }) => {
      const tmpl = TEMPLATES[template];
      if (!tmpl) {
        return res.status(404).json({
          error: `Template not found: ${template}. Available: ${Object.keys(TEMPLATES).join(', ')}`
        });
      }

      applyTemplate(arena, tmpl);
      ws.setLastTemplate(template);

      const gameType = type || tmpl.gameType || 'reach';
      const result = doStartGame(arena, gameType, req.body);
      if (!result.success) {
        return res.status(result.status || 400).json({ error: result.error });
      }
      res.json(result);
    }).catch(err => {
      res.status(500).json({ error: err.message });
    });
  } else {
    const result = doStartGame(arena, type, req.body);
    if (!result.success) {
      return res.status(result.status || 400).json({ error: result.error });
    }
    res.json(result);
  }
});

// End game
gameRouter.post('/game/end', (req, res) => {
  const arena = req.arena;
  const ws = arena.worldState;
  const phase = ws.gameState.phase;

  if (phase !== 'countdown' && phase !== 'playing') {
    return res.status(400).json({ error: `No active game to end (phase: ${phase})` });
  }

  const { result, winnerId } = req.body;
  const hadMiniGame = arena.currentMiniGame?.isActive;

  if (hadMiniGame) {
    arena.currentMiniGame.end(result || 'cancelled', winnerId);
  } else {
    ws.endGame(result || 'cancelled', winnerId);
    if (arena.agentLoop) arena.agentLoop.onGameEnded();
  }

  const winnerPlayer = winnerId ? ws.players.get(winnerId) : null;
  const endText = winnerPlayer ? `Game ended - Winner: ${winnerPlayer.name}` : `Game ended: ${result || 'cancelled'}`;
  const endMsg = ws.addMessage('System', 'system', endText);
  arena.broadcastToRoom('chat_message', endMsg);
  ws.addEvent('game_end', { result: result || 'cancelled', winnerId });

  res.json({ success: true, gameState: ws.getGameState() });
});

// Game state
gameRouter.get('/game/state', (req, res) => {
  res.json({ gameState: req.arena.worldState.getGameState() });
});

// Record winner
gameRouter.post('/game/winner', (req, res) => {
  const { playerId } = req.body;
  if (!playerId) {
    return res.status(400).json({ error: 'Missing required: playerId' });
  }
  req.arena.worldState.recordWinner(playerId);
  res.json({ success: true, gameState: req.arena.worldState.getGameState() });
});

// Add trick
gameRouter.post('/game/trick', (req, res) => {
  const arena = req.arena;
  const { trigger, action, params } = req.body;
  if (!trigger || !action) {
    return res.status(400).json({ error: 'Missing required: trigger, action' });
  }
  if (!arena.currentMiniGame?.isActive) {
    return res.status(400).json({ error: 'No active game' });
  }
  const id = arena.currentMiniGame.addTrick(trigger, action, params);
  res.json({ success: true, trickId: id });
});

// Mini-game status
gameRouter.get('/game/minigame', (req, res) => {
  res.json({ miniGame: req.arena.currentMiniGame?.getStatus() ?? null });
});

// Building phase
gameRouter.post('/game/building', (req, res) => {
  const arena = req.arena;
  const phase = arena.worldState.gameState.phase;
  if (phase !== 'lobby') {
    return res.status(400).json({ error: `Cannot enter building phase during ${phase} phase` });
  }
  const state = arena.worldState.startBuilding();
  arena.broadcastToRoom('game_state_changed', state);
  res.json({ success: true, gameState: state });
});

// ============================================
// Chat
// ============================================

gameRouter.get('/chat/messages', (req, res) => {
  const since = parseInt(req.query.since) || 0;
  const limit = parseInt(req.query.limit) || 20;
  res.json({ messages: req.arena.worldState.getMessages(since, limit) });
});

gameRouter.post('/chat/send', (req, res) => {
  const arena = req.arena;
  const now = Date.now();
  if (now - arena.lastAgentChatTime < AGENT_CHAT_COOLDOWN) {
    return res.status(429).json({ error: 'Chat rate limit: wait before sending another message' });
  }
  arena.lastAgentChatTime = now;

  const { text } = req.body;
  if (!text || String(text).trim().length === 0) {
    return res.status(400).json({ error: 'Missing required: text' });
  }

  const senderName = arena.isDefault ? 'Chaos Magician' : arena.gameMasterName;
  const message = arena.worldState.addMessage(senderName, 'agent', String(text).trim());
  arena.broadcastToRoom('chat_message', message);
  if (arena.agentLoop) arena.agentLoop.notifyAgentAction();
  res.json({ success: true, message });
});

gameRouter.post('/chat/bridge', (req, res) => {
  const arena = req.arena;
  const { sender, platform, text } = req.body;
  if (!sender || !platform || !text) {
    return res.status(400).json({ error: 'Missing required: sender, platform, text' });
  }

  const validPlatforms = ['twitch', 'discord', 'telegram'];
  if (!validPlatforms.includes(platform)) {
    return res.status(400).json({ error: `Invalid platform. Must be one of: ${validPlatforms.join(', ')}` });
  }

  const displayName = `[${platform}] ${sender}`;
  const message = arena.worldState.addMessage(displayName, 'audience', String(text).trim().slice(0, 200));
  arena.broadcastToRoom('chat_message', message);
  res.json({ success: true, message });
});

// ============================================
// Leaderboard & Stats
// ============================================

gameRouter.get('/leaderboard', (req, res) => {
  res.json({ leaderboard: req.arena.worldState.getLeaderboard() });
});

gameRouter.get('/stats', async (req, res) => {
  const arena = req.arena;
  const dbStats = await getStats();
  res.json({
    uptime: Math.floor(process.uptime()),
    arenaId: arena.id,
    players: arena.worldState.players.size,
    entities: arena.worldState.entities.size,
    gamesPlayed: dbStats.totalGames ?? arena.worldState.statistics.totalChallengesCompleted,
    totalPlayers: dbStats.totalPlayers ?? arena.worldState.statistics.playersOnline ?? 0,
    dbConnected: dbStats.dbConnected
  });
});

// ============================================
// Spells
// ============================================

gameRouter.post('/spell/cast', (req, res) => {
  const arena = req.arena;
  const phase = arena.worldState.gameState.phase;
  if (phase !== 'playing') {
    return res.status(400).json({ error: `Cannot cast spells during ${phase} phase. Wait for a game to start.` });
  }

  const { type, duration } = req.body;
  if (!type) {
    return res.status(400).json({ error: 'Missing required: type' });
  }

  try {
    const spell = arena.worldState.castSpell(type, duration);
    arena.broadcastToRoom('spell_cast', spell);

    const spellMsg = arena.worldState.addMessage('System', 'system', `Spell active: ${spell.name}`);
    arena.broadcastToRoom('chat_message', spellMsg);
    arena.worldState.addEvent('spell_cast', { type, name: spell.name });
    if (arena.agentLoop) arena.agentLoop.notifyAgentAction();

    res.json({ success: true, spell });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

gameRouter.post('/spell/clear', (req, res) => {
  const arena = req.arena;
  arena.worldState.clearEffects();
  arena.broadcastToRoom('effects_cleared', {});
  res.json({ success: true });
});

gameRouter.get('/spell/active', (req, res) => {
  res.json({ effects: req.arena.worldState.getActiveEffects() });
});

// ============================================
// Bribe System
// ============================================

gameRouter.get('/bribe/options', (req, res) => {
  res.json({ options: BRIBE_OPTIONS, isRealChain });
});

gameRouter.post('/bribe', requireAuth, async (req, res) => {
  const arena = req.arena;
  const ws = arena.worldState;
  const { bribeType, request, txHash } = req.body;
  if (!bribeType) {
    return res.status(400).json({ error: 'Missing required: bribeType' });
  }

  const userId = req.user.id;
  const sessionPlayer = Array.from(ws.players.values()).find(p => p.userId === userId);
  if (!sessionPlayer) {
    return res.status(400).json({ error: 'No active game session' });
  }
  const playerId = sessionPlayer.id;

  const option = BRIBE_OPTIONS[bribeType];
  if (!option) {
    return res.status(400).json({ error: `Invalid bribe type. Available: ${Object.keys(BRIBE_OPTIONS).join(', ')}` });
  }

  if (bribeType === 'custom' && !request) {
    return res.status(400).json({ error: 'Custom bribe requires a request text' });
  }

  if (!txHash) {
    return res.status(400).json({ error: 'Missing txHash — transaction required' });
  }

  const dbUser = await findUser(userId);

  const existingTx = await findTransactionByTxHash(txHash);
  if (existingTx) {
    return res.status(400).json({ error: 'Transaction already used' });
  }

  const verification = await chain.verifyBribeTransaction(txHash, option.costWei, dbUser?.wallet_address);
  if (!verification.valid) {
    return res.status(400).json({ error: verification.error });
  }

  const amount = option.costMON;
  const costLabel = `${option.costMON} MON`;
  const description = bribeType === 'custom' ? request : option.label;
  const bribe = await chain.submitBribe(playerId, amount, description, txHash);

  await saveTransaction({
    id: bribe.id, userId, walletAddress: dbUser?.wallet_address,
    txHash: txHash || null, txType: bribeType, amount: String(amount), description
  });

  const player = ws.players.get(playerId);
  const name = player?.name || playerId.slice(0, 8);

  arena.broadcastToRoom('announcement', ws.announce(
    `${name} bribed the Magician (${option.label}) for ${costLabel}!`, 'player', 8000
  ));
  arena.broadcastToRoom('chat_message',
    ws.addMessage('System', 'system', `Bribe: ${option.label} from ${name}`)
  );

  ws.addEvent('bribe', {
    playerId, name, amount, bribeType,
    request: description, bribeId: bribe.id, txHash: txHash || null
  });

  const autoExecuted = await executeAutoBribe(arena, bribeType, bribe.id);
  res.json({ success: true, bribe, autoExecuted });
});

gameRouter.get('/bribe/pending', async (req, res) => {
  const pending = await chain.checkPendingBribes();
  res.json({ bribes: pending });
});

gameRouter.post('/bribe/:id/honor', async (req, res) => {
  const arena = req.arena;
  const ws = arena.worldState;
  const { id } = req.params;
  const { response } = req.body;

  const bribe = await chain.acknowledgeBribe(id, true);
  if (!bribe) {
    return res.status(404).json({ error: `Bribe not found: ${id}` });
  }

  await updateTransactionStatus(id, 'honored');

  const player = ws.players.get(bribe.playerId);
  const name = player?.name || bribe.playerId.slice(0, 8);

  const announcement = ws.announce(
    `The Magician honors ${name}'s bribe!${response ? ` "${response}"` : ''}`, 'agent', 8000
  );
  arena.broadcastToRoom('announcement', announcement);

  ws.addEvent('bribe_honored', {
    bribeId: id, playerId: bribe.playerId, name, response
  });

  res.json({ success: true, bribe });
});

gameRouter.get('/bribe/honored', async (req, res) => {
  const limit = parseInt(req.query.limit) || 5;
  const honored = await chain.getHonoredBribes(limit);
  res.json({ bribes: honored });
});

// Transactions
gameRouter.get('/transactions', requireAuth, async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 20, 100);
  const offset = parseInt(req.query.offset) || 0;
  const transactions = await getTransactionsByUser(req.user.id, limit, offset);
  res.json({ transactions });
});

gameRouter.get('/balance/:addressOrId', async (req, res) => {
  const param = req.params.addressOrId;
  const isEvmAddress = param?.startsWith('0x') && param.length === 42;

  if (isEvmAddress) {
    const balance = await chain.getBalance(param);
    return res.json({ address: param, balance });
  }

  const user = await findUser(param);
  const walletAddress = user?.wallet_address || null;
  const balance = await chain.getBalance(walletAddress || param);
  res.json({ playerId: param, balance, walletAddress });
});

gameRouter.get('/wallet/:playerId', async (req, res) => {
  const { playerId } = req.params;
  const user = await findUser(playerId);
  const walletAddress = user?.wallet_address || null;
  res.json({ playerId, walletAddress, hasWallet: !!walletAddress });
});

gameRouter.post('/tokens/faucet', requireAuth, async (req, res) => {
  if (isRealChain) {
    return res.status(400).json({ error: 'Faucet not available on mainnet. Send MON to your wallet address.' });
  }
  const playerId = req.user.id;
  const balance = await chain.getBalance(playerId);
  chain.balances.set(playerId, balance + 100);
  res.json({ success: true, amount: 100, balance: balance + 100 });
});

// ============================================
// Agent Loop
// ============================================

gameRouter.get('/agent/status', (req, res) => {
  const arena = req.arena;
  if (arena.agentLoop) {
    res.json(arena.agentLoop.getStatus());
  } else {
    res.json({ phase: 'inactive', paused: false, drama: 0, invokeCount: 0, gamesPlayed: 0, playerCount: arena.worldState.players.size });
  }
});

gameRouter.post('/agent/pause', (req, res) => {
  if (req.arena.agentLoop) req.arena.agentLoop.pause();
  res.json({ success: true, status: 'paused' });
});

gameRouter.post('/agent/resume', (req, res) => {
  if (req.arena.agentLoop) req.arena.agentLoop.resume();
  res.json({ success: true, status: 'running' });
});

gameRouter.post('/agent/heartbeat', (req, res) => {
  const arena = req.arena;
  if (arena.agentLoop) arena.agentLoop.notifyAgentAction();
  res.json({
    success: true,
    drama: arena.agentLoop?.calculateDrama() || 0,
    phase: arena.agentLoop?.phase || 'inactive'
  });
});

gameRouter.get('/agent/drama', (req, res) => {
  const arena = req.arena;
  res.json({
    drama: arena.agentLoop?.calculateDrama() || 0,
    phase: arena.agentLoop?.phase || 'inactive'
  });
});

// ============================================
// AI Players
// ============================================

gameRouter.get('/ai/status', (req, res) => {
  res.json({ enabled: req.arena.aiPlayersEnabled, count: req.arena.aiPlayers.length });
});

gameRouter.post('/ai/enable', (req, res) => {
  const arena = req.arena;
  if (arena.aiPlayersEnabled) return res.json({ success: true, status: 'already enabled' });
  arena.aiPlayersEnabled = true;
  spawnAIPlayers(arena);
  res.json({ success: true, status: 'enabled', count: arena.aiPlayers.length });
});

gameRouter.post('/ai/disable', (req, res) => {
  const arena = req.arena;
  if (!arena.aiPlayersEnabled) return res.json({ success: true, status: 'already disabled' });
  arena.aiPlayersEnabled = false;
  despawnAIPlayers(arena);
  res.json({ success: true, status: 'disabled' });
});

// ============================================
// SSE Event Feed
// ============================================

gameRouter.get('/stream/events', (req, res) => {
  const arena = req.arena;
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive'
  });

  const client = { res, id: Date.now() };
  arena.sseClients.add(client);

  const initData = {
    type: 'init',
    arenaId: arena.id,
    drama: arena.agentLoop?.calculateDrama() || 0,
    phase: arena.agentLoop?.phase || 'inactive',
    players: arena.worldState.players.size,
    gameState: arena.worldState.getGameState()
  };
  res.write(`data: ${JSON.stringify(initData)}\n\n`);

  req.on('close', () => {
    arena.sseClients.delete(client);
  });
});

// ============================================
// Webhooks
// ============================================

gameRouter.post('/webhooks/register', (req, res) => {
  const arena = req.arena;
  const { url, events } = req.body;
  if (!url) {
    return res.status(400).json({ error: 'Missing required: url' });
  }

  const id = `webhook-${++arena.webhookIdCounter}`;
  const webhook = {
    id, url,
    events: events || null,
    createdAt: Date.now()
  };
  arena.webhooks.set(id, webhook);

  console.log(`[Webhooks:${arena.id}] Registered ${id} → ${url}${events ? ` (${events.join(', ')})` : ' (all events)'}`);
  res.json({ success: true, webhook });
});

gameRouter.delete('/webhooks/:id', (req, res) => {
  const arena = req.arena;
  const { id } = req.params;
  if (!arena.webhooks.has(id)) {
    return res.status(404).json({ error: `Webhook not found: ${id}` });
  }
  arena.webhooks.delete(id);
  res.json({ success: true });
});

gameRouter.get('/webhooks', (req, res) => {
  res.json({ webhooks: Array.from(req.arena.webhooks.values()) });
});

// ============================================
// Public API
// ============================================

gameRouter.get('/public/state', (req, res) => {
  const ws = req.arena.worldState;
  const players = ws.getPlayers().map(p => ({
    name: p.name, type: p.type, state: p.state
  }));

  res.json({
    arenaId: req.arena.id,
    players,
    playerCount: players.length,
    gameState: {
      phase: ws.gameState.phase,
      gameType: ws.gameState.gameType,
      timeRemaining: ws.getGameState().timeRemaining || null
    },
    entityCount: ws.entities.size,
    activeEffects: ws.getActiveEffects().map(e => e.name),
    floorType: ws.floorType,
    environment: { skyColor: ws.environment.skyColor }
  });
});

gameRouter.get('/public/leaderboard', (req, res) => {
  res.json({ leaderboard: req.arena.worldState.getLeaderboard() });
});

gameRouter.get('/public/events', (req, res) => {
  const ws = req.arena.worldState;
  const since = parseInt(req.query.since) || 0;
  const limit = parseInt(req.query.limit) || 20;
  const filtered = since > 0
    ? ws.events.filter(e => e.timestamp > since)
    : ws.events;
  res.json({ events: filtered.slice(-limit) });
});

gameRouter.get('/public/stats', (req, res) => {
  const arena = req.arena;
  const ws = arena.worldState;
  const counts = { player_death: 0, bribe: 0, bribe_honored: 0, spell_cast: 0 };
  for (const event of ws.events) {
    if (event.type in counts) counts[event.type]++;
  }

  res.json({
    uptime: Math.floor(process.uptime()),
    arenaId: arena.id,
    playerCount: ws.players.size,
    entityCount: ws.entities.size,
    gamesPlayed: arena.agentLoop?.gamesPlayed || 0,
    totalDeaths: counts.player_death,
    bribesSubmitted: counts.bribe,
    bribesHonored: counts.bribe_honored,
    spellsCast: counts.spell_cast,
    agentInvocations: arena.agentLoop?.invokeCount || 0
  });
});

// ============================================
// Agent-Player API
// ============================================

function requireAgentPlayer(arena, playerId, res) {
  if (!arena.agentPlayers.has(playerId)) {
    res.status(404).json({ error: 'Agent player not found. Join first.' });
    return null;
  }
  return arena.agentPlayers.get(playerId);
}

gameRouter.post('/agent-player/join', (req, res) => {
  const arena = req.arena;
  const { name } = req.body;
  if (!name) {
    return res.status(400).json({ error: 'Missing required: name' });
  }

  const id = `agent-player-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const player = arena.worldState.addPlayer(id, name, 'agent');
  arena.agentPlayers.set(id, { joinedAt: Date.now(), lastAction: Date.now() });

  arena.broadcastToRoom('player_joined', { id, name, type: 'agent' });
  arena.worldState.addEvent('player_joined', { id, name, type: 'agent' });

  res.json({ success: true, playerId: id, player });
});

gameRouter.post('/agent-player/move', (req, res) => {
  const arena = req.arena;
  const { playerId, position } = req.body;
  if (!playerId || !position) {
    return res.status(400).json({ error: 'Missing required: playerId, position' });
  }

  const agentEntry = requireAgentPlayer(arena, playerId, res);
  if (!agentEntry) return;

  const player = arena.worldState.updatePlayer(playerId, { position });
  if (!player) {
    return res.status(404).json({ error: 'Player not found in world state' });
  }

  agentEntry.lastAction = Date.now();
  arena.broadcastToRoom('player_moved', { id: playerId, position });
  res.json({ success: true, position: player.position });
});

gameRouter.get('/agent-player/:id/state', (req, res) => {
  const arena = req.arena;
  const ws = arena.worldState;
  const { id } = req.params;
  const player = ws.players.get(id);
  if (!player) {
    return res.status(404).json({ error: 'Player not found' });
  }

  const otherPlayers = ws.getPlayers()
    .filter(p => p.id !== id)
    .map(p => ({ name: p.name, type: p.type, state: p.state, position: p.position }));

  res.json({
    me: player,
    otherPlayers,
    gameState: ws.getGameState(),
    entities: Array.from(ws.entities.values()).map(e => ({
      id: e.id, type: e.type, position: e.position, size: e.size
    })),
    activeEffects: ws.getActiveEffects(),
    recentChat: ws.getMessages(0, 10),
    leaderboard: ws.getLeaderboard()
  });
});

gameRouter.post('/agent-player/chat', (req, res) => {
  const arena = req.arena;
  const { playerId, text } = req.body;
  if (!playerId || !text) {
    return res.status(400).json({ error: 'Missing required: playerId, text' });
  }

  if (!requireAgentPlayer(arena, playerId, res)) return;

  const player = arena.worldState.players.get(playerId);
  const name = player?.name || playerId;
  const message = arena.worldState.addMessage(name, 'player', String(text).trim());
  arena.broadcastToRoom('chat_message', message);
  res.json({ success: true, message });
});

gameRouter.post('/agent-player/leave', (req, res) => {
  const arena = req.arena;
  const { playerId } = req.body;
  if (!playerId) {
    return res.status(400).json({ error: 'Missing required: playerId' });
  }

  if (!requireAgentPlayer(arena, playerId, res)) return;

  arena.worldState.removePlayer(playerId);
  arena.agentPlayers.delete(playerId);
  arena.broadcastToRoom('player_left', { id: playerId });
  arena.worldState.addEvent('player_left', { id: playerId, type: 'agent' });
  res.json({ success: true });
});

// ============================================
// Mount Game Router
// ============================================

const arenaMiddleware = createArenaMiddleware(arenaManager);
app.use('/api/arenas/:arenaId', arenaMiddleware, gameRouter);
app.use('/api', arenaMiddleware, gameRouter);

// ============================================
// Colyseus Game Server
// ============================================

const httpServer = createServer(app);

const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer })
});

// Inject arenaManager into GameRoom class
GameRoom.arenaManager = arenaManager;

// Register game room with filterBy for multi-arena support
gameServer.define('game', GameRoom).filterBy(['arenaId']);

// ============================================
// SPA catch-all (production)
// ============================================

if (process.env.NODE_ENV === 'production') {
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
      res.sendFile(path.join(distPath, 'index.html'));
    }
  });
}

// ============================================
// Start Server
// ============================================

initAuth();

initDB().then(async (connected) => {
  if (connected) {
    await defaultArena.worldState.loadLeaderboardFromDB();

    const arenaRows = await loadArenas();
    arenaManager.loadFromDB(arenaRows);
    for (const arena of arenaManager.getAllArenas()) {
      if (arena.id !== 'chaos') {
        setupArenaCallbacks(arena);
      }
    }

    if (isRealChain) {
      const hashes = await loadVerifiedTxHashes();
      for (const h of hashes) chain._verifiedTxHashes.add(h);
      if (hashes.length) console.log(`[Chain] Loaded ${hashes.length} verified tx hashes from DB`);
    }
  }
});

loadCacheFromDisk();

// Start agent loop for default arena
const broadcast = defaultArena.broadcastToRoom.bind(defaultArena);
defaultArena.agentLoop = new AgentLoop(defaultArena.worldState, broadcast, { chain });
defaultArena.agentLoop.start();

// AI players for default arena
defaultArena.aiPlayersEnabled = process.env.AI_PLAYERS === 'true';
if (defaultArena.aiPlayersEnabled) spawnAIPlayers(defaultArena);

httpServer.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║           SELF-BUILDING GAME SERVER (Multi-Arena)         ║
╠═══════════════════════════════════════════════════════════╣
║                                                           ║
║  HTTP API:    http://localhost:${PORT}/api                  ║
║  WebSocket:   ws://localhost:${PORT}                        ║
║  Arenas:      GET /api/arenas                             ║
║  Default:     chaos (Chaos Magician)                      ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
  `);
});

gameServer.onShutdown(() => {
  console.log('Game server shutting down');
});

// ============================================
// Game Tick Loop (iterates all arenas)
// ============================================

let lastUpdateTime = Date.now();
setInterval(() => {
  const now = Date.now();
  const delta = (now - lastUpdateTime) / 1000;
  lastUpdateTime = now;

  for (const arena of arenaManager.getAllArenas()) {
    const ws = arena.worldState;
    const broadcast = arena.broadcastToRoom.bind(arena);

    // 1. Kinematic entities (patrol, rotate, pendulum, crush)
    const movedEntities = ws.updateKinematicEntities(delta);
    for (const entity of movedEntities) {
      broadcast('entity_modified', entity);
    }

    // 2. Chasing entities (spiders, ghosts, etc.)
    const chasedEntities = ws.updateChasingEntities(delta);
    for (const entity of chasedEntities) {
      broadcast('entity_modified', entity);
    }

    // 3. Breaking platforms
    ws.processBreakingPlatforms(broadcast);

    // 4. Rising hazard plane
    const hazardUpdate = ws.updateHazardPlane(delta);
    if (hazardUpdate) {
      if (now - arena.lastHazardBroadcast >= 200) {
        arena.lastHazardBroadcast = now;
        broadcast('hazard_plane_update', hazardUpdate);
      }

      // Server-side kill check
      for (const player of ws.players.values()) {
        if (player.state === 'alive' && player.position[1] < hazardUpdate.height) {
          player.state = 'dead';
          broadcast('player_died', { id: player.id, cause: 'hazard_plane' });
        }
      }
    }

    // 5. MiniGame tick
    if (arena.currentMiniGame?.isActive) {
      arena.currentMiniGame.update(delta);
      if (now - arena.lastStateBroadcast >= 1000) {
        arena.lastStateBroadcast = now;
        broadcast('game_state_changed', ws.getGameState());
      }
    }

    // 6. AI players
    for (const ai of arena.aiPlayers) {
      ai.update(delta);
    }

    // 7. AFK detection (throttled)
    if (now - arena._lastAfkCheck >= AFK_CHECK_INTERVAL) {
      arena._lastAfkCheck = now;
      const room = arena.gameRoom;

      for (const player of ws.players.values()) {
        if (player.type === 'ai') continue;

        if (player.state === 'afk_warned') {
          // Kick: player was warned and didn't respond in time
          if (now - player.afkWarningSentAt >= AFK_KICK_MS) {
            const client = room?.getClient(player.id);
            if (client) {
              client.send('afk_kicked', { reason: 'You were kicked for being AFK.' });
              client.leave(4000);
            }
            console.log(`[AFK] Kicked ${player.name} from arena ${arena.id}`);
          }
        } else if (player.state !== 'dead' && now - player.lastActivity >= AFK_IDLE_MS) {
          // Warn: player idle too long
          const token = Math.random().toString(36).slice(2, 10);
          player.afkWarningToken = token;
          player.afkWarningSentAt = now;
          player.state = 'afk_warned';
          const client = room?.getClient(player.id);
          if (client) {
            client.send('afk_warning', { token, timeout: AFK_KICK_MS });
          }
          console.log(`[AFK] Warning sent to ${player.name} in arena ${arena.id}`);
        }
      }
    }
  }
}, 100);

export { arenaManager };
