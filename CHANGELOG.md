# Changelog

All notable changes to the Self-Building Game project.

## [0.48.0] - 2026-02-18

### Changed
- **Architecture: Chunk 6 — WorldState Decomposition** — zero consumer changes, facade preserves identical API
  - `src/server/managers/EntityManager.js` (NEW, 266 lines) — entities, breakable platforms, kinematic/chase updates, groups
  - `src/server/managers/PlayerManager.js` (NEW, 116 lines) — players, AFK detection, spectator activation
  - `src/server/managers/GameStateMachine.js` (NEW, 174 lines) — phase lifecycle, timers, game history, variety tracking
  - `src/server/managers/EnvironmentManager.js` (NEW, 150 lines) — physics, floor, environment, hazard plane, respawn
  - `src/server/managers/SpellManager.js` (NEW, 60 lines) — spell casting, cooldowns, active effects
  - `src/server/managers/ChatManager.js` (NEW, 68 lines) — messages, announcements, events
  - `src/server/managers/LeaderboardManager.js` (NEW, 54 lines) — scores, DB sync
  - `src/server/managers/ChallengeManager.js` (NEW, 65 lines) — challenges, statistics
  - `src/server/managers/index.js` (NEW) — barrel re-export
  - `src/server/WorldState.js` — rewritten as facade: 1,058 → 280 lines (73% reduction), delegates to 8 managers via callbacks

## [0.46.0] - 2026-02-18

### Changed
- **Architecture: Chunk 5 — Server Route Extraction** — zero API changes, pure extraction
  - `src/server/services/gameService.js` (NEW) — template loading, game start, auto-start, guard helpers
  - `src/server/services/arenaService.js` (NEW) — arena callbacks, AI players, auto-bribe execution
  - `src/server/routes/authRoutes.js` (NEW) — 3 auth endpoints (privy, guest, me)
  - `src/server/routes/arenaRoutes.js` (NEW) — 6 arena CRUD endpoints
  - `src/server/routes/worldRoutes.js` (NEW) — 16 world/physics endpoints
  - `src/server/routes/gameRoutes.js` (NEW) — 17 game lifecycle, chat, leaderboard endpoints
  - `src/server/routes/bribeRoutes.js` (NEW) — 12 bribe, spell, transaction endpoints
  - `src/server/routes/agentRoutes.js` (NEW) — 15 agent, AI, SSE, webhook endpoints
  - `src/server/routes/publicRoutes.js` (NEW) — 10 public API + agent-player endpoints
  - `src/server/routes/index.js` (NEW) — barrel re-export
  - `src/server/index.js` — removed ~1,455 lines of extracted code (1,768 → 313 lines)

## [0.44.0] - 2026-02-18

### Changed
- **Architecture: Chunk 4 — Client Network & UI Extraction** — zero behavioral changes, pure extraction
  - `src/client/network/NetworkManager.js` (NEW) — safe message sending, exponential backoff reconnection
  - `src/client/network/MessageHandlers.js` (NEW) — all 33 WebSocket message handlers + onLeave/onError
  - `src/client/network/HttpApi.js` (NEW) — world state fetching, backup polling
  - `src/client/scene/FloorManager.js` (NEW) — lava floor, hazard plane, floor type switching, environment
  - `src/client/ui/Announcements.js` (NEW) — toasts, connection warning, announcements, spell effects
  - `src/client/ui/AfkOverlay.js` (NEW) — AFK warning, countdown, kicked screen
  - `src/client/ui/ChatSystem.js` (NEW) — chat input, send, display, agent thinking indicator
  - `src/client/ui/GameStatusHUD.js` (NEW) — game phase/timer/player count display
  - `src/client/ui/Leaderboard.js` (NEW) — leaderboard fetching and rendering
  - `src/client/ui/ArenaLobby.js` (NEW) — arena selection lobby
  - `src/client/ui/AuthFlow.js` (NEW) — Privy auth, guest/twitter login
  - `src/client/ui/BribePanel.js` (NEW) — bribe modal and transaction signing
  - `src/client/ui/ProfilePanel.js` (NEW) — profile button, wallet panel
  - `src/client/ui/SpectatorOverlay.js` (NEW) — drama meter, kill feed
  - `src/client/ui/DebugPanel.js` (NEW) — AI/agent toggles, status polling
  - `src/client/main.js` — removed ~1,830 lines of extracted code (2,109 → 293 lines)
  - Removed redundant 100ms position send interval (PhysicsEngine already sends at 50ms)

## [0.42.0] - 2026-02-18

