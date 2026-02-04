---
name: game-world
description: Control the 3D game world - spawn entities, modify physics, track players
version: 0.1.0
author: self-building-game
---

# Game World Control Skill

This skill allows AI agents to manipulate the 3D game world running on the game server.

## Configuration

Set the game server URL in your environment:
```
GAME_SERVER_URL=http://localhost:3000
```

## Tools

### spawn_entity

Create a new entity in the world.

**Parameters:**
- `type` (required): "platform" | "ramp" | "collectible" | "obstacle" | "trigger"
- `position` (required): [x, y, z] coordinates
- `size`: [width, height, depth] - default [1, 1, 1]
- `properties`: Object with type-specific properties
  - `color`: Hex color string
  - `kinematic`: boolean - can it move?
  - `rotating`: boolean - does it spin?
  - `speed`: number - rotation/movement speed

**Returns:** `{ id: string, success: boolean }`

**Example:**
```json
{
  "type": "platform",
  "position": [0, 5, 0],
  "size": [10, 1, 10],
  "properties": {
    "color": "#3498db",
    "kinematic": true,
    "rotating": true,
    "speed": 2
  }
}
```

### modify_entity

Update an existing entity.

**Parameters:**
- `id` (required): Entity ID to modify
- `changes`: Object with properties to change
  - `position`: [x, y, z]
  - `size`: [width, height, depth]
  - `properties`: Partial properties object

**Returns:** `{ success: boolean }`

### destroy_entity

Remove an entity from the world.

**Parameters:**
- `id` (required): Entity ID to remove

**Returns:** `{ success: boolean }`

### set_physics

Modify global physics parameters.

**Parameters:**
- `gravity`: number (-20 to 0)
- `friction`: number (0 to 1)
- `bounce`: number (0 to 2)

**Returns:** `{ success: boolean, physics: { gravity, friction, bounce } }`

### get_world_state

Get the current state of the entire world.

**Parameters:** None

**Returns:**
```json
{
  "physics": { "gravity": -9.8, "friction": 0.3, "bounce": 0.5 },
  "entities": [
    { "id": "...", "type": "...", "position": [...], "size": [...], "properties": {...} }
  ],
  "challenges": {
    "active": [...],
    "completed": [...]
  },
  "statistics": {
    "totalEntities": 0,
    "playersOnline": 0
  }
}
```

### get_player_positions

Get all connected player positions and states.

**Parameters:** None

**Returns:**
```json
{
  "players": [
    {
      "id": "player-001",
      "name": "speedrunner42",
      "type": "human",
      "position": [0, 1, 0],
      "velocity": [0, 0, 0],
      "state": "alive"
    }
  ]
}
```

### create_challenge

Create a new challenge objective.

**Parameters:**
- `type` (required): "reach" | "collect" | "survive" | "time_trial"
- `target`: Entity ID or position to reach
- `description`: Human-readable challenge description
- `reward`: Points or effect on completion

**Returns:** `{ id: string, success: boolean }`

### get_challenge_status

Get status of all active challenges.

**Parameters:** None

**Returns:**
```json
{
  "challenges": [
    {
      "id": "challenge-001",
      "type": "reach",
      "target": "platform-001",
      "description": "Reach the floating platform",
      "attempts": 15,
      "successes": 3,
      "completionRate": 0.2
    }
  ]
}
```

## Error Codes

| Code | Meaning |
|------|---------|
| 400 | Invalid parameters |
| 404 | Entity not found |
| 500 | Server error |
| 503 | Game server unavailable |

## Events

The game server sends events via WebSocket that trigger agent actions:
- `player_joined`: New player connected
- `player_left`: Player disconnected
- `challenge_completed`: Player finished a challenge
- `player_died`: Player fell or hit obstacle
- `entity_collision`: Player touched an entity
