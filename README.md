# Lantern M0.2 / Blast Lab

A browser-first fixed-step X/Z simulation for inspecting collision, fireball explosions, physical knockback, map-colliding sparks, and bounded runtime state before a production renderer is introduced.

## Run

```bash
npm start
```

Open <http://127.0.0.1:4173/>. The project has no runtime or development dependencies beyond Node.js 20+ and a modern desktop browser.

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
- Use **Spark walls** to bypass or enable particle/map sweeps. **Ground bounce** remains a separate vertical behavior.

## Scenario editor

Choose Wall, Rock .1m, Rock .3m, Rock .9m, or Erase from the authoring palette. LMB applies the selected tool and RMB erases. Invalid placements over a wall, the player, or another authored/active body are rejected.

Scenario JSON v2 stores the grid, player spawn, and authored rocks. Legacy map v1 JSON still loads as a scenario with no rocks. Save exports authored positions, while **Restore positions** reconstructs the player and rocks and clears transient projectiles, particles, and motion.

## Physics model

The player is 75 kg. Rock mass is derived from a 2,600 kg/m3 stone density and spherical volume: about 10.9 kg at 0.1m radius, 294 kg at 0.3m, and 7,940 kg at 0.9m. Rocks collide with walls, the player, and one another.

An explosion applies an instantaneous, radial impulse to bodies within 2.5m. Surface-distance falloff, projected body area, and mass determine velocity change. Solid map cells completely block the impulse ray.

The visual spark shower remains presentation-only. Spark centers sweep against solid map cells and map boundaries, may ricochet for their existing lifetime, and ignore the player, rocks, other particles, and gameplay force. Walls are infinitely tall for this X/Z test; particle Y does not bypass them. Wall response retains 80% of normal speed and 95% of tangential speed. Ground bounce is unchanged and independent.

See [lantern_mvp_blast_physics.md](./lantern_mvp_blast_physics.md) for the force model and [lantern_mvp_particle_collision.md](./lantern_mvp_particle_collision.md) for the M0.2 particle contract.

## Snapshots and recordings

Snapshots, runtime metrics, and command recordings use schema v3. Scenario JSON remains v2. A v3 recording stores the initial **Spark walls** mode and replays later flag commands at their original tick boundaries. Schema-v2 recordings replay with spark wall collision disabled to preserve their non-colliding particle behavior.

Particle snapshots and inspector output include each spark's wall-bounce count. Pool telemetry exposes cumulative wall bounces and collision-safety discards without copying particle impacts into the main contact history.

## Runtime boundary

`src/sim` has no DOM or Canvas dependencies. Browser input and probe mutations become commands consumed at fixed-tick boundaries. Canvas and DOM panels consume copied JSON-safe snapshots and do not mutate simulation state.

The automation surface at `window.__lantern` supports pause/resume/step/reset, snapshots and metrics, spatial queries, tile edits, scenario save/load, rock archetype queries and placement/removal, authored-state restore, command injection/export, and debug flags including `particleWallCollision`.
