/**
 * Self-Building Game - Browser Client
 * Three.js + Colyseus for real-time multiplayer
 */

import './styles/game.css';
import './styles/mobile.css';
import * as THREE from 'three';
import { GEOMETRY_TEMPLATES } from './GeometryTemplates.js';
import { createEntityToonMaterial, createGroundToonMaterial, getEntityColor, setMaterialTheme } from './ToonMaterials.js';
import { initPostProcessing, renderFrame, resizePostProcessing, updateOutlineObjects } from './PostProcessing.js';
import { createLavaShaderMaterial, createWaterShaderMaterial, createWindShaderMaterial, registerShaderMaterial, updateShaderTime, registerConveyorMaterial, updateConveyorScrolls } from './SurfaceShaders.js';
import { createPlayerCharacter, createRemotePlayerCharacter, updateSquashStretch } from './PlayerVisuals.js';
import { createSkyDome, updateSkyColors, initParticles, updateEnvironmentEffects, selectParticleType } from './EnvironmentEffects.js';
import { Client } from 'colyseus.js';
import {
  initPrivy, handleOAuthCallback, exchangeForBackendToken, ensureEmbeddedWallet,
  loginAsGuest, loginWithTwitter, getPrivyUser, getToken, debugAuth, logout,
  getEmbeddedWalletProvider, getEmbeddedWalletAddress, exportWallet
} from './auth.js';
import {
  TREASURY_ADDRESS, isLocalhost, SERVER_URL, API_URL, urlParams, isSpectator, isDebug,
  selectedArenaId, setSelectedArenaId, getApiBase, isMobile, PHYSICS,
  MIN_PITCH, MAX_PITCH, MIN_DISTANCE, MAX_DISTANCE, SPEC_FLY_SPEED, SPEC_FAST_SPEED,
  MOVE_INTERVAL, MAX_RECONNECT_ATTEMPTS, JOYSTICK_RADIUS,
  GROUND_Y, ABYSS_DEATH_Y, LAVA_DEATH_Y, VOID_DEATH_Y, DEATH_COOLDOWN,
  MAX_VISIBLE_ANNOUNCEMENTS
} from './config.js';
import {
  state, auth, remotePlayers, network, floor, hazardPlaneState,
  entityMeshes, groupParents, pendingGroups, entityToGroup, particles,
  boost, collision, death, activatedTriggers, player, playerVelocity,
  camera as cameraState,
  afk, countdown
} from './state.js';
import {
  playJumpSound, playDeathSound, playCollectSound, playCountdownBeep,
  playWinFanfare, playSpellSound, playCrackSound, playBreakSound, playBounceSound
} from './audio/SoundManager.js';
import {
  triggerCameraShake, screenFlash, showVignette,
  spawnParticles, updateParticles, initScreenEffects
} from './vfx/ScreenEffects.js';
import { CameraController } from './CameraController.js';
import { keys, setupKeyboardInput, toggleHelpOverlay } from './input/InputManager.js';
import { setupMobileControls, touchJoystick } from './input/MobileControls.js';

// Expose state for debugging
window.__gameState = state;
window.debugAuth = debugAuth;

// Helper to safely send messages
function sendToServer(type, data) {
  if (!state.room) return false;

  try {
    state.room.send(type, data);
    return true;
  } catch (e) {
    console.warn('[Network] Send failed:', e.message);
    state.connected = false;
    attemptReconnect();
    return false;
  }
}

function moveToward(current, target, maxDelta) {
  if (Math.abs(target - current) <= maxDelta) return target;
  return current + Math.sign(target - current) * maxDelta;
}

function shortAngleDist(from, to) {
  let diff = to - from;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return diff;
}

// Reconnection logic
async function attemptReconnect() {
  if (network.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    console.error('[Network] Max reconnect attempts reached');
    return;
  }

  network.reconnectAttempts++;
  console.log(`[Network] Reconnecting... (attempt ${network.reconnectAttempts})`);

  try {
    await connectToServer();
    network.reconnectAttempts = 0;
    console.log('[Network] Reconnected successfully');
  } catch (e) {
    console.warn('[Network] Reconnect failed, retrying in 2s...');
    setTimeout(attemptReconnect, 2000);
  }
}

// ============================================
// Three.js Setup
// ============================================
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x2a2a4e);
scene.fog = new THREE.FogExp2(0x2a2a4e, 0.012);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 10, 30);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.3;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.getElementById('game').appendChild(renderer.domElement);

// Lighting
const ambientLight = new THREE.AmbientLight(0x8090a0, 0.8);
scene.add(ambientLight);

const hemiLight = new THREE.HemisphereLight(0xb0d0ff, 0x404030, 0.6);
scene.add(hemiLight);

const directionalLight = new THREE.DirectionalLight(0xffffff, 1.2);
directionalLight.position.set(50, 100, 50);
directionalLight.castShadow = true;
directionalLight.shadow.mapSize.width = 2048;
directionalLight.shadow.mapSize.height = 2048;
scene.add(directionalLight);

// Ground plane
const groundGeometry = new THREE.PlaneGeometry(200, 200, 50, 50);
const groundMaterial = createGroundToonMaterial();
const ground = new THREE.Mesh(groundGeometry, groundMaterial);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// Grid helper
const gridHelper = new THREE.GridHelper(200, 50, 0x555555, 0x444444);
scene.add(gridHelper);

// Sky gradient dome
createSkyDome(scene);

// Post-processing pipeline (outlines, bloom, FXAA)
initPostProcessing(renderer, scene, camera);

// Screen effects (particles, flash, vignette) need scene reference
initScreenEffects(scene);

// Camera controller — handles player follow, spectator, and desktop mouse events
const cameraController = new CameraController(camera, renderer);
cameraController.initDesktopEvents();

// Lava floor plane (hidden by default) — uses animated shader
const lavaGeometry = new THREE.PlaneGeometry(200, 200, 40, 40);
const lavaMaterial = createLavaShaderMaterial();
registerShaderMaterial(lavaMaterial);
const lavaFloor = new THREE.Mesh(lavaGeometry, lavaMaterial);
lavaFloor.rotation.x = -Math.PI / 2;
lavaFloor.position.y = -0.5;
lavaFloor.visible = false;
scene.add(lavaFloor);

// Rising hazard plane (lava/water that rises during gameplay) — animated shaders
const hazardPlaneGeom = new THREE.PlaneGeometry(400, 400, 40, 40);
let hazardPlaneMat = createLavaShaderMaterial();
registerShaderMaterial(hazardPlaneMat);
const hazardPlaneMesh = new THREE.Mesh(hazardPlaneGeom, hazardPlaneMat);
hazardPlaneMesh.rotation.x = -Math.PI / 2;
hazardPlaneMesh.visible = false;
scene.add(hazardPlaneMesh);
function updateHazardPlaneMaterial(type) {
  const newMat = type === 'water' ? createWaterShaderMaterial() : createLavaShaderMaterial();
  registerShaderMaterial(newMat);
  hazardPlaneMesh.material = newMat;
  hazardPlaneMat = newMat;
}

function setFloorType(type) {
  floor.currentType = type;
  ground.visible = type === 'solid';
  gridHelper.visible = type === 'solid';
  lavaFloor.visible = type === 'lava';

  // Update ambient particles based on floor type
  const pType = selectParticleType(type, null);
  initParticles(scene, pType);

  console.log(`[Floor] Type changed to: ${type}`);
}

function applyEnvironment(env) {
  if (env.skyColor) {
    scene.background = new THREE.Color(env.skyColor);
    updateSkyColors(env.skyColor, env.fogColor || env.skyColor, env.skyPreset);
  }
  if (env.fogColor || env.fogDensity != null) {
    scene.fog = new THREE.FogExp2(
      env.fogColor ? new THREE.Color(env.fogColor) : scene.fog.color,
      env.fogDensity ?? 0.012
    );
  }
  if (env.ambientColor) ambientLight.color.set(env.ambientColor);
  if (env.ambientIntensity != null) ambientLight.intensity = env.ambientIntensity;
  if (env.sunColor) directionalLight.color.set(env.sunColor);
  if (env.sunIntensity != null) directionalLight.intensity = env.sunIntensity;
  if (env.sunPosition) directionalLight.position.set(...env.sunPosition);

  // Apply material theme for this arena
  if (env.materialTheme !== undefined) setMaterialTheme(env.materialTheme);

  // Update ambient particles based on environment
  const pType = selectParticleType(floor.currentType, env);
  initParticles(scene, pType);

  console.log('[Environment] Updated');
}

// Convenience wrappers that delegate to cameraController
function isInSpectatorMode() { return cameraController.isInSpectatorMode(); }
function clearSpectating() { cameraController.clearSpectating(); }
function getCameraDirections() { return cameraController.getCameraDirections(); }

// ============================================
// Entity Rendering
// ============================================

function assembleGroup(groupId) {
  if (groupParents.has(groupId)) return;

  const childMeshes = [];
  for (const [eid, gid] of entityToGroup) {
    if (gid === groupId && entityMeshes.has(eid)) {
      childMeshes.push(entityMeshes.get(eid));
    }
  }
  if (childMeshes.length < 2) return;

  const group = new THREE.Group();
  const firstMesh = childMeshes[0];
  group.position.copy(firstMesh.position);

  for (const mesh of childMeshes) {
    scene.remove(mesh);
    mesh.position.sub(group.position);
    group.add(mesh);
  }

  scene.add(group);
  groupParents.set(groupId, group);

  const firstEntity = firstMesh.userData.entity;
  const props = firstEntity?.properties;
  group.userData = { isGroupParent: true, entity: firstEntity };

  if (props?.kinematic || props?.chase) {
    group.userData.targetPosition = firstMesh.userData.targetPosition
      ? firstMesh.userData.targetPosition.clone()
      : null;
  }
  if (props?.rotating) {
    group.userData.rotating = true;
    group.userData.speed = props.speed || 1;
    for (const mesh of childMeshes) {
      mesh.userData.rotating = false;
    }
  }
}

function scheduleGroupAssembly(groupId) {
  if (groupParents.has(groupId)) return;
  if (pendingGroups.has(groupId)) clearTimeout(pendingGroups.get(groupId));
  const DEBOUNCE_MS = 150;
  pendingGroups.set(groupId, setTimeout(() => {
    pendingGroups.delete(groupId);
    assembleGroup(groupId);
  }, DEBOUNCE_MS));
}

function createBeveledBox(sx, sy, sz) {
  const bevel = Math.max(0.12, Math.min((sx + sz) / 2 * 0.06, sy * 0.4));
  const hx = sx / 2 - bevel;
  const hz = sz / 2 - bevel;

  // Rounded-rectangle cross-section (XZ plane)
  const profile = new THREE.Shape();
  profile.moveTo(-hx, -hz);
  profile.lineTo(hx, -hz);
  profile.quadraticCurveTo(hx + bevel, -hz, hx + bevel, -hz + bevel);
  profile.lineTo(hx + bevel, hz);
  profile.quadraticCurveTo(hx + bevel, hz + bevel, hx, hz + bevel);
  profile.lineTo(-hx, hz + bevel);
  profile.quadraticCurveTo(-hx - bevel, hz + bevel, -hx - bevel, hz);
  profile.lineTo(-hx - bevel, -hz + bevel);
  profile.quadraticCurveTo(-hx - bevel, -hz, -hx, -hz);

  const geo = new THREE.ExtrudeGeometry(profile, {
    depth: sy,
    bevelEnabled: true,
    bevelSize: bevel,
    bevelThickness: bevel,
    bevelSegments: 2,
  });

  // Extrude goes along Z; rotate so height is along Y and center vertically
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, -sy / 2, 0);
  return geo;
}

