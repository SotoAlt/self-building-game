/**
 * MiniGame - Base class for all mini-games
 *
 * Provides common functionality for game types:
 * - reach: First to touch target wins
 * - collect: Most collectibles in time wins
 * - survival: Last player standing wins
 * - king: Control hill zones to earn points
 * - hot_potato: Pass the curse before it eliminates you
 * - race: Hit checkpoints in order
 */

import { randomUUID } from 'crypto';
import { saveGameHistory } from './db.js';

// Random obstacle patterns used by _spawnRandomObstacles
const OBSTACLE_PATTERNS = ['sweeper', 'moving_wall', 'pendulum', 'falling_block'];

// Half-width of the arena area for random obstacle placement
const ARENA_SPREAD = 30;

// Game type registry - agents can query this
export const GAME_TYPES = {
  reach: {
    name: 'Reach the Goal',
    description: 'First player to touch the target wins',
    minPlayers: 1,
    hasTimer: true,
    defaultTimeLimit: 60000
  },
  collect: {
    name: 'Collect-a-thon',
    description: 'Collect the most items before time runs out',
    minPlayers: 1,
    hasTimer: true,
    defaultTimeLimit: 45000
  },
  survival: {
    name: 'Survival',
    description: 'Last player standing wins',
    minPlayers: 2,
    hasTimer: true,
    defaultTimeLimit: 90000
  },
  king: {
    name: 'King of the Hill',
    description: 'Control zones to earn points',
    minPlayers: 2,
    hasTimer: true,
    defaultTimeLimit: 90000
  },
  hot_potato: {
    name: 'Hot Potato',
    description: 'Pass the curse before it eliminates you',
    minPlayers: 2,
    hasTimer: true,
    defaultTimeLimit: 120000
  },
  race: {
    name: 'Checkpoint Race',
    description: 'Hit all checkpoints in order',
    minPlayers: 1,
    hasTimer: true,
    defaultTimeLimit: 90000
  }
};

export class MiniGame {
  constructor(worldState, broadcastFn, config = {}) {
    this.id = `minigame-${randomUUID().slice(0, 8)}`;
    this.worldState = worldState;
    this.broadcast = broadcastFn;
    this.config = config;

    this.type = config.type || 'reach';
    this.timeLimit = config.timeLimit || this._randomizeTimeLimit(config.type || 'reach');
    this.startTime = null;
    this.isActive = false;

    this.players = new Map(); // playerId -> { score, alive, position }
    this.scores = new Map();
    this.winners = [];
    this.losers = [];

    // Entities created for this game (for cleanup)
    this.gameEntities = [];

    // Callback for when game ends (set by server to notify AgentLoop)
    this.onEnd = null;

    // Trick system — timed/conditional events the agent configures
    this.tricks = [];
    this._trickIdCounter = 0;

    // Tracks whether the first real update tick (post-countdown) has fired
    this._gameStarted = false;

    // Time warnings (data-driven to avoid repetitive boolean flags)
    this._timeWarnings = [
      { at: 30000, message: '30 SECONDS!' },
      { at: 10000, message: '10 SECONDS!' },
      { at: 5000, message: 'FINAL 5 SECONDS!' },
    ];
  }

  // Start the game
  start() {
    this.isActive = true;
    this.startTime = Date.now();

    // Initialize player states and teleport to start (skip spectators)
    for (const [id, player] of this.worldState.players) {
      if (player.state === 'spectating') continue;
      this.players.set(id, {
        score: 0,
        alive: true,
        position: [...player.position]
      });
      player.position = [...this.worldState.respawnPoint];
    }
    this.broadcast('players_teleported', { position: this.worldState.respawnPoint });

    // Announce BEFORE phase change so clients see these first
    this.announce('GET READY!', 'system');
    this.announce(`${GAME_TYPES[this.type]?.name || this.type} starting!`, 'system');

    // Start game in world state
    this.worldState.startGame(this.type, {
      timeLimit: this.timeLimit,
      countdownTime: this.config.countdownTime || 5000
    });

    // Setup default tricks (overridden by subclasses)
    this.setupDefaultTricks();

    console.log(`[MiniGame] Started: ${this.type} (${this.timeLimit}ms)`);
    return this;
  }

  // Override in subclasses to add default tricks
  setupDefaultTricks() {}

  // Called every tick
  update(delta) {
    if (!this.isActive) return;

    // Skip scoring, tricks, and time tracking during countdown — players can move freely
    if (this.worldState.gameState.phase === 'countdown') return;

    // Reset startTime on first real update tick (after countdown ends)
    if (!this._gameStarted) {
      this._gameStarted = true;
      this.startTime = Date.now();
    }

    const elapsed = Date.now() - this.startTime;

    // Check time limit
    if (elapsed >= this.timeLimit) {
      this.end('timeout');
      return;
    }

    // End if all players eliminated or disconnected
    const anyAlive = Array.from(this.players.values()).some(p => p.alive);
    if (!anyAlive && this.players.size > 0) {
      this.end('draw');
      return;
    }

    // Process tricks
    this.processTricks(elapsed);

    // Time warnings
    const remaining = this.timeLimit - elapsed;
    for (const warning of this._timeWarnings) {
      if (remaining <= warning.at && !warning.fired) {
        this.announce(warning.message, 'system');
        warning.fired = true;
      }
    }

    // Check win condition (to be overridden)
    const result = this.checkWinCondition();
    if (result) {
      this.end(result.type, result.winnerId);
    }
  }

