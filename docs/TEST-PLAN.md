# Step-by-Step Test Plan

This document outlines how to incrementally test core functionalities, validating each layer before moving to the next.

---

## Phase 0: Environment Setup (Day 1)

### Test 0.1: OpenClaw Gateway Running
```bash
# Check if gateway is running
curl http://127.0.0.1:18789/health

# Expected: {"status": "ok"}
```

### Test 0.2: Chaos Magician Workspace Exists
```bash
ls -la ~/.openclaw/workspace/chaos-magician/

# Expected: SOUL.md, AGENTS.md, memory/
```

### Test 0.3: Game World Skill Exists
```bash
ls -la ~/.openclaw/workspace/skills/game-world/

# Expected: SKILL.md, index.js
```

**Checkpoint**: OpenClaw configured with Chaos Magician agent and game-world skill.

---

## Phase 1: Game Server Foundation (Day 2)

### Test 1.1: Game Server Starts
```bash
cd /Users/rodrigosoto/repos/self-building-game
npm run world

# Expected: Server listening on http://localhost:3000
```

### Test 1.2: World State Endpoint
```bash
curl http://localhost:3000/api/world/state

# Expected:
{
  "physics": { "gravity": -9.8, "friction": 0.3, "bounce": 0.5 },
  "entities": [],
  "statistics": { "totalEntities": 0, "playersOnline": 0 }
}
```

### Test 1.3: Spawn Endpoint (Manual)
```bash
curl -X POST http://localhost:3000/api/world/spawn \
  -H "Content-Type: application/json" \
  -d '{"type": "platform", "position": [0, 5, 0], "size": [10, 1, 10]}'

# Expected: { "id": "platform-xxx", "success": true }
```

### Test 1.4: Entity Appears in State
```bash
curl http://localhost:3000/api/world/state

# Expected: entities array now has 1 item
```

**Checkpoint**: Game server responds to API calls and maintains state.

---

## Phase 2: OpenClaw → Game Server (Day 3)

### Test 2.1: Skill Loads in OpenClaw
```bash
# Send test message to Chaos Magician via Telegram or inject
# Ask: "What tools do you have?"

# Expected: Agent lists game-world tools
```

### Test 2.2: Agent Queries World State
```bash
# Ask agent: "What's the current state of the world?"

# Expected: Agent calls get_world_state and reports back
```

### Test 2.3: Agent Spawns Entity
```bash
# Ask agent: "Create a platform at position 0, 5, 0"

# Expected:
# 1. Agent calls spawn_entity
# 2. Entity appears in game server
# 3. Agent confirms with commentary
```

### Test 2.4: Agent Modifies Entity
```bash
# Ask agent: "Make that platform bigger"

# Expected: Agent calls modify_entity, platform size changes
```

**Checkpoint**: OpenClaw agent can control game world via skills.

---

## Phase 3: Browser Client (Day 4-5)

### Test 3.1: Client Connects
```bash
# Open http://localhost:3000 in browser

# Expected: 3D scene loads, camera controls work
```

### Test 3.2: Client Sees Entities
```bash
# Spawn entity via API, check browser

# Expected: Entity appears in 3D scene
```

### Test 3.3: Player Movement
```bash
# Use WASD/arrow keys in browser

# Expected: Player avatar moves in 3D space
```

### Test 3.4: Player Position Reported
```bash
curl http://localhost:3000/api/players

# Expected: Player position matches where you moved in browser
```

**Checkpoint**: Players can join and move in the world.

---

## Phase 4: Real-Time Sync (Day 5-6)

### Test 4.1: Agent Spawn → Client Update
```bash
# 1. Have browser open
# 2. Tell agent to spawn platform
# 3. Watch browser

# Expected: Platform appears without page refresh
```

### Test 4.2: Physics Changes
```bash
# Tell agent: "Set gravity to -4"
# Jump in browser client

# Expected: Player falls slower
```

