/**
 * Self-Building Game - Browser Client
 * Three.js + Colyseus for real-time multiplayer
 */

import * as THREE from 'three';
import { Client } from 'colyseus.js';
import {
  initPrivy, handleOAuthCallback, exchangeForBackendToken,
  loginAsGuest, loginWithTwitter, getPrivyUser, getToken, debugAuth, logout
} from './auth.js';

// ============================================
// Configuration
// ============================================
const isLocalhost = window.location.hostname === 'localhost';
const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const SERVER_URL = isLocalhost
  ? 'ws://localhost:3000'
  : `${wsProtocol}//${window.location.host}`;
const API_URL = isLocalhost
  ? 'http://localhost:3000'
  : `${window.location.protocol}//${window.location.host}`;

// Spectator mode detection
const urlParams = new URLSearchParams(window.location.search);
const isSpectator = urlParams.get('spectator') === 'true';
const isDebug = urlParams.get('debug') === 'true';

// ============================================
// Game State
// ============================================
const state = {
  entities: new Map(),
  players: new Map(),
  physics: { gravity: -9.8, friction: 0.3, bounce: 0.5 },
  localPlayer: null,
  room: null,
  gameState: { phase: 'lobby' },
  announcements: new Map(),
  connected: false,
  isReady: false,
  chatFocused: false,
  activeEffects: [],
  respawnPoint: [0, 2, 0],
  isSpectating: false
};

// Auth state
let authUser = null;

// Remote players
const remotePlayers = new Map();

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

// Throttle position sends to 20 per second
let lastMoveTime = 0;
const MOVE_INTERVAL = 50; // ms

// Physics constants — tuned for Fall Guys / Stumble Guys feel
const PHYSICS = {
  GRAVITY:            -76.5,
  FALL_MULTIPLIER:    2.2,
  LOW_JUMP_MULTIPLIER: 4.0,
  TERMINAL_VELOCITY:  -60,
  JUMP_FORCE:         26.5,
  COYOTE_TIME:        0.10,
  JUMP_BUFFER_TIME:   0.10,
  WALK_SPEED:         16,
  SPRINT_SPEED:       26,
  GROUND_ACCEL:       80,
  GROUND_DECEL:       60,
  AIR_ACCEL:          30,
  AIR_DECEL:          10,
};

function moveToward(current, target, maxDelta) {
  if (Math.abs(target - current) <= maxDelta) return target;
  return current + Math.sign(target - current) * maxDelta;
}

// Reconnection logic
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;

async function attemptReconnect() {
  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    console.error('[Network] Max reconnect attempts reached');
    return;
  }

  reconnectAttempts++;
  console.log(`[Network] Reconnecting... (attempt ${reconnectAttempts})`);

  try {
    await connectToServer();
    reconnectAttempts = 0;
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
scene.background = new THREE.Color(0x1a1a2e);
scene.fog = new THREE.Fog(0x1a1a2e, 50, 200);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 10, 30);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
document.getElementById('game').appendChild(renderer.domElement);

// Lighting
const ambientLight = new THREE.AmbientLight(0x404040, 0.5);
scene.add(ambientLight);

const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
directionalLight.position.set(50, 100, 50);
directionalLight.castShadow = true;
directionalLight.shadow.mapSize.width = 2048;
directionalLight.shadow.mapSize.height = 2048;
scene.add(directionalLight);

// Ground plane
const groundGeometry = new THREE.PlaneGeometry(200, 200, 50, 50);
const groundMaterial = new THREE.MeshStandardMaterial({
  color: 0x2d3436,
  wireframe: false,
  roughness: 0.8
});
const ground = new THREE.Mesh(groundGeometry, groundMaterial);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// Grid helper
const gridHelper = new THREE.GridHelper(200, 50, 0x444444, 0x333333);
scene.add(gridHelper);

// Lava floor plane (hidden by default)
const lavaGeometry = new THREE.PlaneGeometry(200, 200, 20, 20);
const lavaMaterial = new THREE.MeshStandardMaterial({
  color: 0xe74c3c,
  emissive: 0xff4500,
  emissiveIntensity: 0.6,
  roughness: 0.3,
  metalness: 0.1,
  transparent: true,
  opacity: 0.9
});
const lavaFloor = new THREE.Mesh(lavaGeometry, lavaMaterial);
lavaFloor.rotation.x = -Math.PI / 2;
lavaFloor.position.y = -0.5;
lavaFloor.visible = false;
scene.add(lavaFloor);

// Current floor type tracked on client
let currentFloorType = 'solid';

function setFloorType(type) {
  currentFloorType = type;
  ground.visible = type === 'solid';
  gridHelper.visible = type === 'solid';
  lavaFloor.visible = type === 'lava';
  console.log(`[Floor] Type changed to: ${type}`);
}

function applyEnvironment(env) {
  if (env.skyColor) scene.background = new THREE.Color(env.skyColor);
  if (env.fogColor || env.fogNear != null || env.fogFar != null) {
    scene.fog = new THREE.Fog(
      env.fogColor ? new THREE.Color(env.fogColor) : scene.fog.color,
      env.fogNear ?? scene.fog.near,
      env.fogFar ?? scene.fog.far
    );
  }
  if (env.ambientColor) ambientLight.color.set(env.ambientColor);
  if (env.ambientIntensity != null) ambientLight.intensity = env.ambientIntensity;
  if (env.sunColor) directionalLight.color.set(env.sunColor);
  if (env.sunIntensity != null) directionalLight.intensity = env.sunIntensity;
  if (env.sunPosition) directionalLight.position.set(...env.sunPosition);
  console.log('[Environment] Updated');
}

// ============================================
// Mobile Detection
// ============================================
const isMobile = 'ontouchstart' in window || navigator.maxTouchPoints > 0 || window.innerWidth < 768;

// ============================================
// Mouse Look Camera
// ============================================
let cameraYaw = 0;
let cameraPitch = 0.3; // slight downward angle
let cameraDistance = isMobile ? 25 : 20;
let pointerLocked = false;

const MIN_PITCH = -Math.PI / 6;  // -30 degrees
const MAX_PITCH = Math.PI / 3;    // 60 degrees
const MIN_DISTANCE = 8;
const MAX_DISTANCE = 40;

// Desktop: pointer lock for camera
if (!isMobile) {
  renderer.domElement.addEventListener('click', () => {
    if (!state.chatFocused) {
      renderer.domElement.requestPointerLock();
    }
  });

  document.addEventListener('pointerlockchange', () => {
    pointerLocked = document.pointerLockElement === renderer.domElement;
    const crosshair = document.getElementById('crosshair');
    if (crosshair) crosshair.style.display = pointerLocked ? 'block' : 'none';
  });

  document.addEventListener('mousemove', (e) => {
    if (!pointerLocked) return;
    cameraYaw -= e.movementX * 0.003;
    cameraPitch -= e.movementY * 0.003;
    cameraPitch = Math.max(MIN_PITCH, Math.min(MAX_PITCH, cameraPitch));
  });
}

document.addEventListener('wheel', (e) => {
  cameraDistance += e.deltaY * 0.02;
  cameraDistance = Math.max(MIN_DISTANCE, Math.min(MAX_DISTANCE, cameraDistance));
});

// ============================================
// Mobile Touch Controls
// ============================================
// Virtual joystick state (left thumb)
const touchJoystick = { active: false, startX: 0, startY: 0, dx: 0, dy: 0, id: null };
// Touch camera state (right side drag)
const touchCamera = { active: false, lastX: 0, lastY: 0, id: null };

