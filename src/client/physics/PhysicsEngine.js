/**
 * Physics Engine — player physics, collision detection, death/respawn, triggers.
 */

import * as THREE from 'three';
import {
  PHYSICS, GROUND_Y, ABYSS_DEATH_Y, LAVA_DEATH_Y, VOID_DEATH_Y,
  DEATH_COOLDOWN, MOVE_INTERVAL, isMobile
} from '../config.js';
import {
  ENTITY_TYPES, SPELL, FLOOR_TYPES, DEFAULT_SERVER_PHYSICS
} from '../../shared/constants.js';
import {
  state, player, playerVelocity, collision, death, boost,
  activatedTriggers, entityMeshes, floor, hazardPlaneState, network
} from '../state.js';
import { createPlayerCharacter } from '../PlayerVisuals.js';
import { keys } from '../input/InputManager.js';
import { touchJoystick } from '../input/MobileControls.js';
import { playJumpSound, playDeathSound, playCollectSound, playBounceSound } from '../audio/SoundManager.js';
import { triggerCameraShake, screenFlash, spawnParticles } from '../vfx/ScreenEffects.js';
import { removeEntity } from '../entities/EntityManager.js';
import { shortAngleDist } from '../math.js';

let _scene, _sendToServer, _getCameraDirections, _updateCamera;

export function initPhysics({ scene, sendToServer, getCameraDirections, updateCamera }) {
  _scene = scene;
  _sendToServer = sendToServer;
  _getCameraDirections = getCameraDirections;
  _updateCamera = updateCamera;
}

const playerBox = new THREE.Box3();
const entityBox = new THREE.Box3();
const _moveDir = new THREE.Vector3();
const _platformVelocity = new THREE.Vector3();

function moveToward(current, target, maxDelta) {
  if (Math.abs(target - current) <= maxDelta) return target;
  return current + Math.sign(target - current) * maxDelta;
}

function hasEffect(effectType) {
  if (!state.activeEffects) return false;
  const now = Date.now();
  return state.activeEffects.some(e => e.type === effectType && now - e.startTime < e.duration);
}

function collectItem(entity) {
  _sendToServer('collect', { entityId: entity.id });
  spawnParticles(entity.position, '#f1c40f', 20, 4);
  spawnParticles(entity.position, '#ffffff', 8, 2);
  playCollectSound();
  removeEntity(entity.id);
  console.log(`[Collect] Picked up ${entity.id}`);
}

function playerDie() {
  if (!player.mesh || state.localPlayer?.state === 'dead') return;

  const now = Date.now();
  if (now - death.lastDeathTime < DEATH_COOLDOWN) return;
  death.lastDeathTime = now;

  console.log('[Player] Died!');

  if (state.localPlayer) {
    state.localPlayer.state = 'dead';
  }

  _sendToServer('died', { position: player.mesh.position.toArray() });

  spawnParticles(player.mesh.position, '#e74c3c', 35, 8);
  spawnParticles(player.mesh.position, '#ff6600', 15, 5);
  playDeathSound();
  triggerCameraShake(0.5, 300);
  screenFlash('#e74c3c', 400);

  player.mesh.material.color.setHex(0xff0000);
  player.mesh.material.emissive.setHex(0xff0000);

  setTimeout(respawnPlayer, 1500);
}

function respawnPlayer() {
  if (!player.mesh) return;

  const rp = state.respawnPoint || [0, 2, 0];
  player.mesh.position.set(rp[0], rp[1], rp[2]);
  playerVelocity.set(0, 0, 0);
  player.isJumping = false;
  player.coyoteTimer = 0;
  player.jumpBufferTimer = 0;
  player.mesh.material.color.setHex(0x00ff88);
  player.mesh.material.emissive.setHex(0x00ff88);

  death.respawnInvulnUntil = Date.now() + 2000;

  if (state.localPlayer) {
    state.localPlayer.state = 'alive';
  }

  _sendToServer('respawn', {});
  console.log('[Player] Respawned');
}

