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
  connected: false
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
  } else if (entity.type === 'ramp') {
    geometry = new THREE.BoxGeometry(...entity.size);
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

  mesh.position.set(...entity.position);
  if (entity.size) {
    mesh.geometry.dispose();
    mesh.geometry = new THREE.BoxGeometry(...entity.size);
  }
  if (entity.properties?.color) {
    mesh.material.color.set(entity.properties.color);
    mesh.material.emissive.set(entity.properties.color);
  }
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
// Collision Detection
// ============================================
const playerBox = new THREE.Box3();
const entityBox = new THREE.Box3();
const collisionResponse = new THREE.Vector3();

function checkCollisions() {
  if (!playerMesh) return;

  // Update player bounding box
  playerBox.setFromObject(playerMesh);

  let standingOnPlatform = false;
  let platformY = 0;

  for (const [id, mesh] of entityMeshes) {
    const entity = mesh.userData.entity;
    if (!entity) continue;

    // Update entity bounding box
    entityBox.setFromObject(mesh);

    if (playerBox.intersectsBox(entityBox)) {
      handleCollision(entity, mesh, entityBox);

      // Check if standing on platform
      if (entity.type === 'platform' || entity.type === 'ramp') {
        const playerBottom = playerMesh.position.y - 1; // Player capsule bottom
        const platformTop = mesh.position.y + (entity.size[1] / 2);

        // If player is above platform and falling
        if (playerBottom >= platformTop - 0.5 && playerVelocity.y <= 0) {
          standingOnPlatform = true;
          platformY = platformTop + 1; // +1 for player capsule height
        }
      }
    }
  }

  // Resolve platform standing
  if (standingOnPlatform) {
    playerMesh.position.y = platformY;
    playerVelocity.y = 0;
    isGrounded = true;
  }
}

function handleCollision(entity, mesh, box) {
  switch (entity.type) {
    case 'platform':
    case 'ramp':
      // Handled in checkCollisions for vertical resolution
      break;

    case 'collectible':
      collectItem(entity);
      break;

    case 'obstacle':
      playerDie();
      break;

    case 'trigger':
      triggerEvent(entity);
      break;
  }
}

function collectItem(entity) {
  // Notify server
  sendToServer('collect', { entityId: entity.id });

  // Remove from local state immediately for responsive feel
  removeEntity(entity.id);

  console.log(`[Collect] Picked up ${entity.id}`);
}

function playerDie() {
  if (!playerMesh || state.localPlayer?.state === 'dead') return;

  console.log('[Player] Died!');

  if (state.localPlayer) {
    state.localPlayer.state = 'dead';
  }

  // Notify server
  sendToServer('died', {
    position: playerMesh.position.toArray()
  });

  // Visual feedback - turn red briefly
  playerMesh.material.color.setHex(0xff0000);
  playerMesh.material.emissive.setHex(0xff0000);

  // Respawn after delay
  setTimeout(() => {
    respawnPlayer();
  }, 1500);
}

function respawnPlayer() {
  if (!playerMesh) return;

  // Reset position
  playerMesh.position.set(0, 2, 0);
  playerVelocity.set(0, 0, 0);

  // Reset color
  playerMesh.material.color.setHex(0x00ff88);
  playerMesh.material.emissive.setHex(0x00ff88);

  if (state.localPlayer) {
    state.localPlayer.state = 'alive';
  }

  // Notify server
  sendToServer('respawn', {});

  console.log('[Player] Respawned');
}

function triggerEvent(entity) {
  // Triggers can activate challenges, teleport, etc.
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

  // Input
  const direction = new THREE.Vector3();
  if (keys.w) direction.z -= 1;
  if (keys.s) direction.z += 1;
  if (keys.a) direction.x -= 1;
  if (keys.d) direction.x += 1;
  direction.normalize();

  // Apply movement
  playerVelocity.x = direction.x * speed;
  playerVelocity.z = direction.z * speed;

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

  // Camera follow
  camera.position.x = playerMesh.position.x;
  camera.position.y = playerMesh.position.y + 10;
  camera.position.z = playerMesh.position.z + 20;
  camera.lookAt(playerMesh.position);

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
  const key = e.key.toLowerCase();
  if (key in keys) keys[key] = true;
  if (key === ' ') keys.space = true;
});

