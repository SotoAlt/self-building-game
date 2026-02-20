# Chaos Arena — System Architecture

An AI "Chaos Magician" builds a 3D multiplayer game in real-time while players play and audiences watch.
Tech stack: Three.js + Colyseus + Express + OpenClaw + Claude + PostgreSQL.

---

## How a Game Session Works

A player opens the browser client and authenticates via Privy. The client connects to the Express/Colyseus server over WebSocket and enters the **arena lobby**, where they pick an arena (or auto-join the default "chaos" arena).

Once inside an arena, the player lands in the **lobby phase**. The AI agent (Chaos Magician) — running as a separate process on the host — detects the join and greets the player by name. The agent builds an arena by calling the compose API to spawn platforms, obstacles, and decorations.

After building (or after a 45-second auto-start timeout), the agent calls `start_game` with a template name. The server atomically loads the arena layout and transitions to the **countdown phase**: "GET READY!" appears, players teleport to spawn positions, and a 3-2-1 countdown begins. Players can move freely during countdown but are invulnerable.

The **playing phase** starts. Players race, collect, survive, or compete depending on the game type. The agent watches via its context endpoint, casting spells, spawning obstacles, chatting, and reacting to player behavior — all driven by a drama score (0-100) that determines how frequently it acts.

When the game ends (timer expires, someone wins, or agent calls `end_game`), the server broadcasts results, records scores to the leaderboard, and transitions back to lobby after a 15-second cooldown. The cycle repeats.

Players who join mid-game become spectators until the next round. AFK players get a warning after 120s and are kicked after 15s more. External audiences on Twitch/Discord/Telegram interact via the chat bridge.

---

## System Diagram

```
Browser Client (Three.js + Colyseus)
    |
    | nginx reverse proxy (SSL + WebSocket + SSE)
    |
Game Server (Express + Colyseus, port 3000)
    |           |            |            |
    | HTTP API  | PostgreSQL | SSE Stream | ArenaManager (multi-tenant)
    |           |            |            |
    +-- Chaos Arena (agent-runner.js -> OpenClaw -> Claude)
    +-- External Arena 1 (any AI agent -> HTTP API)
    +-- External Arena N ...

agent-runner.js (host process, 2s tick loop)
    |
    +-- AgentLoop.js (drama score, phase detection)
    +-- AgentBridge.js (OpenClaw CLI invocation)
    +-- OpenClaw -> Claude (Anthropic)
```

---

## Server Architecture

### Entry Point: `src/server/index.js` (256 lines)

Bootstraps Express with CORS, mounts Colyseus with `GameRoom`, initializes the database, loads arena configs, and starts the HTTP server. Route handlers are imported from `src/server/routes/` and mounted via `mountXxxRoutes(router, ctx)` functions. The shared `ctx` object carries references to `arenaManager`, `gameService`, `arenaService`, and the Colyseus server.

Arena middleware (`arenaMiddleware.js`, 56 lines) resolves `arenaId` from the URL path and attaches the correct `ArenaInstance` to `req.arena`. Write endpoints require API key auth via `X-Arena-API-Key` header (the default chaos arena is exempt for backward compatibility).

### Multi-Arena Platform

| File | Lines | Purpose |
|------|-------|---------|
| `ArenaManager.js` | 138 | Central registry — create, get, list, destroy arenas (max 20) |
| `ArenaInstance.js` | 151 | Per-arena state bundle: WorldState, MiniGame, SSE clients, webhooks, timers, AI players |
| `arenaMiddleware.js` | 56 | URL-based arena resolution + API key auth |

Each arena is fully isolated. Creating an arena via `POST /api/arenas` returns an `arenaId` and `apiKey`. Any AI agent can act as game master for its own arena using the HTTP API. Arena configs persist in the PostgreSQL `arenas` table.

### World State

`WorldState.js` (278 lines) is a facade that delegates to 8 focused sub-managers in `src/server/managers/`:

