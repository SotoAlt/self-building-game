/**
 * King of the Hill Mini-Game
 *
 * Control hill zones to earn points. 1 point/second while sole occupant.
 * Contested hills (2+ players) award nothing.
 * Win: first to targetScore OR highest at timeout.
 */

import { MiniGame } from '../MiniGame.js';

// Hill state colors
const HILL_COLOR_OWNED = '#2ecc71';    // sole occupant
const HILL_COLOR_CONTESTED = '#e67e22'; // multiple occupants
const HILL_COLOR_EMPTY = '#f1c40f';     // no occupants

// AABB padding for player hitbox overlap with hill zones
const HILL_PADDING_XZ = 1;
const HILL_PADDING_Y = 2;

export class KingOfHill extends MiniGame {
  constructor(worldState, broadcastFn, config = {}) {
    super(worldState, broadcastFn, { ...config, type: 'king' });
    this.targetScore = config.targetScore || 30;
    this.hillZones = [];          // { entityId, position, size }
    this.playerScores = new Map(); // playerId -> fractional score
    this.lastBroadcastTime = 0;
  }

  _setHillColor(hill, entity, color) {
    if (entity.properties?.color === color) return;
    this.worldState.modifyEntity(hill.entityId, { properties: { ...entity.properties, color } });
    this.broadcast('entity_modified', entity);
  }

  start() {
    super.start();

    // Find hill triggers from template
    for (const [id, entity] of this.worldState.entities) {
      if (entity.properties?.isHill) {
        this.hillZones.push({
          entityId: id,
          position: entity.position,
          size: entity.size
        });
      }
    }

    // If no hills from template, spawn a default center hill
    if (this.hillZones.length === 0) {
      const hill = this.spawnEntity('trigger', [0, 1.5, 0], [6, 3, 6], {
        color: '#f1c40f',
        isHill: true,
        opacity: 0.4
      });
      this.hillZones.push({
        entityId: hill.id,
        position: hill.position,
        size: hill.size
      });
    }

    // Initialize scores
    for (const [id] of this.players) {
      this.playerScores.set(id, 0);
    }

    this._spawnRandomObstacles(2);
    this.announce(`CONTROL THE HILL! First to ${this.targetScore} wins!`, 'challenge');
    return this;
  }

  setupDefaultTricks() {
    this.addTrick({ type: 'time', at: 30000 }, 'move_hill');
    this.addTrick({ type: 'time', at: 60000 }, 'add_hill');
    this.addTrick({ type: 'interval', every: 20000 }, 'announce_scores');
  }

  update(delta) {
    super.update(delta);
    if (!this.isActive || this.worldState.gameState.phase !== 'playing') return;

    // For each hill, determine occupants
    for (const hill of this.hillZones) {
      const entity = this.worldState.entities.get(hill.entityId);
      if (!entity) continue;

      // Refresh position in case entity moved
      hill.position = entity.position;
      hill.size = entity.size;

      const occupants = [];
      const hx = hill.size[0] / 2;
      const hy = hill.size[1] / 2;
      const hz = hill.size[2] / 2;

      for (const [playerId, playerData] of this.players) {
        if (!playerData.alive) continue;
        const player = this.worldState.players.get(playerId);
        if (!player?.position) continue;

        const dx = Math.abs(player.position[0] - hill.position[0]);
        const dy = Math.abs(player.position[1] - hill.position[1]);
        const dz = Math.abs(player.position[2] - hill.position[2]);

        if (dx < hx + HILL_PADDING_XZ && dy < hy + HILL_PADDING_Y && dz < hz + HILL_PADDING_XZ) {
          occupants.push(playerId);
        }
      }

      // Sole occupant scores; contested or empty hills get colored accordingly
      if (occupants.length === 1) {
        const scorer = occupants[0];
        const current = this.playerScores.get(scorer) || 0;
        const newScore = current + delta;
        this.playerScores.set(scorer, newScore);
        this.scores.set(scorer, Math.floor(newScore));
        this._setHillColor(hill, entity, HILL_COLOR_OWNED);
      } else if (occupants.length > 1) {
        this._setHillColor(hill, entity, HILL_COLOR_CONTESTED);
      } else {
        this._setHillColor(hill, entity, HILL_COLOR_EMPTY);
      }
    }

    // Broadcast scores every 1s
    const now = Date.now();
    if (now - this.lastBroadcastTime >= 1000) {
      this.lastBroadcastTime = now;
      const scoreData = {};
      for (const [pid, score] of this.playerScores) {
        const player = this.worldState.players.get(pid);
        scoreData[pid] = { name: player?.name || pid.slice(0, 8), score: Math.floor(score) };
      }
      this.broadcast('score_update', { scores: scoreData, targetScore: this.targetScore, gameType: 'king' });
    }
  }

  checkWinCondition() {
    for (const [playerId, score] of this.playerScores) {
      if (Math.floor(score) >= this.targetScore) {
        return { type: 'win', winnerId: playerId };
      }
    }
    return null;
  }

  end(result, winnerId = null) {
    // On timeout, highest scorer wins
    if (result === 'timeout') {
      let bestScore = 0;
      let bestPlayer = null;
      for (const [pid, score] of this.playerScores) {
        if (score > bestScore) {
          bestScore = score;
          bestPlayer = pid;
        }
      }
      if (bestPlayer && bestScore > 0) {
        winnerId = bestPlayer;
        result = 'win';
      }
    }
    return super.end(result, winnerId);
  }

  executeTrickAction(trick) {
    switch (trick.action) {
      case 'move_hill': {
        if (this.hillZones.length === 0) break;
        const idx = Math.floor(Math.random() * this.hillZones.length);
        const hill = this.hillZones[idx];
        const entity = this.worldState.entities.get(hill.entityId);
        if (entity) {
          const newPos = [
            (Math.random() - 0.5) * 20,
            entity.position[1],
            (Math.random() - 0.5) * 20
          ];
          this.worldState.modifyEntity(hill.entityId, { position: newPos });
          this.broadcast('entity_modified', entity);
          this.announce('THE HILL MOVED!', 'system');
        }
        break;
      }
      case 'add_hill': {
        const pos = [(Math.random() - 0.5) * 20, 1.5, (Math.random() - 0.5) * 20];
        const newHill = this.spawnEntity('trigger', pos, [5, 3, 5], {
          color: '#f1c40f',
          isHill: true,
          opacity: 0.4
        });
        this.hillZones.push({ entityId: newHill.id, position: pos, size: [5, 3, 5] });
        this.announce('A NEW HILL APPEARED!', 'system');
        break;
      }
      case 'announce_scores': {
        const sorted = [...this.playerScores.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3);
        if (sorted.length > 0) {
          const lines = sorted.map(([pid, score]) => {
            const player = this.worldState.players.get(pid);
            return `${player?.name || 'Player'}: ${Math.floor(score)}`;
          });
          this.announce(`Scores: ${lines.join(' | ')}`, 'system');
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
      const score = Math.floor(this.playerScores.get(winnerId) || 0);
      return `${winner?.name || 'Player'} RULES THE HILL! (${score} pts)`;
    }
    return super.getResultMessage(result, winnerId);
  }
}
