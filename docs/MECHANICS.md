# Game Mechanics Expansion

Design document for new mechanics in the Self-Building Game. Organized by implementation priority — agent creative tools first, environment mechanics second, game types third, player abilities last.

**Current state (v0.34.0)**: 6 game types (reach, collect, survival, king, hot_potato, race), 6 entity types (platform, ramp, collectible, obstacle, trigger, decoration), 23 shapes (8 basic + 16 templates), 25 prefabs (incl. conveyor_belt, wind_zone), 8 spells, 16 arena templates (incl. hex_a_gone, slime_climb, wind_tunnel, king_plateau, checkpoint_dash, race_circuit), breakable platforms, bounce pads, speed strips, ice surfaces, conveyor belts, wind zones, rising hazard plane, 4 random obstacle patterns, compose system with per-child rotation + material controls + disk-cached recipes + chase speed auto-scaling + behavior-category coherence, toon shading with ACES tone mapping + transparency depth fix, entity facing rotation, floating bob animation, player rotation, per-template randomization, agent variety enforcement with game history tracking.

---

## 1. Compose System (Agent Creative Tools) ✅ COMPLETED

### Problem (v0.20)

The agent could only spawn geometric primitives or predefined prefabs. Custom creations were impossible — the agent couldn't design a dragon, spaceship, or octopus from shapes.

### Solution (v0.24)

A **compose system** — the agent calls `POST /api/world/compose` for everything. Known prefabs resolve instantly by name. Custom creations use agent-designed recipes with up to 12 children, per-child rotation, 23 shapes (including organic curves like horn, tentacle, wing, dome), and material controls (metalness, roughness, opacity, emissive). Recipes are cached to disk — first creation is designed, all future spawns are instant.

### Prefab Catalog

#### Hazards / Enemies

| Prefab | Visual | Behavior | Collision |
|--------|--------|----------|-----------|
| `spider` | Black sphere body + 4 thin cylinder legs | Patrols area (back-and-forth or circular path) | Kills on contact |
| `turret` | Cylinder base + cone barrel | Rotates toward nearest player, fires projectile on interval | Base = solid, projectile = kills |
| `cannon` | Large cylinder barrel on box base | Fires player-launching projectile (bounce pad effect) or harmful projectile | Configurable via `properties.mode: 'launch' \| 'harm'` |
| `swinging_axe` | Thin box blade on cylinder pivot | Pendulum swing motion | Kills during swing arc |
| `spinning_blade` | Flat cylinder, low height | Rotates horizontally at high speed | Kills on contact |
| `rolling_boulder` | Large sphere, stone-colored | Rolls down slopes toward players, respawns at origin | Kills on contact, pushes on near-miss |
| `crusher` | Wide platform on vertical track | Slams down periodically, pauses, raises back up | Kills if player underneath during slam |

#### Utility

| Prefab | Visual | Behavior | Effect |
|--------|--------|----------|--------|
| `bounce_pad` | Flat cylinder, bright green, slight glow | Stationary | Launches player upward on contact (configurable force) |
| `conveyor_belt` | Orange glowing platform (4x0.3x2) | Stationary | Pushes players in `conveyorDir` at `conveyorSpeed` (default 6) |
| `teleporter` | Ring shape with particle effect, comes in pairs | Stationary | Touching one teleports player to paired teleporter |
| `checkpoint` | Glowing flag on pole | Stationary | Sets player respawn point to this location |
| `speed_strip` | Flat box with stripe pattern | Stationary | Horizontal speed boost while on surface |

#### Decoration / Themed

| Prefab | Visual | Notes |
|--------|--------|-------|
| `torch` | Cone flame on cylinder stick, emits point light | Decoration type (no collision) + dynamic light source |
| `crystal` | Rotating dodecahedron with glow/emissive | Decoration, ambient visual flair |
| `barrel` | Brown cylinder | Can be decoration or obstacle depending on type |
| `flag` | Thin box on cylinder pole | Marks positions, goals, team zones |
| `sign` | Flat box face on cylinder post | Displays `properties.text` — agent can write messages in world |

