/**
 * Composer — Agent-generated entity recipes
 *
 * The agent describes what it wants ("blue whale") and optionally provides a recipe
 * (children shapes, behavior). Known prefabs resolve instantly. New recipes get
 * validated, cached to disk, and spawned. Next time the same description is used,
 * the cached recipe spawns without the agent needing to provide it again.
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { PREFABS, spawnPrefab, spawnGroup } from './Prefabs.js';

const CACHE_DIR = path.resolve('data');
const CACHE_FILE = path.join(CACHE_DIR, 'compose-cache.json');

const recipeCache = new Map();

const VALID_TYPES = ['platform', 'ramp', 'collectible', 'obstacle', 'trigger', 'decoration'];
const VALID_SHAPES = [
  'box', 'sphere', 'cylinder', 'cone', 'pyramid', 'torus', 'dodecahedron', 'ring',
  'column', 'vase', 'teardrop', 'mushroom_cap', 'horn', 'flask', 'bell', 'dome',
  'wing', 'star', 'heart', 'arrow', 'cross',
  'tentacle', 'arch', 's_curve',
];
const VALID_BEHAVIORS = ['static', 'patrol', 'rotate', 'chase', 'pendulum', 'crush'];
const VALID_CATEGORIES = ['hazard', 'decoration', 'utility'];
const MAX_CHILDREN = 12;
const HEX_COLOR_RE = /^#[0-9a-fA-F]{3,8}$/;

function normalize(desc) {
  return desc
    .toLowerCase()
    .trim()
    .replace(/^(a|an|the)\s+/, '')
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .slice(0, 200);
}

function findPrefabMatch(key) {
  if (PREFABS[key]) return key;
  const singular = key.endsWith('s') ? key.slice(0, -1) : null;
  if (singular && PREFABS[singular]) return singular;
  return null;
}

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

/** Allowed numeric properties with their [min, max] ranges. */
const PROPERTY_RANGES = {
  speed:         [0.1, 10],
  chaseRadius:   [1, 50],
  patrolRadius:  [1, 30],
  swingHeight:   [1, 10],
  crushHeight:   [1, 10],
  bounceForce:   [5, 30],
  boostDuration: [1000, 10000],
  bobSpeed:      [0.5, 5],
  bobHeight:     [0.1, 2],
};

/** Compute the largest bounding extent across all children (offset + size per axis). */
function computeMaxExtent(children) {
  let max = 0;
  for (const child of children) {
    for (let i = 0; i < 3; i++) {
      max = Math.max(max, Math.abs(child.offset[i]) + child.size[i]);
    }
  }
  return max;
}

/** Scale chase speed inversely with creature size — big things move slower. */
function chaseSpeedForSize(extent) {
  if (extent <= 1.5) return 4;
  if (extent <= 3) return 2.5;
  if (extent <= 6) return 1.5;
  return 1;
}

function validateRecipe(recipe) {
  const clean = {};

  clean.name = typeof recipe.name === 'string'
    ? recipe.name.slice(0, 50).replace(/[^a-zA-Z0-9_-]/g, '')
    : null;

  clean.category = VALID_CATEGORIES.includes(recipe.category) ? recipe.category : 'decoration';
  clean.description = typeof recipe.description === 'string' ? recipe.description.slice(0, 200) : '';
  clean.behavior = VALID_BEHAVIORS.includes(recipe.behavior) ? recipe.behavior : 'static';

  // Decorations must not chase/patrol — silently downgrade
  if (clean.category === 'decoration' && ['chase', 'patrol'].includes(clean.behavior)) {
    clean.behavior = 'static';
  }

  const dp = recipe.defaultProperties || {};
  clean.defaultProperties = {};
  for (const [key, [min, max]] of Object.entries(PROPERTY_RANGES)) {
    if (typeof dp[key] === 'number') {
      clean.defaultProperties[key] = clamp(dp[key], min, max);
    }
  }

  if (recipe.isFloating || dp.isFloating) clean.defaultProperties.isFloating = true;

  if (!Array.isArray(recipe.children) || recipe.children.length === 0) {
    return { valid: false, error: 'Recipe must have at least 1 child entity in "children" array' };
  }

  clean.children = recipe.children.slice(0, MAX_CHILDREN).map(child => {
    const c = {};
    c.type = VALID_TYPES.includes(child.type) ? child.type : 'decoration';

    c.offset = parseVec3(child.offset, 0, -10, 10);
    c.size = parseVec3(child.size, 1, 0.1, 10);
    c.rotation = parseVec3(child.rotation, 0, -Math.PI, Math.PI);

    const props = child.props || {};
    c.props = {
      shape: VALID_SHAPES.includes(props.shape) ? props.shape : 'box',
      color: (typeof props.color === 'string' && HEX_COLOR_RE.test(props.color)) ? props.color : '#888888',
    };
    if (props.emissive) c.props.emissive = true;
    if (typeof props.metalness === 'number') c.props.metalness = clamp(props.metalness, 0, 1);
    if (typeof props.roughness === 'number') c.props.roughness = clamp(props.roughness, 0, 1);
    if (typeof props.opacity === 'number') c.props.opacity = clamp(props.opacity, 0.1, 1);
    if (props.isBounce) c.props.isBounce = true;
    if (props.isSpeedBoost) c.props.isSpeedBoost = true;
    if (props.isCheckpoint) c.props.isCheckpoint = true;
    if (props.isIce) c.props.isIce = true;
    if (props.isConveyor) {
      c.props.isConveyor = true;
      if (Array.isArray(props.conveyorDir) && props.conveyorDir.length >= 3) {
        c.props.conveyorDir = props.conveyorDir.slice(0, 3).map(v => clamp(Number(v) || 0, -1, 1));
      }
      if (typeof props.conveyorSpeed === 'number') {
        c.props.conveyorSpeed = clamp(props.conveyorSpeed, 1, 20);
      }
    }
    if (props.isWind) {
      c.props.isWind = true;
      if (Array.isArray(props.windForce) && props.windForce.length >= 3) {
        c.props.windForce = props.windForce.slice(0, 3).map(v => clamp(Number(v) || 0, -30, 30));
      }
    }
    if (props.isFloating) c.props.isFloating = true;

    return c;
  });

  const maxExtent = computeMaxExtent(clean.children);
  if (maxExtent > 20) {
    console.warn(`[Composer] Recipe "${clean.name}" bounding radius ${maxExtent.toFixed(1)} exceeds 20 units`);
  }

  if (clean.behavior === 'chase') {
    if (!dp.speed) clean.defaultProperties.speed = chaseSpeedForSize(maxExtent);
    if (!dp.chaseRadius) clean.defaultProperties.chaseRadius = 20;
  }

  return { valid: true, recipe: clean };
}

