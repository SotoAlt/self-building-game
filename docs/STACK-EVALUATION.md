# Stack Evaluation: February 2026

## Summary

Based on latest documentation research, here's the current state of candidate technologies.

---

## Hyperfy

**Status**: Alpha (v0.10.0, April 2025)

### Strengths
- React-based development (familiar to web devs)
- Built-in multiplayer with flux/redux state sync
- ElizaOS integration proven (Feb 2025 huddle demos)
- Self-hostable architecture
- Real-time collaboration tools
- Web3 integration native

### Limitations
- **No dynamic physics with gravity** - Only static/kinematic rigidbodies
- Alpha status - APIs will change
- Limited documentation for advanced use cases
- PhysX integrated but not fully exposed

### Physics Reality Check
From official docs:
> "Dynamic rigidbodies with gravity are NOT currently supported (planned for future)"

**Impact**: Our physics-based game (gravity manipulation, falling, bouncing) requires workarounds:
- Use kinematic bodies with manual animation
- Simulate physics in JavaScript
- Or switch to Three.js + custom physics

### Recommended For
- Quick multiplayer prototypes
- AI agent integration experiments
- Projects that don't need complex physics

### Code Example
```javascript
// Hyperfy app structure
export default function MyApp() {
  const [platforms, setPlatforms] = useSyncState('platforms', [])

  return (
    <app>
      {platforms.map(p => (
        <model
          key={p.id}
          src="platform.glb"
          position={p.position}
        />
      ))}
    </app>
  )
}

export const getStore = () => ({
  initialState: { platforms: [] },
  actions: {
    spawnPlatform: (state, { position }) => ({
      ...state,
      platforms: [...state.platforms, { id: Date.now(), position }]
    })
  }
})
```

---

## Three.js + Colyseus

**Status**: Production-ready

### Strengths
- Full physics control (Cannon.js, Rapier, custom)
- Mature, stable APIs
- Extensive documentation and examples
- Hot reload with Vite (10-20ms)
- Complete control over networking
- Large community

### Limitations
- More boilerplate to set up
- Custom networking code required
- No built-in collaboration tools
- More decisions to make (physics engine, etc.)

### Physics Capabilities
- Full gravity simulation
- Dynamic rigidbodies
- Constraints, joints
- Raycasting for interactions
- Any physics behavior you can code

### Recommended For
- Projects needing real physics
- Production applications
- Teams with more development time

### Code Example
```javascript
// Three.js + Cannon.js + Colyseus
import * as THREE from 'three'
import * as CANNON from 'cannon-es'
import { Client, Room } from 'colyseus.js'

const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.8, 0) })

// Agent command handler
socket.on('agent:spawn', (data) => {
  const body = new CANNON.Body({
    mass: data.dynamic ? 1 : 0,
    shape: new CANNON.Box(new CANNON.Vec3(...data.size)),
    position: new CANNON.Vec3(...data.position)
  })
  world.addBody(body)

  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(...data.size.map(s => s * 2)),
    new THREE.MeshStandardMaterial({ color: data.color })
  )
  scene.add(mesh)
})
```

---

## Claude Agent SDK

**Status**: Production-ready

### Key Features
- Multi-session persistence patterns
- Tool use (file ops, code execution, web browsing)
- Sub-agents for parallel work
- MCP protocol for custom integrations
- Python and TypeScript SDKs

### Persistence Pattern
```
Session 1: Initialize world structure
Session 2+:
  1. Read world-state.json
  2. Read recent git history
  3. Make decisions
  4. Execute actions
  5. Commit changes
```

### Context Management
- 200K token standard window
- 1M token extended (Sonnet)
- Must explicitly write state to filesystem
- Each session re-reads project state

### Best Practices
1. Store state in filesystem, not context
2. Use AGENT-CONTEXT.md for high-level grounding
3. Commit after significant changes
4. Keep action logs for debugging
5. Rate limit to prevent runaway actions

---

## ElizaOS

**Status**: Active development

### Hyperfy Integration
- Agents connect as WebSocket participants
- Multimodal perception (vision + voice)
- First-class world inhabitants
- Proven at Feb 2025 developer huddle

### Standalone Capabilities
- Multiple LLM backends (Claude, GPT-4, etc.)
- Memory and context management
- Plugin architecture
- Voice chat integration

### Use Case
- If building primarily for Hyperfy
- If want pre-built agent framework
- If need voice capabilities quickly

---

## Recommendation

### For This Project

**Primary: Three.js + Colyseus + Claude Agent SDK**

Rationale:
1. Physics is core to our game concept (gravity manipulation, falling, bouncing)
2. Hyperfy's physics limitations are a blocker
3. More control over the experience
4. Claude Agent SDK handles persistence well
5. Worth the extra setup time for a better game

**If Physics Not Critical**: Hyperfy + ElizaOS

Use Hyperfy if you:
- Pivot to non-physics mechanics (puzzles, exploration)
- Prioritize multiplayer speed over physics
- Want fastest path to "agents in 3D world"

### Decision Matrix

| Factor | Hyperfy | Three.js + Colyseus |
|--------|---------|---------------------|
| Physics | Limited (kinematic only) | Full control |
| Multiplayer | Built-in | Custom code needed |
| AI Integration | ElizaOS ready | Claude SDK + custom |
| Setup Time | 1-2 days | 3-4 days |
| Flexibility | Lower | Higher |
| Stability | Alpha | Production |
| **Verdict** | **Backup** | **Primary** |

---

## Migration Path

If starting with Hyperfy and need to switch:

1. World state schema stays the same (JSON)
2. Agent logic unchanged (reads/writes JSON)
3. Replace Hyperfy components with Three.js equivalents
4. Add Colyseus for networking
5. Add physics engine (Cannon.js or Rapier)

Estimated migration: 2-3 days

---

## Resources

### Hyperfy
- [Documentation](https://docs.hyperfy.io)
- [GitHub](https://github.com/hyperfy-xyz/hyperfy)
- [ElizaOS Starter](https://github.com/elizaOS/eliza-3d-hyperfy-starter)

### Three.js
- [Documentation](https://threejs.org/docs/)
- [Examples](https://threejs.org/examples/)
- [Discourse](https://discourse.threejs.org)

### Colyseus
- [Documentation](https://docs.colyseus.io)
- [Examples](https://github.com/colyseus/colyseus-examples)

### Claude Agent SDK
- [Overview](https://platform.claude.com/docs/en/agent-sdk/overview)
- [Python Reference](https://platform.claude.com/docs/en/agent-sdk/python)
- [TypeScript Reference](https://platform.claude.com/docs/en/agent-sdk/typescript)

### Physics Engines
- [Cannon.js](https://pmndrs.github.io/cannon-es/)
- [Rapier](https://rapier.rs/)