function getGeometry(entity) {
  const shape = entity.properties?.shape;
  const [sx, sy, sz] = entity.size || [1, 1, 1];

  // Type-based defaults when no explicit shape is set
  if (!shape) {
    if (entity.type === 'collectible') {
      return new THREE.IcosahedronGeometry(0.5, 0);
    }
    if (entity.type === 'trigger' && entity.properties?.isGoal) {
      return new THREE.TorusGeometry(Math.max(sx, sz) / 2, Math.min(sx, sz) / 6, 12, 32);
    }
    if (entity.type === 'platform' || entity.type === 'ramp') {
      return createBeveledBox(sx, sy, sz);
    }
    return new THREE.BoxGeometry(sx, sy, sz);
  }

  // Named templates (lathe, extrude, tube shapes defined in GeometryTemplates)
  if (GEOMETRY_TEMPLATES[shape]) {
    return GEOMETRY_TEMPLATES[shape](sx, sy, sz);
  }

  // Primitive shapes
  const maxDim = Math.max(sx, sy, sz) / 2;
  switch (shape) {
    case 'sphere':       return new THREE.SphereGeometry(maxDim, 16, 16);
    case 'cylinder':     return new THREE.CylinderGeometry(sx / 2, sx / 2, sy, 16);
    case 'cone':         return new THREE.ConeGeometry(sx / 2, sy, 16);
    case 'pyramid':      return new THREE.ConeGeometry(sx / 2, sy, 4);
    case 'torus':        return new THREE.TorusGeometry(sx / 2, Math.min(sx, sz) / 6, 8, 24);
    case 'dodecahedron': return new THREE.DodecahedronGeometry(maxDim);
    case 'icosahedron':  return new THREE.IcosahedronGeometry(maxDim, 0);
    case 'octahedron':   return new THREE.OctahedronGeometry(maxDim);
    case 'ring':         return new THREE.TorusGeometry(sx / 2, Math.max(0.2, sx / 8), 8, 32);
    default:             return new THREE.BoxGeometry(sx, sy, sz);
  }
}

function createEntityMesh(entity) {
  const geometry = getGeometry(entity);
  const props = entity.properties || {};
  const color = getEntityColor(entity.type, props.color);

  // Wind zones use a special shader material
  let material;
  if (props.isWind) {
    material = createWindShaderMaterial(props.windForce || [1, 0, 0]);
    registerShaderMaterial(material);
  } else {
    material = createEntityToonMaterial(entity);
  }

  // Register conveyor materials for UV scroll animation
  if (props.isConveyor && material.map) {
    registerConveyorMaterial(material, props.conveyorSpeed || 6, props.conveyorDir || [1, 0, 0]);
  }

  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(...entity.position);
  if (props.rotation) {
    mesh.rotation.set(props.rotation[0] || 0, props.rotation[1] || 0, props.rotation[2] || 0);
  }
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData = { entity, rotating: props.rotating, speed: props.speed || 1 };

  if (entity.type === 'collectible') {
    // Larger pulsing glow sphere
    const glowGeometry = new THREE.SphereGeometry(1.0, 16, 16);
    const glowMaterial = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.2,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const glow = new THREE.Mesh(glowGeometry, glowMaterial);
    mesh.add(glow);
  }

  // Goal triggers get a glow too
  if (entity.type === 'trigger' && props.isGoal) {
    const [sx, sy, sz] = entity.size || [3, 3, 3];
    const goalGlow = new THREE.Mesh(
      new THREE.SphereGeometry(Math.max(sx, sy, sz) * 0.6, 16, 16),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.15,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    mesh.add(goalGlow);
  }

  return mesh;
}

function addEntity(entity) {
  if (entityMeshes.has(entity.id)) return;

  const mesh = createEntityMesh(entity);
  scene.add(mesh);
  entityMeshes.set(entity.id, mesh);
  state.entities.set(entity.id, entity);

  const groupId = entity.properties?.groupId;
  if (groupId) {
    entityToGroup.set(entity.id, groupId);
    scheduleGroupAssembly(groupId);
  }

  updateUI();
}

function setTargetPosition(obj, position) {
  if (!obj.userData.targetPosition) {
    obj.userData.targetPosition = new THREE.Vector3(...position);
  } else {
    obj.userData.targetPosition.set(...position);
  }
}

function trackLastPosition(obj) {
  if (!obj.userData.lastPosition) {
    obj.userData.lastPosition = obj.position.clone();
  } else {
    obj.userData.lastPosition.copy(obj.position);
  }
}

function updateEntity(entity) {
  const mesh = entityMeshes.get(entity.id);
  if (!mesh) return addEntity(entity);

  const groupId = entityToGroup.get(entity.id);
  const group = groupId ? groupParents.get(groupId) : null;

  setTargetPosition(mesh, entity.position);

  const eProps = entity.properties;
  if (group && (eProps?.kinematic || eProps?.chase)) {
    setTargetPosition(group, entity.position);
    group.userData.entity = entity;
  } else if (!eProps?.kinematic && !group) {
    mesh.position.set(...entity.position);
  }

  if (entity.size) {
    mesh.geometry.dispose();
    mesh.geometry = getGeometry(entity);
  }
  if (entity.properties?.color) {
    mesh.material.color.set(entity.properties.color);
    mesh.material.emissive.set(entity.properties.color);
  }
  if (entity.properties?.rotation && !entity.properties?.rotating) {
    mesh.rotation.set(
      entity.properties.rotation[0] || 0,
      entity.properties.rotation[1] || 0,
      entity.properties.rotation[2] || 0
    );
  }
  mesh.userData.entity = entity;
  mesh.userData.rotating = entity.properties?.rotating;
  mesh.userData.speed = entity.properties?.speed || 1;

  state.entities.set(entity.id, entity);
  updateUI();
}

function removeEntity(id) {
  const mesh = entityMeshes.get(id);
  if (mesh) {
    const groupId = entityToGroup.get(id);
    if (groupId && groupParents.has(groupId)) {
      const group = groupParents.get(groupId);
      group.remove(mesh);
      if (group.children.length === 0) {
        scene.remove(group);
        groupParents.delete(groupId);
      }
    } else {
      scene.remove(mesh);
    }
    mesh.traverse((child) => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    });
    entityMeshes.delete(id);
  }
  entityToGroup.delete(id);
  state.entities.delete(id);
  updateUI();
}

// ============================================
// Collision Detection (Wall-Slide)
// ============================================

const playerBox = new THREE.Box3();
const entityBox = new THREE.Box3();

