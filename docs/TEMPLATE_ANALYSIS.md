# Template-Readiness Analysis

**Goal:** Assess the feasibility of extracting a reusable **Three.js + WebGPU + TSL + Colyseus + Privy** starter template from the Chaos Arena codebase.

**Date:** February 2026
**Codebase version:** v0.68.0
**Total size:** ~7,000 lines client (48 files) + ~9,000 lines server (46 files)

---

## 1. Executive Summary

| Layer | Reusability | Notes |
|-------|:-----------:|-------|
| Client engine (physics, entities, network, rendering) | 9/10 | Modular, few game-specific hooks |
| Server engine (WorldState, GameRoom, auth, DB) | 8/10 | Clean facade pattern, composable managers |
| UI layer | 3/10 | Heavily game-specific, needs full abstraction |
| Agent system (OpenClaw) | Optional plugin | Not core — can ship as example |

**Overall extractability: ~65% of the codebase is generic engine.**

The physics pipeline, entity system, network layer, and rendering stack are already well-separated. The game-specific glue (arena templates, game types, bribe system, agent personality) is what needs stripping.

---

## 2. What's Template-Ready Today

### Client — Extractable (~4,200 lines)

| Module | Files | Lines | Reusability | Notes |
|--------|-------|------:|:-----------:|-------|
| **Physics** | PhysicsEngine.js, SpatialHash.js | 485 | 95% | Only needs `isSafePhase()` callback extracted |
| **Entities** | EntityFactory, EntityManager, EntityBehaviors, InstancedBatchManager | 832 | 95% | Generic lifecycle + batching |
| **Network** | NetworkManager, ConnectionManager, handler split (4 files) | 549 | 100% | Clean Colyseus abstraction |
| **Rendering** | ToonMaterials, PostProcessing, SceneSetup, SurfaceShaders, EnvironmentEffects | 994 | 85-95% | Parameterize colors/constants |
| **Camera** | CameraController.js | 177 | 100% | Orbit + spectator, zero game coupling |
| **Input** | InputManager, MobileControls | 277 | 100% | Action-map pattern, virtual joystick |
| **Auth** | auth.js, PrivyBridge.jsx | 348 | 95% | Env-var driven, guest fallback works |
| **Support** | GeometryTemplates, PlayerVisuals, ProceduralTextures, state, config, math | ~1,000 | 70-90% | Some game constants mixed in |

### Server — Extractable (~3,500 lines)

| Module | Files | Lines | Reusability | Notes |
|--------|-------|------:|:-----------:|-------|
| **WorldState facade** | WorldState.js + 8 managers | 1,297 | 90% | Excellent composable pattern |
| **GameRoom** | GameRoom.js | 402 | 75% | Abstract game callbacks, strip game dispatch |
| **Auth** | auth.js | 99 | 100% | Privy JWT, fully reusable |
| **Database** | db.js | 375 | 100% | PostgreSQL + in-memory fallback |
| **Routes** | authRoutes, publicRoutes, arenaRoutes | 295 | 90% | Clean Express patterns |
| **Arena** | ArenaManager, ArenaInstance, arenaMiddleware | ~346 | 80% | Multi-tenant pattern |
| **Bootstrap** | index.js | 256 | 70% | Strip game-specific route mounting |
| **Services** | arenaService, gameService | 285 | 60% | gameService is game-specific |

### Infrastructure — Extractable

- **Dockerfile + docker-compose.yml** — 80% template-ready (strip game-specific env vars)
- **nginx config** — 90% template-ready (SSL, WebSocket proxy, SSE)
- **deploy.sh** — 60% template-ready (has game-specific OpenClaw sync)
- **Vite config** — 100% reusable (WebGPU + JSX setup)

---

## 3. What's Game-Specific (Strip from Template)

These are our content and differentiators — they should **not** ship in a public template.

