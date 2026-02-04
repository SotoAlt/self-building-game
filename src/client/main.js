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
  room: null
};

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

  // Send position to server
  if (state.room) {
    state.room.send('move', {
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
// UI
// ============================================
function updateUI() {
  document.getElementById('entity-count').textContent = state.entities.size;
  document.getElementById('player-count').textContent = state.players.size + 1;
  document.getElementById('physics-info').textContent = `g=${state.physics.gravity}`;

  const entitiesDiv = document.getElementById('entities');
  entitiesDiv.innerHTML = Array.from(state.entities.values())
    .map(e => `<div class="entity-item">${e.type}: ${e.id.slice(-8)}</div>`)
    .join('');
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
    console.log('[Network] Connected to room:', room.roomId);

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
      updateUI();
    });

    room.onMessage('player_left', ({ id }) => {
      state.players.delete(id);
      updateUI();
    });

    room.onMessage('init', (data) => {
      console.log('[Init] Received initial state from room');
      state.physics = data.worldState.physics;
      for (const entity of data.worldState.entities) {
        addEntity(entity);
      }
      updateUI();
    });

    return true;
  } catch (error) {
    console.error('[Network] Connection failed:', error);
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

  console.log('[Game] Ready!');
}

init();
