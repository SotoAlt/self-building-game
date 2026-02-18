/**
 * Server constants — timing, templates, bribe options.
 * Extracted from index.js for reuse across modules.
 */

export const PORT = process.env.PORT || 3000;
export const MIN_LOBBY_MS = 5000;
export const AUTO_START_DELAY = 20000;
export const MIN_GAME_DURATION_MS = 30000;
export const ANNOUNCEMENT_COOLDOWN = 5000;
export const AGENT_CHAT_COOLDOWN = 3000;
export const AFK_IDLE_MS = 120000;
export const AFK_KICK_MS = 15000;
export const AFK_CHECK_INTERVAL = 5000;

export const NEW_TYPE_TEMPLATES = [
  'king_plateau', 'king_islands',
  'hot_potato_arena', 'hot_potato_platforms',
  'checkpoint_dash', 'race_circuit',
];

export const ALL_TEMPLATES = [
  'spiral_tower', 'floating_islands', 'gauntlet', 'shrinking_arena',
  'parkour_hell', 'hex_a_gone', 'slime_climb', 'wind_tunnel',
  'treasure_trove', 'ice_rink',
  ...NEW_TYPE_TEMPLATES,
];

/** Map of template name substrings to game types (checked in order). */
const TEMPLATE_TYPE_RULES = [
  ['king', 'king'],
  ['hot_potato', 'hot_potato'],
  ['checkpoint', 'race'],
  ['race_circuit', 'race'],
  ['shrinking', 'survival'],
  ['hex_a_gone', 'survival'],
  ['ice_rink', 'survival'],
  ['blank_canvas', 'survival'],
  ['floating', 'collect'],
  ['treasure', 'collect'],
];

export function getTemplateGameType(templateName) {
  for (const [pattern, type] of TEMPLATE_TYPE_RULES) {
    if (templateName.includes(pattern)) return type;
  }
  return 'reach';
}

export const BRIBE_OPTIONS = {
  spawn_obstacles: {
    label: 'Spawn Obstacles', description: 'Obstacles near other players',
    cost: 50, costMON: '0.002', costWei: '2000000000000000'
  },
  lava_floor: {
    label: 'Turn Floor to Lava', description: 'Floor becomes deadly lava',
    cost: 100, costMON: '0.005', costWei: '5000000000000000'
  },
  random_spell: {
    label: 'Cast Random Spell', description: 'Random spell on all players',
    cost: 30, costMON: '0.001', costWei: '1000000000000000'
  },
  move_goal: {
    label: 'Move the Goal', description: 'Relocate the goal (reach games)',
    cost: 75, costMON: '0.003', costWei: '3000000000000000'
  },
  extra_time: {
    label: 'Extra Time (+15s)', description: 'Add 15 seconds to the clock',
    cost: 40, costMON: '0.002', costWei: '2000000000000000'
  },
  custom: {
    label: 'Custom Request', description: 'Free-text request for the Magician',
    cost: 200, costMON: '0.01', costWei: '10000000000000000'
  }
};