function setupMobileControls() {
  if (!isMobile) return;

  // Create touch UI container
  const touchUI = document.createElement('div');
  touchUI.id = 'mobile-controls';
  touchUI.innerHTML = `
    <div id="joystick-zone"></div>
    <div id="mobile-buttons">
      <button id="btn-jump" class="mobile-btn jump-btn">JUMP</button>
      <button id="btn-sprint" class="mobile-btn sprint-btn">SPRINT</button>
      <button id="btn-ready-mobile" class="mobile-btn ready-btn">READY</button>
    </div>
    <div id="joystick-visual" style="display:none">
      <div id="joystick-base"></div>
      <div id="joystick-thumb"></div>
    </div>
  `;
  document.body.appendChild(touchUI);

  // Add mobile styles
  const style = document.createElement('style');
  style.textContent = `
    #mobile-controls { display: block; }
    #joystick-zone {
      position: fixed; left: 0; bottom: 0;
      width: 50vw; height: 50vh;
      z-index: 300;
      touch-action: none;
    }
    #joystick-visual {
      position: fixed;
      pointer-events: none;
      z-index: 301;
    }
    #joystick-base {
      width: 120px; height: 120px;
      border: 3px solid rgba(255,255,255,0.3);
      border-radius: 50%;
      position: absolute;
      transform: translate(-50%, -50%);
    }
    #joystick-thumb {
      width: 50px; height: 50px;
      background: rgba(255,255,255,0.5);
      border-radius: 50%;
      position: absolute;
      transform: translate(-50%, -50%);
    }
    #mobile-buttons {
      position: fixed;
      right: 15px;
      bottom: 100px;
      z-index: 300;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .mobile-btn {
      width: 70px; height: 70px;
      border-radius: 50%;
      border: 2px solid rgba(255,255,255,0.3);
      background: rgba(0,0,0,0.5);
      color: white;
      font-size: 11px;
      font-weight: bold;
      touch-action: manipulation;
      -webkit-user-select: none;
      user-select: none;
    }
    .mobile-btn:active, .mobile-btn.pressed {
      background: rgba(255,255,255,0.2);
      border-color: rgba(255,255,255,0.6);
    }
    .jump-btn { background: rgba(46, 204, 113, 0.4); border-color: #2ecc71; }
    .sprint-btn { background: rgba(52, 152, 219, 0.4); border-color: #3498db; }
    .ready-btn { background: rgba(241, 196, 15, 0.4); border-color: #f1c40f; }
    /* Mobile responsive adjustments */
    @media (max-width: 768px) {
      #ui { max-width: 200px; padding: 8px; font-size: 11px; }
      #ui h1 { font-size: 14px; }
      #chat-panel { width: 280px; max-height: 200px; bottom: 10px; left: 10px; }
      #chat-messages { max-height: 150px; font-size: 11px; }
      #chat-input { font-size: 12px; }
      #controls { display: none !important; }
      #game-status { padding: 8px; min-width: 100px; }
      #game-timer { font-size: 22px; }
      #leaderboard-panel { width: 160px; top: 100px; }
      #bribe-panel { bottom: 10px; right: auto; left: 50%; transform: translateX(-50%); }
      .bribe-btn { padding: 8px 16px; font-size: 12px; }
      #ready-indicator { bottom: 45px; right: 10px; font-size: 11px; padding: 5px 8px; }
      .announcement { font-size: 14px; padding: 10px 20px; }
      #announcements { top: 40px; }
    }
  `;
  document.head.appendChild(style);

  // Joystick zone touch handling
  const joystickZone = document.getElementById('joystick-zone');
  const joystickVisual = document.getElementById('joystick-visual');
  const joystickBase = document.getElementById('joystick-base');
  const joystickThumb = document.getElementById('joystick-thumb');
  const JOYSTICK_RADIUS = 50;

  joystickZone.addEventListener('touchstart', (e) => {
    if (touchJoystick.active) return;
    const touch = e.changedTouches[0];
    touchJoystick.active = true;
    touchJoystick.id = touch.identifier;
    touchJoystick.startX = touch.clientX;
    touchJoystick.startY = touch.clientY;
    touchJoystick.dx = 0;
    touchJoystick.dy = 0;

    joystickVisual.style.display = 'block';
    joystickVisual.style.left = touch.clientX + 'px';
    joystickVisual.style.top = touch.clientY + 'px';
    joystickBase.style.left = '0px';
    joystickBase.style.top = '0px';
    joystickThumb.style.left = '0px';
    joystickThumb.style.top = '0px';
    e.preventDefault();
  }, { passive: false });

  joystickZone.addEventListener('touchmove', (e) => {
    for (const touch of e.changedTouches) {
      if (touch.identifier === touchJoystick.id) {
        let dx = touch.clientX - touchJoystick.startX;
        let dy = touch.clientY - touchJoystick.startY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > JOYSTICK_RADIUS) {
          dx = dx / dist * JOYSTICK_RADIUS;
          dy = dy / dist * JOYSTICK_RADIUS;
        }
        touchJoystick.dx = dx / JOYSTICK_RADIUS;
        touchJoystick.dy = dy / JOYSTICK_RADIUS;
        joystickThumb.style.left = dx + 'px';
        joystickThumb.style.top = dy + 'px';
      }
    }
    e.preventDefault();
  }, { passive: false });

  const endJoystick = (e) => {
    for (const touch of e.changedTouches) {
      if (touch.identifier === touchJoystick.id) {
        touchJoystick.active = false;
        touchJoystick.dx = 0;
        touchJoystick.dy = 0;
        touchJoystick.id = null;
        joystickVisual.style.display = 'none';
      }
    }
  };
  joystickZone.addEventListener('touchend', endJoystick);
  joystickZone.addEventListener('touchcancel', endJoystick);

  // Right-side touch for camera rotation (on the renderer/game canvas directly)
  renderer.domElement.addEventListener('touchstart', (e) => {
    for (const touch of e.changedTouches) {
      // Only take touches on the right half that aren't on buttons
      if (touch.clientX > window.innerWidth * 0.5 && !touchCamera.active) {
        touchCamera.active = true;
        touchCamera.id = touch.identifier;
        touchCamera.lastX = touch.clientX;
        touchCamera.lastY = touch.clientY;
      }
    }
  }, { passive: true });

  renderer.domElement.addEventListener('touchmove', (e) => {
    for (const touch of e.changedTouches) {
      if (touch.identifier === touchCamera.id) {
        const dx = touch.clientX - touchCamera.lastX;
        const dy = touch.clientY - touchCamera.lastY;
        cameraYaw -= dx * 0.005;
        cameraPitch -= dy * 0.005;
        cameraPitch = Math.max(MIN_PITCH, Math.min(MAX_PITCH, cameraPitch));
        touchCamera.lastX = touch.clientX;
        touchCamera.lastY = touch.clientY;
      }
    }
    e.preventDefault();
  }, { passive: false });

  const endCamera = (e) => {
    for (const touch of e.changedTouches) {
      if (touch.identifier === touchCamera.id) {
        touchCamera.active = false;
        touchCamera.id = null;
      }
    }
  };
  renderer.domElement.addEventListener('touchend', endCamera, { passive: true });
  renderer.domElement.addEventListener('touchcancel', endCamera, { passive: true });

  // Action buttons
  const jumpBtn = document.getElementById('btn-jump');
  const sprintBtn = document.getElementById('btn-sprint');
  const readyBtn = document.getElementById('btn-ready-mobile');

  jumpBtn.addEventListener('touchstart', (e) => {
    e.preventDefault();
    keys.space = true;
    jumpBtn.classList.add('pressed');
  }, { passive: false });
  jumpBtn.addEventListener('touchend', () => {
    keys.space = false;
    jumpBtn.classList.remove('pressed');
  });

  sprintBtn.addEventListener('touchstart', (e) => {
    e.preventDefault();
    keys.shift = !keys.shift;
    sprintBtn.classList.toggle('pressed', keys.shift);
  }, { passive: false });

  readyBtn.addEventListener('touchstart', (e) => {
    e.preventDefault();
    state.isReady = !state.isReady;
    sendToServer('ready', { ready: state.isReady });
    updateReadyUI();
    readyBtn.classList.toggle('pressed', state.isReady);
  }, { passive: false });
}

