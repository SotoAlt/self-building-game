# Changelog

All notable changes to the Self-Building Game project.

## [0.10.0] - 2026-02-05

### Added
- **Bribe Honor System**
  - `POST /api/bribe/:id/honor` endpoint for agent to acknowledge bribes
  - `honor_bribe` tool in game-world-skill.js (27 total tools now)
  - `GET /api/bribe/honored` endpoint for recently honored bribe history
  - `getHonoredBribes()` method on ChainInterface
- **Agent Context Enrichment**
  - Pending bribes included in agent prompt with "ACT ON THESE" labeling
  - Recently honored bribes shown for reference (last 5)
  - Chat window increased from 5 to 10 messages
  - AgentLoop passes `chain` reference for bribe data
- **Webhook System**
  - `POST /api/webhooks/register` — register URL with optional event filtering
  - `DELETE /api/webhooks/:id` — unregister webhook
  - `GET /api/webhooks` — list registered webhooks
  - Fire-and-forget POST to registered URLs on SSE events (5s timeout)
- **Public Game API** (read-only, no auth required)
  - `GET /api/public/state` — sanitized game state (no internal IDs)
  - `GET /api/public/leaderboard` — top players
  - `GET /api/public/events?since=<timestamp>` — recent events (polling alternative to SSE)
  - `GET /api/public/stats` — session statistics (games, deaths, bribes, spells, invocations)
- **Agent-as-Player API** — external AI agents can play the game
  - `POST /api/agent-player/join` — register as player
  - `POST /api/agent-player/move` — submit movement
  - `POST /api/agent-player/chat` — send chat message
  - `POST /api/agent-player/ready` — toggle ready state
  - `POST /api/agent-player/leave` — disconnect
  - `GET /api/agent-player/:id/state` — player-scoped state view
- **Player Agent Skill** (`config/openclaw/game-player-skill.js`)
  - 8 tools: join_game, move_to, send_chat, submit_bribe, get_game_state, get_my_position, get_leaderboard, ready_up
  - Session-scoped player ID management
- **Mobile Touch Controls**
  - Mobile detection via `ontouchstart` / screen width
  - Virtual joystick (left thumb area) with visual feedback ring
  - Touch-drag camera rotation (right side of screen)
  - Action buttons: Jump, Sprint (toggle), Ready
  - Pointer lock skipped on mobile
- **Responsive UI**
  - CSS media queries for screens < 768px
  - Scaled chat panel, leaderboard, game status, announcements
  - Desktop controls hint hidden on mobile
  - Viewport meta updated (no zoom on mobile)
- **Documentation**
  - `docs/MANIFESTO.md` — hackathon pitch / philosophy document
  - `docs/CONCEPT.md` — full rewrite reflecting actual stack
  - `docs/AGENT-PLAYER-API.md` — how to connect external agents
  - `docs/ROADMAP.md` — phases 9-13 added

### Changed
- SSE event types expanded: `floor_changed`, `entity_spawned`, `entity_destroyed`
- `PHASES` constant renamed to `PHASE` with screaming-case keys
- `getDramaEmoji` renamed to `getDramaLabel`
- `requireAgentPlayer` helper extracts guard pattern for agent-player endpoints
- Public stats use single-pass event counting instead of 4 separate `.filter()` calls
- `requireJoined` guard extracts repeated null-check in player skill
- Sprint toggle on mobile directly uses `keys.shift` (no redundant variable)

## [0.9.2] - 2026-02-05

### Fixed
- **Collision hitboxes** — player and entity bounding boxes now use manual AABBs instead of `setFromObject()`, preventing decoration children (eyes, glow ring) from inflating hitboxes by 36-40%
- **Chat thinking indicator** — moved from `sendChatMessage` to `displayChatMessage` so it appears AFTER the player's message; added 30s auto-timeout
- **Trigger spam** — added 2s debounce to `triggerEvent()`, preventing ~60 server messages/sec when standing on a trigger
- **Entity memory leak** — `removeEntity()` now traverses and disposes all child geometries/materials, not just root

### Added
- Client handler for `trigger_activated` broadcast (purple particle feedback, eliminates Colyseus warning)

## [0.9.1] - 2026-02-05

