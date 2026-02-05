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

/**
 * Tool: announce
 * Send a global announcement to all players
 */
async function announce({ text, type = 'agent', duration = 5000 }) {
  if (!text) {
    return { success: false, error: 'Missing required parameter: text' };
  }

  const validTypes = ['agent', 'system', 'challenge', 'player'];
  if (!validTypes.includes(type)) {
    return { success: false, error: `Invalid type. Must be one of: ${validTypes.join(', ')}` };
  }

  return gameRequest('/api/announce', 'POST', { text, type, duration });
}

/**
 * Tool: get_game_types
 * Get available mini-game types and their descriptions
 */
async function get_game_types() {
  return gameRequest('/api/game/types');
}

/**
 * Tool: start_game
 * Start a mini-game session
 */
async function start_game({ type, timeLimit, goalPosition, collectibleCount }) {
  if (!type) {
    return { success: false, error: 'Missing required parameter: type' };
  }

  const validTypes = ['reach', 'collect', 'survival'];
  if (!validTypes.includes(type)) {
    return { success: false, error: `Invalid type. Must be one of: ${validTypes.join(', ')}` };
  }

  // Pre-flight: reject unless in lobby or building, and not in cooldown
  const state = await gameRequest('/api/game/state');
  if (state.success && state.gameState) {
    const phase = state.gameState.phase;
    if (phase !== 'lobby' && phase !== 'building') {
      return { success: false, error: `Cannot start game — current phase is '${phase}'. Wait for lobby.` };
    }
    if (state.gameState.cooldownUntil > Date.now()) {
      const remaining = Math.ceil((state.gameState.cooldownUntil - Date.now()) / 1000);
      return { success: false, error: `Cooldown active — wait ${remaining}s before starting a new game.` };
    }
  }

  const body = { type };
  if (timeLimit) body.timeLimit = timeLimit;
  if (goalPosition) body.goalPosition = goalPosition;
  if (collectibleCount) body.collectibleCount = collectibleCount;

  return gameRequest('/api/game/start', 'POST', body);
}

/**
 * Tool: end_game
 * End the current mini-game
 */
async function end_game({ result = 'cancelled', winnerId }) {
  return gameRequest('/api/game/end', 'POST', { result, winnerId });
}

/**
 * Tool: get_game_state
 * Get the current game state (lobby, playing, etc.)
 */
async function get_game_state() {
  return gameRequest('/api/game/state');
}

/**
 * Tool: send_chat_message
 * Send a chat message as the agent
 */
async function send_chat_message({ text }) {
  if (!text) {
    return { success: false, error: 'Missing required parameter: text' };
  }

  return gameRequest('/api/chat/send', 'POST', { text });
}

/**
 * Tool: get_chat_messages
 * Get recent chat messages (for reading player chats)
 */
async function get_chat_messages({ since = 0, limit = 20 } = {}) {
  return gameRequest(`/api/chat/messages?since=${since}&limit=${limit}`);
}

/**
 * Tool: cast_spell
 * Cast a spell effect on all players
 * Types: invert_controls, low_gravity, high_gravity, speed_boost, slow_motion, bouncy, giant, tiny
 */
async function cast_spell({ type, duration }) {
  if (!type) {
    return { success: false, error: 'Missing required parameter: type' };
  }

  const body = { type };
  if (duration) body.duration = duration;

  return gameRequest('/api/spell/cast', 'POST', body);
}

/**
 * Tool: clear_spells
 * Remove all active spell effects
 */
async function clear_spells() {
  return gameRequest('/api/spell/clear', 'POST', {});
}

/**
 * Tool: add_trick
 * Add a trick (timed/conditional event) to the current mini-game.
 * Tricks fire automatically during gameplay based on triggers.
 *
 * Trigger types:
 *   { type: 'time', at: 15000 }               — fire at 15s elapsed
 *   { type: 'interval', every: 10000 }         — fire every 10s
 *   { type: 'score', player: 'any', value: 3 } — when any player reaches 3
 *   { type: 'deaths', count: 2 }               — when 2 players eliminated
 *
 * Actions (built-in): flip_gravity, speed_burst, announce
 * Actions (ReachGoal): move_goal, spawn_obstacles, spawn_shortcut
 * Actions (CollectGame): scatter, spawn_bonus, spawn_decoys
 * Actions (Survival): shrink_platform, hazard_wave, safe_zone, gravity_flip
 */
