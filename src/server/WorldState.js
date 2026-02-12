/**
 * WorldState - Manages all game world data
 *
 * This is the source of truth for entities, physics, challenges, and players.
 * Shared between HTTP API and Colyseus game room.
 */

import { randomUUID } from 'crypto';
import { updateLeaderboard, loadLeaderboard } from './db.js';

export class WorldState {
  static DEFAULT_PHYSICS = { gravity: -9.8, friction: 0.3, bounce: 0.5 };

  static DEFAULT_ENVIRONMENT = {
    skyColor: '#1a1a2e',
    fogColor: '#1a1a2e',
    fogNear: 50,
    fogFar: 200,
    fogDensity: 0.012,
    ambientColor: '#404040',
    ambientIntensity: 0.5,
    sunColor: '#ffffff',
    sunIntensity: 1.0,
    sunPosition: [50, 100, 50],
    skyPreset: null,
    materialTheme: null,
  };

  constructor() {
    this.physics = { ...WorldState.DEFAULT_PHYSICS };
    this.entities = new Map();
    this.challenges = new Map();
    this.players = new Map();

    this.statistics = {
      totalEntitiesCreated: 0,
      totalChallengesCreated: 0,
      totalChallengesCompleted: 0
    };

    this.announcements = [];

    // Chat messages (keep last 50)
    this.messages = [];
    this._messageIdCounter = 0;

    // Leaderboard: playerId -> { name, wins, totalScore }
    this.leaderboard = new Map();

    this.activeEffects = [];

    // Breaking platforms: entityId → { breakAt, regenDelay, originalEntity }
    this.breakingPlatforms = new Map();

    // Pacing cooldowns
    this.lastSpellCastTime = 0;
    this.lastTemplateLoadTime = 0;

    // Event log
    this.events = [];
    this._eventIdCounter = 0;

    // Respawn point (agent-configurable)
    this.respawnPoint = [0, 2, 0];

    // Floor type: 'solid', 'none' (abyss), 'lava'
    this.floorType = 'solid';

    this.environment = { ...WorldState.DEFAULT_ENVIRONMENT };

    // Rising hazard plane (lava/water that rises during gameplay)
    this.hazardPlane = { active: false, type: 'lava', height: -10, startHeight: -10, riseSpeed: 0.5, maxHeight: 50 };

    // Lobby pacing — minimum time before games/templates allowed
    this.lobbyEnteredAt = Date.now();

    // Auto-start countdown target (absolute timestamp, null = not scheduled)
    this.autoStartTargetTime = null;

    // Game history for variety enforcement — last 8 { type, template, timestamp }
    this.gameHistory = [];
    this.lastTemplate = null;

    // Game state machine
    this.gameState = {
      phase: 'lobby', // lobby, building, countdown, playing, ended
      currentGame: null,
      gameType: null,
      startTime: null,
      timeLimit: null,
      cooldownUntil: 0,
      winners: [],
      losers: []
    };
  }

  // ============================================
  // Entity Management
  // ============================================

  spawnEntity(type, position, size = [1, 1, 1], properties = {}) {
    const validTypes = ['platform', 'ramp', 'collectible', 'obstacle', 'trigger', 'decoration'];
    if (!validTypes.includes(type)) {
      throw new Error(`Invalid entity type: ${type}`);
    }

    const id = `${type}-${randomUUID().slice(0, 8)}`;
    const entity = {
      id,
      type,
      position: [...position],
      size: [...size],
      properties: {
        color: properties.color || this.getDefaultColor(type),
        kinematic: properties.kinematic ?? false,
        rotating: properties.rotating ?? false,
        speed: properties.speed ?? 1,
        ...properties
      },
      createdAt: Date.now()
    };

    this.entities.set(id, entity);
    this.statistics.totalEntitiesCreated++;

    console.log(`[WorldState] Spawned ${type} at [${position.join(', ')}] → ${id}`);
    return entity;
  }

