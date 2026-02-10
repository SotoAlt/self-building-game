# Multi-Arena Platform — Design Document

> **Status**: Reference design — to be revisited after major game mechanic updates
> **Created**: Feb 7, 2026
> **Scope**: Transform single-arena game into Roblox-like multi-tenant platform

---

## Context

The self-building game is currently a **single-arena, single-agent system**: one WorldState, one Colyseus room, one AI game master (Chaos Magician), one SSE stream. All 50+ HTTP endpoints reference global singletons. This works for our hackathon demo but limits the platform to one game experience.

**The goal**: Transform the platform into a **Roblox-like arena marketplace** where external AI agents (OpenClaw, Claude, any LLM) can create persistent arenas, act as game masters, and host their own game experiences. Players browse a lobby, pick an arena, and play. Community upvotes surface the best arenas.

**Why now**: This is the core differentiator — not just one AI game master, but an **open platform for AI game masters**. Any agent that can make HTTP calls can host a game.

---

## Current Architecture (What Exists)

### Global Singletons in `src/server/index.js`
```
const worldState = new WorldState();    // line 44 — ONE instance
let gameRoom = null;                     // line 47 — ONE Colyseus room
let currentMiniGame = null;              // line 116 — ONE active game
let agentLoop = new AgentLoop(...)       // line ~1046 — ONE agent loop
const sseClients = new Set();            // ONE SSE stream
let autoStartTimer, lastAnnouncementTime, lastAgentChatTime...  // all global
```

### Key Constraints
- **50+ HTTP endpoints** all reference these globals directly
- **Colyseus** registers one room type `'game'` — all players join the same room
- **agent-runner.js** polls `/api/agent/context` with no room/arena scoping
- **SSE stream** broadcasts to all connected clients regardless of context
- **WorldState** is already a class (can instantiate multiple) — this is good
- **GameRoom** receives `worldState` via injection — already somewhat decoupled

---

## Target Architecture

### Core Concept: ArenaManager + Middleware Injection

Instead of duplicating 50+ route handlers, we use a **middleware pattern**:

1. **ArenaManager** — central registry holding all live arena instances
2. **ArenaInstance** — bundles all per-arena state (WorldState, game loop, SSE clients, cooldowns)
3. **arenaMiddleware** — resolves `arenaId` from request path/header, injects `req.arena`
4. **Express Router** — all game endpoints extracted into a shared router, mounted at both `/api/...` (default) and `/api/arenas/:arenaId/...` (per-arena)

### Arena Instance (what each arena owns)

Each arena gets its own isolated copy of everything currently global:

| State | Currently | Per-Arena |
|-------|-----------|-----------|
| WorldState (entities, physics, environment, floor, respawn) | Global singleton | Own instance |
| Colyseus Room | Single `gameRoom` | Own room (via `filterBy`) |
| MiniGame | Single `currentMiniGame` | Own game lifecycle |
| SSE Clients | Global `sseClients` Set | Own subscriber set |
| Cooldowns (announcement, chat, spell) | Global timestamps | Own timestamps |
| Auto-start timer | Global timeout | Own timeout |
| AI Players | Global array | Own array |
| Webhooks | Global map | Own map |
| Breaking platforms | In global WorldState | In own WorldState |

### What stays GLOBAL (shared across all arenas)

| State | Reason |
|-------|--------|
| Player identity/auth | Players are platform-level, not arena-level |
| Platform-wide leaderboard | Cross-arena ranking (separate from per-arena scores) |
| Arena registry | The list of all arenas |
| DB connection | Shared infrastructure |

---

## Arena Lifecycle

### 1. Creation (External Agent -> API)

```
POST /api/arenas
{
  "name": "Puzzle Dimension",
  "description": "A calm puzzle arena with brain teasers",
  "gameMasterName": "The Riddler",
  "maxPlayers": 8,
  "entryFee": 50,           // cosmetic tokens, display only
  "rewards": "100 tokens",  // cosmetic, display only
  "allowedGameTypes": ["reach_goal", "collect"],
  "defaultTemplate": "spiral_tower",
  "environment": { "skyColor": "#1a0033", "fogDensity": 0.02 },
  "rules": "No spells allowed. Pure skill only."
}

Response:
{
  "arenaId": "puzzle-dimension-a3f8",
  "apiKey": "ak_abc123...",
  "endpoints": {
    "context": "/api/arenas/puzzle-dimension-a3f8/agent/context",
    "spawn": "/api/arenas/puzzle-dimension-a3f8/world/spawn",
    "startGame": "/api/arenas/puzzle-dimension-a3f8/game/start",
    ...
  }
}
```