| Manager | Lines | Responsibility |
|---------|-------|----------------|
| `EntityManager` | 322 | Entities Map, secondary indices (`_kinematicIds`, `_chasingIds`, `_groupIndex`), add/remove/modify/clear |
| `PlayerManager` | 116 | Players Map, join/leave, AFK detection, spectator activation, `activeHumanCount` |
| `GameStateMachine` | 183 | Phase lifecycle (lobby/countdown/playing/ended), timers, auto-start, game history |
| `EnvironmentManager` | 147 | Physics config, floor type, environment (sky/fog/lighting), hazard plane, respawn point |
| `SpellManager` | 51 | Cast/clear spells, cooldown enforcement, active effects |
| `ChatManager` | 68 | Messages array, announcements, events |
| `LeaderboardManager` | 54 | Score recording, top-N queries, DB sync |
| `ChallengeManager` | 70 | Challenge CRUD, progress tracking |

The facade re-exports all manager methods so consumers (routes, GameRoom, MiniGame) access a single `worldState` object.

### Game Engine

**`MiniGame.js`** (508 lines) — Base class for all game types. Handles the trick system (time/score/death triggers that fire mid-game), random obstacle spawning (sweepers, moving walls, pendulums, falling blocks), time randomization, and the end-game flow (result broadcast, leaderboard recording, delayed cleanup). Entities spawned during a game are tagged with `gameId` for automatic removal.

**`src/server/games/`** — 6 game type implementations:

| File | Lines | Type | Win Condition |
|------|-------|------|---------------|
| `ReachGoal.js` | 166 | reach | First to reach the goal trigger |
| `CollectGame.js` | 200 | collect | Most collectibles at timeout |
| `Survival.js` | 195 | survival | Last standing or longest alive |
| `KingOfHill.js` | 223 | king | First to target score via hill control |
| `HotPotato.js` | 265 | hot_potato | Last standing after multi-round curse elimination |
| `Race.js` | 211 | race | First to complete ordered checkpoints |

**`ArenaTemplates.js`** (822 lines) — 16 pre-built arena layouts. Each template defines entity positions, environment settings, floor type, and game type. `randomizeTemplate()` varies positions, speeds, and delays each time a template loads for replayability.

### Entity Composition

| File | Lines | Purpose |
|------|-------|---------|
| `Prefabs.js` | 483 | 23 named presets (spider, spinning_blade, bounce_pad, checkpoint, etc.) with behaviors (patrol, rotate, pendulum, crush) |
| `Composer.js` | 273 | Recipe validation, disk cache (`data/compose-cache.json`), prefab resolution. The agent's primary spawning tool — `POST /api/world/compose` |

The compose system is the agent's only way to create entities. Known prefab names resolve instantly. Custom creations require an agent-generated recipe (up to 12 children, 23 shapes, material properties, per-child rotation). Recipes are cached to disk for instant re-spawning.

`GeometryTemplates.js` (in `src/shared/` on server, `src/client/` on client) — 16 named geometry templates (horn, tentacle, wing, dome, column, etc.) shared between server validation and client rendering.

### HTTP API Routes

Routes are split across 7 files in `src/server/routes/`:

| File | Lines | Endpoints |
|------|-------|-----------|
| `worldRoutes.js` | 206 | compose, destroy, modify, environment, floor, physics, clear, spawn-prefab, destroy-group |
| `gameRoutes.js` | 267 | start, end, state, trick, chat, announce, leaderboard, spell, challenge |
| `bribeRoutes.js` | 200 | submit bribe, honor bribe, check bribes |
| `agentRoutes.js` | 188 | agent context, pause/resume, status, drama score, AI players, building phase |
| `publicRoutes.js` | 163 | public state/leaderboard/events/stats, SSE stream, webhooks, skill.md |
| `arenaRoutes.js` | 88 | create/list/destroy arenas |
| `authRoutes.js` | 44 | auth verification, user profile |

