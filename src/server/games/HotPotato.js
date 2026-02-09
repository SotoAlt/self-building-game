/**
 * Hot Potato Mini-Game
 *
 * One random player gets "the curse" (red glow).
 * Curse transfers on proximity (< 3 units, 2s cooldown).
 * Sub-timer (10-16s) — when it expires, cursed player is eliminated.
 * Multi-round: after elimination, curse resets to random survivor.
 * Last player standing wins.
 */

import { MiniGame } from '../MiniGame.js';

export class HotPotato extends MiniGame {
  constructor(worldState, broadcastFn, config = {}) {
    super(worldState, broadcastFn, { ...config, type: 'hot_potato' });
    this.cursedPlayerId = null;
    this.curseTimer = 0;           // ms remaining
    this.curseDuration = 0;        // total per-round
    this.transferCooldown = 2000;  // 2s between transfers
    this.lastTransferTime = 0;
    this.PROXIMITY_RADIUS = 3.0;
    this.round = 0;
    this.lastCurseUpdateBroadcast = 0;
  }

  start() {
    super.start();
    this._spawnRandomObstacles(1 + Math.floor(Math.random() * 2));
    this._startNewRound();
    this.announce('HOT POTATO! Don\'t get caught with the curse!', 'challenge');
    return this;
  }

  setupDefaultTricks() {
    this.addTrick({ type: 'time', at: 30000 }, 'shrink_arena');
    this.addTrick({ type: 'time', at: 60000 }, 'shrink_arena');
    this.addTrick({ type: 'interval', every: 25000 }, 'speed_curse');
  }

  _getAlivePlayers() {
    return Array.from(this.players.entries()).filter(([, p]) => p.alive);
  }

  _startNewRound() {
    this.round++;
    const alive = this._getAlivePlayers();

    if (alive.length <= 1) {
      // Game over
      if (alive.length === 1) {
        this.end('win', alive[0][0]);
      } else {
        this.end('draw');
      }
      return;
    }

    // Pick random alive player as cursed
    const randomIdx = Math.floor(Math.random() * alive.length);
    this.cursedPlayerId = alive[randomIdx][0];
    this.curseDuration = 10000 + Math.floor(Math.random() * 6000); // 10-16s
    this.curseTimer = this.curseDuration;
    this.lastTransferTime = Date.now();

    const player = this.worldState.players.get(this.cursedPlayerId);
    const name = player?.name || 'Player';

    this.broadcast('curse_changed', {
      cursedPlayerId: this.cursedPlayerId,
      curseTimer: this.curseTimer,
      curseDuration: this.curseDuration,
      round: this.round,
      playersAlive: alive.length
    });

    this.announce(`Round ${this.round}! ${name} has the curse!`, 'system');
  }

  update(delta) {
    super.update(delta);
    if (!this.isActive || this.worldState.gameState.phase !== 'playing') return;
    if (!this.cursedPlayerId) return;

    // Decrement curse timer
    this.curseTimer -= delta * 1000;

    // Timer expired — eliminate cursed player
    if (this.curseTimer <= 0) {
      this._eliminateCursed();
      return;
    }

    // Proximity check: find nearest alive player to cursed player
    const cursedPlayer = this.worldState.players.get(this.cursedPlayerId);
    if (!cursedPlayer?.position) return;

    const now = Date.now();
    const canTransfer = now - this.lastTransferTime >= this.transferCooldown;

    // Check all alive non-cursed players for proximity transfer
    if (canTransfer) {
      for (const [playerId, playerData] of this.players) {
        if (!playerData.alive || playerId === this.cursedPlayerId) continue;
        const player = this.worldState.players.get(playerId);
        if (!player?.position) continue;

        const dx = player.position[0] - cursedPlayer.position[0];
        const dy = player.position[1] - cursedPlayer.position[1];
        const dz = player.position[2] - cursedPlayer.position[2];
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

        if (dist < this.PROXIMITY_RADIUS) {
          this._transferCurse(playerId);
          break; // Only one transfer per tick
        }
      }
    }

    // Broadcast curse timer every 500ms
    if (now - this.lastCurseUpdateBroadcast >= 500) {
      this.lastCurseUpdateBroadcast = now;
      this.broadcast('curse_timer_update', {
        cursedPlayerId: this.cursedPlayerId,
        curseTimer: Math.max(0, this.curseTimer),
        curseDuration: this.curseDuration
      });
    }
  }