### Implementation Approach

**Server** — `src/server/Prefabs.js`:
- `PREFABS` registry mapping name → definition
- Each prefab defines: `entities[]` (child parts with relative offsets), `behavior` type, `collisionType`, `defaultProperties`
- `spawnPrefab(name, position, properties)` creates all child entities as a group with shared `groupId`
- Group operations: modify/destroy by `groupId` affects all children

**API** — `POST /api/world/spawn-prefab`:
- Accepts `{ name, position, properties }`
- Returns `{ groupId, entityIds: [...] }`

**Agent tool** — `spawn_prefab`:
```
spawn_prefab({ name: 'spider', position: [5, 1, 0], properties: { patrolRadius: 8 } })
spawn_prefab({ name: 'turret', position: [10, 3, -5], properties: { fireRate: 2000 } })
spawn_prefab({ name: 'teleporter', position: [0, 1, 0], properties: { pairPosition: [20, 1, 0] } })
```

**Client** — `renderPrefab()`:
- Assembles multi-mesh Three.js groups from child entity data
- Applies behavior-specific animations (patrol paths, rotations, pendulum swings)
- Projectile rendering for turrets/cannons (simple sphere + velocity)

**Behavior system** (server-side, tick-based):
- `patrol` — entity moves between waypoints, reverses at ends
- `pendulum` — oscillates around pivot point
- `crusher` — vertical slam cycle (up → pause → slam → pause → up)
- `turret_aim` — rotates toward nearest player, spawns projectile entity on interval
- `projectile` — moves in direction with velocity, despawns on collision or lifetime

---

## 2. Environment Mechanics (Dynamic Arenas) ✅ COMPLETED (v0.26.0)

The arena itself changes during gameplay, creating emergent challenges beyond static layouts.

### Breakable Platforms (Hex-A-Gone style) ✅

Platforms that crack and disappear when stepped on.

- **Entity property**: `breakable: true`, `breakDelay: 500` (ms after player contact)
- **Sequence**: player steps on → crack visual/sound → platform fades → removed from collision
- **Regeneration**: optional `breakRegenDelay: 5000` — platform reappears after N ms
- **Server**: `WorldState.startBreaking()`, `processBreakingPlatforms()` in tick loop
- **Client**: `platform_step` → `platform_cracking` WS messages, crack shake+fade animation, break particles

### Ice Surfaces ✅

Platforms with reduced friction — players slide on contact.

- **Entity property**: `isIce: true` on any platform
- **Effect**: ground deceleration reduced to 8%, acceleration to 15% — momentum carries
- **Visual**: light blue tint (`#b3e5fc`), low roughness (0.05), slight metalness (0.6), semi-transparent (0.85)
- **Composer validation**: `isIce` validated in `Composer.js`
- **Use case**: narrow ice paths over abyss, ice + wind combos, slippery gauntlets

### Conveyor Belts ✅

Platforms that push players in a direction while standing on them.

- **Entity properties**: `isConveyor: true`, `conveyorDir: [x, 0, z]` (normalized -1 to 1), `conveyorSpeed: 1-20`
- **Effect**: adds velocity in direction proportional to speed each physics tick (frame-rate independent via `frameDelta`)
- **Visual**: orange emissive glow (`#e67e22`)
- **Prefab**: `conveyor_belt` — 4x0.3x2 platform, default speed 6, direction [1,0,0]
- **Composer validation**: `isConveyor`, `conveyorDir`, `conveyorSpeed` all validated with clamping
- **Use case**: obstacle courses where players fight against current, alternating-direction gauntlets

### Wind Zones ✅

Trigger volumes that push players with directional force.

