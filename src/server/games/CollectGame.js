/**
 * CollectGame Mini-Game
 *
 * Collect the most items before time runs out.
 * Agent spawns collectibles, players race to gather them.
 */

import { MiniGame } from '../MiniGame.js';

export class CollectGame extends MiniGame {
  constructor(worldState, broadcastFn, config = {}) {
    super(worldState, broadcastFn, { ...config, type: 'collect' });

    this.collectibleCount = config.collectibleCount || 10;
    this.spawnArea = config.spawnArea || { x: [-20, 20], y: [2, 10], z: [-30, 10] };
    this.collectibleIds = [];
  }

  start() {
    super.start();

    // Spawn collectibles
    for (let i = 0; i < this.collectibleCount; i++) {
      const position = [
        this.randomInRange(this.spawnArea.x[0], this.spawnArea.x[1]),
        this.randomInRange(this.spawnArea.y[0], this.spawnArea.y[1]),
        this.randomInRange(this.spawnArea.z[0], this.spawnArea.z[1])
      ];

      const collectible = this.spawnEntity('collectible', position, [1, 1, 1], {
        color: '#f1c40f',
        value: 1
      });
      this.collectibleIds.push(collectible.id);
    }

    this.announce(`COLLECT ${this.collectibleCount} ITEMS!`, 'challenge');
    console.log(`[CollectGame] Spawned ${this.collectibleCount} collectibles`);
    return this;
  }

  randomInRange(min, max) {
    return Math.random() * (max - min) + min;
  }

  // Called when a player collects an item
  onCollect(playerId, entityId) {
    if (!this.isActive) return;

    // Check if it's one of our collectibles
    const index = this.collectibleIds.indexOf(entityId);
    if (index === -1) return;

    // Remove from tracking
    this.collectibleIds.splice(index, 1);

    // Add score
    this.addScore(playerId, 1);

    // Announce score milestone
    const score = this.scores.get(playerId) || 0;
    if (score % 5 === 0) {
      const player = this.worldState.players.get(playerId);
      this.announce(`${player?.name || 'Player'}: ${score} items!`, 'player');
    }

    // Check if all collected
    if (this.collectibleIds.length === 0) {
      this.end('win', this.getHighestScorer());
    }
  }

  checkWinCondition() {
    // Win by timeout handled in base class
    // Win by collecting all handled in onCollect
    return null;
  }

  getHighestScorer() {
    let highestScore = 0;
    let winner = null;

    for (const [playerId, score] of this.scores) {
      if (score > highestScore) {
        highestScore = score;
        winner = playerId;
      }
    }

    return winner;
  }

  end(result, winnerId = null) {
    // If timeout, find highest scorer
    if (result === 'timeout') {
      winnerId = this.getHighestScorer();
      if (winnerId) {
        result = 'win';
      }
    }

    return super.end(result, winnerId);
  }

  getResultMessage(result, winnerId) {
    if (result === 'win') {
      const winner = this.worldState.players.get(winnerId);
      const score = this.scores.get(winnerId) || 0;
      return `${winner?.name || 'Player'} WINS with ${score} items!`;
    }
    return super.getResultMessage(result, winnerId);
  }
}
