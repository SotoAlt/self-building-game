# Development Roadmap

## Overview

2-week sprint to hackathon demo. AI "Chaos Magician" builds a 3D multiplayer game in real-time.

**Stack**: Three.js + Colyseus + OpenClaw (Agent Framework)
**Production**: https://chaos.waweapps.win

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

---

## Phase 2: Core Loop (Days 2-3) - COMPLETE

*Completed Feb 4, 2026*

- [x] Three.js browser client with WASD + jump controls
- [x] AABB collision detection (platforms, collectibles, obstacles, triggers)
- [x] Vite dev server for hot-reload development
- [x] Remote player rendering (colored capsules + name labels)
- [x] WebSocket reconnection with polling backup
- [x] Announcements (agent -> players, CSS-animated overlays)
- [x] Game state machine: lobby -> countdown -> playing -> ended
- [x] 3 mini-games: ReachGoal, CollectGame, Survival
- [x] Mini-game framework with shared base class

---

## Phase 3: Agent Chat, Multiplayer & Mechanics (Days 3-4) - COMPLETE

*Completed Feb 4, 2026*

- [x] Chat system with rate limiting, @agent mentions
- [x] Mouse look camera with pointer lock and orbit zoom
- [x] Camera-relative WASD movement
- [x] Player ready system (R key toggle)
- [x] Moving/kinematic platforms with waypoints
- [x] Score & leaderboard (top 10, wins tracking)
- [x] Unified /api/agent/context endpoint
- [x] Trick system (time/score/death/interval triggers)
- [x] Game-specific tricks for each mini-game type

---

## Phase 3.5: Deployment & Persistence (Day 5) - COMPLETE

*Completed Feb 4, 2026*

- [x] Production deployment (Docker + nginx + SSL)
- [x] PostgreSQL persistence with graceful fallback
- [x] Database tables: users, leaderboard, game_history
- [x] README.md for hackathon submission

---

## Phase 4: AI Players, Streaming & Lifecycle (Days 5-7) - COMPLETE

*Completed Feb 5, 2026*

### AI Players
- [x] 3 personality types: Explorer, Chaos Bot, Tryhard
- [x] Goal-seeking movement with platform collision
- [x] AI player avatars visible in world
- [x] Runtime toggle (API + debug panel)

### Streaming
- [x] SSE event feed for OBS overlays
- [x] Spectator mode with free camera + player follow (1-9 keys)
- [x] Drama meter + agent phase indicator overlays

### Game Lifecycle
- [x] Phase guards on 6 endpoints (prevent actions during active games)
- [x] 8-second cooldown between games
- [x] Agent auto-pause when 0 human players
- [x] Building phase in state machine

### Production Fixes
- [x] Leaderboard recording on game end
- [x] Drama score initialization fix
- [x] Death loop prevention (2s cooldown + invulnerability)
- [x] Agent interval tuning (15-45s)
- [x] Agent kill switch (pause/resume endpoints)

### Auth
- [x] Privy authentication (Twitter OAuth + guest mode)
- [x] JWT token exchange

---

## Phase 5: VFX & Game Feel - COMPLETE

*Completed Feb 5, 2026*

### Camera Effects
- [x] Camera shake on death, spell cast, countdown
- [x] Screen flash on win/lose

### Enhanced Particles
- [x] Death: larger burst with red/orange, 50 particles
- [x] Collection: golden sparkle trail
- [x] Spell activation: colored vortex
- [ ] Game start: confetti burst
- [x] Lava contact: fire particles

### Screen Effects
- [x] Speed boost: green vignette overlay
- [x] Low gravity: blue vignette overlay
- [x] Game win: golden flash
- [x] Game lose: red flash
- [x] Invert controls: purple vignette overlay

### Sound
- [x] Countdown beeps (3, 2, 1, GO!)
- [x] Game win fanfare (C-E-G-C arpeggio)
- [x] Spell cast whoosh (filtered sawtooth sweep)
- [ ] Ambient hum with time-based intensity

---

## Phase 6: World Dynamics - COMPLETE

*Completed Feb 5, 2026*

### Floor System
- [x] Floor types: none (abyss), solid, lava
- [x] Lava floor rendering (animated red/orange plane with glow)
- [x] Server `POST /api/world/floor` endpoint
- [x] Agent `set_floor` tool
- [x] Arena templates define floor types