  modifyEntity(id, changes) {
    const entity = this.entities.get(id);
    if (!entity) {
      throw new Error(`Entity not found: ${id}`);
    }

    if (changes.position) {
      entity.position = [...changes.position];
    }
    if (changes.size) {
      entity.size = [...changes.size];
    }
    if (changes.properties) {
      entity.properties = { ...entity.properties, ...changes.properties };
    }

    entity.modifiedAt = Date.now();
    console.log(`[WorldState] Modified ${id}`);
    return entity;
  }

  destroyEntity(id) {
    if (!this.entities.has(id)) {
      throw new Error(`Entity not found: ${id}`);
    }

    this.entities.delete(id);
    console.log(`[WorldState] Destroyed ${id}`);
  }

  clearEntities() {
    const ids = [...this.entities.keys()];
    this.entities.clear();
    this.breakingPlatforms.clear();
    this.physics = { ...WorldState.DEFAULT_PHYSICS };
    this.floorType = 'solid';
    this.environment = { ...WorldState.DEFAULT_ENVIRONMENT };
    this.deactivateHazardPlane();
    this.clearEffects();
    console.log(`[WorldState] Cleared ${ids.length} entities`);
    return ids;
  }

  // ============================================
  // Breakable Platforms
  // ============================================

  startBreaking(entityId) {
    if (this.breakingPlatforms.has(entityId)) return false;

    const entity = this.entities.get(entityId);
    if (!entity || !entity.properties?.breakable) return false;

    const breakDelay = entity.properties.breakDelay || 500;
    const regenDelay = entity.properties.regenDelay || 0; // 0 = no regen

    this.breakingPlatforms.set(entityId, {
      breakAt: Date.now() + breakDelay,
      regenDelay,
      originalEntity: {
        type: entity.type,
        position: [...entity.position],
        size: [...entity.size],
        properties: { ...entity.properties },
      },
    });

    return true;
  }

  processBreakingPlatforms(broadcastFn) {
    const now = Date.now();

    for (const [entityId, info] of this.breakingPlatforms) {
      if (now >= info.breakAt && this.entities.has(entityId)) {
        // Destroy the platform
        this.entities.delete(entityId);
        broadcastFn('entity_destroyed', { id: entityId });
        console.log(`[WorldState] Breakable platform destroyed: ${entityId}`);

        // Schedule regen if configured
        if (info.regenDelay > 0) {
          const orig = info.originalEntity;
          setTimeout(() => {
            try {
              const reborn = this.spawnEntity(orig.type, orig.position, orig.size, orig.properties);
              broadcastFn('entity_spawned', reborn);
              console.log(`[WorldState] Platform regenerated: ${reborn.id}`);
            } catch { /* entity limit or world cleared */ }
          }, info.regenDelay);
        }

        this.breakingPlatforms.delete(entityId);
      }
    }
  }

  // ============================================
  // Group Operations (Prefabs)
  // ============================================

  getEntitiesByGroup(groupId) {
    return Array.from(this.entities.values()).filter(
      e => e.properties?.groupId === groupId
    );
  }

  destroyGroup(groupId) {
    const ids = [];
    for (const [id, entity] of this.entities) {
      if (entity.properties?.groupId !== groupId) continue;
      ids.push(id);
      this.entities.delete(id);
    }
    console.log(`[WorldState] Destroyed group ${groupId} (${ids.length} entities)`);
    return ids;
  }

  setFloorType(type) {
    const valid = ['solid', 'none', 'lava'];
    if (!valid.includes(type)) {
      throw new Error(`Invalid floor type: ${type}. Must be one of: ${valid.join(', ')}`);
    }
    this.floorType = type;
    console.log(`[WorldState] Floor type set to: ${type}`);
    return this.floorType;
  }

