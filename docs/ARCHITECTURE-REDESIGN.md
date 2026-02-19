# Chaos Arena: Complete Architecture Redesign Plan

> **Status**: Chunks 1-5 COMPLETE. Next: Chunk 6 (WorldState decomposition) or Chunk 7 (shared code).
> **Version**: v0.46.0 (was v0.38.0 baseline)
> **Date**: February 17-18, 2026

## Executive Summary

**Current state**: ~15,500 lines across server (8,530) and client (7,017), with two god files — `index.js` (1,808 lines, 75+ routes) and `main.js` (4,018 lines, everything). Production at v0.38.0.

**Goal**: Modular, scalable architecture for a full multiplayer online game across all devices.

**Approach**: 9 incremental chunks (Schema deferred), each deployable independently. No TypeScript rewrite. No breaking changes to external API.

**Priority**: Client-first (break up `main.js`, performance optimizations), then server routes, then WorldState decomposition.

---

## Codebase Health Snapshot

| Metric | Baseline (v0.38) | Current (v0.46) | Target |
|--------|-----------------|-----------------|--------|
| Largest server file | 1,808 lines (index.js) | 313 lines (index.js) ✅ | ~200 lines |
| Largest client file | 4,018 lines (main.js) | 293 lines (main.js) ✅ | ~150 lines |
| Server modules | 15 files | 27 files | 40+ focused files |
| Client modules | 11 files | 35+ files ✅ | 35+ focused files |
| Collision detection | O(n) brute force | O(n) brute force | O(1) spatial hash |
| Per-frame allocations | ~6 Vector3/frame | 0 (pre-allocated) ✅ | 0 (pre-allocated) |
| Object pooling | None | None | Particles, meshes |
| Colyseus state sync | Manual broadcasts | Manual broadcasts | Schema delta sync (deferred) |
| Mobile optimization | Basic (pixelRatio cap) | Basic (pixelRatio cap) | Adaptive quality tiers |
| Input abstraction | None (raw keys + touch) | Unified action map ✅ | Unified action map |
| Reconnection | 5 retries, flat 2s delay | Exponential backoff ✅ | Exponential backoff, state restore |
| CSS | 1,570 lines inline in HTML | 2 modular CSS files ✅ | Modular CSS files |

---

## CHUNK 1: Foundation ✅ COMPLETE (Feb 18, 2026)

> Implementation simplified CSS extraction to 2 files (game.css + mobile.css) instead of 15 granular files — pragmatic choice, can split later if needed.

### Phase 1A: Constants & Validation Extraction

**Files to create:**

- `src/server/constants.js` — extract all magic numbers from `index.js` (lines 37-108): `MIN_LOBBY_MS`, `AUTO_START_DELAY`, `BRIBE_OPTIONS`, `ALL_TEMPLATES`, `getTemplateGameType()`
- `src/server/validation/schemas.js` — input validation for WS/HTTP: `validatePosition()`, `validateVelocity()`, `validateMoveData()`, `validateEntityId()`, `validateChatText()`

**Files to modify:**

- `src/server/WorldState.js` — add `MAX_ENTITIES = 500` limit in `spawnEntity()`
- `src/server/GameRoom.js` — add `validateMoveData()` to `onMessage('move')` handler, validate all other WS message inputs
- `src/server/AgentBridge.js` — replace `exec()` with `execFile()` to fix shell injection risk (line 46)

### Phase 1B: CSS Extraction

**Files to create** (under `src/client/styles/`):