- **Entity properties**: `isWind: true`, `windForce: [x, y, z]` (each component clamped -30 to 30)
- **Effect**: force applied to player velocity while inside trigger AABB (frame-rate independent via `frameDelta`)
- **Variants**: lateral (push off platforms), updraft (extend jumps), downdraft (slam), headwind (slow progress)
- **Prefab**: `wind_zone` — 4x6x4 trigger, default force [10,0,0], semi-transparent blue (`#87ceeb`, opacity 0.15)
- **Composer validation**: `isWind`, `windForce` validated with clamping
- **Use case**: courses with crosswind on narrow bridges, updraft shortcuts, headwind challenges

### Rising Hazard Plane ✅

Server-authoritative lava/water plane that rises during gameplay, killing players below its height.

- **API**: `POST /api/world/hazard-plane` → `{ active, type: 'lava'|'water', startHeight, riseSpeed: 0.1-5, maxHeight: up to 100 }`
- **Server**: `WorldState.setHazardPlane()`, `updateHazardPlane(delta)` in tick loop, 200ms throttled broadcasts, server-side kill check
- **Cleanup**: deactivates on game end, world clear, lobby transition
- **Client**: 400x400 plane mesh, lava (red/orange emissive) or water (blue semi-transparent), pulsing animation
- **WS messages**: `hazard_plane_changed` (config), `hazard_plane_update` (height tick)
- **Agent context**: `hazardPlane` field with active/type/height/riseSpeed/maxHeight
- **Template support**: `hazardPlane` config in arena templates (used by `slime_climb`)
- **Safe phases**: plane doesn't rise during countdown/lobby/ended

### Trap Doors (Future)

Platforms that open/disappear when triggered.

- **Entity property**: `trapdoor: true`, `trapTrigger: 'proximity' | 'timer' | 'weight'`
- **Triggers**:
  - `proximity` — opens when a player steps on it (with configurable delay)
  - `timer` — opens/closes on a cycle (`trapCycleMs: 3000`)
  - `weight` — opens after N players stand on it simultaneously

### Gravity Zones (Future)

Localized gravity overrides.

- **Entity type**: trigger with `localGravity: [0, 5, 0]`
- **Variants**: inverted (`[0, 15, 0]`), zero-G (`[0, 0, 0]`), heavy (`[0, -40, 0]`), lateral (`[10, -20, 0]`)

### Portals / Teleporters (Future)

Paired entities that teleport players between locations.

- **Implementation**: two trigger entities with `teleportTarget: entityId` pointing at each other
- **Cooldown**: 2s per player to prevent oscillation

---

## 3. Game Types & Modifiers

### New Game Types

#### King of the Hill (`king`) ✅ IMPLEMENTED (v0.32.0)

Control zones to earn points over time.

- **Setup**: 1-3 "hill" zones marked in arena (trigger entities with `isHill: true`)
- **Scoring**: players earn 1 point/second while sole occupant of a hill zone; contested zones award nothing
- **Win**: first to target score (default 30), or highest when time expires
- **Visual**: hill zones change color to controlling player; score overlay HUD during king games
- **Trick potential**: agent can move hills mid-game, add/remove hills
- **Templates**: `king_plateau` (central hill + ramps), `king_islands` (3 floating islands)
- **File**: `src/server/games/KingOfHill.js`

#### Hot Potato (`hot_potato`) ✅ IMPLEMENTED (v0.32.0)

Don't be holding the curse when the timer expires.

- **Setup**: one random player receives "the curse" (red glow VFX)
- **Transfer**: curse passes on proximity (< 3 units, 2s transfer cooldown, +2s bonus on pass)
- **Elimination**: player holding curse when sub-timer (10-16s) hits 0 is eliminated
- **Rounds**: multi-round — curse resets to random survivor; last player standing wins
- **Visual**: red emissive glow on cursed player, red vignette if local, pulsing sub-timer HUD
- **Templates**: `hot_potato_arena` (circular with pillars), `hot_potato_platforms` (floating over abyss)
- **File**: `src/server/games/HotPotato.js`

#### Dodgeball (`dodgeball`)

Throw projectiles to eliminate opponents.