  setEnvironment(changes) {
    const colorKeys = ['skyColor', 'fogColor', 'ambientColor', 'sunColor'];
    const numberKeys = ['fogNear', 'fogFar', 'fogDensity', 'ambientIntensity', 'sunIntensity'];
    const stringKeys = ['skyPreset', 'materialTheme'];

    for (const key of colorKeys) {
      if (changes[key] !== undefined) {
        if (typeof changes[key] !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(changes[key])) {
          throw new Error(`Invalid color for ${key}: must be hex like #rrggbb`);
        }
        this.environment[key] = changes[key];
      }
    }

    for (const key of numberKeys) {
      if (changes[key] !== undefined) {
        if (typeof changes[key] !== 'number') {
          throw new Error(`Invalid value for ${key}: must be a number`);
        }
        this.environment[key] = changes[key];
      }
    }

    for (const key of stringKeys) {
      if (changes[key] !== undefined) {
        this.environment[key] = changes[key] || null;
      }
    }

    if (changes.sunPosition !== undefined) {
      if (!Array.isArray(changes.sunPosition) || changes.sunPosition.length !== 3) {
        throw new Error('sunPosition must be [x, y, z]');
      }
      this.environment.sunPosition = [...changes.sunPosition];
    }

    console.log(`[WorldState] Environment updated`);
    return { ...this.environment };
  }

  setHazardPlane({ active, type, startHeight, riseSpeed, maxHeight }) {
    if (active !== undefined) {
      this.hazardPlane.active = !!active;
    }
    if (type === 'lava' || type === 'water') {
      this.hazardPlane.type = type;
    }
    if (typeof startHeight === 'number') {
      this.hazardPlane.startHeight = startHeight;
      this.hazardPlane.height = startHeight;
    }
    if (typeof riseSpeed === 'number') {
      this.hazardPlane.riseSpeed = Math.max(0.1, Math.min(5, riseSpeed));
    }
    if (typeof maxHeight === 'number') {
      this.hazardPlane.maxHeight = Math.max(this.hazardPlane.startHeight, Math.min(100, maxHeight));
    }

    console.log(`[WorldState] Hazard plane: active=${this.hazardPlane.active}, type=${this.hazardPlane.type}, height=${this.hazardPlane.height}`);
    return { ...this.hazardPlane };
  }

  updateHazardPlane(delta) {
    if (!this.hazardPlane.active || this.gameState.phase !== 'playing') return null;

    this.hazardPlane.height += this.hazardPlane.riseSpeed * delta;
    this.hazardPlane.height = Math.min(this.hazardPlane.height, this.hazardPlane.maxHeight);

    return { ...this.hazardPlane };
  }

  deactivateHazardPlane() {
    this.hazardPlane.active = false;
    this.hazardPlane.height = this.hazardPlane.startHeight;
  }

  setLastTemplate(name) {
    this.lastTemplate = name;
  }

  setRespawnPoint(position) {
    this.respawnPoint = [...position];
    console.log(`[WorldState] Respawn point set to [${position.join(', ')}]`);
    return this.respawnPoint;
  }

  _notifyPhaseChange() {
    if (typeof this.onPhaseChange === 'function') {
      this.onPhaseChange(this.getGameState());
    }
  }

  getDefaultColor(type) {
    const colors = {
      platform: '#3498db',
      ramp: '#2ecc71',
      collectible: '#f1c40f',
      obstacle: '#e74c3c',
      trigger: '#9b59b6',
      decoration: '#95a5a6'
    };
    return colors[type] || '#95a5a6';
  }

  // ============================================
  // Physics Management
  // ============================================

