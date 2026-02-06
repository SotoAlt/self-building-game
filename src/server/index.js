/**
 * Self-Building Game Server
 *
 * HTTP API for agent control + WebSocket for real-time sync
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
import { initDB, getStats, isDBAvailable, upsertUser, findUser } from './db.js';
import { initAuth, verifyPrivyToken, signToken, requireAuth } from './auth.js';
import { AgentLoop } from './AgentLoop.js';
import { AIPlayer } from './AIPlayer.js';
import { MockChainInterface } from './blockchain/ChainInterface.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;
const app = express();

app.use(cors());
app.use(express.json());

// Serve static files in production
const distPath = path.join(__dirname, '../../dist');
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(distPath));
}

// World state (shared between HTTP API and game room)
const worldState = new WorldState();

// Phase guard: reject requests during active games (countdown or playing)
function rejectIfActiveGame(res) {
  const phase = worldState.gameState.phase;
  if (phase === 'countdown' || phase === 'playing') {
    res.status(400).json({ error: `Cannot perform this action during ${phase} phase` });
    return true;
  }
  return false;
}

// Broadcast game state changes from internal transitions (countdown -> playing)
worldState.onPhaseChange = function onPhaseChange(gameState) {
  broadcastToRoom('game_state_changed', gameState);

  // When returning to lobby, activate spectating players
  if (gameState.phase === 'lobby') {
    const activated = worldState.activateSpectators();
    if (activated > 0) {
      broadcastToRoom('player_activated', {});
    }
  }
};

// Current mini-game instance
let currentMiniGame = null;

// Blockchain interface (mock for now)
const chain = new MockChainInterface();

// ============================================
// Auth Endpoints
// ============================================

// Exchange Privy token for backend JWT
app.post('/api/auth/privy', async (req, res) => {
  const { accessToken } = req.body;
  if (!accessToken) return res.status(400).json({ error: 'Missing accessToken' });

  const privyResult = await verifyPrivyToken(accessToken);
  if (!privyResult) return res.status(401).json({ error: 'Invalid Privy token' });

  const { privyUserId, twitterUsername, twitterAvatar, displayName } = privyResult;
  const name = twitterUsername || displayName || `User-${privyUserId.slice(-6)}`;

  // Fire-and-forget DB persistence
  upsertUser(privyUserId, name, 'authenticated', { privyUserId, twitterUsername, twitterAvatar });

  const token = signToken(privyUserId);
  res.json({
    token,
    user: { id: privyUserId, name, type: 'authenticated', twitterUsername, twitterAvatar }
  });
});

// Create anonymous guest session
app.post('/api/auth/guest', (req, res) => {
  const name = req.body.name || `Guest-${Date.now().toString(36)}`;
  const guestId = `guest-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

  // Fire-and-forget DB persistence
  upsertUser(guestId, name, 'guest');

  const token = signToken(guestId);
  res.json({ token, user: { id: guestId, name, type: 'guest' } });
});

// Get current user profile
app.get('/api/me', requireAuth, async (req, res) => {
  const user = await findUser(req.user.id);
  if (!user) {
    // JWT is valid but user not in DB (no DB configured or dev mode)
    const id = req.user.id;
    const type = id.startsWith('guest-') ? 'guest' : 'authenticated';
    const name = id.startsWith('guest-') ? `Guest-${id.split('-')[1]}` : id;
    return res.json({ id, name, type });
  }
  res.json(user);
});

// ============================================
// HTTP API for Agent Control
// ============================================

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// Unified agent context (replaces multiple polls)
app.get('/api/agent/context', (req, res) => {
  const sinceMessage = parseInt(req.query.since_message) || 0;
  const sinceEvent = parseInt(req.query.since_event) || 0;

  const players = worldState.getPlayers().map(p => ({
    id: p.id,
    name: p.name,
    type: p.type,
    position: p.position,
    state: p.state,
    ready: p.ready
  }));

  res.json({
    players,
    playerCount: players.length,
    readyCount: worldState.getReadyCount(),
    gameState: worldState.getGameState(),
    entities: Array.from(worldState.entities.values()).map(e => ({
      id: e.id,
      type: e.type,
      position: e.position
    })),
    entityCount: worldState.entities.size,
    physics: { ...worldState.physics },
    activeEffects: worldState.getActiveEffects(),
    recentChat: worldState.getMessages(sinceMessage),
    recentEvents: worldState.getEvents(sinceEvent),
    leaderboard: worldState.getLeaderboard(),
    cooldownUntil: worldState.gameState.cooldownUntil,
    environment: { ...worldState.environment },
    pendingWelcomes: agentLoop.pendingWelcomes,
    lastGameType: worldState.lastGameType || null,
    lastGameEndTime: worldState.lastGameEndTime || null,
    suggestedGameTypes: ['reach', 'collect', 'survival'].filter(t => t !== worldState.lastGameType)
  });
});

// Get full world state
app.get('/api/world/state', (req, res) => {
  res.json(worldState.getState());
});

// Spawn entity
app.post('/api/world/spawn', (req, res) => {
  const { type, position, size, properties } = req.body;

  if (!type || !position) {
    return res.status(400).json({ error: 'Missing required: type, position' });
  }

  try {
    const entity = worldState.spawnEntity(type, position, size, properties);
    broadcastToRoom('entity_spawned', entity);
    agentLoop.notifyAgentAction();
    res.json({ success: true, id: entity.id, entity });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Modify entity
app.post('/api/world/modify', (req, res) => {
  const { id, changes } = req.body;

  if (!id || !changes) {
    return res.status(400).json({ error: 'Missing required: id, changes' });
  }

  try {
    const entity = worldState.modifyEntity(id, changes);
    broadcastToRoom('entity_modified', entity);
    res.json({ success: true, entity });
  } catch (error) {
    res.status(404).json({ success: false, error: error.message });
  }
});

// Destroy entity
app.post('/api/world/destroy', (req, res) => {
  const { id } = req.body;

  if (!id) {
    return res.status(400).json({ error: 'Missing required: id' });
  }

  try {
    worldState.destroyEntity(id);
    broadcastToRoom('entity_destroyed', { id });
    res.json({ success: true });
  } catch (error) {
    res.status(404).json({ success: false, error: error.message });
  }
});

// Clear all entities
app.post('/api/world/clear', (req, res) => {
  if (rejectIfActiveGame(res)) return;

  const ids = worldState.clearEntities();
  for (const id of ids) {
    broadcastToRoom('entity_destroyed', { id });
  }
  broadcastToRoom('physics_changed', worldState.physics);
  broadcastToRoom('environment_changed', worldState.environment);
  res.json({ success: true, cleared: ids.length });
});

// Set floor type
app.post('/api/world/floor', (req, res) => {
  const { type } = req.body;
  try {
    const floorType = worldState.setFloorType(type);
    broadcastToRoom('floor_changed', { type: floorType });
    res.json({ success: true, floorType });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/world/floor', (req, res) => {
  res.json({ floorType: worldState.floorType });
});

// Set environment (sky, fog, lighting)
app.post('/api/world/environment', (req, res) => {
  try {
    const env = worldState.setEnvironment(req.body);
    broadcastToRoom('environment_changed', env);
    res.json({ success: true, environment: env });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/world/environment', (req, res) => {
  res.json({ environment: { ...worldState.environment } });
});

// Set respawn point
app.post('/api/world/respawn', (req, res) => {
  const { position } = req.body;
  if (!position || !Array.isArray(position) || position.length !== 3) {
    return res.status(400).json({ error: 'Missing required: position [x,y,z]' });
  }
  const rp = worldState.setRespawnPoint(position);
  broadcastToRoom('respawn_point_changed', { position: rp });
  res.json({ success: true, respawnPoint: rp });
});

// Load arena template
app.post('/api/world/template', (req, res) => {
  if (rejectIfActiveGame(res)) return;

  const { name } = req.body;
  if (!name) {
    return res.status(400).json({ error: 'Missing required: name' });
  }

  // Dynamic import to avoid circular deps
  import('./ArenaTemplates.js').then(({ TEMPLATES }) => {
    const template = TEMPLATES[name];
    if (!template) {
      return res.status(404).json({
        error: `Template not found: ${name}. Available: ${Object.keys(TEMPLATES).join(', ')}`
      });
    }

    // Clear existing entities first
    const cleared = worldState.clearEntities();
    for (const id of cleared) {
      broadcastToRoom('entity_destroyed', { id });
    }

    // Spawn template entities
    const spawned = [];
    for (const entityDef of template.entities) {
      const entity = worldState.spawnEntity(
        entityDef.type,
        entityDef.position,
        entityDef.size,
        entityDef.properties || {}
      );
      broadcastToRoom('entity_spawned', entity);
      spawned.push(entity.id);
    }

    // Set respawn point if defined
    if (template.respawnPoint) {
      worldState.setRespawnPoint(template.respawnPoint);
      broadcastToRoom('respawn_point_changed', { position: template.respawnPoint });
    }

    // Set floor type if defined
    if (template.floorType) {
      worldState.setFloorType(template.floorType);
      broadcastToRoom('floor_changed', { type: template.floorType });
    }

    // Apply environment overrides if defined
    if (template.environment) {
      const env = worldState.setEnvironment(template.environment);
      broadcastToRoom('environment_changed', env);
    }

    res.json({
      success: true,
      template: name,
      name: template.name,
      gameType: template.gameType,
      floorType: template.floorType || 'solid',
      entitiesSpawned: spawned.length,
      goalPosition: template.goalPosition || null
    });
  }).catch(err => {
    res.status(500).json({ error: err.message });
  });
});

// Set physics
app.post('/api/physics/set', (req, res) => {
  const { gravity, friction, bounce } = req.body;

  try {
    const physics = worldState.setPhysics({ gravity, friction, bounce });
    broadcastToRoom('physics_changed', physics);
    res.json({ success: true, physics });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Get players
app.get('/api/players', (req, res) => {
  res.json({ players: worldState.getPlayers() });
});

// Create challenge
app.post('/api/challenge/create', (req, res) => {
  const { type, target, description, reward } = req.body;

  if (!type) {
    return res.status(400).json({ error: 'Missing required: type' });
  }

  try {
    const challenge = worldState.createChallenge(type, target, description, reward);
    broadcastToRoom('challenge_created', challenge);
    res.json({ success: true, id: challenge.id, challenge });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Get challenge status
app.get('/api/challenge/status', (req, res) => {
  res.json({ challenges: worldState.getChallenges() });
});

// ============================================
// Announcements API
// ============================================

// Post announcement
app.post('/api/announce', (req, res) => {
  const { text, type, duration } = req.body;

  if (!text) {
    return res.status(400).json({ error: 'Missing required: text' });
  }

  const announcement = worldState.announce(text, type || 'agent', duration || 5000);
  broadcastToRoom('announcement', announcement);
  res.json({ success: true, announcement });
});

// Get announcements
app.get('/api/announcements', (req, res) => {
  res.json({ announcements: worldState.getAnnouncements() });
});

// ============================================
// Game State API
// ============================================

// Get available game types
app.get('/api/game/types', (req, res) => {
  res.json({ gameTypes: GAME_TYPES });
});

// Start a game
app.post('/api/game/start', (req, res) => {
  const { type, timeLimit, targetEntityId, goalPosition, collectibleCount, countdownTime } = req.body;

  if (!type) {
    return res.status(400).json({ error: 'Missing required: type' });
  }

  if (currentMiniGame?.isActive) {
    return res.status(400).json({ error: 'A game is already in progress' });
  }

  const phase = worldState.gameState.phase;
  if (phase !== 'lobby' && phase !== 'building') {
    return res.status(400).json({ error: `Cannot start game during ${phase} phase` });
  }

  if (worldState.isInCooldown()) {
    const remaining = Math.ceil((worldState.gameState.cooldownUntil - Date.now()) / 1000);
    return res.status(400).json({ error: `Cooldown active — wait ${remaining}s` });
  }

  try {
    // Create mini-game instance
    currentMiniGame = createGameSync(type, worldState, broadcastToRoom, {
      timeLimit,
      targetEntityId,
      goalPosition,
      collectibleCount,
      countdownTime
    });

    // Share with game room immediately for event handling
    if (gameRoom) {
      gameRoom.currentMiniGame = currentMiniGame;
    }

    // Wire up end callback before starting
    currentMiniGame.onEnd = () => {
      agentLoop.onGameEnded();
      currentMiniGame = null;
      if (gameRoom) gameRoom.currentMiniGame = null;
    };

    // Start the game
    currentMiniGame.start();

    // Broadcast game state change to clients
    broadcastToRoom('game_state_changed', worldState.getGameState());

    // System message + event
    const startMsg = worldState.addMessage('System', 'system', `Game started: ${type}`);
    broadcastToRoom('chat_message', startMsg);
    worldState.addEvent('game_start', { type, gameId: currentMiniGame.id });

    res.json({
      success: true,
      gameId: currentMiniGame.id,
      gameState: worldState.getGameState()
    });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// End current game
app.post('/api/game/end', (req, res) => {
  const phase = worldState.gameState.phase;
  if (phase !== 'countdown' && phase !== 'playing') {
    return res.status(400).json({ error: `No active game to end (phase: ${phase})` });
  }

  const { result, winnerId } = req.body;
  const hadMiniGame = currentMiniGame?.isActive;

  if (hadMiniGame) {
    currentMiniGame.end(result || 'cancelled', winnerId);
    // onEnd callback handles agentLoop.onGameEnded() + setting currentMiniGame = null
  } else {
    worldState.endGame(result || 'cancelled', winnerId);
    agentLoop.onGameEnded();
  }

  // System message + event
  const winnerPlayer = winnerId ? worldState.players.get(winnerId) : null;
  const endText = winnerPlayer ? `Game ended - Winner: ${winnerPlayer.name}` : `Game ended: ${result || 'cancelled'}`;
  const endMsg = worldState.addMessage('System', 'system', endText);
  broadcastToRoom('chat_message', endMsg);
  worldState.addEvent('game_end', { result: result || 'cancelled', winnerId });

  res.json({ success: true, gameState: worldState.getGameState() });
});

// Get game state
app.get('/api/game/state', (req, res) => {
  res.json({ gameState: worldState.getGameState() });
});

// Record winner
app.post('/api/game/winner', (req, res) => {
  const { playerId } = req.body;

  if (!playerId) {
    return res.status(400).json({ error: 'Missing required: playerId' });
  }

  worldState.recordWinner(playerId);
  res.json({ success: true, gameState: worldState.getGameState() });
});

// Add trick to current mini-game
app.post('/api/game/trick', (req, res) => {
  const { trigger, action, params } = req.body;

  if (!trigger || !action) {
    return res.status(400).json({ error: 'Missing required: trigger, action' });
  }

  if (!currentMiniGame?.isActive) {
    return res.status(400).json({ error: 'No active game' });
  }

  const id = currentMiniGame.addTrick(trigger, action, params);
  res.json({ success: true, trickId: id });
});

// Get current mini-game status
app.get('/api/game/minigame', (req, res) => {
  res.json({ miniGame: currentMiniGame?.getStatus() ?? null });
});

// ============================================
// Chat API
// ============================================

// Get chat messages (agent polls this)
app.get('/api/chat/messages', (req, res) => {
  const since = parseInt(req.query.since) || 0;
  const limit = parseInt(req.query.limit) || 20;
  res.json({ messages: worldState.getMessages(since, limit) });
});

// Send chat message (agent sends via this)
app.post('/api/chat/send', (req, res) => {
  const { text } = req.body;
  if (!text || String(text).trim().length === 0) {
    return res.status(400).json({ error: 'Missing required: text' });
  }

  const message = worldState.addMessage('Chaos Magician', 'agent', String(text).trim());
  broadcastToRoom('chat_message', message);
  agentLoop.notifyAgentAction();
  res.json({ success: true, message });
});

// ============================================
// Leaderboard API
// ============================================

app.get('/api/leaderboard', (req, res) => {
  res.json({ leaderboard: worldState.getLeaderboard() });
});

// ============================================
// Stats API
// ============================================

app.get('/api/stats', async (req, res) => {
  const dbStats = await getStats();
  res.json({
    uptime: Math.floor(process.uptime()),
    players: worldState.players.size,
    entities: worldState.entities.size,
    gamesPlayed: dbStats.totalGames ?? worldState.statistics.totalChallengesCompleted,
    totalPlayers: dbStats.totalPlayers ?? worldState.statistics.playersOnline ?? 0,
    dbConnected: dbStats.dbConnected
  });
});

// ============================================
// Spells API
// ============================================

app.post('/api/spell/cast', (req, res) => {
  const { type, duration } = req.body;
  if (!type) {
    return res.status(400).json({ error: 'Missing required: type' });
  }

  try {
    const spell = worldState.castSpell(type, duration);
    broadcastToRoom('spell_cast', spell);

    const spellMsg = worldState.addMessage('System', 'system', `Spell active: ${spell.name}`);
    broadcastToRoom('chat_message', spellMsg);
    worldState.addEvent('spell_cast', { type, name: spell.name });
    agentLoop.notifyAgentAction();

    res.json({ success: true, spell });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.post('/api/spell/clear', (req, res) => {
  worldState.clearEffects();
  broadcastToRoom('effects_cleared', {});
  res.json({ success: true });
});

app.get('/api/spell/active', (req, res) => {
  res.json({ effects: worldState.getActiveEffects() });
});

// ============================================
// Bribe System
// ============================================

const BRIBE_OPTIONS = {
  spawn_obstacles: { label: 'Spawn Obstacles', cost: 50, description: 'Obstacles near other players' },
  lava_floor: { label: 'Turn Floor to Lava', cost: 100, description: 'Floor becomes deadly lava' },
  random_spell: { label: 'Cast Random Spell', cost: 30, description: 'Random spell on all players' },
  move_goal: { label: 'Move the Goal', cost: 75, description: 'Relocate the goal (reach games)' },
  extra_time: { label: 'Extra Time (+15s)', cost: 40, description: 'Add 15 seconds to the clock' },
  custom: { label: 'Custom Request', cost: 200, description: 'Free-text request for the Magician' }
};

async function executeAutoBribe(bribeType, bribeId) {
  switch (bribeType) {
    case 'spawn_obstacles':
      for (let i = 0; i < 3; i++) {
        const x = (Math.random() - 0.5) * 30;
        const z = (Math.random() - 0.5) * 30;
        const entity = worldState.spawnEntity('obstacle', [x, 2, z], [1.5, 2, 1.5], {
          color: '#e74c3c', rotating: true, speed: 3
        });
        broadcastToRoom('entity_spawned', entity);
      }
      break;

    case 'lava_floor':
      worldState.setFloorType('lava');
      broadcastToRoom('floor_changed', { type: 'lava' });
      break;

    case 'random_spell': {
      const spellTypes = Object.keys(WorldState.SPELL_TYPES);
      const randomType = spellTypes[Math.floor(Math.random() * spellTypes.length)];
      const spell = worldState.castSpell(randomType);
      broadcastToRoom('spell_cast', spell);
      break;
    }

    case 'move_goal': {
      if (currentMiniGame?.isActive && currentMiniGame.type === 'reach' && currentMiniGame.targetEntityId) {
        const newPos = [
          (Math.random() - 0.5) * 40,
          3 + Math.random() * 8,
          (Math.random() - 0.5) * 40
        ];
        const updated = worldState.modifyEntity(currentMiniGame.targetEntityId, { position: newPos });
        if (updated) {
          broadcastToRoom('entity_modified', updated);
          broadcastToRoom('announcement', worldState.announce('A BRIBE MOVES THE GOAL!', 'system', 5000));
        }
      } else {
        broadcastToRoom('announcement', worldState.announce('The Magician notes your bribe... the goal will shift next game!', 'agent', 5000));
      }
      break;
    }

    case 'extra_time': {
      if (currentMiniGame?.isActive) {
        currentMiniGame.timeLimit += 15000;
        broadcastToRoom('announcement', worldState.announce('EXTRA TIME! +15 seconds!', 'system', 5000));
      } else {
        broadcastToRoom('announcement', worldState.announce('The Magician pockets the bribe... extra time next game!', 'agent', 5000));
      }
      break;
    }

    default:
      return false;
  }

  await chain.acknowledgeBribe(bribeId, true);
  return true;
}

app.get('/api/bribe/options', (req, res) => {
  res.json({ options: BRIBE_OPTIONS });
});

app.post('/api/bribe', async (req, res) => {
  const { playerId, bribeType, request } = req.body;
  if (!playerId || !bribeType) {
    return res.status(400).json({ error: 'Missing required: playerId, bribeType' });
  }

  const option = BRIBE_OPTIONS[bribeType];
  if (!option) {
    return res.status(400).json({ error: `Invalid bribe type. Available: ${Object.keys(BRIBE_OPTIONS).join(', ')}` });
  }

  if (bribeType === 'custom' && !request) {
    return res.status(400).json({ error: 'Custom bribe requires a request text' });
  }

  const balance = await chain.getBalance(playerId);
  if (balance < option.cost) {
    return res.status(400).json({ error: 'Insufficient balance', balance });
  }

  const description = bribeType === 'custom' ? request : option.label;
  const bribe = await chain.submitBribe(playerId, option.cost, description);

  const player = worldState.players.get(playerId);
  const name = player?.name || playerId.slice(0, 8);
  const announcement = worldState.announce(
    `${name} bribed the Magician (${option.label}) for ${option.cost} tokens!`,
    'player', 8000
  );
  broadcastToRoom('announcement', announcement);

  const msg = worldState.addMessage('System', 'system', `Bribe: ${option.label} from ${name}`);
  broadcastToRoom('chat_message', msg);

  worldState.addEvent('bribe', {
    playerId, name, amount: option.cost, bribeType,
    request: description, bribeId: bribe.id
  });

  // Auto-execute simple bribes server-side; others are queued for agent
  const autoExecuted = await executeAutoBribe(bribeType, bribe.id);

  res.json({ success: true, bribe, autoExecuted, balance: await chain.getBalance(playerId) });
});

app.get('/api/bribe/pending', async (req, res) => {
  const pending = await chain.checkPendingBribes();
  res.json({ bribes: pending });
});

// Honor a pending bribe (agent action)
app.post('/api/bribe/:id/honor', async (req, res) => {
  const { id } = req.params;
  const { response } = req.body;

  const bribe = await chain.acknowledgeBribe(id, true);
  if (!bribe) {
    return res.status(404).json({ error: `Bribe not found: ${id}` });
  }

  const player = worldState.players.get(bribe.playerId);
  const name = player?.name || bribe.playerId.slice(0, 8);

  const announcement = worldState.announce(
    `The Magician honors ${name}'s bribe!${response ? ` "${response}"` : ''}`,
    'agent', 8000
  );
  broadcastToRoom('announcement', announcement);

  worldState.addEvent('bribe_honored', {
    bribeId: id, playerId: bribe.playerId, name, response
  });

  res.json({ success: true, bribe });
});

// Get recently honored bribes
app.get('/api/bribe/honored', async (req, res) => {
  const limit = parseInt(req.query.limit) || 5;
  const honored = await chain.getHonoredBribes(limit);
  res.json({ bribes: honored });
});

app.get('/api/balance/:playerId', async (req, res) => {
  const balance = await chain.getBalance(req.params.playerId);
  res.json({ playerId: req.params.playerId, balance });
});

// ============================================
// Agent Loop
// ============================================

const agentLoop = new AgentLoop(worldState, broadcastToRoom, { chain });

// Agent loop status
app.get('/api/agent/status', (req, res) => {
  res.json(agentLoop.getStatus());
});

// Pause agent (kill switch)
app.post('/api/agent/pause', (req, res) => {
  agentLoop.pause();
  res.json({ success: true, status: 'paused' });
});

// Resume agent
app.post('/api/agent/resume', (req, res) => {
  agentLoop.resume();
  res.json({ success: true, status: 'running' });
});

// Agent heartbeat (external agent-runner calls this to keep drama score accurate)
app.post('/api/agent/heartbeat', (req, res) => {
  agentLoop.notifyAgentAction();
  res.json({ success: true, drama: agentLoop.calculateDrama(), phase: agentLoop.phase });
});

// Get drama score
app.get('/api/agent/drama', (req, res) => {
  res.json({ drama: agentLoop.calculateDrama(), phase: agentLoop.phase });
});

// Building phase
app.post('/api/game/building', (req, res) => {
  const phase = worldState.gameState.phase;
  if (phase !== 'lobby') {
    return res.status(400).json({ error: `Cannot enter building phase during ${phase} phase` });
  }

  const state = worldState.startBuilding();
  broadcastToRoom('game_state_changed', state);
  res.json({ success: true, gameState: state });
});

// ============================================
// AI Players API
// ============================================

app.get('/api/ai/status', (req, res) => {
  res.json({ enabled: aiPlayersEnabled, count: aiPlayers.length });
});

app.post('/api/ai/enable', (req, res) => {
  if (aiPlayersEnabled) return res.json({ success: true, status: 'already enabled' });
  aiPlayersEnabled = true;
  spawnAIPlayers();
  res.json({ success: true, status: 'enabled', count: aiPlayers.length });
});

app.post('/api/ai/disable', (req, res) => {
  if (!aiPlayersEnabled) return res.json({ success: true, status: 'already disabled' });
  aiPlayersEnabled = false;
  despawnAIPlayers();
  res.json({ success: true, status: 'disabled' });
});

// ============================================
// SSE Event Feed (for OBS overlays)
// ============================================

const sseClients = new Set();
const SSE_EVENTS = new Set([
  'announcement', 'player_died', 'spell_cast', 'game_state_changed',
  'player_joined', 'player_left', 'chat_message', 'floor_changed',
  'entity_spawned', 'entity_destroyed'
]);

app.get('/api/stream/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive'
  });

  const client = { res, id: Date.now() };
  sseClients.add(client);

  // Send initial state
  const initData = {
    type: 'init',
    drama: agentLoop.calculateDrama(),
    phase: agentLoop.phase,
    players: worldState.players.size,
    gameState: worldState.getGameState()
  };
  res.write(`data: ${JSON.stringify(initData)}\n\n`);

  req.on('close', () => {
    sseClients.delete(client);
  });
});

function broadcastSSE(eventType, data) {
  const payload = JSON.stringify({ type: eventType, ...data, timestamp: Date.now() });
  for (const client of sseClients) {
    client.res.write(`data: ${payload}\n\n`);
  }
  // Also fire webhooks
  fireWebhooks(eventType, data);
}

// ============================================
// Webhook System
// ============================================

const webhooks = new Map();
let webhookIdCounter = 0;

app.post('/api/webhooks/register', (req, res) => {
  const { url, events } = req.body;
  if (!url) {
    return res.status(400).json({ error: 'Missing required: url' });
  }

  const id = `webhook-${++webhookIdCounter}`;
  const webhook = {
    id,
    url,
    events: events || null, // null = all events
    createdAt: Date.now()
  };
  webhooks.set(id, webhook);

  console.log(`[Webhooks] Registered ${id} → ${url}${events ? ` (${events.join(', ')})` : ' (all events)'}`);
  res.json({ success: true, webhook });
});

app.delete('/api/webhooks/:id', (req, res) => {
  const { id } = req.params;
  if (!webhooks.has(id)) {
    return res.status(404).json({ error: `Webhook not found: ${id}` });
  }
  webhooks.delete(id);
  res.json({ success: true });
});

app.get('/api/webhooks', (req, res) => {
  res.json({ webhooks: Array.from(webhooks.values()) });
});

function fireWebhooks(eventType, data) {
  const payload = JSON.stringify({
    type: eventType,
    data,
    timestamp: Date.now()
  });

  for (const webhook of webhooks.values()) {
    // Filter by event type if specified
    if (webhook.events && !webhook.events.includes(eventType)) continue;

    fetch(webhook.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      signal: AbortSignal.timeout(5000)
    }).catch(() => {
      // Fire-and-forget — silent failure
    });
  }
}

// ============================================
// Public Game API
// ============================================

app.get('/api/public/state', (req, res) => {
  const players = worldState.getPlayers().map(p => ({
    name: p.name,
    type: p.type,
    state: p.state,
    ready: p.ready
  }));

  res.json({
    players,
    playerCount: players.length,
    gameState: {
      phase: worldState.gameState.phase,
      gameType: worldState.gameState.gameType,
      timeRemaining: worldState.getGameState().timeRemaining || null
    },
    entityCount: worldState.entities.size,
    activeEffects: worldState.getActiveEffects().map(e => e.name),
    floorType: worldState.floorType,
    environment: { skyColor: worldState.environment.skyColor }
  });
});

app.get('/api/public/leaderboard', (req, res) => {
  res.json({ leaderboard: worldState.getLeaderboard() });
});

app.get('/api/public/events', (req, res) => {
  const since = parseInt(req.query.since) || 0;
  const limit = parseInt(req.query.limit) || 20;
  const filtered = since > 0
    ? worldState.events.filter(e => e.timestamp > since)
    : worldState.events;
  res.json({ events: filtered.slice(-limit) });
});

app.get('/api/public/stats', (req, res) => {
  // Single pass over events instead of four separate .filter() calls
  const counts = { player_death: 0, bribe: 0, bribe_honored: 0, spell_cast: 0 };
  for (const event of worldState.events) {
    if (event.type in counts) counts[event.type]++;
  }

  res.json({
    uptime: Math.floor(process.uptime()),
    playerCount: worldState.players.size,
    entityCount: worldState.entities.size,
    gamesPlayed: agentLoop.gamesPlayed,
    totalDeaths: counts.player_death,
    bribesSubmitted: counts.bribe,
    bribesHonored: counts.bribe_honored,
    spellsCast: counts.spell_cast,
    agentInvocations: agentLoop.invokeCount
  });
});

// ============================================
// Agent-Player API (External AI agents playing the game)
// ============================================

const agentPlayers = new Map();

// Validate that an agent player exists; returns 404 response if not found
function requireAgentPlayer(playerId, res) {
  if (!agentPlayers.has(playerId)) {
    res.status(404).json({ error: 'Agent player not found. Join first.' });
    return null;
  }
  return agentPlayers.get(playerId);
}

app.post('/api/agent-player/join', (req, res) => {
  const { name } = req.body;
  if (!name) {
    return res.status(400).json({ error: 'Missing required: name' });
  }

  const id = `agent-player-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const player = worldState.addPlayer(id, name, 'agent');
  agentPlayers.set(id, { joinedAt: Date.now(), lastAction: Date.now() });

  broadcastToRoom('player_joined', { id, name, type: 'agent' });
  worldState.addEvent('player_joined', { id, name, type: 'agent' });

  res.json({ success: true, playerId: id, player });
});

app.post('/api/agent-player/move', (req, res) => {
  const { playerId, position } = req.body;
  if (!playerId || !position) {
    return res.status(400).json({ error: 'Missing required: playerId, position' });
  }

  const agentEntry = requireAgentPlayer(playerId, res);
  if (!agentEntry) return;

  const player = worldState.updatePlayer(playerId, { position });
  if (!player) {
    return res.status(404).json({ error: 'Player not found in world state' });
  }

  agentEntry.lastAction = Date.now();
  broadcastToRoom('player_moved', { id: playerId, position });
  res.json({ success: true, position: player.position });
});

app.get('/api/agent-player/:id/state', (req, res) => {
  const { id } = req.params;
  const player = worldState.players.get(id);
  if (!player) {
    return res.status(404).json({ error: 'Player not found' });
  }

  const otherPlayers = worldState.getPlayers()
    .filter(p => p.id !== id)
    .map(p => ({ name: p.name, type: p.type, state: p.state, position: p.position }));

  res.json({
    me: player,
    otherPlayers,
    gameState: worldState.getGameState(),
    entities: Array.from(worldState.entities.values()).map(e => ({
      id: e.id, type: e.type, position: e.position, size: e.size
    })),
    activeEffects: worldState.getActiveEffects(),
    recentChat: worldState.getMessages(0, 10),
    leaderboard: worldState.getLeaderboard()
  });
});

app.post('/api/agent-player/chat', (req, res) => {
  const { playerId, text } = req.body;
  if (!playerId || !text) {
    return res.status(400).json({ error: 'Missing required: playerId, text' });
  }

  if (!requireAgentPlayer(playerId, res)) return;

  const player = worldState.players.get(playerId);
  const name = player?.name || playerId;
  const message = worldState.addMessage(name, 'player', String(text).trim());
  broadcastToRoom('chat_message', message);

  res.json({ success: true, message });
});

app.post('/api/agent-player/ready', (req, res) => {
  const { playerId } = req.body;
  if (!playerId) {
    return res.status(400).json({ error: 'Missing required: playerId' });
  }

  if (!requireAgentPlayer(playerId, res)) return;

  const player = worldState.players.get(playerId);
  if (!player) {
    return res.status(404).json({ error: 'Player not found' });
  }

  player.ready = !player.ready;
  broadcastToRoom('player_ready', { id: playerId, ready: player.ready });
  res.json({ success: true, ready: player.ready });
});

app.post('/api/agent-player/leave', (req, res) => {
  const { playerId } = req.body;
  if (!playerId) {
    return res.status(400).json({ error: 'Missing required: playerId' });
  }

  if (!requireAgentPlayer(playerId, res)) return;

  worldState.removePlayer(playerId);
  agentPlayers.delete(playerId);
  broadcastToRoom('player_left', { id: playerId });
  worldState.addEvent('player_left', { id: playerId, type: 'agent' });

  res.json({ success: true });
});

// ============================================
// Colyseus Game Server
// ============================================

const httpServer = createServer(app);

const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer })
});

// Reference to current room for broadcasting and game updates
let gameRoom = null;

// Register game room
gameServer.define('game', GameRoom).on('create', (room) => {
  console.log(`Game room created: ${room.roomId}`);
  room.worldState = worldState;
  gameRoom = room;
});

// Broadcast function for HTTP API -> WebSocket clients + SSE
function broadcastToRoom(event, data) {
  if (gameRoom) {
    gameRoom.broadcast(event, data);
  }
  // Also push key events to SSE stream
  if (SSE_EVENTS.has(event)) {
    broadcastSSE(event, data);
  }
}

// SPA catch-all (production)
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

// Initialize auth
initAuth();

// Initialize database (non-blocking)
initDB().then(async (connected) => {
  if (connected) {
    await worldState.loadLeaderboardFromDB();
  }
});

// Start agent loop
agentLoop.start();

// AI players (disabled by default, toggled via API)
const aiPlayers = [];
let aiPlayersEnabled = process.env.AI_PLAYERS === 'true';

function spawnAIPlayers() {
  if (aiPlayers.length > 0) return; // already spawned
  const explorer = new AIPlayer(worldState, broadcastToRoom, 'explorer');
  const chaotic = new AIPlayer(worldState, broadcastToRoom, 'chaotic');
  aiPlayers.push(explorer, chaotic);
  console.log('[AI] Spawned 2 AI players: Explorer Bot, Chaos Bot');
}

function despawnAIPlayers() {
  for (const ai of aiPlayers) {
    worldState.removePlayer(ai.id);
    broadcastToRoom('player_left', { id: ai.id });
  }
  aiPlayers.length = 0;
  console.log('[AI] Despawned all AI players');
}

if (aiPlayersEnabled) spawnAIPlayers();

httpServer.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║           SELF-BUILDING GAME SERVER                       ║
╠═══════════════════════════════════════════════════════════╣
║                                                           ║
║  HTTP API:    http://localhost:${PORT}/api                  ║
║  WebSocket:   ws://localhost:${PORT}                        ║
║                                                           ║
║  Auth Endpoints:                                          ║
║    POST /api/auth/privy       - Exchange Privy token      ║
║    POST /api/auth/guest       - Guest session             ║
║    GET  /api/me               - Current user profile      ║
║                                                           ║
║  Agent Endpoint:                                          ║
║    GET  /api/agent/context    - Unified agent context     ║
║                                                           ║
║  World Endpoints:                                         ║
║    GET  /api/health           - Server health             ║
║    GET  /api/world/state      - Full world state          ║
║    POST /api/world/spawn      - Create entity             ║
║    POST /api/world/modify     - Update entity             ║
║    POST /api/world/destroy    - Remove entity             ║
║    POST /api/physics/set      - Change physics            ║
║    GET  /api/players          - Player positions          ║
║                                                           ║
║  Challenge Endpoints:                                     ║
║    POST /api/challenge/create - New challenge             ║
║    GET  /api/challenge/status - Challenge data            ║
║                                                           ║
║  Announcement Endpoints:                                  ║
║    POST /api/announce         - Send announcement         ║
║    GET  /api/announcements    - Get announcements         ║
║                                                           ║
║  Game State Endpoints:                                    ║
║    POST /api/game/start       - Start mini-game           ║
║    POST /api/game/end         - End current game          ║
║    POST /api/game/trick       - Add trick mid-game        ║
║    GET  /api/game/state       - Get game state            ║
║    POST /api/game/winner      - Record winner             ║
║                                                           ║
║  Chat Endpoints:                                          ║
║    GET  /api/chat/messages    - Get chat messages         ║
║    POST /api/chat/send        - Agent sends message       ║
║                                                           ║
║  Leaderboard & Stats:                                     ║
║    GET  /api/leaderboard      - Get top 10 players        ║
║    GET  /api/stats            - Server stats              ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
  `);
});

gameServer.onShutdown(() => {
  console.log('Game server shutting down');
});

// Game loop for mini-game updates (10 ticks per second)
let lastUpdateTime = Date.now();
let lastStateBroadcast = 0;
setInterval(() => {
  const now = Date.now();
  const delta = (now - lastUpdateTime) / 1000;
  lastUpdateTime = now;

  // Update kinematic (moving) entities
  const movedEntities = worldState.updateKinematicEntities(delta);
  for (const entity of movedEntities) {
    broadcastToRoom('entity_modified', entity);
  }

  if (currentMiniGame?.isActive) {
    currentMiniGame.update(delta);
    // Broadcast game state every second for timer updates
    if (now - lastStateBroadcast >= 1000) {
      lastStateBroadcast = now;
      broadcastToRoom('game_state_changed', worldState.getGameState());
    }
  }

  // Update AI players
  for (const ai of aiPlayers) {
    ai.update(delta);
  }
}, 100);

export { worldState, broadcastToRoom };