- **Setup**: projectile pickup entities spawn in arena periodically
- **Pickup**: player touches projectile to collect (max 1 held at a time)
- **Throw**: action key fires projectile in look direction with physics arc
- **Hit**: target is eliminated (or takes damage if health system exists)
- **Win**: last player standing
- **Visual**: held projectile shown orbiting player, thrown = fast sphere with trail
- **Trick potential**: agent spawns more/fewer projectiles, adds bounce-back walls, gives specific players ammo

#### Race (`race`) ✅ IMPLEMENTED (v0.32.0)

Checkpoint-based race through an obstacle course.

- **Setup**: ordered checkpoint triggers (`isCheckpoint: true`, `checkpointIndex: N`)
- **Rules**: players must hit checkpoints in order — skipping doesn't count
- **Tracking**: HUD shows "Checkpoint N/Total" per player
- **Win**: first to complete all checkpoints, or most at timeout
- **Visual**: next checkpoint highlighted, completed ones change color
- **Templates**: `checkpoint_dash` (linear 6-checkpoint course), `race_circuit` (circular 8-checkpoint track)
- **File**: `src/server/games/Race.js`
- **Key**: `GameRoom.onTriggerActivated(playerId, entityId)` passes entity ID for checkpoint resolution

#### Team Survival (`team_survival`)

Team-based survival with shared fate.

- **Setup**: 2 teams assigned by player join order (alternating) or agent choice
- **Scoring**: team with most surviving members when timer ends wins (or last team with anyone alive)
- **Visual**: team colors on player capsules, team score HUD
- **Agent tools**: `assign_teams`, `target_team` (focus hazards on one team area)
- **Trick potential**: agent can handicap leading team, merge arenas, swap team members

### Game Modifiers (Composable)

Modifiers stack on any base game type. Applied at game start, persist the entire round.

| Modifier | Effect | Implementation |
|----------|--------|----------------|
| `rising_lava` | Hazard plane rises over time | Spawn hazard-plane entity at game start |
| `shrinking_arena` | Arena walls close in over time | Move boundary obstacles inward on tick |
| `breakable_floor` | All platforms gain `breakable: true` | Apply property to all platform entities on start |
| `enemy_waves` | Periodic NPC enemy spawns | Spawn spider/turret prefabs on interval |
| `darkness` | Reduced visibility | Set `fogFar: 20` — players can barely see ahead |
| `ice_world` | All surfaces slippery | Apply `surface: 'ice'` to all platforms |
| `low_gravity` | Persistent low-G (not a spell — lasts whole game) | Set world gravity to 40% normal |
| `mirror` | Inverted controls for all players | Global invert flag, client respects it |
| `sudden_death` | One hit = elimination, no respawn | Disable respawn, any obstacle/hazard contact = permanent death |
| `time_pressure` | Timer counts down faster as game progresses | Multiply remaining time drain by escalating factor |

**API change**: `POST /api/game/start` accepts optional `modifiers: ['rising_lava', 'breakable_floor']`

**Agent tool**: `start_game({ template: 'gauntlet', modifiers: ['rising_lava', 'enemy_waves'] })`

**Agent context**: active modifiers listed in `/api/agent/context` response

### Deeper Existing Game Types

#### Reach Enhancements
- **Checkpoints**: partial progress saved — dying mid-course respawns at last checkpoint instead of start
- **Multiple paths**: agent builds alternate routes (risk/reward — shorter path has more hazards)
- **Breakable shortcuts**: destructible walls that reveal faster routes
- **Moving goal**: already exists as a trick — make it a first-class config option

#### Collect Enhancements
- **Competitive stealing**: touch another player → steal 1 collectible from them
- **Combo multiplier**: collect 3 items within 2 seconds → 2x bonus on third
- **Cursed items**: black collectibles that subtract points or apply debuff
- **Team collect**: pool scores by team for team-based collection

#### Survival Enhancements
- **Enemy waves**: spider/turret prefabs spawn periodically (increasing difficulty)
- **Hex-A-Gone mode**: breakable floor tiles (multi-layer, each layer breaks)
- **Safe zones**: designated zones that shift location — being outside = damage
- **Elimination feed**: "X eliminated! Y remaining" announcement per death

