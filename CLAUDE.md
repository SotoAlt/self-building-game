# Self-Building Game - Agent Context

## Project Overview

An AI agent (Claude) acts as a "Chaos Magician" that builds a 3D multiplayer game in real-time while players play and audiences watch via livestream.

## Current Phase

**Research & Documentation** - Evaluating tech stack and planning implementation.

## Key Decisions

- **Primary Stack**: Three.js + Colyseus + Claude Agent SDK (physics-first)
- **Fallback Stack**: Hyperfy + ElizaOS (if pivoting away from physics)
- **Agent Vision**: Dual mode (JSON for logic, screenshots for commentary)
- **Persistence**: Git + JSON files (world-state.json)
- **AI Players**: Core feature (not stretch goal)

## Directory Structure

```
/self-building-game
├── docs/
│   ├── PRD.md              # Product requirements
│   ├── CONCEPT.md          # Technical architecture
│   ├── ROADMAP.md          # Development timeline
│   └── STACK-EVALUATION.md # Technology comparison
├── src/                    # (To be created)
│   ├── agent/              # Claude agent code
│   ├── world/              # Three.js/Hyperfy world
│   └── orchestrator/       # Multi-agent coordination
├── game-world/             # (To be created)
│   ├── world-state.json    # Persistent world state
│   ├── entities/           # Individual entity data
│   └── logs/               # Agent action logs
└── CLAUDE.md               # This file
```

## Development Commands

```bash
# Setup (TBD)
npm install

# Run world server (TBD)
npm run world

# Run agent (TBD)
npm run agent

# Run all (TBD)
npm run dev
```

## Testing Strategy

1. **Day 3 Checkpoint**: Agent spawns object → Player sees it
2. **Day 7 Checkpoint**: Challenge creation and completion working
3. **Day 10 Checkpoint**: Human + AI players together
4. **Day 14**: 30-minute stable stream session

## Key Files to Read

When starting a session:
1. `docs/CONCEPT.md` - Architecture overview
2. `docs/ROADMAP.md` - Current progress
3. `game-world/world-state.json` - Current world (when exists)

## Constraints

- Hyperfy has NO dynamic physics (gravity) - use Three.js if needed
- 2-week timeline to hackathon demo
- Team of 2-3 people
- Must support 2-4 concurrent players

## Links

- [Hyperfy Docs](https://docs.hyperfy.io)
- [Three.js Docs](https://threejs.org/docs/)
- [Colyseus Docs](https://docs.colyseus.io)
- [Claude Agent SDK](https://platform.claude.com/docs/en/agent-sdk/overview)