### Fixed
- **Twitter Login** — click handler now awaits `loginWithTwitter()` with try/catch instead of fire-and-forget; errors shown to user via status text
- **Privy Token Exchange** — replaced `localStorage.getItem('privy:token')` (returns JSON-wrapped string) with `privy.getAccessToken()` for correct token retrieval
- **OAuth Callback Error Handling** — errors logged and re-thrown; URL params cleaned up in `finally` block

### Added
- `debugAuth()` diagnostic function exposed as `window.debugAuth()` for troubleshooting auth state

## [0.9.0] - 2026-02-05

### Added
- **Player Movement Polish**
  - Base speed increased (15 → 20) for snappier feel
  - Sprint with Shift key (speed 32, ~60% boost)
  - Higher jumps (force 12 → 16) for larger arenas
  - Spell speed values scaled proportionally
- **Character Visuals**
  - Eyes on player capsules (white spheres + dark pupils)
  - Glow ring at player base (translucent torus)
  - Increased emissive intensity (0.2 → 0.4) for better visibility
  - Remote players receive the same visual treatment
- **Environment Controls (Agent)**
  - `POST /api/world/environment` — change sky color, fog, lighting dynamically
  - `set_environment` agent tool with 9 parameters (skyColor, fogColor, fogNear, fogFar, ambientColor, ambientIntensity, sunColor, sunIntensity, sunPosition)
  - Environment included in agent context and world state responses
  - Arena templates now define themed environment overrides (e.g. gauntlet has red-tinted hellish lighting)
  - Environment resets on world clear and applies on template load
  - Late-joining clients receive current environment in init payload
- **Agent Chat Polish**
  - "Magician is thinking..." indicator appears when player sends `@agent` message
  - Auto-removed when agent reply arrives

### Changed
- Refactored WorldState defaults to static constants (`DEFAULT_PHYSICS`, `DEFAULT_ENVIRONMENT`)
- GameRoom handlers use early-return pattern consistently (reduced nesting)
- Extracted `addPlayerDecorations()` and `applyWorldState()` helpers in client
- `executeAutoBribe` uses switch statement instead of if/else chain
- Improved auth error handling with better logging and error propagation

## [0.8.1] - 2026-02-05

### Fixed
- **deploy.sh secret regeneration** — DB_PASSWORD and JWT_SECRET now persist across deploys instead of being regenerated each time (which broke PostgreSQL auth since the volume kept the old password)

### Changed
- Phase 9 blockchain target updated from Solana to **Monad EVM** — `ROADMAP.md` credits system references updated

## [0.8.0] - 2026-02-05

### Added
- **VFX & Game Feel (Phase 5)**
  - Camera shake system: death (strong), spell cast (medium), countdown (rumble)
  - Screen flash effects: red on death, golden on win, red on lose
  - Vignette overlays for spell effects (speed boost green, invert purple, low gravity blue)
  - Enhanced death particles: dual-color burst (red + orange, 50 total)
  - Golden sparkle trail on item collection
  - Countdown beeps (3, 2, 1, GO! with ascending pitch)
  - Win fanfare (C-E-G-C arpeggio)
  - Spell cast whoosh sound (filtered sawtooth sweep)
- **Floor System (Phase 6)**
  - Three floor types: `solid` (default), `none` (abyss), `lava` (kills on contact)
  - Animated lava floor with pulsing glow and subtle wave motion
  - `POST /api/world/floor` endpoint + `GET /api/world/floor`
  - `set_floor` agent tool for drama-driven floor changes
  - Arena templates define floor types: parkour_hell/floating_islands → `none`, gauntlet → `lava`
  - Floor type broadcast via WebSocket (`floor_changed` event)
  - Lava death spawns fire particles (orange + yellow burst)
- **Bribe System Polish (Phase 7)**
  - 6 predefined bribe options with token costs (30-200 tokens)
  - Auto-execute simple bribes server-side: spawn obstacles, lava floor, random spell
  - Complex bribes (move goal, extra time, custom) queued for agent
  - Bribe modal UI replacing browser prompt() — styled dropdown with costs
  - `GET /api/bribe/options` endpoint for client to fetch available bribes
- **Phase 8-9 roadmap** — Auth/DB testing steps and blockchain architecture documented

### Changed
- Ground collision logic respects floor type (abyss = no ground, lava = death at y<0)
- `WorldState.clearEntities()` resets floor type to `solid`
- `WorldState.getState()` includes `floorType` field
- Template loader sets floor type from template definition
- Bribe API now accepts `bribeType` instead of free-text `request` + `amount`

