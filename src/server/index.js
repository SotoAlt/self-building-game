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

const PORT = process.env.PORT || 3000;
const app = express();

app.use(cors());
app.use(express.json());

// World state (shared between HTTP API and game room)
const worldState = new WorldState();

// ============================================
// HTTP API for Agent Control
// ============================================

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
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
// Colyseus Game Server
// ============================================

const httpServer = createServer(app);

const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer })
});

// Register game room
gameServer.define('game', GameRoom).on('create', (room) => {
  console.log(`Game room created: ${room.roomId}`);
  // Share world state with room
  room.worldState = worldState;
});

// Broadcast function for HTTP API → WebSocket clients
let currentRoom = null;

function broadcastToRoom(event, data) {
  if (currentRoom) {
    currentRoom.broadcast(event, data);
  }
}

// Track current room for broadcasting
gameServer.onShutdown(() => {
  console.log('Game server shutting down');
});

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
║  Endpoints:                                               ║
║    GET  /api/health          - Server health              ║
║    GET  /api/world/state     - Full world state           ║
║    POST /api/world/spawn     - Create entity              ║
║    POST /api/world/modify    - Update entity              ║
║    POST /api/world/destroy   - Remove entity              ║
║    POST /api/physics/set     - Change physics             ║
║    GET  /api/players         - Player positions           ║
║    POST /api/challenge/create - New challenge             ║
║    GET  /api/challenge/status - Challenge data            ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
  `);
});

// Handle room creation to enable broadcasting
gameServer.onShutdown(() => {
  console.log('Shutting down...');
});

export { worldState, broadcastToRoom };
