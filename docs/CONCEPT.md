# Technical Concept: Self-Building Game

## Core Idea

An AI agent acts as both **game designer** and **character** in a multiplayer 3D world. The agent:

1. **Builds** the world: spawns platforms, obstacles, ramps, collectibles, triggers
2. **Runs games**: starts mini-games, sets time limits, adds mid-game tricks
3. **Casts spells**: inverts controls, changes gravity, resizes players
4. **Observes** players: tracks deaths, scores, chat, bribes
5. **Entertains**: commentates, reacts, escalates based on drama score

This creates a feedback loop where the game evolves based on player behavior.

---

## Architecture

```
Browser Client (Three.js + Colyseus)
    |
    | WebSocket (real-time sync)
    |
Game Server (Express + Colyseus, port 3000)
    |           |            |            |
    | HTTP API  | PostgreSQL | SSE Stream | Webhooks
    |           |            |            |
OpenClaw Agent (Chaos Magician)        External Agents
    |                                  (Agent-as-Player API)
    | AgentLoop.js (drama-based scheduling)
    |
Claude (Anthropic) via OpenClaw Gateway
```

### Components

**Game Server** (Express + Colyseus)
- Express HTTP API with 50+ endpoints for agent control, game lifecycle, chat, bribes, webhooks, public API
- Colyseus WebSocket rooms for real-time player sync (positions, states, events)
- WorldState manages all game data: entities, players, physics, spells, leaderboard
- SSE event feed for OBS overlays and external consumers
- Webhook system for event-driven integrations

**Browser Client** (Three.js)
- 3D rendering with AABB collision detection
- Pointer lock camera with orbit zoom
- Camera-relative WASD movement + jump
- Touch controls for mobile (virtual joystick + action buttons)
- Particle systems (death, collection, spells, lava)
- Screen effects (shake, flash, vignette overlays)

**Agent System** (OpenClaw)
- AgentLoop.js: in-server drama-based autonomous scheduling (15-45s intervals)
- AgentBridge.js: invokes OpenClaw CLI with context-rich prompts
- 27 agent tools via game-world-skill.js (spawn, modify, destroy, game lifecycle, spells, chat, bribes)
- Session phases: welcome, warmup, gaming, intermission, escalation, finale
- Drama score (0-100) drives intervention frequency
- Player welcome system: detects joins, greets by name
- Cooldown guard: skips invocation during 15s post-game cooldown
- Variety hints: suggests game types different from last played

**Persistence** (PostgreSQL)
- Users, leaderboard, game history tables
- Graceful fallback to in-memory when DB unavailable

---

## Agent Design

### The Chaos Magician

**Role**: Autonomous game master — builds arenas, runs games, entertains players

**Personality** (defined in SOUL.md):
- Mischievous, dramatic, occasionally merciful
- Takes joy in creative chaos (not griefing)
- Responds to chat, bribes, and player behavior
- Escalates difficulty over a session arc

**Decision Loop**:
```
AgentLoop.js runs continuously:
1. Calculate drama score (player activity, deaths, time since last action)
2. Determine session phase (welcome/warmup/gaming/intermission/escalation/finale)
3. Build context message (players, game state, chat, bribes, leaderboard)
4. Invoke agent via OpenClaw CLI with phase-specific prompt
5. Agent executes tools (HTTP calls back to game server)
6. Wait interval (15-45s, shorter when drama is high)
7. Repeat
```

**Tools** (27 available):
- World: spawn_entity, modify_entity, destroy_entity, clear_world, load_template, set_floor, set_respawn, set_environment
- Games: start_game, end_game, start_building, add_trick
- Spells: cast_spell, clear_spells
- Communication: send_chat_message, announce, get_chat_messages
- Context: get_context, get_world_state, get_player_positions, get_drama_score
- Bribes: check_bribes, honor_bribe
- Challenges: create_challenge, get_challenge_status

### AI Players

Three personality types populate the world when humans are scarce:

