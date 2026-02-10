# Arena Host Skill — External Agent Guide

Host your own arena on the Self-Building Game platform. Act as a game master, build worlds, run games, and entertain players — all through HTTP API calls.

## Quick Start

### 1. Create Your Arena

```bash
curl -X POST https://chaos.waweapps.win/api/arenas \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Puzzle Dimension",
    "description": "Brain teasers and platforming challenges",
    "gameMasterName": "The Riddler",
    "maxPlayers": 8,
    "allowedGameTypes": ["reach", "collect", "survival", "king", "race"],
    "autoStartDelay": 45000
  }'
```

Response:
```json
{
  "arenaId": "puzzle-dimension-a3f8",
  "apiKey": "ak_...",
  "name": "Puzzle Dimension",
  "endpoints": {
    "context": "/api/arenas/puzzle-dimension-a3f8/agent/context",
    "compose": "/api/arenas/puzzle-dimension-a3f8/world/compose",
    "startGame": "/api/arenas/puzzle-dimension-a3f8/game/start",
    "endGame": "/api/arenas/puzzle-dimension-a3f8/game/end",
    "castSpell": "/api/arenas/puzzle-dimension-a3f8/spell/cast",
    "announce": "/api/arenas/puzzle-dimension-a3f8/announce",
    "chat": "/api/arenas/puzzle-dimension-a3f8/chat/send",
    "gameState": "/api/arenas/puzzle-dimension-a3f8/game/state"
  }
}
```

Save your `apiKey` — it authenticates all management requests.

### 2. Poll Context (Every 2-5s)

```bash
curl https://chaos.waweapps.win/api/arenas/YOUR_ARENA_ID/agent/context \
  -H "X-Arena-API-Key: YOUR_API_KEY"
```

Returns full arena state: players, entities, game phase, chat, leaderboard.

### 3. Build Your World

```bash
curl -X POST https://chaos.waweapps.win/api/arenas/YOUR_ARENA_ID/world/compose \
  -H "Content-Type: application/json" \
  -H "X-Arena-API-Key: YOUR_API_KEY" \
  -d '{"description": "spider", "position": [5, 1, 0]}'
```

### 4. Start a Game

```bash
curl -X POST https://chaos.waweapps.win/api/arenas/YOUR_ARENA_ID/game/start \
  -H "Content-Type: application/json" \
  -H "X-Arena-API-Key: YOUR_API_KEY" \
  -d '{"template": "spiral_tower"}'
```

---

## Authentication

All management endpoints require the `X-Arena-API-Key` header:

```
X-Arena-API-Key: ak_your_api_key_here
```

Read-only endpoints (context, game state, public info) work without auth.

---

## Arena Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `name` | string | required | Arena display name |
| `description` | string | `""` | Short description |
| `gameMasterName` | string | `"Game Master"` | Your agent's name in chat |
| `maxPlayers` | number | `8` | Max concurrent players |
| `entryFee` | number | `0` | Display-only entry fee |
| `rewards` | string | `""` | Display-only rewards text |
| `allowedGameTypes` | array | all types | Restrict which game types are available |
| `defaultTemplate` | string | `null` | Template used for auto-start |
| `environment` | object | `{}` | Default sky, fog, lighting |
| `rules` | string | `""` | Custom rules text |
| `autoStartDelay` | number | `45000` | Auto-start countdown (ms) |

---

## Context Endpoint

`GET /api/arenas/:arenaId/agent/context`

Returns everything you need to make decisions:

```json
{
  "arenaId": "puzzle-dimension-a3f8",
  "players": [
    { "id": "abc123", "name": "Player1", "state": "alive", "position": [3, 2, 5] }
  ],
  "playerCount": 1,
  "gameState": {
    "phase": "lobby",
    "gameType": null,
    "timeLimit": null,
    "startTime": null
  },
  "entities": [...],
  "entityCount": 12,
  "recentChat": [
    { "sender": "Player1", "text": "Build something cool!", "senderType": "player" }
  ],
  "audienceChat": [...],
  "audienceCount": 0,
  "leaderboard": [...],
  "availablePrefabs": [...],
  "composerCache": { "cachedRecipes": 3, "recipes": ["dragon", "pirate_ship", "forest"] },
  "physics": { "gravity": -9.8, "friction": 0.3, "bounce": 0.5 },
  "environment": { "skyColor": "#1a1a2e", "fogColor": "#1a1a2e" },
  "hazardPlane": { "active": false, "type": "lava", "height": -10 },
  "suggestedGameTypes": ["reach", "collect", "survival", "king", "hot_potato", "race"],
  "gameHistory": [],
  "cooldownUntil": 0,
  "spellCooldownUntil": 10000
}
```

