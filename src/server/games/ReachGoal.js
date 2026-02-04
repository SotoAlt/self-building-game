/**
 * ReachGoal Mini-Game
 *
 * First player to touch the target entity wins.
 * Agent spawns a goal, players race to reach it.
 */

import { MiniGame } from '../MiniGame.js';

export class ReachGoal extends MiniGame {
  constructor(worldState, broadcastFn, config = {}) {
    super(worldState, broadcastFn, { ...config, type: 'reach' });

    this.targetEntityId = config.targetEntityId || null;
    this.goalPosition = config.goalPosition || [0, 5, -30];
    this.goalSize = config.goalSize || [3, 3, 3];

    // Track who has reached checkpoints (for multi-checkpoint courses)
    this.checkpointsReached = new Map();
  }

  start() {
    super.start();

    // If no target specified, create one
    if (!this.targetEntityId) {
      const goal = this.spawnEntity('trigger', this.goalPosition, this.goalSize, {
        color: '#f1c40f',
        rotating: true,
        speed: 2,
        isGoal: true
      });
      this.targetEntityId = goal.id;
      console.log(`[ReachGoal] Created goal at [${this.goalPosition.join(', ')}]`);
    }

    this.announce(`REACH THE GOLDEN GOAL!`, 'challenge');
    return this;
  }

  checkWinCondition() {
    // Check if any player is touching the target
    const targetEntity = this.worldState.entities.get(this.targetEntityId);
    if (!targetEntity) {
      console.warn('[ReachGoal] Target entity not found');
      return null;
    }

    const targetPos = targetEntity.position;
    const targetSize = targetEntity.size || [3, 3, 3];

    for (const [playerId, player] of this.worldState.players) {
      if (!player.position) continue;

      // Simple AABB check
      const dx = Math.abs(player.position[0] - targetPos[0]);
      const dy = Math.abs(player.position[1] - targetPos[1]);
      const dz = Math.abs(player.position[2] - targetPos[2]);

      const reachX = dx < (targetSize[0] / 2 + 1); // +1 for player size
      const reachY = dy < (targetSize[1] / 2 + 2);
      const reachZ = dz < (targetSize[2] / 2 + 1);

      if (reachX && reachY && reachZ) {
        console.log(`[ReachGoal] Player ${playerId} reached the goal!`);
        return { type: 'win', winnerId: playerId };
      }
    }

    return null;
  }

  // Handle player touching the goal (called from server when trigger activated)
  onPlayerReachedGoal(playerId) {
    if (!this.isActive) return;

    const result = { type: 'win', winnerId: playerId };
    this.end(result.type, result.winnerId);
  }

  getResultMessage(result, winnerId) {
    if (result === 'win') {
      const winner = this.worldState.players.get(winnerId);
      return `${winner?.name || 'Player'} REACHED THE GOAL FIRST!`;
    }
    return super.getResultMessage(result, winnerId);
  }
}