| File | Content |
|------|---------|
| `variables.css` | CSS custom properties (colors, spacing, fonts, shadows) |
| `base.css` | Reset, body, scrollbar, selection, global layout |
| `effects.css` | Animations, keyframes, transitions |
| `login.css` | Login screen, auth buttons, branding |
| `lobby.css` | Arena lobby, arena cards, featured badge |
| `hud.css` | Game status bar, timer, score overlays |
| `chat.css` | Chat panel, messages, input |
| `leaderboard.css` | Leaderboard table, rank styles |
| `wallet.css` | Wallet panel, token balance |
| `bribe.css` | Bribe modal, option cards, transaction UI |
| `announcements.css` | Toast messages, announcement banners |
| `help.css` | Help overlay, controls legend |
| `spectator.css` | Spectator overlay, drama meter, kill feed |
| `game-overlays.css` | Win/lose/draw screens, countdown, phase transitions |
| `mobile.css` | Touch controls, joystick, responsive breakpoints |
| `index.css` | Imports all above files |

**Files to modify:**

- `index.html` — remove 1,570-line `<style>` block, add `<link>` to bundled CSS
- `src/client/main.js` — add `import './styles/index.css'` at top; remove dynamic CSS injection from `setupMobileControls()` (lines 360-468)

**Verification**: `npm run dev` + `npm run build`, test all screens desktop + mobile.

---

## CHUNK 2: Client Leaf Module Extraction ✅ COMPLETE (Feb 18, 2026)

> Extracted ~850 lines from main.js into 7 new modules. Pre-allocated Vector3s in CameraController eliminate 6 per-frame GC allocations. Mutable state grouped into objects (player.mesh, camera.yaw, etc.) instead of individual setter functions.

### Phase 2A: State & Config

**Files to create:**

- `src/client/config.js` — extract URL params (`isSpectator`, `isDebug`, `urlArena`), server URL construction, `isMobile` detection
- `src/client/state.js` — extract shared mutable state: `state` object, `entityMeshes` Map, `remotePlayers` Map, `keys` object, `currentFloorType`, `isSpectator`

### Phase 2B: Audio & VFX

**Files to create:**

- `src/client/audio/SoundManager.js` — extract lines 1192-1335: `createTone()`, `playSound()`, all sound functions (jump, death, collect, countdown, win, spell, crack, break, bounce)
- `src/client/vfx/ScreenEffects.js` — extract `cameraShake`, `triggerCameraShake()`, `updateCameraShake()`, screen flash, vignette overlay

### Phase 2C: Camera & Input

**Files to create:**

- `src/client/rendering/CameraController.js` — extract lines 275-765: camera state, `updateCamera()`, `updateSpectatorCamera()`, `getCameraDirections()`, `updateSpectatorMovement()`, spectator mode helpers. **Pre-allocate** reusable Vector3s (fixes 6 per-frame allocations)
- `src/client/input/InputManager.js` — extract lines 1564-1833: unified action map (`moveForward`, `moveBack`, `moveLeft`, `moveRight`, `jump`, `sprint`), `getMovementInput()` that normalizes keyboard + joystick
- `src/client/input/MobileControls.js` — extract lines 330-635: joystick, touch camera, action buttons, feeds into unified action map

**Verification**: Camera rotation, WASD, mobile joystick, spectator free-fly all work.

---

## CHUNK 3: Client Entity & Physics System ✅ COMPLETE (Feb 18, 2026)

> Implementation simplified vs. original plan: kept physics+collision together (too tightly coupled to split), kept chat bubbles with remote players (natural coupling), deferred ObjectPool/SpatialHash/material cache to Chunk 9. main.js: 3,075 → 2,124 lines (-951).

### Phase 3A: Entity System

**Files created:**

- `src/client/entities/EntityFactory.js` (140 lines) — pure factory functions: `createBeveledBox()`, `getGeometry()`, `createEntityMesh()`
- `src/client/entities/EntityManager.js` (273 lines) — entity lifecycle, group assembly with debounce, per-frame entity/group animations

### Phase 3B: Physics & Collision

**Files created:**

- `src/client/physics/PhysicsEngine.js` (411 lines) — player physics, AABB collision, death/respawn, triggers, pre-allocated Vector3s for moveDir and platformVelocity

### Phase 3C: Remote Players & Chat Bubbles