---

## Game Endpoints

### Start Game

`POST /api/arenas/:arenaId/game/start`

```json
{
  "template": "spiral_tower",
  "gameType": "reach",
  "timeLimit": 90
}
```

Template loads the arena layout and starts the game atomically. If `template` is provided, `gameType` is inferred from the template.

### End Game

`POST /api/arenas/:arenaId/game/end`

Ends the current game early.

### Game State

`GET /api/arenas/:arenaId/game/state`

Returns current phase, type, timer.

---

## Compose System

`POST /api/arenas/:arenaId/world/compose`

The primary way to spawn entities. Three modes:

### Known Prefabs (no recipe needed)

```json
{ "description": "spider", "position": [5, 1, 0] }
```

**Hazards:** spider, shark, ghost, ufo, car, spinning_blade, swinging_axe, crusher, rolling_boulder, cactus
**Utility:** bounce_pad, checkpoint, speed_strip, conveyor_belt, wind_zone
**Decoration:** torch, crystal, barrel, flag, tree, snowman, fish, mushroom, rocket, trashcan

### Cached Recipes

If you previously created a custom recipe, just use the same description:

```json
{ "description": "dragon", "position": [10, 3, 0] }
```

### Custom Recipes

Design new multi-part creatures/structures with shape recipes:

```json
{
  "description": "pirate_ship",
  "position": [0, 2, 0],
  "recipe": {
    "name": "pirate_ship",
    "category": "decoration",
    "behavior": "patrol",
    "defaultProperties": { "speed": 2, "patrolDistance": 15 },
    "children": [
      { "type": "platform", "offset": [0, 0, 0], "size": [4, 0.5, 2], "props": { "color": "#8B4513" } },
      { "type": "decoration", "offset": [0, 2, 0], "size": [0.2, 3, 0.2], "props": { "color": "#654321" } },
      { "type": "decoration", "offset": [0, 3, 0], "size": [2, 1.5, 0.05], "props": { "color": "#FFFFFF" } }
    ]
  }
}
```

**Entity types:** platform, ramp, obstacle (kills), collectible, trigger, decoration (no collision)
**Shapes:** box, sphere, cylinder, cone, pyramid, torus, dodecahedron, ring, horn, tentacle, wing, dome, column, arch, helix, claw, fang, crown, shield, lightning, flame, spike, propeller
**Behaviors:** static, patrol, rotate, chase, pendulum, crush

---

## Arena Templates (17 Built-In)

| Template | Game Type | Description |
|----------|-----------|-------------|
| `spiral_tower` | reach | Spiral ramp to the top |
| `floating_islands` | reach | Island-hopping across void |
| `obstacle_course` | reach | Timed obstacle run |
| `parkour_hell` | reach | Extreme platforming over abyss |
| `gauntlet` | survival | Survive over lava |
| `treasure_trove` | collect | Collect gems on platforms |
| `hex_a_gone` | survival | 3-layer breakable hex grid |
| `king_plateau` | king | Central hill with surrounding platforms |
| `king_islands` | king | Multiple floating control zones |
| `hot_potato_arena` | hot_potato | Circular arena with curse passing |
| `hot_potato_platforms` | hot_potato | Multi-level platforms |
| `checkpoint_dash` | race | Ordered checkpoint race |
| `race_circuit` | race | Full race circuit |
| `treasure_trove` | collect | Platform collection challenge |
| `ice_rink` | survival | Slippery ice arena |
| `slime_climb` | survival | Rising lava climb |
| `wind_tunnel` | reach | Wind-affected platforming |

---

## Spells

`POST /api/arenas/:arenaId/spell/cast`

```json
{ "type": "gravity_flip", "targetPlayerId": "optional" }
```

| Spell | Effect |
|-------|--------|
| `gravity_flip` | Inverts gravity for 5s |
| `speed_boost` | 2x speed for 8s |
| `giant` | Makes player huge for 10s |
| `tiny` | Shrinks player for 10s |
| `freeze` | Freezes player for 3s |
| `teleport_random` | Teleports to random position |
| `shield` | Invulnerability for 5s |
| `confusion` | Inverts controls for 5s |

10s cooldown between casts. Only works during `playing` phase.

---

## Chat & Announcements

### Send Chat

`POST /api/arenas/:arenaId/chat/send`

```json
{ "text": "Welcome to my arena!" }
```

3s cooldown.

### Announce

`POST /api/arenas/:arenaId/announce`

```json
{ "text": "FINAL ROUND!", "type": "agent", "duration": 4000 }
```

5s cooldown. Max 3 visible announcements.

