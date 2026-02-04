/**
 * Game World Skill for OpenClaw
 *
 * Provides tools for AI agents to control the 3D game world.
 * Communicates with the game server via HTTP API.
 */

const GAME_SERVER_URL = process.env.GAME_SERVER_URL || 'http://localhost:3000';

/**
 * Make HTTP request to game server
 */
async function gameRequest(endpoint, method = 'GET', body = null) {
  const url = `${GAME_SERVER_URL}${endpoint}`;
  const options = {
    method,
    headers: {
      'Content-Type': 'application/json',
    },
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  try {
    const response = await fetch(url, options);
    const data = await response.json();

    if (!response.ok) {
      return { success: false, error: data.error || `HTTP ${response.status}` };
    }

    return { success: true, ...data };
  } catch (error) {
    return { success: false, error: `Connection failed: ${error.message}` };
  }
}

/**
 * Tool: spawn_entity
 * Create a new entity in the world
 */
async function spawn_entity({ type, position, size = [1, 1, 1], properties = {} }) {
  if (!type || !position) {
    return { success: false, error: 'Missing required parameters: type, position' };
  }

  const validTypes = ['platform', 'ramp', 'collectible', 'obstacle', 'trigger'];
  if (!validTypes.includes(type)) {
    return { success: false, error: `Invalid type. Must be one of: ${validTypes.join(', ')}` };
  }

  return gameRequest('/api/world/spawn', 'POST', {
    type,
    position,
    size,
    properties
  });
}

/**
 * Tool: modify_entity
 * Update an existing entity
 */
async function modify_entity({ id, changes }) {
  if (!id || !changes) {
    return { success: false, error: 'Missing required parameters: id, changes' };
  }

  return gameRequest('/api/world/modify', 'POST', { id, changes });
}

/**
 * Tool: destroy_entity
 * Remove an entity from the world
 */
async function destroy_entity({ id }) {
  if (!id) {
    return { success: false, error: 'Missing required parameter: id' };
  }

  return gameRequest('/api/world/destroy', 'POST', { id });
}

/**
 * Tool: set_physics
 * Modify global physics parameters
 */
async function set_physics({ gravity, friction, bounce }) {
  const params = {};

  if (gravity !== undefined) {
    if (gravity < -20 || gravity > 0) {
      return { success: false, error: 'Gravity must be between -20 and 0' };
    }
    params.gravity = gravity;
  }

  if (friction !== undefined) {
    if (friction < 0 || friction > 1) {
      return { success: false, error: 'Friction must be between 0 and 1' };
    }
    params.friction = friction;
  }

  if (bounce !== undefined) {
    if (bounce < 0 || bounce > 2) {
      return { success: false, error: 'Bounce must be between 0 and 2' };
    }
    params.bounce = bounce;
  }

  if (Object.keys(params).length === 0) {
    return { success: false, error: 'No physics parameters provided' };
  }

  return gameRequest('/api/physics/set', 'POST', params);
}

/**
 * Tool: get_world_state
 * Get current state of the entire world
 */
async function get_world_state() {
  return gameRequest('/api/world/state');
}

/**
 * Tool: get_player_positions
 * Get all connected player positions
 */
async function get_player_positions() {
  return gameRequest('/api/players');
}

/**
 * Tool: create_challenge
 * Create a new challenge objective
 */
async function create_challenge({ type, target, description, reward = 100 }) {
  if (!type) {
    return { success: false, error: 'Missing required parameter: type' };
  }

  const validTypes = ['reach', 'collect', 'survive', 'time_trial'];
  if (!validTypes.includes(type)) {
    return { success: false, error: `Invalid type. Must be one of: ${validTypes.join(', ')}` };
  }

  return gameRequest('/api/challenge/create', 'POST', {
    type,
    target,
    description,
    reward
  });
}

/**
 * Tool: get_challenge_status
 * Get status of all active challenges
 */
async function get_challenge_status() {
  return gameRequest('/api/challenge/status');
}

// Export tools for OpenClaw
module.exports = {
  spawn_entity,
  modify_entity,
  destroy_entity,
  set_physics,
  get_world_state,
  get_player_positions,
  create_challenge,
  get_challenge_status
};
