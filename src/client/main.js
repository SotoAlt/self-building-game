/**
 * Self-Building Game - Browser Client
 * Three.js + Colyseus for real-time multiplayer
 */

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

const TREASURY_ADDRESS = import.meta.env.VITE_TREASURY_ADDRESS || '';

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

// Arena selection — defaults to 'chaos', updated after lobby
let selectedArenaId = urlParams.get('arena') || 'chaos';
// API base path — scoped to selected arena
function getApiBase() {
  if (selectedArenaId === 'chaos') return `${API_URL}/api`;
  return `${API_URL}/api/arenas/${selectedArenaId}`;
}

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
  chatFocused: false,
  activeEffects: [],
  respawnPoint: [0, 2, 0],
  isSpectating: false,
  lobbyCountdownTarget: null,
  lobbyReadyAt: null,
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

function shortAngleDist(from, to) {
  let diff = to - from;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return diff;
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
let hazardPlaneState = { active: false, type: 'lava', height: -10 };

function updateHazardPlaneMaterial(type) {
  const newMat = type === 'water' ? createWaterShaderMaterial() : createLavaShaderMaterial();
  registerShaderMaterial(newMat);
  hazardPlaneMesh.material = newMat;
  hazardPlaneMat = newMat;
}

// Current floor type tracked on client
let currentFloorType = 'solid';

function setFloorType(type) {
  currentFloorType = type;
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
  const pType = selectParticleType(currentFloorType, env);
  initParticles(scene, pType);

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

// Desktop: pointer lock for camera (players only)
let spectatorDragging = false;
if (!isMobile) {
  renderer.domElement.addEventListener('click', () => {
    if (!state.chatFocused && !isInSpectatorMode()) {
      renderer.domElement.requestPointerLock();
    }
  });

  document.addEventListener('pointerlockchange', () => {
    pointerLocked = document.pointerLockElement === renderer.domElement;
    const crosshair = document.getElementById('crosshair');
    if (crosshair) crosshair.style.display = pointerLocked ? 'block' : 'none';
  });

  document.addEventListener('mousemove', (e) => {
    if (pointerLocked) {
      cameraYaw -= e.movementX * 0.003;
      cameraPitch -= e.movementY * 0.003;
      cameraPitch = Math.max(MIN_PITCH, Math.min(MAX_PITCH, cameraPitch));
    } else if (spectatorDragging && isInSpectatorMode()) {
      cameraYaw -= e.movementX * 0.003;
      cameraPitch -= e.movementY * 0.003;
      cameraPitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, cameraPitch));
    }
  });

  // Mouse drag for spectator camera
  renderer.domElement.addEventListener('mousedown', (e) => {
    if (isInSpectatorMode() && e.button === 0) {
      spectatorDragging = true;
    }
  });
  document.addEventListener('mouseup', () => {
    spectatorDragging = false;
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
      <button id="btn-lb-mobile" class="mobile-btn lb-btn">LB</button>
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
    .lb-btn { background: rgba(155, 89, 182, 0.4); border-color: #9b59b6; width: 50px !important; height: 50px !important; font-size: 10px !important; }
    #chat-toggle-btn { display: none; }
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
      #leaderboard-panel { width: 90vw; max-width: 320px; }
      #bribe-panel { bottom: 10px; right: auto; left: 50%; transform: translateX(-50%); }
      .bribe-btn { padding: 8px 16px; font-size: 12px; }
      .announcement { font-size: 14px; padding: 10px 20px; }
      #announcements { top: 100px; }
      #chat-toggle-btn {
        display: block;
        position: fixed; bottom: 10px; left: 10px;
        width: 44px; height: 44px;
        border-radius: 50%;
        background: rgba(0,0,0,0.6);
        border: 2px solid rgba(255,255,255,0.3);
        color: white; font-size: 10px; font-weight: bold;
        z-index: 350; touch-action: manipulation;
        -webkit-user-select: none; user-select: none;
      }
    }
    /* Landscape mobile layout */
    @media (orientation: landscape) and (max-height: 500px) {
      #joystick-zone { width: 35vw; height: 70vh; }
      #mobile-buttons {
        flex-direction: row !important;
        bottom: 15px !important;
        right: 15px !important;
      }
      .mobile-btn { width: 60px !important; height: 60px !important; font-size: 10px !important; }
      #game-status { padding: 6px 12px !important; min-width: 80px !important; top: 8px !important; }
      #game-timer { font-size: 18px !important; }
      #game-phase { font-size: 10px !important; }
      #leaderboard-panel { width: 85vw !important; max-width: 300px !important; font-size: 12px !important; }
      #ui { max-width: 150px !important; padding: 6px !important; font-size: 10px !important; }
      #ui h1 { font-size: 12px !important; }
      #chat-panel {
        width: 240px !important; max-height: 150px !important;
        bottom: 80px !important; left: 10px !important;
      }
      #chat-messages { max-height: 100px !important; }
      #announcements { top: 70px !important; }
      .announcement { font-size: 12px !important; padding: 6px 14px !important; }
      #bribe-panel { bottom: 80px !important; }
      #chat-toggle-btn { bottom: 80px !important; left: 10px !important; }
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

  // Leaderboard toggle button (mobile)
  const lbBtn = document.getElementById('btn-lb-mobile');
  if (lbBtn) {
    lbBtn.addEventListener('touchstart', (e) => {
      e.preventDefault();
      const panel = document.getElementById('leaderboard-panel');
      if (!panel) return;
      const isVisible = panel.style.display === 'block';
      panel.style.display = isVisible ? 'none' : 'block';
      lbBtn.classList.toggle('pressed', !isVisible);
      if (!isVisible) fetchLeaderboard();
    }, { passive: false });
  }

  // Attempt orientation lock
  if (screen.orientation?.lock) {
    screen.orientation.lock('landscape').catch(() => {});
  }

  // Collapsible chat toggle
  const chatToggle = document.createElement('button');
  chatToggle.id = 'chat-toggle-btn';
  chatToggle.textContent = 'CHAT';
  document.body.appendChild(chatToggle);
  const chatPanel = document.getElementById('chat-panel');
  let chatVisible = true;
  chatToggle.addEventListener('touchstart', (e) => {
    e.preventDefault();
    chatVisible = !chatVisible;
    if (chatPanel) chatPanel.style.display = chatVisible ? 'flex' : 'none';
    chatToggle.style.borderColor = chatVisible ? '#2ecc71' : 'rgba(255,255,255,0.3)';
  }, { passive: false });

  // Virtual keyboard handling — move chat up when input focused in landscape
  const chatInput = document.getElementById('chat-input');
  if (chatInput && chatPanel) {
    chatInput.addEventListener('focus', () => {
      if (window.innerHeight < 500) {
        chatPanel.style.bottom = '50%';
      }
    });
    chatInput.addEventListener('blur', () => {
      chatPanel.style.bottom = '';
    });
  }
}