Services (`src/server/services/`):
- `gameService.js` (158 lines) — game start/end logic, template application, auto-start scheduling
- `arenaService.js` (127 lines) — arena CRUD, arena callback coordination

### Agent System

**`AgentLoop.js`** (372 lines) — The brain's scheduler. Calculates a drama score (0-100) based on player count, active game phase, recent events, and chat activity. The score determines invoke frequency: 0-20 = rare (45s intervals), 80-100 = every tick. Detects session phases (welcome, warmup, gaming, intermission, escalation, finale). Manages the player welcome queue — detects joins and queues `pendingWelcomes` so the agent greets players by name. Enforces cooldown guards (skips invocation during 15s post-game cooldown). Auto-pauses when 0 active humans are connected.

**`AgentBridge.js`** (181 lines) — Invokes the OpenClaw CLI with `execFile` (async, non-blocking). Constructs the prompt with full game context: player positions, chat history, game state, available templates, variety hints. Includes the drama score and session phase.

**`agent-runner.js`** (545 lines, root directory) — The sole agent system. Runs on the VPS host (not inside Docker) because it needs the OpenClaw CLI. Polls `/api/agent/context` every 2 seconds. Tracks state: `lastProcessedChatId`, `welcomedPlayers`, `processedBribeIds` to avoid re-processing. Pacing: max 3 world-changing actions per turn, 3s minimum for @mentions, 15s standard minimum, 30s for audience-only mode.

**`chat-bridge.js`** (304 lines, root directory) — Bridges Twitch, Discord, and Telegram chats into the game via `POST /api/chat/bridge`. Agent responses relay back via SSE stream. Rate-limited: 10s cooldown between relayed messages.

### Real-Time Communication

**`GameRoom.js`** (402 lines) — Colyseus room handling 50+ WebSocket message types. Player movement sync, chat, game state broadcasts, entity updates. Detects mid-game joins and activates spectator mode. AFK heartbeat monitoring with configurable idle/kick timers. Messages are filtered by `arenaId` so arenas don't leak into each other.

**SSE Stream** — Server-Sent Events endpoint (`GET /api/stream/events`) for OBS overlays and external consumers. Broadcasts game events, chat messages, announcements, and agent actions.

---

## Client Architecture

### Entry Point: `src/client/main.js` (197 lines)

Orchestrator that initializes the Three.js scene, connects to Colyseus, and runs the game loop. Imports and wires together 48 modules across 12 subdirectories. The game loop runs at 60fps via `requestAnimationFrame`:

```
updatePhysics -> updateCamera -> updateParticles -> animateEntities ->
updateShaderTime -> interpolateRemotePlayers -> renderFrame
```

### Rendering Pipeline

| File | Lines | Purpose |
|------|-------|---------|
| `ToonMaterials.js` | 270 | TSL NodeMaterial cel-shaded material factory with gradient maps and emissive tuning. `_materialCache` Map prevents duplicate allocations |
| `PostProcessing.js` | 168 | 3-tier adaptive quality (high/medium/low) with FPS-driven tier switching. WebGPU RenderPipeline with toon outline pass |
| `ProceduralTextures.js` | 440 | Runtime texture generation for various surface types |
| `SurfaceShaders.js` | 159 | TSL surface shaders for ice, conveyor, and wind surfaces. Time-based UV scrolling |
| `EnvironmentEffects.js` | 336 | Skybox dome, fog, dynamic lighting, SpriteNodeMaterial ambient particles |
| `PlayerVisuals.js` | 147 | Player character model construction, squash-stretch animation |
| `CameraController.js` | 177 | Orbit camera for gameplay + spectator free-fly mode. Pre-allocated Vector3s to avoid GC |
| `SceneSetup.js` | 61 | Scene initialization, WebGPURenderer setup, lighting |

### Entity System

