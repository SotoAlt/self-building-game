/**
 * ArenaTemplates - Pre-designed arena layouts
 *
 * Loaded via start_game({ template }) for atomic arena setup.
 * Each template defines entities, a goal position, game type, and respawn point.
 *
 * Visual properties per template:
 *   materialTheme: stone | lava_rock | ice_crystal | neon | wood | candy
 *   skyPreset: starfield | sunset | storm | void | aurora
 *   fogDensity: 0.008 (tight) → 0.025 (atmospheric)
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
    environment: {
      skyColor: '#0d1b2a', fogColor: '#0d1b2a', fogDensity: 0.012,
      ambientIntensity: 0.4,
      materialTheme: 'stone', skyPreset: 'starfield',
    },
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
      // Torches on platforms
      { type: 'decoration', position: [5, 5, 2], size: [0.3, 0.5, 0.3], properties: { shape: 'cone', color: '#ff6600', emissive: true } },
      { type: 'decoration', position: [-6, 14, 3], size: [0.3, 0.5, 0.3], properties: { shape: 'cone', color: '#ff6600', emissive: true } },
      { type: 'decoration', position: [1, 28, 1], size: [0.8, 1.2, 0.8], properties: { shape: 'dodecahedron', color: '#9b59b6', emissive: true } },
      // Stone columns framing the base
      { type: 'decoration', position: [7, 3, 7], size: [0.6, 5, 0.6], properties: { shape: 'column', color: '#5a6a7a' } },
      { type: 'decoration', position: [-7, 3, -7], size: [0.6, 5, 0.6], properties: { shape: 'column', color: '#5a6a7a' } },
      { type: 'decoration', position: [7, 3, -7], size: [0.6, 5, 0.6], properties: { shape: 'column', color: '#5a6a7a' } },
      { type: 'decoration', position: [-7, 3, 7], size: [0.6, 5, 0.6], properties: { shape: 'column', color: '#5a6a7a' } },
      // Floating crystals
      { type: 'decoration', position: [3, 12, 4], size: [0.5, 0.8, 0.5], properties: { shape: 'star', color: '#3498db', emissive: true, rotating: true, speed: 0.6 } },
      { type: 'decoration', position: [-4, 20, -2], size: [0.6, 1, 0.6], properties: { shape: 'vase', color: '#2980b9', emissive: true, rotating: true, speed: 0.8 } },
    ]
  },

  floating_islands: {
    name: 'Sky Islands',
    gameType: 'collect',
    floorType: 'none',
    environment: {
      skyColor: '#1a3a5c', fogColor: '#1a3a5c', fogDensity: 0.008,
      ambientIntensity: 0.6, sunIntensity: 1.2,
      materialTheme: 'neon', skyPreset: 'void',
    },
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
      // Trees and mushrooms on islands
      { type: 'decoration', position: [2, 6.5, -17], size: [0.3, 2, 0.3], properties: { shape: 'column', color: '#5d4037' } },
      { type: 'decoration', position: [2, 8, -17], size: [1.5, 1.5, 1.5], properties: { shape: 'dome', color: '#27ae60' } },
      { type: 'decoration', position: [-17, 8.5, -1], size: [0.3, 0.8, 0.3], properties: { shape: 'cylinder', color: '#f5f5dc' } },
      { type: 'decoration', position: [-17, 9.2, -1], size: [0.8, 0.4, 0.8], properties: { shape: 'mushroom_cap', color: '#e74c3c' } },
      { type: 'decoration', position: [16, 9.5, 2], size: [0.6, 0.9, 0.6], properties: { shape: 'teardrop', color: '#9b59b6', emissive: true } },
      // Tentacles under bridges
      { type: 'decoration', position: [0, 3, -9], size: [0.4, 1.5, 0.4], properties: { shape: 'tentacle', color: '#8e44ad', emissive: true } },
      { type: 'decoration', position: [9, 4, 0], size: [0.4, 1.5, 0.4], properties: { shape: 'tentacle', color: '#8e44ad', emissive: true } },
      { type: 'decoration', position: [-9, 3.5, 0], size: [0.4, 1.5, 0.4], properties: { shape: 'tentacle', color: '#8e44ad', emissive: true } },
    ]
  },

  gauntlet: {
    name: 'The Gauntlet',
    gameType: 'reach',
    floorType: 'lava',
    environment: {
      skyColor: '#1a0a0a', fogColor: '#2a0a0a', fogDensity: 0.015,
      ambientColor: '#553333', ambientIntensity: 0.3,
      sunColor: '#ff6633', sunIntensity: 0.8,
      materialTheme: 'lava_rock', skyPreset: 'storm',
    },
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
      // Fire braziers along the gauntlet
      { type: 'decoration', position: [4, 1.5, 20], size: [0.3, 0.5, 0.3], properties: { shape: 'cone', color: '#ff6600', emissive: true } },
      { type: 'decoration', position: [-4, 1.5, 20], size: [0.3, 0.5, 0.3], properties: { shape: 'cone', color: '#ff6600', emissive: true } },
      { type: 'decoration', position: [3, 1.5, -18], size: [0.3, 0.5, 0.3], properties: { shape: 'cone', color: '#ff4400', emissive: true } },
      { type: 'decoration', position: [-3, 1.5, -18], size: [0.3, 0.5, 0.3], properties: { shape: 'cone', color: '#ff4400', emissive: true } },
      // Arch gateway at goal
      { type: 'decoration', position: [0, 5, -37], size: [5, 4, 1], properties: { shape: 'arch', color: '#bdc3c7' } },
      // Warning flag at goal
      { type: 'decoration', position: [3, 6.5, -40], size: [0.1, 2, 0.1], properties: { shape: 'column', color: '#bdc3c7' } },
      { type: 'decoration', position: [3.4, 7.2, -40], size: [0.6, 0.4, 0.05], properties: { color: '#e74c3c' } },
      // Lava horn spikes
      { type: 'decoration', position: [5, 3, 10], size: [0.8, 5, 0.8], properties: { shape: 'horn', color: '#4a2020' } },
      { type: 'decoration', position: [-5, 3, 10], size: [0.8, 5, 0.8], properties: { shape: 'horn', color: '#4a2020' } },
      { type: 'decoration', position: [5, 3, -30], size: [0.8, 5, 0.8], properties: { shape: 'horn', color: '#4a2020' } },
      { type: 'decoration', position: [-5, 3, -30], size: [0.8, 5, 0.8], properties: { shape: 'horn', color: '#4a2020' } },
      // Ember orbs
      { type: 'decoration', position: [5, 6, 10], size: [0.5, 0.5, 0.5], properties: { shape: 'bell', color: '#ff4400', emissive: true, rotating: true, speed: 0.5 } },
      { type: 'decoration', position: [-5, 6, -30], size: [0.5, 0.5, 0.5], properties: { shape: 'bell', color: '#ff4400', emissive: true, rotating: true, speed: 0.7 } },
    ]
  },

  shrinking_arena: {
    name: 'Closing Walls',
    gameType: 'survival',
    floorType: 'solid',
    environment: {
      skyColor: '#1a1a2e', fogColor: '#1a1a2e', fogDensity: 0.010,
      ambientIntensity: 0.5,
      materialTheme: 'stone', skyPreset: 'storm',
    },
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
      { type: 'obstacle', position: [8, 1.5, 0], size: [1, 2, 20], properties: { color: '#e74c3c', kinematic: true, path: [[8, 1.5, 0], [-8, 1.5, 0]], speed: 0.25 } },
      // Pillar top decorations
      { type: 'decoration', position: [12, 6, 12], size: [0.6, 0.9, 0.6], properties: { shape: 'star', color: '#e74c3c', emissive: true, rotating: true, speed: 0.5 } },
      { type: 'decoration', position: [-12, 6, -12], size: [0.6, 0.9, 0.6], properties: { shape: 'horn', color: '#e74c3c', emissive: true, rotating: true, speed: 0.5 } },
      // Center cross marker
      { type: 'decoration', position: [0, 6, 0], size: [1, 1, 1], properties: { shape: 'cross', color: '#e67e22', emissive: true, rotating: true, speed: 0.3 } },
    ]
  },

  parkour_hell: {
    name: 'Parkour Hell',
    gameType: 'reach',
    floorType: 'none',
    environment: {
      skyColor: '#0a0a1a', fogColor: '#0a0a1a', fogDensity: 0.014,
      ambientIntensity: 0.35,
      materialTheme: 'neon', skyPreset: 'void',
    },
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
      { type: 'trigger', position: [0, 40, -25], size: [3, 3, 3], properties: { color: '#f1c40f', rotating: true, speed: 2, isGoal: true } },
      // Floating neon shapes along the path
      { type: 'decoration', position: [5, 5, 22], size: [0.4, 0.6, 0.4], properties: { shape: 'teardrop', color: '#e74c3c', emissive: true } },
      { type: 'decoration', position: [-4, 8, 14], size: [0.4, 0.6, 0.4], properties: { shape: 'flask', color: '#e67e22', emissive: true } },
      { type: 'decoration', position: [6, 11, 10], size: [0.4, 0.6, 0.4], properties: { shape: 'star', color: '#f1c40f', emissive: true } },
      { type: 'decoration', position: [-5, 14, 6], size: [0.4, 0.4, 0.4], properties: { shape: 'sphere', color: '#2ecc71', emissive: true } },
      { type: 'decoration', position: [4, 25, -10], size: [0.4, 0.6, 0.4], properties: { shape: 'heart', color: '#3498db', emissive: true } },
      { type: 'decoration', position: [-4, 35, -22], size: [0.4, 0.6, 0.4], properties: { shape: 'star', color: '#9b59b6', emissive: true } },
    ]
  },

  hex_a_gone: {
    name: 'Hex-A-Gone',
    gameType: 'survival',
    floorType: 'none',
    environment: {
      skyColor: '#120326', fogColor: '#120326', fogDensity: 0.018,
      ambientColor: '#553388', ambientIntensity: 0.5,
      sunColor: '#aa77ff', sunIntensity: 0.7,
      materialTheme: 'ice_crystal', skyPreset: 'aurora',
    },
    respawnPoint: [0, 12, 0],
    goalPosition: null,
    entities: [
      ...generateHexAGoneEntities(),
      // Floating crystals above arena
      { type: 'decoration', position: [0, 15, 0], size: [1.2, 1.8, 1.2], properties: { shape: 'teardrop', color: '#9b59b6', emissive: true, rotating: true, speed: 0.5 } },
      { type: 'decoration', position: [6, 14, 4], size: [0.8, 2, 0.8], properties: { shape: 'tentacle', color: '#8e44ad', emissive: true, rotating: true, speed: 0.8 } },
      { type: 'decoration', position: [-5, 13, -5], size: [0.8, 2, 0.8], properties: { shape: 'tentacle', color: '#a569bd', emissive: true, rotating: true, speed: 0.7 } },
      // Additional floating shapes at edges
      { type: 'decoration', position: [8, 12, 0], size: [0.5, 0.8, 0.5], properties: { shape: 'flask', color: '#bb88dd', emissive: true, rotating: true, speed: 0.6 } },
      { type: 'decoration', position: [-8, 12, 0], size: [0.5, 0.8, 0.5], properties: { shape: 'star', color: '#bb88dd', emissive: true, rotating: true, speed: 0.9 } },
      { type: 'decoration', position: [0, 11, 8], size: [0.5, 1.2, 0.5], properties: { shape: 'tentacle', color: '#cc99ee', emissive: true, rotating: true, speed: 0.4 } },
    ],
  },

  slime_climb: {
    name: 'Slime Climb',
    gameType: 'reach',
    floorType: 'none',
    environment: {
      skyColor: '#1a0a0a', fogColor: '#2a0a0a', fogDensity: 0.012,
      ambientColor: '#553333', ambientIntensity: 0.3,
      sunColor: '#ff6633', sunIntensity: 0.8,
      materialTheme: 'lava_rock', skyPreset: 'storm',
    },
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
      // Warning flags + braziers
      { type: 'decoration', position: [4, 1.5, 15], size: [0.1, 2, 0.1], properties: { shape: 'cylinder', color: '#bdc3c7' } },
      { type: 'decoration', position: [4.4, 2.2, 15], size: [0.6, 0.4, 0.05], properties: { color: '#ff6600' } },
      { type: 'decoration', position: [-3, 19.5, -22], size: [0.1, 2, 0.1], properties: { shape: 'cylinder', color: '#bdc3c7' } },
      { type: 'decoration', position: [-2.6, 20.2, -22], size: [0.6, 0.4, 0.05], properties: { color: '#ff6600' } },
      // Lava horn spikes along climb
      { type: 'decoration', position: [5, 5, 8], size: [0.6, 4, 0.6], properties: { shape: 'horn', color: '#3a1010' } },
      { type: 'decoration', position: [-5, 12, -9], size: [0.8, 1.2, 0.8], properties: { shape: 'mushroom_cap', color: '#3a1010' } },
    ]
  },

  wind_tunnel: {
    name: 'Wind Tunnel',
    gameType: 'reach',
    floorType: 'none',
    environment: {
      skyColor: '#1a2a3a', fogColor: '#1a2a3a', fogDensity: 0.010,
      ambientIntensity: 0.5, sunIntensity: 1.0,
      materialTheme: 'ice_crystal', skyPreset: 'starfield',
    },
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
      // Banners and wind streamers
      { type: 'decoration', position: [4, 4.5, 30], size: [0.1, 2, 0.1], properties: { shape: 'column', color: '#bdc3c7' } },
      { type: 'decoration', position: [4.4, 5.2, 30], size: [0.6, 0.4, 0.05], properties: { color: '#3498db' } },
      { type: 'decoration', position: [-2, 5, 8], size: [0.1, 1.5, 0.1], properties: { shape: 'column', color: '#bdc3c7' } },
      { type: 'decoration', position: [-1.6, 5.7, 8], size: [0.5, 0.3, 0.05], properties: { color: '#87ceeb' } },
      // Ice stars
      { type: 'decoration', position: [4, 5, -2], size: [0.5, 0.8, 0.5], properties: { shape: 'star', color: '#b3e5fc', emissive: true, rotating: true, speed: 0.4 } },
      { type: 'decoration', position: [-3, 8, -26], size: [0.5, 0.8, 0.5], properties: { shape: 'star', color: '#b3e5fc', emissive: true, rotating: true, speed: 0.6 } },
    ]
  },

  // ========== COLLECT ==========
  treasure_trove: {
    name: 'Treasure Trove',
    gameType: 'collect',
    floorType: 'solid',
    environment: {
      skyColor: '#1a0f0a', fogColor: '#1a0f0a', fogDensity: 0.018,
      ambientColor: '#443322', ambientIntensity: 0.3,
      sunColor: '#ffaa44', sunIntensity: 0.6,
      materialTheme: 'wood', skyPreset: 'sunset',
    },
    respawnPoint: [0, 2, 0],
    goalPosition: null,
    entities: [
      // Main floor
      { type: 'platform', position: [0, 0, 0], size: [30, 1, 30], properties: { color: '#3e2723' } },
      // Multi-level ledges
      { type: 'platform', position: [-10, 3, -10], size: [6, 0.5, 6], properties: { color: '#5d4037' } },
      { type: 'platform', position: [10, 5, -10], size: [5, 0.5, 5], properties: { color: '#5d4037' } },
      { type: 'platform', position: [-10, 7, 10], size: [5, 0.5, 5], properties: { color: '#5d4037' } },
      { type: 'platform', position: [10, 4, 10], size: [6, 0.5, 6], properties: { color: '#5d4037' } },
      // Center elevated platform
      { type: 'platform', position: [0, 6, 0], size: [4, 0.5, 4], properties: { color: '#4e342e' } },
      // Ice bridge between ledges
      { type: 'platform', position: [0, 4, -10], size: [12, 0.3, 2], properties: { color: '#b3e5fc', isIce: true } },
      // Conveyor ramp
      { type: 'platform', position: [0, 3, 10], size: [8, 0.3, 3], properties: { color: '#e67e22', isConveyor: true, conveyorDir: [1, 0, 0], conveyorSpeed: 4 } },
      // Pillars as obstacles
      { type: 'platform', position: [5, 3, 0], size: [2, 5, 2], properties: { color: '#4e342e' } },
      { type: 'platform', position: [-5, 3, 0], size: [2, 5, 2], properties: { color: '#4e342e' } },
      // Collectibles on ledges and hidden spots
      { type: 'collectible', position: [-10, 5, -10], size: [1, 1, 1], properties: { color: '#f1c40f' } },
      { type: 'collectible', position: [10, 7, -10], size: [1, 1, 1], properties: { color: '#f1c40f' } },
      { type: 'collectible', position: [-10, 9, 10], size: [1, 1, 1], properties: { color: '#f1c40f' } },
      { type: 'collectible', position: [10, 6, 10], size: [1, 1, 1], properties: { color: '#f1c40f' } },
      { type: 'collectible', position: [0, 8, 0], size: [1, 1, 1], properties: { color: '#e67e22' } },
      { type: 'collectible', position: [12, 2, 12], size: [1, 1, 1], properties: { color: '#f1c40f' } },
      { type: 'collectible', position: [-12, 2, -12], size: [1, 1, 1], properties: { color: '#f1c40f' } },
      { type: 'collectible', position: [0, 2, -12], size: [1, 1, 1], properties: { color: '#f1c40f' } },
      { type: 'collectible', position: [0, 2, 12], size: [1, 1, 1], properties: { color: '#f1c40f' } },
      // Moving obstacle
      { type: 'obstacle', position: [0, 1.5, 5], size: [10, 2, 1], properties: { color: '#e74c3c', kinematic: true, path: [[0, 1.5, 5], [0, 1.5, -5]], speed: 0.4 } },
      // Torches
      { type: 'decoration', position: [14, 2, 14], size: [0.3, 0.5, 0.3], properties: { shape: 'cone', color: '#ff6600', emissive: true } },
      { type: 'decoration', position: [-14, 2, -14], size: [0.3, 0.5, 0.3], properties: { shape: 'cone', color: '#ff6600', emissive: true } },
      { type: 'decoration', position: [14, 2, -14], size: [0.3, 0.5, 0.3], properties: { shape: 'cone', color: '#ff6600', emissive: true } },
      { type: 'decoration', position: [-14, 2, 14], size: [0.3, 0.5, 0.3], properties: { shape: 'cone', color: '#ff6600', emissive: true } },
      // Wooden props
      { type: 'decoration', position: [14, 2, 0], size: [0.5, 3, 0.5], properties: { shape: 'column', color: '#5d4037' } },
      { type: 'decoration', position: [-14, 2, 0], size: [0.5, 3, 0.5], properties: { shape: 'vase', color: '#5d4037' } },
      // Treasure dome
      { type: 'decoration', position: [0, 6.5, 0], size: [3, 1.5, 3], properties: { shape: 'dome', color: '#ffaa44', emissive: true } },
    ]
  },

  // ========== SURVIVAL ==========
  ice_rink: {
    name: 'Ice Rink',
    gameType: 'survival',
    floorType: 'solid',
    environment: {
      skyColor: '#1a2a3a', fogColor: '#1a2a3a', fogDensity: 0.010,
      ambientIntensity: 0.5, sunColor: '#aaddff', sunIntensity: 0.9,
      materialTheme: 'ice_crystal', skyPreset: 'starfield',
    },
    respawnPoint: [0, 2, 0],
    goalPosition: null,
    entities: [
      // Large ice floor
      { type: 'platform', position: [0, 0, 0], size: [30, 1, 30], properties: { color: '#b3e5fc', isIce: true } },
      // Corner safe zones (small, non-ice)
      { type: 'platform', position: [12, 0.5, 12], size: [4, 0.5, 4], properties: { color: '#2ecc71' } },
      { type: 'platform', position: [-12, 0.5, 12], size: [4, 0.5, 4], properties: { color: '#2ecc71' } },
      { type: 'platform', position: [12, 0.5, -12], size: [4, 0.5, 4], properties: { color: '#2ecc71' } },
      { type: 'platform', position: [-12, 0.5, -12], size: [4, 0.5, 4], properties: { color: '#2ecc71' } },
      // Sweeping obstacles
      { type: 'obstacle', position: [0, 1.5, 0], size: [20, 1.5, 1], properties: { color: '#e74c3c', rotating: true, speed: 1.5 } },
      { type: 'obstacle', position: [0, 1.5, 0], size: [1, 1.5, 20], properties: { color: '#e74c3c', rotating: true, speed: 2 } },
      // Wind zones near edges pushing players off
      { type: 'trigger', position: [14, 3, 0], size: [4, 6, 30], properties: { color: '#87ceeb', isWind: true, windForce: [6, 0, 0], opacity: 0.08 } },
      { type: 'trigger', position: [-14, 3, 0], size: [4, 6, 30], properties: { color: '#87ceeb', isWind: true, windForce: [-6, 0, 0], opacity: 0.08 } },
      { type: 'trigger', position: [0, 3, 14], size: [30, 6, 4], properties: { color: '#87ceeb', isWind: true, windForce: [0, 0, 6], opacity: 0.08 } },
      { type: 'trigger', position: [0, 3, -14], size: [30, 6, 4], properties: { color: '#87ceeb', isWind: true, windForce: [0, 0, -6], opacity: 0.08 } },
      // Center star crystal
      { type: 'decoration', position: [0, 8, 0], size: [1.5, 1.5, 1.5], properties: { shape: 'star', color: '#aaddff', emissive: true, rotating: true, speed: 0.3 } },
      // Ice columns at corners
      { type: 'decoration', position: [14, 3, 14], size: [0.5, 5, 0.5], properties: { shape: 'column', color: '#b3e5fc' } },
      { type: 'decoration', position: [-14, 3, -14], size: [0.5, 5, 0.5], properties: { shape: 'column', color: '#b3e5fc' } },
      { type: 'decoration', position: [14, 3, -14], size: [0.5, 5, 0.5], properties: { shape: 'column', color: '#b3e5fc' } },
      { type: 'decoration', position: [-14, 3, 14], size: [0.5, 5, 0.5], properties: { shape: 'column', color: '#b3e5fc' } },
      // Small teardrop crystals on ice
      { type: 'decoration', position: [6, 1.5, 6], size: [0.4, 0.6, 0.4], properties: { shape: 'teardrop', color: '#e0f7fa', emissive: true } },
      { type: 'decoration', position: [-6, 1.5, -6], size: [0.4, 0.6, 0.4], properties: { shape: 'teardrop', color: '#e0f7fa', emissive: true } },
    ]
  },

  // ========== KING OF THE HILL ==========
  king_plateau: {
    name: 'King\'s Plateau',
    gameType: 'king',
    floorType: 'solid',
    environment: {
      skyColor: '#1a1a2e', fogColor: '#1a1a2e', fogDensity: 0.010,
      ambientIntensity: 0.4, sunColor: '#ffdd44', sunIntensity: 1.0,
      materialTheme: 'stone', skyPreset: 'sunset',
    },
    respawnPoint: [0, 2, 15],
    goalPosition: null,
    entities: [
      // Base floor
      { type: 'platform', position: [0, 0, 0], size: [35, 1, 35], properties: { color: '#2c3e50' } },
      // Central elevated hill
      { type: 'platform', position: [0, 3, 0], size: [8, 2, 8], properties: { color: '#f1c40f' } },
      // Hill zone trigger
      { type: 'trigger', position: [0, 5, 0], size: [7, 4, 7], properties: { color: '#f1c40f', isHill: true, opacity: 0.3 } },
      // 4 ramps leading up
      { type: 'ramp', position: [0, 1.5, 7], size: [4, 1, 6], properties: { color: '#7f8c8d' } },
      { type: 'ramp', position: [0, 1.5, -7], size: [4, 1, 6], properties: { color: '#7f8c8d' } },
      { type: 'ramp', position: [7, 1.5, 0], size: [6, 1, 4], properties: { color: '#7f8c8d' } },
      { type: 'ramp', position: [-7, 1.5, 0], size: [6, 1, 4], properties: { color: '#7f8c8d' } },
      // Corner mini-hills
      { type: 'platform', position: [12, 1.5, 12], size: [5, 1, 5], properties: { color: '#e67e22' } },
      { type: 'trigger', position: [12, 3, 12], size: [4, 3, 4], properties: { color: '#e67e22', isHill: true, opacity: 0.3 } },
      { type: 'platform', position: [-12, 1.5, -12], size: [5, 1, 5], properties: { color: '#e67e22' } },
      { type: 'trigger', position: [-12, 3, -12], size: [4, 3, 4], properties: { color: '#e67e22', isHill: true, opacity: 0.3 } },
      // Patrolling obstacles on ramps
      { type: 'obstacle', position: [0, 2.5, 7], size: [2, 1.5, 1], properties: { color: '#e74c3c', kinematic: true, path: [[-3, 2.5, 7], [3, 2.5, 7]], speed: 1.2 } },
      { type: 'obstacle', position: [7, 2.5, 0], size: [1, 1.5, 2], properties: { color: '#e74c3c', kinematic: true, path: [[7, 2.5, -3], [7, 2.5, 3]], speed: 1 } },
      // Crown star decoration
      { type: 'decoration', position: [0, 8, 0], size: [1, 1.5, 1], properties: { shape: 'star', color: '#f1c40f', emissive: true, rotating: true, speed: 0.5 } },
      // Stone pillars at hill base
      { type: 'decoration', position: [5, 3, 5], size: [0.5, 5, 0.5], properties: { shape: 'column', color: '#5a6a7a' } },
      { type: 'decoration', position: [-5, 3, 5], size: [0.5, 5, 0.5], properties: { shape: 'column', color: '#5a6a7a' } },
      { type: 'decoration', position: [5, 3, -5], size: [0.5, 5, 0.5], properties: { shape: 'column', color: '#5a6a7a' } },
      { type: 'decoration', position: [-5, 3, -5], size: [0.5, 5, 0.5], properties: { shape: 'cross', color: '#5a6a7a' } },
      // Flags at mini-hills
      { type: 'decoration', position: [14, 3.5, 12], size: [0.1, 3, 0.1], properties: { shape: 'cylinder', color: '#bdc3c7' } },
      { type: 'decoration', position: [14.4, 4.5, 12], size: [0.6, 0.4, 0.05], properties: { color: '#e67e22' } },
      { type: 'decoration', position: [-14, 3.5, -12], size: [0.1, 3, 0.1], properties: { shape: 'cylinder', color: '#bdc3c7' } },
      { type: 'decoration', position: [-14.4, 4.5, -12], size: [0.6, 0.4, 0.05], properties: { color: '#e67e22' } },
    ]
  },

  king_islands: {
    name: 'Island Kingdoms',
    gameType: 'king',
    floorType: 'none',
    environment: {
      skyColor: '#0d1b2a', fogColor: '#0d1b2a', fogDensity: 0.010,
      ambientIntensity: 0.4, sunColor: '#ffaa00', sunIntensity: 0.9,
      materialTheme: 'stone', skyPreset: 'sunset',
    },
    respawnPoint: [0, 6, 0],
    goalPosition: null,
    entities: [
      // Center island + hill
      { type: 'platform', position: [0, 4, 0], size: [8, 2, 8], properties: { color: '#2c3e50' } },
      { type: 'trigger', position: [0, 6.5, 0], size: [6, 3, 6], properties: { color: '#f1c40f', isHill: true, opacity: 0.3 } },
      // North island + hill
      { type: 'platform', position: [0, 4, -20], size: [7, 2, 7], properties: { color: '#27ae60' } },
      { type: 'trigger', position: [0, 6.5, -20], size: [5, 3, 5], properties: { color: '#e67e22', isHill: true, opacity: 0.3 } },
      // South island + hill
      { type: 'platform', position: [0, 4, 20], size: [7, 2, 7], properties: { color: '#27ae60' } },
      { type: 'trigger', position: [0, 6.5, 20], size: [5, 3, 5], properties: { color: '#e67e22', isHill: true, opacity: 0.3 } },
      // Bridges (narrow + wind)
      { type: 'platform', position: [0, 4, -10], size: [2, 0.5, 8], properties: { color: '#8e44ad' } },
      { type: 'platform', position: [0, 4, 10], size: [2, 0.5, 8], properties: { color: '#8e44ad' } },
      // Wind on bridges
      { type: 'trigger', position: [3, 6, -10], size: [4, 5, 8], properties: { color: '#87ceeb', isWind: true, windForce: [5, 0, 0], opacity: 0.08 } },
      { type: 'trigger', position: [-3, 6, 10], size: [4, 5, 8], properties: { color: '#87ceeb', isWind: true, windForce: [-5, 0, 0], opacity: 0.08 } },
      // Crown star above center
      { type: 'decoration', position: [0, 10, 0], size: [1.2, 1.8, 1.2], properties: { shape: 'star', color: '#f1c40f', emissive: true, rotating: true, speed: 0.4 } },
      // Domes sheltering bridges
      { type: 'decoration', position: [0, 5.5, -10], size: [2, 1, 2], properties: { shape: 'dome', color: '#8e44ad', emissive: true } },
      { type: 'decoration', position: [0, 5.5, 10], size: [2, 1, 2], properties: { shape: 'dome', color: '#8e44ad', emissive: true } },
      // Columns on islands
      { type: 'decoration', position: [3, 7, -20], size: [0.4, 4, 0.4], properties: { shape: 'column', color: '#5a6a7a' } },
      { type: 'decoration', position: [-3, 7, 20], size: [0.4, 4, 0.4], properties: { shape: 'column', color: '#5a6a7a' } },
    ]
  },

  // ========== HOT POTATO ==========
  hot_potato_arena: {
    name: 'Curse Arena',
    gameType: 'hot_potato',
    floorType: 'solid',
    environment: {
      skyColor: '#1a0a0a', fogColor: '#2a0a0a', fogDensity: 0.015,
      ambientColor: '#553333', ambientIntensity: 0.4,
      sunColor: '#ff4444', sunIntensity: 0.7,
      materialTheme: 'lava_rock', skyPreset: 'storm',
    },
    respawnPoint: [0, 2, 0],
    goalPosition: null,
    entities: [
      // Circular arena floor
      { type: 'platform', position: [0, 0, 0], size: [25, 1, 25], properties: { color: '#2c3e50' } },
      // Pillars for cover
      { type: 'platform', position: [6, 3, 6], size: [2, 5, 2], properties: { color: '#7f8c8d' } },
      { type: 'platform', position: [-6, 3, 6], size: [2, 5, 2], properties: { color: '#7f8c8d' } },
      { type: 'platform', position: [6, 3, -6], size: [2, 5, 2], properties: { color: '#7f8c8d' } },
      { type: 'platform', position: [-6, 3, -6], size: [2, 5, 2], properties: { color: '#7f8c8d' } },
      { type: 'platform', position: [0, 3, 9], size: [2, 5, 2], properties: { color: '#7f8c8d' } },
      { type: 'platform', position: [0, 3, -9], size: [2, 5, 2], properties: { color: '#7f8c8d' } },
      // Speed boost pads
      { type: 'trigger', position: [10, 1, 0], size: [3, 1, 3], properties: { color: '#2ecc71', isSpeedBoost: true } },
      { type: 'trigger', position: [-10, 1, 0], size: [3, 1, 3], properties: { color: '#2ecc71', isSpeedBoost: true } },
      // Moving obstacles that converge
      { type: 'obstacle', position: [0, 1.5, 0], size: [16, 1.5, 1], properties: { color: '#e74c3c', rotating: true, speed: 1.5 } },
      // Curse heart above
      { type: 'decoration', position: [0, 8, 0], size: [1.5, 1.5, 1.5], properties: { shape: 'heart', color: '#e74c3c', emissive: true, rotating: true, speed: 1 } },
      // Pillar top warning bells
      { type: 'decoration', position: [6, 6, 6], size: [0.4, 0.6, 0.4], properties: { shape: 'bell', color: '#ff4400', emissive: true } },
      { type: 'decoration', position: [-6, 6, -6], size: [0.4, 0.6, 0.4], properties: { shape: 'bell', color: '#ff4400', emissive: true } },
      { type: 'decoration', position: [6, 6, -6], size: [0.4, 0.6, 0.4], properties: { shape: 'bell', color: '#ff4400', emissive: true } },
      { type: 'decoration', position: [-6, 6, 6], size: [0.4, 0.6, 0.4], properties: { shape: 'bell', color: '#ff4400', emissive: true } },
    ]
  },

  hot_potato_platforms: {
    name: 'Curse Platforms',
    gameType: 'hot_potato',
    floorType: 'none',
    environment: {
      skyColor: '#0a0a1a', fogColor: '#0a0a1a', fogDensity: 0.018,
      ambientColor: '#332233', ambientIntensity: 0.35,
      sunColor: '#ff6666', sunIntensity: 0.7,
      materialTheme: 'neon', skyPreset: 'void',
    },
    respawnPoint: [0, 6, 0],
    goalPosition: null,
    entities: [
      // Central platform
      { type: 'platform', position: [0, 2, 0], size: [8, 1, 8], properties: { color: '#2c3e50' } },
      // Surrounding platforms at various heights
      { type: 'platform', position: [10, 3, 0], size: [5, 0.5, 5], properties: { color: '#3498db' } },
      { type: 'platform', position: [-10, 4, 0], size: [5, 0.5, 5], properties: { color: '#2980b9' } },
      { type: 'platform', position: [0, 3, 10], size: [5, 0.5, 5], properties: { color: '#3498db' } },
      { type: 'platform', position: [0, 5, -10], size: [5, 0.5, 5], properties: { color: '#2980b9' } },
      { type: 'platform', position: [8, 6, 8], size: [4, 0.5, 4], properties: { color: '#9b59b6' } },
      { type: 'platform', position: [-8, 5, -8], size: [4, 0.5, 4], properties: { color: '#8e44ad' } },
      // Connecting bridges
      { type: 'platform', position: [5, 2.5, 0], size: [4, 0.3, 2], properties: { color: '#7f8c8d' } },
      { type: 'platform', position: [-5, 3, 0], size: [4, 0.3, 2], properties: { color: '#7f8c8d' } },
      { type: 'platform', position: [0, 2.5, 5], size: [2, 0.3, 4], properties: { color: '#7f8c8d' } },
      { type: 'platform', position: [0, 3.5, -5], size: [2, 0.3, 4], properties: { color: '#7f8c8d' } },
      // Ice on some platforms
      { type: 'platform', position: [8, 6.3, 8], size: [3.5, 0.2, 3.5], properties: { color: '#b3e5fc', isIce: true } },
      // Obstacle
      { type: 'obstacle', position: [0, 3.5, 0], size: [6, 1, 1], properties: { color: '#e74c3c', rotating: true, speed: 2 } },
      // Floating shapes between platforms
      { type: 'decoration', position: [5, 4, 5], size: [0.4, 0.4, 0.3], properties: { shape: 'heart', color: '#ff6666', emissive: true } },
      { type: 'decoration', position: [-5, 5, -5], size: [0.4, 0.6, 0.4], properties: { shape: 'bell', color: '#ff6666', emissive: true } },
      { type: 'decoration', position: [0, 7, 0], size: [0.8, 0.8, 0.8], properties: { shape: 'heart', color: '#e74c3c', emissive: true, rotating: true, speed: 0.8 } },
    ]
  },

  // ========== RACE ==========
  checkpoint_dash: {
    name: 'Checkpoint Dash',
    gameType: 'race',
    floorType: 'none',
    environment: {
      skyColor: '#0d1b2a', fogColor: '#0d1b2a', fogDensity: 0.010,
      ambientIntensity: 0.4, sunIntensity: 1.0,
      materialTheme: 'stone', skyPreset: 'starfield',
    },
    respawnPoint: [0, 2, 30],
    goalPosition: null,
    entities: [
      // Start platform
      { type: 'platform', position: [0, 0, 30], size: [8, 1, 6], properties: { color: '#2c3e50' } },
      // CP0 — simple jump
      { type: 'platform', position: [0, 0, 20], size: [5, 1, 4], properties: { color: '#3498db' } },
      { type: 'trigger', position: [0, 2, 20], size: [3, 3, 3], properties: { color: '#2ecc71', isCheckpoint: true, checkpointIndex: 0, rotating: true, speed: 1 } },
      // CP1 — moving platforms
      { type: 'platform', position: [0, 1, 12], size: [3, 0.5, 3], properties: { color: '#e67e22', kinematic: true, path: [[-4, 1, 12], [4, 1, 12]], speed: 0.8 } },
      { type: 'trigger', position: [0, 3, 12], size: [3, 3, 3], properties: { color: '#95a5a6', isCheckpoint: true, checkpointIndex: 1, rotating: true, speed: 1 } },
      // CP2 — conveyor section
      { type: 'platform', position: [0, 1, 4], size: [6, 0.3, 4], properties: { color: '#e67e22', isConveyor: true, conveyorDir: [-1, 0, 0], conveyorSpeed: 5 } },
      { type: 'trigger', position: [0, 3, 4], size: [3, 3, 3], properties: { color: '#95a5a6', isCheckpoint: true, checkpointIndex: 2, rotating: true, speed: 1 } },
      // CP3 — ice + wind
      { type: 'platform', position: [0, 2, -4], size: [4, 0.3, 4], properties: { color: '#b3e5fc', isIce: true } },
      { type: 'trigger', position: [3, 4, -4], size: [4, 5, 4], properties: { color: '#87ceeb', isWind: true, windForce: [6, 0, 0], opacity: 0.08 } },
      { type: 'trigger', position: [0, 4, -4], size: [3, 3, 3], properties: { color: '#95a5a6', isCheckpoint: true, checkpointIndex: 3, rotating: true, speed: 1 } },
      // CP4 — obstacle gauntlet
      { type: 'platform', position: [0, 2, -14], size: [6, 1, 8], properties: { color: '#2c3e50' } },
      { type: 'obstacle', position: [0, 4, -12], size: [4, 1, 1], properties: { color: '#e74c3c', kinematic: true, path: [[-3, 4, -12], [3, 4, -12]], speed: 1.5 } },
      { type: 'obstacle', position: [0, 4, -16], size: [4, 1, 1], properties: { color: '#e74c3c', kinematic: true, path: [[3, 4, -16], [-3, 4, -16]], speed: 1.8 } },
      { type: 'trigger', position: [0, 4, -14], size: [3, 3, 3], properties: { color: '#95a5a6', isCheckpoint: true, checkpointIndex: 4, rotating: true, speed: 1 } },
      // CP5 — final sprint
      { type: 'platform', position: [3, 4, -22], size: [2, 0.5, 2], properties: { color: '#9b59b6' } },
      { type: 'platform', position: [-2, 6, -26], size: [2, 0.5, 2], properties: { color: '#8e44ad' } },
      { type: 'platform', position: [0, 8, -30], size: [4, 1, 4], properties: { color: '#f1c40f' } },
      { type: 'trigger', position: [0, 10, -30], size: [3, 3, 3], properties: { color: '#95a5a6', isCheckpoint: true, checkpointIndex: 5, rotating: true, speed: 1 } },
      // Start flag
      { type: 'decoration', position: [4, 1.5, 30], size: [0.1, 2, 0.1], properties: { shape: 'column', color: '#bdc3c7' } },
      { type: 'decoration', position: [4.4, 2.2, 30], size: [0.6, 0.4, 0.05], properties: { color: '#2ecc71' } },
      // Arch gateway at start
      { type: 'decoration', position: [0, 1, 27], size: [6, 3, 0.8], properties: { shape: 'arch', color: '#2ecc71' } },
      // Directional arrows along the path
      { type: 'decoration', position: [3, 2, 16], size: [0.4, 0.6, 0.3], properties: { shape: 'arrow', color: '#2ecc71', emissive: true } },
      { type: 'decoration', position: [-1, 3, 8], size: [0.4, 0.6, 0.3], properties: { shape: 'arrow', color: '#95a5a6', emissive: true } },
      { type: 'decoration', position: [1, 5, -8], size: [0.4, 0.6, 0.3], properties: { shape: 'arrow', color: '#95a5a6', emissive: true } },
      { type: 'decoration', position: [-1, 7, -24], size: [0.5, 0.8, 0.3], properties: { shape: 'star', color: '#9b59b6', emissive: true } },
    ]
  },

  race_circuit: {
    name: 'Race Circuit',
    gameType: 'race',
    floorType: 'solid',
    environment: {
      skyColor: '#1a1a2e', fogColor: '#1a1a2e', fogDensity: 0.008,
      ambientIntensity: 0.5, sunIntensity: 1.1,
      materialTheme: 'stone', skyPreset: 'sunset',
    },
    respawnPoint: [0, 2, 18],
    goalPosition: null,
    entities: [
      // Circular track floor
      { type: 'platform', position: [0, 0, 0], size: [45, 1, 45], properties: { color: '#2c3e50' } },
      // Start zone
      { type: 'platform', position: [0, 0.5, 18], size: [6, 0.3, 4], properties: { color: '#2ecc71' } },
      // Checkpoints around the circuit (clockwise)
      { type: 'trigger', position: [15, 2, 15], size: [3, 3, 3], properties: { color: '#2ecc71', isCheckpoint: true, checkpointIndex: 0, rotating: true, speed: 1 } },
      { type: 'trigger', position: [18, 2, 0], size: [3, 3, 3], properties: { color: '#95a5a6', isCheckpoint: true, checkpointIndex: 1, rotating: true, speed: 1 } },
      { type: 'trigger', position: [15, 2, -15], size: [3, 3, 3], properties: { color: '#95a5a6', isCheckpoint: true, checkpointIndex: 2, rotating: true, speed: 1 } },
      { type: 'trigger', position: [0, 2, -18], size: [3, 3, 3], properties: { color: '#95a5a6', isCheckpoint: true, checkpointIndex: 3, rotating: true, speed: 1 } },
      { type: 'trigger', position: [-15, 2, -15], size: [3, 3, 3], properties: { color: '#95a5a6', isCheckpoint: true, checkpointIndex: 4, rotating: true, speed: 1 } },
      { type: 'trigger', position: [-18, 2, 0], size: [3, 3, 3], properties: { color: '#95a5a6', isCheckpoint: true, checkpointIndex: 5, rotating: true, speed: 1 } },
      { type: 'trigger', position: [-15, 2, 15], size: [3, 3, 3], properties: { color: '#95a5a6', isCheckpoint: true, checkpointIndex: 6, rotating: true, speed: 1 } },
      { type: 'trigger', position: [0, 2, 18], size: [3, 3, 3], properties: { color: '#95a5a6', isCheckpoint: true, checkpointIndex: 7, rotating: true, speed: 1 } },
      // Ice section (east side)
      { type: 'platform', position: [18, 0.5, 0], size: [6, 0.3, 10], properties: { color: '#b3e5fc', isIce: true } },
      // Conveyor section (west side)
      { type: 'platform', position: [-18, 0.5, 0], size: [6, 0.3, 10], properties: { color: '#e67e22', isConveyor: true, conveyorDir: [0, 0, -1], conveyorSpeed: 4 } },
      // Wind zone (north)
      { type: 'trigger', position: [0, 3, -18], size: [10, 5, 4], properties: { color: '#87ceeb', isWind: true, windForce: [-4, 0, 0], opacity: 0.08 } },
      // Obstacles
      { type: 'obstacle', position: [15, 1.5, 0], size: [1, 2, 6], properties: { color: '#e74c3c', kinematic: true, path: [[15, 1.5, -3], [15, 1.5, 3]], speed: 1 } },
      { type: 'obstacle', position: [-15, 1.5, 0], size: [1, 2, 6], properties: { color: '#e74c3c', kinematic: true, path: [[-15, 1.5, 3], [-15, 1.5, -3]], speed: 1.2 } },
      // Center decoration
      { type: 'decoration', position: [0, 5, 0], size: [2, 3, 2], properties: { shape: 'star', color: '#9b59b6', emissive: true, rotating: true, speed: 0.3 } },
      // Start/finish arch
      { type: 'decoration', position: [0, 1, 15], size: [6, 4, 1], properties: { shape: 'arch', color: '#2ecc71' } },
      // Corner columns
      { type: 'decoration', position: [20, 3, 20], size: [0.5, 5, 0.5], properties: { shape: 'column', color: '#5a6a7a' } },
      { type: 'decoration', position: [-20, 3, 20], size: [0.5, 5, 0.5], properties: { shape: 'column', color: '#5a6a7a' } },
      { type: 'decoration', position: [20, 3, -20], size: [0.5, 5, 0.5], properties: { shape: 'column', color: '#5a6a7a' } },
      { type: 'decoration', position: [-20, 3, -20], size: [0.5, 5, 0.5], properties: { shape: 'column', color: '#5a6a7a' } },
      // Column-top arrows
      { type: 'decoration', position: [20, 6, 20], size: [0.5, 0.8, 0.4], properties: { shape: 'arrow', color: '#9b59b6', emissive: true } },
      { type: 'decoration', position: [-20, 6, -20], size: [0.5, 0.8, 0.4], properties: { shape: 'arrow', color: '#9b59b6', emissive: true } },
    ]
  },

  blank_canvas: {
    name: 'The Void',
    gameType: 'survival',
    floorType: 'none',
    environment: {
      skyColor: '#0a0a1a', fogColor: '#0a0a1a', fogDensity: 0.020,
      ambientIntensity: 0.3,
      materialTheme: 'neon', skyPreset: 'void',
    },
    respawnPoint: [0, 3, 0],
    goalPosition: null,
    entities: [
      // Single small starting platform — the agent builds the rest
      { type: 'platform', position: [0, 1, 0], size: [6, 1, 6], properties: { color: '#2c3e50' } },
    ]
  }
};

// Deep-clone and randomize a template so it feels different each time
export function randomizeTemplate(template) {
  const tmpl = JSON.parse(JSON.stringify(template));

  for (const entity of tmpl.entities) {
    const props = entity.properties;

    // Nudge positions for non-fixed entities
    if (!props?.isCheckpoint && !props?.isHill && !props?.isGoal) {
      entity.position[0] += (Math.random() - 0.5) * 2;
      entity.position[2] += (Math.random() - 0.5) * 2;
    }

    // Vary speeds ±30%
    if (props?.speed) {
      props.speed *= 0.7 + Math.random() * 0.6;
    }
    if (props?.conveyorSpeed) {
      props.conveyorSpeed *= 0.7 + Math.random() * 0.6;
    }

    if (props?.breakDelay) {
      const jitter = Math.floor((Math.random() - 0.5) * 200);
      props.breakDelay = Math.max(100, props.breakDelay + jitter);
    }
  }

  if (tmpl.hazardPlane?.riseSpeed) {
    tmpl.hazardPlane.riseSpeed *= 0.8 + Math.random() * 0.4;
  }

  return tmpl;
}

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
