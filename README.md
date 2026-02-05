# Self-Building Game: The Chaos Magician

An AI agent builds a 3D multiplayer game in real-time while players play and audiences watch.

**Track**: Gaming Arena Agent Bounty | **Stack**: Three.js + Colyseus + OpenClaw

---

## What It Does

- An AI "Chaos Magician" controls the game world: spawning platforms, obstacles, and collectibles
- Players join via browser and navigate the 3D world with WASD + jump controls
- The agent runs mini-games (reach-the-goal, collect-a-thon, survival, obstacle course), casts spells, and injects tricks mid-game
- Players chat with the agent using @agent mentions; the agent responds and adapts

## Architecture

```
Browser (Three.js + Colyseus WebSocket)
    |
    | nginx reverse proxy (SSL + WebSocket + SSE)
    |
Game Server (Express + Colyseus, port 3000)
    |           |            |
    | HTTP API  | PostgreSQL | SSE Event Stream
    |           |            |
Agent Runner (agent-runner.js, host process)
    |
    | openclaw agent CLI
    |
OpenClaw Gateway (port 18789)
    |
    | Claude 3.5 Haiku
    |
Anthropic API
```

**Game Server** hosts the world state, player sync, mini-game engine, and HTTP API.
**Browser Client** renders the 3D world with Three.js and connects via WebSocket.
**Agent Runner** polls game context every 8s, calculates drama score, and invokes the AI agent.
**OpenClaw Gateway** manages agent sessions and routes messages to Claude 3.5 Haiku.
**AI Agent** (Chaos Magician) controls the game via HTTP API calls — spawning arenas, starting games, casting spells, and chatting with players.
**PostgreSQL** persists leaderboards, game history, and user data across restarts.
**AI Players** (Explorer Bot, Chaos Bot) provide activity when human players are scarce.

## Tech Stack

| Component | Technology |
|-----------|------------|
| 3D Rendering | Three.js |
| Multiplayer | Colyseus (WebSocket) |
| Server | Express + Node.js |
| AI Agent | OpenClaw + Claude 3.5 Haiku |
| Database | PostgreSQL |
| Build Tool | Vite |
| Deployment | Docker + docker-compose |

## Run Locally

```bash
git clone https://github.com/SotoAlt/self-building-game.git
cd self-building-game
npm install
npm run dev
```

Opens game client at `localhost:5173`, game server at `localhost:3000`.
No PostgreSQL required for local dev (runs in-memory).

## Production Deployment

Live at **https://chaos.waweapps.win**

Deployed on Hetzner (178.156.239.120) with Docker + nginx + Let's Encrypt SSL.

```bash
# Deploy (installs Docker if needed, syncs files, gets SSL cert, starts services)
bash deploy.sh

# Check logs
ssh root@178.156.239.120 'cd /opt/self-building-game && docker compose logs -f game'

# Restart game server
ssh root@178.156.239.120 'cd /opt/self-building-game && docker compose restart game'

# Full rebuild
ssh root@178.156.239.120 'cd /opt/self-building-game && docker compose up -d --build'
```

Spectator mode: **https://chaos.waweapps.win/?spectator=true**

### Local Docker

```bash
cp .env.example .env
docker-compose up --build
```

## Agent Capabilities (19 Tools)

| Tool | Description |
|------|-------------|
| `spawn_entity` | Create platforms, ramps, collectibles, obstacles, triggers |
| `modify_entity` | Update position, size, color, movement of entities |
| `destroy_entity` | Remove entities from the world |
| `set_physics` | Change gravity, friction, bounce globally |
| `get_world_state` | Read full world state |
| `get_player_positions` | Track all player locations |
| `create_challenge` | Create reach/collect/survive/time_trial objectives |
| `get_challenge_status` | Check challenge progress |
| `announce` | Send announcements to all players |
| `start_game` | Launch a mini-game (reach, collect, survival, obstacle) |
| `end_game` | End current mini-game |
| `get_game_state` | Check game phase and timer |
| `get_game_types` | List available mini-game types |
| `send_chat_message` | Chat with players |
| `get_chat_messages` | Read player chat messages |
| `cast_spell` | Cast effects (low gravity, speed boost, inverted controls, etc.) |
| `clear_spells` | Remove all active spell effects |
| `add_trick` | Inject tricks mid-game (time/score/death triggers) |
| `get_context` | Unified polling: players, chat, events, game state |
| `clear_world` | Remove all entities from the world |
| `load_template` | Spawn a pre-built arena layout |
| `set_respawn` | Set player respawn position |
| `get_drama_score` | Check current drama level (0-100) |
| `start_building` | Enter building phase between games |
| `check_bribes` | View pending player bribes |

## API Endpoints

```
GET  /api/health           - Server health check
GET  /api/stats            - Aggregate stats (games, players, uptime)
GET  /api/world/state      - Full world state
POST /api/world/spawn      - Create entity
POST /api/world/modify     - Update entity
POST /api/world/destroy    - Remove entity
POST /api/physics/set      - Change physics
GET  /api/players          - Player positions
POST /api/game/start       - Start mini-game
POST /api/game/end         - End current game
POST /api/game/trick       - Add trick mid-game
GET  /api/game/state       - Game state
GET  /api/leaderboard      - Top 10 players
GET  /api/chat/messages    - Chat messages
POST /api/chat/send        - Agent sends message
POST /api/spell/cast       - Cast spell effect
POST /api/announce         - Global announcement
GET  /api/agent/context    - Unified agent context
```

## Key Files

| File | Purpose |
|------|---------|
| `src/server/index.js` | Express API + Colyseus server + game loop |
| `src/server/WorldState.js` | Source of truth: entities, players, physics, chat, leaderboard |
| `src/server/GameRoom.js` | Colyseus room: player sync, chat, ready system |
| `src/server/MiniGame.js` | Mini-game base class with trick system |
| `agent-runner.js` | Standalone agent loop (runs on host, invokes OpenClaw) |
| `src/server/AgentLoop.js` | In-container drama score + phase tracking |
| `src/server/AgentBridge.js` | OpenClaw CLI bridge (disabled in Docker) |
| `src/server/AIPlayer.js` | Virtual AI players with personality types |
| `src/server/ArenaTemplates.js` | 5 pre-built arena layouts |
| `src/server/blockchain/ChainInterface.js` | Blockchain abstraction + bribe system |
| `src/server/games/` | ReachGoal, CollectGame, Survival implementations |
| `src/server/db.js` | PostgreSQL persistence with graceful fallback |
| `src/client/main.js` | Three.js client: rendering, input, camera, chat |
| `index.html` | Game HTML with chat, leaderboard, announcements |
| `config/openclaw/` | Agent skill definition (19 tools) |

## License

MIT