// Spectator follow target
let spectatorFollowIndex = -1; // -1 = auto, 0+ = specific player

function updateCamera() {
  if (isSpectator) {
    updateSpectatorCamera();
    return;
  }

  if (!playerMesh) return;

  const target = playerMesh.position;

  // Spherical coordinates around player
  const offsetX = Math.sin(cameraYaw) * Math.cos(cameraPitch) * cameraDistance;
  const offsetY = Math.sin(cameraPitch) * cameraDistance;
  const offsetZ = Math.cos(cameraYaw) * Math.cos(cameraPitch) * cameraDistance;

  updateCameraShake();
  camera.position.set(
    target.x + offsetX + cameraShake.offset.x,
    target.y + offsetY + 2 + cameraShake.offset.y,
    target.z + offsetZ + cameraShake.offset.z
  );
  camera.lookAt(target.x, target.y + 1, target.z);
}

function updateSpectatorCamera() {
  // Auto-follow: find the most "interesting" player (highest position or closest to goal)
  const allPlayers = Array.from(remotePlayers.entries());

  if (allPlayers.length === 0) {
    // No players: orbit the world center
    cameraYaw += 0.002;
    camera.position.set(
      Math.sin(cameraYaw) * 40,
      25,
      Math.cos(cameraYaw) * 40
    );
    camera.lookAt(0, 5, 0);
    return;
  }

  let targetMesh;
  if (spectatorFollowIndex >= 0 && spectatorFollowIndex < allPlayers.length) {
    targetMesh = allPlayers[spectatorFollowIndex][1];
  } else {
    // Auto: follow highest player (most dramatic in platforming)
    let highest = allPlayers[0][1];
    for (const [, mesh] of allPlayers) {
      if (mesh.position.y > highest.position.y) highest = mesh;
    }
    targetMesh = highest;
  }

  if (targetMesh) {
    cameraYaw += 0.003;
    const dist = 25;
    camera.position.set(
      targetMesh.position.x + Math.sin(cameraYaw) * dist,
      targetMesh.position.y + 12,
      targetMesh.position.z + Math.cos(cameraYaw) * dist
    );
    camera.lookAt(targetMesh.position.x, targetMesh.position.y + 1, targetMesh.position.z);
  }
}

// Get camera-relative forward and right vectors (Y=0 plane)
function getCameraDirections() {
  const forward = new THREE.Vector3(-Math.sin(cameraYaw), 0, -Math.cos(cameraYaw)).normalize();
  const right = new THREE.Vector3(-forward.z, 0, forward.x);
  return { forward, right };
}

// ============================================
// Entity Rendering
// ============================================
const entityMeshes = new Map();

function getEntityColor(type, customColor) {
  if (customColor) return new THREE.Color(customColor);

  const colors = {
    platform: 0x3498db,
    ramp: 0x2ecc71,
    collectible: 0xf1c40f,
    obstacle: 0xe74c3c,
    trigger: 0x9b59b6,
    decoration: 0x95a5a6
  };
  return new THREE.Color(colors[type] || 0x95a5a6);
}

function getGeometry(entity) {
  const shape = entity.properties?.shape;
  const [sx, sy, sz] = entity.size || [1, 1, 1];

  // Collectibles default to sphere when no explicit shape is set
  if (!shape && entity.type === 'collectible') {
    return new THREE.SphereGeometry(0.5, 16, 16);
  }

  switch (shape) {
    case 'sphere': return new THREE.SphereGeometry(Math.max(sx, sy, sz) / 2, 16, 16);
    case 'cylinder': return new THREE.CylinderGeometry(sx / 2, sx / 2, sy, 16);
    case 'cone': return new THREE.ConeGeometry(sx / 2, sy, 16);
    case 'pyramid': return new THREE.ConeGeometry(sx / 2, sy, 4);
    case 'torus': return new THREE.TorusGeometry(sx / 2, Math.min(sx, sz) / 6, 8, 24);
    case 'dodecahedron': return new THREE.DodecahedronGeometry(Math.max(sx, sy, sz) / 2);
    case 'ring': return new THREE.TorusGeometry(sx / 2, 0.15, 8, 32);
    default: return new THREE.BoxGeometry(sx, sy, sz);
  }
}

function createEntityMesh(entity) {
  const geometry = getGeometry(entity);
  const color = getEntityColor(entity.type, entity.properties?.color);

  const material = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.5,
    metalness: 0.1,
    emissive: color,
    emissiveIntensity: 0.1
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(...entity.position);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData = { entity, rotating: entity.properties?.rotating, speed: entity.properties?.speed || 1 };

  // Add glow effect for collectibles
  if (entity.type === 'collectible') {
    const glowGeometry = new THREE.SphereGeometry(0.7, 16, 16);
    const glowMaterial = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.3
    });
    const glow = new THREE.Mesh(glowGeometry, glowMaterial);
    mesh.add(glow);
  }

  return mesh;
}

function addEntity(entity) {
  if (entityMeshes.has(entity.id)) return;

  const mesh = createEntityMesh(entity);
  scene.add(mesh);
  entityMeshes.set(entity.id, mesh);
  state.entities.set(entity.id, entity);
  updateUI();

  console.log(`[Entity] Added ${entity.type}: ${entity.id}`);
}

function updateEntity(entity) {
  const mesh = entityMeshes.get(entity.id);
  if (!mesh) return addEntity(entity);

  // Store target position for smooth interpolation
  if (!mesh.userData.targetPosition) {
    mesh.userData.targetPosition = new THREE.Vector3(...entity.position);
  } else {
    mesh.userData.targetPosition.set(...entity.position);
  }

  // Immediate update for non-kinematic
  if (!entity.properties?.kinematic) {
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
  mesh.userData.entity = entity;
  mesh.userData.rotating = entity.properties?.rotating;
  mesh.userData.speed = entity.properties?.speed || 1;

  state.entities.set(entity.id, entity);
  updateUI();
}

function removeEntity(id) {
  const mesh = entityMeshes.get(id);
  if (mesh) {
    scene.remove(mesh);
    mesh.traverse((child) => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    });
    entityMeshes.delete(id);
  }
  state.entities.delete(id);
  updateUI();
  console.log(`[Entity] Removed: ${id}`);
}

// ============================================
// Particle System
// ============================================
const particles = [];

function spawnParticles(position, color, count = 20, speed = 5) {
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);
  const velocities = [];

  // Support both THREE.Vector3 and [x, y, z] array positions
  const px = position.x ?? position[0] ?? 0;
  const py = position.y ?? position[1] ?? 0;
  const pz = position.z ?? position[2] ?? 0;

  for (let i = 0; i < count; i++) {
    positions[i * 3] = px;
    positions[i * 3 + 1] = py;
    positions[i * 3 + 2] = pz;
    velocities.push(new THREE.Vector3(
      (Math.random() - 0.5) * speed,
      Math.random() * speed,
      (Math.random() - 0.5) * speed
    ));
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const material = new THREE.PointsMaterial({
    color: new THREE.Color(color),
    size: 0.3,
    transparent: true,
    opacity: 1
  });

  const points = new THREE.Points(geometry, material);
  scene.add(points);

  particles.push({
    mesh: points,
    velocities,
    startTime: Date.now(),
    lifetime: 1500
  });
}

function updateParticles() {
  const now = Date.now();
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    const elapsed = now - p.startTime;

    if (elapsed >= p.lifetime) {
      scene.remove(p.mesh);
      p.mesh.geometry.dispose();
      p.mesh.material.dispose();
      particles.splice(i, 1);
      continue;
    }

    const positions = p.mesh.geometry.attributes.position.array;
    const count = positions.length / 3;
    const dt = 0.016; // ~60fps

    for (let j = 0; j < count; j++) {
      positions[j * 3] += p.velocities[j].x * dt;
      positions[j * 3 + 1] += p.velocities[j].y * dt;
      positions[j * 3 + 2] += p.velocities[j].z * dt;
      p.velocities[j].y -= 9.8 * dt;
    }

    p.mesh.geometry.attributes.position.needsUpdate = true;
    p.mesh.material.opacity = 1 - elapsed / p.lifetime;
  }
}

