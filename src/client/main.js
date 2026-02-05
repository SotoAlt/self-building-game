/**
 * Self-Building Game - Browser Client
 * Three.js + Colyseus for real-time multiplayer
 */

import * as THREE from 'three';
import { Client } from 'colyseus.js';

// ============================================
// Configuration
// ============================================
const SERVER_URL = 'ws://localhost:3000';
const API_URL = 'http://localhost:3000';

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
  chatFocused: false
};

// Remote players
const remotePlayers = new Map();

// Expose state for debugging
window.__gameState = state;

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

// ============================================
// Mouse Look Camera
// ============================================
let cameraYaw = 0;
let cameraPitch = 0.3; // slight downward angle
let cameraDistance = 20;
let pointerLocked = false;

const MIN_PITCH = -Math.PI / 6;  // -30 degrees
const MAX_PITCH = Math.PI / 3;    // 60 degrees
const MIN_DISTANCE = 8;
const MAX_DISTANCE = 40;

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

document.addEventListener('wheel', (e) => {
  cameraDistance += e.deltaY * 0.02;
  cameraDistance = Math.max(MIN_DISTANCE, Math.min(MAX_DISTANCE, cameraDistance));
});

function updateCamera() {
  if (!playerMesh) return;

  const target = playerMesh.position;

  // Spherical coordinates around player
  const offsetX = Math.sin(cameraYaw) * Math.cos(cameraPitch) * cameraDistance;
  const offsetY = Math.sin(cameraPitch) * cameraDistance;
  const offsetZ = Math.cos(cameraYaw) * Math.cos(cameraPitch) * cameraDistance;

  camera.position.set(
    target.x + offsetX,
    target.y + offsetY + 2,
    target.z + offsetZ
  );
  camera.lookAt(target.x, target.y + 1, target.z);
}

// Get camera-relative forward and right vectors (Y=0 plane)
function getCameraDirections() {
  const forward = new THREE.Vector3(-Math.sin(cameraYaw), 0, -Math.cos(cameraYaw)).normalize();
  const right = new THREE.Vector3(forward.z, 0, -forward.x);
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
    trigger: 0x9b59b6
  };
  return new THREE.Color(colors[type] || 0x95a5a6);
}

function createEntityMesh(entity) {
  let geometry;
  const color = getEntityColor(entity.type, entity.properties?.color);

  if (entity.type === 'collectible') {
    geometry = new THREE.SphereGeometry(0.5, 16, 16);
  } else {
    geometry = new THREE.BoxGeometry(...entity.size);
  }

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
    mesh.geometry = new THREE.BoxGeometry(...entity.size);
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
    mesh.geometry.dispose();
    mesh.material.dispose();
    entityMeshes.delete(id);
  }
  state.entities.delete(id);
  updateUI();
  console.log(`[Entity] Removed: ${id}`);
}

// ============================================
// Collision Detection (Wall-Slide)
// ============================================
const playerBox = new THREE.Box3();
const entityBox = new THREE.Box3();

let standingOnEntity = null; // Track what entity we're standing on

function checkCollisions() {
  if (!playerMesh) return;

  playerBox.setFromObject(playerMesh);

  let standingOnPlatform = false;
  let platformY = 0;
  let platformVelocity = null;
  standingOnEntity = null;

  for (const [, mesh] of entityMeshes) {
    const entity = mesh.userData.entity;
    if (!entity) continue;

    entityBox.setFromObject(mesh);

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
      const halfSize = entity.size.map(s => s / 2);
      const entityPos = mesh.position;

      // Calculate overlaps on each axis
      const overlapX = (0.5 + halfSize[0]) - Math.abs(playerMesh.position.x - entityPos.x);
      const overlapY = (1 + halfSize[1]) - Math.abs(playerMesh.position.y - entityPos.y);
      const overlapZ = (0.5 + halfSize[2]) - Math.abs(playerMesh.position.z - entityPos.z);

      if (overlapX <= 0 || overlapY <= 0 || overlapZ <= 0) continue;

      // Check if standing on top
      const playerBottom = playerMesh.position.y - 1;
      const platformTop = entityPos.y + halfSize[1];

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
          const pushDir = playerMesh.position.x > entityPos.x ? 1 : -1;
          playerMesh.position.x += overlapX * pushDir;
          playerVelocity.x = 0;
        } else {
          const pushDir = playerMesh.position.z > entityPos.z ? 1 : -1;
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

    // Carry player with moving platform
    if (platformVelocity) {
      playerMesh.position.x += platformVelocity.x;
      playerMesh.position.z += platformVelocity.z;
    }
  }
}

