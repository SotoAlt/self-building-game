/**
 * Self-Building Game - Browser Client
 * Three.js + Colyseus for real-time multiplayer
 */

import './styles/game.css';
import './styles/mobile.css';
import * as THREE from 'three';
import { createGroundToonMaterial, setMaterialTheme } from './ToonMaterials.js';
import { initPostProcessing, renderFrame, resizePostProcessing, updateOutlineObjects } from './PostProcessing.js';
import { createLavaShaderMaterial, createWaterShaderMaterial, registerShaderMaterial, updateShaderTime, updateConveyorScrolls } from './SurfaceShaders.js';
import { updateSquashStretch } from './PlayerVisuals.js';
import { initEntityManager, addEntity, updateEntity, removeEntity, clearAllEntities, animateEntities, animateGroups } from './entities/EntityManager.js';
import { initPhysics, updatePlayer, checkCollisions, createPlayer } from './physics/PhysicsEngine.js';
import { initRemotePlayers, updateRemotePlayer, removeRemotePlayer, showChatBubble, updateChatBubbles, interpolateRemotePlayers } from './rendering/RemotePlayers.js';
import { createSkyDome, updateSkyColors, initParticles, updateEnvironmentEffects, selectParticleType } from './EnvironmentEffects.js';
import { Client } from 'colyseus.js';
import {
  initPrivy, handleOAuthCallback, exchangeForBackendToken, ensureEmbeddedWallet,
  loginAsGuest, loginWithTwitter, getPrivyUser, getToken, debugAuth, logout,
  getEmbeddedWalletProvider, getEmbeddedWalletAddress, exportWallet
} from './auth.js';
import {
  TREASURY_ADDRESS, SERVER_URL, API_URL, urlParams, isSpectator, isDebug,
  selectedArenaId, setSelectedArenaId, getApiBase, isMobile,
  MAX_RECONNECT_ATTEMPTS, MAX_VISIBLE_ANNOUNCEMENTS
} from './config.js';
import {
  state, auth, remotePlayers, network, floor, hazardPlaneState,
  entityMeshes, groupParents, particles,
  player, playerVelocity,
  camera as cameraState,
  afk, countdown
} from './state.js';
import {
  playCollectSound, playCountdownBeep,
  playWinFanfare, playSpellSound, playCrackSound, playBreakSound
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

initPostProcessing(renderer, scene, camera);

initScreenEffects(scene);

initEntityManager(scene, updateUI);

const cameraController = new CameraController(camera, renderer);
cameraController.initDesktopEvents();

initPhysics({
  scene,
  sendToServer,
  getCameraDirections: () => cameraController.getCameraDirections(),
  updateCamera: () => cameraController.updateCamera(),
});

initRemotePlayers(scene);

// Lava floor plane (hidden by default)
const lavaGeometry = new THREE.PlaneGeometry(200, 200, 40, 40);
const lavaMaterial = createLavaShaderMaterial();
registerShaderMaterial(lavaMaterial);
const lavaFloor = new THREE.Mesh(lavaGeometry, lavaMaterial);
lavaFloor.rotation.x = -Math.PI / 2;
lavaFloor.position.y = -0.5;
lavaFloor.visible = false;
scene.add(lavaFloor);

// Rising hazard plane (lava/water)
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

  if (env.materialTheme !== undefined) setMaterialTheme(env.materialTheme);

  const pType = selectParticleType(floor.currentType, env);
  initParticles(scene, pType);

  console.log('[Environment] Updated');
}

function isInSpectatorMode() { return cameraController.isInSpectatorMode(); }
function clearSpectating() { cameraController.clearSpectating(); }

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
      clearAllEntities();
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

  interpolateRemotePlayers();
  animateGroups(delta);
  animateEntities(delta, time);

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
