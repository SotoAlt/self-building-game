# Game Mechanics Expansion

Design document for new mechanics in the Self-Building Game. Organized by implementation priority — agent creative tools first, environment mechanics second, game types third, player abilities last.

**Current state (v0.20.0)**: 3 game types (reach, collect, survival), 6 entity types (platform, ramp, collectible, obstacle, trigger, decoration), 8 shapes, 12 prefabs, 8 spells, 7 arena templates (incl. hex_a_gone), breakable platforms, bounce pads, speed strips, 4 random obstacle patterns.

---

## 1. Prefab Entities (Agent Creative Tools)

### Problem

The agent can only spawn geometric primitives. When a player says "spawn spiders", the agent creates grey cubes because it has no concept of compound entities with behaviors. There's no visual or behavioral variety beyond color and shape.

### Solution

A **prefab registry** — named entity presets that bundle multiple child entities, colors, behaviors, and collision rules into a single spawn call. The agent says `spawn_prefab({ name: 'spider', position: [5, 1, 0] })` and gets a multi-part entity that looks and acts like a spider.

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
| `conveyor_belt` | Flat box with animated arrow texture | Stationary | Pushes player/entities in `properties.direction` |
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

## 2. Environment Mechanics (Dynamic Arenas)

The arena itself should change during gameplay, creating emergent challenges beyond static layouts.

### Breakable Platforms (Hex-A-Gone style)

Platforms that crack and disappear when stepped on.

- **Entity property**: `breakable: true`, `breakDelay: 500` (ms after player contact)
- **Sequence**: player steps on → crack visual/sound → platform fades → removed from collision
- **Regeneration**: optional `breakRegenDelay: 5000` — platform reappears after N ms
- **Use case**: survival games with layered floors — players race to stay on remaining platforms
- **Agent tool**: `set_entity_breakable({ id, delay, regenDelay })` or spawn with property directly

### Rising Hazard Plane

A rising lava/water surface that forces players upward.

- **API**: `POST /api/world/hazard-plane` → `{ type: 'lava' | 'water', riseSpeed: 0.5, startY: -10 }`
- **Behavior**: plane mesh rises at constant speed, kills players whose Y position falls below it
- **Visual**: lava = red/orange emissive plane with particle effects; water = blue semi-transparent
- **Agent tool**: `set_hazard_plane({ type, riseSpeed, startY, maxY })`
- **Use case**: "Slime Climb" style games — vertical climb under time pressure

### Conveyor Zones

Surfaces that push players in a direction.

- **Entity property**: `conveyor: true`, `conveyorDirection: [1, 0, 0]`, `conveyorSpeed: 5`
- **Effect**: players on surface get velocity added in direction each physics tick
- **Visual**: animated directional arrows on surface
- **Use case**: obstacle courses where players fight against current, or speed boosts along track

### Wind Zones

Area-of-effect volumes that push players.

- **Entity type or property**: `wind_zone` type, or `windForce: [0, 10, 0]` on trigger entities
- **Effect**: all players within bounds receive force in direction each tick
- **Variants**: horizontal (push off platforms), vertical updraft (extend jumps), downdraft (slam down)
- **Agent tool**: `spawn_wind_zone({ position, size, direction, force })`
- **Use case**: courses where wind pushes players sideways off narrow bridges

### Ice Physics

Surfaces with reduced friction.

- **Entity property**: `surface: 'ice'`
- **Effect**: player deceleration reduced by 80% while on surface — momentum carries
- **Visual**: light blue tint, slight transparency
- **Use case**: narrow ice paths over abyss, ice + wind combos

### Trap Doors

Platforms that open/disappear when triggered.

- **Entity property**: `trapdoor: true`, `trapTrigger: 'proximity' | 'timer' | 'weight'`
- **Triggers**:
  - `proximity` — opens when a player steps on it (with configurable delay)
  - `timer` — opens/closes on a cycle (`trapCycleMs: 3000`)
  - `weight` — opens after N players stand on it simultaneously
- **Visual**: distinct edge pattern so players can identify trap doors vs normal platforms
- **Use case**: "trust no floor" arenas, elimination traps in survival games

### Gravity Zones

Localized gravity overrides.

- **Entity type**: trigger with `localGravity: [0, 5, 0]`
- **Variants**:
  - Inverted gravity: `[0, 15, 0]` — fall upward within zone
  - Zero-G: `[0, 0, 0]` — float freely
  - Heavy: `[0, -40, 0]` — extra gravity pull
  - Lateral: `[10, -20, 0]` — pulled sideways
- **Visual**: particle field indicating gravity direction within zone
- **Use case**: spatial puzzles, unique navigation challenges, secret paths

### Portals / Teleporters

Paired entities that teleport players between locations.

- **Implementation**: two trigger entities with `teleportTarget: entityId` pointing at each other
- **Cooldown**: 2s per player to prevent oscillation
- **Visual**: ring shape with swirling particle effect, color-matched pairs
- **Agent tool**: part of `spawn_prefab({ name: 'teleporter', ... })` or direct entity property
- **Use case**: creative arena layouts, shortcuts, portal networks

---

## 3. Game Types & Modifiers

### New Game Types

#### King of the Hill (`king`)

Control zones to earn points over time.

