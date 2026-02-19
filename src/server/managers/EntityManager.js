import { randomUUID } from 'crypto';

const DEFAULT_COLORS = {
  platform: '#3498db',
  ramp: '#2ecc71',
  collectible: '#f1c40f',
  obstacle: '#e74c3c',
  trigger: '#9b59b6',
  decoration: '#95a5a6',
};

export class EntityManager {
  static MAX_ENTITIES = 500;
  static VALID_ENTITY_TYPES = Object.keys(DEFAULT_COLORS);

  constructor() {
    this.entities = new Map();
    this.breakingPlatforms = new Map();
    this._totalCreated = 0;
  }

  get totalCreated() {
    return this._totalCreated;
  }

  spawnEntity(type, position, size = [1, 1, 1], properties = {}) {
    if (!EntityManager.VALID_ENTITY_TYPES.includes(type)) {
      throw new Error(`Invalid entity type: ${type}`);
    }
    if (this.entities.size >= EntityManager.MAX_ENTITIES) {
      throw new Error(`Entity limit reached (${EntityManager.MAX_ENTITIES})`);
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
    this._totalCreated++;

    console.log(`[EntityManager] Spawned ${type} at [${position.join(', ')}] → ${id}`);
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
    console.log(`[EntityManager] Modified ${id}`);
    return entity;
  }

  destroyEntity(id) {
    if (!this.entities.has(id)) {
      throw new Error(`Entity not found: ${id}`);
    }

    this.entities.delete(id);
    console.log(`[EntityManager] Destroyed ${id}`);
  }

  /** Clears entities + breakingPlatforms only. Facade orchestrates full reset. */
  clearEntities() {
    const ids = [...this.entities.keys()];
    this.entities.clear();
    this.breakingPlatforms.clear();
    console.log(`[EntityManager] Cleared ${ids.length} entities`);
    return ids;
  }

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
    console.log(`[EntityManager] Destroyed group ${groupId} (${ids.length} entities)`);
    return ids;
  }

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
        console.log(`[EntityManager] Breakable platform destroyed: ${entityId}`);

        // Schedule regen if configured
        if (info.regenDelay > 0) {
          const orig = info.originalEntity;
          setTimeout(() => {
            try {
              const reborn = this.spawnEntity(orig.type, orig.position, orig.size, orig.properties);
              broadcastFn('entity_spawned', reborn);
              console.log(`[EntityManager] Platform regenerated: ${reborn.id}`);
            } catch { /* entity limit or world cleared */ }
          }, info.regenDelay);
        }

        this.breakingPlatforms.delete(entityId);
      }
    }
  }

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

  /**
   * @param {number} delta
   * @param {function} getAlivePositions - () => Array<[x,y,z]>
   */
  updateChasingEntities(delta, getAlivePositions) {
    const moved = [];
    const playerPositions = getAlivePositions();
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

  getDefaultColor(type) {
    return DEFAULT_COLORS[type] || '#95a5a6';
  }
}
