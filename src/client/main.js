/**
 * Self-Building Game - Browser Client
 * Three.js + Colyseus for real-time multiplayer
 */

import './styles/game.css';
import './styles/mobile.css';
import * as THREE from 'three';
import { createGroundToonMaterial } from './ToonMaterials.js';
import { initPostProcessing, renderFrame, resizePostProcessing, updateOutlineObjects } from './PostProcessing.js';
import { updateShaderTime, updateConveyorScrolls } from './SurfaceShaders.js';
import { updateSquashStretch } from './PlayerVisuals.js';
import { initEntityManager, animateEntities, animateGroups } from './entities/EntityManager.js';
import { initPhysics, updatePlayer, checkCollisions, createPlayer } from './physics/PhysicsEngine.js';
import { initRemotePlayers, updateChatBubbles, interpolateRemotePlayers } from './rendering/RemotePlayers.js';
import { createSkyDome, initParticles, updateEnvironmentEffects } from './EnvironmentEffects.js';
import { initNetworkManager, sendToServer, storeReconnectionToken } from './network/NetworkManager.js';
import { initFloorManager, animateFloors } from './scene/FloorManager.js';
import { registerMessageHandlers } from './network/MessageHandlers.js';
import { fetchInitialState, pollForUpdates } from './network/HttpApi.js';
import { Client } from 'colyseus.js';
import { debugAuth } from './auth.js';
import {
  SERVER_URL, urlParams, isSpectator, isDebug,
  selectedArenaId, setSelectedArenaId, getApiBase, isMobile
} from './config.js';
import {
  state, auth, remotePlayers,
  entityMeshes, groupParents,
  player, playerVelocity,
  camera as cameraState,
  countdown
} from './state.js';
import { updateParticles, initScreenEffects } from './vfx/ScreenEffects.js';
import { hideReconnectOverlay } from './ui/Announcements.js';
import { setupChat, displayChatMessage } from './ui/ChatSystem.js';
import { updateUI, updateGameStateUI } from './ui/GameStatusHUD.js';
import { fetchLeaderboard } from './ui/Leaderboard.js';
import { showArenaLobby } from './ui/ArenaLobby.js';
import { startAuthFlow } from './ui/AuthFlow.js';
import { setupBribeUI } from './ui/BribePanel.js';
import { setupProfileButton } from './ui/ProfilePanel.js';
import { setupSpectatorOverlay } from './ui/SpectatorOverlay.js';
import { setupDebugPanel } from './ui/DebugPanel.js';
import { CameraController } from './CameraController.js';
import { keys, setupKeyboardInput, toggleHelpOverlay } from './input/InputManager.js';
import { setupMobileControls } from './input/MobileControls.js';

window.__gameState = state;
window.debugAuth = debugAuth;

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

const groundGeometry = new THREE.PlaneGeometry(200, 200, 50, 50);
const groundMaterial = createGroundToonMaterial();
const ground = new THREE.Mesh(groundGeometry, groundMaterial);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const gridHelper = new THREE.GridHelper(200, 50, 0x555555, 0x444444);
scene.add(gridHelper);

createSkyDome(scene);

initPostProcessing(renderer, scene, camera, directionalLight);

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

initNetworkManager({ connectToServerFn: connectToServer, reconnectToServerFn: reconnectToServer });
initFloorManager({ scene, ground, gridHelper, ambientLight, directionalLight });
const messageDeps = { clearSpectating: () => cameraController.clearSpectating() };

function isInSpectatorMode() { return cameraController.isInSpectatorMode(); }

async function reconnectToServer(token) {
  const client = new Client(SERVER_URL);
  const room = await client.reconnect(token);
  state.room = room;
  state.connected = true;
  storeReconnectionToken();
  hideReconnectOverlay();
  console.log('[Network] Reconnected to room:', room.roomId);
  registerMessageHandlers(room, messageDeps);
  return true;
}

async function connectToServer() {
  try {
    const client = new Client(SERVER_URL);
    const user = auth.user?.user;
    const playerName = user?.twitterUsername || user?.name || `Player-${Date.now().toString(36)}`;
    const joinOptions = { name: playerName, arenaId: selectedArenaId };
    if (auth.user?.token) joinOptions.token = auth.user.token;
    if (user?.type) joinOptions.type = user.type;

    const room = await client.joinOrCreate('game', joinOptions);
    state.room = room;
    state.connected = true;
    storeReconnectionToken();
    hideReconnectOverlay();
    console.log('[Network] Connected to room:', room.roomId);
    registerMessageHandlers(room, messageDeps);
    return true;
  } catch (error) {
    console.error('[Network] Connection failed:', error);
    state.connected = false;
    return false;
  }
}

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

  interpolateRemotePlayers(delta);
  animateGroups(delta);
  animateEntities(delta, time);

  animateFloors(time);

  updateShaderTime(time);
  updateConveyorScrolls(delta);
  updateEnvironmentEffects(delta, camera.position);
  updateParticles(delta);
  updateOutlineObjects(entityMeshes, groupParents, player.mesh, remotePlayers);
  updateChatBubbles();

  if (isInSpectatorMode()) cameraController.updateCamera();

  if (state.gameState.phase === 'lobby' && state.lobbyCountdownTarget) {
    if (time - countdown.lastLobbyTick > 1) {
      countdown.lastLobbyTick = time;
      updateGameStateUI();
    }
  }

  renderFrame();
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  resizePostProcessing(window.innerWidth, window.innerHeight);
  if (isMobile) {
    cameraState.distance = (window.innerWidth > window.innerHeight) ? 22 : 25;
  }
});

async function init() {
  console.log('[Game] Initializing...');

  if (isSpectator) {
    auth.user = { token: null, user: { name: 'Spectator', type: 'spectator' } };
  } else {
    auth.user = await startAuthFlow();
  }

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

  try {
    const chatResp = await fetch(`${getApiBase()}/chat/messages`);
    const chatData = await chatResp.json();
    for (const msg of chatData.messages) {
      displayChatMessage(msg);
    }
  } catch { /* non-critical */ }

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
  document.getElementById('help-overlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) toggleHelpOverlay(false);
  });

  setupProfileButton();
  initParticles(scene, 'dust');

  animate();

  setInterval(() => { if (!state.connected) pollForUpdates(); }, 10000);
  setInterval(fetchLeaderboard, 10000);

  console.log('[Game] Ready!');
}

init();
