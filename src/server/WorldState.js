/**
 * WorldState - Manages all game world data
 *
 * This is the source of truth for entities, physics, challenges, and players.
 * Shared between HTTP API and Colyseus game room.
 */

import { randomUUID } from 'crypto';

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

  getDefaultColor(type) {
    const colors = {
      platform: '#3498db',  // Blue
      ramp: '#2ecc71',      // Green
      collectible: '#f1c40f', // Yellow
      obstacle: '#e74c3c',   // Red
      trigger: '#9b59b6'     // Purple
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
      position: [0, 2, 0],
      velocity: [0, 0, 0],
      state: 'alive',
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