| File | Lines | Purpose |
|------|-------|---------|
| `entities/EntityFactory.js` | 191 | `_geometryCache` Map keyed by `"type|shape|sx|sy|sz"` — 111 hex platforms share 1 geometry. Glow caching for emissive entities |
| `entities/EntityManager.js` | 317 | Entity lifecycle (add/update/remove), composed group assembly with debounce, clone-on-write materials for per-entity mutations |
| `entities/EntityBehaviors.js` | 126 | Kinematic, chasing, pendulum, orbiting entity behaviors |
| `entities/InstancedBatchManager.js` | 198 | InstancedMesh batching — groups identical geometries into single draw calls |
| `GeometryTemplates.js` | 201 | 16 named geometry templates (horn, tentacle, wing, dome, column, etc.) |

### Physics and Collision

| File | Lines | Purpose |
|------|-------|---------|
| `physics/PhysicsEngine.js` | 399 | AABB collision detection, gravity, velocity integration, death/respawn logic, trigger activation, surface effects (ice, conveyor, wind) |
| `physics/SpatialHash.js` | 86 | 2D grid (XZ plane), cell size 8, 3x3 neighborhood queries. ~90% collision check reduction vs brute force |

### Input

| File | Lines | Purpose |
|------|-------|---------|
| `input/InputManager.js` | 89 | Unified action map: keyboard events -> `moveForward`, `moveBack`, `moveLeft`, `moveRight`, `jump`, `sprint` |
| `input/MobileControls.js` | 188 | Virtual joystick (touch drag), touch camera (right-side drag), action buttons (jump/sprint) |

### Network

| File | Lines | Purpose |
|------|-------|---------|
| `network/NetworkManager.js` | 85 | Colyseus connection management, exponential backoff reconnection (1s -> 30s max) |
| `network/MessageHandlers.js` | 16 | Re-exports from handlers/ subdirectory |
| `network/handlers/GameStateHandlers.js` | 202 | Game state, countdown, collectibles, challenges |
| `network/handlers/EntityHandlers.js` | 57 | Entity add/update/remove |
| `network/handlers/PlayerHandlers.js` | 71 | Player join/leave/respawn |
| `network/handlers/EffectHandlers.js` | 134 | Spells, environment, disconnect, AFK |
| `network/HttpApi.js` | 83 | REST polling: `fetchInitialState()`, `fetchLeaderboard()`, `pollForUpdates()` |
| `ConnectionManager.js` | 60 | Colyseus connect/disconnect, intentional disconnect flag |

### Scene

| File | Lines | Purpose |
|------|-------|---------|
| `scene/FloorManager.js` | 90 | Floor mesh lifecycle — creates/destroys floor based on type (solid/none/lava), applies surface materials |

### UI Modules (12 files in `src/client/ui/`)

| File | Lines | Purpose |
|------|-------|---------|
| `GameStatusHUD.js` | 108 | rAF-debounced `updateUI()`, game timer, score overlays (king points, hot potato timer, race checkpoints) |
| `ChatSystem.js` | 118 | Chat input/display, @agent mentions, message history |
| `Announcements.js` | 108 | Global announcements with max 3 visible, duration cap 4s, reconnect overlay |
| `ArenaLobby.js` | 98 | Arena selection screen, chaos arena pinned with FEATURED badge |
| `BribePanel.js` | 200 | 6 predefined bribe options (30-200 tokens), submit flow |
| `ProfilePanel.js` | 258 | Player profile, stats display |
| `AfkOverlay.js` | 94 | AFK warning with 15s kick countdown, rejoin option |
| `SpectatorOverlay.js` | 45 | Spectator mode indicator and controls |
| `DebugPanel.js` | 44 | Runtime debug controls (`?debug=true`) |
| `AuthFlow.js` | 147 | Privy authentication integration |
| `Leaderboard.js` | 58 | Top players display with cached JSON |
| `GameMenu.js` | 62 | In-game menu (change arena, logout) |

### Audio and VFX