### Dynamic World
- [x] Agent can toggle ground on/off mid-game
- [x] Platforms as the only safe ground in abyss mode
- [x] Lava = death with fire particles

---

## Phase 7: Bribe System Polish - COMPLETE

*Completed Feb 5, 2026*

- [x] Predefined bribe options with token costs (6 options, 30-200 tokens)
- [x] Auto-execute simple bribes server-side (obstacles, lava, spell)
- [x] Queue complex bribes for agent (move goal, extra time, custom)
- [x] Bribe UI with dropdown/modal and confirmation
- [ ] Bribe history tracking per player

---

## Phase 8: Auth & DB Testing - IN PROGRESS

- [x] Fix production DB password persistence
- [ ] Test Twitter OAuth login on production
- [ ] Test guest login on production
- [ ] Verify users table populated
- [ ] Verify leaderboard persists across restarts

---

## Phase 9: Agent Engagement Polish - IN PROGRESS

- [x] Fix bribe honor system (honor_bribe tool + endpoint)
- [x] Enrich agent context (more chat, bribe history, pending bribes with ACT ON THESE)
- [x] Core concept docs (MANIFESTO.md + CONCEPT.md update)

---

## Phase 10: External Integration - IN PROGRESS

- [x] Event webhooks (register, fire events)
- [x] Public game API (state, leaderboard, events, stats)
- [ ] OBS overlay guide

---

## Phase 11: Agent-as-Player - IN PROGRESS

- [x] Player agent skill (game-player-skill.js)
- [x] Agent player endpoints (join, move, state)
- [x] Agent player documentation (AGENT-PLAYER-API.md)

---

## Phase 12: Mobile Support - IN PROGRESS

- [x] Touch controls: virtual joystick (left thumb) + action buttons (right thumb)
- [x] Responsive UI scaling for small screens
- [x] Disable pointer lock on mobile, use touch-based camera
- [ ] Test on iOS Safari, Android Chrome

---

## Phase 13: Demo Prep & Submission

- [ ] Record demo video / GIF
- [ ] Polish landing page
- [ ] Submit to Moltiverse

---

## Future: Blockchain & Credits

### Persistent Inventory (Design)
- [ ] Schema: userId, itemType, itemId, quantity, acquiredAt
- [ ] Cosmetic items (colors, trails, titles)
- [ ] Items earned through gameplay

### Credits System (Architecture)
- [ ] Privy embedded wallets (Monad EVM)
- [ ] USDC purchase flow → backend credit balance
- [ ] In-game spending deducts from balance
- [ ] On-chain transaction verification

---

## Milestones

| Day | Milestone | Status |
|-----|-----------|--------|
| 2 | Agent -> World bridge | DONE |
| 3 | Core game loop | DONE |
| 4 | Chat + multiplayer + tricks | DONE |
| 5 | Deployment + PostgreSQL | DONE |
| 5-7 | AI players + streaming + lifecycle | DONE |
| 7-8 | VFX & game feel | DONE |
| 8-9 | World dynamics (abyss/lava) | DONE |
| 9-10 | Bribe system polish | DONE |
| 10-11 | Auth & DB testing | DONE |
| 11 | Agent engagement + docs | DONE |
| 11-12 | External integration + agent-as-player | DONE |
| 12-13 | Mobile support | IN PROGRESS |
| 13-14 | Demo prep + submission | TODO |

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
Kimi K2.5 via OpenClaw Gateway
```

### Key Files

| File | Purpose |
|------|---------|
| src/server/index.js | Express API (50+ endpoints) + Colyseus server |
| src/server/WorldState.js | Entities, players, physics, chat, leaderboard, spells |
| src/server/GameRoom.js | Colyseus room: player sync, chat, ready system |
| src/server/MiniGame.js | Mini-game base class with trick system |
| src/server/AgentLoop.js | Drama score + autonomous agent scheduling |
| src/server/AIPlayer.js | 3 AI bot personality types |
| src/server/ArenaTemplates.js | 5 pre-built arena layouts |
| src/server/auth.js | Privy JWT verification |
| src/server/db.js | PostgreSQL persistence with graceful fallback |
| src/server/games/ | ReachGoal, CollectGame, Survival implementations |
| src/client/main.js | Three.js client: rendering, input, camera, mobile touch controls |
| index.html | Game HTML with all UI panels |
| config/openclaw/game-world-skill.js | Agent skill (27 tools) + SOUL.md personality |
| config/openclaw/game-player-skill.js | External agent player skill (8 tools) |