### Changed
- **Architecture: Chunk 3 — Client Entity & Physics System** — zero behavioral changes, pure extraction
  - `src/client/entities/EntityFactory.js` (NEW) — pure factory functions: `createBeveledBox()`, `getGeometry()`, `createEntityMesh()`
  - `src/client/entities/EntityManager.js` (NEW) — entity lifecycle, group assembly, per-frame entity/group animations
  - `src/client/physics/PhysicsEngine.js` (NEW) — player physics, AABB collision, death/respawn, triggers, pre-allocated Vector3s
  - `src/client/rendering/RemotePlayers.js` (NEW) — remote player meshes, name sprites, chat bubbles, interpolation
  - `src/client/main.js` — removed ~950 lines of extracted code, added module init calls

## [0.41.0] - 2026-02-18

### Changed
- **Architecture: Chunk 1 Foundation** — zero behavioral changes, pure extraction
  - `src/server/constants.js` (NEW) — extracted 65 lines of magic numbers, templates, BRIBE_OPTIONS from index.js
  - `src/server/validation.js` (NEW) — input validation for WebSocket messages (position, velocity, entityId)
  - `src/server/GameRoom.js` — validates all 6 data-bearing WS handlers (move, died, collect, challenge_complete, trigger_activated, platform_step)
  - `src/server/AgentBridge.js` — `exec()` → `execFile()` to eliminate shell injection risk
  - `src/server/WorldState.js` — MAX_ENTITIES=500 guard, static VALID_ENTITY_TYPES/VALID_GAME_TYPES
  - `src/client/styles/game.css` (NEW) — 1,550 lines extracted from index.html inline style block
  - `src/client/styles/mobile.css` (NEW) — 107 lines extracted from main.js dynamic style injection
  - `index.html` — removed 1,552-line `<style>` block (now 298 lines)
  - `src/client/main.js` — CSS imports replace dynamic injection (-112 lines)

## [0.40.0] - 2026-02-12

### Fixed
- **Spectator mode broken** — `?spectator=true` let spectators move, die, collect items, and trigger goals because `type: 'spectator'` was never sent to server (token was null, so joinOptions.type was skipped)
  - Client now sends `type` in joinOptions regardless of token presence
  - Server `GameRoom.onJoin()` recognizes `type: 'spectator'`, sets permanent `spectating` state
  - `_isSpectator()` helper guards 6 gameplay handlers: `move`, `died`, `respawn`, `collect`, `trigger_activated`, `platform_step`
  - Chat and AFK heartbeat intentionally allowed for spectators
  - Spectators excluded from `getActiveHumanCount()` — agent won't count them as active players
  - `activateSpectators()` skips URL spectators — they stay spectating permanently across rounds
  - Join announcement suppressed for spectators
  - "SPECTATING" badge overlay shown at top of screen
- **Wallet unavailable after auto-login** — Privy init block was placed after the cached-token fast path, so returning users got `bridge = null` and all wallet functions returned null
  - Moved Privy init to before the fast path — fires non-blocking in background while auto-login returns instantly
  - Added `privyReady` promise in auth.js, resolved on all `initPrivy()` exit paths (success, failure, no appId)
  - `getEmbeddedWalletProvider()` and `getEmbeddedWalletAddress()` now await Privy readiness (up to 12s timeout) before checking bridge

## [0.39.0] - 2026-02-12

### Changed
- **Lazy-loaded Privy auth** — PrivyBridge.jsx and all Privy/wallet dependencies (`@privy-io`, `viem`, `@walletconnect`, `wagmi`, `react`, `react-dom`) loaded via dynamic `import()` instead of static import
  - Guest users never download Privy chunk at all
  - Twitter login button shows "Loading Twitter..." spinner until Privy ready, then enables; 10s timeout shows "Twitter Unavailable"
  - `buffer` polyfill moved into lazy load path
- **Loading splash screen** — two-phase login screen: instant HTML splash with spinner (visible before JS loads), then login buttons appear once JS is ready
- **Auto-login for returning users** — cached token validated via `/api/me` on load; valid sessions skip login screen entirely (splash -> arena lobby)
- **Background Privy initialization** — `initPrivy()` runs non-blocking; login buttons shown immediately while Privy loads in background
- **OAuth callback progress** — returning from Twitter shows "Connecting to Twitter..." -> "Authenticating..." -> "Logging in..." on splash instead of stuck "Loading..."
- **Vendor bundle splitting** — Privy deps auto-split into lazy chunks via dynamic import boundary (was forced manual chunk causing circular dependency crash)

### Fixed
- **Circular chunk crash** — `ReferenceError: Cannot access 'Mw' before initialization` caused by forcing Privy deps into a manual `vendor-privy` chunk that created circular dependency with `vendor`; fixed by letting Rollup handle splitting naturally via dynamic import

## [0.38.0] - 2026-02-11