### 2. Management (Agent polls context, sends commands)

The external agent runs its own loop (like our `agent-runner.js`):
1. Poll `GET /api/arenas/:arenaId/agent/context` — gets full arena state
2. Decide what to do (using their own LLM/logic)
3. Call tools: `POST /api/arenas/:arenaId/world/spawn`, `/game/start`, `/spell/cast`, etc.
4. All 29 existing tools work, scoped to their arena

Authentication: `X-Arena-API-Key: ak_abc123...` header on all management requests.

### 3. Discovery (Players browse lobby)

```
GET /api/arenas
[
  {
    "id": "chaos",
    "name": "Chaos Arena",
    "gameMasterName": "Chaos Magician",
    "playerCount": 3,
    "phase": "playing",
    "description": "The original chaos experience",
    "isDefault": true
  },
  {
    "id": "puzzle-dimension-a3f8",
    "name": "Puzzle Dimension",
    "gameMasterName": "The Riddler",
    "playerCount": 1,
    "phase": "lobby",
    "entryFee": 50,
    "upvotes": 12
  }
]
```

### 4. Joining (Player selects arena)

Client passes `arenaId` in Colyseus join options:
```javascript
const room = await client.joinOrCreate('game', {
  name: playerName,
  arenaId: selectedArenaId
});
```

Colyseus `filterBy(['arenaId'])` routes players to the correct room instance.

### 5. Persistence

Arena configs stored in DB. On server restart, arenas are reloaded (but world state resets — entities are ephemeral, only the config persists). Agents can rebuild their arena world on reconnect by polling context and spawning entities.

---

## API Design

### Arena Management (top-level, not scoped)

| Method | Endpoint | Auth | Purpose |
|--------|----------|------|---------|
| `POST` | `/api/arenas` | API key | Create new arena |
| `GET` | `/api/arenas` | None | List all arenas (lobby) |
| `GET` | `/api/arenas/:id/info` | None | Arena details |
| `PATCH` | `/api/arenas/:id` | Arena API key | Update arena config |
| `DELETE` | `/api/arenas/:id` | Arena API key | Delete arena |
| `POST` | `/api/arenas/:id/upvote` | Player auth | Upvote arena |

### Per-Arena Endpoints (scoped via middleware)

All 50+ existing endpoints work at both paths:
- `/api/world/spawn` -> targets default "chaos" arena (backward compat)
- `/api/arenas/:arenaId/world/spawn` -> targets specific arena

The middleware resolves `arenaId` and injects `req.arena` with the correct ArenaInstance.

### Authentication Model

| Actor | Auth Method | Access |
|-------|-------------|--------|
| Our agent-runner.js | No auth (localhost, default arena) | Full control of chaos arena |
| External agent | `X-Arena-API-Key` header | Full control of their arena only |
| Player | Privy JWT (optional) | Join any arena, send chat |
| Public | None | View arena list, public stats |

---

## Middleware Architecture

### Route Mounting (key refactor in `src/server/index.js`)

```javascript
const gameRouter = express.Router();

// All existing endpoints move here, using req.arena instead of globals
gameRouter.get('/agent/context', (req, res) => { ... });
gameRouter.post('/world/spawn', (req, res) => { ... });
// ... all 50+ endpoints

// Mount at both paths
app.use('/api/arenas/:arenaId', arenaMiddleware(arenaManager), gameRouter);
app.use('/api', arenaMiddleware(arenaManager), gameRouter);  // default arena
```

### Handler Refactoring (mechanical replacement)

Every route handler changes from:
```javascript
// BEFORE — references globals
app.post('/api/world/spawn', (req, res) => {
  const entity = worldState.spawnEntity(...);
  broadcastToRoom('entity_spawned', entity);
});
```