// ============================================
// Spectator Camera
// ============================================
function isInSpectatorMode() {
  return isSpectator || state.isSpectating;
}

function clearSpectating() {
  state.isSpectating = false;
  const banner = document.getElementById('spectator-banner');
  if (banner) banner.remove();
}

let spectatorFollowIndex = -1; // -1 = auto, 0+ = specific player
let spectatorFreeMode = false;
const spectatorPos = new THREE.Vector3(0, 20, 0);
const SPEC_FLY_SPEED = 30;
const SPEC_FAST_SPEED = 60;

function updateCamera() {
  if (isInSpectatorMode()) {
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
  // Free-fly mode: camera at spectatorPos, looking in yaw/pitch direction
  if (spectatorFreeMode) {
    camera.position.copy(spectatorPos);
    const lookTarget = new THREE.Vector3(
      spectatorPos.x - Math.sin(cameraYaw) * Math.cos(cameraPitch),
      spectatorPos.y - Math.sin(cameraPitch),
      spectatorPos.z - Math.cos(cameraYaw) * Math.cos(cameraPitch)
    );
    camera.lookAt(lookTarget);
    return;
  }

  // Follow target player using mouse-controlled yaw/pitch (no auto-rotation)
  const allPlayers = Array.from(remotePlayers.entries());

  if (allPlayers.length === 0) {
    // No players: static elevated view of the world center
    const dist = 40;
    const elevAngle = cameraPitch + 0.3;
    const y = dist * Math.sin(elevAngle);
    const horiz = dist * Math.cos(elevAngle);
    camera.position.set(
      Math.sin(cameraYaw) * horiz,
      y,
      Math.cos(cameraYaw) * horiz
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
    const dist = 25;
    const elevAngle = cameraPitch + 0.3; // slight overhead offset
    const y = targetMesh.position.y + dist * Math.sin(elevAngle);
    const horiz = dist * Math.cos(elevAngle);
    camera.position.set(
      targetMesh.position.x + Math.sin(cameraYaw) * horiz,
      y,
      targetMesh.position.z + Math.cos(cameraYaw) * horiz
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

function updateSpectatorMovement(delta) {
  if (!spectatorFreeMode) return;
  const speed = keys.shift ? SPEC_FAST_SPEED : SPEC_FLY_SPEED;
  // Pitch-aware forward (fly in look direction)
  const forward = new THREE.Vector3(
    -Math.sin(cameraYaw) * Math.cos(cameraPitch),
    -Math.sin(cameraPitch),
    -Math.cos(cameraYaw) * Math.cos(cameraPitch)
  ).normalize();
  const right = new THREE.Vector3(-forward.z, 0, forward.x).normalize();
  const move = new THREE.Vector3();
  if (keys.w) move.add(forward);
  if (keys.s) move.sub(forward);
  if (keys.a) move.sub(right);
  if (keys.d) move.add(right);
  if (keys.space) move.y += 1;
  if (keys.shift && !keys.w && !keys.s && !keys.a && !keys.d) move.y -= 1;
  if (move.lengthSq() > 0) {
    move.normalize().multiplyScalar(speed * delta);
    spectatorPos.add(move);
  }
}

// ============================================
// Entity Rendering
// ============================================
const entityMeshes = new Map();

const groupParents = new Map();   // groupId -> THREE.Group
const pendingGroups = new Map();  // groupId -> debounce timeout ID
const entityToGroup = new Map();  // entityId -> groupId

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

function playCrackSound() {
  playSound(() => {
    const { osc, gain, t } = createTone('sawtooth');
    osc.frequency.setValueAtTime(400, t);
    osc.frequency.exponentialRampToValueAtTime(200, t + 0.15);
    gain.gain.setValueAtTime(0.08, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    osc.start(t);
    osc.stop(t + 0.15);
  });
}

function playBreakSound() {
  playSound(() => {
    const { osc, gain, t } = createTone('square');
    osc.frequency.setValueAtTime(200, t);
    osc.frequency.exponentialRampToValueAtTime(60, t + 0.2);
    gain.gain.setValueAtTime(0.1, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    osc.start(t);
    osc.stop(t + 0.25);
  });
}

function playBounceSound() {
  playSound(() => {
    const notes = [300, 600, 800];
    notes.forEach((freq, i) => {
      const { osc, gain, t } = createTone('sine');
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.12, t + i * 0.06);
      gain.gain.exponentialRampToValueAtTime(0.001, t + i * 0.06 + 0.15);
      osc.start(t + i * 0.06);
      osc.stop(t + i * 0.06 + 0.15);
    });
  });
}

// Speed boost state
let speedBoostUntil = 0;

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
let frameDelta = 0.016; // Updated each frame for conveyor/wind calculations

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

    const isGrouped = mesh.parent && mesh.parent !== scene;
    const ep = isGrouped
      ? { x: mesh.parent.position.x + mesh.position.x,
          y: mesh.parent.position.y + mesh.position.y,
          z: mesh.parent.position.z + mesh.position.z }
      : mesh.position;
    const halfSize = entity.type === 'collectible'
      ? [0.5, 0.5, 0.5]
      : entity.size.map(s => s / 2);
    entityBox.min.set(ep.x - halfSize[0], ep.y - halfSize[1], ep.z - halfSize[2]);
    entityBox.max.set(ep.x + halfSize[0], ep.y + halfSize[1], ep.z + halfSize[2]);

    if (!playerBox.intersectsBox(entityBox)) continue;

    if (entity.type === 'collectible') {
      collectItem(entity);
      continue;
    }
    if (entity.type === 'obstacle') {
      if (state.gameState.phase === 'playing') {
        playerDie();
      }
      continue;
    }
    if (entity.type === 'trigger') {
      if (entity.properties?.isBounce) {
        const force = entity.properties.bounceForce || 18;
        playerVelocity.y = force;
        isGrounded = false;
        isJumping = true;
        spawnParticles(playerMesh.position, '#2ecc71', 15, 4);
        playBounceSound();
        continue;
      }
      if (entity.properties?.isSpeedBoost) {
        const duration = entity.properties.boostDuration || 3000;
        speedBoostUntil = Date.now() + duration;
        spawnParticles(playerMesh.position, '#e67e22', 8, 2);
        continue;
      }
      if (entity.properties?.isWind) {
        const force = entity.properties.windForce || [0, 0, 0];
        const dt = frameDelta;
        playerVelocity.x += force[0] * dt;
        playerVelocity.y += force[1] * dt;
        playerVelocity.z += force[2] * dt;
        continue;
      }
      triggerEvent(entity);
      continue;
    }

    if (entity.type === 'platform' || entity.type === 'ramp') {
      const overlapX = (0.5 + halfSize[0]) - Math.abs(playerMesh.position.x - ep.x);
      const overlapY = (1 + halfSize[1]) - Math.abs(playerMesh.position.y - ep.y);
      const overlapZ = (0.5 + halfSize[2]) - Math.abs(playerMesh.position.z - ep.z);

      if (overlapX <= 0 || overlapY <= 0 || overlapZ <= 0) continue;

      const playerBottom = playerMesh.position.y - 1;
      const platformTop = ep.y + halfSize[1];

      if (playerBottom >= platformTop - 0.5 && playerVelocity.y <= 0) {
        standingOnPlatform = true;
        platformY = platformTop + 1;
        standingOnEntity = entity;

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

  if (standingOnPlatform) {
    playerMesh.position.y = platformY;
    playerVelocity.y = 0;
    isGrounded = true;
    isJumping = false;

    if (platformVelocity) {
      playerMesh.position.x += platformVelocity.x;
      playerMesh.position.z += platformVelocity.z;
    }
    // Conveyor belt push
    if (standingOnEntity?.properties?.isConveyor) {
      const dir = standingOnEntity.properties.conveyorDir || [1, 0, 0];
      const speed = standingOnEntity.properties.conveyorSpeed || 6;
      playerVelocity.x += dir[0] * speed * frameDelta;
      playerVelocity.z += dir[2] * speed * frameDelta;
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

function createPlayer() {
  playerMesh = createPlayerCharacter();
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
  frameDelta = delta; // expose for conveyor/wind in checkCollisions

  // --- Spell modifiers ---
  let targetSpeed = keys.shift ? PHYSICS.SPRINT_SPEED : PHYSICS.WALK_SPEED;
  let jumpForce = PHYSICS.JUMP_FORCE;
  let spellGravityMult = 1;

  if (hasEffect('speed_boost')) targetSpeed = 30;
  if (hasEffect('slow_motion')) targetSpeed = 10;
  if (Date.now() < speedBoostUntil) targetSpeed *= 2;
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

  const onIce = standingOnEntity?.properties?.isIce;

  let accel;
  if (!isGrounded) {
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

  // --- Face movement direction ---
  const hSpeed = Math.sqrt(playerVelocity.x ** 2 + playerVelocity.z ** 2);
  if (hSpeed > 0.5) {
    const targetYaw = Math.atan2(playerVelocity.x, playerVelocity.z);
    playerMesh.rotation.y += shortAngleDist(playerMesh.rotation.y, targetYaw) * Math.min(1, 15 * delta);
  }

  // Reset before this frame's collision detection
  isGrounded = false;

  // --- Ground collision ---
  const phase = state.gameState.phase;
  const inSafePhase = phase === 'lobby' || phase === 'building' || phase === 'countdown' || phase === 'ended';
  const invulnerable = Date.now() < respawnInvulnUntil;
  // All floors act solid during safe phases so players don't fall through
  const hasFloor = currentFloorType === 'solid' || inSafePhase;

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
  // Hazard plane death (rising lava/water)
  if (hazardPlaneState.active && phase === 'playing' && playerMesh.position.y < hazardPlaneState.height && !invulnerable) {
    spawnParticles(playerMesh.position, hazardPlaneState.type === 'lava' ? '#ff4500' : '#3498db', 20, 6);
    playerDie();
  }
  // Void death (Y < -50) stays always active as ultimate safety net
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

/** Toggle the help overlay. Pass true to show, false to hide, or omit to flip.
 *  Returns true if the overlay was open (and is now closed). */
function toggleHelpOverlay(forceShow) {
  const el = document.getElementById('help-overlay');
  if (!el) return false;
  const isVisible = el.style.display !== 'none';
  if (forceShow === false) {
    if (!isVisible) return false;
    el.style.display = 'none';
    return true;
  }
  el.style.display = (forceShow === true || !isVisible) ? 'flex' : 'none';
  return false;
}

document.addEventListener('keydown', (e) => {
  // Don't process game keys when chat is focused
  if (state.chatFocused) {
    if (e.key === 'Escape') {
      document.getElementById('chat-input').blur();
      state.chatFocused = false;
    }
    return;
  }

  // Escape closes help overlay
  if (e.key === 'Escape') {
    if (toggleHelpOverlay(false)) return;
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

  // Spectator: WASD activates free-fly mode, number keys return to follow mode
  if (isInSpectatorMode() && (key === 'w' || key === 'a' || key === 's' || key === 'd')) {
    if (!spectatorFreeMode) {
      spectatorFreeMode = true;
      spectatorPos.copy(camera.position);
    }
  }
  if (isInSpectatorMode() && key >= '0' && key <= '9') {
    spectatorFreeMode = false;
    spectatorFollowIndex = key === '0' ? -1 : parseInt(key) - 1;
  }

  // ? to toggle help overlay
  if (e.key === '?' || (e.key === '/' && e.shiftKey)) {
    toggleHelpOverlay();
  }

  // L to toggle leaderboard
  if (key === 'l') {
    const panel = document.getElementById('leaderboard-panel');
    if (!panel) return;

    const isVisible = panel.style.display === 'block';
    panel.style.display = isVisible ? 'none' : 'block';

    if (!isVisible) {
      fetchLeaderboard();
    }
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
  const mesh = isLocalPlayer ? playerMesh : remotePlayers.get(senderId);
  if (!mesh) return;

  const existing = mesh.children.find(c => c.userData.isChatBubble);
  if (existing) disposeBubbleSprite(mesh, existing);

  mesh.add(createChatBubbleSprite(text));
}

function updateChatBubbles() {
  const now = Date.now();
  const meshes = [playerMesh, ...remotePlayers.values()];
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
let _afkOverlay = null;
let _afkCountdownInterval = null;

function showAfkWarning(token, timeout) {
  hideAfkWarning();

  _afkOverlay = document.createElement('div');
  _afkOverlay.id = 'afk-overlay';
  _afkOverlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.85);display:flex;flex-direction:column;align-items:center;justify-content:center;';

  const title = document.createElement('div');
  title.style.cssText = 'color:#ff6b6b;font-size:32px;font-weight:bold;margin-bottom:16px;text-shadow:0 0 20px rgba(255,107,107,0.5);';
  title.textContent = 'ARE YOU STILL THERE?';

  const countdown = document.createElement('div');
  countdown.style.cssText = 'color:#fff;font-size:20px;margin-bottom:24px;';
  let remaining = Math.ceil(timeout / 1000);
  countdown.textContent = `You'll be kicked in ${remaining}s...`;
  _afkCountdownInterval = setInterval(() => {
    remaining--;
    if (remaining <= 0) {
      clearInterval(_afkCountdownInterval);
      countdown.textContent = 'Kicking...';
    } else {
      countdown.textContent = `You'll be kicked in ${remaining}s...`;
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

  _afkOverlay.appendChild(title);
  _afkOverlay.appendChild(countdown);
  _afkOverlay.appendChild(btn);
  document.body.appendChild(_afkOverlay);

  // Any keypress also dismisses (hideAfkWarning cleans up this listener)
  const keyHandler = () => {
    if (state.room) state.room.send('afk_heartbeat', { token });
    hideAfkWarning();
  };
  document.addEventListener('keydown', keyHandler);
  _afkOverlay._keyHandler = keyHandler;
}

function hideAfkWarning() {
  if (_afkCountdownInterval) {
    clearInterval(_afkCountdownInterval);
    _afkCountdownInterval = null;
  }
  if (_afkOverlay) {
    if (_afkOverlay._keyHandler) {
      document.removeEventListener('keydown', _afkOverlay._keyHandler);
    }
    _afkOverlay.remove();
    _afkOverlay = null;
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

const MAX_VISIBLE_ANNOUNCEMENTS = 3;

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

// Tracked so we can clear it if a new countdown starts or the phase changes
let countdownIntervalId = null;
let lastLobbyCountdownTick = 0;

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
  if (worldData.hazardPlane) {
    hazardPlaneState = { ...hazardPlaneState, ...worldData.hazardPlane };
    hazardPlaneMesh.visible = hazardPlaneState.active;
    hazardPlaneMesh.position.y = hazardPlaneState.height;
    updateHazardPlaneMaterial(hazardPlaneState.type);
  }
  if (worldData.players) {
    for (const player of worldData.players) {
      if (state.room && player.id === state.room.sessionId) continue;
      state.players.set(player.id, player);
      updateRemotePlayer(player);
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
    const user = authUser?.user;
    const playerName = user?.twitterUsername || user?.name || `Player-${Date.now().toString(36)}`;
    const joinOptions = { name: playerName, arenaId: selectedArenaId };

    if (authUser?.token) {
      joinOptions.token = authUser.token;
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
      let player = state.players.get(id);
      if (!player) {
        player = { id, position };
        state.players.set(id, player);
      }
      player.position = position;
      updateRemotePlayer(player);
    });

    room.onMessage('player_died', (data) => {
      const player = state.players.get(data.id);
      const name = player?.name || data.id?.slice(0, 8) || 'Player';
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

    room.onMessage('hazard_plane_changed', (data) => {
      hazardPlaneState = { ...hazardPlaneState, ...data };
      hazardPlaneMesh.visible = data.active;
      hazardPlaneMesh.position.y = hazardPlaneState.height;
      updateHazardPlaneMaterial(data.type);
    });

    room.onMessage('hazard_plane_update', (data) => {
      hazardPlaneState = { ...hazardPlaneState, ...data };
      hazardPlaneMesh.position.y = data.height;
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
      // Clear group tracking
      for (const group of groupParents.values()) scene.remove(group);
      groupParents.clear();
      entityToGroup.clear();
      for (const tid of pendingGroups.values()) clearTimeout(tid);
      pendingGroups.clear();
      // Reset hazard plane
      hazardPlaneMesh.visible = false;
      hazardPlaneState = { active: false, type: 'lava', height: -10 };
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
    updateSpectatorMovement(delta);
  } else {
    updatePlayer(delta);
    checkCollisions();
  }

  if (playerMesh && !isInSpectatorMode()) {
    updateSquashStretch(playerMesh, playerVelocity.y, isGrounded);
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
  updateOutlineObjects(entityMeshes, groupParents, playerMesh, remotePlayers);
  updateChatBubbles();

  if (isInSpectatorMode()) updateCamera();

  // Tick lobby countdown display (~1Hz)
  if (state.gameState.phase === 'lobby' && state.lobbyCountdownTarget) {
    if (time - lastLobbyCountdownTick > 1) {
      lastLobbyCountdownTick = time;
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
    cameraDistance = (window.innerWidth > window.innerHeight) ? 22 : 25;
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
    document.getElementById('login-screen').style.display = 'none';
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
    if (authUser?.user?.type === 'guest') {
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
      lobby.style.display = 'none';
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
    authUser = { token: null, user: { name: 'Spectator', type: 'spectator' } };
  } else {
    authUser = await startAuthFlow();
  }

  // Arena selection — skip if arena is specified via URL param
  if (!urlParams.get('arena') && !isSpectator) {
    selectedArenaId = await showArenaLobby();
  }
  console.log(`[Game] Selected arena: ${selectedArenaId}`);

  await fetchInitialState();
  await connectToServer();
  if (!isSpectator) {
    createPlayer();
  } else {
    const badge = document.createElement('div');
    badge.id = 'spectator-badge';
    badge.style.cssText = 'position:fixed;top:16px;left:50%;transform:translateX(-50%);background:rgba(243,156,18,0.9);color:#000;padding:8px 24px;border-radius:20px;font-size:14px;font-weight:bold;z-index:1000;pointer-events:none;letter-spacing:2px;';
    badge.textContent = 'SPECTATING';
    document.body.appendChild(badge);
  }

  setupChat();
  fetchLeaderboard();
  if (isSpectator) setupSpectatorOverlay();
  else setupBribeUI();
  if (isDebug) setupDebugPanel();
  if (isMobile && !isSpectator) setupMobileControls();

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
  document.getElementById('login-screen').style.display = 'none';
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
