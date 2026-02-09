/**
 * ArenaTemplates - Pre-designed arena layouts
 *
 * The agent can load these instantly via load_template tool.
 * Each template defines entities, a goal position, game type, and respawn point.
 */

// Generate 3-layer hex-staggered breakable grid for Hex-A-Gone
function generateHexAGoneEntities() {
  const entities = [];
  const layers = [
    { y: 1, color: '#e67e22', breakDelay: 400 },    // bottom — orange
    { y: 5, color: '#2ecc71', breakDelay: 350 },    // middle — green
    { y: 9, color: '#3498db', breakDelay: 300 },    // top — blue
  ];
  const spacing = 2.5;
  const maxRadius = 8.75;

  for (const layer of layers) {
    for (let row = -4; row <= 4; row++) {
      const zOffset = row % 2 !== 0 ? spacing / 2 : 0;
      for (let col = -4; col <= 4; col++) {
        const x = col * spacing + zOffset;
        const z = row * spacing;
        if (Math.sqrt(x * x + z * z) > maxRadius) continue;

        entities.push({
          type: 'platform',
          position: [x, layer.y, z],
          size: [2, 0.3, 2],
          properties: {
            color: layer.color,
            breakable: true,
            breakDelay: layer.breakDelay,
          },
        });
      }
    }
  }

  return entities;
}