  setPhysics({ gravity, friction, bounce }) {
    if (gravity !== undefined) {
      if (gravity < -20 || gravity > 0) {
        throw new Error('Gravity must be between -20 and 0');
      }
      this.physics.gravity = gravity;
    }

    if (friction !== undefined) {
      if (friction < 0 || friction > 1) {
        throw new Error('Friction must be between 0 and 1');
      }
      this.physics.friction = friction;
    }

    if (bounce !== undefined) {
      if (bounce < 0 || bounce > 2) {
        throw new Error('Bounce must be between 0 and 2');
      }
      this.physics.bounce = bounce;
    }

    console.log(`[WorldState] Physics updated: gravity=${this.physics.gravity}, friction=${this.physics.friction}, bounce=${this.physics.bounce}`);
    return { ...this.physics };
  }

  // ============================================
  // Player Management
  // ============================================

  addPlayer(id, name, type = 'human', initialState = 'alive', userId = null) {
    const player = {
      id,
      name,
      type, // 'human' or 'ai'
      userId: userId || id,
      position: [...this.respawnPoint],
      velocity: [0, 0, 0],
      state: initialState,
      joinedAt: Date.now(),
      lastActivity: Date.now(),
      activityAnchor: [...this.respawnPoint],
      afkWarningToken: null,
      afkWarningSentAt: null,
    };

    // Reset lobby timer when first human joins an empty lobby
    if (type === 'human' && this.gameState.phase === 'lobby') {
      const existingHumans = Array.from(this.players.values()).filter(p => p.type === 'human').length;
      if (existingHumans === 0) {
        this.lobbyEnteredAt = Date.now();
      }
    }

    this.players.set(id, player);
    console.log(`[WorldState] Player joined: ${name} (${type}, ${initialState})`);
    if (typeof this.onPlayerJoin === 'function') this.onPlayerJoin(player);
    return player;
  }

  activateSpectators() {
    let activated = 0;
    for (const player of this.players.values()) {
      if (player.state === 'spectating' && player.type !== 'spectator') {
        player.state = 'alive';
        activated++;
      }
    }
    if (activated > 0) {
      console.log(`[WorldState] Activated ${activated} spectating players`);
    }
    return activated;
  }

  updatePlayer(id, updates) {
    const player = this.players.get(id);
    if (!player) return null;

    if (updates.position) {
      player.position = [...updates.position];

      // Check displacement from anchor for AFK detection (>5 units = real movement)
      const [ax, ay, az] = player.activityAnchor;
      const [px, py, pz] = player.position;
      const dist = Math.sqrt((px - ax) ** 2 + (py - ay) ** 2 + (pz - az) ** 2);
      if (dist > 5) {
        this._markActive(player);
      }
    }
    if (updates.velocity) player.velocity = [...updates.velocity];
    if (updates.state) player.state = updates.state;

    return player;
  }

  removePlayer(id) {
    const player = this.players.get(id);
    if (player) {
      this.players.delete(id);
      console.log(`[WorldState] Player left: ${player.name}`);
    }
  }

  recordPlayerActivity(id) {
    const player = this.players.get(id);
    if (!player) return;
    this._markActive(player);
  }

  _markActive(player) {
    player.lastActivity = Date.now();
    player.activityAnchor = [...player.position];
    if (player.state === 'afk_warned') {
      player.state = 'alive';
      player.afkWarningToken = null;
      player.afkWarningSentAt = null;
    }
  }

  getActiveHumanCount() {
    let count = 0;
    for (const p of this.players.values()) {
      if (p.type !== 'ai' && p.type !== 'spectator' && p.state !== 'afk_warned') count++;
    }
    return count;
  }

  getPlayers() {
    return Array.from(this.players.values());
  }

  // ============================================
  // Challenge Management
  // ============================================

  createChallenge(type, target, description, reward = 100) {
    const validTypes = ['reach', 'collect', 'survive', 'time_trial'];
    if (!validTypes.includes(type)) {
      throw new Error(`Invalid challenge type: ${type}`);
    }

    const id = `challenge-${randomUUID().slice(0, 8)}`;
    const challenge = {
      id,
      type,
      target,
      description: description || this.getDefaultDescription(type, target),
      reward,
      attempts: 0,
      successes: 0,
      active: true,
      createdAt: Date.now()
    };

    this.challenges.set(id, challenge);
    this.statistics.totalChallengesCreated++;

    console.log(`[WorldState] Challenge created: ${description || type}`);
    return challenge;
  }