To:
```javascript
// AFTER — references req.arena
gameRouter.post('/world/spawn', (req, res) => {
  const entity = req.arena.worldState.spawnEntity(...);
  req.arena.broadcastToRoom('entity_spawned', entity);
});
```

---

## Colyseus Multi-Room

```javascript
gameServer.define('game', GameRoom)
  .filterBy(['arenaId'])
  .on('create', (room) => {
    const arenaId = room.metadata?.arenaId || 'chaos';
    const arena = arenaManager.getArena(arenaId);
    if (arena) {
      room.worldState = arena.worldState;
      arena.gameRoom = room;
    }
  });
```

---

## Game Loop Scoping

The main `setInterval` tick iterates all arenas:

```javascript
setInterval(() => {
  const delta = (now - lastUpdateTime) / 1000;
  for (const arena of arenaManager.getAllArenas()) {
    arena.worldState.updateKinematicEntities(delta);
    arena.worldState.processBreakingPlatforms(arena.broadcastToRoom);
    if (arena.currentMiniGame?.isActive) {
      arena.currentMiniGame.update(delta);
    }
  }
}, 100);
```

---

## Database Schema

### New `arenas` Table

```sql
CREATE TABLE IF NOT EXISTS arenas (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  description     TEXT DEFAULT '',
  creator_id      TEXT,
  api_key         TEXT UNIQUE NOT NULL,
  game_master_name TEXT DEFAULT 'Game Master',
  config          JSONB DEFAULT '{}',
  upvotes         INTEGER DEFAULT 0,
  is_default      BOOLEAN DEFAULT FALSE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  last_active     TIMESTAMPTZ DEFAULT NOW()
);
```

### Config JSONB Structure
```json
{
  "maxPlayers": 8,
  "entryFee": 0,
  "rewards": "",
  "allowedGameTypes": ["reach_goal", "collect", "survive"],
  "defaultTemplate": null,
  "environment": {},
  "rules": "",
  "autoStartDelay": 45000
}
```

---

## Skill.md for External Agents

A new `docs/ARENA-HOST-SKILL.md` that any LLM/agent can read to understand how to host an arena:

1. **Quick Start** — Create arena, get API key, start hosting
2. **Arena Configuration** — All config options with examples
3. **Context Polling** — How to read arena state, what fields mean
4. **Available Tools** — All 29 game tools with parameters and examples
5. **Game Types** — reach_goal, collect, survive — how each works
6. **Arena Templates** — 7 built-in templates, how to use them
7. **Prefabs** — 12 spawnable prefabs (spider, bounce_pad, etc.)
8. **Entity System** — Types, shapes, properties, behaviors
9. **Pacing Guide** — Recommended timing, rate limits, cooldowns
10. **Example Agent Loop** — Pseudocode for a basic game master loop

---

## Frontend: Arena Lobby

Simple list UI added to the existing login/lobby screen:

```
+----------------------------------+
| CHAOS ARENA                      |
| Choose your arena:               |
|                                  |
| [*] Chaos Arena        3 players |
|     by Chaos Magician   PLAYING  |
|                                  |
| [ ] Puzzle Dimension    1 player |
|     by The Riddler      LOBBY    |
|                                  |
| [ ] Speed Demons        0        |
|     by RaceBot          IDLE     |
|                                  |
|        [JOIN ARENA]              |
+----------------------------------+
```

- Fetched from `GET /api/arenas` on page load
- Auto-refreshes every 5s
- Shows: name, game master, player count, current phase
- Default selection: "Chaos Arena"

---

## Backward Compatibility

| Component | Changes Needed | Breaking? |
|-----------|----------------|-----------|
| agent-runner.js | None — `/api/...` defaults to chaos arena | No |
| Client (existing players) | None if going to chaos arena | No |
| chat-bridge.js | None — defaults to chaos arena | No |
| Saved URLs/bookmarks | Work unchanged | No |
| SSE overlays (OBS) | Add `?arenaId=...` param, default = chaos | No |
| OpenClaw game-world-skill.js | Add optional `ARENA_ID` env var to URL prefix | No |
| deploy.sh | No changes | No |

---

## New Files

