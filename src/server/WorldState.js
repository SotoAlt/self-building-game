/**
 * WorldState - Manages all game world data
 *
 * This is the source of truth for entities, physics, challenges, and players.
 * Shared between HTTP API and Colyseus game room.
 */

import { randomUUID } from 'crypto';
import { updateLeaderboard, loadLeaderboard } from './db.js';

export class WorldState {
  constructor() {
    // Physics parameters
    this.physics = {
      gravity: -9.8,
      friction: 0.3,
      bounce: 0.5
    };

    // All entities in the world
    this.entities = new Map();

    // Active challenges
    this.challenges = new Map();

    // Connected players
    this.players = new Map();

    // Statistics
    this.statistics = {
      totalEntitiesCreated: 0,
      totalChallengesCreated: 0,
      totalChallengesCompleted: 0
    };

    // Announcements queue
    this.announcements = [];

    // Chat messages (keep last 50)
    this.messages = [];
    this._messageIdCounter = 0;

    // Leaderboard: playerId → { name, wins, totalScore }
    this.leaderboard = new Map();

    // Active spells/effects
    this.activeEffects = [];

    // Event log
    this.events = [];
    this._eventIdCounter = 0;

    // Respawn point (agent-configurable)
    this.respawnPoint = [0, 2, 0];

    // Floor type: 'solid', 'none' (abyss), 'lava'
    this.floorType = 'solid';

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
    const validTypes = ['platform', 'ramp', 'collectible', 'obstacle', 'trigger'];
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
    this.physics = { gravity: -9.8, friction: 0.3, bounce: 0.5 };
    this.floorType = 'solid';
    this.clearEffects();
    console.log(`[WorldState] Cleared ${ids.length} entities`);
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

  setRespawnPoint(position) {
    this.respawnPoint = [...position];
    console.log(`[WorldState] Respawn point set to [${position.join(', ')}]`);
    return this.respawnPoint;
  }

  getDefaultColor(type) {
    const colors = {
      platform: '#3498db',
      ramp: '#2ecc71',
      collectible: '#f1c40f',
      obstacle: '#e74c3c',
      trigger: '#9b59b6'
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

  addPlayer(id, name, type = 'human') {
    const player = {
      id,
      name,
      type, // 'human' or 'ai'
      position: [...this.respawnPoint],
      velocity: [0, 0, 0],
      state: 'alive',
      ready: false,
      joinedAt: Date.now()
    };

    this.players.set(id, player);
    console.log(`[WorldState] Player joined: ${name} (${type})`);
    return player;
  }

  updatePlayer(id, updates) {
    const player = this.players.get(id);
    if (!player) return null;

    if (updates.position) player.position = [...updates.position];
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
    const validTypes = ['reach', 'collect', 'survival'];
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

        // Notify listeners of phase transition
        if (typeof this.onPhaseChange === 'function') {
          this.onPhaseChange(this.getGameState());
        }
      }
    }, config.countdownTime || 3000);

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

    this.gameState.phase = 'ended';
    this.gameState.endTime = Date.now();
    this.gameState.result = result; // 'win', 'lose', 'timeout', 'cancelled'
    this.gameState.cooldownUntil = Date.now() + 8000;

    if (winnerId) {
      this.gameState.winners.push(winnerId);
    }

    console.log(`[WorldState] Game ended: ${result}`);

    // Notify listeners of phase transition
    if (typeof this.onPhaseChange === 'function') {
      this.onPhaseChange(this.getGameState());
    }

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
    const { cooldownUntil } = this.gameState;
    this.gameState = {
      phase: 'lobby',
      currentGame: null,
      gameType: null,
      startTime: null,
      timeLimit: null,
      cooldownUntil,
      winners: [],
      losers: []
    };
    console.log('[WorldState] Game state reset to lobby');

    // Notify listeners of phase transition
    if (typeof this.onPhaseChange === 'function') {
      this.onPhaseChange(this.getGameState());
    }
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
  // Player Ready
  // ============================================

  setPlayerReady(id, ready) {
    const player = this.players.get(id);
    if (!player) return null;
    player.ready = ready;
    return player;
  }

  getReadyCount() {
    return Array.from(this.players.values()).filter(p => p.ready).length;
  }

  getHumanReadyCount() {
    const humans = Array.from(this.players.values()).filter(p => p.type !== 'ai');
    const readyHumans = humans.filter(p => p.ready);
    return { ready: readyHumans.length, total: humans.length };
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

      moved.push(entity);
    }
    return moved;
  }

  // ============================================
  // Spells / World Effects
  // ============================================

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

    const id = `spell-${randomUUID().slice(0, 8)}`;
    const spell = {
      id,
      type: spellType,
      name: spellDef.name,
      duration: duration || spellDef.defaultDuration,
      startTime: Date.now()
    };

    this.activeEffects.push(spell);
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
      challenges: {
        active: this.getChallenges(),
        completed: Array.from(this.challenges.values()).filter(c => !c.active)
      },
      gameState: this.getGameState(),
      activeEffects: this.getActiveEffects(),
      announcements: this.getAnnouncements(),
      floorType: this.floorType,
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