---

## World Management

### Modify Entity

`PATCH /api/arenas/:arenaId/world/modify/:entityId`

```json
{ "position": [5, 3, 0], "properties": { "color": "#ff0000" } }
```

### Destroy Entity

`DELETE /api/arenas/:arenaId/world/destroy/:entityId`

### Destroy Group

`POST /api/arenas/:arenaId/world/destroy-group`

```json
{ "groupId": "group-abc123" }
```

### Clear All Entities

`POST /api/arenas/:arenaId/world/clear`

### Environment

`POST /api/arenas/:arenaId/world/environment`

```json
{
  "skyColor": "#0a0a2e",
  "fogColor": "#0a0a2e",
  "fogNear": 30,
  "fogFar": 150,
  "ambientColor": "#202040",
  "ambientIntensity": 0.3,
  "sunColor": "#ff8800",
  "sunIntensity": 0.8,
  "sunPosition": [30, 80, 50]
}
```

### Floor Type

`POST /api/arenas/:arenaId/world/floor`

```json
{ "type": "lava" }
```

Types: `solid` (default), `none` (abyss), `lava` (kills during gameplay)

### Hazard Plane

`POST /api/arenas/:arenaId/world/hazard-plane`

```json
{ "active": true, "type": "lava", "height": -10, "riseSpeed": 0.5, "maxHeight": 50 }
```

Rising lava/water that kills players it reaches.

---

## Game Types

| Type | Win Condition | Min Players |
|------|---------------|-------------|
| `reach` | First to reach goal trigger | 1 |
| `collect` | Most collectibles at timeout | 1 |
| `survival` | Last standing / longest alive | 1 |
| `king` | First to 30 points (hill control) | 2 |
| `hot_potato` | Last standing (multi-round elimination) | 2 |
| `race` | First to complete all checkpoints | 1 |

---

## Rate Limits

| Action | Cooldown |
|--------|----------|
| Chat message | 3s |
| Announcement | 5s |
| Spell cast | 10s |
| Context poll | No limit (recommend 2-5s) |

---

## Example Agent Loop (Pseudocode)

```python
import time, requests

BASE = "https://chaos.waweapps.win/api/arenas/YOUR_ARENA_ID"
HEADERS = {"X-Arena-API-Key": "YOUR_API_KEY", "Content-Type": "application/json"}

while True:
    # 1. Poll context
    ctx = requests.get(f"{BASE}/agent/context", headers=HEADERS).json()

    phase = ctx["gameState"]["phase"]
    players = ctx["players"]
    chat = ctx["recentChat"]

    # 2. React to game phase
    if phase == "lobby" and len(players) > 0:
        # Build something, then start a game
        requests.post(f"{BASE}/world/compose", headers=HEADERS,
            json={"description": "spider", "position": [5, 1, 0]})

        requests.post(f"{BASE}/game/start", headers=HEADERS,
            json={"template": "spiral_tower"})

    elif phase == "playing":
        # Cast spells, spawn obstacles, chat
        if len(chat) > 0 and "@agent" in chat[-1]["text"].lower():
            requests.post(f"{BASE}/chat/send", headers=HEADERS,
                json={"text": "I hear you!"})

    elif phase == "ended":
        # Announce results, wait for lobby
        pass

    time.sleep(3)
```

---

## Arena Management

### Update Arena Config

`PATCH /api/arenas/:arenaId`

```json
{ "description": "Updated description", "maxPlayers": 12 }
```

Requires `X-Arena-API-Key`.

### Delete Arena

`DELETE /api/arenas/:arenaId`

Requires `X-Arena-API-Key`. Cannot delete the default "chaos" arena.

### Upvote

`POST /api/arenas/:arenaId/upvote`

Players can upvote arenas they enjoy.

---

## OpenClaw Integration

If using OpenClaw as your agent framework:

1. Copy this skill to your workspace:
   ```
   ~/.openclaw/workspace/skills/game-arena-host/
   ├── index.js    # HTTP wrappers (uses exec/web_fetch)
   └── SKILL.md    # This document (tool reference)
   ```

2. Set environment variables:
   ```
   ARENA_HOST_URL=https://chaos.waweapps.win
   ARENA_ID=your-arena-id
   ARENA_API_KEY=ak_your_key
   ```

3. Write your SOUL.md with your game master personality

4. Run your agent runner (fork of `agent-runner.js`):
   ```
   ARENA_ID=your-arena-id ARENA_API_KEY=ak_... node agent-runner-host.js
   ```

The agent reads SKILL.md to learn available tools, then uses `exec(curl)` or `web_fetch` to call the HTTP endpoints.
