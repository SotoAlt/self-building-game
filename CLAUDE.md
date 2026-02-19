# Self-Building Game — Agent Context

## Project Overview

An AI "Chaos Magician" (Claude via OpenClaw) builds a 3D multiplayer game in real-time while players play and audiences watch. Multi-arena platform where any AI agent can host its own arena.

## Current Phase

**Production v0.50.0** — deployed at `https://chaos.waweapps.win` on Hetzner VPS.

## Architecture

See **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** for the full system architecture with data flow diagrams, module descriptions, and file inventory.

```
Browser Client (Three.js + Colyseus)
    |
    | nginx (SSL + WebSocket + SSE)
    |
Game Server (Express + Colyseus, port 3000)
    |           |            |            |
    | HTTP API  | PostgreSQL | SSE Stream | ArenaManager (multi-tenant)
    |           |            |            |
    +-- Chaos Arena (agent-runner.js -> OpenClaw -> Claude)
    +-- External Arena N (any AI agent -> HTTP API)
```

## Directory Structure

```
src/
  server/                       46 JS files, ~9,000 lines
    index.js                    Bootstrap, middleware, Colyseus setup (256 lines)
    WorldState.js               Facade over 8 sub-managers (278 lines)
    GameRoom.js                 WebSocket handlers, spectator, AFK (402 lines)
    MiniGame.js                 Game base class, tricks, obstacles (508 lines)
    AgentLoop.js                Drama score, phase detection, scheduling (372 lines)
    AgentBridge.js              OpenClaw CLI invocation (181 lines)
    ArenaTemplates.js           16 arena layouts (822 lines)
    Prefabs.js                  23 entity presets (483 lines)
    Composer.js                 Recipe validation, disk cache (273 lines)
    ArenaManager.js             Arena registry, max 20 (138 lines)
    ArenaInstance.js            Per-arena state bundle (151 lines)
    arenaMiddleware.js          URL arena resolution + API key auth (56 lines)
    AIPlayer.js                 AI bot personalities (331 lines)
    auth.js                     Privy JWT verification (99 lines)
    db.js                       PostgreSQL + in-memory fallback (375 lines)
    constants.js                Timing, physics, AFK constants (75 lines)
    validation.js               Request validation (38 lines)
    managers/                   8 focused state managers
      EntityManager.js          Entities Map, secondary indices (322 lines)
      PlayerManager.js          Players, AFK, spectator (116 lines)
      GameStateMachine.js       Phase lifecycle, timers, history (183 lines)
      EnvironmentManager.js     Physics, floor, environment (147 lines)
      SpellManager.js           Spells, cooldowns (51 lines)
      ChatManager.js            Messages, announcements (68 lines)
      LeaderboardManager.js     Scores, DB sync (54 lines)
      ChallengeManager.js       Challenges, stats (70 lines)
    routes/                     7 route files
      worldRoutes.js            Entity CRUD, environment, physics (206 lines)
      gameRoutes.js             Game lifecycle, chat, spells (267 lines)
      bribeRoutes.js            Bribe system (200 lines)
      agentRoutes.js            Agent context, pause/resume (188 lines)
      publicRoutes.js           Public API, SSE, webhooks (163 lines)
      arenaRoutes.js            Arena CRUD (88 lines)
      authRoutes.js             Auth verification (44 lines)
    services/                   Business logic
      gameService.js            Game start/end, auto-start (158 lines)
      arenaService.js           Arena CRUD coordination (127 lines)
    games/                      6 game types
      ReachGoal.js              Race to goal (166 lines)
      CollectGame.js            Gather collectibles (200 lines)
      Survival.js               Last standing (195 lines)
      KingOfHill.js             Hill control scoring (223 lines)
      HotPotato.js              Curse transfer elimination (265 lines)
      Race.js                   Ordered checkpoints (211 lines)
    blockchain/                 Mock chain + bribe system
  client/                       38 JS/JSX files, ~6,500 lines
    main.js                     Orchestrator, game loop (273 lines)
    ToonMaterials.js            Cel-shaded material factory (247 lines)
    PostProcessing.js           Adaptive quality, outline pass (249 lines)
    ProceduralTextures.js       Runtime textures (440 lines)
    SurfaceShaders.js           GLSL for ice/conveyor/wind (236 lines)
    EnvironmentEffects.js       Sky, fog, lighting, weather (349 lines)
    PlayerVisuals.js            Player model, squash-stretch (145 lines)
    CameraController.js         Orbit + spectator camera (177 lines)
    GeometryTemplates.js        16 geometry templates (201 lines)
    auth.js                     Privy client-side auth (233 lines)
    config.js                   URL params, server URL (77 lines)
    state.js                    Shared mutable state (95 lines)
    entities/
      EntityFactory.js          Geometry/glow cache, mesh creation (189 lines)
      EntityManager.js          Lifecycle, group assembly (281 lines)
    physics/
      PhysicsEngine.js          AABB collision, gravity, triggers (407 lines)
      SpatialHash.js            2D grid for O(1) lookups (86 lines)
    input/
      InputManager.js           Keyboard action map (89 lines)
      MobileControls.js         Virtual joystick + touch (188 lines)
    network/
      NetworkManager.js         Colyseus connection (85 lines)
      MessageHandlers.js        50+ WS message handlers (408 lines)
      HttpApi.js                REST polling (83 lines)
    scene/
      FloorManager.js           Floor mesh lifecycle (93 lines)
    rendering/
      RemotePlayers.js          Remote player interpolation (201 lines)
    audio/
      SoundManager.js           Procedural tones (146 lines)
    vfx/
      ScreenEffects.js          Shake, flash, particles (157 lines)
    ui/                         11 UI modules
      GameStatusHUD.js          Timer, score overlays (108 lines)
      ChatSystem.js             Chat input/display (118 lines)
      Announcements.js          Global announcements (108 lines)
      ArenaLobby.js             Arena selection (82 lines)
      BribePanel.js             Bribe options (200 lines)
      ProfilePanel.js           Player profile (258 lines)
      AfkOverlay.js             AFK warning (91 lines)
      SpectatorOverlay.js       Spectator indicator (45 lines)
      DebugPanel.js             Debug controls (44 lines)
      AuthFlow.js               Auth integration (147 lines)
      Leaderboard.js            Top players (58 lines)
  shared/
    constants.js                ENTITY_TYPES, GAME_TYPES, SPELL_TYPES (98 lines)
config/openclaw/
  game-world-skill.js           30 Chaos Magician tools
  game-world-skill.md           SKILL.md — tool descriptions for OpenClaw
  game-player-skill.js          8 external agent player tools
  SOUL.md                       Chaos Magician personality
agent-runner.js                 Chaos arena agent loop (545 lines)
agent-runner-host.js            Reference external arena agent (254 lines)
chat-bridge.js                  Twitch/Discord/Telegram bridge (304 lines)
index.html                      Game UI (298 lines)
```