function checkCollisions() {
  if (!player.mesh) return;

  // Manual AABB — ignores decoration children (eyes, glow ring)
  const pp = player.mesh.position;
  playerBox.min.set(pp.x - 0.5, pp.y - 1.0, pp.z - 0.5);
  playerBox.max.set(pp.x + 0.5, pp.y + 1.0, pp.z + 0.5);

  let standingOnPlatform = false;
  let platformY = 0;
  let platformVelocity = null;
  collision.standingOnEntity = null;

  for (const [, mesh] of entityMeshes) {
    const entity = mesh.userData.entity;
    if (!entity) continue;

    const isGrouped = mesh.parent && mesh.parent !== scene;
    const ep = isGrouped
      ? { x: mesh.parent.position.x + mesh.position.x,
          y: mesh.parent.position.y + mesh.position.y,
          z: mesh.parent.position.z + mesh.position.z }
      : mesh.position;
    const halfSize = entity.size.map(s => s / 2);
    entityBox.min.set(ep.x - halfSize[0], ep.y - halfSize[1], ep.z - halfSize[2]);
    entityBox.max.set(ep.x + halfSize[0], ep.y + halfSize[1], ep.z + halfSize[2]);

    if (!playerBox.intersectsBox(entityBox)) continue;

    if (entity.type === 'collectible') {
      collectItem(entity);
      continue;
    }
    if (entity.type === 'obstacle') {
      if (state.gameState.phase === 'playing' && Date.now() >= death.respawnInvulnUntil) {
        playerDie();
      }
      continue;
    }
    if (entity.type === 'trigger') {
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

    if (entity.type === 'platform' || entity.type === 'ramp') {
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
          sendToServer('platform_step', { entityId: entity.id });
        }

        if (entity.properties?.kinematic) {
          const moveSrc = isGrouped ? mesh.parent : mesh;
          if (moveSrc.userData.lastPosition) {
            platformVelocity = new THREE.Vector3(
              moveSrc.position.x - moveSrc.userData.lastPosition.x,
              moveSrc.position.y - moveSrc.userData.lastPosition.y,
              moveSrc.position.z - moveSrc.userData.lastPosition.z
            );
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

    if (platformVelocity) {
      player.mesh.position.x += platformVelocity.x;
      player.mesh.position.z += platformVelocity.z;
    }
    // Conveyor belt push
    if (collision.standingOnEntity?.properties?.isConveyor) {
      const dir = collision.standingOnEntity.properties.conveyorDir || [1, 0, 0];
      const speed = collision.standingOnEntity.properties.conveyorSpeed || 6;
      playerVelocity.x += dir[0] * speed * collision.frameDelta;
      playerVelocity.z += dir[2] * speed * collision.frameDelta;
    }
  }
}

function collectItem(entity) {
  sendToServer('collect', { entityId: entity.id });
  spawnParticles(entity.position, '#f1c40f', 20, 4);
  spawnParticles(entity.position, '#ffffff', 8, 2); // golden sparkle trail
  playCollectSound();
  removeEntity(entity.id);
  console.log(`[Collect] Picked up ${entity.id}`);
}

function playerDie() {
  if (!player.mesh || state.localPlayer?.state === 'dead') return;

  // Prevent rapid death loops
  const now = Date.now();
  if (now - death.lastDeathTime < DEATH_COOLDOWN) return;
  death.lastDeathTime = now;

  console.log('[Player] Died!');

  if (state.localPlayer) {
    state.localPlayer.state = 'dead';
  }

  sendToServer('died', { position: player.mesh.position.toArray() });

  // Enhanced death VFX
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

  // Brief invulnerability after respawn (prevents fall-death loops)
  death.respawnInvulnUntil = Date.now() + 2000;

  if (state.localPlayer) {
    state.localPlayer.state = 'alive';
  }

  sendToServer('respawn', {});
  console.log('[Player] Respawned');
}

function triggerEvent(entity) {
  const now = Date.now();
  const lastActivation = activatedTriggers.get(entity.id) || 0;
  if (now - lastActivation < 2000) return; // 2s debounce

  activatedTriggers.set(entity.id, now);
  console.log(`[Trigger] Activated: ${entity.id}`);
  sendToServer('trigger_activated', { entityId: entity.id });
}

// ============================================
// Player
// ============================================

function createPlayer() {
  player.mesh = createPlayerCharacter();
  scene.add(player.mesh);
}

// Check if a spell effect is currently active
function hasEffect(effectType) {
  if (!state.activeEffects) return false;
  const now = Date.now();
  return state.activeEffects.some(e => e.type === effectType && now - e.startTime < e.duration);
}

function updatePlayer(delta) {
  if (!player.mesh) return;

  // Clamp delta to prevent physics explosions on tab-switch
  delta = Math.min(delta, 0.05);
  collision.frameDelta = delta; // expose for conveyor/wind in checkCollisions

  // --- Spell modifiers ---
  let targetSpeed = keys.shift ? PHYSICS.SPRINT_SPEED : PHYSICS.WALK_SPEED;
  let jumpForce = PHYSICS.JUMP_FORCE;
  let spellGravityMult = 1;

  if (hasEffect('speed_boost')) targetSpeed = 30;
  if (hasEffect('slow_motion')) targetSpeed = 10;
  if (Date.now() < boost.speedBoostUntil) targetSpeed *= 2;
  if (hasEffect('low_gravity')) spellGravityMult = 0.3;
  if (hasEffect('high_gravity')) spellGravityMult = 2.5;
  if (hasEffect('bouncy')) jumpForce *= 1.5;
  if (hasEffect('giant')) { targetSpeed = 14; jumpForce *= 1.2; }
  if (hasEffect('tiny')) { targetSpeed = 25; jumpForce *= 0.6; }

  // --- Camera-relative input direction ---
  const { forward, right } = getCameraDirections();
  const moveDir = new THREE.Vector3();
  const inputSign = hasEffect('invert_controls') ? -1 : 1;

  if (isMobile && touchJoystick.active) {
    moveDir.addScaledVector(forward, -touchJoystick.dy * inputSign);
    moveDir.addScaledVector(right, touchJoystick.dx * inputSign);
  } else {
    if (keys.w) moveDir.addScaledVector(forward, inputSign);
    if (keys.s) moveDir.addScaledVector(forward, -inputSign);
    if (keys.d) moveDir.addScaledVector(right, inputSign);
    if (keys.a) moveDir.addScaledVector(right, -inputSign);
  }
  // Clamp to unit length but allow analog (mobile joystick) sub-unit values
  if (moveDir.length() > 1) moveDir.normalize();

  // --- Horizontal movement with acceleration ---
  const targetVelX = moveDir.x * targetSpeed;
  const targetVelZ = moveDir.z * targetSpeed;
  const hasInput = moveDir.lengthSq() > 0.01;

  const onIce = collision.standingOnEntity?.properties?.isIce;

  let accel;
  if (!player.isGrounded) {
    accel = hasInput ? PHYSICS.AIR_ACCEL : PHYSICS.AIR_DECEL;
  } else if (onIce) {
    // Ice reduces acceleration to 15% and deceleration to 8% for a sliding feel
    accel = hasInput ? PHYSICS.GROUND_ACCEL * 0.15 : PHYSICS.GROUND_DECEL * 0.08;
  } else {
    accel = hasInput ? PHYSICS.GROUND_ACCEL : PHYSICS.GROUND_DECEL;
  }

  playerVelocity.x = moveToward(playerVelocity.x, targetVelX, accel * delta);
  playerVelocity.z = moveToward(playerVelocity.z, targetVelZ, accel * delta);

  // --- Gravity (asymmetric for game feel) ---
  const serverGravityScale = state.physics.gravity / -9.8;
  const gravity = PHYSICS.GRAVITY * serverGravityScale * spellGravityMult;

  if (playerVelocity.y < 0) {
    playerVelocity.y += gravity * PHYSICS.FALL_MULTIPLIER * delta;
  } else if (playerVelocity.y > 0 && !keys.space) {
    playerVelocity.y += gravity * PHYSICS.LOW_JUMP_MULTIPLIER * delta;
  } else {
    playerVelocity.y += gravity * delta;
  }
  playerVelocity.y = Math.max(playerVelocity.y, PHYSICS.TERMINAL_VELOCITY);

  // --- Coyote time & jump buffer ---
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

  // --- Execute jump ---
  const canJump = player.isGrounded || player.coyoteTimer > 0;
  if (canJump && player.jumpBufferTimer > 0 && !player.isJumping) {
    playerVelocity.y = jumpForce;
    player.isJumping = true;
    player.isGrounded = false;
    player.coyoteTimer = 0;
    player.jumpBufferTimer = 0;
    playJumpSound();
  }

  // --- Apply velocity ---
  player.mesh.position.x += playerVelocity.x * delta;
  player.mesh.position.y += playerVelocity.y * delta;
  player.mesh.position.z += playerVelocity.z * delta;

  // --- Face movement direction ---
  const hSpeed = Math.sqrt(playerVelocity.x ** 2 + playerVelocity.z ** 2);
  if (hSpeed > 0.5) {
    const targetYaw = Math.atan2(playerVelocity.x, playerVelocity.z);
    player.mesh.rotation.y += shortAngleDist(player.mesh.rotation.y, targetYaw) * Math.min(1, 15 * delta);
  }

  // Reset before this frame's collision detection
  player.isGrounded = false;

  // --- Ground collision ---
  const phase = state.gameState.phase;
  const inSafePhase = phase === 'lobby' || phase === 'building' || phase === 'countdown' || phase === 'ended';
  const invulnerable = Date.now() < death.respawnInvulnUntil;
  // All floors act solid during safe phases so players don't fall through
  const hasFloor = floor.currentType === 'solid' || inSafePhase;

  if (hasFloor) {
    if (player.mesh.position.y < GROUND_Y) {
      player.mesh.position.y = GROUND_Y;
      playerVelocity.y = 0;
      player.isGrounded = true;
      player.isJumping = false;
    }
  } else if (floor.currentType === 'none') {
    if (player.mesh.position.y < ABYSS_DEATH_Y && !invulnerable) {
      playerDie();
    }
  } else if (floor.currentType === 'lava') {
    if (player.mesh.position.y < LAVA_DEATH_Y && !invulnerable) {
      spawnParticles(player.mesh.position, '#ff4500', 20, 6);
      spawnParticles(player.mesh.position, '#ffaa00', 10, 4);
      playerDie();
    }
  }
  // Hazard plane death (rising lava/water)
  if (hazardPlaneState.active && phase === 'playing' && player.mesh.position.y < hazardPlaneState.height && !invulnerable) {
    spawnParticles(player.mesh.position, hazardPlaneState.type === 'lava' ? '#ff4500' : '#3498db', 20, 6);
    playerDie();
  }
  // Void death (Y < -50) stays always active as ultimate safety net
  if (player.mesh.position.y < VOID_DEATH_Y && !invulnerable) {
    playerDie();
  }

  cameraController.updateCamera();

  // Send position to server (throttled)
  const now = performance.now();
  if (now - network.lastMoveTime >= MOVE_INTERVAL) {
    network.lastMoveTime = now;
    sendToServer('move', {
      position: player.mesh.position.toArray(),
      velocity: playerVelocity.toArray()
    });
  }
}

// ============================================
// Input
// ============================================

// ============================================
// Chat System
// ============================================
function setupChat() {
  const chatInput = document.getElementById('chat-input');
  if (!chatInput) return;

  chatInput.addEventListener('focus', () => {
    state.chatFocused = true;
    // Clear all held keys
    for (const k in keys) keys[k] = false;
  });

  chatInput.addEventListener('blur', () => {
    state.chatFocused = false;
  });

  chatInput.addEventListener('keydown', (e) => {
    e.stopPropagation(); // Prevent game input handling

    if (e.key === 'Enter') {
      const text = chatInput.value.trim();
      if (text.length > 0) {
        sendChatMessage(text);
        chatInput.value = '';
      }
      chatInput.blur();
      state.chatFocused = false;
    }

    if (e.key === 'Escape') {
      chatInput.blur();
      state.chatFocused = false;
    }
  });
}

function sendChatMessage(text) {
  if (!state.connected || !state.room) {
    showToast('Message not sent — disconnected', 'error');
    return;
  }
  if (!sendToServer('chat', { text })) {
    showToast('Message not sent — connection error', 'error');
  }
}

let agentThinkingEl = null;
let agentThinkingTimeout = null;

function showAgentThinking() {
  removeAgentThinking();
  const container = document.getElementById('chat-messages');
  if (!container) return;
  agentThinkingEl = document.createElement('div');
  agentThinkingEl.className = 'chat-msg system agent-thinking';
  agentThinkingEl.innerHTML = '<span class="text" style="opacity:0.6;font-style:italic">Magician is thinking...</span>';
  container.appendChild(agentThinkingEl);
  container.scrollTop = container.scrollHeight;
  // Auto-remove after 30s if agent doesn't respond
  agentThinkingTimeout = setTimeout(removeAgentThinking, 30000);
}

function removeAgentThinking() {
  if (agentThinkingTimeout) {
    clearTimeout(agentThinkingTimeout);
    agentThinkingTimeout = null;
  }
  if (agentThinkingEl) {
    agentThinkingEl.remove();
    agentThinkingEl = null;
  }
}

function displayChatMessage(msg) {
  const container = document.getElementById('chat-messages');
  if (!container) return;

  // Remove "thinking" indicator when agent replies
  if (msg.senderType === 'agent') removeAgentThinking();

  const div = document.createElement('div');
  div.className = `chat-msg ${msg.senderType}`;

  const sender = document.createElement('span');
  sender.className = 'sender';
  sender.textContent = `${msg.sender}:`;

  const textSpan = document.createElement('span');
  textSpan.className = 'text';

  // Escape HTML to prevent XSS, then highlight @agent mentions
  const escaped = msg.text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const highlighted = escaped.replace(/@agent/gi, (match) => {
    return `<span class="at-agent">${match}</span>`;
  });
  textSpan.innerHTML = highlighted;

  div.appendChild(sender);
  div.appendChild(textSpan);
  container.appendChild(div);

  // Show thinking indicator AFTER the player's @agent message is displayed
  if (msg.senderType === 'player' && /@agent/i.test(msg.text)) {
    showAgentThinking();
  }

  // 3D chat bubble above player head (only for in-game players)
  if (msg.senderType === 'player' && msg.senderId) {
    showChatBubble(msg.senderId, msg.text);
  }

  // Auto-scroll
  container.scrollTop = container.scrollHeight;
}

// ============================================
// Leaderboard
// ============================================

async function fetchLeaderboard() {
  try {
    const response = await fetch(`${getApiBase()}/leaderboard`);
    const data = await response.json();
    updateLeaderboardUI(data.leaderboard);
  } catch (e) {
    // Silent fail
  }
}

function updateLeaderboardUI(leaderboard) {
  const entries = document.getElementById('leaderboard-entries');
  if (!entries) return;

  // Just update content — TAB key controls visibility
  entries.innerHTML = '';
  if (!leaderboard || leaderboard.length === 0) {
    entries.innerHTML = '<div style="text-align:center;color:#888;padding:12px;">No games played yet</div>';
    return;
  }

  for (let i = 0; i < leaderboard.length; i++) {
    const entry = leaderboard[i];
    const row = document.createElement('div');
    row.className = 'lb-entry';

    const rank = document.createElement('span');
    rank.className = 'lb-rank';
    rank.textContent = `${i + 1}.`;

    const name = document.createElement('span');
    name.className = 'lb-name';
    name.textContent = entry.name;

    const wins = document.createElement('span');
    wins.className = 'lb-wins';
    wins.textContent = `${entry.wins}W`;

    const games = document.createElement('span');
    games.className = 'lb-games';
    games.textContent = `${entry.gamesPlayed || 0}G`;

    row.append(rank, name, wins, games);
    entries.appendChild(row);
  }
}

// ============================================
// Remote Player Rendering (with interpolation)
// ============================================

function createRemotePlayerMesh(player) {
  const hue = Math.random();
  const color = new THREE.Color().setHSL(hue, 0.7, 0.5);
  const mesh = createRemotePlayerCharacter(color);

  // Add name label
  mesh.add(createNameSprite(player.name));

  mesh.userData.playerName = player.name || 'Player';

  // Initialize interpolation target
  mesh.userData.targetPosition = new THREE.Vector3();
  if (player.position) {
    mesh.userData.targetPosition.set(...player.position);
    mesh.position.set(...player.position);
  }

  return mesh;
}

function createNameSprite(name) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(0, 0, 256, 64);
  ctx.fillStyle = 'white';
  ctx.font = 'bold 24px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(name || 'Player', 128, 40);
  const texture = new THREE.CanvasTexture(canvas);
  const spriteMaterial = new THREE.SpriteMaterial({ map: texture });
  const sprite = new THREE.Sprite(spriteMaterial);
  sprite.scale.set(3, 0.75, 1);
  sprite.position.y = 2;
  sprite.userData.isNameSprite = true;
  return sprite;
}

function rebuildNameSprite(mesh, name) {
  // Remove old name sprite
  const old = mesh.children.find(c => c.userData.isNameSprite);
  if (old) {
    if (old.material?.map) old.material.map.dispose();
    if (old.material) old.material.dispose();
    mesh.remove(old);
  }
  mesh.add(createNameSprite(name));
  mesh.userData.playerName = name;
}

function disposeBubbleSprite(mesh, sprite) {
  if (sprite.material?.map) sprite.material.map.dispose();
  if (sprite.material) sprite.material.dispose();
  mesh.remove(sprite);
}

function createChatBubbleSprite(text) {
  const MAX_CHARS = 60;
  const FONT_SIZE = 26;
  const FONT_FAMILY = '"Segoe UI", Arial, sans-serif';
  const PADDING_X = 28;
  const PADDING_Y = 12;
  const POINTER_HEIGHT = 10;
  const CHAT_DURATION = 5000;
  const SPRITE_SCALE = 4;
  const SPRITE_HEIGHT = 2.8;
  const RENDER_ORDER = 999;

  const display = text.length > MAX_CHARS ? text.slice(0, MAX_CHARS - 1) + '\u2026' : text;

  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');

  const fontStr = `bold ${FONT_SIZE}px ${FONT_FAMILY}`;
  ctx.font = fontStr;
  const textWidth = ctx.measureText(display).width;

  const bubbleW = Math.min(canvas.width - 4, textWidth + PADDING_X * 2);
  const bubbleH = FONT_SIZE + PADDING_Y * 2;
  const borderRadius = bubbleH / 2;
  const left = (canvas.width - bubbleW) / 2;
  const top = (canvas.height - POINTER_HEIGHT - bubbleH) / 2;
  const centerX = canvas.width / 2;

  ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
  ctx.beginPath();
  ctx.moveTo(left + borderRadius, top);
  ctx.lineTo(left + bubbleW - borderRadius, top);
  ctx.arcTo(left + bubbleW, top, left + bubbleW, top + borderRadius, borderRadius);
  ctx.lineTo(left + bubbleW, top + bubbleH - borderRadius);
  ctx.arcTo(left + bubbleW, top + bubbleH, left + bubbleW - borderRadius, top + bubbleH, borderRadius);
  ctx.lineTo(centerX + 8, top + bubbleH);
  ctx.lineTo(centerX, top + bubbleH + POINTER_HEIGHT);
  ctx.lineTo(centerX - 8, top + bubbleH);
  ctx.lineTo(left + borderRadius, top + bubbleH);
  ctx.arcTo(left, top + bubbleH, left, top + bubbleH - borderRadius, borderRadius);
  ctx.lineTo(left, top + borderRadius);
  ctx.arcTo(left, top, left + borderRadius, top, borderRadius);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(display, centerX, top + bubbleH / 2);

  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(SPRITE_SCALE, 1, 1);
  sprite.position.y = SPRITE_HEIGHT;
  sprite.userData.isChatBubble = true;
  sprite.userData.chatExpiry = Date.now() + CHAT_DURATION;
  sprite.renderOrder = RENDER_ORDER;
  return sprite;
}

function showChatBubble(senderId, text) {
  const isLocalPlayer = state.room && senderId === state.room.sessionId;
  const mesh = isLocalPlayer ? player.mesh : remotePlayers.get(senderId);
  if (!mesh) return;

  const existing = mesh.children.find(c => c.userData.isChatBubble);
  if (existing) disposeBubbleSprite(mesh, existing);

  mesh.add(createChatBubbleSprite(text));
}

function updateChatBubbles() {
  const now = Date.now();
  const meshes = [player.mesh, ...remotePlayers.values()];
  for (const mesh of meshes) {
    if (!mesh) continue;
    const bubble = mesh.children.find(c => c.userData.isChatBubble);
    if (!bubble) continue;
    const remaining = bubble.userData.chatExpiry - now;
    if (remaining <= 0) {
      disposeBubbleSprite(mesh, bubble);
    } else if (remaining < 500) {
      bubble.material.opacity = remaining / 500;
    }
  }
}

function updateRemotePlayer(player) {
  let mesh = remotePlayers.get(player.id);

  if (!mesh) {
    mesh = createRemotePlayerMesh(player);
    remotePlayers.set(player.id, mesh);
    scene.add(mesh);
  } else if (player.name && mesh.userData.playerName !== player.name) {
    rebuildNameSprite(mesh, player.name);
  }

  if (player.position) {
    // Set target for interpolation (don't snap)
    mesh.userData.targetPosition.set(...player.position);
  }
}

function removeRemotePlayer(id) {
  const mesh = remotePlayers.get(id);
  if (mesh) {
    scene.remove(mesh);
    mesh.geometry.dispose();
    mesh.material.dispose();
    remotePlayers.delete(id);
    console.log(`[Remote] Removed player: ${id}`);
  }
}

// ============================================
// Announcements
// ============================================

function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => {
    el.classList.add('fade-out');
    setTimeout(() => el.remove(), 400);
  }, 3000);
}