  _transferCurse(newPlayerId) {
    const oldCursed = this.cursedPlayerId;
    this.cursedPlayerId = newPlayerId;
    this.lastTransferTime = Date.now();

    // Bonus time for successful pass
    this.curseTimer = Math.min(this.curseTimer + 2000, this.curseDuration);

    const oldPlayer = this.worldState.players.get(oldCursed);
    const newPlayer = this.worldState.players.get(newPlayerId);

    this.broadcast('curse_changed', {
      cursedPlayerId: this.cursedPlayerId,
      previousCursedId: oldCursed,
      curseTimer: this.curseTimer,
      curseDuration: this.curseDuration,
      round: this.round,
      playersAlive: this._getAlivePlayers().length
    });

    this.announce(`${newPlayer?.name || 'Player'} got the curse from ${oldPlayer?.name || 'Player'}!`, 'system');
  }

  _scheduleNextRound() {
    const alive = this._getAlivePlayers();
    if (alive.length > 1) {
      setTimeout(() => {
        if (this.isActive) this._startNewRound();
      }, 2000);
    }
    // If <= 1 alive, eliminatePlayer already handled the win
  }

  _eliminateCursed() {
    const player = this.worldState.players.get(this.cursedPlayerId);
    const name = player?.name || 'Player';

    this.eliminatePlayer(this.cursedPlayerId);
    this.announce(`${name} ELIMINATED by the curse!`, 'system');

    this.broadcast('curse_eliminated', {
      playerId: this.cursedPlayerId,
      round: this.round
    });

    this.cursedPlayerId = null;
    this._scheduleNextRound();
  }

  onPlayerDeath(playerId) {
    if (!this.isActive) return;

    this.eliminatePlayer(playerId);
    const player = this.worldState.players.get(playerId);
    this.announce(`${player?.name || 'Player'} ELIMINATED!`, 'system');

    // If dead player was cursed, reset curse and schedule next round
    if (playerId === this.cursedPlayerId) {
      this.cursedPlayerId = null;
      this._scheduleNextRound();
    }
  }

  checkWinCondition() {
    // Win conditions handled in _eliminateCursed and eliminatePlayer
    return null;
  }

  executeTrickAction(trick) {
    switch (trick.action) {
      case 'shrink_arena': {
        // Find the biggest platform and shrink it
        let biggestId = null;
        let biggestSize = 0;
        for (const [id, entity] of this.worldState.entities) {
          if (entity.type !== 'platform') continue;
          const vol = entity.size[0] * entity.size[1] * entity.size[2];
          if (vol > biggestSize) {
            biggestSize = vol;
            biggestId = id;
          }
        }
        if (biggestId) {
          const entity = this.worldState.entities.get(biggestId);
          const newSize = entity.size.map(s => Math.max(s * 0.75, 3));
          this.worldState.modifyEntity(biggestId, { size: newSize });
          this.broadcast('entity_modified', entity);
          this.announce('THE ARENA SHRINKS!', 'system');
        }
        break;
      }
      case 'speed_curse': {
        // Cursed player gets a brief speed debuff
        if (this.cursedPlayerId) {
          const spell = this.worldState.castSpell('slow_motion', 5000);
          this.broadcast('spell_cast', spell);
          this.announce('SLOW CURSE!', 'system');
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
      return `${winner?.name || 'Player'} SURVIVES THE CURSE! (${this.round} rounds)`;
    }
    if (result === 'draw') {
      return 'EVERYONE GOT CURSED!';
    }
    return super.getResultMessage(result, winnerId);
  }
}
