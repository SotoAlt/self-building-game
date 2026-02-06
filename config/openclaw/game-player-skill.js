/**
 * Game Player Skill for OpenClaw
 *
 * Allows external AI agents to PLAY the Self-Building Game as a player.
 * Unlike game-world-skill.js (which controls the world as the Chaos Magician),
 * this skill lets agents join, move, chat, bribe, and compete.
 */

const GAME_SERVER_URL = process.env.GAME_SERVER_URL || 'http://localhost:3000';

async function gameRequest(endpoint, method = 'GET', body = null) {
  const url = `${GAME_SERVER_URL}${endpoint}`;
  const options = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) options.body = JSON.stringify(body);

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

// Stored player ID for this session
let myPlayerId = null;

const NOT_IN_GAME_ERROR = { success: false, error: 'Not in game. Call join_game first.' };

/**
 * Guard: returns an error object if the player has not joined the game.
 */
function requireJoined() {
  if (!myPlayerId) return NOT_IN_GAME_ERROR;
  return null;
}

/**
 * Tool: join_game
 * Join the game as an AI player. Must be called before any other tool.
 * Returns your player ID which is used for all subsequent actions.
 */
async function join_game({ name }) {
  if (!name) {
    return { success: false, error: 'Missing required parameter: name' };
  }

  const result = await gameRequest('/api/agent-player/join', 'POST', { name });
  if (result.success && result.playerId) {
    myPlayerId = result.playerId;
  }
  return result;
}

/**
 * Tool: move_to
 * Move toward a position in the world. Position is [x, y, z].
 * The game world is roughly -50 to 50 on X and Z, with Y as height.
 * Ground is at Y=0. Platforms are above.
 */
async function move_to({ position }) {
  const guard = requireJoined();
  if (guard) return guard;

  if (!position || !Array.isArray(position) || position.length !== 3) {
    return { success: false, error: 'Position must be [x, y, z]' };
  }

  return gameRequest('/api/agent-player/move', 'POST', {
    playerId: myPlayerId,
    position
  });
}

/**
 * Tool: send_chat
 * Send a chat message. Other players and the Chaos Magician can see it.
 * Use @agent to address the Chaos Magician directly.
 */
async function send_chat({ text }) {
  const guard = requireJoined();
  if (guard) return guard;

  if (!text) {
    return { success: false, error: 'Missing required parameter: text' };
  }

  return gameRequest('/api/agent-player/chat', 'POST', {
    playerId: myPlayerId,
    text
  });
}

/**
 * Tool: submit_bribe
 * Bribe the Chaos Magician with tokens to influence the game.
 * Types: spawn_obstacles (50), lava_floor (100), random_spell (30),
 *        move_goal (75), extra_time (40), custom (200)
 * Custom bribes require a 'request' parameter with your free-text request.
 */
async function submit_bribe({ bribeType, request }) {
  const guard = requireJoined();
  if (guard) return guard;

  if (!bribeType) {
    return { success: false, error: 'Missing required parameter: bribeType' };
  }

  const body = { playerId: myPlayerId, bribeType };
  if (request) body.request = request;

  return gameRequest('/api/bribe', 'POST', body);
}

/**
 * Tool: get_game_state
 * Get the current game state including your position, other players,
 * entities, active effects, and recent chat.
 */
async function get_game_state() {
  const guard = requireJoined();
  if (guard) return guard;

  return gameRequest(`/api/agent-player/${myPlayerId}/state`);
}

/**
 * Tool: get_my_position
 * Quick check of your current position in the world.
 */
async function get_my_position() {
  const guard = requireJoined();
  if (guard) return guard;

  const result = await gameRequest(`/api/agent-player/${myPlayerId}/state`);
  if (result.success && result.me) {
    return { success: true, position: result.me.position, state: result.me.state };
  }
  return result;
}

/**
 * Tool: get_leaderboard
 * See the current leaderboard standings.
 */
async function get_leaderboard() {
  return gameRequest('/api/public/leaderboard');
}

/**
 * Tool: ready_up
 * Toggle your ready state. When enough players are ready,
 * the Chaos Magician may start a game.
 */
async function ready_up() {
  const guard = requireJoined();
  if (guard) return guard;

  return gameRequest('/api/agent-player/ready', 'POST', {
    playerId: myPlayerId
  });
}

export {
  join_game,
  move_to,
  send_chat,
  submit_bribe,
  get_game_state,
  get_my_position,
  get_leaderboard,
  ready_up
};
