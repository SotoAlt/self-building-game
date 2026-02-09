---
name: game-world
description: Control the 3D game world — compose creatures and objects, run mini-games, cast spells. ALWAYS use compose to spawn.
version: 0.24.1
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
- Utility: bounce_pad, checkpoint, speed_strip, conveyor_belt, wind_zone
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

### spawn_entity (DEPRECATED)

Use `compose` instead. spawn_entity only creates single boxes.

### modify_entity

Update position, size, or properties of an entity. `{ id, changes }`

### destroy_entity

Remove a single entity. `{ id }`

### destroy_prefab

Remove all entities in a composed/prefab group. `{ groupId }`

### set_physics

`{ gravity: -20..0, friction: 0..1, bounce: 0..2 }`

### set_hazard_plane

Rising lava/water plane that kills players below its height during gameplay.

`POST /api/world/hazard-plane { active: true, type: "lava"|"water", startHeight: -5, riseSpeed: 0.5, maxHeight: 35 }`

Rises during `playing` phase only. Deactivates automatically on game end.

### Entity Surface Properties

Platform children can have special surface properties:
- `isIce: true` — Slippery surface, players slide with very low friction
- `isConveyor: true, conveyorDir: [x,0,z], conveyorSpeed: 1-20` — Pushes players in a direction
- `isWind: true, windForce: [x,y,z]` — Trigger zone that pushes players with wind force

### set_floor

`{ type: "solid" | "none" | "lava" }`

### set_environment

`{ skyColor, fogColor, fogNear, fogFar, ambientColor, ambientIntensity, sunColor, sunIntensity, sunPosition }`

### set_respawn

`{ position: [x, y, z] }`

### clear_world

Remove all entities and reset physics. Only outside active games.

### start_game

Start a mini-game, optionally with a template. Each template has a default game type.

`{ template?, type?, timeLimit?, goalPosition?, collectibleCount? }`

**6 Game Types:**
- `reach` — Race to touch the goal trigger
- `collect` — Collect the most items before time runs out
- `survival` — Last player standing wins
- `king` — Control hill zones to earn points (1 pt/sec as sole occupant)
- `hot_potato` — Pass the curse before the sub-timer eliminates you
- `race` — Hit all checkpoints in order

**Templates by type:**
| Type | Templates |
|------|-----------|
| reach | spiral_tower, gauntlet, parkour_hell, slime_climb, wind_tunnel |
| collect | floating_islands, treasure_trove |
| survival | shrinking_arena, hex_a_gone, ice_rink |
| king | king_plateau, king_islands |
| hot_potato | hot_potato_arena, hot_potato_platforms |
| race | checkpoint_dash, race_circuit |

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

Use `compose` instead. spawn_prefab is superseded by compose.

---

## Visual Style Guide

The game uses **cel-shaded toon rendering** with cartoon outlines and bloom glow. Design your compositions to look great in this style:

- **Contrasting colors**: Use bold, saturated colors. Light parts next to dark parts pop.
- **Emissive highlights**: Set `emissive: true` on eyes, flames, crystals, magical effects — they glow with bloom.
- **Overlapping shapes**: Layer shapes with slightly different colors to create depth (e.g. multiple sphere layers for foliage).
- **Organic shapes for creatures**: horn, tentacle, wing, dome, teardrop — these look alive.
- **Geometric shapes for structures**: box, column, cylinder, arch — these look built.
- **Scale reference**: A player is 1.8 units tall. A tree is ~5 units. A small decoration is ~1 unit.
- **Textures are auto-applied**: Platforms get checkerboards, breakable platforms get hex grids, conveyors get animated stripes. You don't need to worry about this.
