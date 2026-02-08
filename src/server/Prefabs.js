/**
 * Prefabs - Named entity presets that bundle multiple child entities
 *
 * The agent says spawn_prefab({ name: 'spider', position: [5,1,0] }) and gets
 * a multi-part entity group that looks and acts like a spider.
 */

import { randomUUID } from 'crypto';

const PREFABS = {
  spider: {
    category: 'hazard',
    description: 'Black spider that chases the nearest player — kills on contact',
    defaultProperties: { speed: 2, chaseRadius: 20 },
    children: [
      { type: 'obstacle', offset: [0, 0.5, 0], size: [1, 0.8, 1], props: { shape: 'sphere', color: '#1a1a1a' } },
      { type: 'obstacle', offset: [-0.6, 0.2, 0.4], size: [0.15, 0.15, 0.8], props: { shape: 'cylinder', color: '#333333' } },
      { type: 'obstacle', offset: [0.6, 0.2, 0.4], size: [0.15, 0.15, 0.8], props: { shape: 'cylinder', color: '#333333' } },
      { type: 'obstacle', offset: [-0.6, 0.2, -0.4], size: [0.15, 0.15, 0.8], props: { shape: 'cylinder', color: '#333333' } },
      { type: 'obstacle', offset: [0.6, 0.2, -0.4], size: [0.15, 0.15, 0.8], props: { shape: 'cylinder', color: '#333333' } },
    ],
    behavior: 'chase',
  },

  spinning_blade: {
    category: 'hazard',
    description: 'Fast-rotating flat blade — kills on contact',
    defaultProperties: { speed: 6 },
    children: [
      { type: 'obstacle', offset: [0, 0.2, 0], size: [3, 0.15, 0.6], props: { shape: 'cylinder', color: '#cccccc' } },
    ],
    behavior: 'rotate',
  },

  swinging_axe: {
    category: 'hazard',
    description: 'Pendulum axe swinging back and forth — kills on contact',
    defaultProperties: { speed: 1.2, swingHeight: 4 },
    children: [
      { type: 'decoration', offset: [0, 4, 0], size: [0.3, 0.3, 0.3], props: { shape: 'cylinder', color: '#666666' } },
      { type: 'obstacle', offset: [0, 0.5, 0], size: [1.5, 0.2, 0.6], props: { color: '#888888' } },
    ],
    behavior: 'pendulum',
  },

  crusher: {
    category: 'hazard',
    description: 'Wide platform that slams down periodically — kills if underneath',
    defaultProperties: { speed: 0.6, crushHeight: 5 },
    children: [
      { type: 'obstacle', offset: [0, 5, 0], size: [4, 0.8, 4], props: { color: '#555555' } },
    ],
    behavior: 'crush',
  },

  rolling_boulder: {
    category: 'hazard',
    description: 'Large boulder that patrols back and forth — kills on contact',
    defaultProperties: { patrolRadius: 10, speed: 2 },
    children: [
      { type: 'obstacle', offset: [0, 1, 0], size: [1.8, 1.8, 1.8], props: { shape: 'sphere', color: '#7f6c5d' } },
    ],
    behavior: 'patrol',
  },

  bounce_pad: {
    category: 'utility',
    description: 'Launches players upward on contact',
    defaultProperties: { bounceForce: 18 },
    children: [
      { type: 'trigger', offset: [0, 0.15, 0], size: [2, 0.3, 2], props: { shape: 'cylinder', color: '#2ecc71', isBounce: true } },
    ],
    behavior: 'static',
  },

  checkpoint: {
    category: 'utility',
    description: 'Glowing flag — sets player respawn point on contact',
    defaultProperties: {},
    children: [
      { type: 'trigger', offset: [0, 1.5, 0], size: [0.2, 3, 0.2], props: { shape: 'cylinder', color: '#ecf0f1', isCheckpoint: true } },
      { type: 'trigger', offset: [0, 3.2, 0], size: [0.5, 0.5, 0.5], props: { shape: 'sphere', color: '#f1c40f', isCheckpoint: true, emissive: true } },
    ],
    behavior: 'static',
  },

  speed_strip: {
    category: 'utility',
    description: 'Gives players a temporary speed boost when walked over',
    defaultProperties: { boostDuration: 3000 },
    children: [
      { type: 'trigger', offset: [0, 0.05, 0], size: [2, 0.1, 4], props: { color: '#e67e22', isSpeedBoost: true } },
    ],
    behavior: 'static',
  },

  torch: {
    category: 'decoration',
    description: 'Glowing flame on a stick — visual decoration',
    defaultProperties: {},
    children: [
      { type: 'decoration', offset: [0, 1, 0], size: [0.15, 2, 0.15], props: { shape: 'cylinder', color: '#8b4513' } },
      { type: 'decoration', offset: [0, 2.3, 0], size: [0.3, 0.5, 0.3], props: { shape: 'cone', color: '#ff6600', emissive: true } },
    ],
    behavior: 'static',
  },

  crystal: {
    category: 'decoration',
    description: 'Rotating purple crystal — ambient visual flair',
    defaultProperties: { speed: 1 },
    children: [
      { type: 'decoration', offset: [0, 1, 0], size: [1, 1.5, 1], props: { shape: 'dodecahedron', color: '#9b59b6', emissive: true } },
    ],
    behavior: 'rotate',
  },

  barrel: {
    category: 'decoration',
    description: 'Brown barrel — static decoration',
    defaultProperties: {},
    children: [
      { type: 'decoration', offset: [0, 0.6, 0], size: [0.7, 1.2, 0.7], props: { shape: 'cylinder', color: '#8b5e3c' } },
    ],
    behavior: 'static',
  },

  flag: {
    category: 'decoration',
    description: 'Flag on a pole — marks positions or goals',
    defaultProperties: {},
    children: [
      { type: 'decoration', offset: [0, 1.5, 0], size: [0.1, 3, 0.1], props: { shape: 'cylinder', color: '#bdc3c7' } },
      { type: 'decoration', offset: [0.5, 2.7, 0], size: [0.8, 0.5, 0.05], props: { color: '#e74c3c' } },
    ],
    behavior: 'static',
  },

  // ============================================
  // More creatures & objects
  // ============================================

  fish: {
    category: 'decoration',
    description: 'Orange fish swimming in circles — visual decoration',
    defaultProperties: { speed: 1.5 },
    children: [
      { type: 'decoration', offset: [0, 0, 0], size: [1.2, 0.6, 0.5], props: { shape: 'sphere', color: '#ff6b35' } },
      { type: 'decoration', offset: [-0.8, 0, 0], size: [0.5, 0.6, 0.1], props: { shape: 'cone', color: '#ff6b35' } },
      { type: 'decoration', offset: [0.4, 0.3, 0], size: [0.15, 0.15, 0.15], props: { shape: 'sphere', color: '#ffffff' } },
    ],
    behavior: 'patrol',
  },

  shark: {
    category: 'hazard',
    description: 'Grey shark that chases players — kills on contact',
    defaultProperties: { speed: 3, chaseRadius: 25 },
    children: [
      { type: 'obstacle', offset: [0, 0, 0], size: [2, 0.8, 0.8], props: { shape: 'sphere', color: '#5a6672' } },
      { type: 'obstacle', offset: [-1.2, 0, 0], size: [0.6, 0.8, 0.1], props: { shape: 'cone', color: '#5a6672' } },
      { type: 'obstacle', offset: [0, 0.6, 0], size: [0.3, 0.8, 0.1], props: { shape: 'cone', color: '#4a5662' } },
      { type: 'obstacle', offset: [0.7, 0.1, 0], size: [0.15, 0.15, 0.15], props: { shape: 'sphere', color: '#111111' } },
    ],
    behavior: 'chase',
  },

  car: {
    category: 'hazard',
    description: 'Red car that patrols a road — kills on contact',
    defaultProperties: { patrolRadius: 15, speed: 4 },
    children: [
      { type: 'obstacle', offset: [0, 0.5, 0], size: [2.5, 0.8, 1.4], props: { color: '#e74c3c' } },
      { type: 'obstacle', offset: [0, 1.1, 0], size: [1.4, 0.6, 1.2], props: { color: '#c0392b' } },
      { type: 'obstacle', offset: [-0.8, 0.2, 0.7], size: [0.5, 0.5, 0.2], props: { shape: 'cylinder', color: '#222222' } },
      { type: 'obstacle', offset: [0.8, 0.2, 0.7], size: [0.5, 0.5, 0.2], props: { shape: 'cylinder', color: '#222222' } },
      { type: 'obstacle', offset: [-0.8, 0.2, -0.7], size: [0.5, 0.5, 0.2], props: { shape: 'cylinder', color: '#222222' } },
      { type: 'obstacle', offset: [0.8, 0.2, -0.7], size: [0.5, 0.5, 0.2], props: { shape: 'cylinder', color: '#222222' } },
    ],
    behavior: 'patrol',
  },

  tree: {
    category: 'decoration',
    description: 'Green tree with brown trunk — visual decoration',
    defaultProperties: {},
    children: [
      { type: 'decoration', offset: [0, 1.5, 0], size: [0.4, 3, 0.4], props: { shape: 'cylinder', color: '#5d4037' } },
      { type: 'decoration', offset: [0, 3.5, 0], size: [2, 2, 2], props: { shape: 'sphere', color: '#27ae60' } },
      { type: 'decoration', offset: [0, 4.8, 0], size: [1.2, 1.2, 1.2], props: { shape: 'sphere', color: '#2ecc71' } },
    ],
    behavior: 'static',
  },

  snowman: {
    category: 'decoration',
    description: 'Classic snowman — three white spheres stacked',
    defaultProperties: {},
    children: [
      { type: 'decoration', offset: [0, 0.8, 0], size: [1.6, 1.6, 1.6], props: { shape: 'sphere', color: '#ecf0f1' } },
      { type: 'decoration', offset: [0, 2.0, 0], size: [1.2, 1.2, 1.2], props: { shape: 'sphere', color: '#f0f0f0' } },
      { type: 'decoration', offset: [0, 3.0, 0], size: [0.8, 0.8, 0.8], props: { shape: 'sphere', color: '#f5f5f5' } },
      { type: 'decoration', offset: [0, 3.0, 0.4], size: [0.15, 0.3, 0.15], props: { shape: 'cone', color: '#e67e22' } },
    ],
    behavior: 'static',
  },

  ghost: {
    category: 'hazard',
    description: 'Floating white ghost that chases players — kills on contact',
    defaultProperties: { speed: 1.8, chaseRadius: 18 },
    children: [
      { type: 'obstacle', offset: [0, 1, 0], size: [1.2, 1.5, 1.2], props: { shape: 'sphere', color: '#ecf0f1' } },
      { type: 'obstacle', offset: [-0.25, 1.2, 0.5], size: [0.2, 0.2, 0.2], props: { shape: 'sphere', color: '#111111' } },
      { type: 'obstacle', offset: [0.25, 1.2, 0.5], size: [0.2, 0.2, 0.2], props: { shape: 'sphere', color: '#111111' } },
    ],
    behavior: 'chase',
  },

  mushroom: {
    category: 'decoration',
    description: 'Red mushroom with white spots — visual decoration',
    defaultProperties: {},
    children: [
      { type: 'decoration', offset: [0, 0.5, 0], size: [0.4, 1, 0.4], props: { shape: 'cylinder', color: '#f5f5dc' } },
      { type: 'decoration', offset: [0, 1.2, 0], size: [1.2, 0.6, 1.2], props: { shape: 'sphere', color: '#e74c3c' } },
      { type: 'decoration', offset: [0.3, 1.5, 0.2], size: [0.2, 0.2, 0.2], props: { shape: 'sphere', color: '#ffffff' } },
      { type: 'decoration', offset: [-0.2, 1.5, -0.3], size: [0.15, 0.15, 0.15], props: { shape: 'sphere', color: '#ffffff' } },
    ],
    behavior: 'static',
  },

  ufo: {
    category: 'hazard',
    description: 'Flying saucer that chases players — kills on contact',
    defaultProperties: { speed: 2.5, chaseRadius: 30 },
    children: [
      { type: 'obstacle', offset: [0, 3, 0], size: [2.5, 0.4, 2.5], props: { shape: 'cylinder', color: '#95a5a6' } },
      { type: 'obstacle', offset: [0, 3.3, 0], size: [1.2, 0.8, 1.2], props: { shape: 'sphere', color: '#3498db', emissive: true } },
      { type: 'obstacle', offset: [0, 2.7, 0], size: [0.5, 0.3, 0.5], props: { shape: 'cone', color: '#2ecc71', emissive: true } },
    ],
    behavior: 'chase',
  },

  cactus: {
    category: 'hazard',
    description: 'Green cactus — kills on contact (ouch!)',
    defaultProperties: {},
    children: [
      { type: 'obstacle', offset: [0, 1, 0], size: [0.5, 2, 0.5], props: { shape: 'cylinder', color: '#27ae60' } },
      { type: 'obstacle', offset: [0.5, 1.5, 0], size: [0.3, 1, 0.3], props: { shape: 'cylinder', color: '#2ecc71' } },
      { type: 'obstacle', offset: [-0.4, 1.8, 0], size: [0.3, 0.7, 0.3], props: { shape: 'cylinder', color: '#2ecc71' } },
    ],
    behavior: 'static',
  },

  rocket: {
    category: 'decoration',
    description: 'Red rocket ship — visual decoration',
    defaultProperties: {},
    children: [
      { type: 'decoration', offset: [0, 1.5, 0], size: [0.8, 3, 0.8], props: { shape: 'cylinder', color: '#e74c3c' } },
      { type: 'decoration', offset: [0, 3.5, 0], size: [0.8, 1, 0.8], props: { shape: 'cone', color: '#c0392b' } },
      { type: 'decoration', offset: [0, 0.2, 0], size: [0.6, 0.5, 0.6], props: { shape: 'cone', color: '#f39c12', emissive: true } },
    ],
    behavior: 'static',
  },

  trashcan: {
    category: 'decoration',
    description: 'Metal trash can — static decoration',
    defaultProperties: {},
    children: [
      { type: 'decoration', offset: [0, 0.5, 0], size: [0.7, 1, 0.7], props: { shape: 'cylinder', color: '#7f8c8d' } },
      { type: 'decoration', offset: [0, 1.1, 0], size: [0.8, 0.1, 0.8], props: { shape: 'cylinder', color: '#95a5a6' } },
    ],
    behavior: 'static',
  },
};

