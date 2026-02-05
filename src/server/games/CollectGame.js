/**
 * CollectGame Mini-Game
 *
 * Collect the most items before time runs out.
 * Agent spawns collectibles, players race to gather them.
 */

import { MiniGame } from '../MiniGame.js';

function randomInRange(min, max) {
  return Math.random() * (max - min) + min;
}

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
        randomInRange(this.spawnArea.x[0], this.spawnArea.x[1]),
        randomInRange(this.spawnArea.y[0], this.spawnArea.y[1]),
        randomInRange(this.spawnArea.z[0], this.spawnArea.z[1])
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

  setupDefaultTricks() {
    // Scatter remaining collectibles at 15s
    this.addTrick({ type: 'time', at: 15000 }, 'scatter');
    // Spawn bonus items at 30s
    this.addTrick({ type: 'time', at: 30000 }, 'spawn_bonus');
    // Speed burst when any player hits 5
    this.addTrick({ type: 'score', player: 'any', value: 5 }, 'speed_burst');
    // Announce remaining count every 20s
    this.addTrick({ type: 'interval', every: 20000 }, 'announce_remaining');
  }

  executeTrickAction(trick) {
    switch (trick.action) {
      case 'scatter': {
        // Teleport remaining collectibles to new random positions
        for (const id of this.collectibleIds) {
          const entity = this.worldState.entities.get(id);
          if (!entity) continue;
          const newPos = [
            randomInRange(this.spawnArea.x[0], this.spawnArea.x[1]),
            randomInRange(this.spawnArea.y[0], this.spawnArea.y[1]),
            randomInRange(this.spawnArea.z[0], this.spawnArea.z[1])
          ];
          this.worldState.modifyEntity(id, { position: newPos });
          this.broadcast('entity_modified', entity);
        }
        this.announce('ITEMS SCATTERED!', 'system');
        break;
      }
      case 'spawn_bonus': {
        const count = trick.params.count || 3;
        for (let i = 0; i < count; i++) {
          const pos = [
            randomInRange(this.spawnArea.x[0], this.spawnArea.x[1]),
            randomInRange(this.spawnArea.y[0], this.spawnArea.y[1]),
            randomInRange(this.spawnArea.z[0], this.spawnArea.z[1])
          ];
          const bonus = this.spawnEntity('collectible', pos, [1.5, 1.5, 1.5], {
            color: '#f39c12',
            value: 3,
            bonus: true
          });
          this.collectibleIds.push(bonus.id);
        }
        this.announce('BONUS ITEMS APPEARED! (3x value)', 'system');
        break;
      }
      case 'spawn_decoys': {
        const count = trick.params.count || 3;
        for (let i = 0; i < count; i++) {
          const pos = [
            randomInRange(this.spawnArea.x[0], this.spawnArea.x[1]),
            randomInRange(this.spawnArea.y[0], this.spawnArea.y[1]),
            randomInRange(this.spawnArea.z[0], this.spawnArea.z[1])
          ];
          this.spawnEntity('collectible', pos, [1, 1, 1], {
            color: '#e74c3c',
            value: -1,
            decoy: true
          });
          // Decoys are not tracked in collectibleIds — they don't contribute to "all collected" win
        }
        this.announce('Beware the RED ones...', 'system');
        break;
      }
      case 'announce_remaining': {
        const remaining = this.collectibleIds.filter(id => this.worldState.entities.has(id)).length;
        if (remaining > 0) {
          this.announce(`${remaining} items remain!`, 'system');
        }
        break;
      }
      default:
        super.executeTrickAction(trick);
    }
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
    if (score % 2 === 0) {
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
