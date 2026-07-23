# Lantern M0.2.5 / Blast Lab

A browser-first fixed-step X/Z simulation for inspecting collision, fireball explosions, physical knockback, size-linked ember lifecycles, and bounded runtime state. Canvas2D remains the default regression presentation; an opt-in Three.js 3D and dynamic-lighting vertical consumes the same read-only snapshots.

## Run

```bash
npm start
```

Open <http://127.0.0.1:4173/>. Development requires Node.js 20+ and a modern desktop browser.

Three.js `0.184.0` is the single pinned runtime dependency. `npm install` restores it from `package-lock.json`.

Presentation routes:

- <http://127.0.0.1:4173/?renderer=2d> — Canvas2D, also the default.
- <http://127.0.0.1:4173/?renderer=3d> — Three.js with automatic WebGPU/WebGL 2 selection.
- <http://127.0.0.1:4173/?renderer=3d&backend=webgl> — forced WebGL 2 fallback test.

## Validate

```bash
npm test
npm run check
npm run test:soak
```

## Play controls

- Hold RMB to accelerate toward the pointer; release it to brake.
- Press LMB to cast a fireball. Fireballs explode on the first wall or rock they hit.
- Press `Space` to pause, `.` to pause and advance one tick, `R` to reset the current seed, and `Shift+R` to choose a new seed.
- Press `E` to enter the paused scenario editor. Leaving edit mode restores the previous paused/running state.
- Press `F` to focus the player. Use the wheel to zoom and MMB drag to pan.
- Hover to inspect transiently. Click to pin or unpin an entity by stable ID.
- Use **Spark walls** to bypass or enable particle/map sweeps. **Ground bounce** defaults on and independently controls the single ground rebound.

## Spatial units and resolution

Simulation truth uses meters, seconds, and kilograms. Player, rock, projectile, blast, and particle measurements are continuous metric values. The static collision map is a separate `1m × 1m` occupancy grid; entities are circles moving continuously across it rather than pixel- or cell-locked bodies.

Both presentation cameras store a visible world height, defaulting to `24m` with a `4-64m` zoom range. Their world-to-viewport scale is derived from the current canvas bounds, so window size and device-pixel ratio do not alter simulation scale. The 3D camera uses 45 degree yaw and 55 degree downward pitch; pointer rays intersect `Y=0`, preserving X/Z commands for movement, casting, editing, and selection. Canvas backing pixels, fixed-screen debug strokes, text size, and pointer click tolerance remain isolated presentation concerns.

There is no component-mask or ECS dispatch layer yet. Systems explicitly process the player and bounded typed-array pools. A future lighting field should declare its own metric cell size and consume explicit light/occluder data; it should not inherit either the collision grid resolution or the canvas raster resolution.

## Scenario editor

Choose Wall, Rock .1m, Rock .3m, Rock .9m, or Erase from the authoring palette. LMB applies the selected tool and RMB erases. Invalid placements over a wall, the player, or another authored/active body are rejected.

Scenario JSON v2 stores the grid, player spawn, and authored rocks. Legacy map v1 JSON still loads as a scenario with no rocks. Save exports authored positions, while **Restore positions** reconstructs the player and rocks and clears transient projectiles, particles, and motion.

## Physics model

The player is 75 kg. Rock mass is derived from a 2,600 kg/m3 stone density and spherical volume: about 10.9 kg at 0.1m radius, 294 kg at 0.3m, and 7,940 kg at 0.9m. Rocks collide with walls, the player, and one another.

An explosion applies an instantaneous, radial impulse to bodies within 2.5m. Surface-distance falloff, projected body area, and mass determine velocity change. Solid map cells completely block the impulse ray.

The visual spark shower remains presentation-only. Spark centers sweep against solid map cells and map boundaries and ignore the player, rocks, other particles, and gameplay force. Walls are infinitely tall for this X/Z test; particle Y does not bypass them. Wall response retains 80% of normal speed and 95% of tangential speed.

Maximum spark size remains randomly sampled from `0.025-0.085m`. Size now drives a seeded `0.18-1.10s` lifetime, so larger embers persist longer while every visible radius shrinks smoothly toward zero. A lower-biased vertical distribution sends roughly 60% of a full burst to the ground. The first ground contact retains 45% vertical and 82% horizontal speed; the next ground contact settles the ember at `Y=0`, where it slows and remains visible until its assigned lifetime expires.

See [lantern_mvp_blast_physics.md](./lantern_mvp_blast_physics.md) for the force model, [lantern_mvp_particle_collision.md](./lantern_mvp_particle_collision.md) for M0.2 wall behavior, and [lantern_mvp_particle_lifecycle.md](./lantern_mvp_particle_lifecycle.md) for M0.2.5 lifecycle behavior.

## 3D presentation vertical

The opt-in 3D route renders a floor, 2.5m instanced wall cells, a 1.6m player block, low-poly rocks, chest-height fireballs, and one instanced spark mesh using existing particle `x/y/z` and `currentSize` values. It adds cool fill lighting plus a fixed pool of eight shadowless point lights prioritized as explosion pulses, fireballs, then stable leases on large/young sparks.

Dynamic lights are visual-only. They cannot affect AI, visibility, collision, damage, replay, or command authority. Bloom and directional shadows default off. See [lantern_3d_presentation.md](./lantern_3d_presentation.md) for the full contract, performance thresholds, and the browser/human acceptance gate that must pass before 3D can become the default.

## Snapshots and recordings

Snapshots, runtime metrics, and command recordings use schema v4. Scenario JSON remains v2. A v4 recording stores the particle profile plus initial **Ground bounce** and **Spark walls** modes, then replays later flag commands at their original tick boundaries. Schema-v3 recordings use the exact M0.2 particle profile; schema-v2 recordings additionally disable spark wall collision.

Particle snapshots retain maximum `size` and expose derived `currentSize`. Inspector output uses the current radius and reports its maximum separately. Pool telemetry exposes cumulative wall bounces, ground bounces, and collision-safety discards without copying particle impacts into the main contact history.

## Runtime boundary

`src/sim` has no DOM, Canvas, or Three.js dependencies. Browser input and probe mutations become commands consumed at fixed-tick boundaries. Canvas2D, Three.js, and DOM panels consume copied JSON-safe snapshots and do not mutate simulation state.

The automation surface at `window.__lantern` supports pause/resume/step/reset, snapshots and metrics, spatial queries, tile edits, scenario save/load, rock archetype queries and placement/removal, authored-state restore, command injection/export, and debug flags including `particleWallCollision`.

`window.__lantern.presentation()` reports renderer/backend, draw calls, triangles, active light count, snapshot timing, render CPU timing, and visual flags. `setPresentationFlag(name, value)` accepts `dynamicLights`, `bloom`, and `shadows` without adding simulation commands.