  completeChallenge(id, playerId) {
    const challenge = this.challenges.get(id);
    if (!challenge) return null;

    challenge.successes++;
    this.statistics.totalChallengesCompleted++;

    console.log(`[WorldState] Challenge completed: ${id} by ${playerId}`);
    return challenge;
  }

  recordChallengeAttempt(id) {
    const challenge = this.challenges.get(id);
    if (challenge) {
      challenge.attempts++;
    }
  }

  getChallenges() {
    return Array.from(this.challenges.values()).filter(c => c.active);
  }

  getDefaultDescription(type, target) {
    const descriptions = {
      reach: `Reach ${target || 'the target'}`,
      collect: `Collect ${target || 'all items'}`,
      survive: `Survive for ${target || '30'} seconds`,
      time_trial: `Complete in under ${target || '60'} seconds`
    };
    return descriptions[type];
  }

  // ============================================
  // Announcements
  // ============================================

  announce(text, type = 'agent', duration = 5000) {
    const id = `ann-${randomUUID().slice(0, 8)}`;
    const announcement = {
      id,
      text,
      type, // 'agent', 'system', 'challenge', 'player'
      duration,
      timestamp: Date.now()
    };

    this.announcements.push(announcement);
    console.log(`[WorldState] Announcement (${type}): ${text}`);
    return announcement;
  }

  getAnnouncements() {
    // Clean old announcements
    const now = Date.now();
    this.announcements = this.announcements.filter(
      a => now - a.timestamp < a.duration + 1000
    );
    return [...this.announcements];
  }

  clearAnnouncements() {
    this.announcements = [];
  }

  // ============================================
  // Game State Machine
  // ============================================

  startGame(gameType, config = {}) {
    // Cancel any pending lobby reset from a previous game
    clearTimeout(this._lobbyResetTimer);

    const validTypes = ['reach', 'collect', 'survival', 'king', 'hot_potato', 'race'];
    if (!validTypes.includes(gameType)) {
      throw new Error(`Invalid game type: ${gameType}`);
    }

    const gameId = `game-${randomUUID().slice(0, 8)}`;
    const timeLimit = config.timeLimit || 60000;

    this.gameState = {
      phase: 'countdown',
      currentGame: gameId,
      gameType,
      startTime: Date.now(),
      timeLimit,
      cooldownUntil: 0,
      targetEntity: config.targetEntity || null,
      winners: [],
      losers: []
    };

    // Transition to playing after countdown
    this._countdownTimer = setTimeout(() => {
      if (this.gameState.currentGame === gameId && this.gameState.phase === 'countdown') {
        this.gameState.phase = 'playing';
        this.gameState.startTime = Date.now();
        console.log(`[WorldState] Game started: ${gameType}`);

        this._notifyPhaseChange();
      }
    }, config.countdownTime || 5000);

    console.log(`[WorldState] Game countdown: ${gameType} (${timeLimit}ms)`);
    return { ...this.gameState };
  }