### Added
- **Multi-arena platform** — external AI agents can create and host their own arenas
  - `ArenaManager.js` — central registry (create, get, list, destroy; max 20 arenas)
  - `ArenaInstance.js` — per-arena state bundle (WorldState, MiniGame, SSE, webhooks, timers, rate limits, AI/agent players)
  - `arenaMiddleware.js` — resolves `arenaId` from URL, injects `req.arena`; `requireArenaKey` guards write endpoints
  - 75 game endpoints extracted to `express.Router`, mounted at `/api` (default chaos) and `/api/arenas/:arenaId` (specific arena)
  - Colyseus multi-room via `filterBy(['arenaId'])` — players routed to correct room by arena
  - Game tick loop iterates all active arenas (kinematic, chase, breaking, hazard, minigame, AI, AFK per arena)
- **Arena CRUD API**
  - `POST /api/arenas` — create arena (returns `arenaId` + `apiKey`)
  - `GET /api/arenas` — list all arenas with public info
  - `PATCH /api/arenas/:id` — update arena config
  - `DELETE /api/arenas/:id` — destroy arena
- **API key authentication** — `X-Arena-API-Key` header required for non-default arena write endpoints; chaos arena exempt for backward compatibility
- **Arena lobby UI** — players choose arena after login; chaos arena pinned first with FEATURED badge; auto-refresh every 5s; skip with `?arena=chaos`
- **Self-documenting API** — `GET /skill.md` serves `docs/ARENA-HOST-SKILL.md` for agent discovery (Agent Wars pattern)
- **`agent-runner-host.js`** — reference implementation for external arena agents using direct Anthropic API (no OpenClaw dependency)
- **AFK protection** — prevents idle players from wasting agent API tokens
  - Activity tracking: movement (>5 units from anchor), chat, respawn, collect, trigger activation
  - Warning phase: after 120s idle → `afk_warning` WebSocket message with challenge token
  - Client overlay: full-screen "ARE YOU STILL THERE?" with countdown and "I'm here!" button
  - Kick phase: no heartbeat within 15s → connection closed (code 4000), "DISCONNECTED" screen with rejoin
  - `activeHumanCount` excludes AFK-warned players — agent stops invoking when 0 active humans
- **`ARENA-HOST-SKILL.md`** — comprehensive external agent guide (quick start, authentication, endpoints, game types, templates)

### Changed
- **Server architecture** — all endpoints parameterized by arena (WorldState, MiniGame, SSE, webhooks all per-arena)
- **GameRoom** — looks up arena via `ArenaManager`, delegates state to `this.arena`; added `afk_heartbeat` message handler
- **agent-runner.js** — uses `activeHumanCount` from server context (with fallback); displays `afkCount` in prompt
- **Client** — `getApiBase()` returns `/api` for chaos or `/api/arenas/:arenaId` for other arenas
- **Dockerfile** — `COPY docs ./docs` for `/skill.md` endpoint; `.dockerignore` simplified

## [0.36.0] - 2026-02-10

### Removed
- **Ready system** — removed entirely (was broken and overlapped bribe button). Deleted: `#ready-indicator` CSS/HTML, R key handler, mobile ready button, `setPlayerReady()`/`getReadyCount()`/`getHumanReadyCount()` methods, `ready` field from player state, `readyCount` from agent context, `/api/agent-player/ready` endpoint, `player_ready` WebSocket handler

### Fixed
- **Announcement/game-status overlap** — "TIME UP!" announcement at `top: 60px` overlapped "ENDED" game-status at `top: 20px`; moved `#announcements` to `top: 120px` (mobile: 100px, landscape: 70px)
- **Platform visibility** — dark platforms were invisible against dark backgrounds; increased surface emissive intensity 0.2 → 0.35, ground emissive 0.08 → 0.15, widened luminance nudge range 0.12 → 0.18, brightened grid helper

## [0.34.0] - 2026-02-10

### Added
- **Chase group rendering** — chase entities (spider, shark, ghost, ufo, dragon) now visually move on the client; previously meshes stayed at spawn position while only server-side collisions worked
- **Entity facing direction** — chasing and patrolling entities rotate to face their movement direction via `_facing` yaw computed server-side, smoothly interpolated client-side with `shortAngleDist()`
- **Bob animation** — floating entities (ghost, ufo, fish) bob up and down with sine wave animation (0.4u amplitude, ~3.1s period)
- **`isFloating` property** — propagated through `applyBehavior()` to all children in a group; added to ghost, ufo, fish prefab `defaultProperties`
- **Chase speed auto-scaling** — Composer validates creature bounding size and auto-assigns speed: tiny (4), small (2.5), player-sized (1.5), giant (1)
- **Behavior-category coherence** — Composer silently downgrades `decoration` + `chase`/`patrol` to `static`
- **Bounding box warning** — Composer logs warning when recipe exceeds 20-unit radius
- **Default chaseRadius** — chase recipes without explicit `chaseRadius` get 20 automatically
- **`bobSpeed` and `bobHeight` property ranges** — validated in Composer (0.5-5 and 0.1-2 respectively)
- **Size guide in agent prompts** — size categories (Tiny/Small/Player/Large/Giant) and behavior rules added to agent-runner, SOUL.md, SKILL.md

