/**
 * WebSocket message handlers — all room.onMessage + onLeave/onError.
 */

import { state, hazardPlaneState, entityMeshes, remotePlayers, player, playerVelocity, countdown } from '../state.js';
import { addEntity, updateEntity, removeEntity, clearAllEntities } from '../entities/EntityManager.js';
import { updateRemotePlayer, removeRemotePlayer } from '../rendering/RemotePlayers.js';
import { displayChatMessage } from '../ui/ChatSystem.js';
import { showToast, showConnectionWarning, showAnnouncement, showSpellEffect } from '../ui/Announcements.js';
import { showAfkWarning, hideAfkWarning, showAfkKickedScreen } from '../ui/AfkOverlay.js';
import { updateGameStateUI, clearCountdownInterval, updateUI } from '../ui/GameStatusHUD.js';
import { fetchLeaderboard } from '../ui/Leaderboard.js';
import { addKillFeedEntry } from '../ui/SpectatorOverlay.js';
import { setFloorType, applyEnvironment, updateHazardPlaneMaterial, getHazardPlaneMesh } from '../scene/FloorManager.js';
import { applyWorldState } from './HttpApi.js';
import { attemptReconnect } from './NetworkManager.js';
import { triggerCameraShake, screenFlash, showVignette, spawnParticles } from '../vfx/ScreenEffects.js';
import { playCollectSound, playCountdownBeep, playWinFanfare, playSpellSound, playCrackSound, playBreakSound } from '../audio/SoundManager.js';

let _clearSpectating = null;

export function initMessageHandlers({ clearSpectating }) {
  _clearSpectating = clearSpectating;
}