// ============================================
// Camera Shake System
// ============================================
const cameraShake = { intensity: 0, duration: 0, startTime: 0, offset: new THREE.Vector3() };

function triggerCameraShake(intensity, duration) {
  cameraShake.intensity = intensity;
  cameraShake.duration = duration;
  cameraShake.startTime = Date.now();
}

function updateCameraShake() {
  const elapsed = Date.now() - cameraShake.startTime;
  if (elapsed >= cameraShake.duration) {
    cameraShake.offset.set(0, 0, 0);
    return;
  }
  const decay = 1 - elapsed / cameraShake.duration;
  const i = cameraShake.intensity * decay;
  cameraShake.offset.set(
    (Math.random() - 0.5) * i,
    (Math.random() - 0.5) * i,
    (Math.random() - 0.5) * i
  );
}

// ============================================
// Screen Effects
// ============================================

function createOverlay(zIndex) {
  const el = document.createElement('div');
  el.style.cssText = `position:fixed;top:0;left:0;width:100vw;height:100vh;pointer-events:none;z-index:${zIndex};opacity:0;transition:opacity 0.3s;`;
  document.body.appendChild(el);
  return el;
}

let screenFlashEl = null;
let vignetteEl = null;

function screenFlash(color, duration = 300) {
  if (!screenFlashEl) screenFlashEl = createOverlay(300);
  screenFlashEl.style.background = color;
  screenFlashEl.style.transition = 'none';
  screenFlashEl.style.opacity = '0.4';
  requestAnimationFrame(() => {
    screenFlashEl.style.transition = `opacity ${duration}ms`;
    screenFlashEl.style.opacity = '0';
  });
}

function showVignette(color, duration = 2000) {
  if (!vignetteEl) vignetteEl = createOverlay(299);
  vignetteEl.style.background = `radial-gradient(ellipse at center, transparent 50%, ${color} 100%)`;
  vignetteEl.style.opacity = '0.6';
  setTimeout(() => { vignetteEl.style.opacity = '0'; }, duration);
}

// ============================================
// Procedural Sound Effects
// ============================================
let audioCtx = null;

function getAudioCtx() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioCtx;
}

function createTone(waveType) {
  const ctx = getAudioCtx();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.type = waveType;
  return { ctx, osc, gain, t: ctx.currentTime };
}

function playSound(fn) {
  try { fn(); } catch { /* audio not available */ }
}

