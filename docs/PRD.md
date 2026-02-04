# Product Requirements Document: Self-Building Game

## Overview

### Vision
A live-streamed, AI-built game where an agent continuously creates the world and mechanics while human and AI players experience it in real-time.

### Target Audience
- **Primary**: Hackathon judges evaluating AI innovation
- **Secondary**: Twitch/YouTube viewers interested in AI experiments
- **Tertiary**: AI/game development researchers

### Success Metrics (Hackathon)
- Core loop functional: Agent builds → Players play → Agent adapts
- Multi-agent sandbox working: AI players competing with humans
- 30-minute stable stream session
- Audience suggestions reaching the agent

---

## Core Features

### P0: Must Have (Week 1)

#### F1: Agent World Modification
The Claude agent can:
- Spawn 3D objects (platforms, ramps, collectibles)
- Modify object properties (position, size, color)
- Remove objects
- Change world parameters (physics simulation)

**Acceptance Criteria:**
- Agent command → Object appears in <2 seconds
- Multiple players see the same changes
- Changes persist across agent sessions

#### F2: Player Experience
Human players can:
- Join the world via browser (WebGL)
- Move, jump, interact with objects
- See other players in real-time
- Experience changes as agent makes them

**Acceptance Criteria:**
- Works in Chrome/Firefox/Safari
- 2-4 concurrent players supported
- Player actions visible to agent

#### F3: Persistence Layer
The system maintains state:
- World state in JSON files
- Git history of all changes
- Agent can resume after restart
- No context loss between sessions

**Acceptance Criteria:**
- Kill agent → Restart → World state intact
- Agent understands what it previously built
- History searchable for debugging

### P1: Should Have (Week 2)

#### F4: AI Player Agents
Additional Claude-powered agents:
- Join as players, not builders
- Attempt to complete challenges
- Different personalities (explorer, chaotic)
- Interact with human players

**Acceptance Criteria:**
- At least 2 AI player agents running
- AI players visible to humans
- AI players try challenges
- Builder agent observes AI player behavior

#### F5: Streaming Integration
Live stream capabilities:
- Agent reasoning visible on stream
- Twitch/YouTube chat ingestion
- Agent responds to suggestions
- Chaos magician personality in commentary

**Acceptance Criteria:**
- OBS integration working
- Chat messages reach agent
- Agent verbally acknowledges suggestions
- Stream stable for 30+ minutes

#### F6: Challenge Generation
Agent creates game objectives:
- "Reach this platform"
- "Collect 5 orbs"
- "Stay on the moving platform"
- Difficulty adapts to player success rate

**Acceptance Criteria:**
- Agent generates at least 3 challenge types
- Challenges trackable (attempts/completions)
- Agent modifies difficulty based on data

### P2: Nice to Have (Stretch)

#### F7: World Model Integration
Use generative models for assets:
- Procedural textures
- Generated 3D objects
- Dynamic skyboxes

#### F8: Voice Output
Chaos magician speaks:
- TTS for agent commentary
- Personality in voice
- Responds to events in real-time

#### F9: Voting System
Audience votes on next action:
- Poll options shown on stream
- Winning option influences agent
- Results visible in world

---

## Non-Functional Requirements

### Performance
- 60 FPS target in browser
- <100ms latency for player actions
- <2s for agent commands to manifest

### Reliability
- Handle network disconnections gracefully
- Agent crashes shouldn't corrupt world state
- Auto-recovery for transient failures

### Security
- No arbitrary code execution from agent
- Sandboxed world modifications
- Rate limiting on agent commands

---

## Constraints

### Timeline
- 2 weeks to hackathon demo
- Core loop must work by Day 7
- Streaming features by Day 12

### Team
- 2-3 people
- Parallel workstreams required

### Technical
- Hyperfy physics limited (no dynamic gravity) - see Stack Evaluation
- Claude API costs for multi-agent setup
- Browser compatibility requirements

---

## Open Questions

1. **Streaming platform**: Twitch vs YouTube? (Affects chat integration)
2. **Project name**: "Self-Building Game" is placeholder
3. **Chaos magician design**: What does the avatar look like?
4. **Voice or text**: TTS for agent, or text overlay only?

---

## References

- [Research Plan](/Users/rodrigosoto/.claude/plans/sleepy-watching-truffle.md)
- [Stack Evaluation](STACK-EVALUATION.md)
- [Development Roadmap](ROADMAP.md)