function showConnectionWarning(disconnected) {
  let banner = document.getElementById('connection-warning');
  if (disconnected) {
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'connection-warning';
      banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;background:#d32f2f;color:#fff;text-align:center;padding:6px;font-size:14px;font-weight:bold;';
      banner.textContent = 'Disconnected — reconnecting...';
      document.body.appendChild(banner);
    }
  } else if (banner) {
    banner.remove();
  }
}

// AFK Warning UI

function showAfkWarning(token, timeout) {
  hideAfkWarning();

  afk.overlay = document.createElement('div');
  afk.overlay.id = 'afk-overlay';
  afk.overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.85);display:flex;flex-direction:column;align-items:center;justify-content:center;';

  const title = document.createElement('div');
  title.style.cssText = 'color:#ff6b6b;font-size:32px;font-weight:bold;margin-bottom:16px;text-shadow:0 0 20px rgba(255,107,107,0.5);';
  title.textContent = 'ARE YOU STILL THERE?';

  const countdownEl = document.createElement('div');
  countdownEl.style.cssText = 'color:#fff;font-size:20px;margin-bottom:24px;';
  let remaining = Math.ceil(timeout / 1000);
  countdownEl.textContent = `You'll be kicked in ${remaining}s...`;
  afk.countdownInterval = setInterval(() => {
    remaining--;
    if (remaining <= 0) {
      clearInterval(afk.countdownInterval);
      countdownEl.textContent = 'Kicking...';
    } else {
      countdownEl.textContent = `You'll be kicked in ${remaining}s...`;
    }
  }, 1000);

  const btn = document.createElement('button');
  btn.style.cssText = 'padding:16px 48px;font-size:22px;font-weight:bold;background:#4caf50;color:#fff;border:none;border-radius:12px;cursor:pointer;transition:transform 0.1s;';
  btn.textContent = "I'm here!";
  btn.onmouseenter = () => btn.style.transform = 'scale(1.05)';
  btn.onmouseleave = () => btn.style.transform = 'scale(1)';
  btn.onclick = () => {
    if (state.room) state.room.send('afk_heartbeat', { token });
    hideAfkWarning();
  };

  afk.overlay.appendChild(title);
  afk.overlay.appendChild(countdownEl);
  afk.overlay.appendChild(btn);
  document.body.appendChild(afk.overlay);

  // Any keypress also dismisses (hideAfkWarning cleans up this listener)
  const keyHandler = () => {
    if (state.room) state.room.send('afk_heartbeat', { token });
    hideAfkWarning();
  };
  document.addEventListener('keydown', keyHandler);
  afk.overlay._keyHandler = keyHandler;
}

function hideAfkWarning() {
  if (afk.countdownInterval) {
    clearInterval(afk.countdownInterval);
    afk.countdownInterval = null;
  }
  if (afk.overlay) {
    if (afk.overlay._keyHandler) {
      document.removeEventListener('keydown', afk.overlay._keyHandler);
    }
    afk.overlay.remove();
    afk.overlay = null;
  }
}

function showAfkKickedScreen() {
  hideAfkWarning();
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.92);display:flex;flex-direction:column;align-items:center;justify-content:center;';

  const title = document.createElement('div');
  title.style.cssText = 'color:#ff6b6b;font-size:36px;font-weight:bold;margin-bottom:12px;';
  title.textContent = 'DISCONNECTED';

  const reason = document.createElement('div');
  reason.style.cssText = 'color:#aaa;font-size:18px;margin-bottom:32px;';
  reason.textContent = 'You were kicked for being AFK.';

  const btn = document.createElement('button');
  btn.style.cssText = 'padding:16px 48px;font-size:20px;font-weight:bold;background:#2196f3;color:#fff;border:none;border-radius:12px;cursor:pointer;';
  btn.textContent = 'Rejoin';
  btn.onclick = () => location.reload();

  overlay.appendChild(title);
  overlay.appendChild(reason);
  overlay.appendChild(btn);
  document.body.appendChild(overlay);
}

function enforceAnnouncementLimit(container) {
  while (container.children.length >= MAX_VISIBLE_ANNOUNCEMENTS) {
    const oldest = container.firstChild;
    const oldId = oldest.id?.replace('ann-', '');
    oldest.remove();
    if (oldId) state.announcements.delete(oldId);
  }
}

function showAnnouncement(announcement) {
  const container = document.getElementById('announcements');

  if (state.announcements.has(announcement.id)) return;

  enforceAnnouncementLimit(container);

  const div = document.createElement('div');
  div.className = `announcement ${announcement.type || 'agent'}`;
  div.textContent = announcement.text;
  div.id = `ann-${announcement.id}`;
  container.appendChild(div);

  state.announcements.set(announcement.id, true);

  const duration = Math.min(announcement.duration || 5000, 4000);
  setTimeout(() => {
    div.classList.add('fade-out');
    setTimeout(() => {
      div.remove();
      state.announcements.delete(announcement.id);
    }, 500);
  }, duration - 500);

  console.log(`[Announcement] ${announcement.type}: ${announcement.text}`);
}

// ============================================
// Spell Effects
// ============================================

function showSpellEffect(spell) {
  const container = document.getElementById('announcements');

  enforceAnnouncementLimit(container);

  const div = document.createElement('div');
  div.className = 'announcement agent';
  div.textContent = `${spell.name}!`;
  div.style.fontSize = '24px';
  container.appendChild(div);

  setTimeout(() => {
    div.classList.add('fade-out');
    setTimeout(() => div.remove(), 500);
  }, 2500);
}

// ============================================
// Game State UI
// ============================================

function clearCountdownInterval() {
  if (countdown.intervalId !== null) {
    clearInterval(countdown.intervalId);
    countdown.intervalId = null;
  }
}

