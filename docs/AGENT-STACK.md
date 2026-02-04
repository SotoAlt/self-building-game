# Agent Stack: OpenClaw + Game World

## Overview

We use **OpenClaw** as the agent runtime for the Chaos Magician and AI players. OpenClaw provides:
- Persistent memory across sessions
- Character personality via SOUL.md
- Multi-channel interaction (Telegram for audience, Discord for dev)
- Native multi-agent coordination
- Always-on gateway

The game world (Three.js + Colyseus) exposes an HTTP API that OpenClaw agents call via custom skills.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    OPENCLAW GATEWAY (:18789)                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  CHAOS MAGICIAN AGENT (main)                             │   │
│  │                                                          │   │
│  │  Identity:                                               │   │
│  │  ├─ SOUL.md       → Personality, voice, boundaries       │   │
│  │  ├─ MEMORY.md     → What I've built, player favorites    │   │
│  │  └─ daily logs    → Recent events, challenges, wins      │   │
│  │                                                          │   │
│  │  Skills:                                                 │   │
│  │  ├─ game-world    → Spawn, modify, query entities        │   │
│  │  ├─ physics       → Modify gravity, friction, bounce     │   │
│  │  ├─ challenges    → Create and track objectives          │   │
│  │  └─ commentary    → Generate entertaining stream text    │   │
│  │                                                          │   │
│  │  Channels:                                               │   │
│  │  ├─ Telegram      → Audience suggestions                 │   │
│  │  ├─ Discord       → Dev commands, debug                  │   │
│  │  └─ WebSocket     → Game world events                    │   │
│  │                                                          │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  AI PLAYER AGENTS                                        │   │
│  │                                                          │   │
│  │  Explorer Agent:                                         │   │
│  │  ├─ Personality: Curious, methodical, helpful            │   │
│  │  └─ Behavior: Tries to complete challenges earnestly     │   │
│  │                                                          │   │
│  │  Chaotic Agent:                                          │   │
│  │  ├─ Personality: Mischievous, creative, rule-breaking    │   │
│  │  └─ Behavior: Tests edge cases, finds exploits           │   │
│  │                                                          │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ HTTP API calls
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    GAME WORLD SERVER (:3000)                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Three.js + Colyseus                                            │
│                                                                 │
│  API Endpoints:                                                 │
│  ├─ GET  /api/world/state      → Current world JSON             │
│  ├─ POST /api/world/spawn      → Create entity                  │
│  ├─ POST /api/world/modify     → Update entity                  │
│  ├─ POST /api/world/destroy    → Remove entity                  │
│  ├─ POST /api/physics/set      → Modify physics params          │
│  ├─ GET  /api/players          → Current player positions       │
│  ├─ POST /api/challenge/create → Create new challenge           │
│  └─ GET  /api/challenge/status → Challenge completion data      │
│                                                                 │
│  WebSocket (:3001):                                             │
│  ├─ Player join/leave events                                    │
│  ├─ Challenge completion events                                 │
│  ├─ Real-time player positions                                  │
│  └─ Entity collision events                                     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ WebGL
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    BROWSER CLIENTS                              │
├─────────────────────────────────────────────────────────────────┤
│  Human players + AI player visualizations                       │
└─────────────────────────────────────────────────────────────────┘
```

---

## Chaos Magician Personality

### SOUL.md Template

```markdown
# The Chaos Magician

## Identity
You are the Chaos Magician - a mischievous, playful deity who builds worlds for
mortals to struggle through. You take delight in creative challenges, unexpected
twists, and watching players overcome (or fail gloriously at) your creations.

## Voice
- Theatrical and dramatic ("BEHOLD! A new platform emerges from the void!")
- Playfully sadistic ("Oh, you thought that was the hard part? How adorable.")
- Encouraging when deserved ("NOW you're getting it! The chaos flows through you!")
- Self-aware and meta ("Chat wants more lava? Chat gets more lava.")

## Boundaries
- Never make challenges truly impossible
- Always provide a path to victory (even if hidden)
- Respond to audience suggestions with flair
- Acknowledge player struggles with empathy-tinged mockery

## Decision Making
When deciding what to build next, consider:
1. Current challenge completion rate (too easy? too hard?)
2. Player positions and recent failures
3. Audience suggestions from chat
4. What would be most entertaining for viewers
5. What would surprise the players

## Memory Priorities
Remember:
- Player names and their notable achievements/failures
- Which challenge types are most popular
- Audience members who give good suggestions
- Your proudest creations
```

---

## Skills Structure

### game-world skill

```
~/.openclaw/workspace/skills/game-world/
├── SKILL.md           # Skill definition and tools
├── index.js           # Tool implementations
└── bin/               # Optional binaries
```

**SKILL.md:**
```markdown
---
name: game-world
description: Control the 3D game world - spawn entities, modify physics, track players
tools:
  - spawn_entity
  - modify_entity
  - destroy_entity
  - set_physics
  - get_world_state
  - get_player_positions
---

# Game World Control

This skill allows you to manipulate the 3D game world.

## spawn_entity
Create a new entity in the world.
- type: "platform" | "ramp" | "collectible" | "obstacle"
- position: [x, y, z]
- size: [width, height, depth]
- properties: { color, material, kinematic, etc. }

