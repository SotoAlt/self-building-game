/**
 * Client mutable state — shared across all client modules.
 * Primitives grouped into objects so mutations propagate across module boundaries.
 * Objects/Maps exported directly — property mutations work fine.
 */

import * as THREE from 'three';
import { isMobile } from './config.js';

// Core game state
export const state = {
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

// Auth state (mutable via .user property)
export const auth = { user: null };

// Remote player meshes
export const remotePlayers = new Map();

// Network timing
export const network = {
  lastMoveTime: 0,
  reconnectAttempts: 0,
};

// Floor & hazard state
export const floor = {
  currentType: 'solid',
};

export const hazardPlaneState = { active: false, type: 'lava', height: -10 };

// Entity rendering maps
export const entityMeshes = new Map();
export const groupParents = new Map();   // groupId -> THREE.Group
export const pendingGroups = new Map();   // groupId -> debounce timeout ID
export const entityToGroup = new Map();   // entityId -> groupId

// Particle system
export const particles = [];

// Speed boost
export const boost = { speedBoostUntil: 0 };

// Collision tracking
export const collision = {
  standingOnEntity: null,
  frameDelta: 0.016,
};

// Death state
export const death = {
  lastDeathTime: 0,
  respawnInvulnUntil: 0,
};

// Activated triggers
export const activatedTriggers = new Map(); // entityId -> timestamp

// Player state
export const player = {
  mesh: null,
  isGrounded: true,
  coyoteTimer: 0,
  jumpBufferTimer: 0,
  isJumping: false,
  jumpHeld: false,
};
export const playerVelocity = new THREE.Vector3();

// Camera state
export const camera = {
  yaw: 0,
  pitch: 0.3,  // slight downward angle
  distance: isMobile ? 25 : 20,
  pointerLocked: false,
};

// Spectator state
export const spectator = {
  dragging: false,
  followIndex: -1, // -1 = auto, 0+ = specific player
  freeMode: false,
};
export const spectatorPos = new THREE.Vector3(0, 20, 0);

// Camera shake
export const cameraShake = { intensity: 0, duration: 0, startTime: 0, offset: new THREE.Vector3() };

// AFK UI state
export const afk = {
  overlay: null,
  countdownInterval: null,
};

// Countdown UI state
export const countdown = {
  intervalId: null,
  lastLobbyTick: 0,
};