document.addEventListener('keyup', (e) => {
  const key = e.key.toLowerCase();
  if (key in keys) keys[key] = false;
  if (key === ' ') keys.space = false;
});

// ============================================
// Remote Player Rendering
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
    mesh.position.set(...player.position);
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

  // Check if already showing this announcement
  if (state.announcements.has(announcement.id)) return;

  const div = document.createElement('div');
  div.className = `announcement ${announcement.type || 'agent'}`;
  div.textContent = announcement.text;
  div.id = `ann-${announcement.id}`;
  container.appendChild(div);

  state.announcements.set(announcement.id, true);

  // Schedule removal
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

  // Update timer
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

    // Add all existing entities
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
    console.log('[Network] Room send test - connection alive');

    // Handle disconnection
    room.onLeave((code) => {
      console.warn('[Network] Disconnected from room, code:', code);
      state.room = null;
      state.connected = false;
      if (code !== 1000) { // Not a clean close
        setTimeout(attemptReconnect, 1000);
      }
    });

    room.onError((code, message) => {
      console.error('[Network] Room error:', code, message);
    });

    // Handle events from server
    room.onMessage('entity_spawned', (entity) => {
      console.log('[Event] Entity spawned:', entity.id);
      addEntity(entity);
    });

    room.onMessage('entity_modified', (entity) => {
      console.log('[Event] Entity modified:', entity.id);
      updateEntity(entity);
    });

    room.onMessage('entity_destroyed', ({ id }) => {
      console.log('[Event] Entity destroyed:', id);
      removeEntity(id);
    });

    room.onMessage('physics_changed', (physics) => {
      console.log('[Event] Physics changed:', physics);
      state.physics = physics;
      updateUI();
    });

    room.onMessage('player_joined', (player) => {
      console.log('[Event] Player joined:', player.name);
      state.players.set(player.id, player);
      updateRemotePlayer(player);
      updateUI();
    });

    room.onMessage('player_left', ({ id, name }) => {
      state.players.delete(id);
      removeRemotePlayer(id);
      updateUI();
      console.log('[Event] Player left:', name || id);
    });

    room.onMessage('player_moved', ({ id, position, velocity }) => {
      if (id === room.sessionId) return; // Ignore self
      const player = state.players.get(id) || { id, position };
      player.position = position;
      updateRemotePlayer(player);
    });

    room.onMessage('announcement', (announcement) => {
      showAnnouncement(announcement);
    });

    room.onMessage('game_state_changed', (gameState) => {
      console.log('[Event] Game state changed:', gameState.phase);
      state.gameState = gameState;
      updateGameStateUI();
    });

    room.onMessage('init', (data) => {
      console.log('[Init] Received initial state from room');
      state.physics = data.worldState.physics;
      state.gameState = data.worldState.gameState || { phase: 'lobby' };
      for (const entity of data.worldState.entities) {
        addEntity(entity);
      }
      // Show any existing announcements
      if (data.worldState.announcements) {
        for (const ann of data.worldState.announcements) {
          showAnnouncement(ann);
        }
      }
      updateUI();
    });

    state.connected = true;
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

  // Rotate entities
  for (const [id, mesh] of entityMeshes) {
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

    // Update physics
    state.physics = data.physics;

    // Update game state
    if (data.gameState) {
      state.gameState = data.gameState;
    }

    // Sync entities
    const serverIds = new Set(data.entities.map(e => e.id));

    // Add/update entities
    for (const entity of data.entities) {
      if (!entityMeshes.has(entity.id)) {
        addEntity(entity);
      } else {
        updateEntity(entity);
      }
    }

    // Remove deleted entities
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

  // Hide loading, show UI
  document.getElementById('loading').style.display = 'none';
  document.getElementById('ui').style.display = 'block';
  document.getElementById('controls').style.display = 'block';

  // Start animation
  animate();

  // Poll for updates every 2 seconds (backup)
  setInterval(pollForUpdates, 2000);

  // Backup position sync (independent of animation loop)
  setInterval(() => {
    if (playerMesh && state.room) {
      try {
        state.room.send('move', {
          position: playerMesh.position.toArray(),
          velocity: playerVelocity.toArray()
        });
      } catch (e) {
        // silent
      }
    }
  }, 100);

  console.log('[Game] Ready!');
}

init();