## Development Commands

```bash
npm install          # Install dependencies
npm run dev          # Vite dev server + game server (hot-reload)
npm start            # Production server (serves dist/)
npm run build        # Build client for production
```

## Key API Endpoints

All game endpoints available at both `/api/...` (default chaos arena) and `/api/arenas/:arenaId/...` (specific arena).

| Endpoint | Purpose |
|----------|---------|
| `GET /api/agent/context` | Full game state for agent decisions |
| `POST /api/game/start` | Start mini-game (with optional `template` param) |
| `POST /api/game/end` | End current game |
| `POST /api/world/compose` | Compose anything — prefabs, cached, or new recipes |
| `POST /api/world/destroy-group` | Destroy all entities in a group |
| `POST /api/spell/cast` | Cast spell (playing phase only, 10s cooldown) |
| `POST /api/chat/send` | Agent sends message (3s rate limit) |
| `POST /api/announce` | Global announcement (5s rate limit) |
| `POST /api/agent/pause` | Kill switch — pause agent |
| `POST /api/agent/resume` | Resume agent |
| `POST /api/arenas` | Create arena (returns arenaId + apiKey) |
| `GET /api/arenas` | List all arenas |
| `POST /api/chat/bridge` | External platform chat (Twitch/Discord/Telegram) |
| `GET /api/stream/events` | SSE feed for OBS overlays |
| `GET /skill.md` | Self-documenting API guide for external agents |