### Test 4.3: Multiple Clients
```bash
# Open 2 browser tabs
# Both should see same world state
# Player positions sync between tabs
```

**Checkpoint**: Changes propagate in real-time to all clients.

---

## Phase 5: Challenge System (Day 6-7)

### Test 5.1: Create Challenge
```bash
# Tell agent: "Create a challenge to reach the platform"

# Expected: Challenge created, visible to players
```

### Test 5.2: Complete Challenge
```bash
# Move player to touch the target platform

# Expected:
# 1. Challenge marked complete
# 2. Agent notified
# 3. Statistics updated
```

### Test 5.3: Agent Adapts
```bash
# Complete challenge multiple times
# Check if agent modifies difficulty or creates new challenge
```

**Checkpoint**: Core game loop works: Agent builds → Player plays → Agent adapts.

---

## Phase 6: AI Players (Day 8-9)

### Test 6.1: AI Player Connects
```bash
# Start Explorer agent
# Check /api/players

# Expected: AI player appears in player list
```

### Test 6.2: AI Player Moves
```bash
# Watch AI player in browser
# Should attempt to navigate toward challenges
```

### Test 6.3: Builder Observes AI
```bash
# Ask Chaos Magician: "What are the AI players doing?"

# Expected: Agent reports on AI player positions and actions
```

**Checkpoint**: Multiple AI agents can participate in the world.

---

## Phase 7: Streaming Integration (Day 10-11)

### Test 7.1: Agent Commentary Output
```bash
# Monitor agent output stream
# Should produce entertaining commentary with each action
```

### Test 7.2: Chat → Agent
```bash
# Send Telegram message: "add a spinning platform"

# Expected: Agent acknowledges and creates spinning platform
```

### Test 7.3: OBS Integration
```bash
# Set up OBS scene with:
# - Game world capture
# - Agent commentary text overlay
# - Chat overlay

# Test: Changes appear on all layers
```

**Checkpoint**: Stream-ready with visible agent reasoning.

---

## Phase 8: Stability (Day 12-14)

### Test 8.1: 30-Minute Session
```bash
# Run full system for 30 minutes
# - Agent continuously building
# - Players joining/leaving
# - Chat suggestions flowing

# Monitor for crashes, memory leaks, state corruption
```

### Test 8.2: Agent Restart
```bash
# Kill and restart OpenClaw gateway
# Agent should resume with memory intact
```

### Test 8.3: Game Server Restart
```bash
# Kill and restart game server
# World state should restore from persistence
```

**Checkpoint**: System stable for demo.

---

## Test Commands Cheatsheet

```bash
# Check OpenClaw health
curl http://127.0.0.1:18789/health

# Check game server health
curl http://localhost:3000/api/health

# Get world state
curl http://localhost:3000/api/world/state

# Spawn platform manually
curl -X POST http://localhost:3000/api/world/spawn \
  -H "Content-Type: application/json" \
  -d '{"type": "platform", "position": [0, 5, 0], "size": [10, 1, 10]}'

# Set physics
curl -X POST http://localhost:3000/api/physics/set \
  -H "Content-Type: application/json" \
  -d '{"gravity": -4.9}'

# Get players
curl http://localhost:3000/api/players

# View OpenClaw logs
tail -f ~/.openclaw/logs/gateway.log
```

---

## Failure Modes to Test

| Scenario | Expected Behavior |
|----------|-------------------|
| Game server down | Skill returns error, agent acknowledges |
| Invalid spawn params | Skill validates, returns helpful error |
| Agent context overflow | Session saves, new session loads memory |
| Browser disconnect | Player removed from list, others unaffected |
| Rapid commands | Rate limiting prevents spam |

---

## Success Criteria

**MVP Complete When:**
- [ ] Agent spawns entities visible to players
- [ ] Players can complete challenges
- [ ] Agent adapts based on player behavior
- [ ] AI players participate in world
- [ ] Chat suggestions reach agent
- [ ] 30-minute stable session achieved
