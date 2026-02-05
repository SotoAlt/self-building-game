# Changelog

All notable changes to the Self-Building Game project.

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
