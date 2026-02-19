import { randomUUID } from 'crypto';

export class SpellManager {
  static SPELL_COOLDOWN = 10000;

  static SPELL_TYPES = {
    invert_controls: { name: 'Inverted Controls', defaultDuration: 15000 },
    low_gravity: { name: 'Low Gravity', defaultDuration: 20000 },
    high_gravity: { name: 'Crushing Gravity', defaultDuration: 15000 },
    speed_boost: { name: 'Speed Boost', defaultDuration: 15000 },
    slow_motion: { name: 'Slow Motion', defaultDuration: 10000 },
    bouncy: { name: 'Bouncy World', defaultDuration: 20000 },
    giant: { name: 'Giant Mode', defaultDuration: 15000 },
    tiny: { name: 'Tiny Mode', defaultDuration: 15000 }
  };

  constructor() {
    this.activeEffects = [];
    this.lastSpellCastTime = 0;
  }

  castSpell(spellType, duration) {
    const spellDef = SpellManager.SPELL_TYPES[spellType];
    if (!spellDef) {
      throw new Error(`Unknown spell: ${spellType}. Available: ${Object.keys(SpellManager.SPELL_TYPES).join(', ')}`);
    }

    const now = Date.now();
    const timeSinceLast = now - this.lastSpellCastTime;
    if (timeSinceLast < SpellManager.SPELL_COOLDOWN) {
      const remaining = Math.ceil((SpellManager.SPELL_COOLDOWN - timeSinceLast) / 1000);
      throw new Error(`Spell on cooldown! The magic needs ${remaining}s to recharge.`);
    }

    const id = `spell-${randomUUID().slice(0, 8)}`;
    const spell = {
      id,
      type: spellType,
      name: spellDef.name,
      duration: duration || spellDef.defaultDuration,
      startTime: now
    };

    this.activeEffects.push(spell);
    this.lastSpellCastTime = now;
    console.log(`[SpellManager] Spell cast: ${spellDef.name} for ${spell.duration}ms`);
    return spell;
  }

  getActiveEffects() {
    const now = Date.now();
    this.activeEffects = this.activeEffects.filter(e => now - e.startTime < e.duration);
    return [...this.activeEffects];
  }

  clearEffects() {
    this.activeEffects = [];
    console.log('[SpellManager] All effects cleared');
  }
}
