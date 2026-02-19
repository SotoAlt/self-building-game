# Self-Building Game: The Chaos Arena

An AI agent ("Chaos Magician") builds a 3D multiplayer game in real-time while players play and audiences watch via livestream.

**Live**: [chaos.waweapps.win](https://chaos.waweapps.win) | **Track**: Gaming Arena Agent Bounty

---

## How It Works

- An AI **Chaos Magician** (powered by Claude via OpenClaw) controls the game world autonomously — composing arenas, starting games, casting spells, and reacting to player behavior
- **Players** join via browser (desktop or mobile) and compete in 6 game types across 16 arena templates
- The agent's **drama score** (0-100) drives how aggressively it intervenes — from chill lobby vibes to chaotic spell-flinging
- **External audiences** on Twitch, Discord, and Telegram interact with the agent via chat bridge
- **Multiple arenas**: any AI agent can create and host its own arena via the HTTP API

## Tech Stack

| Component | Technology |
|-----------|------------|
| 3D Rendering | Three.js (cel-shaded toon style) |
| Multiplayer | Colyseus (WebSocket) |
| Server | Express + Node.js |
| AI Agent | OpenClaw + Claude (Anthropic) |
| Database | PostgreSQL (with in-memory fallback) |
| Build | Vite |
| Deployment | Docker + nginx + Let's Encrypt |

## Quick Start

```bash
git clone https://github.com/SotoAlt/self-building-game.git
cd self-building-game
npm install
npm run dev
```

Opens game client at `localhost:5173`, game server at `localhost:3000`.
No PostgreSQL required for local dev — the server falls back to in-memory storage.

## Production

Live at **https://chaos.waweapps.win** on Hetzner VPS (Docker + nginx + Let's Encrypt SSL).

```bash
# Deploy
bash deploy.sh

# Logs
ssh root@178.156.239.120 'cd /opt/self-building-game && docker compose logs -f game'

# Restart
ssh root@178.156.239.120 'cd /opt/self-building-game && docker compose restart game'
```

Spectator mode: `https://chaos.waweapps.win/?spectator=true`

## Architecture

```
Browser Client (Three.js + Colyseus)
    |
    | nginx (SSL + WebSocket + SSE)
    |
Game Server (Express + Colyseus, port 3000)
    |           |            |            |
    | HTTP API  | PostgreSQL | SSE Stream | ArenaManager
    |           |            |            |
    +-- Chaos Arena (agent-runner.js -> OpenClaw -> Claude)
    +-- External Arena N (any AI agent -> HTTP API)
```

See **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** for the full system architecture — module-by-module breakdown, data flow diagrams, and file inventory.

## Project Structure

```
src/
  server/           46 JS files (~9,000 lines)
    index.js        Bootstrap + Colyseus setup
    WorldState.js   Facade over 8 sub-managers
    GameRoom.js     WebSocket handlers (50+ message types)
    MiniGame.js     Game base class + trick system
    AgentLoop.js    Drama score + agent scheduling
    managers/       8 focused state managers
    routes/         7 route files (world, game, bribe, agent, public, arena, auth)
    services/       gameService, arenaService
    games/          6 game types (reach, collect, survival, king, hot_potato, race)
  client/           38 JS/JSX files (~6,500 lines)
    main.js         Orchestrator (273 lines) — wires 34 modules
    entities/       EntityFactory (geometry cache), EntityManager (lifecycle)
    physics/        PhysicsEngine (AABB), SpatialHash (O(1) lookups)
    network/        NetworkManager, MessageHandlers, HttpApi
    rendering/      RemotePlayers (interpolation)
    ui/             11 UI modules (HUD, chat, lobby, bribe, profile, etc.)
    audio/          SoundManager (procedural tones)
    vfx/            ScreenEffects (shake, flash, particles)
  shared/           constants.js (entity types, game types, spells, physics)
config/openclaw/    Agent skill definitions + SOUL.md personality
agent-runner.js     Chaos arena agent loop (runs on host)
chat-bridge.js      Twitch/Discord/Telegram bridge
```

## Game Types

| Type | Description | Win Condition |
|------|-------------|---------------|
| `reach` | Race to a goal | First to reach goal trigger |
| `collect` | Gather collectibles | Most collected at timeout |
| `survival` | Stay alive | Last standing or longest alive |
| `king` | Control hill zones | First to 30 points or highest at timeout |
| `hot_potato` | Pass the curse | Last standing after multi-round elimination |
| `race` | Hit checkpoints in order | First to complete all checkpoints |

## Agent System

- **agent-runner.js** is the sole agent system — runs on VPS host, polls game state every 2 seconds
- Drama score (0-100) drives invoke frequency — quiet lobby = rare actions, chaotic game = every tick
- Agent composes arenas via `POST /api/world/compose`, starts games with `POST /api/game/start`
- Max 3 world-changing actions per invocation to prevent overwhelming players
- Variety enforcement: bans recently played game types and templates
- Auto-start fallback: if agent doesn't start a game within 45s, a random template auto-starts

See **[docs/ARCHITECTURE.md#agent-system](docs/ARCHITECTURE.md#agent-system)** for full details.

## Multi-Arena Platform

Any AI agent can create and host its own arena:

```bash
# Create arena
curl -X POST https://chaos.waweapps.win/api/arenas \
  -H "Content-Type: application/json" \
  -d '{"name": "My Arena", "description": "Custom arena"}'
# Returns: { arenaId, apiKey }

# Discover API
curl https://chaos.waweapps.win/skill.md
```

## License

MIT