function collectItem(entity) {
  sendToServer('collect', { entityId: entity.id });
  removeEntity(entity.id);
  console.log(`[Collect] Picked up ${entity.id}`);
}

function playerDie() {
  if (!playerMesh || state.localPlayer?.state === 'dead') return;

  console.log('[Player] Died!');

  if (state.localPlayer) {
    state.localPlayer.state = 'dead';
  }

  sendToServer('died', { position: playerMesh.position.toArray() });

  playerMesh.material.color.setHex(0xff0000);
  playerMesh.material.emissive.setHex(0xff0000);

  setTimeout(respawnPlayer, 1500);
}

function respawnPlayer() {
  if (!playerMesh) return;

  playerMesh.position.set(0, 2, 0);
  playerVelocity.set(0, 0, 0);
  playerMesh.material.color.setHex(0x00ff88);
  playerMesh.material.emissive.setHex(0x00ff88);

  if (state.localPlayer) {
    state.localPlayer.state = 'alive';
  }

  sendToServer('respawn', {});
  console.log('[Player] Respawned');
}

function triggerEvent(entity) {
  console.log(`[Trigger] Activated: ${entity.id}`);
  sendToServer('trigger_activated', { entityId: entity.id });
}

// ============================================
// Player
// ============================================
let playerMesh = null;
const playerVelocity = new THREE.Vector3();
const keys = { w: false, a: false, s: false, d: false, space: false };
let isGrounded = true;

function createPlayer() {
  const geometry = new THREE.CapsuleGeometry(0.5, 1, 4, 8);
  const material = new THREE.MeshStandardMaterial({ color: 0x00ff88, emissive: 0x00ff88, emissiveIntensity: 0.2 });
  playerMesh = new THREE.Mesh(geometry, material);
  playerMesh.position.set(0, 2, 0);
  playerMesh.castShadow = true;
  scene.add(playerMesh);
}

function updatePlayer(delta) {
  if (!playerMesh) return;

  const speed = 15;
  const jumpForce = 12;

  // Camera-relative movement
  const { forward, right } = getCameraDirections();
  const moveDir = new THREE.Vector3();

  if (keys.w) moveDir.add(forward);
  if (keys.s) moveDir.sub(forward);
  if (keys.d) moveDir.add(right);
  if (keys.a) moveDir.sub(right);
  moveDir.normalize();

  playerVelocity.x = moveDir.x * speed;
  playerVelocity.z = moveDir.z * speed;

  // Gravity
  playerVelocity.y += state.physics.gravity * delta;

  // Jump
  if (keys.space && isGrounded) {
    playerVelocity.y = jumpForce;
    isGrounded = false;
  }

  // Apply velocity
  playerMesh.position.x += playerVelocity.x * delta;
  playerMesh.position.y += playerVelocity.y * delta;
  playerMesh.position.z += playerVelocity.z * delta;

  // Ground collision
  if (playerMesh.position.y < 1) {
    playerMesh.position.y = 1;
    playerVelocity.y = 0;
    isGrounded = true;
  }

  // Camera follow (orbit)
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
  if (key === ' ') { keys.space = true; e.preventDefault(); }

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
});

// ============================================
// Chat System
// ============================================
let lastChatMessageId = 0;

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
  sendToServer('chat', { text });
}