  // Override in subclasses
  checkWinCondition() {
    return null; // { type: 'win', winnerId: '...' }
  }

  // Record player score
  addScore(playerId, points = 1) {
    const player = this.players.get(playerId);
    if (player) {
      player.score += points;
      this.scores.set(playerId, (this.scores.get(playerId) || 0) + points);
    }
  }

  // Mark player as eliminated
  eliminatePlayer(playerId) {
    const player = this.players.get(playerId);
    if (!player || !player.alive) return; // Already eliminated or unknown
    player.alive = false;
    this.losers.push(playerId);

    // Check if only one player left
    const alivePlayers = Array.from(this.players.values()).filter(p => p.alive);
    if (alivePlayers.length <= 1 && this.players.size > 1) {
      const winner = Array.from(this.players.entries()).find(([id, p]) => p.alive);
      if (winner) {
        this.end('win', winner[0]);
      }
    }
  }

  // End the game
  end(result, winnerId = null) {
    if (!this.isActive) {
      console.log(`[MiniGame] end() called but already inactive (result: ${result})`);
      return;
    }

    this.isActive = false;
    console.log(`[MiniGame] Ended: ${result}${winnerId ? ` (winner: ${winnerId})` : ''}`);

    if (winnerId) {
      this.winners.push(winnerId);
    }

    // Announce result
    const resultMsg = this.getResultMessage(result, winnerId);
    this.announce(resultMsg, 'challenge');

    // End in world state
    this.worldState.endGame(result, winnerId);

    // Record results to leaderboard
    if (winnerId) {
      this.worldState.recordGameResult(winnerId, true, this.scores.get(winnerId) || 0);
    }
    for (const [playerId] of this.players) {
      if (playerId !== winnerId) {
        this.worldState.recordGameResult(playerId, false, this.scores.get(playerId) || 0);
      }
    }

    // Fire-and-forget DB write
    saveGameHistory({
      id: this.id,
      type: this.type,
      startTime: this.startTime,
      result,
      winnerId,
      playerCount: this.players.size,
      scores: Object.fromEntries(this.scores)
    });

    // Broadcast game ended
    this.broadcast('minigame_ended', {
      id: this.id,
      type: this.type,
      result,
      winners: this.winners,
      losers: this.losers,
      scores: Object.fromEntries(this.scores)
    });

    // Cleanup game entities after delay
    this._cleanupTimer = setTimeout(() => this.cleanup(), 5000);

    // Lobby return announcement
    setTimeout(() => {
      const { phase } = this.worldState.gameState;
      if (phase === 'ended' || phase === 'lobby') {
        this.announce('Returning to lobby... Next game soon!', 'system');
      }
    }, 3000);

    // Notify server (AgentLoop, cleanup currentMiniGame reference)
    this.onEnd?.();

    return { result, winners: this.winners, scores: Object.fromEntries(this.scores) };
  }

  getResultMessage(result, winnerId) {
    switch (result) {
      case 'win': {
        const winner = this.worldState.players.get(winnerId);
        return `WINNER: ${winner?.name || winnerId}!`;
      }
      case 'timeout':
        return 'TIME UP!';
      case 'draw':
        return 'DRAW!';
      case 'ended':
        return 'Game Over!';
      case 'cancelled':
        return 'Game cancelled';
      default:
        return `Game Over: ${result}`;
    }
  }

  // Show announcement
  announce(text, type = 'challenge') {
    const announcement = this.worldState.announce(text, type);
    this.broadcast('announcement', announcement);
  }

  // Spawn entity for this game (tracked for cleanup)
  spawnEntity(type, position, size, properties) {
    const entity = this.worldState.spawnEntity(type, position, size, {
      ...properties,
      gameId: this.id
    });
    this.gameEntities.push(entity.id);
    this.broadcast('entity_spawned', entity);
    return entity;
  }

  // Cleanup game entities
  cleanup() {
    if (this.gameEntities.length === 0) return;
    const count = this.gameEntities.length;
    for (const entityId of this.gameEntities) {
      try {
        this.worldState.destroyEntity(entityId);
        this.broadcast('entity_destroyed', { id: entityId });
      } catch (e) {
        // Entity may already be gone
      }
    }
    this.gameEntities = [];
    console.log(`[MiniGame] Cleaned up ${count} entities`);
  }

  // ============================================
  // Trick System
  // ============================================

