/**
 * Survival Mini-Game
 *
 * Last player standing wins.
 * Agent creates hazards, players must avoid them.
 */

import { MiniGame } from '../MiniGame.js';

export class Survival extends MiniGame {
  constructor(worldState, broadcastFn, config = {}) {
    super(worldState, broadcastFn, { ...config, type: 'survival' });

    this.hazardInterval = config.hazardInterval || 5000; // Spawn hazard every 5s
    this.lastHazardTime = 0;
    this.maxHazards = config.maxHazards || 20;
    this.currentHazards = 0;
    this.platformSize = config.platformSize || [30, 1, 30];
    this.platformId = null;
  }

  start() {
    super.start();

    // Create shrinking platform
    const platform = this.spawnEntity('platform', [0, 0, 0], this.platformSize, {
      color: '#3498db'
    });
    this.platformId = platform.id;

    this.announce('SURVIVE THE CHAOS!', 'challenge');
    console.log('[Survival] Started with platform');
    return this;
  }

  update(delta) {
    super.update(delta);

    if (!this.isActive) return;

    // Spawn hazards periodically
    const now = Date.now();
    if (now - this.lastHazardTime > this.hazardInterval && this.currentHazards < this.maxHazards) {
      this.spawnRandomHazard();
      this.lastHazardTime = now;
    }
  }

  spawnRandomHazard() {
    const hazardTypes = ['falling', 'moving', 'expanding'];
    const type = hazardTypes[Math.floor(Math.random() * hazardTypes.length)];

    switch (type) {
      case 'falling':
        this.spawnFallingHazard();
        break;
      case 'moving':
        this.spawnMovingHazard();
        break;
      case 'expanding':
        this.spawnExpandingObstacle();
        break;
    }

    this.currentHazards++;
  }

  spawnFallingHazard() {
    const x = (Math.random() - 0.5) * 20;
    const z = (Math.random() - 0.5) * 20;

    this.spawnEntity('obstacle', [x, 20, z], [2, 2, 2], {
      color: '#e74c3c',
      falling: true,
      speed: 5
    });

    console.log(`[Survival] Spawned falling hazard at [${x}, 20, ${z}]`);
  }

  spawnMovingHazard() {
    const edge = Math.random() > 0.5 ? -15 : 15;
    const z = (Math.random() - 0.5) * 20;

    this.spawnEntity('obstacle', [edge, 1, z], [3, 2, 3], {
      color: '#e74c3c',
      kinematic: true,
      speed: 3
    });

    console.log(`[Survival] Spawned moving hazard`);
  }

  spawnExpandingObstacle() {
    const x = (Math.random() - 0.5) * 15;
    const z = (Math.random() - 0.5) * 15;

    this.spawnEntity('obstacle', [x, 1, z], [1, 1, 1], {
      color: '#9b59b6',
      expanding: true,
      maxSize: 5
    });

    console.log(`[Survival] Spawned expanding obstacle`);
  }

  // Called when player dies
  onPlayerDeath(playerId) {
    if (!this.isActive) return;

    this.eliminatePlayer(playerId);

    const player = this.worldState.players.get(playerId);
    this.announce(`${player?.name || 'Player'} ELIMINATED!`, 'system');
  }

  checkWinCondition() {
    // Check if only one player alive
    const alivePlayers = Array.from(this.players.entries())
      .filter(([id, p]) => p.alive);

    if (alivePlayers.length === 1 && this.players.size > 1) {
      return { type: 'win', winnerId: alivePlayers[0][0] };
    }

    if (alivePlayers.length === 0) {
      return { type: 'draw', winnerId: null };
    }

    return null;
  }

  getResultMessage(result, winnerId) {
    if (result === 'win') {
      const winner = this.worldState.players.get(winnerId);
      return `${winner?.name || 'Player'} IS THE LAST ONE STANDING!`;
    }
    if (result === 'draw') {
      return 'NO SURVIVORS!';
    }
    return super.getResultMessage(result, winnerId);
  }
}