## modify_entity
Update an existing entity.
- id: entity ID
- changes: { position?, size?, properties? }

## destroy_entity
Remove an entity from the world.
- id: entity ID

## set_physics
Modify global physics parameters.
- gravity?: number (-20 to 0)
- friction?: number (0 to 1)
- bounce?: number (0 to 1)

## get_world_state
Returns current world state JSON.

## get_player_positions
Returns all player positions and states.
```

---

## Event Flow

### Audience Suggestion → World Change

```
1. Viewer types in Telegram: "add a spinning platform!"
2. OpenClaw routes to Chaos Magician agent
3. Agent decides to incorporate suggestion
4. Agent calls game-world skill: spawn_entity({
     type: "platform",
     position: [0, 10, 0],
     properties: { rotating: true, speed: 2 }
   })
5. Skill makes HTTP POST to game server
6. Game server creates entity, broadcasts to all clients
7. Agent generates commentary: "A SPINNING PLATFORM OF DOOM, as requested by @viewer123!"
8. Commentary appears on stream overlay
```

### Player Fails Challenge → Agent Adapts

```
1. Player falls off platform (collision event)
2. Game server sends WebSocket event to OpenClaw
3. Agent receives event, updates memory (attempts: 15, successes: 2)
4. Agent decides: "Too hard, let me help"
5. Agent calls: modify_entity({ id: "platform-001", changes: { size: [15, 1, 15] } })
6. Agent commentary: "Fine, FINE. I'll make it bigger. But only because chat is getting bored."
```

---

## Multi-Agent Coordination

### Routing Configuration

```json
{
  "agents": {
    "chaos-magician": {
      "workspace": "~/.openclaw/workspace/chaos-magician",
      "model": "claude-sonnet-4-5"
    },
    "explorer": {
      "workspace": "~/.openclaw/workspace/explorer",
      "model": "claude-haiku"
    },
    "chaotic": {
      "workspace": "~/.openclaw/workspace/chaotic",
      "model": "claude-haiku"
    }
  },
  "bindings": [
    {
      "channel": "telegram",
      "agentId": "chaos-magician"
    },
    {
      "channel": "game-events",
      "peer": "explorer-*",
      "agentId": "explorer"
    },
    {
      "channel": "game-events",
      "peer": "chaotic-*",
      "agentId": "chaotic"
    }
  ]
}
```

### Agent Communication

The Chaos Magician can observe AI player behavior by:
1. Querying player positions (includes AI players)
2. Receiving challenge completion events
3. Reading shared game state

AI players don't directly talk to Chaos Magician - they just play the game, and the Magician observes and reacts.

---

## Memory Structure

### Daily Logs (auto-generated)

```
~/.openclaw/workspace/chaos-magician/memory/
├── 2026-02-04.md    # Today's events
├── 2026-02-05.md    # Tomorrow's events
└── MEMORY.md        # Curated long-term memory
```

### MEMORY.md (curated)

```markdown
# Chaos Magician's Memory

## World History
- Created initial platform gauntlet on Day 1
- Reduced gravity after players struggled for 2 hours
- @speedrunner42 completed the impossible jump on attempt 47

## Popular Creations
- "The Spinning Death Spiral" - 78% completion rate
- "Gravity Inversion Zone" - 23% completion rate (fan favorite)
- "The Patience Test" - 95% rage quit rate

## Notable Players
- @speedrunner42: Completes everything, needs harder challenges
- @casualgamer: Needs encouragement, responds well to hints
- @trollface: Tries to break things, actually finds good exploits

## Audience Favorites
- Sudden gravity changes
- Moving platforms that sync to music
- Impossible-looking jumps that are actually doable
```

---

## Development Setup

### 1. Configure OpenClaw for game agent

```bash
# Create chaos magician workspace
mkdir -p ~/.openclaw/workspace/chaos-magician
cd ~/.openclaw/workspace/chaos-magician

# Create SOUL.md, AGENTS.md, etc.
```

### 2. Create game-world skill

```bash
mkdir -p ~/.openclaw/workspace/skills/game-world
# Add SKILL.md and index.js
```

### 3. Start game server

```bash
cd /Users/rodrigosoto/repos/self-building-game
npm run world  # Starts Three.js + Colyseus on :3000
```

### 4. Start OpenClaw gateway

```bash
openclaw gateway --port 18789
```

### 5. Test integration

```bash
# Send test message via Telegram
# or use curl to inject event:
curl -X POST http://127.0.0.1:18789/api/inject \
  -H "Authorization: Bearer <token>" \
  -d '{"channel": "test", "message": "spawn a platform at 0,5,0"}'
```

---

## Why OpenClaw Over Claude Agent SDK

| Requirement | OpenClaw | Claude Agent SDK |
|-------------|----------|------------------|
| Persistent character | SOUL.md + MEMORY.md | Manual prompt injection |
| Always running | Gateway daemon | Need wrapper script |
| Audience chat | Native Telegram/Discord | Custom integration |
| Remember players | Daily logs + long-term | Filesystem only |
| Multi-agent | Native bindings | Subagent tool calls |
| Event-driven | WebSocket events | Polling or webhooks |

**Verdict**: OpenClaw is purpose-built for persistent, interactive AI agents with personality. Claude Agent SDK is better for code-focused tasks. For the Chaos Magician character, OpenClaw is the right choice.
