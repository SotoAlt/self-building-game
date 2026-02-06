# Self-Building Game - Agent Context

## Project Overview

An AI agent ("Chaos Magician") builds a 3D multiplayer game in real-time while players play and audiences watch via livestream. The agent spawns arenas, starts mini-games, casts spells, and reacts to player behavior — all autonomously.

## Current Phase

**Production v0.15.0** — deployed at `https://chaos.waweapps.win` on Hetzner VPS.

## Architecture

```
Browser Client (Three.js + Colyseus)
    |
    | WebSocket (real-time sync)
    |
Game Server (Express + Colyseus, port 3000)
    |           |            |
    | HTTP API  | PostgreSQL | SSE Stream
    |           |            |
OpenClaw Agent (Chaos Magician)
    |
    | AgentLoop.js (in-server, drama-based scheduling)
    |
Claude (Anthropic) via OpenClaw Gateway
```

**Stack**: Three.js + Colyseus + Express + OpenClaw + PostgreSQL

## Directory Structure

```
/self-building-game
├── src/
│   ├── server/
│   │   ├── index.js          # Express API (50+ endpoints) + Colyseus setup
│   │   ├── WorldState.js     # Entities, players, leaderboard, spells, events, spectator mgmt
│   │   ├── GameRoom.js       # WebSocket message handlers, mid-game spectator detection
│   │   ├── MiniGame.js       # Game lifecycle, trick system, scoring, random obstacles
│   │   ├── AgentLoop.js      # Drama score, phase detection, agent scheduling, player welcomes
│   │   ├── AgentBridge.js    # OpenClaw CLI invocation
│   │   ├── AIPlayer.js       # Personality-driven AI bots
│   │   ├── ArenaTemplates.js # 5 pre-built arena layouts
│   │   ├── auth.js           # Privy JWT verification
│   │   ├── db.js             # PostgreSQL with in-memory fallback
│   │   ├── blockchain/       # Mock chain interface (bribe system)
│   │   └── games/            # ReachGoal, CollectGame, Survival
│   └── client/
│       ├── main.js           # Three.js renderer, physics, player controls
│       └── auth.js           # Privy client-side auth
├── config/openclaw/
│   ├── game-world-skill.js   # 27 agent tools (HTTP API wrappers, decoration type, shape property)
│   ├── game-player-skill.js  # 8 external agent player tools
│   └── SOUL.md               # Chaos Magician personality
├── docs/                     # PRD, CONCEPT, ROADMAP, STACK-EVALUATION
├── index.html                # Game UI (login, chat, leaderboard, spectator)
├── agent-runner.js           # Standalone agent loop (sole agent system, runs on host)
├── chat-bridge.js            # Twitch/Discord/Telegram chat bridge
├── deploy.sh                 # Production deployment script
├── docker-compose.yml        # Game server + PostgreSQL + nginx + certbot
├── Dockerfile                # Multi-stage build
└── nginx.conf                # SSL termination + WebSocket/SSE proxy
```

## Development Commands

```bash
npm install          # Install dependencies
npm run dev          # Vite dev server + game server (hot-reload)
npm start            # Production server (serves dist/)
npm run build        # Build client for production
```

## Key API Endpoints

| Endpoint | Purpose |
|----------|---------|
| `GET /api/agent/context` | Full game state for agent decisions |
| `POST /api/game/start` | Start a mini-game |
| `POST /api/entity/spawn` | Spawn entity in world |
| `POST /api/spell/cast` | Cast spell on players |
| `POST /api/arena/load` | Load arena template |
| `POST /api/agent/pause` | Kill switch — pause agent |
| `POST /api/agent/resume` | Resume agent |
| `POST /api/ai-players/toggle` | Enable/disable AI bots |
| `POST /api/world/environment` | Change sky, fog, lighting |
| `GET /api/stream/events` | SSE feed for OBS overlays |
| `POST /api/chat/bridge` | External platform chat (Twitch/Discord/Telegram) |

## Agent System

- **agent-runner.js** is the sole agent system — runs on VPS host (not in Docker), has OpenClaw CLI access
- **AgentLoop.js** runs inside Docker but is naturally inactive (no OpenClaw installed)
- **2s tick interval** with drama score (0-100) driving invoke frequency (async, non-blocking)
- **@mention fast-track**: 3s minimum for `@agent` mentions (vs 15s standard minimum)
- **Session phases**: welcome → warmup → gaming → intermission → escalation → finale
- **Agent auto-pauses** when 0 human players connected
- **Player welcome system**: detects joins, queues `pendingWelcomes`, greets by name
- **Cooldown guard**: agent skips invocation during 15s post-game cooldown
- **Variety hints**: `suggestedGameTypes` excludes last played game type
- **State tracking**: `lastProcessedChatId`, `welcomedPlayers`, `processedBribeIds` — no re-processing
- **Personality**: Chaos magic apprentice — short messages, twists player requests, tool honesty
- Model: Claude (Anthropic) via OpenClaw

## Game Flow (v0.14.0)

- **Countdown**: "GET READY!" → players teleported to start → free movement during 3s countdown (Fall Guys style)
- **Randomized params**: time limits, goal positions, collectible counts, hazard intervals vary per game
- **Random obstacles**: sweepers, moving walls, pendulums, falling blocks spawn each game
- **Game end**: timer shows "YOU WIN!" / "GAME OVER" / "TIME UP!" / "DRAW!" → 3s "Returning to lobby..." → 15s cooldown
- **Mid-game spectator**: players joining during active games watch until next round
- **Floor types**: `solid` (default), `none` (abyss — no floor during gameplay, invisible floor in lobby), `lava` (kills)
- **Entity types**: platform, ramp, collectible, obstacle, trigger, decoration (no collision)
- **Entity shapes** (via `properties.shape`): box (default), sphere, cylinder, cone, pyramid, torus, dodecahedron, ring

## Key Files to Read

When starting a session:
1. `docs/ROADMAP.md` — Current progress and upcoming phases
2. `src/server/index.js` — HTTP API surface
3. `src/server/WorldState.js` — Game state structure
4. `CHANGELOG.md` — What changed recently

## Debug & Testing

- **Debug panel**: Add `?debug=true` to URL for runtime controls
- **Spectator mode**: Add `?spectator=true` for free camera
- **Agent status**: `curl localhost:3000/api/agent/status`
- **World state**: `curl localhost:3000/api/world`

## Links

- [Production](https://chaos.waweapps.win)
- [GitHub](https://github.com/SotoAlt/self-building-game)
- [Three.js Docs](https://threejs.org/docs/)
- [Colyseus Docs](https://docs.colyseus.io)
