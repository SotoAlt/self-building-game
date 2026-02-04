/**
 * MiniGame - Base class for all mini-games
 *
 * Provides common functionality for game types:
 * - reach: First to touch target wins
 * - collect: Most collectibles in time wins
 * - survival: Last player standing wins
 * - obstacle: Complete course without dying
 */

import { randomUUID } from 'crypto';

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
  obstacle: {
    name: 'Obstacle Course',
    description: 'Complete the course without dying',
    minPlayers: 1,
    hasTimer: true,
    defaultTimeLimit: 120000
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

    // Announce start
    this.announce(`${GAME_TYPES[this.type]?.name || this.type} starting!`, 'system');

    console.log(`[MiniGame] Started: ${this.type} (${this.timeLimit}ms)`);
    return this;
  }

  // Called every tick
  update(delta) {
    if (!this.isActive) return;

    // Check time limit
    const elapsed = Date.now() - this.startTime;
    if (elapsed >= this.timeLimit) {
      this.end('timeout');
      return;
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

    return { result, winners: this.winners, scores: Object.fromEntries(this.scores) };
  }

  getResultMessage(result, winnerId) {
    switch (result) {
      case 'win':
        const winner = this.worldState.players.get(winnerId);
        return `WINNER: ${winner?.name || winnerId}!`;
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
    for (const entityId of this.gameEntities) {
      try {
        this.worldState.destroyEntity(entityId);
        this.broadcast('entity_destroyed', { id: entityId });
      } catch (e) {
        // Entity may already be gone
      }
    }
    this.gameEntities = [];
    console.log(`[MiniGame] Cleaned up ${this.gameEntities.length} entities`);
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
      winners: this.winners
    };
  }
}
