# Technical Concept: Self-Building Game

## Core Idea

An AI agent (Claude) acts as both **game designer** and **character** in a multiplayer 3D world. The agent:

1. **Builds** the world: spawns objects, creates terrain, designs challenges
2. **Modifies** mechanics: adjusts physics, difficulty, rules
3. **Observes** players: tracks success/failure, adapts accordingly
4. **Entertains**: provides commentary, responds to audience

This creates a feedback loop where the game evolves based on player behavior.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    SYSTEM ARCHITECTURE                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌───────────────────────────────────────────────────────┐     │
│  │              AGENT ORCHESTRATOR (Node.js)              │     │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐  │     │
│  │  │ Builder │  │ Player  │  │ Player  │  │  Chat   │  │     │
│  │  │ Agent   │  │ Agent 1 │  │ Agent 2 │  │ Parser  │  │     │
│  │  │(Magician)│  │(Explorer)│  │(Chaotic)│  │         │  │     │
│  │  └────┬────┘  └────┬────┘  └────┬────┘  └────┬────┘  │     │
│  │       │            │            │            │        │     │
│  │       └────────────┴────────────┴────────────┘        │     │
│  │                         │                              │     │
│  └─────────────────────────┼──────────────────────────────┘     │
│                            │                                    │
│                            ▼                                    │
│  ┌───────────────────────────────────────────────────────┐     │
│  │                  GAME WORLD                            │     │
│  │                                                        │     │
│  │  Option A: Hyperfy          Option B: Three.js+Colyseus│     │
│  │  ├─ React-based            ├─ Custom WebSocket server  │     │
│  │  ├─ Built-in multiplayer   ├─ Full physics control     │     │
│  │  ├─ ElizaOS integration    ├─ More work, more flexible │     │
│  │  └─ No dynamic physics     └─ Proven stable            │     │
│  │                                                        │     │
│  └───────────────────────────────────────────────────────┘     │
│                            │                                    │
│                            ▼                                    │
│  ┌───────────────────────────────────────────────────────┐     │
│  │                    CLIENTS                             │     │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐  │     │
│  │  │ Human   │  │ Human   │  │ Stream  │  │ Twitch  │  │     │
│  │  │ Player  │  │ Player  │  │ Viewer  │  │  Chat   │  │     │
│  │  │(Browser)│  │(Browser)│  │  (OBS)  │  │         │  │     │
│  │  └─────────┘  └─────────┘  └─────────┘  └─────────┘  │     │
│  │                                                        │     │
│  └───────────────────────────────────────────────────────┘     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Agent Design

### Builder Agent: The Chaos Magician

**Role**: Creates and modifies the game world

**Personality**:
- Mischievous, playful, slightly chaotic
- Takes joy in player struggles (but helps eventually)
- Responds to audience suggestions with flair
- Has a visible avatar in the world

**Capabilities**:
- Spawn objects: `{ action: "spawn", type: "platform", position: [0, 5, 0] }`
- Modify physics: `{ action: "set_physics", gravity: -4.9 }`
- Create challenge: `{ action: "challenge", type: "reach", target: "platform-001" }`
- Commentary: `{ action: "speak", text: "Let's see you make THIS jump!" }`

**Decision Loop**:
```
Every 10-30 seconds:
1. Read world state (JSON)
2. Capture screenshot (for commentary)
3. Review player positions/actions
4. Check audience suggestions
5. Decide: build, modify, or observe?
6. Execute action
7. Generate entertaining commentary
8. Repeat
```

### Player Agents

**Explorer Agent**:
- Plays earnestly, tries to complete challenges
- Models "good" player behavior
- Provides baseline for difficulty calibration

**Chaotic Agent**:
- Tests edge cases, breaks things
- Finds exploits and weird physics interactions
- Creates entertaining moments

---

## Persistence Model

### Why It Matters
Claude's context window is finite. The agent can't hold the entire game history in memory. We need external persistence that the agent can query and update.

### Solution: Filesystem + Git

```
/game-world/
├── world-state.json          # Current state (source of truth)
├── AGENT-CONTEXT.md          # High-level summary for agent
├── entities/
│   ├── platform-001.json     # Individual entity data
│   ├── collectible-001.json
│   └── ...
├── challenges/
│   ├── active.json           # Current challenges
│   └── history.json          # Completed challenges
├── mechanics/
│   ├── physics.json          # Physics parameters
│   └── rules.json            # Game rules
└── logs/
    └── agent-actions.jsonl   # Append-only action log
```

