/**
 * Self-Building Game Server
 *
 * HTTP API for agent control + WebSocket for real-time sync
 */

import express from 'express';
import cors from 'cors';
import Colyseus from 'colyseus';
import WSTransport from '@colyseus/ws-transport';
const { Server } = Colyseus;
const { WebSocketTransport } = WSTransport;
import { createServer } from 'http';
import { GameRoom } from './GameRoom.js';
import { WorldState } from './WorldState.js';
import { createGameSync, GAME_TYPES } from './games/index.js';

const PORT = process.env.PORT || 3000;
const app = express();

app.use(cors());
app.use(express.json());

// World state (shared between HTTP API and game room)
const worldState = new WorldState();

// Current mini-game instance
let currentMiniGame = null;

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
    leaderboard: worldState.getLeaderboard()
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

    // Start the game
    currentMiniGame.start();

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
  const { result, winnerId } = req.body;

  if (currentMiniGame?.isActive) {
    currentMiniGame.end(result || 'cancelled', winnerId);
    currentMiniGame = null;
  } else {
    worldState.endGame(result || 'cancelled', winnerId);
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
  res.json({ success: true, message });
});

// ============================================
// Leaderboard API
// ============================================

app.get('/api/leaderboard', (req, res) => {
  res.json({ leaderboard: worldState.getLeaderboard() });
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

// Broadcast function for HTTP API -> WebSocket clients
function broadcastToRoom(event, data) {
  if (gameRoom) {
    gameRoom.broadcast(event, data);
  }
}

// ============================================
// Start Server
// ============================================

httpServer.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║           SELF-BUILDING GAME SERVER                       ║
╠═══════════════════════════════════════════════════════════╣
║                                                           ║
║  HTTP API:    http://localhost:${PORT}/api                  ║
║  WebSocket:   ws://localhost:${PORT}                        ║
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
║  Leaderboard:                                             ║
║    GET  /api/leaderboard      - Get top 10 players        ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
  `);
});

gameServer.onShutdown(() => {
  console.log('Game server shutting down');
});

// Game loop for mini-game updates (10 ticks per second)
let lastUpdateTime = Date.now();
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
  }
}, 100);

export { worldState, broadcastToRoom };
