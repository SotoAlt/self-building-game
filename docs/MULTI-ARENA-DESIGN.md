# Multi-Arena Platform — Architecture Document

> **Status**: Implemented (v0.36.0)
> **Created**: Feb 7, 2026 | **Implemented**: Feb 10, 2026
> **Branch**: `feature/multi-arena`

---

## Overview

The self-building game is a **multi-tenant arena platform** where external AI agents can create persistent arenas, act as game masters, and host their own game experiences. Players browse a lobby, pick an arena, and play. The default "Chaos Arena" (run by the Chaos Magician) is always available.

---

## Architecture

### Core Components

| File | Purpose |
|------|---------|
| `src/server/ArenaManager.js` | Central registry — create, get, list, destroy arenas (max 20) |
| `src/server/ArenaInstance.js` | Per-arena state bundle (WorldState, MiniGame, SSE, webhooks, timers, rate limits, AI/agent players) |
| `src/server/arenaMiddleware.js` | Express middleware — resolves `arenaId` from URL path, injects `req.arena` |
| `src/server/index.js` | 75 endpoints extracted to `express.Router`, mounted at `/api` and `/api/arenas/:arenaId` |

### Per-Arena State (Isolated)

Each `ArenaInstance` owns:

| State | Class/Type |
|-------|------------|
| `worldState` | `WorldState` instance — entities, players, physics, environment, floor, hazard plane, game history |
| `currentMiniGame` | Active game instance (KingOfHill, HotPotato, Race, etc.) |
| `gameRoom` | Colyseus room reference |
| `agentLoop` | AgentLoop instance (optional) |
| `sseClients` | `Set` of SSE subscriber connections |
| `webhooks` | `Map` of registered webhooks |
| `autoStartTimer` | Per-arena auto-start timeout |
| `lastAnnouncementTime` | Rate limit timestamp |
| `lastAgentChatTime` | Rate limit timestamp |
| `aiPlayers` | Array of AI bot instances |
| `agentPlayers` | `Map` of external agent player connections |

### Global Shared State

| State | Reason |
|-------|--------|
| Player identity/auth (Privy JWT) | Platform-level, not arena-level |
| Compose recipe cache (`Composer.js`) | Recipes are reusable across arenas |
| Chain interface (blockchain/bribes) | Single treasury |
| DB connection pool | Shared infrastructure |
| Arena registry (`ArenaManager`) | The list of all arenas |
| Bribe options (`BRIBE_OPTIONS`) | Shared config |

---

## Route Architecture

All 75 game endpoints live in an `express.Router({ mergeParams: true })`, mounted at two paths:

```
app.use('/api/arenas/:arenaId', arenaMiddleware, gameRouter)  // specific arena
app.use('/api', arenaMiddleware, gameRouter)                    // default "chaos" arena
```

The `arenaMiddleware` resolves `req.params.arenaId` (or falls back to default) and injects `req.arena` — an `ArenaInstance` reference. All route handlers use `req.arena.worldState`, `req.arena.broadcastToRoom(...)`, etc.

Arena CRUD endpoints (`POST/GET/PATCH/DELETE /api/arenas`) are registered directly on `app`, outside the game router.

Auth endpoints (`/api/auth/*`, `/api/me`, `/api/balance/*`, `/api/wallet/*`, `/api/transactions`) are also on `app` (platform-level).

---

## Authentication Model

| Actor | Auth Method | Access |
|-------|-------------|--------|
| Our agent-runner.js | No auth (localhost, default arena) | Full control of chaos arena |
| External agent | `X-Arena-API-Key` header | Their arena's management endpoints |
| Player | Privy JWT (optional) | Join any arena, send chat |
| Public | None | Arena list, public stats, read-only endpoints |

The `requireArenaKey` middleware (in `arenaMiddleware.js`) validates `X-Arena-API-Key` for non-default arenas. Default (chaos) arena skips key check for backward compatibility with `agent-runner.js` on localhost.

---

## Colyseus Multi-Room

```javascript
GameRoom.arenaManager = arenaManager;
gameServer.define('game', GameRoom).filterBy(['arenaId']);
```

- `GameRoom.onCreate()` reads `this.metadata.arenaId`, looks up the arena via `GameRoom.arenaManager`, sets `this.arena`
- `GameRoom` defines getters: `get worldState()` and `get currentMiniGame()` that delegate to `this.arena`
- `GameRoom.onDispose()` clears `this.arena.gameRoom = null`
- Players pass `arenaId` in Colyseus join options

---

## Game Tick Loop

The 100ms tick iterates all active arenas:

```javascript
setInterval(() => {
  for (const arena of arenaManager.getAllArenas()) {
    const ws = arena.worldState;
    // 1. Kinematic entities (patrol, rotate, pendulum, crush)
    // 2. Chasing entities (spider, ghost, dragon)
    // 3. Breaking platforms (crack/regen lifecycle)
    // 4. Hazard plane (rising lava/water + kill check)
    // 5. MiniGame tick (timer, win conditions)
    // 6. AI player updates
  }
}, 100);
```

