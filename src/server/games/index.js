/**
 * Mini-Games Index
 *
 * Export all mini-game classes for easy importing.
 */

import { MiniGame, GAME_TYPES } from '../MiniGame.js';
import { ReachGoal } from './ReachGoal.js';
import { CollectGame } from './CollectGame.js';
import { Survival } from './Survival.js';

export { MiniGame, GAME_TYPES, ReachGoal, CollectGame, Survival };

// Factory function to create games by type (sync)
export function createGameSync(type, worldState, broadcastFn, config = {}) {
  switch (type) {
    case 'reach':
      return new ReachGoal(worldState, broadcastFn, config);
    case 'collect':
      return new CollectGame(worldState, broadcastFn, config);
    case 'survival':
      return new Survival(worldState, broadcastFn, config);
    default:
      throw new Error(`Unknown game type: ${type}`);
  }
}