function triggerEvent(entity) {
  const now = Date.now();
  const lastActivation = activatedTriggers.get(entity.id) || 0;
  if (now - lastActivation < 2000) return;

  activatedTriggers.set(entity.id, now);
  console.log(`[Trigger] Activated: ${entity.id}`);
  _sendToServer('trigger_activated', { entityId: entity.id });
}

export function createPlayer() {
  player.mesh = createPlayerCharacter();
  _scene.add(player.mesh);
}

export function checkCollisions() {
  if (!player.mesh) return;

  const pp = player.mesh.position;
  playerBox.min.set(pp.x - 0.5, pp.y - 1.0, pp.z - 0.5);
  playerBox.max.set(pp.x + 0.5, pp.y + 1.0, pp.z + 0.5);

  let standingOnPlatform = false;
  let platformY = 0;
  let hasPlatformVelocity = false;
  collision.standingOnEntity = null;

  for (const [, mesh] of entityMeshes) {
    const entity = mesh.userData.entity;
    if (!entity) continue;

    const isGrouped = mesh.parent && mesh.parent !== _scene;
    const ep = isGrouped
      ? { x: mesh.parent.position.x + mesh.position.x,
          y: mesh.parent.position.y + mesh.position.y,
          z: mesh.parent.position.z + mesh.position.z }
      : mesh.position;
    const halfSize = entity.size.map(s => s / 2);
    entityBox.min.set(ep.x - halfSize[0], ep.y - halfSize[1], ep.z - halfSize[2]);
    entityBox.max.set(ep.x + halfSize[0], ep.y + halfSize[1], ep.z + halfSize[2]);

    if (!playerBox.intersectsBox(entityBox)) continue;

    if (entity.type === ENTITY_TYPES.COLLECTIBLE) {
      collectItem(entity);
      continue;
    }
    if (entity.type === ENTITY_TYPES.OBSTACLE) {
      if (state.gameState.phase === 'playing' && Date.now() >= death.respawnInvulnUntil) {
        playerDie();
      }
      continue;
    }
    if (entity.type === ENTITY_TYPES.TRIGGER) {
      if (entity.properties?.isBounce) {
        const force = entity.properties.bounceForce || 18;
        playerVelocity.y = force;
        player.isGrounded = false;
        player.isJumping = true;
        spawnParticles(player.mesh.position, '#2ecc71', 15, 4);
        playBounceSound();
        continue;
      }
      if (entity.properties?.isSpeedBoost) {
        const duration = entity.properties.boostDuration || 3000;
        boost.speedBoostUntil = Date.now() + duration;
        spawnParticles(player.mesh.position, '#e67e22', 8, 2);
        continue;
      }
      if (entity.properties?.isWind) {
        const force = entity.properties.windForce || [0, 0, 0];
        const dt = collision.frameDelta;
        playerVelocity.x += force[0] * dt;
        playerVelocity.y += force[1] * dt;
        playerVelocity.z += force[2] * dt;
        continue;
      }
      triggerEvent(entity);
      continue;
    }

    if (entity.type === ENTITY_TYPES.PLATFORM || entity.type === ENTITY_TYPES.RAMP) {
      const overlapX = (0.5 + halfSize[0]) - Math.abs(player.mesh.position.x - ep.x);
      const overlapY = (1 + halfSize[1]) - Math.abs(player.mesh.position.y - ep.y);
      const overlapZ = (0.5 + halfSize[2]) - Math.abs(player.mesh.position.z - ep.z);

      if (overlapX <= 0 || overlapY <= 0 || overlapZ <= 0) continue;

      const playerBottom = player.mesh.position.y - 1;
      const platformTop = ep.y + halfSize[1];

      if (playerBottom >= platformTop - 0.5 && playerVelocity.y <= 0) {
        standingOnPlatform = true;
        platformY = platformTop + 1;
        collision.standingOnEntity = entity;

        if (entity.properties?.breakable && !mesh.userData._breakNotified) {
          mesh.userData._breakNotified = true;
          _sendToServer('platform_step', { entityId: entity.id });
        }

        if (entity.properties?.kinematic) {
          const moveSrc = isGrouped ? mesh.parent : mesh;
          if (moveSrc.userData.lastPosition) {
            _platformVelocity.set(
              moveSrc.position.x - moveSrc.userData.lastPosition.x,
              moveSrc.position.y - moveSrc.userData.lastPosition.y,
              moveSrc.position.z - moveSrc.userData.lastPosition.z
            );
            hasPlatformVelocity = true;
          }
        }
      } else {
        if (overlapX < overlapZ) {
          const pushDir = player.mesh.position.x > ep.x ? 1 : -1;
          player.mesh.position.x += overlapX * pushDir;
          playerVelocity.x = 0;
        } else {
          const pushDir = player.mesh.position.z > ep.z ? 1 : -1;
          player.mesh.position.z += overlapZ * pushDir;
          playerVelocity.z = 0;
        }
      }
    }
  }

  if (standingOnPlatform) {
    player.mesh.position.y = platformY;
    playerVelocity.y = 0;
    player.isGrounded = true;
    player.isJumping = false;

    if (hasPlatformVelocity) {
      player.mesh.position.x += _platformVelocity.x;
      player.mesh.position.z += _platformVelocity.z;
    }
    if (collision.standingOnEntity?.properties?.isConveyor) {
      const dir = collision.standingOnEntity.properties.conveyorDir || [1, 0, 0];
      const speed = collision.standingOnEntity.properties.conveyorSpeed || 6;
      playerVelocity.x += dir[0] * speed * collision.frameDelta;
      playerVelocity.z += dir[2] * speed * collision.frameDelta;
    }
  }
}