export const TEMPLATES = {
  spiral_tower: {
    name: 'Spiral of Madness',
    gameType: 'reach',
    floorType: 'solid',
    environment: { skyColor: '#0d1b2a', fogColor: '#0d1b2a', fogFar: 180, ambientIntensity: 0.4 },
    respawnPoint: [0, 2, 0],
    goalPosition: [0, 28, 0],
    entities: [
      // Base platform
      { type: 'platform', position: [0, 0, 0], size: [12, 1, 12], properties: { color: '#2c3e50' } },
      // Spiral platforms going up
      { type: 'platform', position: [6, 4, 0], size: [5, 1, 3], properties: { color: '#3498db' } },
      { type: 'platform', position: [4, 7, 5], size: [4, 1, 3], properties: { color: '#2980b9' } },
      { type: 'platform', position: [-2, 10, 6], size: [4, 1, 3], properties: { color: '#3498db' } },
      { type: 'platform', position: [-6, 13, 2], size: [4, 1, 3], properties: { color: '#2980b9' } },
      { type: 'platform', position: [-5, 16, -4], size: [4, 1, 3], properties: { color: '#3498db' } },
      { type: 'platform', position: [-1, 19, -6], size: [4, 1, 3], properties: { color: '#2980b9' } },
      { type: 'platform', position: [4, 22, -4], size: [4, 1, 3], properties: { color: '#3498db' } },
      { type: 'platform', position: [5, 25, 1], size: [4, 1, 3], properties: { color: '#2980b9' } },
      // Goal platform at top
      { type: 'platform', position: [0, 27, 0], size: [4, 1, 4], properties: { color: '#f1c40f' } },
      // Goal trigger
      { type: 'trigger', position: [0, 29, 0], size: [3, 3, 3], properties: { color: '#f1c40f', rotating: true, speed: 2, isGoal: true } },
      // Obstacles on some platforms
      { type: 'obstacle', position: [-5, 17, -4], size: [1, 2, 1], properties: { color: '#e74c3c', rotating: true, speed: 3 } },
      { type: 'obstacle', position: [4, 23, -4], size: [1, 2, 1], properties: { color: '#e74c3c', rotating: true, speed: 2 } },
      // Decorations
      { type: 'decoration', position: [5, 5, 2], size: [0.3, 0.5, 0.3], properties: { shape: 'cone', color: '#ff6600', emissive: true } },
      { type: 'decoration', position: [-6, 14, 3], size: [0.3, 0.5, 0.3], properties: { shape: 'cone', color: '#ff6600', emissive: true } },
      { type: 'decoration', position: [1, 28, 1], size: [0.8, 1.2, 0.8], properties: { shape: 'dodecahedron', color: '#9b59b6', emissive: true } },
    ]
  },

  floating_islands: {
    name: 'Sky Islands',
    gameType: 'collect',
    floorType: 'none',
    environment: { skyColor: '#1a3a5c', fogColor: '#1a3a5c', fogFar: 250, ambientIntensity: 0.6, sunIntensity: 1.2 },
    respawnPoint: [0, 6, 0],
    goalPosition: null,
    entities: [
      // Central island
      { type: 'platform', position: [0, 4, 0], size: [8, 2, 8], properties: { color: '#27ae60' } },
      // North island
      { type: 'platform', position: [0, 6, -18], size: [6, 1, 6], properties: { color: '#2ecc71' } },
      // East island
      { type: 'platform', position: [18, 8, 0], size: [6, 1, 6], properties: { color: '#27ae60' } },
      // South island
      { type: 'platform', position: [0, 5, 18], size: [6, 1, 6], properties: { color: '#2ecc71' } },
      // West island
      { type: 'platform', position: [-18, 7, 0], size: [6, 1, 6], properties: { color: '#27ae60' } },
      // Bridges (narrow platforms)
      { type: 'platform', position: [0, 5, -9], size: [2, 0.5, 8], properties: { color: '#8e44ad' } },
      { type: 'platform', position: [9, 6, 0], size: [8, 0.5, 2], properties: { color: '#8e44ad' } },
      { type: 'platform', position: [0, 4.5, 9], size: [2, 0.5, 8], properties: { color: '#8e44ad' } },
      { type: 'platform', position: [-9, 5.5, 0], size: [8, 0.5, 2], properties: { color: '#8e44ad' } },
      // Collectibles scattered on islands
      { type: 'collectible', position: [0, 8, -18], size: [1, 1, 1], properties: { color: '#f1c40f' } },
      { type: 'collectible', position: [2, 8, -17], size: [1, 1, 1], properties: { color: '#f1c40f' } },
      { type: 'collectible', position: [18, 10, 0], size: [1, 1, 1], properties: { color: '#f1c40f' } },
      { type: 'collectible', position: [17, 10, 2], size: [1, 1, 1], properties: { color: '#f1c40f' } },
      { type: 'collectible', position: [0, 7, 18], size: [1, 1, 1], properties: { color: '#f1c40f' } },
      { type: 'collectible', position: [-2, 7, 17], size: [1, 1, 1], properties: { color: '#f1c40f' } },
      { type: 'collectible', position: [-18, 9, 0], size: [1, 1, 1], properties: { color: '#f1c40f' } },
      { type: 'collectible', position: [-17, 9, -2], size: [1, 1, 1], properties: { color: '#f1c40f' } },
      // Center bonus collectible (risky)
      { type: 'collectible', position: [0, 12, 0], size: [1, 1, 1], properties: { color: '#e67e22' } },
      // Moving platform to reach center bonus
      { type: 'platform', position: [0, 8, 0], size: [2, 0.5, 2], properties: { color: '#9b59b6', kinematic: true, path: [[0, 8, 0], [0, 11, 0]], speed: 0.5 } },
      // Decorations — trees and mushrooms on islands
      { type: 'decoration', position: [2, 6.5, -17], size: [0.3, 2, 0.3], properties: { shape: 'cylinder', color: '#5d4037' } },
      { type: 'decoration', position: [2, 8, -17], size: [1.5, 1.5, 1.5], properties: { shape: 'sphere', color: '#27ae60' } },
      { type: 'decoration', position: [-17, 8.5, -1], size: [0.3, 0.8, 0.3], properties: { shape: 'cylinder', color: '#f5f5dc' } },
      { type: 'decoration', position: [-17, 9.2, -1], size: [0.8, 0.4, 0.8], properties: { shape: 'sphere', color: '#e74c3c' } },
      { type: 'decoration', position: [16, 9.5, 2], size: [0.6, 0.9, 0.6], properties: { shape: 'dodecahedron', color: '#9b59b6', emissive: true } },
    ]
  },

  gauntlet: {
    name: 'The Gauntlet',
    gameType: 'reach',
    floorType: 'lava',
    environment: { skyColor: '#1a0a0a', fogColor: '#2a0a0a', fogFar: 150, ambientColor: '#553333', ambientIntensity: 0.3, sunColor: '#ff6633', sunIntensity: 0.8 },
    respawnPoint: [0, 2, 20],
    goalPosition: [0, 5, -40],
    entities: [
      // Start platform
      { type: 'platform', position: [0, 0, 20], size: [8, 1, 6], properties: { color: '#2c3e50' } },
      // Section 1: Simple jumps
      { type: 'platform', position: [0, 0, 14], size: [4, 1, 3], properties: { color: '#3498db' } },
      { type: 'platform', position: [0, 0, 8], size: [4, 1, 3], properties: { color: '#2980b9' } },
      { type: 'platform', position: [0, 0, 2], size: [4, 1, 3], properties: { color: '#3498db' } },
      // Section 2: Moving platforms
      { type: 'platform', position: [0, 0, -4], size: [3, 1, 3], properties: { color: '#e67e22', kinematic: true, path: [[-4, 0, -4], [4, 0, -4]], speed: 0.8 } },
      { type: 'platform', position: [0, 0, -10], size: [3, 1, 3], properties: { color: '#e67e22', kinematic: true, path: [[4, 0, -10], [-4, 0, -10]], speed: 0.8 } },
      // Section 3: Obstacle alley
      { type: 'platform', position: [0, 0, -18], size: [6, 1, 10], properties: { color: '#2c3e50' } },
      { type: 'obstacle', position: [-2, 1.5, -16], size: [1, 2, 1], properties: { color: '#e74c3c', rotating: true, speed: 4 } },
      { type: 'obstacle', position: [2, 1.5, -19], size: [1, 2, 1], properties: { color: '#e74c3c', rotating: true, speed: 3 } },
      { type: 'obstacle', position: [0, 1.5, -21], size: [1, 2, 1], properties: { color: '#e74c3c', rotating: true, speed: 5 } },
      // Section 4: Ascending platforms
      { type: 'platform', position: [0, 2, -26], size: [3, 1, 3], properties: { color: '#9b59b6' } },
      { type: 'platform', position: [3, 4, -30], size: [3, 1, 3], properties: { color: '#8e44ad' } },
      { type: 'platform', position: [-2, 6, -34], size: [3, 1, 3], properties: { color: '#9b59b6' } },
      // Goal platform
      { type: 'platform', position: [0, 4, -40], size: [5, 1, 5], properties: { color: '#f1c40f' } },
      // Goal trigger
      { type: 'trigger', position: [0, 6, -40], size: [3, 3, 3], properties: { color: '#f1c40f', rotating: true, speed: 2, isGoal: true } },
      // Decorations — fire braziers along the gauntlet
      { type: 'decoration', position: [4, 1.5, 20], size: [0.3, 0.5, 0.3], properties: { shape: 'cone', color: '#ff6600', emissive: true } },
      { type: 'decoration', position: [-4, 1.5, 20], size: [0.3, 0.5, 0.3], properties: { shape: 'cone', color: '#ff6600', emissive: true } },
      { type: 'decoration', position: [3, 1.5, -18], size: [0.3, 0.5, 0.3], properties: { shape: 'cone', color: '#ff4400', emissive: true } },
      { type: 'decoration', position: [-3, 1.5, -18], size: [0.3, 0.5, 0.3], properties: { shape: 'cone', color: '#ff4400', emissive: true } },
      // Warning flag at goal
      { type: 'decoration', position: [3, 6.5, -40], size: [0.1, 2, 0.1], properties: { shape: 'cylinder', color: '#bdc3c7' } },
      { type: 'decoration', position: [3.4, 7.2, -40], size: [0.6, 0.4, 0.05], properties: { color: '#e74c3c' } },
    ]
  },

  shrinking_arena: {
    name: 'Closing Walls',
    gameType: 'survival',
    floorType: 'solid',
    respawnPoint: [0, 2, 0],
    goalPosition: null,
    entities: [
      // Main arena platform
      { type: 'platform', position: [0, 0, 0], size: [30, 1, 30], properties: { color: '#2c3e50' } },
      // Corner pillars
      { type: 'platform', position: [12, 3, 12], size: [2, 5, 2], properties: { color: '#7f8c8d' } },
      { type: 'platform', position: [-12, 3, 12], size: [2, 5, 2], properties: { color: '#7f8c8d' } },
      { type: 'platform', position: [12, 3, -12], size: [2, 5, 2], properties: { color: '#7f8c8d' } },
      { type: 'platform', position: [-12, 3, -12], size: [2, 5, 2], properties: { color: '#7f8c8d' } },
      // Central elevated platform (safe spot, small)
      { type: 'platform', position: [0, 3, 0], size: [4, 0.5, 4], properties: { color: '#e67e22' } },
      // Obstacles that sweep the arena
      { type: 'obstacle', position: [0, 1.5, 8], size: [20, 2, 1], properties: { color: '#e74c3c', kinematic: true, path: [[0, 1.5, 8], [0, 1.5, -8]], speed: 0.3 } },
      { type: 'obstacle', position: [8, 1.5, 0], size: [1, 2, 20], properties: { color: '#e74c3c', kinematic: true, path: [[8, 1.5, 0], [-8, 1.5, 0]], speed: 0.25 } }
    ]
  },

  parkour_hell: {
    name: 'Parkour Hell',
    gameType: 'reach',
    floorType: 'none',
    environment: { skyColor: '#0a0a1a', fogColor: '#0a0a1a', fogFar: 160, ambientIntensity: 0.35 },
    respawnPoint: [0, 2, 25],
    goalPosition: [0, 40, -25],
    entities: [
      // Start
      { type: 'platform', position: [0, 0, 25], size: [6, 1, 4], properties: { color: '#2c3e50' } },
      // Tiny platforms ascending
      { type: 'platform', position: [3, 3, 20], size: [2, 0.5, 2], properties: { color: '#e74c3c' } },
      { type: 'platform', position: [-2, 6, 16], size: [2, 0.5, 2], properties: { color: '#e67e22' } },
      { type: 'platform', position: [4, 9, 12], size: [2, 0.5, 2], properties: { color: '#f1c40f' } },
      { type: 'platform', position: [-3, 12, 8], size: [2, 0.5, 2], properties: { color: '#2ecc71' } },
      // Moving section
      { type: 'platform', position: [0, 15, 4], size: [2, 0.5, 2], properties: { color: '#3498db', kinematic: true, path: [[-4, 15, 4], [4, 15, 4]], speed: 0.6 } },
      { type: 'platform', position: [0, 18, 0], size: [2, 0.5, 2], properties: { color: '#9b59b6', kinematic: true, path: [[4, 18, 0], [-4, 18, 0]], speed: 0.7 } },
      // Obstacle wall
      { type: 'platform', position: [0, 20, -4], size: [8, 1, 4], properties: { color: '#2c3e50' } },
      { type: 'obstacle', position: [0, 22, -4], size: [6, 1, 1], properties: { color: '#e74c3c', kinematic: true, path: [[-3, 22, -4], [3, 22, -4]], speed: 1.5 } },
      // Final ascent
      { type: 'platform', position: [3, 24, -8], size: [2, 0.5, 2], properties: { color: '#e74c3c' } },
      { type: 'platform', position: [-2, 27, -12], size: [2, 0.5, 2], properties: { color: '#e67e22' } },
      { type: 'platform', position: [1, 30, -16], size: [2, 0.5, 2], properties: { color: '#f1c40f' } },
      { type: 'platform', position: [-3, 33, -20], size: [2, 0.5, 2], properties: { color: '#2ecc71' } },
      { type: 'platform', position: [2, 36, -22], size: [2, 0.5, 2], properties: { color: '#3498db' } },
      // Goal
      { type: 'platform', position: [0, 38, -25], size: [4, 1, 4], properties: { color: '#f1c40f' } },
      { type: 'trigger', position: [0, 40, -25], size: [3, 3, 3], properties: { color: '#f1c40f', rotating: true, speed: 2, isGoal: true } }
    ]
  },

  hex_a_gone: {
    name: 'Hex-A-Gone',
    gameType: 'survival',
    floorType: 'none',
    environment: { skyColor: '#120326', fogColor: '#120326', fogNear: 20, fogFar: 80, ambientColor: '#553388', ambientIntensity: 0.5, sunColor: '#aa77ff', sunIntensity: 0.7 },
    respawnPoint: [0, 12, 0],
    goalPosition: null,
    entities: [
      ...generateHexAGoneEntities(),
      // Floating crystals above arena
      { type: 'decoration', position: [0, 15, 0], size: [1.2, 1.8, 1.2], properties: { shape: 'dodecahedron', color: '#9b59b6', emissive: true, rotating: true, speed: 0.5 } },
      { type: 'decoration', position: [6, 14, 4], size: [0.8, 1.2, 0.8], properties: { shape: 'dodecahedron', color: '#8e44ad', emissive: true, rotating: true, speed: 0.8 } },
      { type: 'decoration', position: [-5, 13, -5], size: [0.8, 1.2, 0.8], properties: { shape: 'dodecahedron', color: '#a569bd', emissive: true, rotating: true, speed: 0.7 } },
    ],
  },

  slime_climb: {
    name: 'Slime Climb',
    gameType: 'reach',
    floorType: 'none',
    environment: { skyColor: '#1a0a0a', fogColor: '#2a0a0a', fogFar: 180, ambientColor: '#553333', ambientIntensity: 0.3, sunColor: '#ff6633', sunIntensity: 0.8 },
    respawnPoint: [0, 2, 15],
    goalPosition: [0, 42, -30],
    hazardPlane: { active: true, type: 'lava', startHeight: -5, riseSpeed: 0.4, maxHeight: 35 },
    entities: [
      // Start platform
      { type: 'platform', position: [0, 0, 15], size: [8, 1, 6], properties: { color: '#2c3e50' } },
      // Ascending ramps
      { type: 'platform', position: [0, 3, 8], size: [5, 1, 4], properties: { color: '#3498db' } },
      { type: 'platform', position: [0, 6, 2], size: [5, 1, 4], properties: { color: '#2980b9' } },
      // Conveyor gauntlet
      { type: 'platform', position: [0, 9, -4], size: [6, 0.3, 3], properties: { color: '#e67e22', isConveyor: true, conveyorDir: [-1, 0, 0], conveyorSpeed: 5 } },
      { type: 'platform', position: [0, 12, -9], size: [6, 0.3, 3], properties: { color: '#e67e22', isConveyor: true, conveyorDir: [1, 0, 0], conveyorSpeed: 6 } },
      // Ice bridge
      { type: 'platform', position: [0, 15, -15], size: [3, 0.3, 8], properties: { color: '#b3e5fc', isIce: true } },
      // Mid platform with obstacle
      { type: 'platform', position: [0, 18, -22], size: [6, 1, 5], properties: { color: '#2c3e50' } },
      { type: 'obstacle', position: [0, 20, -22], size: [4, 1, 1], properties: { color: '#e74c3c', kinematic: true, path: [[-3, 20, -22], [3, 20, -22]], speed: 1.5 } },
      // Ascending narrow platforms
      { type: 'platform', position: [3, 21, -26], size: [3, 0.5, 2], properties: { color: '#9b59b6' } },
      { type: 'platform', position: [-2, 24, -28], size: [3, 0.5, 2], properties: { color: '#8e44ad' } },
      // Conveyor + ice combo
      { type: 'platform', position: [0, 27, -32], size: [5, 0.3, 3], properties: { color: '#e67e22', isConveyor: true, conveyorDir: [0, 0, 1], conveyorSpeed: 4, isIce: true } },
      // Final climb
      { type: 'platform', position: [2, 30, -28], size: [2, 0.5, 2], properties: { color: '#e74c3c' } },
      { type: 'platform', position: [-2, 33, -30], size: [2, 0.5, 2], properties: { color: '#f1c40f' } },
      { type: 'platform', position: [0, 36, -32], size: [3, 0.5, 3], properties: { color: '#2ecc71' } },
      // Goal platform
      { type: 'platform', position: [0, 39, -30], size: [4, 1, 4], properties: { color: '#f1c40f' } },
      { type: 'trigger', position: [0, 41, -30], size: [3, 3, 3], properties: { color: '#f1c40f', rotating: true, speed: 2, isGoal: true } },
      // Decorations — warning flags
      { type: 'decoration', position: [4, 1.5, 15], size: [0.1, 2, 0.1], properties: { shape: 'cylinder', color: '#bdc3c7' } },
      { type: 'decoration', position: [4.4, 2.2, 15], size: [0.6, 0.4, 0.05], properties: { color: '#ff6600' } },
      { type: 'decoration', position: [-3, 19.5, -22], size: [0.1, 2, 0.1], properties: { shape: 'cylinder', color: '#bdc3c7' } },
      { type: 'decoration', position: [-2.6, 20.2, -22], size: [0.6, 0.4, 0.05], properties: { color: '#ff6600' } },
    ]
  },

  wind_tunnel: {
    name: 'Wind Tunnel',
    gameType: 'reach',
    floorType: 'none',
    environment: { skyColor: '#1a2a3a', fogColor: '#1a2a3a', fogFar: 200, ambientIntensity: 0.5, sunIntensity: 1.0 },
    respawnPoint: [0, 4, 30],
    goalPosition: [0, 9, -40],
    entities: [
      // Start platform
      { type: 'platform', position: [0, 2, 30], size: [8, 1, 6], properties: { color: '#2c3e50' } },
      // Narrow bridge + lateral wind
      { type: 'platform', position: [0, 2, 20], size: [2, 0.5, 12], properties: { color: '#3498db' } },
      { type: 'trigger', position: [3, 4, 20], size: [4, 6, 12], properties: { color: '#87ceeb', isWind: true, windForce: [8, 0, 0], opacity: 0.1 } },
      // Platform + alternating wind
      { type: 'platform', position: [0, 3, 8], size: [6, 1, 6], properties: { color: '#2980b9' } },
      { type: 'trigger', position: [-4, 5, 8], size: [4, 6, 6], properties: { color: '#87ceeb', isWind: true, windForce: [-6, 0, 0], opacity: 0.1 } },
      { type: 'trigger', position: [4, 5, 8], size: [4, 6, 6], properties: { color: '#87ceeb', isWind: true, windForce: [6, 0, 0], opacity: 0.1 } },
      // Ice + updraft section
      { type: 'platform', position: [0, 3, -2], size: [4, 0.3, 6], properties: { color: '#b3e5fc', isIce: true } },
      { type: 'trigger', position: [0, 5, -2], size: [4, 6, 6], properties: { color: '#87ceeb', isWind: true, windForce: [0, 5, 0], opacity: 0.08 } },
      // Platform hop with crosswind
      { type: 'platform', position: [-3, 4, -10], size: [3, 0.5, 3], properties: { color: '#e67e22' } },
      { type: 'platform', position: [3, 5, -14], size: [3, 0.5, 3], properties: { color: '#e67e22' } },
      { type: 'platform', position: [-2, 6, -18], size: [3, 0.5, 3], properties: { color: '#e67e22' } },
      { type: 'trigger', position: [0, 6, -14], size: [10, 8, 12], properties: { color: '#87ceeb', isWind: true, windForce: [5, 0, -3], opacity: 0.08 } },
      // Conveyor + wind combo
      { type: 'platform', position: [0, 6, -26], size: [4, 0.3, 8], properties: { color: '#e67e22', isConveyor: true, conveyorDir: [0, 0, 1], conveyorSpeed: 4 } },
      { type: 'trigger', position: [0, 8, -26], size: [6, 6, 8], properties: { color: '#87ceeb', isWind: true, windForce: [0, 0, -6], opacity: 0.1 } },
      // Final narrow bridge + headwind
      { type: 'platform', position: [0, 7, -34], size: [2, 0.5, 6], properties: { color: '#9b59b6' } },
      { type: 'trigger', position: [0, 9, -34], size: [4, 6, 6], properties: { color: '#87ceeb', isWind: true, windForce: [0, 0, 4], opacity: 0.12 } },
      // Goal platform
      { type: 'platform', position: [0, 7, -40], size: [5, 1, 5], properties: { color: '#f1c40f' } },
      { type: 'trigger', position: [0, 9, -40], size: [3, 3, 3], properties: { color: '#f1c40f', rotating: true, speed: 2, isGoal: true } },
      // Decorations — directional banners and wind streamers
      { type: 'decoration', position: [4, 4.5, 30], size: [0.1, 2, 0.1], properties: { shape: 'cylinder', color: '#bdc3c7' } },
      { type: 'decoration', position: [4.4, 5.2, 30], size: [0.6, 0.4, 0.05], properties: { color: '#3498db' } },
      { type: 'decoration', position: [-2, 5, 8], size: [0.1, 1.5, 0.1], properties: { shape: 'cylinder', color: '#bdc3c7' } },
      { type: 'decoration', position: [-1.6, 5.7, 8], size: [0.5, 0.3, 0.05], properties: { color: '#87ceeb' } },
    ]
  },

  blank_canvas: {
    name: 'The Void',
    gameType: 'survival',
    floorType: 'none',
    environment: { skyColor: '#0a0a1a', fogColor: '#0a0a1a', fogFar: 100, ambientIntensity: 0.3 },
    respawnPoint: [0, 3, 0],
    goalPosition: null,
    entities: [
      // Single small starting platform — the agent builds the rest
      { type: 'platform', position: [0, 1, 0], size: [6, 1, 6], properties: { color: '#2c3e50' } },
    ]
  }
};

export function getTemplateNames() {
  return Object.keys(TEMPLATES);
}

export function getTemplateInfo() {
  return Object.entries(TEMPLATES).map(([key, t]) => ({
    id: key,
    name: t.name,
    gameType: t.gameType,
    entityCount: t.entities.length
  }));
}