| File | Purpose |
|------|---------|
| `src/server/ArenaManager.js` | Arena registry — create, get, list, destroy arenas |
| `src/server/ArenaInstance.js` | Per-arena state bundle (WorldState + game loop + cooldowns + SSE) |
| `src/server/arenaMiddleware.js` | Express middleware — resolve arenaId, inject req.arena |
| `docs/ARENA-HOST-SKILL.md` | External agent hosting guide (the skill.md) |

## Modified Files

| File | Changes |
|------|---------|
| `src/server/index.js` | Extract routes to gameRouter, replace globals with req.arena, mount at both paths, arena CRUD endpoints, game loop iteration |
| `src/server/GameRoom.js` | Add arenaId metadata, read from options |
| `src/client/main.js` | Arena lobby fetch + selection, pass arenaId in join options, scope API_URL |
| `index.html` | Arena lobby UI elements |
| `src/server/db.js` | Add arenas table migration |
| `config/openclaw/game-world-skill.js` | Optional ARENA_ID env var for URL prefix |

---

## Dev Roadmap

### Phase 1: Foundation (ArenaManager + ArenaInstance)
- Create `ArenaInstance` class bundling all per-arena state
- Create `ArenaManager` with create/get/list/destroy
- Instantiate default "chaos" ArenaInstance on server start
- Wire existing globals to point at `defaultArena.*`
- **Verify**: Server boots, existing game works identically

### Phase 2: Route Extraction
- Extract all 50+ game endpoints into `express.Router()`
- Create `arenaMiddleware` that resolves arenaId -> ArenaInstance
- Refactor all handlers: replace globals with `req.arena.*`
- Mount router at `/api` (default) and `/api/arenas/:arenaId`
- Move helper functions (`applyTemplate`, `startGameInternal`, etc.) to accept `arena` param
- **Verify**: All existing API calls still work at `/api/...`

### Phase 3: Colyseus Multi-Room
- Add `filterBy(['arenaId'])` to room definition
- Update `GameRoom.onCreate` to read `arenaId` from options and set metadata
- Wire room's worldState from ArenaManager lookup
- Handle room disposal -> update arena's `gameRoom` reference
- **Verify**: Client can join specific arenas by passing arenaId

### Phase 4: Game Loop Scoping
- Refactor the main `setInterval` tick to iterate `arenaManager.getAllArenas()`
- Scope auto-start timer per arena
- Scope phase change callbacks per arena
- **Verify**: Two arenas can run games simultaneously without interference

### Phase 5: Arena CRUD API + Persistence
- Add `POST/GET/PATCH/DELETE /api/arenas` endpoints
- API key generation (crypto.randomUUID)
- Arena auth middleware for management endpoints
- DB table + migration for arena persistence
- Arena reload on server restart
- **Verify**: External agent can create arena via API, get API key, manage it

### Phase 6: Frontend Lobby
- Add arena list UI to login/lobby screen
- Fetch `GET /api/arenas` on load, refresh every 5s
- Arena selection -> pass arenaId to Colyseus join
- Show player count, phase, game master name
- **Verify**: Player can browse arenas and join one

### Phase 7: Skill Documentation
- Write comprehensive `docs/ARENA-HOST-SKILL.md`
- Include: quick start, all tools, game types, templates, prefabs, pacing, example loop
- Test with a fresh Claude/OpenClaw session to verify completeness
- **Verify**: An external agent can read the doc and successfully host an arena

### Phase 8: Polish + Upvotes (stretch)
- Add upvote endpoint `POST /api/arenas/:id/upvote`
- Sort arena list by upvotes
- Arena "last active" tracking
- Auto-cleanup stale arenas (no activity for 24h)
- Arena stats (total games played, unique players)

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Breaking existing game | Phase 1 verifies existing functionality before any API changes |
| Memory pressure (multiple WorldStates) | Each WorldState is lightweight (~50KB). 10 arenas = ~500KB. VPS has 3.7GB |
| Agent abuse (spam arenas) | Rate limit arena creation, max 20 arenas, require API key |
| Stale arenas | Auto-cleanup after 24h inactivity (Phase 8) |
| 50+ endpoint refactor errors | Mechanical find-replace, test each endpoint category |
| Colyseus room lifecycle | Handle room disposal cleanly, update ArenaManager references |
