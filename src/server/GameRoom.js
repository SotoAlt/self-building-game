/**
 * GameRoom - Colyseus room for real-time multiplayer
 *
 * Handles player connections, position sync, and game events.
 */

import Colyseus from 'colyseus';
const { Room } = Colyseus;
import { upsertUser } from './db.js';
import { verifyToken } from './auth.js';

function detectRequest(text) {
  const lower = text.toLowerCase();
  if (lower.includes('@agent')) {
    if (/spawn|create|build|make|add/.test(lower)) return 'spawn';
    if (/destroy|remove|delete|clear/.test(lower)) return 'destroy';
    if (/gravity|physics|bounce|friction/.test(lower)) return 'physics';
    if (/start|game|play|challenge/.test(lower)) return 'start_game';
    if (/spell|cast|effect|curse/.test(lower)) return 'spell';
    if (/help|easier|hard|difficult/.test(lower)) return 'difficulty';
    return 'general';
  }
  return null;
}

export class GameRoom extends Room {
  // World state injected by server
  worldState = null;

  // Current mini-game instance (injected by server)
  currentMiniGame = null;

  // Rate limiting for chat
  _chatRateLimit = new Map();

  _systemMessage(text) {
    if (!this.worldState) return;
    const message = this.worldState.addMessage('System', 'system', text);
    this.broadcast('chat_message', message);
  }

  onCreate(options) {
    console.log(`[GameRoom] Room created`);

    // Player position updates (client -> server)
    this.onMessage('move', (client, data) => {
      if (!this.worldState) return;

      this.worldState.updatePlayer(client.sessionId, {
        position: data.position,
        velocity: data.velocity
      });

      this.broadcast('player_moved', {
        id: client.sessionId,
        position: data.position,
        velocity: data.velocity
      }, { except: client });
    });

    // Player death (rate-limited: 1 per 2 seconds per player)
    this._deathTimestamps = new Map();
    this.onMessage('died', (client, data) => {
      if (!this.worldState) return;

      const now = Date.now();
      const lastDeath = this._deathTimestamps.get(client.sessionId) || 0;
      if (now - lastDeath < 2000) return; // rate limit
      this._deathTimestamps.set(client.sessionId, now);

      const player = this.worldState.players.get(client.sessionId);
      const name = player?.name || client.sessionId.slice(0, 8);
      this.worldState.updatePlayer(client.sessionId, { state: 'dead' });

      if (data.challengeId) {
        this.worldState.recordChallengeAttempt(data.challengeId);
      }

      this.broadcast('player_died', {
        id: client.sessionId,
        position: data.position,
        challengeId: data.challengeId
      });

      this._systemMessage(`${name} died`);
      this.worldState.addEvent('player_death', { playerId: client.sessionId, name });

      console.log(`[GameRoom] Player died: ${client.sessionId}`);
    });

    // Player respawn
    this.onMessage('respawn', (client) => {
      if (!this.worldState) return;

      const player = this.worldState.players.get(client.sessionId);
      const name = player?.name || client.sessionId.slice(0, 8);
      const rp = this.worldState.respawnPoint || [0, 2, 0];
      this.worldState.updatePlayer(client.sessionId, {
        state: 'alive',
        position: [...rp]
      });

      this.broadcast('player_respawned', { id: client.sessionId });
      this._systemMessage(`${name} respawned`);
    });

    // Challenge completion
    this.onMessage('challenge_complete', (client, data) => {
      if (!this.worldState) return;

      const challenge = this.worldState.completeChallenge(data.challengeId, client.sessionId);
      if (!challenge) return;

      this.broadcast('challenge_completed', {
        challengeId: data.challengeId,
        playerId: client.sessionId,
        challenge
      });

      console.log(`[GameRoom] Challenge completed: ${data.challengeId} by ${client.sessionId}`);
    });

    // Collectible pickup
    this.onMessage('collect', (client, data) => {
      if (!this.worldState) return;

      // Only allow collecting entities that still exist
      const entity = this.worldState.entities.get(data.entityId);
      if (!entity || entity.type !== 'collectible') return;

      // Remove from server state
      try {
        this.worldState.destroyEntity(data.entityId);
      } catch {
        return; // Already destroyed by another player
      }

      this.broadcast('entity_destroyed', { id: data.entityId });
      this.broadcast('collectible_picked', {
        entityId: data.entityId,
        playerId: client.sessionId
      });

      // Notify mini-game if active
      if (this.currentMiniGame?.isActive && typeof this.currentMiniGame.onCollect === 'function') {
        this.currentMiniGame.onCollect(client.sessionId, data.entityId);
      }
    });

    // Trigger activation (for goals, checkpoints)
    this.onMessage('trigger_activated', (client, data) => {
      console.log(`[GameRoom] Trigger activated: ${data.entityId} by ${client.sessionId}`);

      this.broadcast('trigger_activated', {
        entityId: data.entityId,
        playerId: client.sessionId
      });

      // Notify mini-game if active
      if (this.currentMiniGame?.isActive && typeof this.currentMiniGame.onPlayerReachedGoal === 'function') {
        this.currentMiniGame.onPlayerReachedGoal(client.sessionId);
      }
    });

    // Player chat messages
    this.onMessage('chat', (client, data) => {
      if (!this.worldState || !data.text) return;

      const text = String(data.text).trim();
      if (text.length === 0 || text.length > 200) return;

      // Rate limit: 1 message per second per player
      const now = Date.now();
      const lastSent = this._chatRateLimit.get(client.sessionId) || 0;
      if (now - lastSent < 1000) return;
      this._chatRateLimit.set(client.sessionId, now);

      const player = this.worldState.players.get(client.sessionId);
      const sender = player?.name || client.sessionId.slice(0, 8);

      const message = this.worldState.addMessage(sender, 'player', text);
      const requestType = detectRequest(text);
      if (requestType) {
        message.requestType = requestType;
      }
      this.broadcast('chat_message', message);
    });

    // Player ready toggle
    this.onMessage('ready', (client, data) => {
      if (!this.worldState) return;

      const ready = !!data.ready;
      const player = this.worldState.setPlayerReady(client.sessionId, ready);
      if (!player) return;

      // Auto-ready all AI bots when a human readies up
      if (ready) {
        for (const [id, p] of this.worldState.players) {
          if (p.type === 'ai' && !p.ready) {
            this.worldState.setPlayerReady(id, true);
            this.broadcast('player_ready', { id, name: p.name, ready: true });
          }
        }
      }

      this.broadcast('player_ready', {
        id: client.sessionId,
        name: player.name,
        ready
      });

      if (ready) {
        const { ready: readyHumans, total: totalHumans } = this.worldState.getHumanReadyCount();
        this._systemMessage(`${player.name} is ready (${readyHumans}/${totalHumans} players)`);
      }
    });

    // Set simulation interval (physics tick)
    this.setSimulationInterval((deltaTime) => {
      // Server-side physics updates could go here
      // For now, clients handle their own physics
    }, 1000 / 60); // 60 FPS
  }