### World State Schema

```json
{
  "version": "0.1.0",
  "timestamp": "2026-02-04T15:30:00Z",

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
      "material": "default",
      "kinematic": true
    }
  ],

  "challenges": {
    "active": [
      {
        "id": "challenge-001",
        "type": "reach",
        "target": "platform-001",
        "attempts": 12,
        "successes": 3
      }
    ]
  },

  "players": {
    "human": ["player-001", "player-002"],
    "ai": ["explorer-001", "chaotic-001"]
  },

  "statistics": {
    "totalChallengesCreated": 5,
    "averageCompletionRate": 0.25,
    "mostPopularChallengeType": "reach"
  }
}
```

### Agent Context Loading

Each agent session starts by:
1. Reading `AGENT-CONTEXT.md` (high-level summary)
2. Reading `world-state.json` (current state)
3. Checking recent entries in `logs/agent-actions.jsonl`
4. Understanding what exists and what was recently done

---

## Vision System

### Dual-Mode Perception

The agent sees the world two ways:

**1. JSON State (Logic Layer)**
- Fast, reliable, structured
- Entity positions, player actions, challenge status
- Used for decision-making

**2. Screenshots (Commentary Layer)**
- Captured every 5-10 seconds
- Processed by Claude vision model
- Used for entertaining commentary ("Look at that player falling!")

### Combined Prompt

```
World State: {json_state}
Current View: {screenshot_base64}
Recent Actions: {last_5_actions}
Audience Suggestions: {filtered_chat_messages}

As the Chaos Magician, decide what to do next.
Consider:
- Current challenge completion rate
- Player positions and struggles
- What would be entertaining for viewers
- Audience suggestions

Output:
1. Your decision (build/modify/observe/challenge)
2. The specific action to take
3. Commentary to display on stream
```

---

## Multiplayer Sync

### Hyperfy Approach (If Used)
- Flux/Redux-style action dispatch
- Actions propagate to all clients
- Each client applies actions deterministically
- Built-in, no custom networking needed

### Three.js + Colyseus Approach (Fallback)
- Colyseus handles room state
- Server authoritative for physics
- Clients render interpolated state
- More control, more work

### Agent Integration
- Agent connects as a special client
- Has write permissions that players don't
- Actions validated before broadcast
- Rate limited to prevent spam

---

## Streaming Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Game      │     │    OBS      │     │  Twitch/    │
│   World     │────▶│  Composite  │────▶│  YouTube    │
│             │     │             │     │             │
└─────────────┘     └─────────────┘     └─────────────┘
                          │
                          │ Layout:
                          │ ┌─────────────────────┐
                          │ │  Game World (main)  │
                          │ ├──────────┬──────────┤
                          │ │  Agent   │  Chat    │
                          │ │ Reasoning│ Overlay  │
                          │ └──────────┴──────────┘
                          │
┌─────────────┐           │
│  Agent      │───────────┘ (reasoning text)
│  Output     │
└─────────────┘

┌─────────────┐
│  Twitch     │───────────▶ Agent (suggestions)
│   Chat      │
└─────────────┘
```

---

## Risk Mitigation

### If Hyperfy Doesn't Work
Switch to Three.js + Colyseus:
- More stable, proven stack
- Requires custom networking code
- Full physics control (can do gravity)
- Already identified as fallback

### If Agent Gets Confused
- Strong progress files prevent hallucinated completions
- Git history enables rollback
- AGENT-CONTEXT.md provides grounding
- Rate limiting prevents runaway actions

### If Multi-Agent Conflicts
- Builder agent has priority
- Player agents read-only on world state
- Action queue with priority ordering
- Conflict resolution in orchestrator

---

## Key Technical Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Agent Framework | Claude Agent SDK | Multi-session persistence, tool use |
| Primary Game Engine | Hyperfy (with fallback) | Fastest to MVP if physics sufficient |
| Fallback Engine | Three.js + Colyseus | Proven stable, full control |
| Persistence | Git + JSON files | Versionable, agent-readable |
| Streaming | OBS + Twitch | Industry standard |
| Agent Vision | JSON + Screenshots | Fast logic + entertaining commentary |
