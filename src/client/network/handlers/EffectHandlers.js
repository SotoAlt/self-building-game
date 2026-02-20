/**
 * Effect, environment, chat, and lifecycle WebSocket message handlers.
 */

import { SPELL } from '../../../shared/constants.js';
import { state, hazardPlaneState, player, playerVelocity } from '../../state.js';
import { triggerCameraShake, showVignette, spawnParticles } from '../../vfx/ScreenEffects.js';
import { playSpellSound } from '../../audio/SoundManager.js';
import { setFloorType, applyEnvironment, updateHazardPlaneMaterial, getHazardPlaneMesh } from '../../scene/FloorManager.js';
import { showToast, showAnnouncement, showSpellEffect } from '../../ui/Announcements.js';
import { showAfkWarning, hideAfkWarning, showAfkKickedScreen } from '../../ui/AfkOverlay.js';
import { displayChatMessage } from '../../ui/ChatSystem.js';
import { attemptReconnect, storeReconnectionToken } from '../NetworkManager.js';
import { updateUI } from '../../ui/GameStatusHUD.js';

const SPELL_VIGNETTE_COLORS = {
  [SPELL.SPEED_BOOST]: 'rgba(46,204,113,0.3)',
  [SPELL.INVERT_CONTROLS]: 'rgba(155,89,182,0.4)',
  [SPELL.LOW_GRAVITY]: 'rgba(52,152,219,0.2)',
};

const SPELL_SCALE_VALUES = {
  [SPELL.GIANT]: 2,
  [SPELL.TINY]: 0.4,
};

export function registerEffectHandlers(room) {
  room.onMessage('spell_cast', (spell) => {
    console.log(`[Spell] ${spell.name} cast for ${spell.duration}ms`);
    if (!state.activeEffects) state.activeEffects = [];
    state.activeEffects.push(spell);
    showSpellEffect(spell);
    triggerCameraShake(0.3, 200);
    playSpellSound();

    const vignetteColor = SPELL_VIGNETTE_COLORS[spell.type];
    if (vignetteColor) showVignette(vignetteColor, spell.duration);

    const scale = SPELL_SCALE_VALUES[spell.type];
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
    if (player.mesh) player.mesh.scale.setScalar(1);
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

  room.onMessage('physics_changed', (physics) => {
    state.physics = physics;
    updateUI();
  });

  room.onMessage('afk_warning', ({ token, timeout }) => {
    showAfkWarning(token, timeout);
  });

  room.onMessage('afk_cleared', () => {
    hideAfkWarning();
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

  room.onMessage('announcement', showAnnouncement);

  // Lifecycle handlers
  room.onLeave((code) => {
    console.warn('[Network] Disconnected from room, code:', code);
    storeReconnectionToken();
    state.room = null;
    state.connected = false;
    if (code === 4000) {
      showAfkKickedScreen();
      return;
    }
    if (code === 1000) return;
    attemptReconnect();
  });

  room.onError((code, message) => {
    console.error('[Network] Room error:', code, message);
  });
}