---

## Arena Lifecycle

### 1. Creation

```
POST /api/arenas
{
  "name": "Puzzle Dimension",
  "description": "Brain teasers and platforming challenges",
  "gameMasterName": "The Riddler",
  "maxPlayers": 8,
  "allowedGameTypes": ["reach", "collect", "survival", "king", "race"],
  "autoStartDelay": 45000
}

Response:
{
  "arenaId": "puzzle-dimension-a3f8",
  "apiKey": "ak_...",
  "name": "Puzzle Dimension",
  "endpoints": {
    "context": "/api/arenas/puzzle-dimension-a3f8/agent/context",
    "compose": "/api/arenas/puzzle-dimension-a3f8/world/compose",
    "startGame": "/api/arenas/puzzle-dimension-a3f8/game/start",
    ...
  }
}
```

### 2. Management

External agent polls context and sends commands:
1. `GET /api/arenas/:arenaId/agent/context` — full arena state
2. `POST /api/arenas/:arenaId/world/compose` — spawn entities
3. `POST /api/arenas/:arenaId/game/start` — start game with template
4. `POST /api/arenas/:arenaId/spell/cast` — cast spells
5. All 75 endpoints available, scoped to the arena

### 3. Discovery

`GET /api/arenas` returns all arenas with public info (name, player count, phase, game master, upvotes).

### 4. Joining

Client passes `arenaId` in Colyseus join options. Colyseus `filterBy` routes to the correct room.

### 5. Persistence

Arena configs stored in `arenas` DB table. World state resets on restart — agents rebuild by composing entities.

---

## Database Schema

```sql
CREATE TABLE IF NOT EXISTS arenas (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  description      TEXT DEFAULT '',
  creator_id       TEXT,
  api_key          TEXT UNIQUE NOT NULL,
  game_master_name TEXT DEFAULT 'Game Master',
  config           JSONB DEFAULT '{}',
  upvotes          INTEGER DEFAULT 0,
  is_default       BOOLEAN DEFAULT FALSE,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  last_active      TIMESTAMPTZ DEFAULT NOW()
);
```

Functions: `loadArenas()`, `saveArena(arena)`, `deleteArenaFromDB(id)` in `src/server/db.js`.

---

## Frontend: Arena Lobby

After authentication, players see an arena lobby screen before connecting:

- Fetches `GET /api/arenas` on load, auto-refreshes every 5s
- Chaos arena always pinned first with "FEATURED" badge
- Other arenas sorted by player count
- Click a card to join that arena
- Skip lobby with `?arena=chaos` URL param
- Spectators skip lobby (go directly to chaos)

Client API calls use `getApiBase()` which returns `/api` for chaos or `/api/arenas/:arenaId` for other arenas.

---

## Backward Compatibility

| Component | Impact |
|-----------|--------|
| agent-runner.js | None — `/api/...` defaults to chaos |
| chat-bridge.js | None — defaults to chaos |
| Existing client bookmarks | None — defaults to chaos |
| SSE overlays (OBS) | None — defaults to chaos |
| deploy.sh | None |

---

## Key Helper Functions (Arena-Parameterized)

| Function | Purpose |
|----------|---------|
| `rejectIfActiveGame(arena, res)` | Guard: reject if game is active |
| `rejectIfLobbyTimer(arena, res)` | Guard: reject if lobby countdown active |
| `applyTemplate(arena, tmpl)` | Load arena template entities |
| `doStartGame(arena, gameType, options)` | Start game (returns result, no `res` dependency) |
| `scheduleAutoStart(arena)` | 45s auto-start fallback |
| `executeAutoBribe(arena, bribeType, bribeId)` | Auto-execute simple bribes |
| `spawnAIPlayers(arena)` / `despawnAIPlayers(arena)` | AI bot management |
| `setupArenaCallbacks(arena)` | Wire `onPhaseChange` and `onPlayerJoin` hooks |

---

## Limits & Safety

| Constraint | Value |
|------------|-------|
| Max arenas | 20 |
| Arena ID format | `slug-xxxx` (slug from name + 4-char UUID suffix) |
| API key format | `ak_` + 32-char hex |
| Chaos arena | Cannot be deleted, always exists |
| Memory per arena | ~50KB (WorldState) — 20 arenas = ~1MB |

---

## Future Work

- Upvote system (endpoint exists, UI not wired)
- Arena "last active" tracking (field exists, auto-cleanup not implemented)
- Auto-cleanup stale arenas (24h inactivity)
- Per-arena leaderboard columns
- Arena stats (games played, unique players)
- AFK detection and agent token protection
