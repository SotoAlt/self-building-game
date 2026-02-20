# Architecture Improvements v2 — Three.js + Colyseus Audit

Audit of the Chaos Arena architecture against the official Three.js r183 docs and modern multiplayer best practices. Covers performance gaps, modularity assessment, and a prioritized improvement roadmap.

**Audited against**: [Three.js LLM Docs](https://threejs.org/docs/llms.txt), [Three.js Full Docs](https://threejs.org/docs/llms-full.txt), [Colyseus State Sync](https://docs.colyseus.io/state)

**Scope**: ~50 concurrent players, mobile-important, WebGL-only, more built-in game types coming.

---

## Current State Summary

**Client**: 38 files, ~6,500 lines. WebGLRenderer, EffectComposer post-processing, custom GLSL shaders, AABB physics with spatial hash, 4-tier adaptive quality system.

**Server**: 46 files, ~9,000 lines. Express + Colyseus with manual broadcasts (not using Colyseus schema state sync). Client-authoritative movement with basic server validation. Event-driven (no fixed server tick).

**Networking**: ~20 Hz position updates, individual entity broadcasts, no spatial filtering, no delta compression, no client prediction.

---

## What's Good (Keep)

| Pattern | Where | Why It's Good |
|---------|-------|---------------|
| Geometry cache by key | EntityFactory.js | Deduplicates identical geometries (e.g., 111 hex platforms → 1 BufferGeometry) |
| Material cache (static types) | ToonMaterials.js | Prevents duplicate material allocations for platforms/ramps |
| Clone-on-write materials | EntityManager.js (client) | Only clones when animation mutates a shared material |
| Spatial hash (collision) | SpatialHash.js | O(1) collision queries replacing O(n) brute force |
| Adaptive quality tiers | PostProcessing.js | FPS-driven auto-degradation (ultra→low) with bidirectional recovery |
| Secondary indices (server) | EntityManager.js (server) | `_kinematicIds`, `_chasingIds`, `_groupIndex` avoid O(n) scans |
| Pre-allocated vectors | CameraController.js | `_tempLookTarget`, `_tempForward` etc. eliminate per-frame GC |
| Particle budget enforcement | ScreenEffects.js | Quality-tier caps (ultra:20, low:5 max systems) |
| Event-driven entity lifecycle | GameRoom.js | Spawn/destroy broadcasts are clear and debuggable |
| Exponential backoff reconnect | NetworkManager.js | 1s→30s with token-based fast-path |

---

## Critical Gaps (vs Three.js r183 Docs)

### Tier 1: High Impact, Moderate Effort

#### 1. No InstancedMesh — Biggest Single Win
**Current**: Every entity creates its own `THREE.Mesh` with shared geometry. 111 hex platforms = 111 draw calls.
**Three.js docs**: `InstancedMesh` renders N identical geometries in 1 draw call. `BatchedMesh` handles mixed geometries in 1 call.
**Impact**: Could reduce draw calls from ~200 to ~10-20 for typical arenas. Especially impactful on mobile.
**Approach**: Group entities by `(geometry_cache_key, material_type)` → one InstancedMesh per group. Animated entities (obstacles, collectibles) stay as individual meshes since they need per-instance material mutations.
**Complexity**: Medium — EntityFactory/EntityManager need rework. Instance transforms update via `setMatrixAt()` instead of `mesh.position`.
**Files**: `src/client/entities/EntityFactory.js`, `src/client/entities/EntityManager.js`

#### 2. No Message Batching — Death by 1000 Broadcasts
**Current**: Each entity spawn/destroy is an individual WebSocket message. Loading a 111-platform template = 111 `entity_spawned` messages.
**Best practice**: Batch entity operations. Template load could send a single `entities_batch` message with all 111 entities.
**Impact**: Reduces connection overhead, especially on template load (currently a burst of 100+ messages).
**Approach**: Add `broadcast('entities_batch', entities[])` for bulk operations; client handles batch in single rAF frame.
**Files**: `src/server/GameRoom.js`, `src/client/network/MessageHandlers.js`

#### 3. No Geometry Merging for Static Environments
**Current**: Arena platforms are individual meshes that never move.
**Three.js docs**: `BufferGeometryUtils.mergeGeometries()` merges static geometry into single draw call.
**Impact**: For static arena layouts (most platforms don't move), merging could cut draw calls by 60-80%.
**Tradeoff**: Merged geometry can't be individually removed/animated. Only works for truly static platforms.
**Approach**: On template load, identify static entities (no `movement`, no `breakable`), merge into single geometry. Keep dynamic entities separate.
**Files**: `src/client/entities/EntityManager.js`

#### 4. Remote Player Extrapolation Missing
**Current**: Remote players lerp to latest received position at 0.15 factor. No velocity-based prediction.
**Best practice**: Use received velocity to extrapolate position between updates, then blend toward correction.
**Impact**: Much smoother remote player movement, especially at 20 Hz update rate with varying latency.
**Approach**: Store velocity with each update, extrapolate `pos += vel * dt` between updates, blend toward new target on arrival.
**Files**: `src/client/rendering/RemotePlayers.js`

### Tier 2: Medium Impact, Higher Effort

#### 5. Not Using Colyseus Schema State Sync
**Current**: Manual `this.broadcast('event', data)` for every change. No auto-delta compression.
**Colyseus docs**: Schema-based state with `@type()` decorators gives automatic binary delta compression. Only changed properties sent. Patches batched per `patchRate` interval.
**Impact**: Could reduce bandwidth 50-70% for state updates. Free delta compression.
**Tradeoff**: Major refactor — WorldState would need to extend Colyseus Schema. All 8 managers' data structures would change.
**Risk**: High — this touches the core state system.
**Recommendation**: **Defer** — the current manual approach works and is debuggable. Revisit if bandwidth becomes a bottleneck at >50 players.

#### 6. No Spatial Filtering (Network Interest Management)
**Current**: All entities broadcast to all clients regardless of distance.
**Best practice**: Only send entities within viewport + buffer radius.
**Impact**: At 200+ entities, this prevents O(entities) bandwidth per client.
**Recommendation**: **Defer** — current entity counts (~50-200) don't warrant this complexity.

#### 7. No LOD System
**Current**: All entities rendered at full detail regardless of camera distance.
**Three.js docs**: `THREE.LOD` auto-switches geometry detail by distance.
**Recommendation**: **Defer** — cel-shaded toon style uses low-poly geometry already. LOD benefit is small for our art style.

#### 8. CPU-Driven Particles → GPU Particles
**Current**: ScreenEffects.js uses Float32Array with per-particle CPU updates, `needsUpdate = true` per frame.
**Three.js docs**: Even with WebGL, `InstancedMesh` particles with vertex shader animation are faster.
**Impact**: Removes CPU particle budget as bottleneck. Could allow richer effects.
**Approach**: Replace per-particle CPU loop with InstancedMesh + time-based vertex shader animation.
**Files**: `src/client/vfx/ScreenEffects.js`

### Tier 3: Low Impact / Future Considerations

#### 9. WebGPURenderer
**Decision**: Stay on WebGL. Maximum compatibility for arcade game.

#### 10. TSL over GLSL
**Decision**: Keep GLSL. Only migrate when adding new shader effects.

#### 11. Texture Atlasing
**Decision**: Skip. Procedural canvas textures are already small for toon style.

#### 12. Server-Side Physics Validation
**Decision**: Defer. Arcade party game — cheating prevention is low priority.

#### 13. Server Fixed Tick Loop
**Current**: `setSimulationInterval(() => {}, 1000/60)` is a no-op. Event-driven only.
**Recommendation**: Consider for future — a 20 Hz server tick would make entity movement authoritative.

---

## Modularity Assessment — For Chaos Arena Development

Evaluated against one question: **Can we add new game types, entity behaviors, and features to Chaos Arena without touching unrelated files?**

This is the practical definition of modularity for a single-product codebase. We're not building a reusable engine — we're building one game that needs to evolve quickly. Modularity serves velocity, not portability.

### What Best Practices Say About Modularity at This Scale

**Three.js** prescribes no architecture — it's a rendering library. But successful Three.js projects at this scale (10-50 files, <10k lines) use a **Manager/System pattern**: each concern (physics, rendering, input, audio) gets a module with a clear API. Full ECS (Entity Component System) is for engines with hundreds of entity types — overkill at our scale.

**Game architecture consensus**: The goal is **changeability** — can you add a new game type or entity behavior without touching unrelated files? The metric isn't "how decoupled are the modules" in abstract, it's "how many files do I edit to add feature X?"

**Colyseus docs** recommend keeping game logic in Room + State classes. Our server already follows this pattern well with GameRoom + WorldState facade.

### Server-Side: Excellent — No Changes Needed

The server is the modularity success story. The 8-manager facade pattern works.

| Strength | Details |
|----------|---------|
| **Manager pattern** | 8 focused managers behind WorldState facade — each independently testable |
| **Plugin-ready games** | New game types: subclass MiniGame, add 1 line to `games/index.js` switch |
| **Configuration-driven** | Physics, timing, limits all in `constants.js` — single source of truth |
| **Multi-tenant** | ArenaManager supports isolated arenas out of the box |
| **Clean route separation** | 7 route files, each exports `mountXxxRoutes(router, ctx)` |
| **Callback-based coupling** | Managers communicate via injected callbacks, not direct imports |

Adding a new game type server-side is clean: create `src/server/games/NewType.js`, add one case to the game type switch. This is the model the client should aspire to.

### Client-Side: Four Concrete Problems

#### Problem 1: `MessageHandlers.js` Is a God File (408 lines, 30+ handlers)

**The pain**: Every WS message handler does 3-4 things inline: update state, manipulate DOM, trigger VFX, play audio. When adding king-of-hill (lines 158-171), hot_potato (lines 173-209), and race (lines 211-226), all game-type-specific UI logic went into this one file mixed with entity spawning, physics changes, and spell effects.

**What it should look like**: Message handlers should be thin dispatchers — receive message, call the right system. The game-type-specific UI (score overlay, curse timer, checkpoint display) belongs in dedicated modules that register themselves.

**Proposed fix**: Split into 4 handler groups:
- `handlers/EntityHandlers.js` — entity_spawned, entity_modified, entity_destroyed, platform_cracking, world_cleared
- `handlers/PlayerHandlers.js` — player_joined, player_left, player_moved, player_died, player_reconnected, player_activated
- `handlers/GameStateHandlers.js` — game_state_changed, lobby_countdown, init, score_update, curse_changed, checkpoint_reached
- `handlers/EffectHandlers.js` — spell_cast, announcement, effects_cleared, floor_changed, environment_changed, hazard_plane_*

Each group imports only what it needs. `registerMessageHandlers(room)` calls all four. Adding a new game type's client-side handlers means editing `GameStateHandlers.js` only.

**Files**: `src/client/network/MessageHandlers.js` → split into `src/client/network/handlers/`

#### Problem 2: Entity Type Switches in Physics + Rendering (Two Files to Edit Per New Behavior)

**The pain**: `PhysicsEngine.js:166-202` has an if/else chain for COLLECTIBLE → OBSTACLE → TRIGGER (with sub-checks for isBounce, isSpeedBoost, isWind). `EntityManager.js:253-279` has a parallel chain for collectible → obstacle → decoration → trigger animations. Every new entity behavior (bounce pads, conveyors, wind zones, speed strips, breakable platforms) required editing both files.

**What it should look like**: Entity behaviors registered once, applied automatically. When adding a "teleporter" entity, you write one behavior definition, not edit two core files.

**Proposed fix**: `EntityBehaviors.js` registry pattern:
```js
// Register collision behavior
EntityBehaviors.onCollision('trigger.bounce', (entity, player) => {
  playerVelocity.y = entity.properties.bounceForce || 18;
  spawnParticles(player.mesh.position, '#2ecc71', 15, 4);
  playBounceSound();
});

// Register animation behavior
EntityBehaviors.onAnimate('collectible', (mesh, entity, delta, time) => {
  mesh.rotation.y += delta;
  mesh.position.y = entity.position[1] + Math.sin(time * 1.5) * 0.15;
});
```

PhysicsEngine and EntityManager then iterate registered behaviors instead of type-switching. New entity types = new registrations, zero edits to core files.

**Files**: New `src/client/entities/EntityBehaviors.js`, refactor `src/client/physics/PhysicsEngine.js:126-266`, `src/client/entities/EntityManager.js:222-281`

#### Problem 3: `main.js` Is Doing Too Much (48 Imports, Inline Scene Setup)

**The pain**: `main.js` creates the scene, camera, renderer, lights, ground, grid, sky dome, and post-processing pipeline inline (lines 52-96). It also wires 12 module initializations (lines 97-113), defines `connectToServer`/`reconnectToServer` (lines 117-151), runs the game loop (lines 155-195), handles window resize (lines 197-205), and orchestrates the full init sequence (lines 207-273).

This isn't a fatal problem — it works. But it means every new system (e.g., adding weather effects or a new UI panel) adds more imports and more init calls to this file.

**What it should look like**: `main.js` should be ~50 lines: create core objects, init subsystems, start loop. Scene setup, connection logic, and init ceremony should live in dedicated modules.

**Proposed fix**:
- Extract `SceneSetup.js` — creates scene, camera, renderer, lights, ground, sky dome. Returns `{ scene, camera, renderer }`.
- Extract `ConnectionManager.js` — `connectToServer()`, `reconnectToServer()`, auth token handling. Currently these functions live inline in main.js and reference `auth`, `state`, `selectedArenaId` directly.
- `main.js` becomes: import scene setup → import connection → init systems → start loop. Target: <80 lines.

**Files**: `src/client/main.js` → extract `src/client/SceneSetup.js`, `src/client/ConnectionManager.js`

#### Problem 4: `state.js` Has No Ownership Boundaries (20+ Exported Mutables)

**The pain**: `state.js` exports 20+ objects (`state`, `auth`, `remotePlayers`, `network`, `floor`, `hazardPlaneState`, `entityMeshes`, `groupParents`, `pendingGroups`, `entityToGroup`, `particles`, `boost`, `collision`, `death`, `activatedTriggers`, `player`, `playerVelocity`, `camera`, `spectator`, `spectatorPos`, `cameraShake`, `afk`, `countdown`). Any module can import and mutate any of them. There's no indication of "who owns what" — PhysicsEngine writes to `player`, `playerVelocity`, `death`, `collision`, `boost`, `activatedTriggers`. MessageHandlers writes to `state`, `hazardPlaneState`, `remotePlayers`, `countdown`. The lack of ownership makes it hard to reason about side effects.

**This is NOT broken** — it works fine for a single-game codebase. The fix is lightweight.

**Proposed fix**: Don't add an event emitter (over-engineering). Instead:
1. Add ownership comments to `state.js` — `// Owner: PhysicsEngine — do not mutate from other modules`
2. Group related state into sub-objects with clear owners: `playerState` (owned by PhysicsEngine), `networkState` (owned by NetworkManager), `renderState` (owned by EntityManager)
3. Freeze the shape — no more ad-hoc properties like `state._cursedPlayerId` added in MessageHandlers

**Files**: `src/client/state.js`

### Modules That Are Fine As-Is

These don't need modularity changes — they're already well-scoped:

| Module | Why It's Fine |
|--------|--------------|
| `PhysicsEngine.js` (core logic) | Collision, gravity, movement — clear purpose. Only the entity type switches need extracting. |
| `SpatialHash.js` | Pure spatial query, zero coupling. |
| `NetworkManager.js` | Colyseus connection with callback-based delegation. |
| `InputManager.js` | Clean keyboard action map. |
| `CameraController.js` | Self-contained orbit + spectator camera. |
| `PostProcessing.js` | Adaptive quality with clean API. |
| `ToonMaterials.js` | Material factory, parameterized. |
| `EntityFactory.js` | Pure mesh creation, geometry caching. |
| `SoundManager.js` | Named sound functions, no coupling. |
| `ScreenEffects.js` | Particles + screen effects, self-contained. |
| All `src/client/ui/` modules | Each UI module is focused (Chat, Bribe, Profile, etc.). |
| `HttpApi.js` | Only 83 lines. The UI imports are fine — not worth decoupling. |

### What NOT to Do (Over-Engineering Traps)

| Temptation | Why It's Wrong for Chaos Arena |
|-----------|-------------------------------|
| **Extract `src/engine/`** | We're not building a reusable engine. Moving files into an engine directory adds indirection without benefit for a single game. |
| **Full event emitter for all state** | Adds indirection and debugging difficulty. Direct imports + ownership comments are clearer at this scale. |
| **ECS (Entity Component System)** | For engines with hundreds of entity types. We have 6 entity types. A simple registry pattern is the right level of abstraction. |
| **Dependency injection container** | The init function pattern (`initPhysics({ scene, sendToServer })`) already serves this purpose. A DI container adds ceremony. |
| **Abstract base classes for UI** | Each UI module is different enough that a shared base class would be forced. Keep them independent. |

---

## Recommended Priority Order

### Phase A — Quick Wins (1-2 days each)

- [x] **A.1: Message batching** for template loads — batch entity spawns into single WS message ✅
  - Files: `src/server/services/gameService.js`, `src/server/routes/worldRoutes.js`, `src/server/Prefabs.js`, `src/server/ArenaInstance.js`, `src/client/network/MessageHandlers.js`
  - Done: `entities_batch`, `entities_destroyed_batch`, and `world_cleared` replace 100+ individual messages per template load. SSE events updated.

- [x] **A.2: Remote player velocity extrapolation** — smoother networked movement ✅
  - Files: `src/client/rendering/RemotePlayers.js`, `src/client/network/MessageHandlers.js`, `src/client/main.js`
  - Done: Velocity stored from `player_moved`, extrapolated each frame, delta-scaled blend factor `1 - 0.85^(delta*60)` for frame-rate independence.

- [x] **A.3: Ensure bounding spheres computed** — enables Three.js built-in frustum culling ✅
  - Files: `src/client/entities/EntityFactory.js`, `src/client/PlayerVisuals.js`
  - Done: `computeBoundingSphere()` at all geometry cache insertion points + player capsule creation.

### Phase B — Major Performance Upgrade (3-5 days)

- [x] **B.1: InstancedMesh for static entities** — biggest single Three.js optimization ✅
  - Files: `src/client/entities/InstancedBatchManager.js` (NEW), `src/client/entities/EntityManager.js`, `src/client/entities/EntityFactory.js`, `src/client/ToonMaterials.js`, `src/client/physics/PhysicsEngine.js`
  - Done: Static platforms/ramps batched into InstancedMesh by geometry key. Per-instance color. Physics collision fallback for instanced entities. Auto-grow capacity. Slot reuse on removal.

### Phase C — Nice-to-Have Improvements

- [ ] **C.1: Static geometry merging** for immovable arena elements
  - When: If InstancedMesh isn't enough (unlikely for toon style)

- [ ] **C.2: GPU-driven particle system** via InstancedMesh + vertex shader
  - When: If particle budget becomes a visible quality limitation

- [ ] **C.3: Server tick loop** (20 Hz) for kinematic entity movement
  - When: If adding more complex entity behaviors (patrol/chase) that need server authority

### Phase D — Client Modularity (Moderate Restructure)

- [x] **D.1: Split MessageHandlers.js** into 4 handler groups (entity, player, game-state, effects) ✅
  - Files: `src/client/network/MessageHandlers.js` → `src/client/network/handlers/` (4 files)
  - Done: EntityHandlers (7 handlers), PlayerHandlers (7), GameStateHandlers (9), EffectHandlers (15 + lifecycle). Thin dispatcher in MessageHandlers.js.

- [x] **D.2: Entity behavior registry** — replace type switches in PhysicsEngine + EntityManager ✅
  - Files: New `src/client/entities/EntityBehaviors.js`, refactored `PhysicsEngine.js` + `EntityManager.js`
  - Done: `COLLISION_BEHAVIORS`, `SURFACE_EFFECTS`, `ANIMATION_BEHAVIORS` registries. Collision dispatch (-36 lines), conveyor check (-6 lines), animation dispatch (-27 lines) replaced with registry lookups. Ice constants exported. New behaviors now require editing only EntityBehaviors.js.

- [x] **D.3: Extract SceneSetup.js + ConnectionManager.js** from main.js ✅
  - Files: `src/client/SceneSetup.js` (NEW), `src/client/ConnectionManager.js` (NEW), `src/client/main.js` refactored
  - Done: Scene/camera/renderer/lights/ground/grid/sky/post-processing creation extracted to `SceneSetup.js`. Colyseus connect/reconnect extracted to `ConnectionManager.js`. main.js reduced from 273 lines (48 imports) to ~170 lines (36 imports) — thin orchestrator.

- [ ] **D.4: Add state.js ownership boundaries** — group state by owner, add comments, freeze shape
  - File: `src/client/state.js`
  - Why: 20+ exported mutables with no indication of who should write to them. Ownership annotations + grouping prevents accidental cross-module mutations.

### Phase E — Deferred (Not Needed at Current Scale)

- [ ] Colyseus schema state sync (if bandwidth > 50KB/s per client)
- [ ] Network interest management / spatial filtering (if entity count > 500)
- [ ] WebGPU / TSL migration (if adding compute-heavy features)
- [ ] LOD system (if adding high-poly models)
- [ ] Texture atlasing (minimal benefit for toon style)
- [ ] Server-side physics validation (if competitive play becomes a focus)

---

## What NOT to Change

- **Client-authoritative movement**: For an arcade party game, instant local response > server authority. The latency tradeoff isn't worth it.
- **Event-driven entity lifecycle**: Explicit spawn/destroy messages are clearer than schema diffing for entity management.
- **Toon shading pipeline**: The EffectComposer + ToonMaterial approach is well-suited for the art style.
- **Manual WebSocket messaging for game events**: Schema sync is good for continuous state, but game events (spells, announcements, phase changes) are better as explicit messages.
- **OpenClaw agent architecture**: The agent-runner.js + OpenClaw pipeline is the product's core differentiator.

---

## Sources

- [Three.js LLM Docs](https://threejs.org/docs/llms.txt) — InstancedMesh, BatchedMesh, LOD, TSL patterns
- [Three.js Full Docs](https://threejs.org/docs/llms-full.txt) — performance checklist, dispose patterns, compute shaders, object pooling
- [Colyseus State Sync](https://docs.colyseus.io/state) — schema-based delta compression
- [Colyseus Schema](https://github.com/colyseus/schema) — incremental binary serializer
- [VR Me Up - InstancedMesh Optimizations](https://vrmeup.com/devlog/devlog_10_threejs_instancedmesh_performance_optimizations.html)
- [100 Three.js Tips (2026)](https://www.utsubo.com/blog/threejs-best-practices-100-tips)
- [Three.js Instances (Codrops)](https://tympanus.net/codrops/2025/07/10/three-js-instances-rendering-multiple-objects-simultaneously/)