  endGame(result, winnerId = null) {
    if (this.gameState.phase === 'lobby') {
      return this.gameState;
    }

    // Cancel countdown timer if game ends during countdown
    clearTimeout(this._countdownTimer);

    const endedGameId = this.gameState.currentGame;

    // Track last game type for variety enforcement
    this.lastGameType = this.gameState.gameType;
    this.lastGameEndTime = Date.now();

    // Push to game history (cap at 8)
    this.gameHistory.push({
      type: this.gameState.gameType,
      template: this.lastTemplate,
      timestamp: Date.now()
    });
    if (this.gameHistory.length > 8) this.gameHistory = this.gameHistory.slice(-8);

    this.deactivateHazardPlane();
    this.gameState.phase = 'ended';
    this.gameState.endTime = Date.now();
    this.gameState.result = result; // 'win', 'lose', 'timeout', 'cancelled'
    this.gameState.cooldownUntil = Date.now() + 15000;

    if (winnerId) {
      this.gameState.winners.push(winnerId);
    }

    console.log(`[WorldState] Game ended: ${result}`);

    this._notifyPhaseChange();

    // Return to lobby after delay (only if no new game started)
    clearTimeout(this._lobbyResetTimer);
    this._lobbyResetTimer = setTimeout(() => {
      if (this.gameState.phase === 'ended' && this.gameState.currentGame === endedGameId) {
        this.resetGameState();
      }
    }, 5000);

    return { ...this.gameState };
  }

  resetGameState() {
    // Clean world for lobby — clear all entities, reset physics/floor/environment
    this.clearEntities();
    this.gameState = {
      phase: 'lobby',
      currentGame: null,
      gameType: null,
      startTime: null,
      timeLimit: null,
      cooldownUntil: 0,
      winners: [],
      losers: []
    };
    this.lobbyEnteredAt = Date.now();
    console.log('[WorldState] Game state reset to lobby (world cleared)');

    this._notifyPhaseChange();
  }

  startBuilding() {
    this.gameState = {
      phase: 'building',
      currentGame: null,
      gameType: null,
      startTime: Date.now(),
      timeLimit: null,
      cooldownUntil: 0,
      winners: [],
      losers: []
    };
    console.log('[WorldState] Entered building phase');
    return { ...this.gameState };
  }

  getGameState() {
    const state = { ...this.gameState };

    // Calculate remaining time if playing
    if (state.phase === 'playing' && state.timeLimit) {
      const elapsed = Date.now() - state.startTime;
      state.timeRemaining = Math.max(0, state.timeLimit - elapsed);
    }

    return state;
  }

  isInCooldown() {
    return Date.now() < this.gameState.cooldownUntil;
  }

  recordWinner(playerId) {
    if (this.gameState.phase === 'playing') {
      this.gameState.winners.push(playerId);
    }
  }

  recordLoser(playerId) {
    if (this.gameState.phase === 'playing') {
      this.gameState.losers.push(playerId);
    }
  }

  // ============================================
  // Chat Messages
  // ============================================

  addMessage(sender, senderType, text) {
    const id = ++this._messageIdCounter;
    const message = { id, sender, senderType, text, timestamp: Date.now() };
    this.messages.push(message);
    // Keep only last 50
    if (this.messages.length > 50) {
      this.messages = this.messages.slice(-50);
    }
    return message;
  }

  getMessages(since = 0, limit = 20) {
    let msgs = since > 0
      ? this.messages.filter(m => m.id > since)
      : this.messages;
    return msgs.slice(-limit);
  }

  // ============================================
  // Leaderboard
  // ============================================

  recordGameResult(playerId, won, score = 0) {
    const player = this.players.get(playerId);
    const name = player?.name || playerId;

    let entry = this.leaderboard.get(playerId);
    if (!entry) {
      entry = { name, wins: 0, totalScore: 0 };
      this.leaderboard.set(playerId, entry);
    }
    entry.name = name;
    if (won) entry.wins++;
    entry.totalScore += score;

    // Fire-and-forget DB write
    updateLeaderboard(playerId, name, won, score);

    return entry;
  }

  getLeaderboard() {
    return Array.from(this.leaderboard.entries())
      .map(([id, data]) => ({ id, ...data }))
      .sort((a, b) => b.wins - a.wins || b.totalScore - a.totalScore)
      .slice(0, 10);
  }

  async loadLeaderboardFromDB() {
    try {
      const rows = await loadLeaderboard();
      for (const row of rows) {
        this.leaderboard.set(row.id, {
          name: row.name,
          wins: row.wins,
          totalScore: row.totalScore
        });
      }
      if (rows.length > 0) {
        console.log(`[WorldState] Loaded ${rows.length} leaderboard entries from DB`);
      }
    } catch (err) {
      console.error('[WorldState] Failed to load leaderboard from DB:', err.message);
    }
  }