export function registerMessageHandlers(room) {
  room.onLeave((code) => {
    console.warn('[Network] Disconnected from room, code:', code);
    state.room = null;
    state.connected = false;
    if (code === 4000) {
      showAfkKickedScreen();
      return;
    }
    showConnectionWarning(true);
    if (code !== 1000) {
      setTimeout(attemptReconnect, 1000);
    }
  });

  room.onError((code, message) => {
    console.error('[Network] Room error:', code, message);
  });

  room.onMessage('afk_warning', ({ token, timeout }) => {
    showAfkWarning(token, timeout);
  });
  room.onMessage('afk_cleared', () => {
    hideAfkWarning();
  });

  room.onMessage('entity_spawned', (entity) => {
    console.log('[Event] Entity spawned:', entity.id);
    addEntity(entity);
  });

  room.onMessage('entity_modified', (entity) => {
    updateEntity(entity);
  });

  room.onMessage('entity_destroyed', ({ id }) => {
    const mesh = entityMeshes.get(id);
    if (mesh?.userData.cracking) {
      const entity = mesh.userData.entity;
      const color = entity?.properties?.color || '#aaaaaa';
      spawnParticles(mesh.position, color, 20, 5);
      playBreakSound();
    }
    removeEntity(id);
  });

  room.onMessage('platform_cracking', ({ id }) => {
    const mesh = entityMeshes.get(id);
    if (mesh) {
      mesh.userData.cracking = true;
      mesh.userData.crackStart = Date.now();
      playCrackSound();
    }
  });

  room.onMessage('physics_changed', (physics) => {
    state.physics = physics;
    updateUI();
  });

  room.onMessage('player_joined', (p) => {
    console.log('[Event] Player joined:', p.name);
    state.players.set(p.id, p);
    updateRemotePlayer(p);
    updateUI();
  });

  room.onMessage('player_left', ({ id }) => {
    state.players.delete(id);
    removeRemotePlayer(id);
    updateUI();
  });

  room.onMessage('player_moved', ({ id, position, velocity }) => {
    if (id === room.sessionId) return;
    let p = state.players.get(id);
    if (!p) {
      p = { id, position };
      state.players.set(id, p);
    }
    p.position = position;
    updateRemotePlayer(p);
  });

  room.onMessage('player_died', (data) => {
    const p = state.players.get(data.id);
    const name = p?.name || data.id?.slice(0, 8) || 'Player';
    addKillFeedEntry(`${name} died`);
  });

  room.onMessage('chat_message', displayChatMessage);
  room.onMessage('chat_error', ({ error }) => {
    showToast(error || 'Message not sent', 'error');
  });

  room.onMessage('trigger_activated', (data) => {
    const entity = state.entities.get(data.entityId);
    if (entity) {
      spawnParticles(entity.position, '#9b59b6', 15, 3);
    }
  });

  room.onMessage('score_update', (data) => {
    const overlay = document.getElementById('score-overlay');
    if (!overlay) return;
    if (data.gameType !== 'king') { overlay.style.display = 'none'; return; }
    overlay.style.display = 'block';
    const target = data.targetScore || 30;
    const sorted = Object.entries(data.scores).sort((a, b) => b[1].score - a[1].score);
    overlay.innerHTML = `<div class="score-title">KING OF THE HILL (${target})</div>` +
      sorted.map(([, info]) => {
        const pct = Math.min(100, (info.score / target) * 100);
        return `<div class="score-row"><span>${info.name}</span><span>${info.score}</span></div>` +
          `<div class="score-bar"><div class="score-bar-fill" style="width:${pct}%"></div></div>`;
      }).join('');
  });

  room.onMessage('curse_changed', (data) => {
    state._cursedPlayerId = data.cursedPlayerId;
    state._curseRound = data.round;
    for (const [id, mesh] of remotePlayers) {
      if (mesh.material) {
        mesh.material.emissive?.setHex(id === data.cursedPlayerId ? 0xff0000 : 0x000000);
        mesh.material.emissiveIntensity = id === data.cursedPlayerId ? 0.5 : 0;
      }
    }
    if (data.cursedPlayerId === room.sessionId) {
      triggerCameraShake(0.2, 300);
      showVignette('#ff0000', 0.3, data.curseDuration || 12000);
    }
    const curseEl = document.getElementById('curse-timer');
    if (curseEl) {
      curseEl.style.display = 'block';
      curseEl.textContent = `Round ${data.round} — ${data.playersAlive} alive`;
    }
  });

  room.onMessage('curse_timer_update', (data) => {
    const curseEl = document.getElementById('curse-timer');
    if (!curseEl) return;
    curseEl.style.display = 'block';
    const sec = Math.ceil(data.curseTimer / 1000);
    const isLocal = data.cursedPlayerId === room.sessionId;
    curseEl.textContent = isLocal ? `YOU HAVE THE CURSE! ${sec}s` : `Curse: ${sec}s`;
    curseEl.className = sec <= 3 ? 'pulsing' : '';
  });

  room.onMessage('curse_eliminated', (data) => {
    const mesh = remotePlayers.get(data.playerId);
    if (mesh?.material) {
      mesh.material.emissive?.setHex(0x000000);
      mesh.material.emissiveIntensity = 0;
    }
  });

  room.onMessage('checkpoint_reached', (data) => {
    const cpEl = document.getElementById('checkpoint-display');
    if (!cpEl) return;
    cpEl.style.display = 'block';
    if (data.playerId === room.sessionId) {
      cpEl.textContent = `Checkpoint ${data.checkpoint}/${data.total}`;
      cpEl.style.borderColor = '#2ecc71';
      triggerCameraShake(0.1, 150);
    } else {
      cpEl.textContent = `${data.playerName}: ${data.checkpoint}/${data.total}`;
      cpEl.style.borderColor = '#95a5a6';
    }
    const entity = state.entities.get(data.entityId);
    if (entity) spawnParticles(entity.position, '#2ecc71', 20, 4);
    playCollectSound();
  });

  room.onMessage('announcement', showAnnouncement);

  room.onMessage('spell_cast', (spell) => {
    console.log(`[Spell] ${spell.name} cast for ${spell.duration}ms`);
    if (!state.activeEffects) state.activeEffects = [];
    state.activeEffects.push(spell);
    showSpellEffect(spell);
    triggerCameraShake(0.3, 200);
    playSpellSound();

    const SPELL_VIGNETTES = {
      speed_boost: 'rgba(46,204,113,0.3)',
      invert_controls: 'rgba(155,89,182,0.4)',
      low_gravity: 'rgba(52,152,219,0.2)',
    };
    const vignetteColor = SPELL_VIGNETTES[spell.type];
    if (vignetteColor) showVignette(vignetteColor, spell.duration);

    const SPELL_SCALES = { giant: 2, tiny: 0.4 };
    const scale = SPELL_SCALES[spell.type];
    if (scale && player.mesh) {
      player.mesh.scale.setScalar(scale);
      spawnParticles(player.mesh.position, '#9b59b6', 30, 6);
    }

    setTimeout(() => {
      state.activeEffects = (state.activeEffects || []).filter(e => e.id !== spell.id);
      if (scale && player.mesh) player.mesh.scale.setScalar(1);
    }, spell.duration);
  });

  room.onMessage('respawn_point_changed', (data) => {
    state.respawnPoint = data.position;
  });

  room.onMessage('floor_changed', (data) => {
    setFloorType(data.type);
  });

  room.onMessage('hazard_plane_changed', (data) => {
    Object.assign(hazardPlaneState, data);
    getHazardPlaneMesh().visible = data.active;
    getHazardPlaneMesh().position.y = hazardPlaneState.height;
    updateHazardPlaneMaterial(data.type);
  });

  room.onMessage('hazard_plane_update', (data) => {
    Object.assign(hazardPlaneState, data);
    getHazardPlaneMesh().position.y = data.height;
  });

  room.onMessage('environment_changed', (env) => {
    applyEnvironment(env);
  });

  room.onMessage('effects_cleared', () => {
    state.activeEffects = [];
    if (player.mesh) player.mesh.scale.set(1, 1, 1);
  });

  room.onMessage('world_cleared', () => {
    console.log('[Event] World cleared — removing all entities');
    clearAllEntities();
    getHazardPlaneMesh().visible = false;
    Object.assign(hazardPlaneState, { active: false, type: 'lava', height: -10 });
    updateUI();
  });

  room.onMessage('players_teleported', (data) => {
    if (player.mesh && data.position) {
      player.mesh.position.set(data.position[0], data.position[1], data.position[2]);
      playerVelocity.set(0, 0, 0);
      player.isJumping = false;
      player.coyoteTimer = 0;
      player.jumpBufferTimer = 0;
    }
  });

  room.onMessage('player_activated', () => {
    if (state.isSpectating) {
      _clearSpectating();
      showAnnouncement({ id: `activated-${Date.now()}`, text: "You're in! Get ready for the next game!", type: 'system', duration: 4000, timestamp: Date.now() });
    }
  });

  room.onMessage('game_state_changed', (gameState) => {
    console.log('[Event] Game state changed:', gameState.phase);
    const prevPhase = state.gameState.phase;
    state.gameState = gameState;
    updateGameStateUI();

    if (gameState.phase !== 'lobby') {
      state.lobbyCountdownTarget = null;
      state.lobbyReadyAt = null;
    }

    if (gameState.phase === 'lobby' && state.isSpectating) {
      _clearSpectating();
    }

    if (gameState.phase === 'lobby' || gameState.phase === 'ended') {
      const scoreOverlay = document.getElementById('score-overlay');
      const curseTimer = document.getElementById('curse-timer');
      const checkpointDisplay = document.getElementById('checkpoint-display');
      if (scoreOverlay) scoreOverlay.style.display = 'none';
      if (curseTimer) { curseTimer.style.display = 'none'; curseTimer.className = ''; }
      if (checkpointDisplay) checkpointDisplay.style.display = 'none';
      state._cursedPlayerId = null;
      for (const [, mesh] of remotePlayers) {
        if (mesh.material) {
          mesh.material.emissive?.setHex(0x000000);
          mesh.material.emissiveIntensity = 0;
        }
      }
    }

    if (gameState.phase === 'countdown' && prevPhase !== 'countdown') {
      triggerCameraShake(0.1, 5000);
      for (let i = 0; i < 5; i++) setTimeout(() => playCountdownBeep(440), i * 1000);
      setTimeout(() => playCountdownBeep(880), 5000);

      clearCountdownInterval();
      const timerEl = document.getElementById('game-timer');
      timerEl.textContent = '5...';
      timerEl.style.color = '#f39c12';
      let countdownSec = 5;
      countdown.intervalId = setInterval(() => {
        countdownSec--;
        if (countdownSec > 0) {
          timerEl.textContent = `${countdownSec}...`;
        } else {
          timerEl.textContent = 'GO!';
          timerEl.style.color = '#2ecc71';
          clearCountdownInterval();
        }
      }, 1000);
    }

    if (gameState.phase === 'ended') {
      clearCountdownInterval();
      const timerEl = document.getElementById('game-timer');
      setTimeout(fetchLeaderboard, 1000);
      const isWinner = gameState.result === 'win' && gameState.winners?.includes(room.sessionId);
      if (isWinner) {
        timerEl.textContent = 'YOU WIN!';
        timerEl.style.color = '#f1c40f';
        screenFlash('#f1c40f', 600);
        playWinFanfare();
        if (player.mesh) spawnParticles(player.mesh.position, '#f1c40f', 40, 10);
      } else if (gameState.result === 'win') {
        timerEl.textContent = 'GAME OVER';
        timerEl.style.color = '#e74c3c';
        screenFlash('#e74c3c', 500);
      } else if (gameState.result === 'timeout') {
        timerEl.textContent = 'TIME UP!';
        timerEl.style.color = '#f39c12';
      } else if (gameState.result === 'draw') {
        timerEl.textContent = 'DRAW!';
        timerEl.style.color = '#9b59b6';
      } else {
        timerEl.textContent = 'GAME OVER';
        timerEl.style.color = '#e74c3c';
      }
    }
  });

  room.onMessage('lobby_countdown', (data) => {
    state.lobbyCountdownTarget = data.targetTime || null;
    state.lobbyReadyAt = data.lobbyReadyAt || null;
    updateGameStateUI();
  });

  room.onMessage('init', (data) => {
    console.log('[Init] Received initial state from room');
    applyWorldState(data.worldState);
    state.lobbyCountdownTarget = data.lobbyCountdown || null;
    updateUI();

    if (data.spectating) {
      state.isSpectating = true;
      const banner = document.createElement('div');
      banner.id = 'spectator-banner';
      banner.style.cssText = 'position:fixed;top:60px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.8);color:#f39c12;padding:10px 24px;border-radius:8px;font-size:16px;z-index:999;pointer-events:none;';
      banner.textContent = 'Spectating — WASD to fly, drag to look, 0-9 to follow players';
      document.body.appendChild(banner);
    }
  });
}