## [0.7.0] - 2026-02-05

### Added
- **Game lifecycle enforcement** — phase guards on 6 endpoints prevent invalid actions during active games
- **8-second cooldown** between games to prevent rapid-fire game starts
- **Agent auto-pause** when 0 human players connected (resumes when humans join)
- **AI player runtime toggle** — API endpoints to enable/disable AI bots without restart
  - `POST /api/ai-players/toggle` with `{ enabled: true/false }`
  - Debug panel integration for one-click toggle
- **Debug panel** at `?debug=true` — runtime controls for agent pause/resume, AI player toggle, world state inspection

### Changed
- Consistent `cooldownUntil` timestamp pattern across game lifecycle
- Extracted `checkNotInActiveGame()` helper for DRY endpoint guards
- Player type (`human`/`ai`) included in agent context for smarter decision-making
- Code simplifier pass: consistent naming, reduced duplication

## [0.6.0] - 2026-02-05

### Added
- **Live autonomous Chaos Magician agent** on production
  - OpenClaw Gateway running as systemd service (port 18789)
  - `agent-runner.js` standalone process polling game context every 8s
  - Agent uses Claude 3.5 Haiku for cost efficiency
  - Agent calls game API via exec+curl (spawn arenas, start games, cast spells, chat)
  - Drama score drives agent invoke frequency and behavior
  - Session phases: welcome → warmup → gaming → intermission → escalation → finale
- **AI bot auto-ready** — bots auto-ready when a human player readies up
- **Human-only ready count** — ready display shows human players only

### Changed
- `AgentBridge.js` rewritten: shells out to `openclaw agent` CLI instead of HTTP REST
- `AGENTS.md` rewritten: explicit exec+curl instructions for all game API calls
- AI bot chat cooldown increased to 60s in lobby (was 15s, caused spam)
- Ground collision checked before void death (prevents tunneling through floor)
- Docker game container now exposes port 3000 on localhost (for agent-runner access)

### Fixed
- **Death/respawn loop** — ground collision now checked before void death to prevent frame-skip tunneling
- **AI bot chat spam** — reduced chat frequency 10x and added 60s cooldown in lobby
- **AI bots never ready** — bots auto-ready when any human readies up
- **Ready count showing 1/3** — now shows human-only count

## [0.5.0] - 2026-02-05

### Added
- **Production deployment** to Hetzner (chaos.waweapps.win)
  - Docker Compose with nginx reverse proxy + Let's Encrypt SSL
  - WebSocket + SSE proxy support in nginx config
  - Certbot auto-renewal container
  - `deploy.sh` one-command deployment script
- **Spectator mode** (`?spectator=true`)
  - Free camera with auto-follow leading player
  - Number keys (1-9) to follow specific players
  - Drama meter, agent phase indicator, kill feed overlays
- **Bribe system** with mock blockchain interface
  - "Bribe the Magician" UI button with token balance
  - `POST /api/bribe` endpoint, bribes appear in agent context
  - `ChainInterface` abstraction (mock now, Monad EVM later)
- **Particle effects** (death burst, collect sparkles, spell vortex)
- **Procedural sound effects** (Web Audio: jump, death, collect)
- **Giant/tiny spell physics** (adjusted speed + jump for size effects)

### Fixed
- **XSS vulnerabilities** in chat, leaderboard, kill feed (innerHTML with user data)
- **Race condition** in game lifecycle (countdown timer not cancelled by endGame)
- **Collectible double-pickup** (no server-side validation)
- **Drama score** timeRemaining always undefined
- **Player count** double-counting remote players
- **Particle position** falsy zero coordinates (|| vs ??)

## [0.4.0] - 2026-02-05

### Added
- **Autonomous agent loop** (`AgentLoop.js`)
  - 5-second tick with drama score (0-100) driving invoke frequency
  - Session phase state machine: welcome → warmup → gaming → intermission → escalation → finale
  - Automatic game lifecycle: lobby → building → countdown → playing → ended → building
- **OpenClaw agent bridge** (`AgentBridge.js`)
  - Structured context + phase-specific prompts to Chaos Magician
  - POST to OpenClaw gateway for agent invocation
- **AI Players** (`AIPlayer.js`)
  - 3 personality types: Explorer (cautious), Chaos Bot (risky), Tryhard (efficient)
  - Goal-seeking movement, platform collision, obstacle death
  - Event-triggered chat messages per personality