| File | Lines | Purpose |
|------|-------|---------|
| `audio/SoundManager.js` | 146 | Procedural tone generation (`createTone`), `playSound` wrapper, countdown beeps, win fanfare |
| `vfx/ScreenEffects.js` | 148 | Camera shake, screen flash, vignette overlays, particle pool with Float32Array, quality-tier enforcement |
| `vfx/ParticleUtils.js` | 31 | Shared TSL soft-circle node + SpriteNodeMaterial factory for WebGPU particles |

### Configuration and State

| File | Lines | Purpose |
|------|-------|---------|
| `config.js` | 77 | `SERVER_URL`, URL params (`?debug`, `?spectator`, `?arena`), `isMobile` detection, `getApiBase()` |
| `state.js` | 124 | Shared mutable state: `player`, `playerVelocity`, `camera`, `remotePlayers`, `entityMeshes`, `auth`, `countdown` |
| `auth.js` | 233 | Privy client-side auth, JWT token management |
| `math.js` | 10 | `lerp()` utility |
| `PrivyBridge.jsx` | 115 | React mount for Privy auth widget |

### Performance Optimizations

- **Geometry cache**: `EntityFactory._geometryCache` keyed by `"type|shape|sx|sy|sz"` — identical entities share geometry (e.g., 111 hex platforms use 1 `BufferGeometry`)
- **Material cache**: `ToonMaterials._materialCache` for non-animated types; `EntityManager` uses clone-on-write for per-entity mutations
- **Spatial hash**: O(1) collision lookups via `SpatialHash` replacing O(n) brute force. Cell size 8, 3x3 neighborhood
- **Particle budget**: quality-tier enforcement (ultra: 20, low: 5 max concurrent particle systems)
- **UI debouncing**: rAF dirty flag on `GameStatusHUD.updateUI()`, leaderboard JSON caching
- **Adaptive quality**: `PostProcessing` monitors FPS and auto-switches between high/medium/low tiers
- **InstancedMesh batching**: `InstancedBatchManager` merges identical geometries into single draw calls — 100 identical platforms become 1 draw call
- **SpriteNodeMaterial particles**: WebGPU-native billboarded sprites via TSL (replaced PointsMaterial which renders 1px dots in WebGPU)
- **Console stripping**: Production builds strip all `console.*` calls via esbuild at build time

---

## Shared Code

`src/shared/constants.js` (98 lines) — Canonical definitions for `ENTITY_TYPES`, `GAME_TYPES`, `SPELL_TYPES`, `FLOOR_TYPES`, physics defaults, and timing constants. Imported by both server managers and client modules to ensure consistency.

---

## Data Flow Diagrams

### Player Movement
```
Keyboard -> InputManager -> PhysicsEngine (local prediction) -> sendToServer()
-> GameRoom broadcast -> MessageHandlers -> RemotePlayers (interpolation)
```

### Agent Action
```
Drama tick (2s) -> AgentLoop (should invoke?) -> AgentBridge -> OpenClaw CLI
-> Claude -> HTTP API (compose/start_game/cast_spell/chat)
-> WorldState mutation -> GameRoom broadcast -> Client update
```

### Entity Spawn (Compose)
```
Agent calls POST /api/world/compose { description, position, recipe? }
-> Composer: resolve prefab OR validate recipe OR cache hit
-> EntityManager.addEntity() for each child (tagged with groupId)
-> GameRoom broadcasts "entity_added" per entity
-> Client EntityManager.addEntity() -> EntityFactory.createMesh() -> THREE.Scene
-> Group assembly (debounced): wrap children in THREE.Group for unified movement
```

### Game Lifecycle
```
Agent: POST /api/game/start { template: "parkour_hell" }
-> gameService.startGame() -> ArenaTemplates.load() -> randomizeTemplate()
-> GameStateMachine: lobby -> countdown (3s, invulnerable)
-> MiniGame.start() -> playing phase (obstacles spawn, tricks fire)
-> Timer expires OR win condition -> MiniGame.end()
-> Results broadcast, leaderboard record -> ended phase (3s)
-> GameStateMachine: ended -> lobby (15s cooldown)
```