- **Explorer Bot**: plays earnestly, completes challenges, models good behavior
- **Chaos Bot**: tests edges, finds exploits, creates entertaining moments
- **Tryhard Bot**: competitive, goes for wins, pressures other players

### External Agent Players

External AI agents connect via the Agent-as-Player API:
- Join as a player with `join_game(name)`
- Move, chat, bribe, and compete
- Interact with the Chaos Magician through gameplay
- True agent-to-agent coordination in a shared 3D world

---

## Game Systems

### Game Flow (v0.11.0)

1. **Lobby**: Players join, agent greets by name, builds arena
2. **Countdown**: "GET READY!" → players teleport to start → 3s countdown with free movement (Fall Guys style)
3. **Playing**: Randomized parameters (time limits, goal positions, obstacle layouts). Random obstacles spawn each game.
4. **Ended**: Timer shows "YOU WIN!" / "GAME OVER" / "TIME UP!" / "DRAW!" → 3s "Returning to lobby..." → 15s cooldown
5. **Mid-game joiners** become spectators with a banner, auto-activated next round

### Mini-Games

Three game types, each with randomized parameters and game-specific tricks:

| Type | Objective | Tricks |
|------|-----------|--------|
| ReachGoal | First to reach the goal position | move_goal, spawn_obstacles, spawn_shortcut |
| CollectGame | Collect the most items before time runs out | scatter, spawn_bonus, spawn_decoys |
| Survival | Last player standing on shrinking platforms | shrink_platform, hazard_wave, safe_zone, gravity_flip |

### Trick System

Mid-game events the Magician can add with triggers:
- `time`: fire at a specific elapsed time
- `interval`: fire repeatedly on a timer
- `score`: fire when a player reaches a score threshold
- `deaths`: fire when enough players are eliminated

### Bribe System

Players spend tokens (starting balance: 1000) to influence the Magician:

| Bribe | Cost | Execution |
|-------|------|-----------|
| Spawn Obstacles | 50 | Auto (server-side) |
| Lava Floor | 100 | Auto |
| Random Spell | 30 | Auto |
| Move Goal | 75 | Queued for agent |
| Extra Time | 40 | Queued for agent |
| Custom Request | 200 | Queued for agent |

Simple bribes execute immediately. Complex bribes are queued for the Magician to honor or ignore.

### Floor System

Three floor types the Magician can toggle:
- `solid`: normal ground
- `none`: abyss — platforms are the only safe ground
- `lava`: kills on contact with fire particles

### Spell System

Eight spell types that stack and have durations:
- Inverted Controls, Low Gravity, High Gravity, Speed Boost
- Slow Motion, Bouncy World, Giant Mode, Tiny Mode

---

## Multiplayer Sync

- Colyseus handles room state and player synchronization
- Server authoritative for game state, client authoritative for movement
- Positions broadcast at 20 Hz with interpolation
- WebSocket reconnection with automatic retry

---

## External Integration

### SSE Event Feed
Real-time event stream for OBS overlays: `GET /api/stream/events`

### Webhooks
Register URLs to receive game events (fire-and-forget POST with 5s timeout):
- Events: game_started, game_ended, player_died, bribe_submitted, spell_cast, agent_action, player_joined, player_left

### Public API
Read-only endpoints for external consumers:
- `GET /api/public/state` — sanitized game state
- `GET /api/public/leaderboard` — top players
- `GET /api/public/events?since=<timestamp>` — recent events (polling)
- `GET /api/public/stats` — session statistics

---

## Key Technical Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Game Engine | Three.js | Full control over 3D rendering, physics, effects |
| Multiplayer | Colyseus | Battle-tested WebSocket rooms with state sync |
| Agent Framework | OpenClaw | CLI-based tool use, session management, model flexibility |
| Agent Model | Claude (Anthropic) | Powerful reasoning for dynamic game mastering |
| Persistence | PostgreSQL | Reliable, with graceful in-memory fallback |
| Deployment | Docker + nginx | SSL termination, WebSocket proxy, reproducible builds |
| Auth | Privy | Twitter OAuth + guest mode, JWT tokens |
