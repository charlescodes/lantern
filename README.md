# Lantern 0.3.1 / Blast Lab

A browser-first fixed-step X/Z simulation for inspecting collision, fireball explosions, physical knockback, size-linked ember lifecycles, and bounded runtime state. Canvas2D remains the default regression presentation; an opt-in Three.js 3D and dynamic-lighting vertical consumes the same read-only snapshots.

## Run

```bash
npm start
```

The server prints clickable links for Canvas2D, automatic 3D, and forced WebGL 2. Development requires Node.js 20+ and a modern desktop browser.

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

## Documentation

Start with the [documentation index](./docs/README.md). It separates the durable [platform contract](./docs/platform.md), chronological milestone contracts, and regression notes. Release `0.3.1` is the current application patch; the `0.3.0` presentation milestone, schema v4, scenario v2, and frozen `m0.2.5-balanced` particle profile retain their independent compatibility meanings.

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

Player velocity remains split between control-driven locomotion and damped external momentum. Player/rock contact now resolves genuine body or external momentum through the external channel, while controller-driven closure reacts through locomotion with zero restitution. This prevents held movement against a heavy rock from storing delayed recoil without suppressing real impact knockback. See the [dynamic-contact velocity-channel regression contract](./docs/notes/dynamic-contact-velocity-channels.md).

An explosion applies an instantaneous, radial impulse to bodies within 2.5m. Surface-distance falloff, projected body area, and mass determine velocity change. Solid map cells completely block the impulse ray.

The visual spark shower remains presentation-only. Spark centers sweep against solid map cells and map boundaries and ignore the player, rocks, other particles, and gameplay force. Walls are infinitely tall for this X/Z test; particle Y does not bypass them. Wall response retains 80% of normal speed and 95% of tangential speed.

Maximum spark size remains randomly sampled from `0.025-0.085m`. Size now drives a seeded `0.18-1.10s` lifetime, so larger embers persist longer while every visible radius shrinks smoothly toward zero. A lower-biased vertical distribution sends roughly 60% of a full burst to the ground. The first ground contact retains 45% vertical and 82% horizontal speed; the next ground contact settles the ember at `Y=0`, where it slows and remains visible until its assigned lifetime expires.

See [0.1.0 blast physics](./docs/milestones/0.1.0-blast-physics.md) for the force model, [0.2.0 particle collision](./docs/milestones/0.2.0-particle-collision.md) for wall behavior, and [0.2.5 particle lifecycle](./docs/milestones/0.2.5-particle-lifecycle.md) for size-linked lifetime behavior.

## 3D presentation vertical

The opt-in 3D route renders a floor, 2.5m instanced wall cells, a 1.6m player block, low-poly rocks, chest-height fireballs, and one instanced spark mesh using existing particle `x/y/z` and `currentSize` values. It adds cool fill lighting plus a fixed pool of eight shadowless point lights prioritized as explosion pulses, fireballs, then stable leases on large/young sparks.

Dynamic lights are visual-only. They cannot affect AI, visibility, collision, damage, replay, or command authority. Bloom and directional shadows default off. See the [0.3.0 3D presentation contract](./docs/milestones/0.3.0-3d-presentation.md) and [renderer regression notes](./docs/notes/0.3.0-renderer-regressions.md) for the full boundary, warmup lifecycle, and bugs that must remain covered. Canvas2D remains the default regression route.

## Snapshots and recordings

Snapshots, runtime metrics, and command recordings use schema v4. Scenario JSON remains v2. A v4 recording stores the particle profile plus initial **Ground bounce** and **Spark walls** modes, then replays later flag commands at their original tick boundaries. Schema-v3 recordings use the exact M0.2 particle profile; schema-v2 recordings additionally disable spark wall collision.

Particle snapshots retain maximum `size` and expose derived `currentSize`. Inspector output uses the current radius and reports its maximum separately. Pool telemetry exposes cumulative wall bounces, ground bounces, and collision-safety discards without copying particle impacts into the main contact history.

## Runtime boundary

`src/sim` has no DOM, Canvas, or Three.js dependencies. Browser input and probe mutations become commands consumed at fixed-tick boundaries. Canvas2D, Three.js, and DOM panels consume copied JSON-safe snapshots and do not mutate simulation state.

The automation surface at `window.__lantern` supports pause/resume/step/reset, snapshots and metrics, spatial queries, tile edits, scenario save/load, rock archetype queries and placement/removal, authored-state restore, command injection/export, and debug flags including `particleWallCollision`.

`window.__lantern.presentation()` reports renderer/backend, warmup duration, active/resident lights, draw counts, cached presentation phase timings, recent 32 ms spikes, snapshot timing, render CPU timing, and visual flags. Runtime metrics include raw frame spacing plus clamp/discard totals. `resetPerformanceMetrics()` clears only these timing histories and spike records; `setPresentationFlag(name, value)` accepts `dynamicLights`, `bloom`, and `shadows` without adding simulation commands.