async function add_trick({ trigger, action, params = {} }) {
  if (!trigger || !action) {
    return { success: false, error: 'Missing required parameters: trigger, action' };
  }

  return gameRequest('/api/game/trick', 'POST', { trigger, action, params });
}

/**
 * Pre-flight check: reject if a game is actively running (countdown or playing).
 * Returns an error object if blocked, or null if safe to proceed.
 */
async function checkNotInActiveGame(actionName) {
  const state = await gameRequest('/api/game/state');
  if (state.success && state.gameState) {
    const phase = state.gameState.phase;
    if (phase === 'countdown' || phase === 'playing') {
      return { success: false, error: `Cannot ${actionName} during '${phase}' phase. Wait for the game to end.` };
    }
  }
  return null;
}

/**
 * Tool: get_context
 * Get unified agent context (players, game state, chat, events, entities, physics)
 * This is the primary polling tool - replaces calling multiple endpoints separately.
 */
async function get_context({ since_message = 0, since_event = 0 } = {}) {
  return gameRequest(`/api/agent/context?since_message=${since_message}&since_event=${since_event}`);
}

/**
 * Tool: clear_world
 * Remove all entities and reset physics. Use before building a new arena.
 */
async function clear_world() {
  const blocked = await checkNotInActiveGame('clear world');
  if (blocked) return blocked;

  return gameRequest('/api/world/clear', 'POST', {});
}

/**
 * Tool: load_template
 * Load a pre-built arena template. Clears the world first.
 * Available templates: spiral_tower, floating_islands, gauntlet, shrinking_arena, parkour_hell
 */
async function load_template({ name }) {
  if (!name) {
    return { success: false, error: 'Missing required parameter: name' };
  }

  const blocked = await checkNotInActiveGame('load template');
  if (blocked) return blocked;

  return gameRequest('/api/world/template', 'POST', { name });
}

/**
 * Tool: set_respawn
 * Set the respawn point for players. Call before starting a game.
 */
async function set_respawn({ position }) {
  if (!position || !Array.isArray(position)) {
    return { success: false, error: 'Missing required parameter: position [x,y,z]' };
  }
  return gameRequest('/api/world/respawn', 'POST', { position });
}

/**
 * Tool: get_drama_score
 * Check the current drama level (0-100) and session phase.
 */
async function get_drama_score() {
  return gameRequest('/api/agent/drama');
}

/**
 * Tool: start_building
 * Enter building phase. Signals to players that the arena is being constructed.
 */
async function start_building() {
  return gameRequest('/api/game/building', 'POST', {});
}

/**
 * Tool: set_floor
 * Set the floor type. 'solid' = normal ground, 'none' = abyss (void), 'lava' = kills on contact.
 * Use 'none' to make platforms the only safe ground. Use 'lava' for dramatic moments.
 */
async function set_floor({ type }) {
  if (!type) {
    return { success: false, error: 'Missing required parameter: type' };
  }
  const valid = ['solid', 'none', 'lava'];
  if (!valid.includes(type)) {
    return { success: false, error: `Invalid floor type. Must be one of: ${valid.join(', ')}` };
  }
  return gameRequest('/api/world/floor', 'POST', { type });
}

/**
 * Tool: check_bribes
 * Check pending bribes from players. Decide whether to honor them.
 */
async function check_bribes() {
  return gameRequest('/api/bribe/pending');
}

// Export tools for OpenClaw
export {
  // World management
  spawn_entity,
  modify_entity,
  destroy_entity,
  set_physics,
  set_floor,
  set_respawn,
  clear_world,
  load_template,
  get_world_state,
  get_player_positions,
  // Game lifecycle
  get_game_types,
  start_game,
  end_game,
  get_game_state,
  start_building,
  add_trick,
  // Challenges
  create_challenge,
  get_challenge_status,
  // Communication
  announce,
  send_chat_message,
  get_chat_messages,
  // Spells
  cast_spell,
  clear_spells,
  // Agent context
  get_context,
  get_drama_score,
  check_bribes
};