### Fixed
- **Chase groups invisible** — `assembleGroup()` and `updateEntity()` only handled `kinematic` groups, not `chase` — chase entities now included in group target position logic
- **Transparent entity clipping** — `depthWrite: false` on transparent materials prevents z-buffer artifacts
- **Emissive glow too dim** — emissive intensity increased 0.5 → 0.7 for eyes, flames, crystals

### Changed
- **`isFloating` pass-through** — Composer validates `isFloating` at both recipe and child-prop level
- **Composer `computeMaxExtent()` + `chaseSpeedForSize()`** — extracted as helper functions from validateRecipe

## [0.32.0] - 2026-02-09

### Added
- **3 new game types** — 6 total (was 3):
  - **King of the Hill** (`king`) — control hill zones to earn 1 point/sec; contested hills award nothing; first to target score or highest at timeout wins
  - **Hot Potato** (`hot_potato`) — curse transfers on proximity (< 3 units); cursed player eliminated when sub-timer expires; multi-round, last standing wins
  - **Race** (`race`) — ordered checkpoint triggers; must hit in sequence; first to complete all wins, or most checkpoints at timeout
- **3 new game class files**: `src/server/games/KingOfHill.js`, `HotPotato.js`, `Race.js`
- **8 new arena templates** (16 total):
  - `king_plateau` (king) — central elevated hill + 2 corner hills, ramps, obstacles
  - `king_islands` (king) — 3 floating islands with hills, narrow bridges, wind zones
  - `hot_potato_arena` (hot_potato) — circular enclosed arena with pillars and obstacles
  - `hot_potato_platforms` (hot_potato) — floating platforms over abyss, ice sections
  - `checkpoint_dash` (race) — linear 6-checkpoint obstacle course, progressive difficulty
  - `race_circuit` (race) — circular track with 8 checkpoints, ice/conveyor/wind sections
  - `treasure_trove` (collect) — multi-level enclosed arena with ledges and ice bridges
  - `ice_rink` (survival) — large ice platform with sweeping obstacles and wind zones
- **Per-template randomization** — `randomizeTemplate()` nudges positions ±2 units, varies speeds ±30%, randomizes breakable delays and hazard speeds
- **Game history tracking** — `worldState.gameHistory[]` stores last 8 `{ type, template }` entries
- **Agent variety enforcement** — hard directives ban last game type + last 3 templates; strongly promote unplayed new types (king, hot_potato, race) with "YOU MUST USE" directive
- **Lobby countdown on first join** — `worldState.onPlayerJoin` hook triggers `scheduleAutoStart()` when first human joins during lobby
- **Client HUD**: score overlay (king), curse timer (hot_potato), checkpoint display (race)
- **GameRoom trigger dispatch** — `onTriggerActivated(playerId, entityId)` passes entityId for checkpoint tracking
- **GameRoom death dispatch** — `onPlayerDeath(playerId)` notifies active game (used by hot_potato)

### Fixed
- **Bribe crash** — `executeAutoBribe` `random_spell` case wrapped `castSpell()` in try/catch; unhandled cooldown error no longer kills process
- **Agent spawning cubes instead of prefabs** — blocked `POST /api/world/spawn` and `POST /api/world/spawn-prefab` endpoints with 400 redirecting to compose
- **Lobby countdown not starting** — `scheduleAutoStart()` was only called on phase transition, not on first player join
- **Same games repeating** — variety system now bans reach on fresh start, prefers unplayed new game types for auto-start

### Changed
- **Auto-start template selection** — prefers templates for unplayed new game types; falls back to old types only after new ones played
- **`spawn_entity` and `spawn_prefab` gutted in OpenClaw skill** — return deprecation errors pointing to compose
- **`start_game` valid types** — expanded from 3 to 6 in skill file validation
- **Agent context** — includes `gameHistory`, `suggestedTemplates` fields

## [0.30.0] - 2026-02-09

