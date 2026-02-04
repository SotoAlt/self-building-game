# Self-Building Game: Research & Feasibility Report

## Executive Summary

**Verdict: Highly Feasible for Hackathon MVP**

The technical landscape is exceptionally favorable. Key enablers:
- **Claude Agent SDK** has mature multi-session persistence patterns
- **Hyperfy + ElizaOS** provides ready-made multiplayer + AI agent integration
- **Streaming AI games** are proven (Claude Plays Pokémon, Neuro-sama)
- **Multiple hackathons** have validated "game generation from prompts" in 72 hours

---

## 1. Market Research Summary

### Competitive Landscape

| Project | What It Does | Limitations |
|---------|--------------|-------------|
| **Oasis (Decart)** | Fully AI-generated Minecraft-like game | Hallucinations, low resolution, no memory |
| **Claude Plays Pokémon** | AI plays existing game on Twitch | Passive viewing only |
| **AI Dungeon** | AI narrative generation | Text-only, no visual world |
| **Genie 3 (Google)** | AI-generated 3D worlds from prompts | 1-minute memory limit |
| **SEED MMO (Klang)** | Emergent AI NPCs | Not self-building mechanics |

### Gap in Market
**No one is doing: AI that builds the game itself while players play it, with livestream + audience interaction.**

Your concept combines:
- Self-building world (like Genie 3 but persistent)
- Multiplayer gameplay (like SEED MMO)
- Streaming entertainment (like Claude Plays Pokémon)
- Audience participation (like Twitch Plays Pokémon)

This is genuinely novel.

### Engagement Data (from AI streaming research)
- 25-30% higher viewer retention with AI chatbots
- Transparency of AI reasoning works better than crowdsourced chaos
- Multi-modal interactions (visual + commentary) drive engagement

---

## 2. Technical Research Summary

### Claude Agent SDK Capabilities

**Strengths:**
- File ops, code execution, web browsing, custom MCP tools
- Multi-session persistence via filesystem state + git commits
- Sub-agents for parallel work distribution
- 200K token context (1M available for Sonnet)

**Persistence Pattern (Critical for your use case):**
```
Session 1: Initializer agent sets up world structure
Session 2+: Continuous agent reads progress, makes incremental changes, commits
State stored in: filesystem, git, progress files (not in context)
```

**Limitations:**
- No native persistence across sessions (must write to filesystem)
- Context window fills up during long sessions
- Each session must re-read project state

### Game Engine Options

| Engine | Multiplayer | Hot Reload | AI Integration | MVP Speed |
|--------|-------------|------------|----------------|-----------|
| **Hyperfy + ElizaOS** | Built-in (hundreds of users) | Native | Proven (Feb 2025 demo) | Fastest |
| **Three.js + Colyseus** | Custom (well-documented) | Vite 10-20ms | Full control | Medium |
| **PlayCanvas** | Colyseus/Photon | Excellent | Good | Medium |

**Recommendation: Hyperfy for MVP**
- Self-contained multiplayer world with physics
- ElizaOS integration proven at Feb 2025 Hyperfy developer huddle
- Agent connects as world participant, issues commands
- Active community, weekly dev huddles
- Trade-off: API still alpha (may change)

### How AI Agent Would Modify the Game

```
Claude Agent (via SDK)
    ↓ generates game code/assets
    ↓ writes to filesystem
    ↓ commits to git
    ↓
Hyperfy World
    ↓ hot-reloads scripts
    ↓ updates world state
    ↓
Players see changes in real-time
```

---

## 3. Architecture Draft

### Core Components

```
┌─────────────────────────────────────────────────────────────┐
│                    SELF-BUILDING GAME                       │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────┐     ┌─────────────┐     ┌─────────────┐   │
│  │   Claude    │────▶│  Hyperfy    │────▶│   Players   │   │
│  │   Agent     │     │   World     │     │  (Browser)  │   │
│  │   (SDK)     │◀────│  (Server)   │◀────│             │   │
│  └─────────────┘     └─────────────┘     └─────────────┘   │
│        │                   │                    │           │
│        ▼                   ▼                    ▼           │
│  ┌─────────────┐     ┌─────────────┐     ┌─────────────┐   │
│  │  Persistent │     │  Twitch/    │     │  Audience   │   │
│  │  State      │     │  Stream     │     │  Chat       │   │
│  │  (Git/FS)   │     │             │     │  Suggestions│   │
│  └─────────────┘     └─────────────┘     └─────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Persistence Solution (Addressing "context loss on restart")

The "wave agent system context loss" problem is solved by:

1. **Filesystem as truth**: World state, game mechanics, assets all stored in files
2. **Git history**: Every change committed with semantic messages
3. **Progress manifest**: `world-state.json` tracks what exists
4. **Agent context loading**: Each session reads manifest + recent git history
5. **Incremental building**: Agent doesn't try to hold everything in context

```
/game-world/
├── world-state.json      # What exists (entities, mechanics, rules)
├── AGENT-CONTEXT.md      # Instructions for agent to understand world
├── mechanics/
│   ├── physics.js
│   ├── combat.js
│   └── crafting.js
├── entities/
│   ├── player.js
│   ├── npc-01.js
│   └── monster-01.js
├── world/
│   ├── terrain.js
│   └── structures/
└── history/
    └── changes.log       # What agent has done
