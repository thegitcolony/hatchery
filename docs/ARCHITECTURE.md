# Architecture

## Overview

Hatchery is a single-page browser application built with vanilla JavaScript and HTML5 Canvas.
No frameworks, no build step, no server required for the core experience.

## Core Systems

### World Generation
- 128x128 tile grid (16px tiles = 2048x2048 pixel world)
- 9 biomes arranged in a 3x3 grid
- Procedural decoration placement (ground, deco, feature tiles)
- Each biome has a task type affinity

### Creature System
- **Species**: 7 base species with unique shapes (Glimmer, Ember, Whisp, Thunk, Shade, Bloom, Crux)
- **DNA/Stats**: intelligence, creativity, strength, speed, luck (5-20 base range)
- **Body Parts**: horns, wings, tail, eye count, body scale -- unlocked through leveling
- **Names**: procedurally generated from prefix + suffix tables

### AI Behavior Engine
```
idle -> [find task?] -> moving_to_task -> working -> [success/fail] -> idle
  |                                                                     
  +---> [no task] -> wander -> idle                                     
```

- State machine per creature with timers
- Task selection: nearest unclaimed task
- Success probability: relevant stat / 20 + luck bonus
- Stat growth on success, luck penalty on failure

### Evolution System
- XP from completed tasks (difficulty * 10 + random bonus)
- Level thresholds: level * 50 XP
- Mutations at milestone levels:
  - Level 3: 50% chance of horns
  - Level 5: 50% chance of wings (+5 speed)
  - Level 4+: gradual body scale increase

### Task System
- Tasks spawn in biomes matching their type
- Difficulty 1-5 with proportional XP rewards
- Tasks are claimed when a creature targets them
- Auto-spawn maintains task density relative to creature count

### Rendering Pipeline
1. Clear canvas
2. Draw visible world tiles (camera-culled)
3. Draw task orbs with pulse animation
4. Draw egg hatching animations
5. Draw creatures (shadow, body, features, mutations)
6. Draw particles
7. Update UI overlays

### Camera System
- Click-and-drag panning
- Bounded to world extents
- Minimap shows full world with creature/task positions + viewport indicator

## Biome Map

```
+----------+----------+----------+
| Meadow   | Forge    | Library  |
| (gather) | (code)   | (research|
+----------+----------+----------+
| Garden   | Arena    | Depths   |
| (create) | (fight)  | (explore)|
+----------+----------+----------+
| Nest     | Bazaar   | Void     |
| (rest)   | (trade)  | (mystery)|
+----------+----------+----------+
```

## File Structure

```
hatchery/
  index.html          # entire game (single file)
  serve.js            # local dev server
  package.json        # project metadata
  README.md           # project overview
  LICENSE             # MIT
  CONTRIBUTING.md     # contribution guide
  docs/
    ARCHITECTURE.md   # this file
    ROADMAP.md        # feature roadmap
```

## Future Architecture

As features grow, the codebase will split into modules:
- `engine/world.js` -- world generation and tile management
- `engine/creatures.js` -- creature spawning, DNA, evolution
- `engine/behavior.js` -- AI state machine and decision-making
- `engine/tasks.js` -- task spawning and resolution
- `engine/render.js` -- canvas rendering pipeline
- `engine/breeding.js` -- genetic crossover and mutation