function updateGameStateUI() {
  const statusEl = document.getElementById('game-status');
  const phaseEl = document.getElementById('game-phase');
  const typeEl = document.getElementById('game-type');
  const timerEl = document.getElementById('game-timer');

  if (state.gameState.phase === 'lobby') {
    statusEl.style.display = 'flex';
    statusEl.className = 'lobby';
    phaseEl.textContent = 'LOBBY';
    if (state.lobbyCountdownTarget) {
      const now = Date.now();
      if (state.lobbyReadyAt && now < state.lobbyReadyAt) {
        // Phase 1: warm-up countdown (accurate)
        const remaining = Math.max(0, Math.ceil((state.lobbyReadyAt - now) / 1000));
        typeEl.textContent = 'Get ready!';
        timerEl.textContent = remaining > 0 ? `Starting in ${remaining}s` : '';
        timerEl.style.color = '#f39c12';
      } else {
        // Phase 2: waiting for agent (no misleading countdown)
        typeEl.textContent = 'Chaos Magician choosing...';
        timerEl.textContent = '';
      }
    } else {
      typeEl.textContent = 'Waiting for players...';
      timerEl.textContent = '';
    }
    return;
  }

  // Building phase shows "BUILDING..." text
  if (state.gameState.phase === 'building') {
    statusEl.style.display = 'flex';
    statusEl.className = 'building';
    phaseEl.textContent = 'BUILDING...';
    typeEl.textContent = 'The Magician is crafting...';
    timerEl.textContent = '';
    return;
  }

  statusEl.style.display = 'flex';
  statusEl.className = state.gameState.phase;
  phaseEl.textContent = state.gameState.phase.toUpperCase();
  typeEl.textContent = state.gameState.gameType ? `Mode: ${state.gameState.gameType}` : '';

  if (state.gameState.phase === 'playing' && state.gameState.timeRemaining !== undefined) {
    clearCountdownInterval();
    const seconds = Math.ceil(state.gameState.timeRemaining / 1000);
    timerEl.textContent = `${seconds}s`;
    timerEl.style.color = seconds <= 10 ? '#e74c3c' : 'white';
  } else if (state.gameState.phase === 'countdown') {
    // Countdown display is driven by the interval in game_state_changed handler.
    // Only set the initial text if the interval has not started yet.
    if (countdown.intervalId === null) {
      timerEl.textContent = '5...';
      timerEl.style.color = '#f39c12';
    }
  } else {
    clearCountdownInterval();
    timerEl.textContent = '';
  }
}

// ============================================
// UI
// ============================================
function updateUI() {
  document.getElementById('entity-count').textContent = state.entities.size;
  document.getElementById('player-count').textContent = remotePlayers.size + (isSpectator ? 0 : 1);
  document.getElementById('physics-info').textContent = `g=${state.physics.gravity}`;

  const entitiesDiv = document.getElementById('entities');
  entitiesDiv.innerHTML = '';
  for (const e of state.entities.values()) {
    const item = document.createElement('div');
    item.className = 'entity-item';
    item.textContent = `${e.type}: ${e.id.slice(-8)}`;
    entitiesDiv.appendChild(item);
  }

  updateGameStateUI();
}

// ============================================
// Network
// ============================================

function applyWorldState(worldData) {
  if (worldData.physics) state.physics = worldData.physics;
  if (worldData.gameState) state.gameState = worldData.gameState;
  if (worldData.floorType) setFloorType(worldData.floorType);
  if (worldData.environment) applyEnvironment(worldData.environment);
  if (worldData.hazardPlane) {
    Object.assign(hazardPlaneState, worldData.hazardPlane);
    hazardPlaneMesh.visible = hazardPlaneState.active;
    hazardPlaneMesh.position.y = hazardPlaneState.height;
    updateHazardPlaneMaterial(hazardPlaneState.type);
  }
  if (worldData.players) {
    for (const p of worldData.players) {
      if (state.room && p.id === state.room.sessionId) continue;
      state.players.set(p.id, p);
      updateRemotePlayer(p);
    }
  }
  for (const entity of worldData.entities || []) {
    addEntity(entity);
  }
  if (worldData.announcements) {
    for (const ann of worldData.announcements) {
      showAnnouncement(ann);
    }
  }
}

async function fetchInitialState() {
  try {
    const response = await fetch(`${getApiBase()}/world/state`);
    const data = await response.json();
    applyWorldState(data);
    console.log(`[Init] Loaded ${data.entities.length} entities`);
    return true;
  } catch (error) {
    console.error('[Init] Failed to fetch state:', error);
    return false;
  }
}

async function connectToServer() {
  try {
    const client = new Client(SERVER_URL);
    const user = auth.user?.user;
    const playerName = user?.twitterUsername || user?.name || `Player-${Date.now().toString(36)}`;
    const joinOptions = { name: playerName, arenaId: selectedArenaId };

    if (auth.user?.token) {
      joinOptions.token = auth.user.token;
    }
    if (user?.type) {
      joinOptions.type = user.type;
    }

    const room = await client.joinOrCreate('game', joinOptions);

    state.room = room;
    state.connected = true;
    showConnectionWarning(false);
    console.log('[Network] Connected to room:', room.roomId);

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

    // AFK detection
    room.onMessage('afk_warning', ({ token, timeout }) => {
      showAfkWarning(token, timeout);
    });
    room.onMessage('afk_cleared', () => {
      hideAfkWarning();
    });
    // Note: afk_kicked is handled via onLeave(4000) above to avoid double-overlay

    // Entity events
    room.onMessage('entity_spawned', (entity) => {
      console.log('[Event] Entity spawned:', entity.id);
      addEntity(entity);
    });

    room.onMessage('entity_modified', (entity) => {
      updateEntity(entity);
    });

    room.onMessage('entity_destroyed', ({ id }) => {
      // Break particles if this entity was cracking
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

    // Player events
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

    // Chat
    room.onMessage('chat_message', displayChatMessage);
    room.onMessage('chat_error', ({ error }) => {
      showToast(error || 'Message not sent', 'error');
    });

    // Triggers
    room.onMessage('trigger_activated', (data) => {
      const entity = state.entities.get(data.entityId);
      if (entity) {
        spawnParticles(entity.position, '#9b59b6', 15, 3);
      }
    });

    // === King of the Hill: live scoreboard ===
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

    // === Hot Potato: curse tracking ===
    room.onMessage('curse_changed', (data) => {
      state._cursedPlayerId = data.cursedPlayerId;
      state._curseRound = data.round;
      // Red glow on cursed player mesh
      for (const [id, mesh] of remotePlayers) {
        if (mesh.material) {
          mesh.material.emissive?.setHex(id === data.cursedPlayerId ? 0xff0000 : 0x000000);
          mesh.material.emissiveIntensity = id === data.cursedPlayerId ? 0.5 : 0;
        }
      }
      // Local player cursed — red vignette
      if (data.cursedPlayerId === room.sessionId) {
        triggerCameraShake(0.2, 300);
        showVignette('#ff0000', 0.3, data.curseDuration || 12000);
      }
      // Show/update curse timer
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
      // Clear curse glow from eliminated player
      const mesh = remotePlayers.get(data.playerId);
      if (mesh?.material) {
        mesh.material.emissive?.setHex(0x000000);
        mesh.material.emissiveIntensity = 0;
      }
    });

    // === Race: checkpoint progress ===
    room.onMessage('checkpoint_reached', (data) => {
      const cpEl = document.getElementById('checkpoint-display');
      if (!cpEl) return;
      cpEl.style.display = 'block';
      if (data.playerId === room.sessionId) {
        cpEl.textContent = `Checkpoint ${data.checkpoint}/${data.total}`;
        cpEl.style.borderColor = '#2ecc71';
        triggerCameraShake(0.1, 150);
      } else {
        // Show other player's progress
        cpEl.textContent = `${data.playerName}: ${data.checkpoint}/${data.total}`;
        cpEl.style.borderColor = '#95a5a6';
      }
      // Particles at checkpoint
      const entity = state.entities.get(data.entityId);
      if (entity) spawnParticles(entity.position, '#2ecc71', 20, 4);
      playCollectSound();
    });

    // Announcements
    room.onMessage('announcement', showAnnouncement);

    // Spells
    room.onMessage('spell_cast', (spell) => {
      console.log(`[Spell] ${spell.name} cast for ${spell.duration}ms`);
      if (!state.activeEffects) state.activeEffects = [];
      state.activeEffects.push(spell);
      showSpellEffect(spell);
      triggerCameraShake(0.3, 200);
      playSpellSound();

      // Spell-specific vignette overlays
      const SPELL_VIGNETTES = {
        speed_boost: 'rgba(46,204,113,0.3)',
        invert_controls: 'rgba(155,89,182,0.4)',
        low_gravity: 'rgba(52,152,219,0.2)',
      };
      const vignetteColor = SPELL_VIGNETTES[spell.type];
      if (vignetteColor) showVignette(vignetteColor, spell.duration);

      // Scale effects with particle burst
      const SPELL_SCALES = { giant: 2, tiny: 0.4 };
      const scale = SPELL_SCALES[spell.type];
      if (scale && player.mesh) {
        player.mesh.scale.setScalar(scale);
        spawnParticles(player.mesh.position, '#9b59b6', 30, 6);
      }

      // Auto-expire
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
      hazardPlaneMesh.visible = data.active;
      hazardPlaneMesh.position.y = hazardPlaneState.height;
      updateHazardPlaneMaterial(data.type);
    });

    room.onMessage('hazard_plane_update', (data) => {
      Object.assign(hazardPlaneState, data);
      hazardPlaneMesh.position.y = data.height;
    });

    room.onMessage('environment_changed', (env) => {
      applyEnvironment(env);
    });

    room.onMessage('effects_cleared', () => {
      state.activeEffects = [];
      if (player.mesh) player.mesh.scale.set(1, 1, 1);
    });

    // Clean world on lobby transition — remove all entity meshes
    room.onMessage('world_cleared', () => {
      console.log('[Event] World cleared — removing all entities');
      for (const mesh of entityMeshes.values()) {
        scene.remove(mesh);
        mesh.traverse((child) => {
          if (child.geometry) child.geometry.dispose();
          if (child.material) child.material.dispose();
        });
      }
      entityMeshes.clear();
      state.entities.clear();
      // Clear group tracking
      for (const group of groupParents.values()) scene.remove(group);
      groupParents.clear();
      entityToGroup.clear();
      for (const tid of pendingGroups.values()) clearTimeout(tid);
      pendingGroups.clear();
      // Reset hazard plane
      hazardPlaneMesh.visible = false;
      Object.assign(hazardPlaneState, { active: false, type: 'lava', height: -10 });
      updateUI();
    });

    // Teleport all players to start position (Fall Guys countdown)
    room.onMessage('players_teleported', (data) => {
      if (player.mesh && data.position) {
        player.mesh.position.set(data.position[0], data.position[1], data.position[2]);
        playerVelocity.set(0, 0, 0);
        player.isJumping = false;
        player.coyoteTimer = 0;
        player.jumpBufferTimer = 0;
      }
    });

    // Mid-game spectator activation
    room.onMessage('player_activated', () => {
      if (state.isSpectating) {
        clearSpectating();
        showAnnouncement({ id: `activated-${Date.now()}`, text: "You're in! Get ready for the next game!", type: 'system', duration: 4000, timestamp: Date.now() });
      }
    });

    // Game state
    room.onMessage('game_state_changed', (gameState) => {
      console.log('[Event] Game state changed:', gameState.phase);
      const prevPhase = state.gameState.phase;
      state.gameState = gameState;
      updateGameStateUI();

      // Clear lobby countdown when leaving lobby
      if (gameState.phase !== 'lobby') {
        state.lobbyCountdownTarget = null;
        state.lobbyReadyAt = null;
      }

      // Auto-clear spectating when returning to lobby
      if (gameState.phase === 'lobby' && state.isSpectating) {
        clearSpectating();
      }

      // Clear game-specific overlays on lobby/ended
      if (gameState.phase === 'lobby' || gameState.phase === 'ended') {
        const scoreOverlay = document.getElementById('score-overlay');
        const curseTimer = document.getElementById('curse-timer');
        const checkpointDisplay = document.getElementById('checkpoint-display');
        if (scoreOverlay) scoreOverlay.style.display = 'none';
        if (curseTimer) { curseTimer.style.display = 'none'; curseTimer.className = ''; }
        if (checkpointDisplay) checkpointDisplay.style.display = 'none';
        state._cursedPlayerId = null;
        // Clear curse glow from all remote players
        for (const [, mesh] of remotePlayers) {
          if (mesh.material) {
            mesh.material.emissive?.setHex(0x000000);
            mesh.material.emissiveIntensity = 0;
          }
        }
      }

      // Phase transition VFX
      if (gameState.phase === 'countdown' && prevPhase !== 'countdown') {
        triggerCameraShake(0.1, 5000);
        // Countdown beeps: 5, 4, 3, 2, 1, GO!
        for (let i = 0; i < 5; i++) setTimeout(() => playCountdownBeep(440), i * 1000);
        setTimeout(() => playCountdownBeep(880), 5000); // higher pitch for GO

        // Ticking countdown display — clear any prior interval to prevent leaks
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
          // Another player won
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

    // Lobby countdown
    room.onMessage('lobby_countdown', (data) => {
      state.lobbyCountdownTarget = data.targetTime || null;
      state.lobbyReadyAt = data.lobbyReadyAt || null;
      updateGameStateUI();
    });

    // Init (authoritative state from room)
    room.onMessage('init', (data) => {
      console.log('[Init] Received initial state from room');
      applyWorldState(data.worldState);
      state.lobbyCountdownTarget = data.lobbyCountdown || null;
      updateUI();

      // Handle mid-game spectator mode
      if (data.spectating) {
        state.isSpectating = true;
        const banner = document.createElement('div');
        banner.id = 'spectator-banner';
        banner.style.cssText = 'position:fixed;top:60px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.8);color:#f39c12;padding:10px 24px;border-radius:8px;font-size:16px;z-index:999;pointer-events:none;';
        banner.textContent = 'Spectating — WASD to fly, drag to look, 0-9 to follow players';
        document.body.appendChild(banner);
      }
    });

    return true;
  } catch (error) {
    console.error('[Network] Connection failed:', error);
    state.connected = false;
    return false;
  }
}

// ============================================
// Animation Loop
// ============================================
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);

  const delta = clock.getDelta();
  const time = performance.now() / 1000;

  if (isInSpectatorMode()) {
    cameraController.updateSpectatorMovement(delta, keys);
  } else {
    updatePlayer(delta);
    checkCollisions();
  }

  if (player.mesh && !isInSpectatorMode()) {
    updateSquashStretch(player.mesh, playerVelocity.y, player.isGrounded);
  }

  for (const [, mesh] of remotePlayers) {
    if (mesh.userData.targetPosition) {
      const dx = mesh.userData.targetPosition.x - mesh.position.x;
      const dz = mesh.userData.targetPosition.z - mesh.position.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist > 0.05) {
        const targetYaw = Math.atan2(dx, dz);
        mesh.rotation.y += shortAngleDist(mesh.rotation.y, targetYaw) * 0.15;
      }
      mesh.position.lerp(mesh.userData.targetPosition, 0.15);
    }
  }

  for (const [, group] of groupParents) {
    if (group.userData.targetPosition) {
      trackLastPosition(group);
      group.position.lerp(group.userData.targetPosition, 0.2);
    }
    if (group.userData.rotating) {
      group.rotation.y += (group.userData.speed || 1) * delta;
    } else {
      const props = group.userData.entity?.properties;
      // Face movement direction for chase/patrol groups
      if (props?._facing !== undefined) {
        group.rotation.y += shortAngleDist(group.rotation.y, props._facing) * 0.12;
      }
      // Bob for floating/flying groups
      if (props?.isFloating) {
        const baseY = group.userData.targetPosition
          ? group.userData.targetPosition.y
          : group.position.y;
        group.position.y = baseY + Math.sin(Date.now() * 0.002) * 0.4;
      }
    }
  }

  for (const [, mesh] of entityMeshes) {
    const isGrouped = mesh.parent && mesh.parent !== scene;
    const entity = mesh.userData.entity;
    const eType = entity?.type;
    const eProps = entity?.properties;

    if (eProps?.kinematic && !isGrouped) {
      trackLastPosition(mesh);
      if (mesh.userData.targetPosition) {
        mesh.position.lerp(mesh.userData.targetPosition, 0.2);
      }
    }

    if (mesh.userData.rotating && !isGrouped) {
      mesh.rotation.y += mesh.userData.speed * delta;
    }

    if (mesh.userData.cracking) {
      const elapsed = (Date.now() - mesh.userData.crackStart) / 1000;
      mesh.position.x += (Math.random() - 0.5) * 0.04;
      mesh.position.z += (Math.random() - 0.5) * 0.04;
      if (mesh.material) {
        mesh.material.transparent = true;
        mesh.material.opacity = Math.max(0.2, 1 - elapsed * 1.5);
      }
    }

    // ─── Entity idle animations ─────────────────────────
    if (eType === 'collectible') {
      const baseY = entity.position[1];
      mesh.rotation.y += delta;
      mesh.position.y = baseY + Math.sin(time * 1.5 + mesh.id * 0.7) * 0.15;
      const glow = mesh.children[0];
      if (glow?.material) {
        glow.material.opacity = 0.15 + Math.sin(time * 2.5) * 0.12;
      }
    } else if (eType === 'obstacle' && !isGrouped) {
      if (mesh.material?.emissiveIntensity !== undefined) {
        mesh.material.emissiveIntensity = 0.3 + Math.sin(time * 0.8 + mesh.id * 1.1) * 0.2;
      }
      const pulse = 1 + Math.sin(time * 1.6 + mesh.id * 0.5) * 0.02;
      mesh.scale.set(pulse, pulse, pulse);
    } else if (eType === 'decoration' && !isGrouped && !mesh.userData.rotating) {
      mesh.rotation.y += 0.3 * delta;
      if (eProps?.emissive && mesh.material?.emissiveIntensity !== undefined) {
        mesh.material.emissiveIntensity = 0.5 + Math.sin(time * 4 + mesh.id * 2.3) * 0.2 + Math.sin(time * 7) * 0.1;
      }
    } else if (eType === 'trigger' && eProps?.isGoal && !isGrouped) {
      mesh.rotation.y += 1.5 * delta;
      const pulse = 1 + Math.sin(time * 2) * 0.05;
      mesh.scale.set(pulse, pulse, pulse);
      if (mesh.material?.emissiveIntensity !== undefined) {
        mesh.material.emissiveIntensity = 0.5 + Math.sin(time * 3) * 0.25;
      }
    }
  }

  if (lavaFloor.visible) {
    lavaFloor.position.y = -0.5 + Math.sin(time * 1.0) * 0.1;
  }

  if (hazardPlaneMesh.visible) {
    hazardPlaneMesh.position.y = hazardPlaneState.height + Math.sin(time * 1.5) * 0.15;
  }

  updateShaderTime(time);
  updateConveyorScrolls(delta);
  updateEnvironmentEffects(delta, camera.position);
  updateParticles();
  updateOutlineObjects(entityMeshes, groupParents, player.mesh, remotePlayers);
  updateChatBubbles();

  if (isInSpectatorMode()) cameraController.updateCamera();

  // Tick lobby countdown display (~1Hz)
  if (state.gameState.phase === 'lobby' && state.lobbyCountdownTarget) {
    if (time - countdown.lastLobbyTick > 1) {
      countdown.lastLobbyTick = time;
      updateGameStateUI();
    }
  }

  renderFrame();
}

// ============================================
// Resize Handler
// ============================================
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  resizePostProcessing(window.innerWidth, window.innerHeight);
  if (isMobile) {
    cameraState.distance = (window.innerWidth > window.innerHeight) ? 22 : 25;
  }
});