  // ============================================
  // Kinematic Entities
  // ============================================

  updateKinematicEntities(delta) {
    const moved = [];
    for (const entity of this.entities.values()) {
      if (!entity.properties?.kinematic || !entity.properties?.path) continue;

      const path = entity.properties.path;
      if (path.length < 2) continue;

      // Initialize animation state
      if (entity._pathProgress === undefined) {
        entity._pathProgress = 0;
        entity._pathDirection = 1;
      }

      const speed = (entity.properties.speed || 2) * delta;
      entity._pathProgress += speed * entity._pathDirection;

      // Ping-pong
      if (entity._pathProgress >= 1) {
        entity._pathProgress = 1;
        entity._pathDirection = -1;
      } else if (entity._pathProgress <= 0) {
        entity._pathProgress = 0;
        entity._pathDirection = 1;
      }

      // Lerp between first and last waypoint
      const start = path[0];
      const end = path.at(-1);
      const t = entity._pathProgress;
      entity.position = [
        start[0] + (end[0] - start[0]) * t,
        start[1] + (end[1] - start[1]) * t,
        start[2] + (end[2] - start[2]) * t
      ];

      // Compute facing from path travel direction
      const pdx = end[0] - start[0];
      const pdz = end[2] - start[2];
      if (Math.abs(pdx) > 0.01 || Math.abs(pdz) > 0.01) {
        entity.properties._facing = Math.atan2(pdx * entity._pathDirection, pdz * entity._pathDirection);
      }

      moved.push(entity);
    }
    return moved;
  }

  // ============================================
  // Chase Entities
  // ============================================

  updateChasingEntities(delta) {
    const moved = [];
    // Collect alive player positions
    const playerPositions = [];
    for (const p of this.players.values()) {
      if (p.state === 'alive' && p.position) playerPositions.push(p.position);
    }
    if (playerPositions.length === 0) return moved;

    // Find all entities in a chase group
    const chaseGroups = new Map(); // groupId -> [entities]
    for (const entity of this.entities.values()) {
      if (!entity.properties?.chase || !entity.properties?.groupId) continue;
      const gid = entity.properties.groupId;
      if (!chaseGroups.has(gid)) chaseGroups.set(gid, []);
      chaseGroups.get(gid).push(entity);
    }

    for (const [, entities] of chaseGroups) {
      // Use the first entity (body) as the leader
      const leader = entities[0];
      const speed = (leader.properties.speed || 2) * delta;
      const radius = leader.properties.chaseRadius || 20;

      // Find nearest player to leader
      let nearest = null;
      let nearestDist = Infinity;
      for (const pos of playerPositions) {
        const dx = pos[0] - leader.position[0];
        const dz = pos[2] - leader.position[2];
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist < nearestDist) { nearestDist = dist; nearest = pos; }
      }

      if (!nearest || nearestDist > radius) continue;

      // Move leader toward player (XZ only, keep Y)
      const dx = nearest[0] - leader.position[0];
      const dz = nearest[2] - leader.position[2];
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < 0.3) continue; // close enough

      const moveX = (dx / dist) * speed;
      const moveZ = (dz / dist) * speed;

      // Store facing yaw on leader for client
      leader.properties._facing = Math.atan2(dx, dz);