export function getPrefabNames() {
  return Object.keys(PREFABS);
}

export function getPrefabInfo() {
  return Object.entries(PREFABS).map(([name, def]) => ({
    name,
    category: def.category,
    description: def.description,
  }));
}

/**
 * Spawn a prefab as a group of entities.
 * Returns { groupId, entityIds }
 */
export function spawnPrefab(name, position, properties, worldState, broadcastFn) {
  const prefab = PREFABS[name];
  if (!prefab) {
    throw new Error(`Unknown prefab: ${name}. Available: ${Object.keys(PREFABS).join(', ')}`);
  }

  const groupId = `prefab-${name}-${randomUUID().slice(0, 8)}`;
  const merged = { ...prefab.defaultProperties, ...properties };
  const entityIds = [];

  for (const child of prefab.children) {
    const absPos = [
      position[0] + child.offset[0],
      position[1] + child.offset[1],
      position[2] + child.offset[2],
    ];

    const childProps = {
      ...child.props,
      groupId,
      prefabName: name,
    };

    // Apply behavior-specific properties
    switch (prefab.behavior) {
      case 'patrol': {
        const radius = merged.patrolRadius || 6;
        childProps.kinematic = true;
        childProps.speed = merged.speed || 1.5;
        childProps.path = [
          [absPos[0] - radius / 2, absPos[1], absPos[2]],
          [absPos[0] + radius / 2, absPos[1], absPos[2]],
        ];
        break;
      }
      case 'rotate':
        childProps.rotating = true;
        childProps.speed = merged.speed || 2;
        break;
      case 'pendulum': {
        const height = merged.swingHeight || 4;
        childProps.kinematic = true;
        childProps.speed = merged.speed || 1;
        childProps.path = [
          [absPos[0] - 2, absPos[1], absPos[2]],
          [absPos[0] + 2, absPos[1] + height * 0.3, absPos[2]],
        ];
        break;
      }
      case 'crush': {
        const crushH = merged.crushHeight || 5;
        childProps.kinematic = true;
        childProps.speed = merged.speed || 0.6;
        childProps.path = [
          [absPos[0], absPos[1], absPos[2]],
          [absPos[0], absPos[1] - crushH + 1, absPos[2]],
        ];
        break;
      }
      case 'chase':
        childProps.chase = true;
        childProps.speed = merged.speed || 2;
        childProps.chaseRadius = merged.chaseRadius || 20;
        childProps.spawnPos = [...absPos];
        break;
    }

    // Pass through trigger properties from child definition
    if (child.props.isBounce) childProps.bounceForce = merged.bounceForce || 18;
    if (child.props.isSpeedBoost) childProps.boostDuration = merged.boostDuration || 3000;

    const entity = worldState.spawnEntity(child.type, absPos, child.size, childProps);
    broadcastFn('entity_spawned', entity);
    entityIds.push(entity.id);
  }

  console.log(`[Prefabs] Spawned '${name}' as group ${groupId} (${entityIds.length} entities)`);
  return { groupId, entityIds };
}

export { PREFABS };