---

## 4. Player Abilities (Future)

Lower priority. Documented for the roadmap but implemented last.

### Movement Upgrades

| Ability | Description | Input |
|---------|-------------|-------|
| Double Jump | Second jump while mid-air | Jump key while airborne |
| Dash | Short forward burst, brief invulnerability | Shift / action key |
| Wall Jump | Jump off walls to extend platforming | Jump key while touching wall |
| Grapple | Hook onto surfaces and swing | Action key to fire, physics-based swing |

### Combat / Interaction

| Ability | Description | Input |
|---------|-------------|-------|
| Push / Shove | Knock other players back on contact | Action key near another player |
| Throw Projectile | Pick up and throw objects | Collect on touch, action key to throw |
| Ground Pound | Slam down from air, AoE knockback on landing | Down + jump while airborne |
| Shield | Temporary block — absorb one hit | Action key, cooldown-based |

### Items / Pickups (spawn in world during games)

| Item | Effect | Duration |
|------|--------|----------|
| Speed Boost | Individual speed increase | 10s |
| Shield | Absorb one obstacle hit | Until used |
| Magnet | Attract collectibles in radius | 8s |
| Invisibility | Hidden from other players | 5s |
| Rocket | Brief upward flight | 3s |

### Progression (long-term)

- Cosmetic skins (capsule colors, shapes, trails)
- Title/badge system from achievements
- Per-player persistent stats tracking
- Seasonal leaderboard resets

---

## 5. Agent Context Enrichment

For new mechanics to work with the Chaos Magician, the agent needs expanded tools and context.

### New Agent Tools

| Tool | Parameters | Purpose | Status |
|------|-----------|---------|--------|
| `compose` | `{ description, position, recipe?, properties? }` | Spawn anything — prefabs, custom recipes | ✅ v0.24.0 |
| `spawn_prefab` | `{ name, position, properties }` | Spawn named prefab (deprecated, use compose) | ✅ v0.20.0 |
| `set_hazard_plane` | `{ active, type, startHeight, riseSpeed, maxHeight }` | Rising lava/water hazard | ✅ v0.26.0 |
| `set_entity_breakable` | `{ id, delay, regenDelay }` | Make existing platform breakable | Future |
| `spawn_enemy` | `{ type, position, patrolPath }` | NPC enemy entity | Future |
| `assign_teams` | `{ teams }` | Assign players to teams | Future |
| `start_game` (update) | `{ template, modifiers }` | Accept modifier list | Future |

### Enhanced Agent Context (`/api/agent/context`)

| Field | Description | Status |
|-------|-------------|--------|
| `availablePrefabs` | List of prefab names (25 total) | ✅ v0.20.0 |
| `hazardPlane` | Current hazard plane state (active, type, height, riseSpeed, maxHeight) | ✅ v0.26.0 |
| `activeEffects` | Active spells list | ✅ v0.8.0 |
| `suggestedGameTypes` | Variety hints excluding last played | ✅ v0.11.0 |
| `activeModifiers` | Modifiers applied to current game | Future |
| `enemyCount` | Active NPC enemies in world | Future |
| `teams` | Team assignments if team game active | Future |

---

## 6. Arena Template Expansion

New templates that showcase the new mechanics.