  onJoin(client, options) {
    const name = options.name || `Player-${client.sessionId.slice(0, 4)}`;
    const payload = options.token ? verifyToken(options.token) : null;
    const userId = payload?.userId ?? client.sessionId;
    const type = options.type || (payload ? 'authenticated' : 'human');

    upsertUser(userId, name, type);
    console.log(`[GameRoom] ${name} joined (${type})`);

    if (!this.worldState) return;

    // Check if game is active — mid-game joiners become spectators
    const gamePhase = this.worldState.gameState.phase;
    const isGameActive = gamePhase === 'countdown' || gamePhase === 'playing';
    const isHuman = type !== 'ai';
    const initialState = (isGameActive && isHuman) ? 'spectating' : 'alive';

    const player = this.worldState.addPlayer(client.sessionId, name, type, initialState);

    const initState = this.worldState.getState();
    initState.environment = { ...this.worldState.environment };
    client.send('init', {
      playerId: client.sessionId,
      worldState: initState,
      spectating: initialState === 'spectating'
    });

    this.broadcast('player_joined', player, { except: client });

    // Visual announcement for human players
    if (isHuman) {
      const announcement = this.worldState.announce(`${name} has entered the arena!`, 'system', 4000);
      this.broadcast('announcement', announcement);
    }

    if (initialState === 'spectating') {
      this._systemMessage(`${name} joined — watching until next round`);
    } else {
      this._systemMessage(`${name} has entered the arena`);
    }

    this.worldState.addEvent('player_join', { playerId: client.sessionId, name, type });
  }

  onLeave(client) {
    console.log(`[GameRoom] Player left: ${client.sessionId}`);
    if (!this.worldState) return;

    const player = this.worldState.players.get(client.sessionId);
    const name = player?.name || client.sessionId;

    this.worldState.removePlayer(client.sessionId);
    this.broadcast('player_left', { id: client.sessionId, name });
    this._systemMessage(`${name} has left`);
    this.worldState.addEvent('player_leave', { playerId: client.sessionId, name });
  }

  onDispose() {
    console.log(`[GameRoom] Room disposed`);
  }
}