## Agent System

- **agent-runner.js** is the sole agent system — runs on VPS host (not in Docker), has OpenClaw CLI access
- **2s tick interval** with drama score (0-100) driving invoke frequency (async, non-blocking)
- **@mention fast-track**: 3s minimum for `@agent` mentions (vs 15s standard)
- **Audience pacing**: 30s minimum for audience-only chat (no in-game players)
- **Session phases**: welcome -> warmup -> gaming -> intermission -> escalation -> finale
- **Agent auto-pauses** when 0 active humans connected
- **Player welcome system**: detects joins, queues `pendingWelcomes`, greets by name
- **Pacing rules**: Max 3 world-changing actions per invocation
- **Auto-start fallback**: 45s timer; if agent doesn't start a game, random template auto-starts
- **Variety enforcement**: hard bans on last game type + last 3 templates
- **State tracking**: `lastProcessedChatId`, `welcomedPlayers`, `processedBribeIds`
- Model: Claude (Anthropic) via OpenClaw

## Game Types

| Type | Description | Win Condition | Min Players |
|------|-------------|---------------|-------------|
| `reach` | Race to a goal trigger | First to reach goal | 1 |
| `collect` | Gather collectibles | Most collected at timeout | 1 |
| `survival` | Stay alive longest | Last standing or longest alive | 1 |
| `king` | Control hill zones | First to 30 or highest at timeout | 2 |
| `hot_potato` | Pass curse before sub-timer | Last standing after elimination | 2 |
| `race` | Hit checkpoints in order | First to complete all checkpoints | 1 |

## Game Flow

- **Atomic start**: `start_game({ template })` loads arena + starts game in one call
- **45s auto-start**: random template if agent doesn't start a game
- **Countdown**: "GET READY!" -> teleport to start -> 3s countdown (invulnerable)
- **Safe phases**: lobby, countdown, ended — no deaths, lava/none floors become solid
- **Random obstacles**: sweepers, moving walls, pendulums, falling blocks each game
- **Mid-game spectator**: late joiners watch until next round
- **Game end**: result -> 3s display -> 15s cooldown -> lobby
- **Compose system**: agent's only spawning tool — prefabs resolve instantly, custom recipes cached to `data/compose-cache.json`
- **16 arena templates** with per-template randomization (positions, speeds, delays)

## Key Files to Read

When starting a session:
1. `docs/ARCHITECTURE.md` — Full system architecture
2. `src/server/index.js` — Server bootstrap and route mounting
3. `src/server/WorldState.js` — Facade over 8 state managers
4. `src/server/routes/` — HTTP API by domain (world, game, agent, etc.)
5. `src/client/main.js` — Client orchestrator, module imports
6. `CHANGELOG.md` — Recent changes

## Debug & Testing

- **Debug panel**: `?debug=true` for runtime controls
- **Spectator mode**: `?spectator=true` for free camera
- **Agent status**: `curl localhost:3000/api/agent/status`
- **World state**: `curl localhost:3000/api/world`
- **Agent context**: `curl localhost:3000/api/agent/context`

## Links

- [Production](https://chaos.waweapps.win)
- [GitHub](https://github.com/SotoAlt/self-building-game)
- [Architecture](docs/ARCHITECTURE.md)
- [Three.js Docs](https://threejs.org/docs/)
- [Colyseus Docs](https://docs.colyseus.io)
