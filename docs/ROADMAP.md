# Development Roadmap

## Overview

2-week sprint to hackathon demo. AI "Chaos Magician" builds a 3D multiplayer game in real-time.

**Stack**: Three.js + Colyseus + OpenClaw (Agent Framework)
**Decision**: Hyperfy was evaluated Day 1 but rejected due to physics limitations. Three.js + Colyseus selected for full control.

---

## Phase 1: Foundation (Days 1-2) - COMPLETE

*Completed Feb 3-4, 2026*

- [x] Research & feasibility analysis (competitive landscape, tech options)
- [x] Agent stack selection: OpenClaw chosen over Claude Agent SDK
- [x] Three.js + Colyseus game server on port 3000
- [x] Express HTTP API for agent control (13 endpoints)
- [x] Colyseus WebSocket room for real-time multiplayer
- [x] World state management (entities, players, physics, challenges)
- [x] 5 entity types: platform, ramp, collectible, obstacle, trigger
- [x] OpenClaw game-world skill with 13 tools
- [x] Chaos Magician persona installed (SOUL.md)

**Validation**: Agent spawns platform via Telegram command, appears in 3D world.

---

## Phase 2: Core Loop (Days 2-3) - COMPLETE

*Completed Feb 4, 2026*

- [x] Three.js browser client with WASD + jump controls
- [x] AABB collision detection (platforms, collectibles, obstacles, triggers)
- [x] Vite dev server for hot-reload development
- [x] Remote player rendering (colored capsules + name labels)
- [x] WebSocket reconnection with polling backup
- [x] One-way announcements (agent -> players, CSS-animated overlays)
- [x] Game state machine: lobby -> countdown -> playing -> ended
- [x] 3 mini-games: ReachGoal, CollectGame, Survival
- [x] Mini-game framework with shared base class
- [x] Agent successfully spawns entities and starts games via Telegram

**Validation**: Full end-to-end loop working. Agent controls world, players see changes in real-time.

---

## Phase 3: Agent Chat, Multiplayer Polish & Game Mechanics (Days 3-4) - IN PROGRESS

*Started Feb 4, 2026*

### Priority 1: Player <-> Agent Chat
- [x] Chat message storage in WorldState (last 50 messages)
- [x] WebSocket chat handler with rate limiting (1/sec, 200 char max)
- [x] HTTP endpoints for agent: GET /api/chat/messages, POST /api/chat/send
- [x] Chat panel UI (bottom-left, color-coded by sender type)
- [x] @agent mention highlighting
- [x] Enter to focus chat, Escape to blur, keyboard isolation
- [x] Agent skill: send_chat_message, get_chat_messages tools

### Priority 2: Multiplayer Polish
- [x] Remote player interpolation (lerp toward target, no jitter)
- [x] Mouse look camera (pointer lock, orbit, scroll zoom)
- [x] Camera-relative WASD movement
- [x] Player ready system (R key toggle, server broadcast)

### Priority 3: Richer Game Mechanics
- [x] Moving/kinematic platforms (path waypoints, ping-pong, speed control)
- [x] Player carried by moving platforms (velocity tracking)
- [x] Wall-slide collision (separate X/Z push-out, not full stop)
- [x] Score & leaderboard (top 10, wins tracking)
- [x] Leaderboard panel UI (top-right, auto-refresh)

### Priority 4: Documentation
- [x] ROADMAP.md rewritten with actual progress

### Priority 5: Agent Context & Event System
- [x] Unified /api/agent/context endpoint (single-poll agent loop)
- [x] System messages for player join/leave/death/respawn/ready
- [x] @agent mention detection with request type classification
- [x] Event log system in WorldState
- [x] get_context tool for agent skill

### Priority 6: Trick System (Agent as Game Director)
- [x] Trick system in MiniGame base class (addTrick, processTricks, triggers)
- [x] Time warnings (30s, 10s, 5s remaining)
- [x] ReachGoal tricks: move_goal, spawn_obstacles, spawn_shortcut + defaults
- [x] CollectGame tricks: scatter, spawn_bonus, spawn_decoys + defaults
- [x] Survival tricks: shrink_platform, hazard_wave, safe_zone, gravity_flip + defaults
- [x] POST /api/game/trick endpoint for mid-game trick injection
- [x] add_trick tool in agent skill
- [x] AGENTS.md updated with trick documentation

### Remaining / To Verify
- [ ] Test 2-tab multiplayer with smooth interpolation
- [ ] Test kinematic platform with ReachGoal game
- [ ] Leaderboard recording on game end (integrate with mini-game results)

---

## Phase 4: AI Players & Streaming (Days 5-8)

### AI Player Agents
- [ ] Player agent architecture (Explorer, Chaotic personalities)
- [ ] AI player movement commands (pathfinding or simple goal-seeking)
- [ ] AI player avatars visible in world
- [ ] Agent observes AI player behavior for adaptation

### Streaming Integration
- [ ] OBS scene layout (game + agent reasoning + chat)
- [ ] Chaos Magician avatar overlay
- [ ] Agent commentary output for stream overlay
- [ ] Twitch/YouTube chat integration (viewer suggestions)

---

## Phase 5: Polish & Demo (Days 9-14)

- [ ] Bug bash and stability testing
- [ ] 30-minute stability test
- [ ] Demo video recording (backup)
- [ ] Presentation slides
- [ ] First public stream

---

## Milestones

| Day | Milestone | Status |
|-----|-----------|--------|
| 2 | Agent -> World bridge | DONE |
| 3 | Core game loop | DONE |
| 4 | Chat + multiplayer polish | DONE |
| 4 | Agent context + trick system | DONE |
| 5-8 | AI players + streaming | TODO |
| 9-14 | Polish + demo | TODO |

---

## Architecture

```
Browser Client (Three.js)
    |
    | WebSocket (Colyseus)
    |
Game Server (Express + Colyseus, port 3000)
    |
    | HTTP API
    |
OpenClaw Agent (Chaos Magician)
    |
    | Telegram
    |
Human Operator / Viewers
```

### Key Files

| File | Purpose |
|------|---------|
| src/server/WorldState.js | Source of truth: entities, players, physics, chat, leaderboard |
| src/server/GameRoom.js | Colyseus room: player sync, chat, ready system |
| src/server/index.js | Express API + Colyseus server + game loop |
| src/server/games/ | Mini-game implementations |
| src/client/main.js | Three.js client: rendering, input, camera, chat UI |
| index.html | Game HTML with chat panel, leaderboard, announcements |
| config/openclaw/ | Agent skill definition |
| docs/ | Documentation |
