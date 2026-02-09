---
name: game-world
description: Control the 3D game world — spawn creatures and objects with compose, run mini-games, cast spells
version: 0.24.0
author: self-building-game
---

# Game World Control Skill

Controls the 3D multiplayer game world via HTTP API.

## Configuration

```
GAME_SERVER_URL=http://localhost:3000
```

## Tools

### compose ⭐ MAIN SPAWNING TOOL

Spawn anything — known prefabs OR custom creations you design with shape recipes.

**Parameters:**
- `description` (required): What to spawn — "spider", "dragon", "pirate ship"
- `position` (required): [x, y, z]
- `recipe` (optional): Shape recipe for NEW custom creations
- `properties` (optional): Override speed, chaseRadius, etc.

**Known prefabs (no recipe needed — just use description):**
- Hazards: spider, shark, ghost, ufo, car, spinning_blade, swinging_axe, crusher, rolling_boulder, cactus
- Utility: bounce_pad, checkpoint, speed_strip
- Decoration: torch, crystal, barrel, flag, tree, snowman, fish, mushroom, rocket, trashcan

**Examples:**
```js
// Known prefab
compose({ description: "spider", position: [5, 1, 0] })

// Custom creation with rotation, organic shapes, materials
compose({ description: "dragon", position: [5, 3, 0], recipe: {
  name: "dragon", category: "hazard", behavior: "chase",
  defaultProperties: { speed: 3, chaseRadius: 25 },
  children: [
    { type: "obstacle", offset: [0,1,0], size: [2.5,1.2,1.2], props: { shape: "sphere", color: "#c0392b", roughness: 0.7 } },
    { type: "obstacle", offset: [1.5,1.5,0], size: [0.8,0.8,0.8], props: { shape: "sphere", color: "#e74c3c" } },
    { type: "decoration", offset: [-1.2,1.2,0.8], size: [1.5,0.3,0.8], rotation: [0.3,0,0.5], props: { shape: "wing", color: "#8b0000" } },
    { type: "decoration", offset: [-1.2,1.2,-0.8], size: [1.5,0.3,0.8], rotation: [-0.3,0,0.5], props: { shape: "wing", color: "#8b0000" } },
    { type: "decoration", offset: [-1.5,0.8,0], size: [0.3,0.3,1], rotation: [0,0,-0.3], props: { shape: "tentacle", color: "#c0392b" } },
    { type: "decoration", offset: [2,1.5,0], size: [0.5,0.3,0.3], rotation: [0,0,-0.4], props: { shape: "cone", color: "#f39c12", emissive: true, opacity: 0.7 } }
  ]
}})
```

**Recipe rules:**
- Max 12 children per recipe
- `rotation: [rx, ry, rz]` per child — angle wings, arms, tails (radians, -PI to PI)
- Basic shapes: box, sphere, cylinder, cone, pyramid, torus, dodecahedron, ring
- Organic shapes: horn, tentacle, wing, dome, column, vase, teardrop, mushroom_cap, flask, bell, arch, s_curve
- Symbol shapes: star, heart, arrow, cross
- Material props per child: roughness (0-1), metalness (0-1), opacity (0.1-1), emissive (true/false)
- Behaviors: static, patrol, rotate, chase, pendulum, crush
- Categories: hazard, decoration, utility
- Hazards use child type "obstacle", decorations use "decoration"
- Cached after first creation — same description = instant spawn next time

### spawn_entity

Create a single primitive shape. **Use compose for creatures/objects.** Only for platforms, ramps, walls, floors.

**Parameters:**
- `type` (required): "platform" | "ramp" | "collectible" | "obstacle" | "trigger" | "decoration"
- `position` (required): [x, y, z]
- `size`: [w, h, d] default [1,1,1]
- `properties`: { color, shape, kinematic, rotating, speed }

Shapes: box (default), sphere, cylinder, cone, pyramid, torus, dodecahedron, ring

### modify_entity

Update position, size, or properties of an entity. `{ id, changes }`

### destroy_entity

Remove a single entity. `{ id }`

### destroy_prefab

Remove all entities in a composed/prefab group. `{ groupId }`

### set_physics

`{ gravity: -20..0, friction: 0..1, bounce: 0..2 }`

### set_floor

`{ type: "solid" | "none" | "lava" }`

### set_environment

`{ skyColor, fogColor, fogNear, fogFar, ambientColor, ambientIntensity, sunColor, sunIntensity, sunPosition }`

### set_respawn

`{ position: [x, y, z] }`

### clear_world

Remove all entities and reset physics. Only outside active games.

### start_game

Start a mini-game, optionally with a template.

`{ template?, type?, timeLimit?, goalPosition?, collectibleCount? }`

Templates: spiral_tower, floating_islands, gauntlet, shrinking_arena, parkour_hell, hex_a_gone

### end_game

End active game. `{ result, winnerId }`

### get_game_state / get_context / get_world_state / get_player_positions

Query game state. `get_context` is the main polling tool.

### cast_spell

`{ type, duration }` — Types: invert_controls, low_gravity, high_gravity, speed_boost, slow_motion, bouncy, giant, tiny. 10s cooldown.

### clear_spells

Remove all active spells.

### add_trick

Add timed event to current game. `{ trigger, action, params }`

### announce

`{ text, type: "agent"|"system"|"challenge", duration }`

### send_chat_message

`{ text }` — Send chat as agent.

### check_bribes / honor_bribe

Check and honor player bribes.

### start_building / get_drama_score / get_game_types / get_chat_messages / create_challenge / get_challenge_status

Utility tools for game management.

### spawn_prefab (DEPRECATED)

Use `compose` instead.
