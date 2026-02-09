/**
 * Race Mini-Game
 *
 * Hit all checkpoints in order. First to complete all wins.
 * On timeout: most checkpoints reached wins.
 */

import { MiniGame } from '../MiniGame.js';

export class Race extends MiniGame {
  constructor(worldState, broadcastFn, config = {}) {
    super(worldState, broadcastFn, { ...config, type: 'race' });
    this.checkpoints = [];           // sorted { entityId, index }
    this.playerProgress = new Map(); // playerId -> number of checkpoints completed
    this.totalCheckpoints = 0;
  }

  _setEntityColor(entityId, color) {
    const entity = this.worldState.entities.get(entityId);
    if (!entity) return;
    this.worldState.modifyEntity(entityId, { properties: { ...entity.properties, color } });
    this.broadcast('entity_modified', entity);
  }

  start() {
    super.start();

    // Find all checkpoint triggers from template
    for (const [id, entity] of this.worldState.entities) {
      if (entity.properties?.isCheckpoint && typeof entity.properties.checkpointIndex === 'number') {
        this.checkpoints.push({ entityId: id, index: entity.properties.checkpointIndex });
      }
    }
    this.checkpoints.sort((a, b) => a.index - b.index);

    // If no checkpoints from template, generate some along a path
    if (this.checkpoints.length === 0) {
      const count = 5;
      for (let i = 0; i < count; i++) {
        const z = 10 - i * 12;
        const x = ((i % 2 === 0) ? 5 : -5) + (Math.random() - 0.5) * 4;
        const y = 2 + Math.random() * 3;
        const cp = this.spawnEntity('trigger', [x, y, z], [3, 3, 3], {
          color: i === 0 ? '#2ecc71' : '#95a5a6',
          isCheckpoint: true,
          checkpointIndex: i,
          rotating: true,
          speed: 1
        });
        this.checkpoints.push({ entityId: cp.id, index: i });
      }
    }

    this.totalCheckpoints = this.checkpoints.length;

    // Initialize all active players at 0 progress
    for (const [id] of this.players) {
      this.playerProgress.set(id, 0);
    }

    // Highlight first checkpoint green
    if (this.checkpoints.length > 0) {
      this._setEntityColor(this.checkpoints[0].entityId, '#2ecc71');
    }

    this._spawnRandomObstacles(2);
    this.announce(`RACE! Hit ${this.totalCheckpoints} checkpoints in order!`, 'challenge');
    return this;
  }

  setupDefaultTricks() {
    this.addTrick({ type: 'time', at: 20000 }, 'move_checkpoint');
    this.addTrick({ type: 'time', at: 45000 }, 'spawn_obstacles_near_leader');
    this.addTrick({ type: 'interval', every: 15000 }, 'announce', {
      text: 'Keep moving!', type: 'system'
    });
  }

  onTriggerActivated(playerId, entityId) {
    if (!this.isActive) return;

    // Find which checkpoint this entity is
    const cpIndex = this.checkpoints.findIndex(cp => cp.entityId === entityId);
    if (cpIndex === -1) return; // not one of our checkpoints

    const progress = this.playerProgress.get(playerId) || 0;
    const checkpoint = this.checkpoints[cpIndex];

    // Must hit checkpoints in order
    if (checkpoint.index !== progress) return;

    // Valid checkpoint hit
    const newProgress = progress + 1;
    this.playerProgress.set(playerId, newProgress);
    this.addScore(playerId, 1);

    const player = this.worldState.players.get(playerId);
    const name = player?.name || 'Player';

    // Change reached checkpoint to gold
    this._setEntityColor(entityId, '#f1c40f');

    // Broadcast progress (entityId needed by client for particle effects)
    this.broadcast('checkpoint_reached', {
      playerId,
      playerName: name,
      checkpoint: newProgress,
      total: this.totalCheckpoints,
      entityId
    });

    this.announce(`${name}: Checkpoint ${newProgress}/${this.totalCheckpoints}!`, 'system');

    // Highlight next checkpoint green (only if still default gray)
    if (newProgress < this.totalCheckpoints) {
      const nextEntity = this.worldState.entities.get(this.checkpoints[newProgress].entityId);
      if (nextEntity?.properties?.color === '#95a5a6') {
        this._setEntityColor(this.checkpoints[newProgress].entityId, '#2ecc71');
      }
    }

    // Check if all checkpoints done
    if (newProgress >= this.totalCheckpoints) {
      this.end('win', playerId);
    }
  }

  checkWinCondition() {
    // Wins handled in onTriggerActivated; timeout handled by base class
    return null;
  }

  end(result, winnerId = null) {
    // On timeout, player with most checkpoints wins
    if (result === 'timeout') {
      let bestProgress = 0;
      let bestPlayer = null;
      for (const [pid, progress] of this.playerProgress) {
        if (progress > bestProgress) {
          bestProgress = progress;
          bestPlayer = pid;
        }
      }
      if (bestPlayer && bestProgress > 0) {
        winnerId = bestPlayer;
        result = 'win';
      }
    }
    return super.end(result, winnerId);
  }

  executeTrickAction(trick) {
    switch (trick.action) {
      case 'move_checkpoint': {
        // Move a random uncompleted checkpoint
        const uncompleted = this.checkpoints.filter(cp => {
          // Check if any player hasn't reached this one yet
          for (const [, progress] of this.playerProgress) {
            if (progress <= cp.index) return true;
          }
          return false;
        });
        if (uncompleted.length === 0) break;
        const target = uncompleted[Math.floor(Math.random() * uncompleted.length)];
        const entity = this.worldState.entities.get(target.entityId);
        if (entity) {
          const newPos = [
            entity.position[0] + (Math.random() - 0.5) * 10,
            entity.position[1] + (Math.random() - 0.5) * 3,
            entity.position[2] + (Math.random() - 0.5) * 10
          ];
          this.worldState.modifyEntity(target.entityId, { position: newPos });
          this.broadcast('entity_modified', entity);
          this.announce('A CHECKPOINT MOVED!', 'system');
        }
        break;
      }
      case 'spawn_obstacles_near_leader': {
        // Find the leading player's next checkpoint and spawn obstacles near it
        let bestProgress = 0;
        for (const [, progress] of this.playerProgress) {
          if (progress > bestProgress) bestProgress = progress;
        }
        const nextCpIdx = Math.min(bestProgress, this.checkpoints.length - 1);
        const nextCp = this.worldState.entities.get(this.checkpoints[nextCpIdx]?.entityId);
        if (nextCp) {
          for (let i = 0; i < 2; i++) {
            this.spawnEntity('obstacle', [
              nextCp.position[0] + (Math.random() - 0.5) * 8,
              nextCp.position[1],
              nextCp.position[2] + (Math.random() - 0.5) * 8
            ], [2, 2, 2], { color: '#e74c3c', rotating: true, speed: 3 });
          }
          this.announce('Obstacles near the next checkpoint!', 'system');
        }
        break;
      }
      default:
        super.executeTrickAction(trick);
    }
  }

  getResultMessage(result, winnerId) {
    if (result === 'win') {
      const winner = this.worldState.players.get(winnerId);
      const progress = this.playerProgress.get(winnerId) || 0;
      return `${winner?.name || 'Player'} WINS THE RACE! (${progress}/${this.totalCheckpoints})`;
    }
    return super.getResultMessage(result, winnerId);
  }
}