---

## Configuration and Deployment

### Docker Stack
```
docker-compose.yml:
  game:     Node.js server (Express + Colyseus, port 3000)
  postgres: PostgreSQL 15 (leaderboard, arenas, game history)
  nginx:    SSL termination, WebSocket/SSE proxy
  certbot:  Let's Encrypt auto-renewal
```

### Host Processes (not in Docker)
- `agent-runner.js` — needs OpenClaw CLI installed on host (~700MB RAM per invocation)
- `chat-bridge.js` — optional, connects Twitch/Discord/Telegram

### OpenClaw Skill Files
The agent's behavior is defined by three files that must be synced to the OpenClaw workspace:

| Source (repo) | Destination (VPS) |
|---------------|-------------------|
| `config/openclaw/game-world-skill.js` | `/root/.openclaw/workspace/skills/game-world/index.js` |
| `config/openclaw/game-world-skill.md` | `/root/.openclaw/workspace/skills/game-world/SKILL.md` |
| `config/openclaw/SOUL.md` | `/root/.openclaw/workspace/SOUL.md` |

`deploy.sh` syncs these automatically. After updating, restart the `chaos-agent` systemd service for the new session to pick up changes.

### Environment
- Production: `https://chaos.waweapps.win` on Hetzner VPS (178.156.239.120)
- Local dev: `npm run dev` — Vite dev server (5173) + game server (3000), no PostgreSQL needed (in-memory fallback)

---

## File Inventory

### Server (46 JS files, ~9,000 lines)

```
src/server/
  index.js              256   Bootstrap, middleware, Colyseus room registration
  WorldState.js         278   Facade over 8 sub-managers
  GameRoom.js           402   WebSocket handlers, spectator, AFK heartbeat
  MiniGame.js           508   Game base class, tricks, obstacles, scoring
  AgentLoop.js          372   Drama score, phase detection, invoke scheduling
  AgentBridge.js        181   OpenClaw CLI invocation, prompt construction
  ArenaTemplates.js     822   16 arena layouts with randomization
  Prefabs.js            485   23 entity presets with behaviors
  Composer.js           273   Recipe validation, disk cache, prefab resolution
  ArenaManager.js       138   Arena registry (max 20)
  ArenaInstance.js      152   Per-arena state bundle
  arenaMiddleware.js     56   URL-based arena resolution + API key auth
  AIPlayer.js           331   AI bot personalities
  auth.js                99   Privy JWT verification
  db.js                 375   PostgreSQL with in-memory fallback
  constants.js           75   Timing, physics, AFK constants
  validation.js          38   Request validation helpers
  test.js               145   Test utilities
  managers/
    EntityManager.js    322   Entities Map, secondary indices
    PlayerManager.js    116   Players, AFK, spectator
    GameStateMachine.js 183   Phase lifecycle, timers, history
    EnvironmentManager.js 147 Physics, floor, environment
    SpellManager.js      51   Spells, cooldowns
    ChatManager.js       68   Messages, announcements
    LeaderboardManager.js 54  Scores, DB sync
    ChallengeManager.js  70   Challenges, stats
    index.js              8   Re-exports
  routes/
    worldRoutes.js      206   Entity CRUD, environment, physics
    gameRoutes.js       267   Game lifecycle, chat, spells
    bribeRoutes.js      200   Bribe system
    agentRoutes.js      188   Agent context, control
    publicRoutes.js     163   Public API, SSE, webhooks
    arenaRoutes.js       88   Arena CRUD
    authRoutes.js        44   Auth verification
    index.js              7   Re-exports
  services/
    gameService.js      158   Game start/end logic
    arenaService.js     127   Arena CRUD coordination
  games/
    ReachGoal.js        166   Race to goal
    CollectGame.js      200   Gather collectibles
    Survival.js         195   Last standing
    KingOfHill.js       223   Hill control scoring
    HotPotato.js        265   Curse transfer elimination
    Race.js             211   Ordered checkpoints
    index.js             35   Game type registry
  blockchain/
    ChainInterface.js    97   Mock chain + bribe system
    MonadChainInterface.js 136 Monad chain integration
```