export function updatePlayer(delta) {
  if (!player.mesh) return;

  delta = Math.min(delta, 0.05);
  collision.frameDelta = delta;

  let targetSpeed = keys.shift ? PHYSICS.SPRINT_SPEED : PHYSICS.WALK_SPEED;
  let jumpForce = PHYSICS.JUMP_FORCE;
  let spellGravityMult = 1;

  if (hasEffect(SPELL.SPEED_BOOST)) targetSpeed = 30;
  if (hasEffect(SPELL.SLOW_MOTION)) targetSpeed = 10;
  if (Date.now() < boost.speedBoostUntil) targetSpeed *= 2;
  if (hasEffect(SPELL.LOW_GRAVITY)) spellGravityMult = 0.3;
  if (hasEffect(SPELL.HIGH_GRAVITY)) spellGravityMult = 2.5;
  if (hasEffect(SPELL.BOUNCY)) jumpForce *= 1.5;
  if (hasEffect(SPELL.GIANT)) { targetSpeed = 14; jumpForce *= 1.2; }
  if (hasEffect(SPELL.TINY)) { targetSpeed = 25; jumpForce *= 0.6; }

  const { forward, right } = _getCameraDirections();
  _moveDir.set(0, 0, 0);
  const inputSign = hasEffect(SPELL.INVERT_CONTROLS) ? -1 : 1;

  if (isMobile && touchJoystick.active) {
    _moveDir.addScaledVector(forward, -touchJoystick.dy * inputSign);
    _moveDir.addScaledVector(right, touchJoystick.dx * inputSign);
  } else {
    if (keys.w) _moveDir.addScaledVector(forward, inputSign);
    if (keys.s) _moveDir.addScaledVector(forward, -inputSign);
    if (keys.d) _moveDir.addScaledVector(right, inputSign);
    if (keys.a) _moveDir.addScaledVector(right, -inputSign);
  }
  if (_moveDir.length() > 1) _moveDir.normalize();

  const targetVelX = _moveDir.x * targetSpeed;
  const targetVelZ = _moveDir.z * targetSpeed;
  const hasInput = _moveDir.lengthSq() > 0.01;

  const onIce = collision.standingOnEntity?.properties?.isIce;

  let accel;
  if (!player.isGrounded) {
    accel = hasInput ? PHYSICS.AIR_ACCEL : PHYSICS.AIR_DECEL;
  } else if (onIce) {
    accel = hasInput ? PHYSICS.GROUND_ACCEL * 0.15 : PHYSICS.GROUND_DECEL * 0.08;
  } else {
    accel = hasInput ? PHYSICS.GROUND_ACCEL : PHYSICS.GROUND_DECEL;
  }

  playerVelocity.x = moveToward(playerVelocity.x, targetVelX, accel * delta);
  playerVelocity.z = moveToward(playerVelocity.z, targetVelZ, accel * delta);

  const serverGravityScale = state.physics.gravity / DEFAULT_SERVER_PHYSICS.gravity;
  const gravity = PHYSICS.GRAVITY * serverGravityScale * spellGravityMult;

  if (playerVelocity.y < 0) {
    playerVelocity.y += gravity * PHYSICS.FALL_MULTIPLIER * delta;
  } else if (playerVelocity.y > 0 && !keys.space) {
    playerVelocity.y += gravity * PHYSICS.LOW_JUMP_MULTIPLIER * delta;
  } else {
    playerVelocity.y += gravity * delta;
  }
  playerVelocity.y = Math.max(playerVelocity.y, PHYSICS.TERMINAL_VELOCITY);

  if (player.isGrounded) {
    player.coyoteTimer = PHYSICS.COYOTE_TIME;
  } else {
    player.coyoteTimer -= delta;
  }

  if (keys.space && !player.jumpHeld) {
    player.jumpBufferTimer = PHYSICS.JUMP_BUFFER_TIME;
  }
  player.jumpBufferTimer -= delta;
  player.jumpHeld = keys.space;

  const canJump = player.isGrounded || player.coyoteTimer > 0;
  if (canJump && player.jumpBufferTimer > 0 && !player.isJumping) {
    playerVelocity.y = jumpForce;
    player.isJumping = true;
    player.isGrounded = false;
    player.coyoteTimer = 0;
    player.jumpBufferTimer = 0;
    playJumpSound();
  }

  player.mesh.position.x += playerVelocity.x * delta;
  player.mesh.position.y += playerVelocity.y * delta;
  player.mesh.position.z += playerVelocity.z * delta;

  const hSpeed = Math.sqrt(playerVelocity.x ** 2 + playerVelocity.z ** 2);
  if (hSpeed > 0.5) {
    const targetYaw = Math.atan2(playerVelocity.x, playerVelocity.z);
    player.mesh.rotation.y += shortAngleDist(player.mesh.rotation.y, targetYaw) * Math.min(1, 15 * delta);
  }

  player.isGrounded = false;

  const phase = state.gameState.phase;
  const inSafePhase = phase === 'lobby' || phase === 'building' || phase === 'countdown' || phase === 'ended';
  const invulnerable = Date.now() < death.respawnInvulnUntil;
  const hasFloor = floor.currentType === FLOOR_TYPES.SOLID || inSafePhase;

  if (hasFloor) {
    if (player.mesh.position.y < GROUND_Y) {
      player.mesh.position.y = GROUND_Y;
      playerVelocity.y = 0;
      player.isGrounded = true;
      player.isJumping = false;
    }
  } else if (floor.currentType === FLOOR_TYPES.NONE) {
    if (player.mesh.position.y < ABYSS_DEATH_Y && !invulnerable) {
      playerDie();
    }
  } else if (floor.currentType === FLOOR_TYPES.LAVA) {
    if (player.mesh.position.y < LAVA_DEATH_Y && !invulnerable) {
      spawnParticles(player.mesh.position, '#ff4500', 20, 6);
      spawnParticles(player.mesh.position, '#ffaa00', 10, 4);
      playerDie();
    }
  }
  if (hazardPlaneState.active && phase === 'playing' && player.mesh.position.y < hazardPlaneState.height && !invulnerable) {
    spawnParticles(player.mesh.position, hazardPlaneState.type === 'lava' ? '#ff4500' : '#3498db', 20, 6);
    playerDie();
  }
  if (player.mesh.position.y < VOID_DEATH_Y && !invulnerable) {
    playerDie();
  }

  _updateCamera();

  const now = performance.now();
  if (now - network.lastMoveTime >= MOVE_INTERVAL) {
    network.lastMoveTime = now;
    _sendToServer('move', {
      position: player.mesh.position.toArray(),
      velocity: playerVelocity.toArray()
    });
  }
}