function displayChatMessage(msg) {
  const container = document.getElementById('chat-messages');
  if (!container) return;

  if (msg.id > lastChatMessageId) {
    lastChatMessageId = msg.id;
  }

  const div = document.createElement('div');
  div.className = `chat-msg ${msg.senderType}`;

  const sender = document.createElement('span');
  sender.className = 'sender';
  sender.textContent = `${msg.sender}:`;

  const textSpan = document.createElement('span');
  textSpan.className = 'text';

  // Highlight @agent mentions
  const textContent = msg.text.replace(/@agent/gi, (match) => {
    return `<span class="at-agent">${match}</span>`;
  });
  textSpan.innerHTML = textContent;

  div.appendChild(sender);
  div.appendChild(textSpan);
  container.appendChild(div);

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
  entries.innerHTML = leaderboard.map((entry, i) =>
    `<div class="lb-entry">
      <span class="lb-rank">${i + 1}.</span>
      <span class="lb-name">${entry.name}</span>
      <span class="lb-wins">${entry.wins}W</span>
    </div>`
  ).join('');
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
    emissiveIntensity: 0.2
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;

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
// Game State UI
// ============================================

function updateGameStateUI() {
  const statusEl = document.getElementById('game-status');
  const phaseEl = document.getElementById('game-phase');
  const typeEl = document.getElementById('game-type');
  const timerEl = document.getElementById('game-timer');

  if (state.gameState.phase === 'lobby') {
    statusEl.style.display = 'none';
    return;
  }

  statusEl.style.display = 'block';
  statusEl.className = state.gameState.phase;
  phaseEl.textContent = state.gameState.phase.toUpperCase();
  typeEl.textContent = state.gameState.gameType ? `Mode: ${state.gameState.gameType}` : '';

  if (state.gameState.phase === 'playing' && state.gameState.timeRemaining !== undefined) {
    const seconds = Math.ceil(state.gameState.timeRemaining / 1000);
    timerEl.textContent = `${seconds}s`;
    timerEl.style.color = seconds <= 10 ? '#e74c3c' : 'white';
  } else if (state.gameState.phase === 'countdown') {
    timerEl.textContent = '3...';
    timerEl.style.color = '#f39c12';
  } else {
    timerEl.textContent = '';
  }
}

// ============================================
// UI
// ============================================
function updateUI() {
  document.getElementById('entity-count').textContent = state.entities.size;
  document.getElementById('player-count').textContent = state.players.size + remotePlayers.size + 1;
  document.getElementById('physics-info').textContent = `g=${state.physics.gravity}`;

  const entitiesDiv = document.getElementById('entities');
  entitiesDiv.innerHTML = Array.from(state.entities.values())
    .map(e => `<div class="entity-item">${e.type}: ${e.id.slice(-8)}</div>`)
    .join('');

  updateGameStateUI();
}

// ============================================
// Network
// ============================================
async function fetchInitialState() {
  try {
    const response = await fetch(`${API_URL}/api/world/state`);
    const data = await response.json();

    state.physics = data.physics;

    for (const entity of data.entities) {
      addEntity(entity);
    }

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
    const room = await client.joinOrCreate('game', { name: `Player-${Date.now().toString(36)}` });

    state.room = room;
    state.connected = true;
    console.log('[Network] Connected to room:', room.roomId);

    room.onLeave((code) => {
      console.warn('[Network] Disconnected from room, code:', code);
      state.room = null;
      state.connected = false;
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

    room.onMessage('player_ready', ({ name, ready }) => {
      console.log(`[Event] ${name} is ${ready ? 'ready' : 'not ready'}`);
    });

    // Chat
    room.onMessage('chat_message', displayChatMessage);

    // Announcements
    room.onMessage('announcement', showAnnouncement);

    // Game state
    room.onMessage('game_state_changed', (gameState) => {
      console.log('[Event] Game state changed:', gameState.phase);
      state.gameState = gameState;
      updateGameStateUI();
      // Refresh leaderboard when game ends
      if (gameState.phase === 'ended') {
        setTimeout(fetchLeaderboard, 1000);
      }
    });

    // Init
    room.onMessage('init', (data) => {
      console.log('[Init] Received initial state from room');
      state.physics = data.worldState.physics;
      state.gameState = data.worldState.gameState || { phase: 'lobby' };
      for (const entity of data.worldState.entities) {
        addEntity(entity);
      }
      if (data.worldState.announcements) {
        for (const ann of data.worldState.announcements) {
          showAnnouncement(ann);
        }
      }
      updateUI();
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

  // Update player
  updatePlayer(delta);

  // Check collisions with entities
  checkCollisions();

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
// Init
// ============================================
async function init() {
  console.log('[Game] Initializing...');

  // Fetch initial state
  await fetchInitialState();

  // Connect to WebSocket
  await connectToServer();

  // Create player
  createPlayer();

  // Setup chat
  setupChat();

  // Fetch initial leaderboard
  fetchLeaderboard();

  // Fetch initial chat messages
  try {
    const chatResp = await fetch(`${API_URL}/api/chat/messages`);
    const chatData = await chatResp.json();
    for (const msg of chatData.messages) {
      displayChatMessage(msg);
    }
  } catch (e) { /* ok */ }

  // Hide loading, show UI
  document.getElementById('loading').style.display = 'none';
  document.getElementById('ui').style.display = 'block';
  document.getElementById('controls').style.display = 'block';
  document.getElementById('chat-panel').style.display = 'flex';

  // Start animation
  animate();

  // Poll for updates every 2 seconds (backup)
  setInterval(pollForUpdates, 2000);

  // Refresh leaderboard periodically
  setInterval(fetchLeaderboard, 10000);

  // Backup position sync
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