### Added
- **Bribe transaction security** — server-side sender verification, 5-minute tx age check, DB-persisted replay protection (survives restarts)
- **Transactions table** (`src/server/db.js`) — `saveTransaction`, `getTransactionsByUser`, `findTransactionByTxHash`, `updateTransactionStatus`, `loadVerifiedTxHashes` with in-memory fallback
- **`GET /api/transactions`** — authenticated endpoint returns paginated transaction history per user
- **Session-to-user mapping** — `userId` stored on player records, bribe endpoint derives `playerId` from JWT (no longer client-supplied)
- **`requireAuth` on bribe endpoint** — unauthenticated requests return 401
- **Export Private Key button** — calls Privy's `useExportWallet` modal (hidden for guests)
- **Tabbed wallet panel** — Overview (address + balance), History (transaction list with status badges), Fund (wallet address + instructions)
- **Transaction history UI** — scrollable list with bribe type, relative date, MON amount, status badge (pending/honored/rejected), and Monadscan tx hash links

### Changed
- **Wallet panel width** — 280px → 360px to accommodate tabs and history
- **All amounts display as MON** — removed mock token system entirely; bribes always require real on-chain transactions
- **Bribe endpoint** — always requires `txHash`, removed mock balance check path
- **Honor endpoint** — updates transaction status to `'honored'` in DB

### Removed
- **Mock token faucet** — removed "Get Test Tokens" button, faucet CSS, and `bribeIsRealChain` client toggle
- **`playerId` in bribe request body** — server derives it from JWT auth token

## [0.28.0] - 2026-02-09

### Added
- **Player rotation** — capsule smoothly rotates to face movement direction using `atan2` + shortest-path lerp (~66ms to face new direction)
- **Remote player rotation** — other players' capsules rotate based on position delta interpolation
- **Hemisphere light** — natural sky/ground color fill (`HemisphereLight 0xb0d0ff/0x404030`)
- **ACES tone mapping** — `ACESFilmicToneMapping` at 1.3 exposure for perceived brightness and contrast
- **`shortAngleDist()` helper** — shared angle-wrapping utility for rotation code

### Changed
- **Scene brightness overhaul** — ambient light `0x404040→0x8090a0` (intensity 0.5→0.8), directional 1→1.2, background/fog `0x1a1a2e→0x2a2a4e`
- **Sky dome defaults** — top `0x0d1b2a→0x1a3050`, bottom `0x1a1a2e→0x2a3a5e` (dark blue instead of near-black)
- **Toon material emissive** — default self-illumination 0.05→0.12, emissive entities 0.4→0.5
- **Ground material** — lighter color `0x2d3436→0x3d4446` with 0.08 emissive self-illumination
- **Outline visibility** — edge color `#000000→#1a1a1a` (dark gray), glow 0→0.2, strength 3→4, thickness 1.5→1.0
- **Outline update interval** — 500ms→200ms for snappier outline tracking
- **deploy.sh** — prune Docker builder cache before build to prevent disk exhaustion

## [0.26.0] - 2026-02-09

### Added
- **Ice surfaces** — `isIce: true` on platforms reduces ground decel to ~8%, accel to ~15%
- **Conveyor belts** — `isConveyor: true` + `conveyorDir` + `conveyorSpeed` pushes players directionally
- **Wind zones** — `isWind: true` + `windForce: [x,y,z]` on trigger entities applies force while inside AABB
- **Rising hazard plane** — server-authoritative lava/water plane that rises during `playing` phase
- **New prefabs** — `conveyor_belt`, `wind_zone`
- **New arena templates** — `slime_climb` (vertical + rising lava), `wind_tunnel` (horizontal + wind zones)
- **Frame-rate independent mechanics** — `frameDelta` pattern for conveyor/wind forces

## [0.24.0] - 2026-02-09

### Added
- **Compose system** (`src/server/Composer.js`) — agent-generated recipes with validation, disk caching (`data/compose-cache.json`), and Docker volume persistence
  - Known prefabs resolve by description (no recipe needed)
  - Custom creations: agent provides a recipe → validated → cached → spawned as grouped entities
  - Cache hits: same description without recipe → instant spawn from cache
  - `POST /api/world/compose` — single endpoint replaces `spawn-prefab` for all spawning
- **Advanced 3D composition** — per-child rotation, material controls, 16 geometry templates, group merging
  - **Per-child rotation**: `rotation: [rx, ry, rz]` (radians) — angled wings, tilted parts, upside-down objects
  - **Material properties**: `roughness`, `metalness`, `opacity`, `emissive` per child — metallic surfaces, transparency, glow
  - **16 geometry templates** (`src/client/GeometryTemplates.js`):
    - Lathe-based: column, vase, teardrop, mushroom_cap, horn, flask, bell, dome
    - Extrude-based: wing, star, heart, arrow, cross
    - Tube-based: tentacle, arch, s_curve
  - **Client group merging**: composed entities wrapped in `THREE.Group` for unified movement and animation
  - **MAX_CHILDREN raised**: 6 → 12 children per compose recipe
- **Compose-only enforcement** — agent prompt, SOUL.md, and SKILL.md updated to route all spawning through compose; `spawn_entity` and `spawn_prefab` deprecated

