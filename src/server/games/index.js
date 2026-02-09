/**
 * Mini-Games Index
 *
 * Export all mini-game classes for easy importing.
 */

import { MiniGame, GAME_TYPES } from '../MiniGame.js';
import { ReachGoal } from './ReachGoal.js';
import { CollectGame } from './CollectGame.js';
import { Survival } from './Survival.js';
import { KingOfHill } from './KingOfHill.js';
import { HotPotato } from './HotPotato.js';
import { Race } from './Race.js';

export { MiniGame, GAME_TYPES, ReachGoal, CollectGame, Survival, KingOfHill, HotPotato, Race };

// Factory function to create games by type (sync)
export function createGameSync(type, worldState, broadcastFn, config = {}) {
  switch (type) {
    case 'reach':
      return new ReachGoal(worldState, broadcastFn, config);
    case 'collect':
      return new CollectGame(worldState, broadcastFn, config);
    case 'survival':
      return new Survival(worldState, broadcastFn, config);
    case 'king':
      return new KingOfHill(worldState, broadcastFn, config);
    case 'hot_potato':
      return new HotPotato(worldState, broadcastFn, config);
    case 'race':
      return new Race(worldState, broadcastFn, config);
    default:
      throw new Error(`Unknown game type: ${type}`);
  }
}