| Template | Mechanics Used | Game Type | Status |
|----------|---------------|-----------|--------|
| `hex_a_gone` | Breakable platforms, multi-layer | Survival | ✅ v0.20.0 |
| `slime_climb` | Rising lava, conveyors, ice bridge, obstacles | Reach | ✅ v0.26.0 |
| `wind_tunnel` | Wind zones, ice, conveyors, crosswind bridges | Reach | ✅ v0.26.0 |
| `dodgeball_arena` | Projectile system | Dodgeball | Future |
| `king_plateau` | Central hill, ramps, obstacles | King | ✅ v0.32.0 |
| `king_islands` | 3 floating hills, bridges, wind | King | ✅ v0.32.0 |
| `hot_potato_arena` | Circular arena, pillars, obstacles | Hot Potato | ✅ v0.32.0 |
| `hot_potato_platforms` | Floating platforms, ice, abyss | Hot Potato | ✅ v0.32.0 |
| `checkpoint_dash` | Linear 6-checkpoint course | Race | ✅ v0.32.0 |
| `race_circuit` | Circular 8-checkpoint track | Race | ✅ v0.32.0 |
| `treasure_trove` | Multi-level, ledges, ice bridges | Collect | ✅ v0.32.0 |
| `ice_rink` | Large ice platform, sweeping obstacles | Survival | ✅ v0.32.0 |
| `trap_house` | Trap doors, crushers, fake floors | Reach | Future |
| `enemy_gauntlet` | Turrets, spiders, projectiles | Reach | Future |

---

## 7. Visual Rendering ✅ COMPLETED (v0.28.0)

### Toon Shading Pipeline

The game uses a cel-shaded visual style (Fall Guys / Splatoon aesthetic) via a post-processing pipeline:

| Component | File | Purpose |
|-----------|------|---------|
| `MeshToonMaterial` | `ToonMaterials.js` | 2/3/4-step gradient maps for cel-shaded lighting |
| `OutlinePass` | `PostProcessing.js` | Cartoon edges around all entities and players |
| `UnrealBloomPass` | `PostProcessing.js` | Selective glow for emissive objects (lava, collectibles) |
| `FXAA` | `PostProcessing.js` | Anti-aliasing pass |
| `OutputPass` | `PostProcessing.js` | Tone mapping output |
| Sky dome | `EnvironmentEffects.js` | Gradient shader sphere (top/bottom colors, overridable by templates) |
| Procedural textures | `ProceduralTextures.js` | Lava flow, conveyor arrows, custom patterns |

### Lighting Setup

- **Ambient**: `0x8090a0` at 0.8 intensity — broad fill
- **Hemisphere**: sky `0xb0d0ff` / ground `0x404030` at 0.6 — natural vertical gradient
- **Directional**: white at 1.2, position `[50, 100, 50]`, 2048px shadow maps
- **Tone mapping**: ACES Filmic at 1.3 exposure, sRGB color space
- **Entity self-illumination**: default emissive 0.12 (emissive entities 0.7)
- **Transparency**: transparent materials use `depthWrite: false` to prevent z-buffer clipping

### Outline System

- **Color**: `#1a1a1a` (dark gray — visible on dark backgrounds without looking neon)
- **Glow**: 0.2 — slight bloom for edge visibility
- **Strength**: 4.0, thickness 1.0
- **Update interval**: 200ms — all visible entities + players added to `selectedObjects`
- **Quality tiers**: auto-degrades (high → medium → low → potato) based on FPS

### Player Rotation

Players face their movement direction using `Math.atan2` on velocity:

- **Local player**: threshold `> 0.5` speed, 15 rad/s lerp rate via `shortAngleDist()` helper
- **Remote players**: direction inferred from position delta before lerp, 0.15 lerp rate
- **Shortest-path**: angle wrapping to `[-PI, PI]` prevents 360-degree spins

### Entity Facing Direction (v0.34.0)

Chase and patrol entities rotate to face their movement direction:

- **Server**: `WorldState.updateChasingEntities()` computes `_facing = Math.atan2(dx, dz)` on the group leader
- **Server**: `WorldState.updateKinematicEntities()` computes `_facing` from path direction, accounting for `_pathDirection` reversal
- **Client**: group animation loop applies `shortAngleDist()` lerp at 0.12 rate (~5-frame smooth turn)
- **Guard**: `!group.userData.rotating` prevents conflict with spinning entities (spinning_blade, crystal)

### Floating Bob Animation (v0.34.0)

Entities with `isFloating: true` bob up and down mid-air:

