/**
 * ArenaTemplates - Pre-designed arena layouts
 *
 * The agent can load these instantly via load_template tool.
 * Each template defines entities, a goal position, game type, and respawn point.
 */

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
      { type: 'obstacle', position: [4, 23, -4], size: [1, 2, 1], properties: { color: '#e74c3c', rotating: true, speed: 2 } }
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
      { type: 'platform', position: [0, 8, 0], size: [2, 0.5, 2], properties: { color: '#9b59b6', kinematic: true, path: [[0, 8, 0], [0, 11, 0]], speed: 0.5 } }
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
      { type: 'trigger', position: [0, 6, -40], size: [3, 3, 3], properties: { color: '#f1c40f', rotating: true, speed: 2, isGoal: true } }
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