### Client (48 JS/JSX files, ~7,000 lines)

```
src/client/
  main.js               197   Orchestrator, game loop, module wiring
  ToonMaterials.js      270   TSL NodeMaterial cel-shaded material factory
  PostProcessing.js     168   3-tier adaptive quality, WebGPU outline pass
  ProceduralTextures.js 440   Runtime texture generation
  SurfaceShaders.js     159   TSL surface shaders for ice/conveyor/wind
  EnvironmentEffects.js 336   Sky, fog, lighting, SpriteNodeMaterial particles
  PlayerVisuals.js      147   Player model, squash-stretch
  CameraController.js   177   Orbit + spectator camera
  GeometryTemplates.js  201   16 geometry templates
  SceneSetup.js          61   Scene init, WebGPURenderer, lighting
  ConnectionManager.js   60   Colyseus connect/disconnect, intentional disconnect flag
  PrivyBridge.jsx       115   Privy React bridge
  auth.js               233   Client-side auth, JWT
  config.js              77   URL params, server URL, mobile detection
  state.js              124   Shared mutable state
  math.js                10   lerp utility
  entities/
    EntityFactory.js    191   Geometry/glow cache, mesh creation
    EntityManager.js    317   Lifecycle, group assembly, clone-on-write
    EntityBehaviors.js  126   Kinematic, chasing, pendulum, orbiting behaviors
    InstancedBatchManager.js 198  InstancedMesh batching for identical geometries
  physics/
    PhysicsEngine.js    399   AABB collision, gravity, triggers, surfaces
    SpatialHash.js       86   2D grid for O(1) lookups
  input/
    InputManager.js      89   Keyboard action map
    MobileControls.js   188   Virtual joystick + touch camera
  network/
    NetworkManager.js    85   Colyseus connection, reconnection
    MessageHandlers.js   16   Re-exports from handlers/
    HttpApi.js           83   REST polling
    handlers/
      GameStateHandlers.js 202  Game state, countdown, collectibles, challenges
      EntityHandlers.js    57  Entity add/update/remove
      PlayerHandlers.js    71  Player join/leave/respawn
      EffectHandlers.js   134  Spells, environment, disconnect, AFK
  scene/
    FloorManager.js      90   Floor mesh lifecycle
  rendering/
    RemotePlayers.js    214   Remote player interpolation, chat bubbles
  audio/
    SoundManager.js     146   Procedural tones, sound playback
  vfx/
    ScreenEffects.js    148   Shake, flash, particles, vignette
    ParticleUtils.js     31   TSL soft-circle node + SpriteNodeMaterial factory
  ui/
    GameStatusHUD.js    108   Timer, score overlays
    ChatSystem.js       118   Chat input/display
    Announcements.js    108   Global announcements
    ArenaLobby.js        98   Arena selection
    BribePanel.js       200   Bribe options
    ProfilePanel.js     258   Player profile
    AfkOverlay.js        94   AFK warning
    SpectatorOverlay.js  45   Spectator indicator
    DebugPanel.js        44   Debug controls
    AuthFlow.js         147   Auth integration
    Leaderboard.js       58   Top players
    GameMenu.js          62   In-game menu (change arena, logout)
```

### Shared (1 JS file, 98 lines)

```
src/shared/
  constants.js           98   ENTITY_TYPES, GAME_TYPES, SPELL_TYPES, FLOOR_TYPES
```

### Root Scripts

```
agent-runner.js         545   Chaos arena agent loop (sole agent system)
agent-runner-host.js    254   Reference external arena agent
chat-bridge.js          304   Twitch/Discord/Telegram bridge
```