function parseVec3(arr, fallback, min, max) {
  if (Array.isArray(arr) && arr.length >= 3) {
    return arr.slice(0, 3).map(v => clamp(Number(v) || fallback, min, max));
  }
  return [fallback, fallback, fallback];
}

export async function loadCacheFromDisk() {
  try {
    const raw = await readFile(CACHE_FILE, 'utf-8');
    const entries = JSON.parse(raw);
    for (const [key, recipe] of Object.entries(entries)) {
      recipeCache.set(key, recipe);
    }
    console.log(`[Composer] Loaded ${recipeCache.size} cached recipes from disk`);
  } catch {
    console.log('[Composer] No cache file found — starting fresh');
  }
}

async function saveCacheToDisk() {
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    const obj = Object.fromEntries(recipeCache);
    await writeFile(CACHE_FILE, JSON.stringify(obj, null, 2));
  } catch (err) {
    console.error('[Composer] Failed to save cache:', err.message);
  }
}

function spawnFromRecipe(recipe, position, properties, worldState, broadcastFn) {
  const name = recipe.name || 'custom';
  const result = spawnGroup(
    recipe,
    `compose-${name}`,
    position,
    properties,
    { composedName: name },
    worldState,
    broadcastFn,
  );

  console.log(`[Composer] Spawned '${name}' as group ${result.groupId} (${result.entityIds.length} entities)`);
  return result;
}

export function compose(description, position, recipe, properties, worldState, broadcastFn) {
  if (!description || typeof description !== 'string') {
    return { success: false, error: 'Missing required: description (string)' };
  }
  if (!position || !Array.isArray(position) || position.length < 3) {
    return { success: false, error: 'Missing required: position [x, y, z]' };
  }

  const key = normalize(description);
  if (!key) {
    return { success: false, error: 'Description is empty after normalization' };
  }

  // 1. Check built-in PREFABS
  const prefabName = findPrefabMatch(key);
  if (prefabName) {
    const result = spawnPrefab(prefabName, position, properties || {}, worldState, broadcastFn);
    return { success: true, ...result, source: 'prefab', name: prefabName };
  }

  // 2. Check compose cache
  const cached = recipeCache.get(key);
  if (cached) {
    const result = spawnFromRecipe(cached, position, properties || {}, worldState, broadcastFn);
    return { success: true, ...result, source: 'cached', name: cached.name || key };
  }

  // 3. New — recipe must be provided
  if (!recipe || typeof recipe !== 'object') {
    return {
      success: false,
      error: `Unknown entity "${description}". Provide a recipe: { children: [{ type, offset, size, props: { shape, color } }], behavior: "static" }`
    };
  }

  // 4. Validate recipe
  const validation = validateRecipe(recipe);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }

  const cleanRecipe = validation.recipe;
  if (!cleanRecipe.name) {
    cleanRecipe.name = key;
  }

  // 5. Cache and spawn
  recipeCache.set(key, cleanRecipe);
  saveCacheToDisk(); // async — fire and forget

  const result = spawnFromRecipe(cleanRecipe, position, properties || {}, worldState, broadcastFn);
  return { success: true, ...result, source: 'generated', name: cleanRecipe.name };
}

export function getComposerStats() {
  return {
    cachedRecipes: recipeCache.size,
    recipes: Array.from(recipeCache.keys()),
  };
}