  addTrick(trigger, action, params = {}) {
    const id = ++this._trickIdCounter;
    this.tricks.push({ id, trigger, action, params, fired: false, lastFired: 0 });
    return id;
  }

  processTricks(elapsed) {
    for (const trick of this.tricks) {
      if (trick.fired && trick.trigger.type !== 'interval') continue;
      if (this.shouldFireTrick(trick, elapsed)) {
        this.executeTrick(trick, elapsed);
        trick.fired = true;
        trick.lastFired = elapsed;
      }
    }
  }

  shouldFireTrick(trick, elapsed) {
    switch (trick.trigger.type) {
      case 'time':
        return elapsed >= trick.trigger.at;
      case 'score':
        return this.checkScoreTrigger(trick.trigger);
      case 'deaths':
        return this.losers.length >= trick.trigger.count;
      case 'interval':
        return elapsed - trick.lastFired >= trick.trigger.every;
      default:
        return false;
    }
  }

  checkScoreTrigger(trigger) {
    if (trigger.player === 'any') {
      for (const [, score] of this.scores) {
        if (score >= trigger.value) return true;
      }
    } else if (trigger.player) {
      return (this.scores.get(trigger.player) || 0) >= trigger.value;
    }
    return false;
  }

  executeTrick(trick, elapsed) {
    console.log(`[MiniGame] Trick fired: ${trick.action}`);

    // Built-in actions
    switch (trick.action) {
      case 'announce':
        this.announce(trick.params.text || 'The Magician stirs...', trick.params.type || 'system');
        return;
      case 'flip_gravity': {
        const low = trick.params.gravity ?? -3;
        const duration = trick.params.duration ?? 10000;
        const original = this.worldState.physics.gravity;
        this.worldState.setPhysics({ gravity: low });
        this.announce(trick.params.message || 'GRAVITY SHIFTS!', 'system');
        this.broadcast('physics_changed', this.worldState.physics);
        setTimeout(() => {
          if (this.isActive) {
            this.worldState.setPhysics({ gravity: original });
            this.broadcast('physics_changed', this.worldState.physics);
          }
        }, duration);
        return;
      }
      case 'speed_burst': {
        const duration = trick.params.duration ?? 8000;
        const spell = this.worldState.castSpell('speed_boost', duration);
        this.broadcast('spell_cast', spell);
        this.announce('SPEED SURGE!', 'system');
        return;
      }
      default:
        // Delegate to game-specific handler
        this.executeTrickAction(trick);
    }
  }

  // Override in subclasses for game-specific trick actions
  executeTrickAction(trick) {
    console.log(`[MiniGame] Unhandled trick action: ${trick.action}`);
  }

  _randomizeTimeLimit(type) {
    const ranges = {
      reach: [40000, 75000],
      collect: [30000, 60000],
      survival: [60000, 120000],
      king: [60000, 120000],
      hot_potato: [90000, 150000],
      race: [90000, 150000]
    };
    const [min, max] = ranges[type] || [45000, 75000];
    return min + Math.floor(Math.random() * (max - min));
  }

  _spawnRandomObstacles(count) {
    for (let i = 0; i < count; i++) {
      const pattern = OBSTACLE_PATTERNS[Math.floor(Math.random() * OBSTACLE_PATTERNS.length)];
      const x = (Math.random() - 0.5) * ARENA_SPREAD;
      const z = (Math.random() - 0.5) * ARENA_SPREAD;

      switch (pattern) {
        case 'sweeper':
          this.spawnEntity('obstacle', [x, 1, z], [8, 1, 1], {
            color: '#e74c3c',
            rotating: true,
            speed: 2 + Math.random() * 3
          });
          break;
        case 'moving_wall':
          this.spawnEntity('obstacle', [-15, 1, z], [2, 3, 2], {
            color: '#e74c3c',
            kinematic: true,
            path: [[-15, 1, z], [15, 1, z]],
            speed: 1 + Math.random() * 2
          });
          break;
        case 'pendulum':
          this.spawnEntity('platform', [x, 5, z], [4, 0.5, 4], {
            color: '#9b59b6',
            kinematic: true,
            path: [[x, 5, z], [x + 10, 5, z - 10]],
            speed: 1 + Math.random() * 1.5
          });
          break;
        case 'falling_block':
          this.spawnEntity('obstacle', [x, 20, z], [2, 2, 2], {
            color: '#e74c3c',
            falling: true,
            speed: 3 + Math.random() * 4
          });
          break;
      }
    }
    console.log(`[MiniGame] Spawned ${count} random obstacles`);
  }

  // Get game status
  getStatus() {
    return {
      id: this.id,
      type: this.type,
      isActive: this.isActive,
      timeRemaining: this.isActive ? Math.max(0, this.timeLimit - (Date.now() - this.startTime)) : 0,
      players: Object.fromEntries(this.players),
      scores: Object.fromEntries(this.scores),
      winners: this.winners,
      trickCount: this.tricks.length,
      tricksFired: this.tricks.filter(t => t.fired).length
    };
  }
}