      // Move all entities in the group by the same offset
      for (const entity of entities) {
        entity.position = [
          entity.position[0] + moveX,
          entity.position[1],
          entity.position[2] + moveZ,
        ];
        moved.push(entity);
      }
    }
    return moved;
  }

  // ============================================
  // Spells / World Effects
  // ============================================

  static SPELL_COOLDOWN = 10000;

  static SPELL_TYPES = {
    invert_controls: { name: 'Inverted Controls', defaultDuration: 15000 },
    low_gravity: { name: 'Low Gravity', defaultDuration: 20000 },
    high_gravity: { name: 'Crushing Gravity', defaultDuration: 15000 },
    speed_boost: { name: 'Speed Boost', defaultDuration: 15000 },
    slow_motion: { name: 'Slow Motion', defaultDuration: 10000 },
    bouncy: { name: 'Bouncy World', defaultDuration: 20000 },
    giant: { name: 'Giant Mode', defaultDuration: 15000 },
    tiny: { name: 'Tiny Mode', defaultDuration: 15000 }
  };

  castSpell(spellType, duration) {
    const spellDef = WorldState.SPELL_TYPES[spellType];
    if (!spellDef) {
      throw new Error(`Unknown spell: ${spellType}. Available: ${Object.keys(WorldState.SPELL_TYPES).join(', ')}`);
    }

    const now = Date.now();
    const timeSinceLast = now - this.lastSpellCastTime;
    if (timeSinceLast < WorldState.SPELL_COOLDOWN) {
      const remaining = Math.ceil((WorldState.SPELL_COOLDOWN - timeSinceLast) / 1000);
      throw new Error(`Spell on cooldown! The magic needs ${remaining}s to recharge.`);
    }

    const id = `spell-${randomUUID().slice(0, 8)}`;
    const spell = {
      id,
      type: spellType,
      name: spellDef.name,
      duration: duration || spellDef.defaultDuration,
      startTime: now
    };

    this.activeEffects.push(spell);
    this.lastSpellCastTime = now;
    console.log(`[WorldState] Spell cast: ${spellDef.name} for ${spell.duration}ms`);
    return spell;
  }

  getActiveEffects() {
    const now = Date.now();
    this.activeEffects = this.activeEffects.filter(e => now - e.startTime < e.duration);
    return [...this.activeEffects];
  }

  clearEffects() {
    this.activeEffects = [];
    console.log('[WorldState] All effects cleared');
  }

  // ============================================
  // Event Log
  // ============================================

  addEvent(type, data) {
    const id = ++this._eventIdCounter;
    this.events.push({ id, type, data, timestamp: Date.now() });
    if (this.events.length > 100) this.events = this.events.slice(-100);
    return id;
  }

  getEvents(since = 0) {
    return since > 0 ? this.events.filter(e => e.id > since) : this.events.slice(-20);
  }

  // ============================================
  // State Export
  // ============================================

  getState() {
    return {
      physics: { ...this.physics },
      entities: Array.from(this.entities.values()),
      players: Array.from(this.players.values()).map(p => ({
        id: p.id, name: p.name, type: p.type, position: p.position, state: p.state
      })),
      challenges: {
        active: this.getChallenges(),
        completed: Array.from(this.challenges.values()).filter(c => !c.active)
      },
      gameState: this.getGameState(),
      activeEffects: this.getActiveEffects(),
      announcements: this.getAnnouncements(),
      floorType: this.floorType,
      environment: { ...this.environment },
      hazardPlane: { ...this.hazardPlane },
      statistics: {
        ...this.statistics,
        totalEntities: this.entities.size,
        playersOnline: this.players.size
      }
    };
  }

  // Save state to JSON (for persistence)
  toJSON() {
    return JSON.stringify(this.getState(), null, 2);
  }

  // Load state from JSON (for persistence)
  fromJSON(json) {
    const data = JSON.parse(json);

    this.physics = data.physics;

    this.entities.clear();
    for (const entity of data.entities) {
      this.entities.set(entity.id, entity);
    }

    this.challenges.clear();
    for (const challenge of [...data.challenges.active, ...data.challenges.completed]) {
      this.challenges.set(challenge.id, challenge);
    }

    this.statistics = data.statistics;
    console.log('[WorldState] State loaded from JSON');
  }
}