- **Setup**: 1-3 "hill" zones marked in arena (trigger entities with `isHill: true`)
- **Scoring**: players earn 1 point/second while sole occupant of a hill zone; contested zones award nothing
- **Win**: first to target score, or highest when time expires
- **Visual**: hill zones glow team color of controlling player, contested zones flash
- **Trick potential**: agent can move hills mid-game, add/remove hills, shrink zones

#### Hot Potato (`hot_potato`)

Don't be holding the curse when the timer expires.

- **Setup**: one random player receives "the curse" (red glow VFX, trail particles)
- **Transfer**: curse passes on collision with another player (2s transfer cooldown)
- **Elimination**: player holding curse when sub-timer hits 0 is eliminated
- **Rounds**: multi-round — last player standing wins the game
- **Visual**: cursed player has red glow, screen vignette, heartbeat sound that speeds up near timer end
- **Trick potential**: agent can add multiple curses, reverse curse direction, grant immunity

#### Dodgeball (`dodgeball`)

Throw projectiles to eliminate opponents.

- **Setup**: projectile pickup entities spawn in arena periodically
- **Pickup**: player touches projectile to collect (max 1 held at a time)
- **Throw**: action key fires projectile in look direction with physics arc
- **Hit**: target is eliminated (or takes damage if health system exists)
- **Win**: last player standing
- **Visual**: held projectile shown orbiting player, thrown = fast sphere with trail
- **Trick potential**: agent spawns more/fewer projectiles, adds bounce-back walls, gives specific players ammo

#### Race (`race`)

Checkpoint-based race through an obstacle course.

- **Setup**: ordered sequence of checkpoint triggers placed along a route
- **Rules**: players must hit checkpoints in order — skipping doesn't count
- **Tracking**: HUD shows current checkpoint / total for each player
- **Win**: first to complete all checkpoints
- **Visual**: next checkpoint glows for each player, completed ones dim
- **Difference from Reach**: reach has one goal; race has a multi-point ordered path

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

| Tool | Parameters | Purpose |
|------|-----------|---------|
| `spawn_prefab` | `{ name, position, properties }` | Spawn named prefab (multi-entity group) |
| `set_hazard_plane` | `{ type, riseSpeed, startY, maxY }` | Rising lava/water hazard |
| `spawn_wind_zone` | `{ position, size, direction, force }` | Area-of-effect wind push |
| `set_entity_breakable` | `{ id, delay, regenDelay }` | Make existing platform breakable |
| `spawn_enemy` | `{ type, position, patrolPath }` | NPC enemy entity |
| `assign_teams` | `{ teams }` | Assign players to teams |
| `start_game` (update) | `{ template, modifiers }` | Accept modifier list |

### Enhanced Agent Context (`/api/agent/context`)

New fields:
- `availablePrefabs` — list of prefab names the agent can spawn
- `activeModifiers` — modifiers applied to current game
- `hazardPlane` — current hazard plane state (type, Y position, speed)
- `enemyCount` — active NPC enemies in world
- `teams` — team assignments if team game active
- `playerHealth` — per-player health if health system active

---

## 6. Arena Template Expansion

New templates that showcase the new mechanics.

| Template | Mechanics Used | Game Type | Description |
|----------|---------------|-----------|-------------|
| `hex_a_gone` | Breakable platforms, multi-layer | Survival | 3-layer grid of breakable tiles over abyss — last player standing |
| `slime_climb` | Rising lava, vertical climb | Reach | Tall vertical course with rising lava — race upward before it catches you |
| `dodgeball_arena` | Projectile system | Dodgeball | Enclosed flat arena with projectile spawners and cover walls |
| `king_of_hill` | Conveyor belts, hill zones | King | Multi-hill arena with conveyors pushing players off hills |
| `ice_rink` | Ice physics, obstacles | Survival | All-ice surfaces with moving obstacles — momentum is deadly |
| `wind_tunnel` | Wind zones, narrow paths | Reach | Horizontal course with lateral wind pushing players off bridges |
| `trap_house` | Trap doors, crushers, fake floors | Reach | Nothing is safe — every surface might be a trap |
| `enemy_gauntlet` | Turrets, spiders, projectiles | Reach | Sprint through turret fire and spider patrols to reach the goal |

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

### Phase 2: Environment Mechanics

**Priority**: MEDIUM — makes arenas feel alive and dynamic.

**Scope**: 1 session

- Rising hazard plane (lava/water) — server entity + client renderer
- Conveyor belt entity property + physics effect
- Wind zone entity type + force application
- Ice surface property + friction reduction
- `slime_climb` and `wind_tunnel` templates
- Agent tools: `set_hazard_plane`, `spawn_wind_zone`
- Update agent context with hazard/environment state

### Phase 3: New Game Types + Modifiers

**Priority**: HIGH — multiplies replayability. Modifiers make existing templates feel new.

**Scope**: 1-2 sessions

- King of the Hill game type (`src/server/games/KingOfHill.js`)
- Hot Potato game type (`src/server/games/HotPotato.js`)
- Race with checkpoints game type (`src/server/games/Race.js`)
- Game modifier system — composable, applied at game start
- Implement 4 modifiers: `rising_lava`, `breakable_floor`, `enemy_waves`, `sudden_death`
- Update `start_game` API and agent tool to accept `modifiers`
- Deeper existing game enhancements (competitive collect stealing, survival elimination feed)

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