- **Server property**: `isFloating` propagated from prefab/recipe `defaultProperties` to all children via `applyBehavior()`
- **Prefabs**: ghost, ufo, fish have `isFloating: true` by default
- **Client**: `Math.sin(Date.now() * 0.002) * 0.4` — 0.4 unit amplitude, ~3.1s period
- **Base Y**: uses `targetPosition.y` when available (chase/patrol groups), falls back to current `position.y`
- **Guard**: skipped for rotating groups

---

## Development Roadmap

### Phase 1: Prefab System + Breakable Platforms ✅ COMPLETED (v0.20.0)

**Priority**: HIGH — biggest bang for effort. Agent immediately gets more creative vocabulary.

**Scope**: 1 session

- [x] Create `src/server/Prefabs.js` — prefab registry (12 prefabs)
- [x] `POST /api/world/spawn-prefab` + `POST /api/world/destroy-group` endpoints
- [x] `spawn_prefab` + `destroy_prefab` agent tools in `config/openclaw/game-world-skill.js`
- [x] Client: bounce pad, speed strip, breakable platform mechanics
- [x] Breakable platform property (`breakable`, `breakDelay`) — server-authoritative break/regen
- [x] Client crack/disappear animation + break particles + 3 new sounds
- [x] `hex_a_gone` arena template (3-layer, 111 breakable platforms, survival)
- [x] Update agent context with `availablePrefabs`

### Phase 1.5: Compose System + 3D Composition ✅ COMPLETED (v0.24.0)

**Priority**: HIGH — transforms agent from prefab-only to creative designer.

**Scope**: 2 sessions

- [x] `src/server/Composer.js` — recipe validation, disk cache, prefab resolution
- [x] `POST /api/world/compose` — single endpoint for all spawning
- [x] Per-child rotation (`rotation: [rx, ry, rz]` radians)
- [x] Material properties (`roughness`, `metalness`, `opacity`, `emissive`)
- [x] 16 geometry templates (`src/client/GeometryTemplates.js`) — lathe, extrude, tube shapes
- [x] Client group merging — `THREE.Group` for composed entities
- [x] MAX_CHILDREN raised from 6 to 12
- [x] Compose-only enforcement — `spawn_entity` and `spawn_prefab` deprecated in agent prompts
- [x] Agent successfully creating custom recipes (dragon, chaos_hounds, forest_upside_down, super_computer)

### Phase 1.6: Compose Refinement ✅ COMPLETED (v0.34.0)

**Priority**: HIGH — compose works but creations need to look and behave right.

**Scope**: 1 session

#### Enemy Behavior & Chase Logic
- [x] Chase group rendering fix — `assembleGroup()` and `updateEntity()` now handle `chase` groups alongside `kinematic`
- [x] Chase speed auto-scales with creature size — Composer `chaseSpeedForSize()`: tiny=4, small=2.5, player=1.5, giant=1
- [x] Chase radius defaults to 20 if not specified — Composer auto-assigns `chaseRadius: 20`
- [ ] Circular patrol and waypoints — deferred (linear patrol is sufficient for current prefabs)

#### Orientation & Rotation
- [x] Server computes `_facing` yaw on chase group leaders (`Math.atan2(dx, dz)` in `updateChasingEntities`)
- [x] Server computes `_facing` yaw on kinematic entities from path direction (accounts for `_pathDirection` reversal)
- [x] Client smooth yaw rotation via `shortAngleDist()` lerp at 0.12 rate, guarded by `!rotating`

#### Size Awareness & Scale Guidelines
- [x] Size categories defined in agent-runner prompt, SOUL.md, and SKILL.md (Tiny/Small/Player/Large/Giant)
- [x] Composer bounding box warning when recipe exceeds 20 units
- [x] Player height reference in all agent prompts (1.8 units)

#### Movement-to-Form Coherence
- [x] Composer behavior-category coherence — `decoration` + `chase`/`patrol` silently downgraded to `static`
- [x] Flying creatures (ghost, ufo, fish) get `isFloating: true` — bob animation via sine wave
- [x] Chase speed auto-scales by size — behavior rules in agent prompts

