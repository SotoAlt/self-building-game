/**
 * Self-Building Game — browser client entry point.
 * Three.js + Colyseus for real-time multiplayer.
 */

import './styles/game.css';
import './styles/mobile.css';
import * as THREE from 'three';

import { renderFrame, resizePostProcessing, updateOutlineObjects } from './PostProcessing.js';
import { updateShaderTime, updateConveyorScrolls } from './SurfaceShaders.js';
import { updateSquashStretch } from './PlayerVisuals.js';
import { initEntityManager, animateEntities, animateGroups } from './entities/EntityManager.js';
import { initPhysics, updatePlayer, checkCollisions, createPlayer } from './physics/PhysicsEngine.js';
import { initRemotePlayers, updateChatBubbles, interpolateRemotePlayers } from './rendering/RemotePlayers.js';
import { initParticles, updateEnvironmentEffects } from './EnvironmentEffects.js';
import { initNetworkManager, sendToServer } from './network/NetworkManager.js';
import { initFloorManager, animateFloors } from './scene/FloorManager.js';
import { fetchInitialState, pollForUpdates } from './network/HttpApi.js';
import { debugAuth } from './auth.js';
import {
  urlParams, isSpectator, isDebug,
  selectedArenaId, setSelectedArenaId, getApiBase, isMobile
} from './config.js';
import {
  state, auth, remotePlayers,
  entityMeshes, groupParents,
  player, playerVelocity,
  camera as cameraState,
  countdown
} from './state.js';
import { updateParticles } from './vfx/ScreenEffects.js';
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
import { createScene } from './SceneSetup.js';
import { initConnectionManager, connectToServer, reconnectToServer } from './ConnectionManager.js';

window.__gameState = state;
window.debugAuth = debugAuth;

const { scene, camera, renderer, ground, gridHelper, ambientLight, directionalLight } = createScene();

const cameraController = new CameraController(camera, renderer);
cameraController.initDesktopEvents();

initEntityManager(scene, updateUI);
initPhysics({
  scene,
  sendToServer,
  getCameraDirections: () => cameraController.getCameraDirections(),
  updateCamera: () => cameraController.updateCamera(),
});
initRemotePlayers(scene);
initConnectionManager({ clearSpectating: () => cameraController.clearSpectating() });
initNetworkManager({ connectToServerFn: connectToServer, reconnectToServerFn: reconnectToServer });
initFloorManager({ scene, ground, gridHelper, ambientLight, directionalLight });

const isInSpectatorMode = () => cameraController.isInSpectatorMode();
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

  await fetch(`${getApiBase()}/chat/messages`)
    .then(r => r.json())
    .then(data => data.messages.forEach(displayChatMessage))
    .catch(() => {});

  const loginEl = document.getElementById('login-screen');
  loginEl.classList.add('screen-fade-out');
  setTimeout(() => { loginEl.style.display = 'none'; loginEl.classList.remove('screen-fade-out'); }, 300);

  if (isDebug) document.getElementById('ui').style.display = 'block';
  document.getElementById('controls').style.display = 'block';
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