function playJumpSound() {
  playSound(() => {
    const { osc, gain, t } = createTone('sine');
    osc.frequency.setValueAtTime(300, t);
    osc.frequency.exponentialRampToValueAtTime(600, t + 0.1);
    gain.gain.setValueAtTime(0.15, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    osc.start(t);
    osc.stop(t + 0.15);
  });
}

function playDeathSound() {
  playSound(() => {
    const { osc, gain, t } = createTone('sawtooth');
    osc.frequency.setValueAtTime(400, t);
    osc.frequency.exponentialRampToValueAtTime(80, t + 0.5);
    gain.gain.setValueAtTime(0.12, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    osc.start(t);
    osc.stop(t + 0.5);
  });
}

function playCollectSound() {
  playSound(() => {
    const notes = [523, 659, 784]; // C5, E5, G5 arpeggio
    notes.forEach((freq, i) => {
      const { osc, gain, t } = createTone('sine');
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.1, t + i * 0.08);
      gain.gain.exponentialRampToValueAtTime(0.001, t + i * 0.08 + 0.2);
      osc.start(t + i * 0.08);
      osc.stop(t + i * 0.08 + 0.2);
    });
  });
}

function playCountdownBeep(pitch = 440) {
  playSound(() => {
    const { osc, gain, t } = createTone('square');
    osc.frequency.value = pitch;
    gain.gain.setValueAtTime(0.08, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    osc.start(t);
    osc.stop(t + 0.2);
  });
}

function playWinFanfare() {
  playSound(() => {
    const notes = [523, 659, 784, 1047]; // C5, E5, G5, C6
    notes.forEach((freq, i) => {
      const { osc, gain, t } = createTone('sine');
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.12, t + i * 0.12);
      gain.gain.exponentialRampToValueAtTime(0.001, t + i * 0.12 + 0.4);
      osc.start(t + i * 0.12);
      osc.stop(t + i * 0.12 + 0.4);
    });
  });
}

function playSpellSound() {
  playSound(() => {
    const { ctx, osc, gain, t } = createTone('sawtooth');
    const filter = ctx.createBiquadFilter();
    osc.disconnect();
    osc.connect(filter);
    filter.connect(gain);
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(2000, t);
    filter.frequency.exponentialRampToValueAtTime(200, t + 0.4);
    osc.frequency.setValueAtTime(800, t);
    osc.frequency.exponentialRampToValueAtTime(200, t + 0.4);
    gain.gain.setValueAtTime(0.08, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    osc.start(t);
    osc.stop(t + 0.4);
  });
}

// ============================================
// Collision Detection (Wall-Slide)
// ============================================
const GROUND_Y = 1;         // Standing height on solid/safe floor
const ABYSS_DEATH_Y = -20;  // Fall-death threshold for 'none' floor
const LAVA_DEATH_Y = 0;     // Death threshold for lava floor
const VOID_DEATH_Y = -50;   // Absolute void death for any floor type

const playerBox = new THREE.Box3();
const entityBox = new THREE.Box3();

let standingOnEntity = null; // Track what entity we're standing on

function checkCollisions() {
  if (!playerMesh) return;

  // Manual AABB — ignores decoration children (eyes, glow ring)
  const pp = playerMesh.position;
  playerBox.min.set(pp.x - 0.5, pp.y - 1.0, pp.z - 0.5);
  playerBox.max.set(pp.x + 0.5, pp.y + 1.0, pp.z + 0.5);

  let standingOnPlatform = false;
  let platformY = 0;
  let platformVelocity = null;
  standingOnEntity = null;

  for (const [, mesh] of entityMeshes) {
    const entity = mesh.userData.entity;
    if (!entity) continue;

    // Manual AABB — ignores glow/decoration children
    const ep = mesh.position;
    const halfSize = entity.type === 'collectible'
      ? [0.5, 0.5, 0.5]
      : entity.size.map(s => s / 2);
    entityBox.min.set(ep.x - halfSize[0], ep.y - halfSize[1], ep.z - halfSize[2]);
    entityBox.max.set(ep.x + halfSize[0], ep.y + halfSize[1], ep.z + halfSize[2]);

    if (!playerBox.intersectsBox(entityBox)) continue;

    // Handle special entity types first
    if (entity.type === 'collectible') {
      collectItem(entity);
      continue;
    }
    if (entity.type === 'obstacle') {
      playerDie();
      continue;
    }
    if (entity.type === 'trigger') {
      triggerEvent(entity);
      continue;
    }

    // Solid collision (platform/ramp) - wall-slide resolution
    if (entity.type === 'platform' || entity.type === 'ramp') {
      // Calculate overlaps on each axis
      const overlapX = (0.5 + halfSize[0]) - Math.abs(playerMesh.position.x - ep.x);
      const overlapY = (1 + halfSize[1]) - Math.abs(playerMesh.position.y - ep.y);
      const overlapZ = (0.5 + halfSize[2]) - Math.abs(playerMesh.position.z - ep.z);

      if (overlapX <= 0 || overlapY <= 0 || overlapZ <= 0) continue;

      // Check if standing on top
      const playerBottom = playerMesh.position.y - 1;
      const platformTop = ep.y + halfSize[1];

      if (playerBottom >= platformTop - 0.5 && playerVelocity.y <= 0) {
        standingOnPlatform = true;
        platformY = platformTop + 1;
        standingOnEntity = entity;

        // Track kinematic platform velocity for carry
        if (entity.properties?.kinematic && mesh.userData.lastPosition) {
          platformVelocity = new THREE.Vector3(
            mesh.position.x - mesh.userData.lastPosition.x,
            mesh.position.y - mesh.userData.lastPosition.y,
            mesh.position.z - mesh.userData.lastPosition.z
          );
        }
      } else {
        // Wall slide - push out on minimum penetration axis (X or Z only)
        if (overlapX < overlapZ) {
          const pushDir = playerMesh.position.x > ep.x ? 1 : -1;
          playerMesh.position.x += overlapX * pushDir;
          playerVelocity.x = 0;
        } else {
          const pushDir = playerMesh.position.z > ep.z ? 1 : -1;
          playerMesh.position.z += overlapZ * pushDir;
          playerVelocity.z = 0;
        }
      }
    }
  }

  // Resolve platform standing
  if (standingOnPlatform) {
    playerMesh.position.y = platformY;
    playerVelocity.y = 0;
    isGrounded = true;
    isJumping = false;

    // Carry player with moving platform
    if (platformVelocity) {
      playerMesh.position.x += platformVelocity.x;
      playerMesh.position.z += platformVelocity.z;
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

let lastDeathTime = 0;
const DEATH_COOLDOWN = 2000; // 2 seconds between deaths

function playerDie() {
  if (!playerMesh || state.localPlayer?.state === 'dead') return;

  // Prevent rapid death loops
  const now = Date.now();
  if (now - lastDeathTime < DEATH_COOLDOWN) return;
  lastDeathTime = now;

  console.log('[Player] Died!');

  if (state.localPlayer) {
    state.localPlayer.state = 'dead';
  }

  sendToServer('died', { position: playerMesh.position.toArray() });

  // Enhanced death VFX
  spawnParticles(playerMesh.position, '#e74c3c', 35, 8);
  spawnParticles(playerMesh.position, '#ff6600', 15, 5);
  playDeathSound();
  triggerCameraShake(0.5, 300);
  screenFlash('#e74c3c', 400);

  playerMesh.material.color.setHex(0xff0000);
  playerMesh.material.emissive.setHex(0xff0000);

  setTimeout(respawnPlayer, 1500);
}

let respawnInvulnUntil = 0;

function respawnPlayer() {
  if (!playerMesh) return;

  const rp = state.respawnPoint || [0, 2, 0];
  playerMesh.position.set(rp[0], rp[1], rp[2]);
  playerVelocity.set(0, 0, 0);
  isJumping = false;
  coyoteTimer = 0;
  jumpBufferTimer = 0;
  playerMesh.material.color.setHex(0x00ff88);
  playerMesh.material.emissive.setHex(0x00ff88);

  // Brief invulnerability after respawn (prevents fall-death loops)
  respawnInvulnUntil = Date.now() + 2000;

  if (state.localPlayer) {
    state.localPlayer.state = 'alive';
  }

  sendToServer('respawn', {});
  console.log('[Player] Respawned');
}

const activatedTriggers = new Map(); // entityId -> timestamp

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
let playerMesh = null;
const playerVelocity = new THREE.Vector3();
const keys = { w: false, a: false, s: false, d: false, space: false, shift: false };
let isGrounded = true;
let coyoteTimer = 0;
let jumpBufferTimer = 0;
let isJumping = false;
let jumpHeld = false;

function addPlayerDecorations(mesh, color) {
  // Eyes
  const eyeGeo = new THREE.SphereGeometry(0.1, 8, 8);
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const pupilGeo = new THREE.SphereGeometry(0.05, 8, 8);
  const pupilMat = new THREE.MeshBasicMaterial({ color: 0x111111 });
  for (const side of [-0.15, 0.15]) {
    const eye = new THREE.Mesh(eyeGeo, eyeMat);
    eye.position.set(side, 0.35, 0.42);
    const pupil = new THREE.Mesh(pupilGeo, pupilMat);
    pupil.position.set(0, 0, 0.06);
    eye.add(pupil);
    mesh.add(eye);
  }

  // Glow ring at base
  const ringGeo = new THREE.TorusGeometry(0.6, 0.08, 8, 24);
  const ringMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.3 });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = -0.75;
  mesh.add(ring);
}

function createPlayer() {
  const geometry = new THREE.CapsuleGeometry(0.5, 1, 4, 8);
  const material = new THREE.MeshStandardMaterial({ color: 0x00ff88, emissive: 0x00ff88, emissiveIntensity: 0.4 });
  playerMesh = new THREE.Mesh(geometry, material);
  playerMesh.position.set(0, 2, 0);
  playerMesh.castShadow = true;
  addPlayerDecorations(playerMesh, 0x00ff88);
  scene.add(playerMesh);
}

// Check if a spell effect is currently active
function hasEffect(effectType) {
  if (!state.activeEffects) return false;
  const now = Date.now();
  return state.activeEffects.some(e => e.type === effectType && now - e.startTime < e.duration);
}

function updatePlayer(delta) {
  if (!playerMesh) return;

  // Clamp delta to prevent physics explosions on tab-switch
  delta = Math.min(delta, 0.05);

  // --- Spell modifiers ---
  let targetSpeed = keys.shift ? PHYSICS.SPRINT_SPEED : PHYSICS.WALK_SPEED;
  let jumpForce = PHYSICS.JUMP_FORCE;
  let spellGravityMult = 1;

  if (hasEffect('speed_boost')) targetSpeed = 30;
  if (hasEffect('slow_motion')) targetSpeed = 10;
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

  let accel;
  if (isGrounded) {
    accel = hasInput ? PHYSICS.GROUND_ACCEL : PHYSICS.GROUND_DECEL;
  } else {
    accel = hasInput ? PHYSICS.AIR_ACCEL : PHYSICS.AIR_DECEL;
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
  if (isGrounded) {
    coyoteTimer = PHYSICS.COYOTE_TIME;
  } else {
    coyoteTimer -= delta;
  }

  if (keys.space && !jumpHeld) {
    jumpBufferTimer = PHYSICS.JUMP_BUFFER_TIME;
  }
  jumpBufferTimer -= delta;
  jumpHeld = keys.space;

  // --- Execute jump ---
  const canJump = isGrounded || coyoteTimer > 0;
  if (canJump && jumpBufferTimer > 0 && !isJumping) {
    playerVelocity.y = jumpForce;
    isJumping = true;
    isGrounded = false;
    coyoteTimer = 0;
    jumpBufferTimer = 0;
    playJumpSound();
  }

  // --- Apply velocity ---
  playerMesh.position.x += playerVelocity.x * delta;
  playerMesh.position.y += playerVelocity.y * delta;
  playerMesh.position.z += playerVelocity.z * delta;

  // Reset before this frame's collision detection
  isGrounded = false;

  // --- Ground collision ---
  const phase = state.gameState.phase;
  const inSafePhase = phase === 'lobby' || phase === 'building';
  const invulnerable = Date.now() < respawnInvulnUntil;
  const hasFloor = currentFloorType === 'solid' || (currentFloorType === 'none' && inSafePhase);

  if (hasFloor) {
    if (playerMesh.position.y < GROUND_Y) {
      playerMesh.position.y = GROUND_Y;
      playerVelocity.y = 0;
      isGrounded = true;
      isJumping = false;
    }
  } else if (currentFloorType === 'none') {
    if (playerMesh.position.y < ABYSS_DEATH_Y && !invulnerable) {
      playerDie();
    }
  } else if (currentFloorType === 'lava') {
    if (playerMesh.position.y < LAVA_DEATH_Y && !invulnerable) {
      spawnParticles(playerMesh.position, '#ff4500', 20, 6);
      spawnParticles(playerMesh.position, '#ffaa00', 10, 4);
      playerDie();
    }
  }
  if (playerMesh.position.y < VOID_DEATH_Y) {
    playerDie();
  }

  updateCamera();

  // Send position to server (throttled)
  const now = performance.now();
  if (now - lastMoveTime >= MOVE_INTERVAL) {
    lastMoveTime = now;
    sendToServer('move', {
      position: playerMesh.position.toArray(),
      velocity: playerVelocity.toArray()
    });
  }
}

// ============================================
// Input
// ============================================
document.addEventListener('keydown', (e) => {
  // Don't process game keys when chat is focused
  if (state.chatFocused) {
    if (e.key === 'Escape') {
      document.getElementById('chat-input').blur();
      state.chatFocused = false;
    }
    return;
  }

  const key = e.key.toLowerCase();
  if (key in keys) keys[key] = true;
  if (key === ' ' && !e.repeat) { keys.space = true; e.preventDefault(); }
  if (e.key === 'Shift') keys.shift = true;

  // Enter to focus chat
  if (e.key === 'Enter') {
    const chatInput = document.getElementById('chat-input');
    if (chatInput) {
      chatInput.focus();
      state.chatFocused = true;
      if (document.pointerLockElement) {
        document.exitPointerLock();
      }
    }
  }

  // Number keys to follow specific players (spectator mode)
  if (isSpectator && key >= '0' && key <= '9') {
    spectatorFollowIndex = key === '0' ? -1 : parseInt(key) - 1;
  }

  // R to toggle ready
  if (key === 'r') {
    state.isReady = !state.isReady;
    sendToServer('ready', { ready: state.isReady });
    updateReadyUI();
  }
});

document.addEventListener('keyup', (e) => {
  if (state.chatFocused) return;
  const key = e.key.toLowerCase();
  if (key in keys) keys[key] = false;
  if (key === ' ') keys.space = false;
  if (e.key === 'Shift') keys.shift = false;
});

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

  // Auto-scroll
  container.scrollTop = container.scrollHeight;
}

// ============================================
// Leaderboard
// ============================================

async function fetchLeaderboard() {
  try {
    const response = await fetch(`${API_URL}/api/leaderboard`);
    const data = await response.json();
    updateLeaderboardUI(data.leaderboard);
  } catch (e) {
    // Silent fail
  }
}

function updateLeaderboardUI(leaderboard) {
  const panel = document.getElementById('leaderboard-panel');
  const entries = document.getElementById('leaderboard-entries');
  if (!panel || !entries) return;

  if (!leaderboard || leaderboard.length === 0) {
    panel.style.display = 'none';
    return;
  }

  panel.style.display = 'block';
  entries.innerHTML = '';
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

    row.append(rank, name, wins);
    entries.appendChild(row);
  }
}

// ============================================
// Ready System
// ============================================

function updateReadyUI() {
  const indicator = document.getElementById('ready-indicator');
  if (!indicator) return;

  if (state.isReady) {
    indicator.textContent = 'READY';
    indicator.classList.add('is-ready');
  } else {
    indicator.textContent = 'Press R to ready up';
    indicator.classList.remove('is-ready');
  }
}

// ============================================
// Remote Player Rendering (with interpolation)
// ============================================

function createRemotePlayerMesh(player) {
  const geometry = new THREE.CapsuleGeometry(0.5, 1, 4, 8);
  const hue = Math.random();
  const color = new THREE.Color().setHSL(hue, 0.7, 0.5);
  const material = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 0.4
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  addPlayerDecorations(mesh, color);

  // Add name label
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(0, 0, 256, 64);
  ctx.fillStyle = 'white';
  ctx.font = 'bold 24px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(player.name || 'Player', 128, 40);

  const texture = new THREE.CanvasTexture(canvas);
  const spriteMaterial = new THREE.SpriteMaterial({ map: texture });
  const sprite = new THREE.Sprite(spriteMaterial);
  sprite.scale.set(3, 0.75, 1);
  sprite.position.y = 2;
  mesh.add(sprite);

  // Initialize interpolation target
  mesh.userData.targetPosition = new THREE.Vector3();
  if (player.position) {
    mesh.userData.targetPosition.set(...player.position);
    mesh.position.set(...player.position);
  }

  return mesh;
}

function updateRemotePlayer(player) {
  let mesh = remotePlayers.get(player.id);

  if (!mesh) {
    mesh = createRemotePlayerMesh(player);
    remotePlayers.set(player.id, mesh);
    scene.add(mesh);
    console.log(`[Remote] Added player: ${player.name || player.id}`);
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

function showAnnouncement(announcement) {
  const container = document.getElementById('announcements');

  if (state.announcements.has(announcement.id)) return;

  const div = document.createElement('div');
  div.className = `announcement ${announcement.type || 'agent'}`;
  div.textContent = announcement.text;
  div.id = `ann-${announcement.id}`;
  container.appendChild(div);

  state.announcements.set(announcement.id, true);

  const duration = announcement.duration || 5000;
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

// Tracked so we can clear it if a new countdown starts or the phase changes
let countdownIntervalId = null;

function clearCountdownInterval() {
  if (countdownIntervalId !== null) {
    clearInterval(countdownIntervalId);
    countdownIntervalId = null;
  }
}

function updateGameStateUI() {
  const statusEl = document.getElementById('game-status');
  const phaseEl = document.getElementById('game-phase');
  const typeEl = document.getElementById('game-type');
  const timerEl = document.getElementById('game-timer');

  if (state.gameState.phase === 'lobby') {
    statusEl.style.display = 'block';
    statusEl.className = 'lobby';
    phaseEl.textContent = 'LOBBY';
    typeEl.textContent = 'Waiting for game...';
    timerEl.textContent = '';
    return;
  }

  // Building phase shows "BUILDING..." text
  if (state.gameState.phase === 'building') {
    statusEl.style.display = 'block';
    statusEl.className = 'building';
    phaseEl.textContent = 'BUILDING...';
    typeEl.textContent = 'The Magician is crafting...';
    timerEl.textContent = '';
    return;
  }

  statusEl.style.display = 'block';
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
    if (countdownIntervalId === null) {
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
    const response = await fetch(`${API_URL}/api/world/state`);
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
    const user = authUser?.user;
    const playerName = user?.twitterUsername || user?.name || `Player-${Date.now().toString(36)}`;
    const joinOptions = { name: playerName };

    if (authUser?.token) {
      joinOptions.token = authUser.token;
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
      showConnectionWarning(true);
      if (code !== 1000) {
        setTimeout(attemptReconnect, 1000);
      }
    });

    room.onError((code, message) => {
      console.error('[Network] Room error:', code, message);
    });

    // Entity events
    room.onMessage('entity_spawned', (entity) => {
      console.log('[Event] Entity spawned:', entity.id);
      addEntity(entity);
    });

    room.onMessage('entity_modified', (entity) => {
      updateEntity(entity);
    });

    room.onMessage('entity_destroyed', ({ id }) => {
      removeEntity(id);
    });

    room.onMessage('physics_changed', (physics) => {
      state.physics = physics;
      updateUI();
    });

    // Player events
    room.onMessage('player_joined', (player) => {
      console.log('[Event] Player joined:', player.name);
      state.players.set(player.id, player);
      updateRemotePlayer(player);
      updateUI();
    });

    room.onMessage('player_left', ({ id }) => {
      state.players.delete(id);
      removeRemotePlayer(id);
      updateUI();
    });

    room.onMessage('player_moved', ({ id, position, velocity }) => {
      if (id === room.sessionId) return;
      const player = state.players.get(id) || { id, position };
      player.position = position;
      updateRemotePlayer(player);
    });

    room.onMessage('player_died', (data) => {
      const player = state.players.get(data.id);
      const name = player?.name || data.id?.slice(0, 8) || 'Player';
      addKillFeedEntry(`${name} died`);
    });

    room.onMessage('player_ready', ({ name, ready }) => {
      console.log(`[Event] ${name} is ${ready ? 'ready' : 'not ready'}`);
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
      if (scale && playerMesh) {
        playerMesh.scale.setScalar(scale);
        spawnParticles(playerMesh.position, '#9b59b6', 30, 6);
      }

      // Auto-expire
      setTimeout(() => {
        state.activeEffects = (state.activeEffects || []).filter(e => e.id !== spell.id);
        if (scale && playerMesh) playerMesh.scale.setScalar(1);
      }, spell.duration);
    });

    room.onMessage('respawn_point_changed', (data) => {
      state.respawnPoint = data.position;
    });

    room.onMessage('floor_changed', (data) => {
      setFloorType(data.type);
    });

    room.onMessage('environment_changed', (env) => {
      applyEnvironment(env);
    });

    room.onMessage('effects_cleared', () => {
      state.activeEffects = [];
      if (playerMesh) playerMesh.scale.set(1, 1, 1);
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
      updateUI();
    });

    // Teleport all players to start position (Fall Guys countdown)
    room.onMessage('players_teleported', (data) => {
      if (playerMesh && data.position) {
        playerMesh.position.set(data.position[0], data.position[1], data.position[2]);
        playerVelocity.set(0, 0, 0);
        isJumping = false;
        coyoteTimer = 0;
        jumpBufferTimer = 0;
      }
    });

    // Mid-game spectator activation
    room.onMessage('player_activated', () => {
      if (state.isSpectating) {
        state.isSpectating = false;
        const banner = document.getElementById('spectator-banner');
        if (banner) banner.remove();
        showAnnouncement({ id: `activated-${Date.now()}`, text: "You're in! Get ready for the next game!", type: 'system', duration: 4000, timestamp: Date.now() });
      }
    });

    // Game state
    room.onMessage('game_state_changed', (gameState) => {
      console.log('[Event] Game state changed:', gameState.phase);
      const prevPhase = state.gameState.phase;
      state.gameState = gameState;
      updateGameStateUI();

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
        countdownIntervalId = setInterval(() => {
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
          if (playerMesh) spawnParticles(playerMesh.position, '#f1c40f', 40, 10);
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

    // Init (authoritative state from room)
    room.onMessage('init', (data) => {
      console.log('[Init] Received initial state from room');
      applyWorldState(data.worldState);
      updateUI();

      // Handle mid-game spectator mode
      if (data.spectating) {
        state.isSpectating = true;
        const banner = document.createElement('div');
        banner.id = 'spectator-banner';
        banner.style.cssText = 'position:fixed;top:60px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.8);color:#f39c12;padding:10px 24px;border-radius:8px;font-size:16px;z-index:999;pointer-events:none;';
        banner.textContent = 'Game in progress — watching until next round...';
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

  // Update player (skip in spectator mode or mid-game spectating)
  if (!isSpectator && !state.isSpectating) updatePlayer(delta);

  // Check collisions with entities
  if (!isSpectator && !state.isSpectating) checkCollisions();

  // Interpolate remote players
  for (const [, mesh] of remotePlayers) {
    if (mesh.userData.targetPosition) {
      mesh.position.lerp(mesh.userData.targetPosition, 0.15);
    }
  }

  // Animate entities
  for (const [, mesh] of entityMeshes) {
    // Store last position for kinematic velocity tracking
    if (mesh.userData.entity?.properties?.kinematic) {
      if (!mesh.userData.lastPosition) {
        mesh.userData.lastPosition = mesh.position.clone();
      } else {
        mesh.userData.lastPosition.copy(mesh.position);
      }

      // Smooth interpolation for kinematic entities
      if (mesh.userData.targetPosition) {
        mesh.position.lerp(mesh.userData.targetPosition, 0.2);
      }
    }

    if (mesh.userData.rotating) {
      mesh.rotation.y += mesh.userData.speed * delta;
    }

    // Collectible bobbing
    if (mesh.userData.entity?.type === 'collectible') {
      mesh.position.y = mesh.userData.entity.position[1] + Math.sin(Date.now() * 0.003) * 0.3;
    }
  }

  // Animate lava floor
  if (lavaFloor.visible) {
    lavaMaterial.emissiveIntensity = 0.5 + Math.sin(Date.now() * 0.002) * 0.2;
    lavaFloor.position.y = -0.5 + Math.sin(Date.now() * 0.001) * 0.1;
  }

  // Update particles
  updateParticles();

  // Spectator camera update (runs even without player)
  if (isSpectator) updateCamera();

  renderer.render(scene, camera);
}

// ============================================
// Resize Handler
// ============================================
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ============================================
// Polling for updates (backup for WebSocket)
// ============================================
async function pollForUpdates() {
  try {
    const response = await fetch(`${API_URL}/api/world/state`);
    const data = await response.json();

    state.physics = data.physics;

    if (data.gameState) {
      state.gameState = data.gameState;
    }

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
  const statusEl = document.getElementById('login-status');
  const continueBtn = document.getElementById('btn-continue');

  function setStatus(text) {
    if (statusEl) statusEl.textContent = text;
  }

  // Init Privy if credentials are available (env vars injected by Vite)
  const appId = import.meta.env.VITE_PRIVY_APP_ID;
  const clientId = import.meta.env.VITE_PRIVY_CLIENT_ID;
  const privyEnabled = !!(appId && clientId);

  if (privyEnabled) {
    await initPrivy(appId, clientId);
  } else {
    const twitterBtn = document.getElementById('btn-twitter-login');
    if (twitterBtn) twitterBtn.style.display = 'none';
  }

  // Check for OAuth callback (returning from Twitter redirect) — auto-login ONLY in this case
  if (privyEnabled) {
    try {
      const callbackUser = await handleOAuthCallback();
      if (callbackUser) {
        setStatus('Authenticating...');
        const result = await exchangeForBackendToken();
        if (result) return result;
      }
    } catch (e) {
      console.error('[Auth] OAuth callback failed:', e);
      setStatus('Twitter login failed: ' + (e.message || 'Unknown error'));
    }
  }

  // Probe for existing session — but DON'T auto-connect, just remember it
  let cachedSession = null;
  const existingToken = getToken();
  if (existingToken) {
    try {
      const res = await fetch(`${API_URL}/api/me`, {
        headers: { Authorization: `Bearer ${existingToken}` }
      });
      if (res.ok) {
        const user = await res.json();
        cachedSession = { token: existingToken, user };
      } else {
        localStorage.removeItem('game:token');
      }
    } catch {
      localStorage.removeItem('game:token');
    }
  }

  // If no cached backend session, try Privy session
  if (!cachedSession && privyEnabled) {
    try {
      const privyUser = await getPrivyUser();
      if (privyUser) {
        const result = await exchangeForBackendToken();
        if (result) cachedSession = result;
      }
    } catch (e) {
      console.warn('[Auth] Privy session check failed:', e);
    }
  }

  // Show "Continue" button if we have a cached session
  if (cachedSession && continueBtn) {
    const userName = cachedSession.user?.name || cachedSession.user?.twitterUsername || 'Player';
    continueBtn.textContent = `Continue as ${userName}`;
    continueBtn.style.display = 'block';
  }

  // ALWAYS show login screen and wait for user action
  setStatus('');
  document.getElementById('login-screen').style.display = 'flex';

  return new Promise((resolve) => {
    // Continue with cached session
    continueBtn?.addEventListener('click', () => {
      if (cachedSession) {
        document.getElementById('login-screen').style.display = 'none';
        resolve(cachedSession);
      }
    });

    // Twitter login
    document.getElementById('btn-twitter-login')?.addEventListener('click', async () => {
      setStatus('Redirecting to Twitter...');
      try {
        await loginWithTwitter();
      } catch (e) {
        console.error('[Auth] Twitter login failed:', e);
        setStatus('Login failed: ' + (e.message || 'Unknown error'));
      }
    });

    // Guest login
    document.getElementById('btn-guest').addEventListener('click', async () => {
      setStatus('Creating guest session...');
      const result = await loginAsGuest();
      if (result) {
        document.getElementById('login-screen').style.display = 'none';
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
      const res = await fetch(`${API_URL}/api/balance/${state.room.sessionId}`);
      const data = await res.json();
      if (balanceEl) balanceEl.textContent = `${data.balance} tokens`;
    } catch { /* silent */ }
  }
  updateBalance();
  setInterval(updateBalance, 10000);

  // Fetch bribe options
  fetch(`${API_URL}/api/bribe/options`)
    .then(r => r.json())
    .then(data => { bribeOptions = data.options; })
    .catch(() => {});

  btn.addEventListener('click', () => {
    if (document.pointerLockElement) document.exitPointerLock();
    if (!bribeOptions || !modal || !optionsList) return;

    optionsList.innerHTML = '';
    for (const [key, opt] of Object.entries(bribeOptions)) {
      const item = document.createElement('button');
      item.className = 'bribe-option';
      item.innerHTML = `<span class="bribe-opt-label">${opt.label}</span><span class="bribe-opt-cost">${opt.cost} tokens</span><span class="bribe-opt-desc">${opt.description}</span>`;
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

  async function submitBribe(bribeType) {
    if (!state.room?.sessionId) {
      showToast('Not connected to server', 'error');
      return;
    }

    let request = null;
    if (bribeType === 'custom') {
      request = prompt('What do you want the Magician to do?');
      if (!request || !request.trim()) return;
      request = request.trim();
    }

    modal.style.display = 'none';

    try {
      const res = await fetch(`${API_URL}/api/bribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          playerId: state.room.sessionId,
          bribeType,
          request
        })
      });
      const data = await res.json();
      if (data.success) {
        updateBalance();
        if (data.autoExecuted) {
          showToast('Bribe accepted! Effect applied.', 'success');
        } else {
          showToast('Bribe queued! The Magician will consider it...', 'warning');
        }
      } else if (data.error) {
        showToast(data.error, 'error');
      }
    } catch {
      showToast('Bribe failed. Try again.', 'error');
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
  const readyInd = document.getElementById('ready-indicator');
  if (readyInd) readyInd.style.display = 'none';

  // Show spectator-only overlay elements
  const overlay = document.getElementById('spectator-overlay');
  if (overlay) overlay.style.display = 'block';

  // Poll drama score
  setInterval(async () => {
    try {
      const res = await fetch(`${API_URL}/api/agent/drama`);
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
        fetch(`${API_URL}/api/ai/status`),
        fetch(`${API_URL}/api/agent/status`)
      ]);
      const aiData = await aiRes.json();
      const agentData = await agentRes.json();
      aiToggle.checked = aiData.enabled;
      agentToggle.checked = !agentData.paused;
      debugInfo.textContent = `AI: ${aiData.count} bots | Agent: ${agentData.phase} | Drama: ${agentData.drama}`;
    } catch { /* silent */ }
  }

  aiToggle.addEventListener('change', async () => {
    const endpoint = aiToggle.checked ? '/api/ai/enable' : '/api/ai/disable';
    await fetch(`${API_URL}${endpoint}`, { method: 'POST' });
    refreshStatus();
  });

  agentToggle.addEventListener('change', async () => {
    const endpoint = agentToggle.checked ? '/api/agent/resume' : '/api/agent/pause';
    await fetch(`${API_URL}${endpoint}`, { method: 'POST' });
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

  const user = authUser?.user;
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

function populateWalletPanel(user) {
  const isAuthenticated = user.type === 'authenticated';
  const twitter = getTwitterFields(user);

  // Header
  setAvatarSrc(document.getElementById('wp-pfp'), isAuthenticated ? twitter.avatar : null);
  document.getElementById('wp-display-name').textContent = user.name || twitter.username || 'Player';
  let usernameLabel = '';
  if (isAuthenticated && twitter.username) usernameLabel = `@${twitter.username}`;
  else if (user.type === 'guest') usernameLabel = 'Guest';
  document.getElementById('wp-username').textContent = usernameLabel;

  const walletSection = document.getElementById('wp-wallet-section');
  const guestMsg = document.getElementById('wp-guest-msg');
  const faucetBtn = document.getElementById('wp-faucet');

  // Logout is available for all user types
  document.getElementById('wp-logout').addEventListener('click', async () => {
    await logout();
    window.location.reload();
  });

  // Guest users see a login prompt instead of wallet details
  if (!isAuthenticated) {
    walletSection.style.display = 'none';
    faucetBtn.style.display = 'none';
    guestMsg.style.display = 'block';
    return;
  }

  // Authenticated user — show wallet section
  guestMsg.style.display = 'none';
  walletSection.style.display = 'block';
  faucetBtn.style.display = 'block';

  const userId = user.id;
  const addressEl = document.getElementById('wp-address');
  const balanceEl = document.getElementById('wp-balance');
  const copyBtn = document.getElementById('wp-copy');
  const explorerBtn = document.getElementById('wp-explorer');
  const explorerBase = 'https://testnet.monadexplorer.com/address';

  function displayAddress(addr) {
    addressEl.textContent = addr.slice(0, 6) + '...' + addr.slice(-4);
    addressEl.dataset.full = addr;
  }

  const existingAddr = user.walletAddress || user.wallet_address;
  if (existingAddr) {
    displayAddress(existingAddr);
  }

  async function refreshWallet() {
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
      const res = await fetch(`${API_URL}/api/balance/${state.room?.sessionId || userId}`);
      if (!res.ok) return;
      const data = await res.json();
      balanceEl.textContent = data.balance;
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

  faucetBtn.addEventListener('click', async () => {
    faucetBtn.disabled = true;
    faucetBtn.textContent = 'Requesting...';
    try {
      const token = getToken();
      const res = await fetch(`${API_URL}/api/tokens/faucet`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (res.ok) {
        showToast('Tokens received!');
        refreshBalance();
      } else {
        showToast(data.error || 'Faucet failed', 'error');
      }
    } catch {
      showToast('Faucet request failed', 'error');
    }
    faucetBtn.disabled = false;
    faucetBtn.textContent = 'Get Test Tokens';
  });
}

// ============================================
// Init
// ============================================
async function init() {
  console.log('[Game] Initializing...');

  if (isSpectator) {
    // Skip login for spectators
    authUser = { token: null, user: { name: 'Spectator', type: 'spectator' } };
  } else {
    authUser = await startAuthFlow();
  }
  await fetchInitialState();
  await connectToServer();
  if (!isSpectator) createPlayer();

  setupChat();
  fetchLeaderboard();
  if (isSpectator) setupSpectatorOverlay();
  else setupBribeUI();
  if (isDebug) setupDebugPanel();
  if (isMobile && !isSpectator) setupMobileControls();

  // Load existing chat history
  try {
    const chatResp = await fetch(`${API_URL}/api/chat/messages`);
    const chatData = await chatResp.json();
    for (const msg of chatData.messages) {
      displayChatMessage(msg);
    }
  } catch {
    // Chat history is non-critical
  }

  // Transition from login screen to game UI
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('ui').style.display = 'block';
  document.getElementById('controls').style.display = 'block';
  document.getElementById('chat-panel').style.display = 'flex';

  // Profile button & wallet panel
  setupProfileButton();

  animate();

  // Backup polling and periodic refreshes
  setInterval(pollForUpdates, 2000);
  setInterval(fetchLeaderboard, 10000);
  setInterval(() => {
    if (playerMesh && state.room) {
      sendToServer('move', {
        position: playerMesh.position.toArray(),
        velocity: playerVelocity.toArray()
      });
    }
  }, 100);

  console.log('[Game] Ready!');
}

init();
