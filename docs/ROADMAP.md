# Development Roadmap

## Overview

2-week sprint to hackathon demo. Team of 2-3 people working in parallel.

---

## Phase 1: Foundation (Days 1-3)

### Goal
Prove the core technology works: Agent can modify a 3D world that players see.

### Day 1: Setup & Spike

**All Hands**
- [ ] Clone Hyperfy repo, run locally
- [ ] Clone eliza-3d-hyperfy-starter, understand structure
- [ ] Set up Claude Agent SDK project
- [ ] Create project Discord/Slack for coordination

**Deliverable**: Everyone has dev environment working

### Day 2: Agent → World Bridge

**Lead (Agent Dev)**
- [ ] Claude Agent SDK "hello world" - agent that writes files
- [ ] Define action schema: `{ action, type, params }`
- [ ] Agent reads/writes world-state.json

**Game Dev**
- [ ] Hyperfy world with basic terrain
- [ ] Spawn a cube via code (not editor)
- [ ] WebSocket listener for external commands

**Deliverable**: Agent writes JSON → Game reads it → Object appears

### Day 3: Validation Checkpoint #1

**Integration Test**
- [ ] Agent spawns a platform
- [ ] Platform appears in Hyperfy world
- [ ] Human player joins, sees platform
- [ ] Agent can move/delete platform

**Decision Point**: Does Hyperfy work for our use case?
- If yes: Continue with Hyperfy
- If no (physics too limited): Switch to Three.js + Colyseus

---

## Phase 2: Core Loop (Days 4-7)

### Goal
Working game loop: Agent builds → Player plays → Agent adapts

### Day 4: Physics Sandbox

**Game Dev**
- [ ] Multiple object types (platforms, ramps, collectibles)
- [ ] Player movement & jumping
- [ ] Object properties (size, position, rotation)
- [ ] If Hyperfy: kinematic body animations
- [ ] If Three.js: proper physics engine setup

**Lead**
- [ ] Agent decision loop (every 10-30 seconds)
- [ ] World state reading
- [ ] Action execution pipeline

### Day 5: Player Tracking

**Game Dev**
- [ ] Player position broadcast
- [ ] Collision detection with objects
- [ ] Collectible pickup system

**Lead**
- [ ] Agent receives player position data
- [ ] Agent tracks player success/failure
- [ ] Basic adaptation logic (if player struggling, help)

### Day 6: Challenge System

**Lead**
- [ ] Challenge schema: type, target, completion criteria
- [ ] Challenge creation: "reach platform-001"
- [ ] Challenge tracking: attempts, successes

**Game Dev**
- [ ] Visual indicators for challenge targets
- [ ] Success/failure feedback
- [ ] Multiplayer: both players see same challenges

### Day 7: Validation Checkpoint #2

**Integration Test**
- [ ] Agent creates challenge: "reach the platform"
- [ ] Player attempts challenge
- [ ] Challenge completion detected
- [ ] Agent responds (creates new challenge or modifies difficulty)
- [ ] 2-3 players simultaneously

**Demo**: Core loop working, show to team

---

## Phase 3: Multi-Agent (Days 8-10)

### Goal
AI players join the world and play alongside humans.

### Day 8: AI Player Architecture

**Lead**
- [ ] Player agent prompts (Explorer, Chaotic personalities)
- [ ] Player agent action space (move, jump, interact)
- [ ] Connect player agents to world state

**Game Dev**
- [ ] AI player avatars in world
- [ ] AI player movement commands
- [ ] AI players visible to humans

### Day 9: Agent Interactions

**Lead**
- [ ] Explorer agent tries to complete challenges
- [ ] Chaotic agent tests edge cases
- [ ] Builder agent observes AI player behavior

**Game Dev**
- [ ] AI player position sync
- [ ] AI player collision with objects
- [ ] Visual differentiation (human vs AI)

### Day 10: Validation Checkpoint #3

**Integration Test**
- [ ] 2 human players + 2 AI players in world
- [ ] AI players attempt challenges
- [ ] Builder agent creates new challenges
- [ ] Emergent interactions observed
- [ ] 10-minute stable session

---

## Phase 4: Streaming (Days 11-12)

### Goal
Stream-ready: OBS layout, chat integration, agent commentary.

### Day 11: OBS Setup

**Streamer/UX (or Lead if 2-person team)**
- [ ] OBS scene with game capture
- [ ] Split layout: game + agent reasoning + chat
- [ ] Test stream to unlisted channel
- [ ] Chaos magician avatar overlay

**Lead**
- [ ] Agent commentary output (text for overlay)
- [ ] Screenshot capture for agent vision
- [ ] Combined prompt with vision + JSON

### Day 12: Chat Integration

**Streamer/UX**
- [ ] Twitch chat bot setup
- [ ] Message filtering (suggestions only)
- [ ] Chat → Agent pipeline

**Lead**
- [ ] Agent receives suggestions
- [ ] Agent incorporates suggestions into decisions
- [ ] Agent acknowledges suggestions on stream

---

## Phase 5: Polish (Days 13-14)

### Goal
Hackathon-ready: Stable, demonstrable, presentable.

### Day 13: Bug Bash

**All Hands**
- [ ] Fix critical bugs from testing
- [ ] Stability improvements
- [ ] Edge case handling
- [ ] Performance optimization

### Day 14: Demo Prep

**All Hands**
- [ ] 30-minute stability test
- [ ] Demo video recording (backup)
- [ ] Presentation slides
- [ ] First public stream (if ready)

---

## Milestones Summary

| Day | Milestone | Success Criteria |
|-----|-----------|------------------|
| 3 | Agent → World | Agent spawns object, player sees it |
| 7 | Core Loop | Challenge creation & completion working |
| 10 | Multi-Agent | Human + AI players together |
| 12 | Stream Ready | OBS + chat integration working |
| 14 | Demo Ready | 30-min stable session |

---

## Risk Checkpoints

### Day 3: Technology Decision
If Hyperfy physics too limited:
- Switch to Three.js + Colyseus
- Adds ~2 days to timeline
- Cut streaming features if needed

### Day 7: Scope Check
If behind schedule:
- Cut AI player agents to stretch goal
- Focus on builder agent + human players
- Simplify streaming to screen capture only

### Day 10: Feature Freeze
- No new features after Day 10
- Focus on stability and polish
- Anything not working gets cut

---

## Team Allocation

### If 3 People

| Role | Person | Focus |
|------|--------|-------|
| Lead | Person A | Agent SDK, prompts, orchestration |
| Game Dev | Person B | Hyperfy/Three.js, multiplayer |
| Streamer | Person C | OBS, chat, presentation |

### If 2 People

| Role | Person | Focus |
|------|--------|-------|
| Lead | Person A | Agent SDK, orchestration, streaming |
| Game Dev | Person B | Hyperfy/Three.js, multiplayer |

---

## Daily Standup Format

Quick async update (Discord/Slack):
1. What I did yesterday
2. What I'm doing today
3. Blockers

Sync call: 15 min at end of day if needed.