// ============================================
// Polling for updates (backup for WebSocket)
// ============================================
async function pollForUpdates() {
  try {
    const response = await fetch(`${getApiBase()}/world/state`);
    const data = await response.json();

    state.physics = data.physics;

    // gameState intentionally omitted — WebSocket is authoritative for phase transitions

    const serverIds = new Set(data.entities.map(e => e.id));

    for (const entity of data.entities) {
      if (!entityMeshes.has(entity.id)) {
        addEntity(entity);
      } else {
        updateEntity(entity);
      }
    }

    for (const id of entityMeshes.keys()) {
      if (!serverIds.has(id)) {
        removeEntity(id);
      }
    }

    updateUI();
  } catch (error) {
    // Silent fail for polling
  }
}

// ============================================
// Auth Flow
// ============================================
async function startAuthFlow() {
  const splash = document.getElementById('login-splash');
  const buttonsContainer = document.getElementById('login-buttons-container');
  const statusEl = document.getElementById('login-status');
  const continueBtn = document.getElementById('btn-continue');
  const twitterBtn = document.getElementById('btn-twitter-login');

  function setStatus(text) {
    if (statusEl) statusEl.textContent = text;
  }

  function hideLoginScreen() {
    const el = document.getElementById('login-screen');
    el.classList.add('screen-fade-out');
    setTimeout(() => { el.style.display = 'none'; el.classList.remove('screen-fade-out'); }, 300);
  }

  const appId = import.meta.env.VITE_PRIVY_APP_ID;
  const clientId = import.meta.env.VITE_PRIVY_CLIENT_ID;
  const privyEnabled = !!(appId && clientId);

  // --- Start Privy init in background (non-blocking) ---
  // Must happen BEFORE the fast path so wallet is available after auto-login
  let privyReady = false;
  let privyInitPromise = Promise.resolve();

  if (privyEnabled) {
    privyInitPromise = initPrivy(appId, clientId).then(() => {
      privyReady = true;
      if (twitterBtn) {
        twitterBtn.disabled = false;
        twitterBtn.innerHTML = 'Login with X (Twitter)';
      }
    }).catch(e => {
      console.error('[Auth] Privy init failed:', e);
      if (twitterBtn) {
        twitterBtn.textContent = 'Twitter Unavailable';
        twitterBtn.disabled = true;
      }
    });
  } else if (twitterBtn) {
    twitterBtn.style.display = 'none';
  }

  // --- Fast path: returning user with cached token ---
  const existingToken = getToken();
  if (existingToken) {
    try {
      const res = await fetch(`${API_URL}/api/me`, {
        headers: { Authorization: `Bearer ${existingToken}` }
      });
      if (res.ok) {
        const user = await res.json();
        hideLoginScreen();
        return { token: existingToken, user };
      }
    } catch { /* token invalid or server unreachable */ }
    localStorage.removeItem('game:token');
  }

  // --- OAuth callback check (returning from Twitter redirect) ---
  const params = new URLSearchParams(window.location.search);
  const isOAuthCallback = privyEnabled
    && (params.has('privy_oauth_code') || params.has('privy_oauth_state'));

  if (isOAuthCallback) {
    // Update splash status so user sees progress during Twitter callback
    const splashStatus = splash?.querySelector('.login-status');
    if (splashStatus) splashStatus.textContent = 'Connecting to Twitter...';
    await privyInitPromise;
    try {
      if (splashStatus) splashStatus.textContent = 'Authenticating...';
      const callbackUser = await handleOAuthCallback();
      if (callbackUser) {
        if (splashStatus) splashStatus.textContent = 'Logging in...';
        const result = await exchangeForBackendToken();
        if (result) {
          hideLoginScreen();
          return result;
        }
      }
    } catch (e) {
      console.error('[Auth] OAuth callback failed:', e);
    }
  }

  // --- Transition: splash -> login buttons ---
  if (splash) splash.style.display = 'none';
  if (buttonsContainer) buttonsContainer.style.display = 'block';

  // Show "Continue" button if an existing Privy session is already available
  if (privyReady) {
    try {
      const privyUser = await getPrivyUser();
      const result = privyUser ? await exchangeForBackendToken() : null;
      if (result && continueBtn) {
        const userName = result.user?.name || result.user?.twitterUsername || 'Player';
        continueBtn.textContent = `Continue as ${userName}`;
        continueBtn.style.display = 'block';
      }
    } catch (e) {
      console.warn('[Auth] Privy session check failed:', e);
    }
  }

  // --- Wait for user action ---
  return new Promise((resolve) => {
    continueBtn?.addEventListener('click', async () => {
      const token = getToken();
      if (token) {
        await ensureEmbeddedWallet();
        hideLoginScreen();
        resolve({ token, user: { name: continueBtn.textContent.replace('Continue as ', '') } });
      }
    });

    twitterBtn?.addEventListener('click', async () => {
      if (!privyReady) {
        setStatus('Still loading Twitter... please wait');
        await privyInitPromise;
        if (!privyReady) {
          setStatus('Twitter login unavailable. Try Guest mode.');
          return;
        }
      }
      setStatus('Redirecting to Twitter...');
      try {
        await loginWithTwitter();
      } catch (e) {
        setStatus('Login failed: ' + (e.message || 'Unknown error'));
      }
    });

    document.getElementById('btn-guest').addEventListener('click', async () => {
      setStatus('Creating guest session...');
      const result = await loginAsGuest();
      if (result) {
        hideLoginScreen();
        resolve(result);
      } else {
        setStatus('Failed to create session. Try again.');
      }
    });
  });
}

