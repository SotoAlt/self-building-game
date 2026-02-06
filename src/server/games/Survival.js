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

    this.hazardInterval = config.hazardInterval || (3000 + Math.floor(Math.random() * 5000)); // 3-8s
    this.lastHazardTime = 0;
    this.maxHazards = config.maxHazards || (10 + Math.floor(Math.random() * 16)); // 10-25
    this.currentHazards = 0;
    const platDim = 20 + Math.floor(Math.random() * 21); // 20-40
    this.platformSize = config.platformSize || [platDim, 1, platDim];
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

  setupDefaultTricks() {
    // Shrink platform at 20s
    this.addTrick({ type: 'time', at: 20000 }, 'shrink_platform');
    // Shrink again at 45s
    this.addTrick({ type: 'time', at: 45000 }, 'shrink_platform');
    // Hazard wave at 60s
    this.addTrick({ type: 'time', at: 60000 }, 'hazard_wave');
    // Brief gravity flip every 30s (uses built-in flip_gravity with custom message)
    this.addTrick({ type: 'interval', every: 30000 }, 'flip_gravity', { message: 'LOW GRAVITY!' });
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

  executeTrickAction(trick) {
    switch (trick.action) {
      case 'shrink_platform': {
        const platform = this.worldState.entities.get(this.platformId);
        if (platform) {
          const newSize = platform.size.map(s => Math.max(s * 0.8, 5));
          this.worldState.modifyEntity(this.platformId, { size: newSize });
          this.broadcast('entity_modified', platform);
          this.announce('THE ARENA SHRINKS!', 'system');
        }
        break;
      }
      case 'hazard_wave': {
        const count = trick.params.count || 5;
        for (let i = 0; i < count; i++) {
          this.spawnRandomHazard();
        }
        this.announce('HAZARD WAVE INCOMING!', 'system');
        break;
      }
      case 'safe_zone': {
        const duration = trick.params.duration || 8000;
        const safeZone = this.spawnEntity('platform', [0, 0.5, 0], [6, 0.5, 6], {
          color: '#2ecc71'
        });
        this.announce('A safe zone appears! Quick!', 'system');
        setTimeout(() => {
          try {
            this.worldState.destroyEntity(safeZone.id);
            this.broadcast('entity_destroyed', { id: safeZone.id });
            if (this.isActive) this.announce('The safe zone crumbles...', 'system');
          } catch (e) { /* already gone */ }
        }, duration);
        break;
      }
      default:
        super.executeTrickAction(trick);
    }
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