**Files created:**

- `src/client/rendering/RemotePlayers.js` (207 lines) — remote player meshes, name sprites, chat bubbles, interpolation

**Verification**: Build passes, browser test confirms entity rendering, physics, player movement, camera follow, ground collision, chat panel, lobby HUD — zero console errors.

---

## CHUNK 4: Client Network & UI Extraction ✅ COMPLETE (Feb 18, 2026)

> Implementation deferred Phase 4C Quality Manager Enhancement (bidirectional quality scaling) to a separate chunk. Extracted 15 new files across 3 phases. main.js: 2,109 → 293 lines. Removed redundant 100ms position send interval (PhysicsEngine already sends at 50ms).

### Phase 4A: Network Layer

**Files to create:**

- `src/client/network/NetworkManager.js` — extract lines 2510-2550: Colyseus connection, `sendToServer()`, exponential backoff reconnection (1s, 2s, 4s... 30s max)
- `src/client/network/MessageHandlers.js` — extract lines 2549-2938: all 50 `room.onMessage()` handlers as `registerHandlers(room)`, each delegating to subsystem modules
- `src/client/network/HttpApi.js` — extract: `fetchInitialState()`, `pollForUpdates()`, `fetchLeaderboard()`, `apiFetch()` helper

**Quick wins:**

- Remove redundant 100ms position send interval (lines 4006-4013) — the 50ms throttled send suffices
- Make backup HTTP polling conditional on WS disconnect, increase to 10s

### Phase 4B: UI Modules

**Files to create** (under `src/client/ui/`):

| File | Source lines | Content |
|------|-------------|---------|
| `GameStatusHUD.js` | 2370-2443 | `updateGameStateUI()`, countdown |
| `ChatSystem.js` | 1835-1952 | `setupChat()`, `sendChatMessage()`, `displayChatMessage()` |
| `Announcements.js` | 2185-2344 | `showToast()`, `showAnnouncement()` |
| `AfkOverlay.js` | 2217-2306 | AFK warning/kicked screens |
| `ArenaLobby.js` | 3848-3929 | Arena list rendering |
| `BribePanel.js` | 3288-3492 | Bribe modal, transaction signing |
| `ProfilePanel.js` | 3584-3845 | Wallet tabs, history |
| `SpellEffects.js` | 2348-2365 | Spell VFX overlay |
| `DebugPanel.js` | 3540-3581 | Debug controls |
| `SpectatorOverlay.js` | 3494-3538 | Drama meter, kill feed |
| `AuthFlow.js` | 3139-3286 | Login screen, 3 auth paths |

### Phase 4C: Quality Manager Enhancement

**Files to modify:**

- `src/client/PostProcessing.js` -> enhance as `src/client/core/QualityManager.js`: bidirectional quality (degrade at <30fps, recover at >55fps after 15s), mobile defaults (cap at `medium` tier, pixelRatio 1.5, no bloom)

**Result**: `main.js` shrinks from 4,018 lines to ~150 lines (orchestrator only).

---

## CHUNK 5: Server Route Extraction ✅ COMPLETE (Feb 18, 2026)

> Extracted 70+ route handlers and 10 helper functions from index.js into 7 route files + 2 service files. index.js: 1,768 → 313 lines (82% reduction). Zero API changes.

### Phase 5A: Route Files

**Files to create** (under `src/server/routes/`):

