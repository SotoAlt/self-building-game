/**
 * MiniGame - Base class for all mini-games
 *
 * Provides common functionality for game types:
 * - reach: First to touch target wins
 * - collect: Most collectibles in time wins
 * - survival: Last player standing wins
 */

import { randomUUID } from 'crypto';
import { saveGameHistory } from './db.js';

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
  }
};

export class MiniGame {
  constructor(worldState, broadcastFn, config = {}) {
    this.id = `minigame-${randomUUID().slice(0, 8)}`;
    this.worldState = worldState;
    this.broadcast = broadcastFn;
    this.config = config;

    this.type = config.type || 'reach';
    this.timeLimit = config.timeLimit || GAME_TYPES[this.type]?.defaultTimeLimit || 60000;
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

    // Initialize player states
    for (const [id, player] of this.worldState.players) {
      this.players.set(id, {
        score: 0,
        alive: true,
        position: [...player.position]
      });
    }

    // Start game in world state
    this.worldState.startGame(this.type, {
      timeLimit: this.timeLimit,
      countdownTime: this.config.countdownTime || 3000
    });

    // Setup default tricks (overridden by subclasses)
    this.setupDefaultTricks();

    // Announce start
    this.announce(`${GAME_TYPES[this.type]?.name || this.type} starting!`, 'system');

    console.log(`[MiniGame] Started: ${this.type} (${this.timeLimit}ms)`);
    return this;
  }

  // Override in subclasses to add default tricks
  setupDefaultTricks() {}

  // Called every tick
  update(delta) {
    if (!this.isActive) return;

    // Don't process game logic during countdown — players can't move yet
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
    if (player) {
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
  }

  // End the game
  end(result, winnerId = null) {
    if (!this.isActive) return;

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
    setTimeout(() => this.cleanup(), 5000);

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