### Changed
- **Agent prompt** (`agent-runner.js`): compose is the only advertised spawning tool; includes dragon recipe example with rotation + organic shapes
- **SOUL.md**: compose palette with recipe examples, shape categories, material props
- **SKILL.md**: version 0.24.1, `spawn_entity` and `spawn_prefab` marked deprecated
- **Prefabs.js**: extracted shared `applyBehavior()` and `spawnGroup()` functions; upgraded spider, shark, flag, cactus prefabs with rotation + materials
- **Agent-runner banner**: v0.20 → v0.22

## [0.20.0] - 2026-02-06

### Added
- **Prefab system** (`src/server/Prefabs.js`) — 12 named entity presets that bundle multiple child entities with behaviors into a single spawn call
  - **Hazards**: `spider` (patrolling), `spinning_blade` (fast rotate), `swinging_axe` (pendulum), `crusher` (vertical slam), `rolling_boulder` (linear patrol)
  - **Utility**: `bounce_pad` (launches players upward), `checkpoint` (respawn flag), `speed_strip` (temporary 2x speed boost)
  - **Decoration**: `torch` (emissive flame), `crystal` (rotating glow), `barrel`, `flag`
- **Breakable platforms** — server-authoritative break/regen cycle: client sends `platform_step` → server broadcasts `platform_cracking` → entity destroyed after `breakDelay` ms → optional regen via `regenDelay`
- **Bounce pad trigger** — upward launch with force, particles, and ascending sound
- **Speed strip trigger** — temporary 2x speed boost with duration
- **`hex_a_gone` arena template** — 3-layer hex-staggered grid (111 breakable platforms), survival mode, dark purple environment
- **API endpoints**: `POST /api/world/spawn-prefab`, `POST /api/world/destroy-group`
- **Agent tools**: `spawn_prefab` (12 prefab names + properties), `destroy_prefab` (by groupId)
- **Agent context**: `availablePrefabs` field in `/api/agent/context`, `groupId` on entity data
- **Client sounds**: `playCrackSound()`, `playBreakSound()`, `playBounceSound()`
- **Client crack animation**: shake + fade for breakable platforms before destruction + break particles on destroy

### Changed
- **SOUL.md creative palette** — now includes prefab names and hex_a_gone template
- **Agent prompt** — prefab and template list in creative palette reminder
- **Auto-start template list** — `hex_a_gone` added to random rotation
- **WorldState.clearEntities()** — also clears `breakingPlatforms` map

## [0.18.0] - 2026-02-06

### Added
- **Atomic `start_game` with `template` param** — single API call loads arena + starts game (no more separate load_template → start_game)
- **45s auto-start fallback** — if agent doesn't start a game within 45s of lobby, a random template auto-starts
- **Countdown invulnerability** — `inSafePhase` covers countdown and ended phases; players can't die during transitions
- **Safe-phase floor override** — lava and `none` floors become solid during lobby/countdown/ended so players don't die between games
- **Obstacle collision safety** — obstacles only kill during `playing` phase
- **Spectator camera mouse control** — spectators use click-drag to orbit camera (no auto-rotation)
- **`applyTemplate()` shared helper** — extracted from template load and game start endpoints
- **`clearSpectating()` helper** — extracted spectator cleanup logic

### Changed
- **`load_template` blocked during lobby** — returns error directing agent to use `start_game({ template })` instead (deprecated)
- **`BUILD_GAP_MS` removed** — no longer needed since template + game start are atomic
- **`isSpectating` auto-clear** — spectator state cleared on lobby transition so spectators rejoin as active players
- **Announcement duration cap** — announcements capped at 4s (was 5s)
- **Max 3 visible announcements** — oldest removed when limit exceeded
- **Spell phase guard** — `POST /api/spell/cast` blocked outside `playing` phase
- **Agent chat rate limit** — 3s cooldown on `POST /api/chat/send`
- **Announcement rate limit** — 5s cooldown on `POST /api/announce`
- **`end_game` pre-flight check** — agent tool rejects if no active game (prevents "Game ended: cancelled" during lobby)

## [0.16.0] - 2026-02-06

### Added
- **Spell cooldown** (10s): `WorldState.castSpell()` enforces 10s between casts — agent can no longer rapid-fire 5 spells in one invocation
- **Build-to-game gap** (10s): `/api/game/start` rejects if a template was loaded <10s ago — forces agent to hype the arena before starting
- **Cooldown visibility**: `/api/agent/context` exposes `spellCooldownUntil` and `buildGapUntil` so the agent sees active cooldowns
- **Audience message handling**: Bridge messages (Twitch/Discord/Telegram) tracked as `audience` senderType with separate priority from in-game @mentions
- **Audience-only pacing**: 30s minimum invoke interval when only audience is chatting (no in-game players)