// ============================================
// Bribe System
// ============================================
let bribeOptions = null;

function setupBribeUI() {
  if (isSpectator) return;

  const panel = document.getElementById('bribe-panel');
  const btn = document.getElementById('btn-bribe');
  const balanceEl = document.getElementById('bribe-balance');
  const modal = document.getElementById('bribe-modal');
  const optionsList = document.getElementById('bribe-options-list');
  const closeBtn = document.getElementById('bribe-close');
  if (!panel || !btn) return;

  panel.style.display = 'block';

  async function updateBalance() {
    if (!state.room) return;
    try {
      const addr = await getEmbeddedWalletAddress();
      if (!addr) { if (balanceEl) balanceEl.textContent = '— MON'; return; }
      const res = await fetch(`${API_URL}/api/balance/${addr}`);
      const data = await res.json();
      const bal = parseFloat(data.balance || 0);
      if (balanceEl) balanceEl.textContent = `${bal.toFixed(4)} MON`;
    } catch { /* silent */ }
  }
  updateBalance();
  setInterval(updateBalance, 30000);

  // Fetch bribe options
  fetch(`${getApiBase()}/bribe/options`)
    .then(r => r.json())
    .then(data => {
      bribeOptions = data.options;
      updateBalance();
    })
    .catch(() => {});

  btn.addEventListener('click', () => {
    if (document.pointerLockElement) document.exitPointerLock();
    if (!bribeOptions || !modal || !optionsList) return;

    optionsList.innerHTML = '';
    for (const [key, opt] of Object.entries(bribeOptions)) {
      const item = document.createElement('button');
      item.className = 'bribe-option';
      const costText = `${opt.costMON} MON`;
      item.innerHTML = `<span class="bribe-opt-label">${opt.label}</span><span class="bribe-opt-cost">${costText}</span><span class="bribe-opt-desc">${opt.description}</span>`;
      item.addEventListener('click', () => submitBribe(key));
      optionsList.appendChild(item);
    }
    modal.style.display = 'flex';
  });

  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      modal.style.display = 'none';
    });
  }

  function handleBribeResponse(data) {
    if (data.success) {
      updateBalance();
      if (data.autoExecuted) {
        showToast('Bribe accepted! Effect applied.', 'success');
      } else {
        showToast('Bribe queued! The Magician will consider it...', 'warning');
      }
    } else {
      showToast(data.error || 'Bribe rejected', 'error');
    }
  }

  async function signAndSendTransaction(option) {
    if (auth.user?.user?.type === 'guest') {
      showToast('Login with Twitter to unlock bribes', 'error');
      return null;
    }

    const walletResult = await getEmbeddedWalletProvider();
    if (!walletResult) {
      showToast('Wallet not available. Try refreshing the page.', 'error');
      console.error('[Bribe] getEmbeddedWalletProvider returned null (see [Auth] warnings)');
      return null;
    }
    const { provider, address } = walletResult;

    // Switch to Monad chain
    try {
      await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x8f' }] });
    } catch (switchErr) {
      try {
        await provider.request({
          method: 'wallet_addEthereumChain',
          params: [{
            chainId: '0x8f',
            chainName: 'Monad',
            nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
            rpcUrls: ['https://rpc.monad.xyz'],
            blockExplorerUrls: ['https://monadscan.com']
          }]
        });
      } catch (addErr) {
        console.warn('[Bribe] Could not add Monad chain:', addErr.message);
      }
    }

    // Verify we're on the right chain
    try {
      const chainId = await provider.request({ method: 'eth_chainId' });
      console.log('[Bribe] Current chain:', chainId);
      if (chainId !== '0x8f') {
        showToast('Wrong network. Expected Monad (chain 143).', 'error');
        return null;
      }
    } catch (e) {
      console.warn('[Bribe] eth_chainId failed:', e.message);
    }

    // Pre-check balance
    try {
      const balHex = await provider.request({ method: 'eth_getBalance', params: [address, 'latest'] });
      if (BigInt(balHex) < BigInt(option.costWei)) {
        showToast(`Insufficient MON. Need ${option.costMON} MON.`, 'error');
        return null;
      }
    } catch {
      showToast('Could not check balance', 'error');
      return null;
    }

    // Send transaction
    try {
      showToast('Sending transaction...', 'warning');
      console.log('[Bribe] Calling eth_sendTransaction...', { from: address, to: TREASURY_ADDRESS, value: option.costWei });
      const result = await provider.request({
        method: 'eth_sendTransaction',
        params: [{
          from: address,
          to: TREASURY_ADDRESS,
          value: '0x' + BigInt(option.costWei).toString(16)
        }]
      });
      console.log('[Bribe] Transaction result:', typeof result, String(result).slice(0, 100));
      if (typeof result === 'string' && result.startsWith('0x') && result.length === 66) {
        showToast('Transaction sent!', 'success');
        return result;
      }
      console.warn('[Bribe] Unexpected result format:', result);
      showToast('Transaction may have failed — check console', 'error');
      return null;
    } catch (err) {
      console.error('[Bribe] Full tx error:', err);
      const errMsg = (err.message || 'Unknown error').slice(0, 80);
      showToast('Transaction failed: ' + errMsg, 'error');
      return null;
    }
  }

  async function submitBribe(bribeType) {
    if (!state.room?.sessionId) {
      showToast('Not connected to server', 'error');
      return;
    }

    const option = bribeOptions[bribeType];
    if (!option) return;

    let request = null;
    if (bribeType === 'custom') {
      request = prompt('What do you want the Magician to do?');
      if (!request || !request.trim()) return;
      request = request.trim();
    }

    modal.style.display = 'none';

    // Sign transaction client-side, then submit with txHash
    const txHash = await signAndSendTransaction(option);
    if (!txHash) return;

    // Submit bribe to server
    try {
      const headers = { 'Content-Type': 'application/json' };
      const token = getToken();
      if (token) headers.Authorization = `Bearer ${token}`;

      const res = await fetch(`${getApiBase()}/bribe`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          bribeType,
          request,
          ...(txHash ? { txHash } : {})
        })
      });
      handleBribeResponse(await res.json());
    } catch {
      showToast('Bribe submission failed', 'error');
    }
  }
}

// ============================================
// Spectator Overlay
// ============================================
function setupSpectatorOverlay() {
  // Hide player-only UI
  const controls = document.getElementById('controls');
  if (controls) controls.style.display = 'none';
  // Show spectator-only overlay elements
  const overlay = document.getElementById('spectator-overlay');
  if (overlay) overlay.style.display = 'block';

  // Poll drama score
  setInterval(async () => {
    try {
      const res = await fetch(`${getApiBase()}/agent/drama`);
      const data = await res.json();
      const meter = document.getElementById('drama-fill');
      const label = document.getElementById('drama-value');
      if (meter) meter.style.width = `${data.drama}%`;
      if (label) label.textContent = `${data.drama}`;
      const phaseEl = document.getElementById('agent-phase');
      if (phaseEl) phaseEl.textContent = data.phase?.toUpperCase() || '';
    } catch { /* silent */ }
  }, 2000);
}

// Kill feed for spectator
const killFeed = [];
function addKillFeedEntry(text) {
  killFeed.push({ text, time: Date.now() });
  if (killFeed.length > 5) killFeed.shift();
  renderKillFeed();
}

function renderKillFeed() {
  const container = document.getElementById('kill-feed');
  if (!container) return;
  container.innerHTML = '';
  for (const k of killFeed) {
    const div = document.createElement('div');
    div.className = 'kill-entry';
    div.textContent = k.text;
    container.appendChild(div);
  }
}

// ============================================
// Debug Panel
// ============================================
function setupDebugPanel() {
  const panel = document.getElementById('debug-panel');
  if (!panel) return;
  panel.style.display = 'block';

  const aiToggle = document.getElementById('toggle-ai');
  const agentToggle = document.getElementById('toggle-agent');
  const debugInfo = document.getElementById('debug-info');

  // Fetch initial status
  async function refreshStatus() {
    try {
      const [aiRes, agentRes] = await Promise.all([
        fetch(`${getApiBase()}/ai/status`),
        fetch(`${getApiBase()}/agent/status`)
      ]);
      const aiData = await aiRes.json();
      const agentData = await agentRes.json();
      aiToggle.checked = aiData.enabled;
      agentToggle.checked = !agentData.paused;
      debugInfo.textContent = `AI: ${aiData.count} bots | Agent: ${agentData.phase} | Drama: ${agentData.drama}`;
    } catch { /* silent */ }
  }

  aiToggle.addEventListener('change', async () => {
    const suffix = aiToggle.checked ? '/ai/enable' : '/ai/disable';
    await fetch(`${getApiBase()}${suffix}`, { method: 'POST' });
    refreshStatus();
  });

  agentToggle.addEventListener('change', async () => {
    const suffix = agentToggle.checked ? '/agent/resume' : '/agent/pause';
    await fetch(`${getApiBase()}${suffix}`, { method: 'POST' });
    refreshStatus();
  });

  refreshStatus();
  setInterval(refreshStatus, 5000);
}

// ============================================
// Profile Button & Wallet Panel
// ============================================
const DEFAULT_AVATAR = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">' +
  '<rect width="32" height="32" fill="#555"/>' +
  '<text x="16" y="21" text-anchor="middle" fill="#aaa" font-size="16" font-family="sans-serif">?</text>' +
  '</svg>'
);

function getTwitterFields(user) {
  return {
    avatar: user.twitterAvatar || user.twitter_avatar,
    username: user.twitterUsername || user.twitter_username
  };
}

function setAvatarSrc(imgEl, src) {
  imgEl.src = src || DEFAULT_AVATAR;
  imgEl.onerror = () => { imgEl.src = DEFAULT_AVATAR; };
}

function setupProfileButton() {
  if (isSpectator) return;

  const profileBtn = document.getElementById('profile-btn');
  const walletPanel = document.getElementById('wallet-panel');
  if (!profileBtn || !walletPanel) return;

  const user = auth.user?.user;
  if (!user) return;

  const isAuthenticated = user.type === 'authenticated';
  const twitter = getTwitterFields(user);

  setAvatarSrc(
    document.getElementById('profile-pfp'),
    isAuthenticated ? twitter.avatar : null
  );

  const profileName = isAuthenticated && twitter.username
    ? `@${twitter.username}`
    : (user.name || 'Player');
  document.getElementById('profile-name').textContent = profileName;

  profileBtn.style.display = 'flex';

  profileBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    walletPanel.style.display = walletPanel.style.display === 'none' ? 'block' : 'none';
  });

  document.addEventListener('click', (e) => {
    if (!walletPanel.contains(e.target) && !profileBtn.contains(e.target)) {
      walletPanel.style.display = 'none';
    }
  });

  populateWalletPanel(user);
}