| Component | Files | Lines | Why it stays |
|-----------|-------|------:|--------------|
| MiniGame base + 6 game types | MiniGame.js, games/*.js | 1,568 | Our game logic |
| 16 arena templates | ArenaTemplates.js | 822 | Our level content |
| 23 prefab definitions | Prefabs.js | 485 | Our entity presets |
| Compose recipe system | Composer.js + cache | 273 | Our differentiator |
| Bribe/blockchain economy | bribeRoutes.js + blockchain/ | 200+ | Game-specific |
| Drama score algorithm | AgentLoop.js | 372 | Our secret sauce |
| Agent personality | SOUL.md | 218 | Our character |
| Bribe panel | BribePanel.js | 200 | Game-specific UI |
| Game-specific HUD | GameStatusHUD.js (curse timer, score overlay, checkpoint display) | 108 | Game-specific UI |
| "Chaos Magician" branding | Various UI strings | — | Our brand |
| Spell constants in physics | 9 SPELL references in PhysicsEngine.js | — | Needs effect registry |

---

## 4. OpenClaw Agent — Can It Be Included?

**Yes, as an optional plugin.** The agent system is already isolated and self-disabling.

### What ships in template

| Component | Template version | Current version |
|-----------|-----------------|-----------------|
| agent-runner.js | Minimal reference (100 lines) | 545 lines with drama/variety logic |
| SOUL.md | Generic "game master" personality | "Chaos Magician" character (218 lines) |
| Skill file | Basic tools: compose, start_game, chat | 30 tools (580 lines) |
| AgentBridge.js | Simplified prompt builder | Rich context with drama/variety (181 lines) |
| AgentLoop.js | Simple timer-based invocation | Drama score + pacing algorithm (372 lines) |

### What's needed for plugin extraction

1. Strip game-specific prompt building from `AgentBridge.js` — replace with generic game-state summary
2. Make drama score configurable (or provide a simpler "invoke every N seconds" default)
3. Document the OpenClaw workspace syncing requirement (currently undocumented)
4. Document OpenClaw CLI installation and configuration
5. Agent already auto-disables when 0 humans connected — just needs "no credentials" guard

### Documentation needed

- `AGENT_SETUP.md` — OpenClaw CLI installation, `~/.openclaw/config.yaml`, workspace layout
- "How to customize your agent personality" — modifying SOUL.md, adding tools
- OpenClaw workspace syncing — the three-file deploy requirement

---

## 5. Hardcoded References to Parameterize

| Reference | File | Current value | Fix |
|-----------|------|---------------|-----|
| Default arena ID | `src/client/config.js:24` | `'chaos'` | Env var `VITE_DEFAULT_ARENA` |
| API path construction | `src/client/config.js:28` | `if (selectedArenaId === 'chaos')` | Use env var comparison |
| Game phase names in physics | `src/client/physics/PhysicsEngine.js:356` | `'lobby' \| 'building' \| 'countdown' \| 'ended'` | `isSafePhase()` callback |
| Spell effect handling | `src/client/physics/PhysicsEngine.js` | 9 `SPELL_*` references | Effect registry pattern |
| Background color | `src/client/SceneSetup.js` | `0x2a2a4e` | Config param |
| World size | `src/client/SceneSetup.js` | `WORLD_SIZE = 200` | Config param |
| "Chaos Magician choosing..." | `src/client/ui/GameStatusHUD.js` | Hardcoded string | Template string / config |
| Colyseus room name | `src/client/network/NetworkManager.js` | `'game'` | Constructor param |
| Twitter OAuth branding | `src/client/ui/AuthFlow.js` | Hardcoded provider | Config param |
| Privy fetch patch | `index.html` | Monkey-patch for Privy SDK | Keep (needed for Privy) |
| OpenClaw config sync | `deploy.sh` | Game-world skill paths | Generalize or remove |

---

## 6. Documentation Gaps for Template Users

### Missing docs (would need to create)

| Document | Priority | Purpose |
|----------|:--------:|---------|
| `GETTING_STARTED.md` | High | Local dev setup, env var guide, running without auth |
| `CUSTOMIZATION.md` | High | How to add game types, modify UI, swap auth providers |
| `AGENT_SETUP.md` | Medium | OpenClaw installation, skill customization, deployment |
| JSDoc on engine exports | Medium | PhysicsEngine, EntityManager, WorldState, GameRoom |
| `.env.example` expansion | High | Add `OPENCLAW_*` vars, `AI_PLAYERS` flag, `VITE_DEFAULT_ARENA` |

### Current `.env.example` coverage

The existing `.env.example` (19 lines) covers:
- Server port, DB, auth basics
- Privy client/server keys
- Blockchain/treasury (optional)

**Missing from `.env.example`:**
- `OPENCLAW_*` — agent configuration
- `AI_PLAYERS` — AI bot toggle
- `VITE_DEFAULT_ARENA` — default arena ID
- `VITE_API_URL` — explicit API URL override
- `VITE_WS_URL` — WebSocket URL override
- `SESSION_SECRET` — session management
- `CORS_ORIGIN` — production CORS whitelist

### Missing tooling

| Tool | Status | Impact |
|------|--------|--------|
| ESLint/Prettier config | None | No consistent formatting |
| Tests | None | No test suite at all |
| TypeScript / JSDoc types | None | No type safety |
| CI/CD pipeline | None | Manual deploy only |
| Pre-commit hooks | None | No quality gates |

---

## 7. "Clone and Go" DX Assessment

| Step | Works? | Notes |
|------|:------:|-------|
| `git clone && npm install` | Yes | Clean install, no native deps |
| `npm run dev` | Yes | Vite + server start, game runs immediately |
| Auth (guest mode) | Yes | Works without any Privy credentials |
| Auth (Privy) | Needs config | Requires Privy account + 4 env vars |
| Multiplayer | Yes | Colyseus works out of the box |
| Database | Yes | Falls back to in-memory when no PostgreSQL |
| Agent (OpenClaw) | No | Requires OpenClaw CLI install + Anthropic API key |
| AI players | Partial | Need `AI_PLAYERS=true` env var |
| Production deploy | Needs config | Docker + nginx + SSL + env vars + DNS |
| Mobile | Yes | Touch controls auto-enable on mobile UA |

**Verdict:** The local dev experience is surprisingly good — `npm run dev` gets a playable game with zero configuration. The main gaps are agent setup (undocumented) and production deployment (requires infrastructure knowledge).

---

## 8. Recommendations

### Now (before extracting template)

| # | Action | Effort | Impact |
|---|--------|:------:|:------:|
| 1 | Expand `.env.example` with ALL env vars documented | 1 hour | High |
| 2 | Add JSDoc to key engine exports (PhysicsEngine, EntityManager, WorldState, GameRoom) | 4 hours | High |
| 3 | Write `docs/AGENT_SETUP.md` for OpenClaw installation | 2 hours | Medium |
| 4 | Add ESLint + Prettier config | 1 hour | Medium |

### When extracting template

| # | Action | Effort | Impact |
|---|--------|:------:|:------:|
| 1 | Create `GameConfig` object — centralize all parameterizable values | 1 day | Critical |
| 2 | Add `isSafePhase()` callback + effect registry to PhysicsEngine | 0.5 day | Critical |
| 3 | Extract game-specific UI into `examples/` directory | 1 day | High |
| 4 | Make `index.html` a minimal shell with Vite env var templating | 0.5 day | High |
| 5 | Ship with 1 example game type (reach) instead of 6 | 0.5 day | High |
| 6 | Include agent-runner as optional with minimal SOUL.md | 1 day | Medium |
| 7 | Write GETTING_STARTED.md and CUSTOMIZATION.md | 1 day | High |
| 8 | Add basic smoke tests (server starts, room connects, entity CRUD) | 1 day | Medium |

### What NOT to ship in template

- Our 16 arena templates (ship 1-2 simple examples)
- Our 23 prefab definitions (ship 3-4 basics: bounce_pad, checkpoint, torch, barrel)
- Composer recipe cache contents
- Drama score algorithm details
- Bribe/blockchain system
- SOUL.md chaos personality
- Chat bridge (Twitch/Discord/Telegram) — too specific

---

## 9. Estimated Effort

| Phase | Scope | Time |
|-------|-------|:----:|
| Documentation improvements | .env.example, JSDoc, AGENT_SETUP.md | 1 day |
| Config extraction | GameConfig object, parameterize all hardcodes | 1-2 days |
| Engine separation | Strip game logic, add callbacks, effect registry | 2-3 days |
| Template UI | Minimal shell index.html, basic HUD, remove branding | 1-2 days |
| Example game | Simple "reach the goal" demo with 1 arena | 1 day |
| Agent plugin | Minimal SOUL.md, simplified agent-runner, setup docs | 1 day |
| Testing and polish | Verify clone-and-go works, smoke tests | 1 day |
| **Total** | | **8-10 days** |

---

## 10. Architecture Strengths Worth Preserving

These patterns make the engine valuable as a template and should be maintained:

1. **WorldState facade + 8 composable managers** — clean separation of concerns, easy to add/remove capabilities
2. **Entity lifecycle** with server-authoritative state and client interpolation
3. **WebGPU + TSL rendering** with 3-tier adaptive quality and toon shading
4. **Colyseus room pattern** with handler-split architecture for message routing
5. **InstancedMesh batching** for efficient rendering of many similar entities
6. **Privy auth with guest fallback** — works with zero config, scales to production auth
7. **In-memory DB fallback** — no PostgreSQL required for development
8. **SpatialHash** for O(1) collision lookups
9. **Multi-arena architecture** — built-in multi-tenancy from day one
10. **SSE event stream** — ready for external integrations (OBS, bots, dashboards)