### Changed
- **SOUL.md pacing rules**: Max 3 world-changing actions per invocation, rhythm guide (greet → build → start across turns), cooldown narration
- **Agent prompt pacing**: `buildPrompt()` includes explicit pacing reminder + active cooldown timers
- **Tool JSDoc updates**: `cast_spell` (10s cooldown warning), `start_game` (build gap warning), `load_template` (wait-to-start warning)
- **Cooldown rendering**: Consolidated three if-blocks into data-driven loop in agent-runner
- **Spell cooldown constant**: Extracted `WorldState.SPELL_COOLDOWN` static, referenced from index.js (single source of truth)
- **Build gap constant**: `BUILD_GAP_MS` module-level constant in index.js
- **Agent-runner banner**: v0.15 → v0.16

## [0.15.0] - 2026-02-06

### Added
- **Chat bridge** (`chat-bridge.js`): Connects Twitch, Discord, and Telegram chats to the game
  - External messages appear in game chat as `[twitch] username`, `[discord] username`, etc.
  - Agent responses relayed back to all connected platforms via SSE stream
  - Config-driven: enable platforms via env vars, run multiple simultaneously
  - `POST /api/chat/bridge` endpoint for external platform messages
- **Async agent invocation**: `agent-runner.js` uses `execFile` instead of `execSync`
  - Tick loop keeps running while OpenClaw processes (no more blocking)
  - Faster @mention detection: polls every 2s, invokes within 3s of mention
- **Chat bridge systemd service**: `chat-bridge.service` for production deployment

### Changed
- **Tick interval**: 5s → 2s (just HTTP polling, very lightweight)
- **@mention minimum**: 5s → 3s for faster response to player requests
- **Agent-runner banner**: v0.14 → v0.15

## [0.14.0] - 2026-02-06

### Added
- **Entity shapes**: `properties.shape` supports 8 geometries — box (default), sphere, cylinder, cone, pyramid, torus, dodecahedron, ring
- **Decoration entity type**: No collision, purely visual. Use for trees, crystals, signs, etc.
- **`getGeometry()` client function**: Renders all shape types with proper Three.js geometries

### Changed
- **SOUL.md personality rewrite**: Chaos Magician is now a chaos magic apprentice — mischievous, energetic, not-quite-competent
  - Short messages only (1-2 sentences, not paragraphs)
  - Chaotic reinterpretation of player requests (twist, misinterpret, backfire, occasionally obey)
  - Tool honesty: narrates failures in character instead of pretending tools worked
  - Creative palette section: types, shapes, spells, floor types
- **spawn_entity error message**: Now suggests available types AND shapes when invalid type is used
- **Agent-runner prompt**: Includes creative palette reminder (types + shapes) in every invocation
- **Agent-runner banner**: v0.13 → v0.14

## [0.13.0] - 2026-02-06

### Added
- **Enriched agent context**: Leaderboard, active effects, variety hints, welcomes, deaths in agent-runner prompt
- **Faster @mention response**: 5s tick interval (was 8s), 5s minimum for `@agent` mentions (was 15s)
- **State tracking**: `lastProcessedChatId`, `welcomedPlayers` set, `processedBribeIds` — prevents re-processing old data
- **Retry logic**: `gameAPIWithRetry()` retries fetch failures once after 2s delay
- **Rate-limit feedback**: `GameRoom.js` sends `chat_error` to client, client shows "Too fast! Wait a moment." toast
- **Client disconnect guard**: `sendChatMessage()` checks `state.connected` before sending
- **Nginx keepalive**: `proxy_socket_keepalive on` + `proxy_send_timeout 86400` prevents idle disconnects

### Fixed
- **Fetch error suppression**: Suppresses "fetch failed" noise right after successful agent invoke
- **Game count double-counting**: `lastGameEndedPhase` flag prevents incrementing gamesPlayed twice on ended phase
- **agent-runner event field**: Uses `context.recentEvents` (matching API) instead of `context.events`

### Changed
- **agent-runner.js is sole agent system**: Runs on host with OpenClaw CLI access; AgentLoop.js naturally inactive in Docker

## [0.12.0] - 2026-02-06

### Fixed
- **Agent not running in production**: OpenClaw CLI was not installed inside Docker container and `OPENCLAW_SESSION_ID` env var was unset, silently preventing all agent invocations
- **Bribes had no visible feedback**: Submitting a bribe showed no client-side confirmation — only a Colyseus announcement that could be missed. Errors were silently swallowed.
- **"Nothing happens" on complex bribes**: `move_goal` and `extra_time` bribes returned `false` from `executeAutoBribe()` and queued for the agent, which wasn't running
- **Stale entity broadcast in move_goal**: Goal entity was broadcast to clients before position update was applied