function formatRelativeDate(date) {
  const diffMs = Date.now() - date.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function populateWalletPanel(user) {
  const isAuthenticated = user.type === 'authenticated';
  const twitter = getTwitterFields(user);

  // Header
  setAvatarSrc(document.getElementById('wp-pfp'), isAuthenticated ? twitter.avatar : null);
  document.getElementById('wp-display-name').textContent = user.name || twitter.username || 'Player';
  const usernameLabel = isAuthenticated && twitter.username
    ? `@${twitter.username}`
    : user.type === 'guest' ? 'Guest' : '';
  document.getElementById('wp-username').textContent = usernameLabel;

  const guestMsg = document.getElementById('wp-guest-msg');
  const tabsContainer = document.getElementById('wp-tabs-container');
  const exportBtn = document.getElementById('wp-export');

  // Logout is available for all user types
  document.getElementById('wp-logout').addEventListener('click', async () => {
    await logout();
    window.location.reload();
  });

  // Guest users see a login prompt instead of wallet/tabs
  if (!isAuthenticated) {
    tabsContainer.style.display = 'none';
    exportBtn.style.display = 'none';
    guestMsg.style.display = 'block';
    return;
  }

  // Authenticated user — show tabs, hide guest msg
  guestMsg.style.display = 'none';
  tabsContainer.style.display = 'block';
  exportBtn.style.display = 'block';

  // --- Tab switching ---
  const tabs = tabsContainer.querySelectorAll('.wp-tab');
  const tabContents = tabsContainer.querySelectorAll('.wp-tab-content');
  let historyLoaded = false;

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tabContents.forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      const target = tab.dataset.tab;
      document.getElementById(`wp-tab-${target}`).classList.add('active');
      // Lazy-load history on first visit
      if (target === 'history' && !historyLoaded) {
        historyLoaded = true;
        loadTransactionHistory();
      }
    });
  });

  // --- Overview tab ---
  const userId = user.id;
  const addressEl = document.getElementById('wp-address');
  const balanceEl = document.getElementById('wp-balance');
  const copyBtn = document.getElementById('wp-copy');
  const explorerBtn = document.getElementById('wp-explorer');
  const explorerBase = 'https://monadscan.com/address';

  function displayAddress(addr) {
    addressEl.textContent = addr.slice(0, 6) + '...' + addr.slice(-4);
    addressEl.dataset.full = addr;
    // Also update fund tab address
    const fundAddr = document.getElementById('wp-fund-address');
    if (fundAddr) fundAddr.textContent = addr;
  }

  const existingAddr = user.walletAddress || user.wallet_address;
  if (existingAddr) {
    displayAddress(existingAddr);
  }

  async function refreshWallet() {
    const clientAddr = await getEmbeddedWalletAddress();
    if (clientAddr) {
      displayAddress(clientAddr);
      return;
    }
    try {
      const res = await fetch(`${API_URL}/api/wallet/${userId}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.hasWallet && data.walletAddress) {
        displayAddress(data.walletAddress);
      } else {
        addressEl.textContent = 'No wallet yet';
      }
    } catch {
      if (!addressEl.dataset.full) addressEl.textContent = 'Unavailable';
    }
  }

  async function refreshBalance() {
    try {
      const balanceId = addressEl.dataset.full || state.room?.sessionId || userId;
      const res = await fetch(`${API_URL}/api/balance/${balanceId}`);
      if (!res.ok) return;
      const data = await res.json();
      balanceEl.textContent = parseFloat(data.balance || 0).toFixed(4);
    } catch { /* silent */ }
  }

  refreshWallet();
  refreshBalance();
  setInterval(refreshBalance, 30000);

  copyBtn.addEventListener('click', () => {
    const full = addressEl.dataset.full;
    if (!full) return;
    navigator.clipboard.writeText(full).then(() => {
      copyBtn.innerHTML = '&#x2713;';
      copyBtn.style.color = '#2ecc71';
      showToast('Address copied!');
      setTimeout(() => {
        copyBtn.innerHTML = '&#x2398;';
        copyBtn.style.color = '';
      }, 2000);
    });
  });

  explorerBtn.addEventListener('click', () => {
    const full = addressEl.dataset.full;
    if (full) window.open(`${explorerBase}/${full}`, '_blank');
  });

  // --- History tab ---
  async function loadTransactionHistory() {
    const listEl = document.getElementById('wp-tx-list');
    try {
      const token = getToken();
      const res = await fetch(`${API_URL}/api/transactions`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      if (!res.ok) {
        listEl.innerHTML = '<div class="wp-tx-empty">Could not load history</div>';
        return;
      }
      const { transactions } = await res.json();
      if (!transactions.length) {
        listEl.innerHTML = '<div class="wp-tx-empty">No transactions yet</div>';
        return;
      }
      listEl.innerHTML = transactions.map(tx => {
        const date = new Date(tx.createdAt);
        const relative = formatRelativeDate(date);
        const statusClass = tx.status || 'pending';
        const amountLabel = `${tx.amount} MON`;
        const hashLink = tx.txHash
          ? `<a class="wp-tx-hash" href="https://monadscan.com/tx/${tx.txHash}" target="_blank">${tx.txHash.slice(0, 8)}...</a>`
          : '';
        return `<div class="wp-tx-item">
          <div class="wp-tx-info">
            <div class="wp-tx-label">${tx.description || tx.txType}</div>
            <div class="wp-tx-date">${relative} ${hashLink}</div>
          </div>
          <div class="wp-tx-right">
            <div class="wp-tx-amount">${amountLabel}</div>
            <span class="wp-tx-status ${statusClass}">${statusClass}</span>
          </div>
        </div>`;
      }).join('');
    } catch {
      listEl.innerHTML = '<div class="wp-tx-empty">Failed to load</div>';
    }
  }

  // --- Fund tab ---
  document.getElementById('wp-fund-hint').textContent = 'Send MON to this address from MetaMask or an exchange.';

  const fundAddrEl = document.getElementById('wp-fund-address');
  fundAddrEl.addEventListener('click', () => {
    const full = addressEl.dataset.full;
    if (full) {
      navigator.clipboard.writeText(full).then(() => showToast('Address copied!'));
    }
  });

  // --- Export wallet button ---
  exportBtn.addEventListener('click', async () => {
    try {
      await exportWallet();
    } catch (e) {
      console.error('[Wallet] Export failed:', e);
      showToast('Could not export wallet', 'error');
    }
  });
}

// ============================================
// Arena Lobby
// ============================================
let arenaRefreshInterval = null;

async function showArenaLobby() {
  const lobby = document.getElementById('arena-lobby');
  const listEl = document.getElementById('arena-list');
  if (!lobby || !listEl) {
    // No lobby UI — just use default
    return 'chaos';
  }

  lobby.style.display = 'flex';
  lobby.classList.add('screen-fade-in');

  async function loadArenas() {
    try {
      const res = await fetch(`${API_URL}/api/arenas`);
      const data = await res.json();
      return data.arenas || [];
    } catch {
      return [];
    }
  }

  function renderArenas(arenas) {
    if (arenas.length === 0) {
      listEl.innerHTML = '<div class="arena-loading">No arenas available</div>';
      return;
    }

    // Always pin default (chaos) arena at the top
    arenas.sort((a, b) => {
      if (a.isDefault) return -1;
      if (b.isDefault) return 1;
      return (b.playerCount || 0) - (a.playerCount || 0);
    });

    listEl.innerHTML = arenas.map(a => {
      const badgeClass = a.phase || 'lobby';
      const badgeText = a.phase === 'playing' ? 'LIVE' : (a.phase || 'LOBBY').toUpperCase();
      const desc = a.description ? `<div class="arena-card-desc">${a.description}</div>` : '';
      const defaultClass = a.isDefault ? ' default' : '';
      return `
        <div class="arena-card${defaultClass}" data-arena-id="${a.id}">
          <div class="arena-card-header">
            <span class="arena-card-name">${a.name || a.id}</span>
            <span class="arena-card-badge ${badgeClass}">${badgeText}</span>
          </div>
          <div class="arena-card-meta">
            <span>${a.playerCount || 0} players</span>
            <span>${a.gameMasterName || 'Game Master'}</span>
            ${a.gameType ? `<span>${a.gameType}</span>` : ''}
          </div>
          ${desc}
        </div>
      `;
    }).join('');
  }

  // Initial load
  let arenas = await loadArenas();
  renderArenas(arenas);

  // Auto-refresh every 5s
  arenaRefreshInterval = setInterval(async () => {
    arenas = await loadArenas();
    renderArenas(arenas);
  }, 5000);

  return new Promise((resolve) => {
    listEl.addEventListener('click', (e) => {
      const card = e.target.closest('.arena-card');
      if (!card) return;
      const arenaId = card.dataset.arenaId;
      clearInterval(arenaRefreshInterval);
      lobby.classList.add('screen-fade-out');
      setTimeout(() => { lobby.style.display = 'none'; lobby.classList.remove('screen-fade-out'); }, 300);
      resolve(arenaId);
    });
  });
}

// ============================================
// Init
// ============================================
async function init() {
  console.log('[Game] Initializing...');

  if (isSpectator) {
    // Skip login for spectators
    auth.user = { token: null, user: { name: 'Spectator', type: 'spectator' } };
  } else {
    auth.user = await startAuthFlow();
  }

  // Arena selection — skip if arena is specified via URL param
  if (!urlParams.get('arena') && !isSpectator) {
    setSelectedArenaId(await showArenaLobby());
  }
  console.log(`[Game] Selected arena: ${selectedArenaId}`);

  await fetchInitialState();
  await connectToServer();
  if (!isSpectator) {
    createPlayer();
  } else {
    const badge = document.createElement('div');
    badge.id = 'spectator-badge';
    badge.textContent = 'SPECTATING';
    document.body.appendChild(badge);
  }

  setupChat();
  setupKeyboardInput({ isInSpectatorMode, fetchLeaderboard, camera });
  fetchLeaderboard();
  if (isSpectator) setupSpectatorOverlay();
  else setupBribeUI();
  if (isDebug) setupDebugPanel();
  if (isMobile && !isSpectator) setupMobileControls({ keys, rendererDomElement: renderer.domElement, fetchLeaderboard });

  // Load existing chat history
  try {
    const chatResp = await fetch(`${getApiBase()}/chat/messages`);
    const chatData = await chatResp.json();
    for (const msg of chatData.messages) {
      displayChatMessage(msg);
    }
  } catch {
    // Chat history is non-critical
  }

  // Transition from login screen to game UI
  const loginEl = document.getElementById('login-screen');
  loginEl.classList.add('screen-fade-out');
  setTimeout(() => { loginEl.style.display = 'none'; loginEl.classList.remove('screen-fade-out'); }, 300);
  if (isDebug) document.getElementById('ui').style.display = 'block';
  const controlsEl = document.getElementById('controls');
  controlsEl.style.display = 'block';
  document.getElementById('chat-panel').style.display = 'flex';
  const helpBtn = document.getElementById('help-btn');
  helpBtn.style.display = 'flex';
  helpBtn.addEventListener('click', () => toggleHelpOverlay());
  // Click backdrop to close help overlay (moved from inline onclick)
  document.getElementById('help-overlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) toggleHelpOverlay(false);
  });

  // Profile button & wallet panel
  setupProfileButton();

  // Start default ambient particles
  initParticles(scene, 'dust');

  animate();

  // Backup polling and periodic refreshes
  setInterval(pollForUpdates, 2000);
  setInterval(fetchLeaderboard, 10000);
  setInterval(() => {
    if (player.mesh && state.room) {
      sendToServer('move', {
        position: player.mesh.position.toArray(),
        velocity: playerVelocity.toArray()
      });
    }
  }, 100);

  console.log('[Game] Ready!');
}

init();