| File | Source lines in index.js | Endpoints |
|------|-------------------------|-----------|
| `auth.js` | 407-445 | /auth/privy, /auth/guest, /me |
| `arenas.js` | 451-532 | Arena CRUD (6 endpoints) |
| `world.js` | 557-773 | agent/context, world/*, physics, players |
| `game.js` | 874-1036 | game/types, start, end, state, trick |
| `chat.js` | 1041-1083 | chat/messages, send, bridge |
| `spells.js` | 1111-1147 | spell/cast, clear, active |
| `bribe.js` | 1149-1263 | bribe CRUD (5 endpoints) |
| `stats.js` | 1089-1105, 1265-1303 | leaderboard, transactions, balance |
| `agent.js` | 1309-1344 | agent status/pause/resume/drama |
| `ai.js` | 1350-1368 | AI player enable/disable |
| `agentPlayer.js` | 1500-1604 | External agent player API |
| `sse.js` | 1374-1398 | SSE event stream |
| `webhooks.js` | 1404-1435 | Webhook CRUD |
| `publicApi.js` | 1441-1497 | Public state/events/stats |
| `index.js` | — | Aggregator: `mountGameRoutes(router, ctx)` |

Each route file exports `mountXxxRoutes(router, ctx)` where `ctx` is a dependency bag containing `worldState`, `miniGame`, `agentLoop`, `db`, etc.

### Phase 5B: Service Extraction

**Files to create** (under `src/server/services/`):

| File | Source lines | Content |
|------|-------------|---------|
| `GameService.js` | 146-273 | `applyTemplate()`, `doStartGame()`, `scheduleAutoStart()` |
| `BribeService.js` | 275-344 | `executeAutoBribe()` |
| `AIPlayerService.js` | 346-363 | `spawnAIPlayers()`, `despawnAIPlayers()` |
| `ArenaCallbackService.js` | 365-398 | `setupArenaCallbacks()` |
| `TickService.js` | 1700-1794 | 100ms tick loop as class: `start()`, `stop()`, `tick()`, `tickArena()` |

**Result**: `index.js` shrinks from 1,808 lines to ~200 lines (bootstrap + middleware + Colyseus setup).

---

## CHUNK 6: Server WorldState Decomposition (Medium-High Risk)

### Phase 6: Split WorldState into Sub-Managers

**Files to create** (under `src/server/state/`):

| Manager | Extracted from WorldState | Approx Lines |
|---------|--------------------------|-------------|
| `EntityManager.js` | entities Map, spawnEntity, modifyEntity, destroyEntity, clearEntities, group ops, breakable platforms, kinematic/chase updates | ~350 |
| `PlayerManager.js` | players Map, add/update/remove, AFK tracking, spectator activation, `getActiveHumanCount()` | ~150 |
| `GameStateMachine.js` | phase transitions, startGame/endGame, resetGameState, cooldowns, timers, gameHistory | ~180 |
| `EnvironmentManager.js` | physics, floor, environment, hazard plane, respawn point | ~150 |
| `SpellManager.js` | castSpell, cooldowns, activeEffects, SPELL_TYPES | ~80 |
| `ChatManager.js` | messages, announcements, events, counters | ~100 |
| `LeaderboardManager.js` | leaderboard Map, recordGameResult, DB sync | ~60 |

**WorldState.js becomes a facade** (~200 lines): composes all managers, exposes identical public API via delegation. `this.entities` and `this.players` remain direct references to the sub-manager Maps for backward compatibility.

**Critical**: Cross-manager wiring via callbacks (not imports) to avoid circular deps:

```js
entityMgr.setPlayerPositionProvider(() => playerMgr.getAlivePositions());
gameStateMachine.setEntityClearer(() => entityMgr.clearEntities());
```

**Verification**: Full game cycle (join -> lobby -> countdown -> play -> death -> respawn -> game end -> lobby), agent context endpoint, spell casting, AFK detection.

---

## CHUNK 7: Shared Code & Cross-Device (Medium Risk)

### Phase 7A: Shared Constants

**Files to create:**

- `src/shared/constants.js` — physics values (gravity -76.5, jump 26.5, speeds), entity types, game types, spell types. Used by both client and server to ensure identical behavior.

### Phase 7B: Adaptive Quality Tiers

Enhancement to `QualityManager.js`:

| Tier | pixelRatio | Shadows | Post-Processing | Particles/Burst |
|------|-----------|---------|----------------|-----------------|
| ultra | 2.0 | 2048 | Full | 20 |
| high | 1.5 | 1024 | Bloom only | 15 |
| medium | 1.25 | Off | FXAA only | 10 |
| low | 1.0 | Off | Off | 5 |

- Device detection: `navigator.hardwareConcurrency`, screen size, `navigator.gpu`
- Mobile auto-caps at `medium`
- FPS monitoring: degrade at <30fps (3s sustained), recover at >55fps (15s sustained)

### Phase 7C: Reconnection Improvements

- Colyseus `allowReconnection(client, 20)` in `GameRoom.onLeave()` for 20s window
- Client: exponential backoff (1s, 2s, 4s... 30s max), "Reconnecting..." overlay, state restore on rejoin
- Conditional backup polling (only when WS disconnected)

---

## CHUNK 8: Colyseus Schema Migration (DEFERRED)

> **Status**: Deferred to a future session. Current manual broadcast system works well for current player counts. Revisit when approaching 50+ concurrent players per arena.

**Why defer**: The manual broadcast system (50+ message types via `broadcastToRoom()`) is explicit and debuggable. Schema migration requires rewriting both server state management AND all 50 client message handlers — high effort with high regression risk. The performance benefit (20-50x bandwidth reduction for position updates) only matters at scale.

**When to implement** (any of these triggers):

- 50+ concurrent players per arena
- Bandwidth costs become significant
- Late-joiner state desync bugs become frequent

**Schema design (preserved for future)**:

```
Vec3 (float32 x, y, z)
PlayerSchema (7 fields: id, name, type, state, position, velocity, lastActivity)
EntitySchema (6 fields: id, entityType, position, size, propertiesJson, createdAt)
GameStateSchema (6 fields: phase, currentGame, gameType, startTime, timeLimit, cooldownUntil)
EnvironmentSchema (11 fields: sky, fog, ambient, sun, floor)
GameRoomState (9 fields: players MapSchema, entities MapSchema, gameState, environment, hazardPlane, activeSpells, gravity, friction, bounce)
```

**Migration strategy**: Dual-mode transition — run both broadcasts + Schema sync during migration, remove broadcasts last. Keep `room.onMessage()` for transient events: chat, announcements, VFX triggers.

---

## CHUNK 9: Performance Optimization Pass

### Priority 1 — Biggest wins, easiest

1. **Pre-allocate Vector3 instances** (Chunk 2C/3B) — eliminates ~6 allocs/frame
2. **Remove redundant 100ms move send** (Chunk 4A) — pure deletion
3. **Conditional backup polling** (Chunk 4A) — saves bandwidth when WS healthy

### Priority 2 — Medium effort, significant impact

4. **Object pool for particles** (Chunk 3A) — eliminates GC pauses
5. **Spatial hash for collision** (Chunk 3B) — O(n) -> O(1) lookups
6. **Material sharing cache** (Chunk 3A) — fewer draw calls

### Priority 3 — Larger effort

7. **InstancedMesh** for repeated platforms (e.g., hex_a_gone's 111 platforms)
8. **Bidirectional quality scaling** (Chunk 4C)
9. **Mobile-specific rendering** (Lambert materials, no bloom)

### Priority 4 — Polish

10. **Leaderboard DOM caching** (only update changed entries)
11. **Debounce `updateUI()`** to once per 100ms
12. **Reduce outline pass frequency** on low tiers

---

## Implementation Order & Dependencies

```
CHUNK 1 (Foundation)         ── No dependencies, start here
  Phase 1A: Constants/Validation   (1-2 hours)
  Phase 1B: CSS Extraction         (2-3 hours)

CHUNK 2 (Client Leaves)     ── Depends on 1B
  Phase 2A: State & Config         (1 hour)
  Phase 2B: Audio & VFX            (1 hour)
  Phase 2C: Camera & Input         (2-3 hours)

CHUNK 3 (Client Core)       ── Depends on 2
  Phase 3A: Entity System          (3-4 hours)
  Phase 3B: Physics                (3-4 hours)
  Phase 3C: Remote Players         (1-2 hours)

CHUNK 4 (Client Network/UI) ── Depends on 3
  Phase 4A: Network Layer          (2-3 hours)
  Phase 4B: UI Modules             (3-4 hours)
  Phase 4C: Quality Manager        (1 hour)

CHUNK 5 (Server Routes)     ── Depends on 1A (parallel with Chunks 2-4)
  Phase 5A: Route Files            (3-4 hours)
  Phase 5B: Service Extraction     (2-3 hours)

CHUNK 6 (Server State)      ── Depends on 5
  Phase 6: WorldState Split        (4-6 hours)

CHUNK 7 (Cross-Device)      ── Depends on 4C + 6
  Phase 7A: Shared Constants       (1 hour)
  Phase 7B: Quality Tiers          (2 hours)
  Phase 7C: Reconnection           (2 hours)

CHUNK 8 (Schema Migration)  ── DEFERRED
```

**Chunks 1-4 (client) and Chunks 1,5-6 (server) can proceed in parallel.**

---

## Target File Structure (Post-Refactor)

```
src/
  shared/
    constants.js                # Physics, game types, spells (client+server)

  server/
    index.js                    # ~200 lines: bootstrap, middleware, Colyseus
    GameRoom.js                 # Colyseus room handlers
    constants.js                # Server-only constants
    routes/
      index.js                  # Aggregator: mountGameRoutes(router, ctx)
      auth.js                   # /auth/privy, /auth/guest, /me
      arenas.js                 # Arena CRUD
      world.js                  # agent/context, world/*, physics
      game.js                   # game/types, start, end, state
      chat.js                   # chat/messages, send, bridge
      spells.js                 # spell/cast, clear, active
      bribe.js                  # bribe CRUD
      stats.js                  # leaderboard, transactions
      agent.js                  # agent status/pause/resume
      ai.js                     # AI player toggle
      agentPlayer.js            # External agent player API
      sse.js                    # SSE event stream
      webhooks.js               # Webhook CRUD
      publicApi.js              # Public state/events/stats
    services/
      GameService.js            # applyTemplate, doStartGame, scheduleAutoStart
      BribeService.js           # executeAutoBribe
      AIPlayerService.js        # spawn/despawn AI players
      ArenaCallbackService.js   # setupArenaCallbacks
      TickService.js            # 100ms tick loop
    state/
      EntityManager.js          # Entities, groups, breakable platforms
      PlayerManager.js          # Players, AFK, spectators
      GameStateMachine.js       # Phase transitions, timers
      EnvironmentManager.js     # Physics, floor, environment
      SpellManager.js           # Spells, cooldowns, effects
      ChatManager.js            # Messages, announcements
      LeaderboardManager.js     # Scores, DB sync
    validation/
      schemas.js                # Input validation
    games/                      # 6 game types (unchanged)
    blockchain/                 # Chain interfaces (unchanged)
    ArenaManager.js             # (unchanged)
    ArenaInstance.js            # (unchanged)
    ArenaTemplates.js           # (unchanged)
    Prefabs.js                  # (unchanged)
    Composer.js                 # (unchanged)
    AgentLoop.js                # (unchanged)
    AgentBridge.js              # (fixed shell injection)
    AIPlayer.js                 # (unchanged)
    auth.js                     # (unchanged)
    db.js                       # (unchanged)
    arenaMiddleware.js          # (unchanged)

  client/
    main.js                     # ~150 lines: orchestrator
    config.js                   # URL params, device detection
    state.js                    # Shared mutable state
    styles/
      index.css                 # Imports all below
      variables.css             # CSS custom properties
      base.css                  # Reset, body, scrollbar
      effects.css               # Animations, keyframes
      login.css                 # Login screen
      lobby.css                 # Arena lobby
      hud.css                   # Game status bar
      chat.css                  # Chat panel
      leaderboard.css           # Leaderboard table
      wallet.css                # Wallet panel
      bribe.css                 # Bribe modal
      announcements.css         # Toast messages
      help.css                  # Help overlay
      spectator.css             # Spectator UI
      game-overlays.css         # Win/lose/countdown
      mobile.css                # Touch controls, responsive
    core/
      QualityManager.js         # Adaptive quality tiers
    input/
      InputManager.js           # Unified action map
      MobileControls.js         # Touch joystick + buttons
    rendering/
      CameraController.js       # Camera + spectator
      RemotePlayers.js          # Remote player meshes
      ChatBubbles.js            # Speech bubble sprites
      ParticleSystem.js         # Pooled particles
    entities/
      EntityFactory.js          # Geometry + material creation
      EntityManager.js          # Lifecycle + groups
      EntityAnimations.js       # Per-frame animations
      ObjectPool.js             # Generic pool
    physics/
      PhysicsEngine.js          # Player movement
      CollisionSystem.js        # AABB + spatial hash
      SpatialHash.js            # Grid partitioning
    network/
      NetworkManager.js         # Colyseus + reconnection
      MessageHandlers.js        # 50 WS handlers
      HttpApi.js                # REST polling
    audio/
      SoundManager.js           # Procedural sounds
    vfx/
      ScreenEffects.js          # Shake, flash, vignette
    environment/
      FloorManager.js           # Floor types, hazard plane
    ui/
      GameStatusHUD.js          # Game state, timer, score
      ChatSystem.js             # Chat panel
      Announcements.js          # Toasts, banners
      AfkOverlay.js             # AFK warning/kicked
      ArenaLobby.js             # Arena list
      BribePanel.js             # Bribe modal
      ProfilePanel.js           # Wallet tabs, history
      SpellEffects.js           # Spell VFX overlay
      DebugPanel.js             # Debug controls
      SpectatorOverlay.js       # Drama meter, kill feed
      AuthFlow.js               # Login flow
    auth/
      auth.js                   # (unchanged)
      PrivyBridge.jsx           # (unchanged)
    # Unchanged visual modules:
    ToonMaterials.js
    ProceduralTextures.js
    SurfaceShaders.js
    GeometryTemplates.js
    PlayerVisuals.js
    PostProcessing.js
    EnvironmentEffects.js
```

---

## Verification Checklist (After Each Chunk)

- [ ] `npm run dev` starts without errors
- [ ] `npm run build` produces working dist/
- [ ] Desktop: login -> arena lobby -> join -> full game cycle -> chat -> leaderboard
- [ ] Mobile: same flow with touch controls, joystick, camera drag
- [ ] Spectator: `?spectator=true`, free-fly, player follow
- [ ] Debug: `?debug=true`, AI toggle, agent toggle
- [ ] Agent context: `curl localhost:3000/api/agent/context` returns full data
- [ ] SSE stream: `curl localhost:3000/api/stream/events` works
- [ ] Arena CRUD: create/list/delete via curl
- [ ] Reconnection: kill server, verify client reconnects
- [ ] Performance: Chrome DevTools — no new hot-path allocations, FPS stable

---

## Preserved (Do Not Touch)

- OpenClaw agent integration (`agent-runner.js` on host)
- Multi-arena system (ArenaManager + ArenaInstance pattern)
- External agent API (`/api/arenas/:id/...` with API key auth)
- Game type inheritance (MiniGame base + 6 types)
- Compose pipeline (Composer.js + recipe cache)
- Drama score agent pacing system
- Cartoon visual style (cel shading, procedural textures, GLSL shaders)
- Physics feel (PHYSICS constants, coyote time, jump buffer)
- All CSS design tokens and variable names
- Privy auth flow
- Blockchain chain interface