### Added
- **Bribe toast notifications**: Green toast on auto-executed bribes, yellow on agent-queued, red on errors
- **Auto-execute move_goal bribe**: Repositions the goal randomly during active ReachGoal games (5/6 bribe types now work without agent)
- **Auto-execute extra_time bribe**: Extends current game timer by 15 seconds with announcement
- **Agent-runner systemd service**: `agent-runner.js` runs on VPS host (not in Docker) as `chaos-agent.service` with auto-restart
- **Deploy step 7**: `deploy.sh` now installs Node.js + OpenClaw CLI on VPS, configures OpenClaw with Anthropic API key, and starts agent-runner service

### Changed
- **Deploy script**: 6 steps -> 7 steps, preserves OpenClaw config across deploys
- **Announcement ordering**: "GET READY!" and game type announcements now fire before phase change so clients receive them first

## [0.11.0] - 2026-02-05

### Fixed
- **Invisible floor bug**: Players on `floorType: 'none'` now correctly fall through during gameplay (lobby/building still has invisible safety floor)
- **Lava invulnerability**: Invulnerable players no longer die to lava (consistent with abyss behavior)

### Changed
- **Game cooldown**: Increased from 8s to 15s between games, preventing rapid restarts
- **Agent cooldown guard**: Agent won't invoke during game cooldown period
- **Game-end display**: Timer shows "YOU WIN!" / "GAME OVER" / "TIME UP!" / "DRAW!" with colored text
- **Fall Guys-style countdown**: Players teleported to start position during countdown, can move freely (no movement lock)
- **"GET READY!" announcement** before game type name during countdown
- **"Returning to lobby..."** announcement 3s after game ends

### Added
- **Player welcome system**: Agent detects player joins, greets by name within 15-20s
  - `pendingWelcomes` tracking in AgentLoop with drama score boost (+10 per join, +15 per pending welcome)
  - "NEW PLAYERS TO WELCOME" section in agent prompt
  - Visual `"[name] has entered the arena!"` announcement on join
- **Mid-game spectator mode**: Players joining during active games become spectators
  - Banner: "Game in progress — watching until next round..."
  - Auto-activated when lobby phase returns
  - Spectators skip game initialization and physics
- **Randomized game parameters**: Every game plays differently
  - Time limits: reach 40-75s, collect 30-60s, survival 60-120s
  - ReachGoal: random goal position (x:-20..20, y:3..10, z:-10..-40)
  - CollectGame: random count (5-20) and area size (15-30)
  - Survival: random hazard interval (3-8s), max hazards (10-25), platform (20-40)
- **Random obstacles**: Fall Guys-style obstacles spawn each game
  - Sweepers (rotating), moving walls (kinematic), pendulum platforms, falling blocks
  - 2-4 in ReachGoal, 1-3 in CollectGame
- **Game variety enforcement**: Agent context includes `suggestedGameTypes` (excludes last played) and `lastGameType`
- **Agent context enrichment**: `/api/agent/context` now includes `pendingWelcomes`, `lastGameType`, `lastGameEndTime`, `suggestedGameTypes`

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
  - `POST /api/agent-player/leave` — disconnect
  - `GET /api/agent-player/:id/state` — player-scoped state view
- **Player Agent Skill** (`config/openclaw/game-player-skill.js`)
  - 7 tools: join_game, move_to, send_chat, submit_bribe, get_game_state, get_my_position, get_leaderboard
  - Session-scoped player ID management
- **Mobile Touch Controls**
  - Mobile detection via `ontouchstart` / screen width
  - Virtual joystick (left thumb area) with visual feedback ring
  - Touch-drag camera rotation (right side of screen)
  - Action buttons: Jump, Sprint (toggle)
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
- **AI bot auto-ready** — bots auto-ready when a human player readies up (removed in v0.36.0)
- **Human-only ready count** — ready display shows human players only (removed in v0.36.0)

### Changed
- `AgentBridge.js` rewritten: shells out to `openclaw agent` CLI instead of HTTP REST
- `AGENTS.md` rewritten: explicit exec+curl instructions for all game API calls
- AI bot chat cooldown increased to 60s in lobby (was 15s, caused spam)
- Ground collision checked before void death (prevents tunneling through floor)
- Docker game container now exposes port 3000 on localhost (for agent-runner access)

### Fixed
- **Death/respawn loop** — ground collision now checked before void death to prevent frame-skip tunneling
- **AI bot chat spam** — reduced chat frequency 10x and added 60s cooldown in lobby
- **AI bots never ready** — bots auto-ready when any human readies up (removed in v0.36.0)
- **Ready count showing 1/3** — now shows human-only count (removed in v0.36.0)

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
- **Player ready system** (R key toggle) (removed in v0.36.0)
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