- **Arena templates** (5 pre-built layouts)
  - spiral_tower, floating_islands, gauntlet, shrinking_arena, parkour_hell
- **SSE event feed** (`GET /api/stream/events`) for OBS overlays
- **Void death** (fall below y=-20 during active games)
- **Dynamic respawn points** (agent sets per-arena)
- **Clear world** between games (`POST /api/world/clear`)
- **Building phase** in game state machine
- 6 new agent tools: clear_world, load_template, set_respawn, get_drama_score, start_building, check_bribes

### Changed
- `broadcastToRoom()` now pushes to both WebSocket and SSE stream
- Game phases expanded: lobby → building → countdown → playing → ended
- Removed `obstacle` game type (no implementation existed)

## [0.3.0] - 2026-02-04

### Added
- **PostgreSQL persistence** with graceful in-memory fallback
  - `src/server/db.js` module with auto-schema creation
  - Users table (upsert on join)
  - Leaderboard table (persists across restarts)
  - Game history table (saved on mini-game end)
  - `GET /api/stats` endpoint (games played, total players, uptime)
- **Production deployment support**
  - Dynamic client URL detection (auto ws/wss based on protocol)
  - Static file serving from `dist/` in production mode
  - SPA catch-all for non-API routes
  - `npm start` script for production
  - Multi-stage Dockerfile (build + runtime layers)
  - `docker-compose.yml` (game server + PostgreSQL)
  - `.env.example` with environment documentation
- **README.md** rewritten for hackathon submission

### Changed
- DB writes are fire-and-forget (non-blocking gameplay)
- Leaderboard hydrated from DB on startup
- `distPath` extracted as shared constant in server
- Used nullish coalescing (`??`) instead of `||` for stats fallbacks
- Added explicit radix to `parseInt` calls

## [0.2.0] - 2026-02-04

### Added
- **Agent trick system** for mid-game events
  - Time/score/death/interval triggers
  - Built-in actions: flip_gravity, speed_burst, announce
  - Game-specific tricks for each mini-game type
  - `POST /api/game/trick` endpoint
  - `add_trick` tool in agent skill
- **Unified agent context** endpoint (`GET /api/agent/context`)
- **System messages** for player join/leave/death/respawn/ready
- **@agent mention detection** with request type classification
- **Event log system** in WorldState

### Changed
- Agent can now poll single endpoint instead of multiple

## [0.1.0] - 2026-02-04

### Added
- **Spell system** with 8 effect types
  - invert_controls, low_gravity, high_gravity, speed_boost
  - slow_motion, bouncy, giant, tiny
  - `POST /api/spell/cast` and `POST /api/spell/clear` endpoints
- **Player chat system**
  - Chat panel UI with color-coded sender types
  - @agent mention highlighting
  - Rate limiting (1 msg/sec, 200 char max)
  - `GET /api/chat/messages` and `POST /api/chat/send` endpoints
- **Mouse look camera** with pointer lock and orbit zoom
- **Camera-relative WASD movement**
- **Player ready system** (R key toggle)
- **Moving/kinematic platforms** with path waypoints
- **Wall-slide collision** (separate X/Z push-out)
- **Score & leaderboard** (top 10, wins tracking)
- **Remote player interpolation** (smooth lerp)

## [0.0.2] - 2026-02-04

### Added
- **Three.js browser client** with WASD + jump controls
- **AABB collision detection** (platforms, collectibles, obstacles, triggers)
- **Vite dev server** for hot-reload development
- **Remote player rendering** (colored capsules + name labels)
- **WebSocket reconnection** with polling backup
- **Announcement system** (agent -> players, CSS-animated overlays)
- **Game state machine**: lobby -> countdown -> playing -> ended
- **3 mini-games**: ReachGoal, CollectGame, Survival
- **Mini-game framework** with shared base class

## [0.0.1] - 2026-02-03

### Added
- Initial project setup
- Three.js + Colyseus game server on port 3000
- Express HTTP API for agent control (13 endpoints)
- Colyseus WebSocket room for real-time multiplayer
- World state management (entities, players, physics, challenges)
- 5 entity types: platform, ramp, collectible, obstacle, trigger
- OpenClaw game-world skill with agent tools
- Chaos Magician persona (SOUL.md)