```

---

## 4. MVP Scope (2-Week Hackathon)

### Clarified Vision
- **Agent = Chaos Magician**: The AI has a visible avatar in the world
- **Genre**: Super simple physics-based mechanics (reach X, collect Y, gravity games)
- **Goal**: Streaming virality - think Fall Guys simplicity, Getting Over It chaos
- **Team**: 2-3 people (can parallelize)
- **AI Players**: Core feature, not stretch goal

### Week 1: Core Loop (Days 1-7)

**Days 1-2: Foundation**
- [ ] Claude Agent SDK project setup
- [ ] Hyperfy world with chaos magician avatar
- [ ] Basic agent → world communication (spawn objects, modify terrain)
- [ ] Persistence layer (world-state.json + git)

**Days 3-4: Physics Sandbox**
- [ ] Agent can modify gravity, friction, bounce
- [ ] Simple objects: platforms, ramps, collectibles
- [ ] Player joins and experiences physics changes
- [ ] Agent "sees" player position/actions

**Days 5-7: Core Game Loop**
- [ ] Agent creates first challenge: "reach the platform"
- [ ] Collectible system (agent spawns, player collects)
- [ ] Agent modifies world based on player success/failure
- [ ] Basic multiplayer (2-3 concurrent players)

### Week 2: AI Players + Streaming (Days 8-14)

**Days 8-10: Multi-Agent Sandbox**
- [ ] Second AI agent joins as player
- [ ] AI players compete/cooperate with humans
- [ ] Agent observes AI player behavior
- [ ] Emergent interactions documented

**Days 11-12: Streaming Setup**
- [ ] OBS/streaming layout (world + agent reasoning + chat)
- [ ] Twitch/YouTube chat → agent suggestions
- [ ] Agent responds to audience ("chat wants more platforms!")
- [ ] Chaos magician personality/voice

**Days 13-14: Polish & Launch**
- [ ] Bug fixes, stability
- [ ] Demo video/trailer
- [ ] Hackathon presentation
- [ ] First public stream

### Stretch Goals (if ahead of schedule)
- [ ] World model integration for procedural assets
- [ ] More AI player personalities
- [ ] Voting system for audience suggestions

---

## 5. Risk Assessment & Decisions

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Hyperfy API breaks | Medium | High | **Fallback: Three.js + Colyseus** (decided) |
| Agent context confusion | High | Medium | Strong progress files + git |
| Multiplayer sync issues | Medium | Medium | Start simple, scale gradually |
| 2-week timeline tight | High | High | Cut features aggressively |

### Key Decisions Made
- **Fallback engine**: Three.js + Colyseus if Hyperfy doesn't work out
- **Agent vision**: Both JSON state + screenshots (JSON for logic, screenshots for streaming commentary)
- **Agent character**: Chaos magician is the builder agent's avatar
- **AI players**: Core feature (not stretch goal)

---

## 6. Technical Implementation Details

### Multi-Agent Sandbox Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                   AGENT ORCHESTRATOR                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────┐     ┌─────────────┐     ┌─────────────┐   │
│  │  BUILDER    │     │  AI PLAYER  │     │  AI PLAYER  │   │
│  │  AGENT      │     │  AGENT #1   │     │  AGENT #2   │   │
│  │  (Magician) │     │  (Explorer) │     │  (Chaotic)  │   │
│  └─────────────┘     └─────────────┘     └─────────────┘   │
│        │                   │                    │           │
│        ▼                   ▼                    ▼           │
│  ┌─────────────────────────────────────────────────────┐   │
│  │               HYPERFY WORLD (WebSocket)              │   │
│  │  - Physics engine (PhysX)                            │   │
│  │  - Entity sync (all agents + human players)          │   │
│  │  - Real-time state broadcast                         │   │
│  └─────────────────────────────────────────────────────┘   │
│                            │                                │
│                            ▼                                │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                 HUMAN PLAYERS                        │   │
│  │            (Browser WebGL clients)                   │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Agent Roles

| Agent | Role | Capabilities |
|-------|------|--------------|
| **Builder (Chaos Magician)** | Creates world, modifies physics | Spawn objects, change gravity, create challenges |
| **AI Player #1 (Explorer)** | Plays the game earnestly | Tries to complete challenges, models "good" player |
| **AI Player #2 (Chaotic)** | Tests edge cases | Breaks things, finds exploits, creates chaos |

### Streaming Integration

```javascript
// Simplified architecture for Twitch integration
const streamPipeline = {
  input: {
    twitchChat: 'wss://irc-ws.chat.twitch.tv',
    suggestionQueue: [], // Chat messages filtered for suggestions
  },
  processing: {
    builderAgent: {
      // Every N seconds, agent reviews suggestions
      pollInterval: 30000,
      promptTemplate: `
        Current world state: {worldState}
        Recent player actions: {playerActions}
        Audience suggestions: {suggestions}

        As the Chaos Magician, choose what to build/modify next.
        Explain your reasoning (this will be shown on stream).
      `
    }
  },
  output: {
    worldChanges: 'hyperfy-websocket',
    reasoningOverlay: 'obs-websocket', // Shows agent thinking
    chatResponse: 'twitch-chat'
  }
};
```

### Persistence Schema

```json
// world-state.json - Source of truth for agent context
{
  "version": "0.1.0",
  "created": "2026-02-04T12:00:00Z",
  "lastModified": "2026-02-04T15:30:00Z",

  "physics": {
    "gravity": -9.8,
    "friction": 0.3,
    "bounce": 0.5
  },

  "entities": [
    {
      "id": "platform-001",
      "type": "platform",
      "position": [0, 5, 0],
      "size": [10, 1, 10],
      "created": "2026-02-04T12:05:00Z",
      "createdBy": "builder-agent"
    }
  ],

  "challenges": [
    {
      "id": "challenge-001",
      "type": "reach",
      "target": "platform-001",
      "completed": false,
      "attempts": 12,
      "successes": 3
    }
  ],

  "history": [
    {
      "timestamp": "2026-02-04T15:00:00Z",
      "action": "modify_gravity",
      "params": { "gravity": -4.9 },
      "reason": "Players struggling, reducing difficulty"
    }
  ]
}
```

---

## 7. Team Work Distribution (2-3 people)

### Recommended Split

| Person | Focus | Deliverables |
|--------|-------|--------------|
| **Lead** | Agent + Architecture | Claude SDK setup, persistence, agent prompts |
| **Game Dev** | Hyperfy + Physics | World setup, player controls, multiplayer sync |
| **Streamer/UX** | Streaming + Chat | OBS layout, Twitch integration, audience system |

### If only 2 people:
- Lead handles Agent + Streaming
- Game Dev handles Hyperfy + basic multiplayer
- Cut scope on fancy OBS overlays (use simple split screen)

---

## 8. Tech Stack Summary

| Layer | Technology | Why |
|-------|------------|-----|
| **Builder Agent** | Claude Agent SDK (Python/TS) | Multi-session persistence, tool use |
| **AI Players** | Claude API (lighter model) | Cheaper for multiple concurrent agents |
| **Game World** | Hyperfy | Built-in multiplayer, physics, hot reload |
| **Persistence** | Git + JSON files | Simple, versioned, agent-readable |
| **Streaming** | OBS + Twitch API | Industry standard, good chat integration |
| **Chat Parsing** | Simple keyword filter | "build", "add", "more", "less" → suggestions |

---

## 9. Validation Checkpoints

### Day 3: Can agent modify world?
- [ ] Agent spawns a cube in Hyperfy
- [ ] Cube appears for human player
- [ ] Agent can delete/move the cube

### Day 7: Core loop works?
- [ ] Challenge exists (reach platform)
- [ ] Player can complete challenge
- [ ] Agent responds to success/failure

### Day 10: Multi-agent works?
- [ ] AI player joins world
- [ ] AI player attempts challenges
- [ ] Builder agent observes AI player

### Day 14: Stream ready?
- [ ] 30-minute stable session
- [ ] Chat suggestions reach agent
- [ ] Audience sees agent reasoning

---

## 10. Immediate Next Steps

1. **Set up Hyperfy locally** - Clone repo, run dev server, understand scripting
2. **Claude Agent SDK hello world** - Basic agent that writes files
3. **Bridge proof-of-concept** - Agent sends command → Hyperfy spawns object
4. **Define chaos magician persona** - Prompts, personality, visual design

---

## 11. Agent Vision System (Dual Mode)

```
┌─────────────────────────────────────────────────────────────┐
│                    AGENT PERCEPTION                         │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  JSON State (Logic Layer)         Screenshots (Commentary)  │
│  ├── Entity positions             ├── Capture every 5-10s   │
│  ├── Player actions               ├── Claude vision model   │
│  ├── Challenge status             ├── "What's happening?"   │
│  ├── Physics parameters           ├── Generate entertaining │
│  └── Fast, reliable               │   commentary for stream │
│                                   └── Slower, expensive     │
│                                                             │
│  COMBINED PROMPT:                                           │
│  "World state: {json}                                       │
│   Current view: {screenshot}                                │
│   Audience says: {chat_suggestions}                         │
│   What should the Chaos Magician do next?"                  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Why both?**
- JSON: Fast decisions, accurate entity tracking, reliable
- Screenshots: Natural commentary ("Look at that player falling!"), streaming personality
- Combined: Agent can make smart decisions AND entertaining commentary

---

## Open Questions (To Decide During Build)

1. What streaming platform? (Twitch vs YouTube - affects chat integration)
2. What's the chaos magician's visual design?
3. Name for the project?
4. Voice for the chaos magician? (TTS or just text overlay?)