#### Visual Polish
- [x] Emissive intensity increased 0.5 → 0.7 for `emissive: true` entities (eyes, flames, crystals)
- [x] Transparent materials use `depthWrite: false` — prevents z-buffer clipping artifacts
- [x] Bob animation for floating groups — 0.4u amplitude, ~3.1s period, uses `targetPosition.y` as base

### Phase 2: Environment Mechanics ✅ COMPLETED (v0.26.0)

**Priority**: MEDIUM — makes arenas feel alive and dynamic.

**Scope**: 1 session

- [x] Ice surfaces — `isIce: true` property, 8% decel / 15% accel, blue translucent visual
- [x] Conveyor belts — `isConveyor: true` + `conveyorDir` + `conveyorSpeed`, `conveyor_belt` prefab
- [x] Wind zones — `isWind: true` + `windForce: [x,y,z]`, `wind_zone` prefab
- [x] Rising hazard plane — `POST /api/world/hazard-plane`, server tick update, lava/water types, kill check
- [x] `slime_climb` template — vertical race Y=0→40, rising lava, conveyors, ice bridge
- [x] `wind_tunnel` template — horizontal course, crosswind bridges, ice+wind combos
- [x] Composer.js validation for all new entity properties
- [x] Agent integration — SKILL.md, SOUL.md, agent-runner prompt, agent context `hazardPlane` field
- [x] `frameDelta` pattern for frame-rate-independent physics (conveyors + wind)

### Phase 3: New Game Types + Agent Variety ✅ COMPLETED (v0.32.0)

**Priority**: HIGH — multiplies replayability.

**Scope**: 1 session

- [x] King of the Hill game type (`src/server/games/KingOfHill.js`) — hill zone scoring, score_update broadcasts
- [x] Hot Potato game type (`src/server/games/HotPotato.js`) — proximity curse transfer, multi-round elimination
- [x] Race game type (`src/server/games/Race.js`) — ordered checkpoints, onTriggerActivated dispatch
- [x] 8 new arena templates (king_plateau, king_islands, hot_potato_arena, hot_potato_platforms, checkpoint_dash, race_circuit, treasure_trove, ice_rink)
- [x] Per-template randomization — positions, speeds, delays vary each load
- [x] Game history tracking (`worldState.gameHistory[]`, last 8 games)
- [x] Agent variety enforcement — hard bans on recent types/templates, "YOU MUST USE" directives for unplayed types
- [x] Auto-start prefers unplayed new game types
- [x] Client HUD: score overlay (king), curse timer (hot_potato), checkpoint display (race)
- [x] GameRoom fixes: `onTriggerActivated(playerId, entityId)`, `onPlayerDeath(playerId)` dispatches
- [ ] Game modifier system — composable modifiers (rising_lava, breakable_floor, enemy_waves, sudden_death) — deferred to future phase

### Phase 4: Enemy / NPC System

**Priority**: MEDIUM — requires projectile system which is a building block for dodgeball too.

**Scope**: 1 session

- Server-side enemy entity with patrol AI (waypoint following)
- Turret entity with target acquisition and projectile spawning
- Projectile system (entity with velocity, lifetime, collision detection)
- Enemy prefabs: spider, turret, cannon, crusher
- `enemy_gauntlet` template
- Agent tool: `spawn_enemy`

### Phase 5: Player Abilities

**Priority**: LOWER — game is fun without these, but they add depth.

**Scope**: 1-2 sessions

- Dash ability (short burst, brief invulnerability)
- Push/shove mechanic (knockback other players)
- Pickup item system (speed boost, shield, magnet)
- Double jump (could be a spell effect or permanent upgrade)
- Dodgeball game type (requires projectile system from Phase 4)

### Phase 6: Polish + More Templates

**Priority**: LOWER — builds on all prior phases.

**Scope**: 1 session

- Trap door mechanic (proximity/timer/weight triggers)
- Teleporter pairs
- Gravity zones
- 4+ new arena templates using combined mechanics
- Agent context enrichment for all new features
- Team system (team_survival, team collect)
