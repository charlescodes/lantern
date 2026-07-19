# Lantern M0.1 / Blast Lab

A browser-first fixed-step X/Z simulation for inspecting collision, fireball explosions, physical knockback, and bounded runtime state before a production renderer is introduced.

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

## Scenario editor

Choose Wall, Rock .1m, Rock .3m, Rock .9m, or Erase from the authoring palette. LMB applies the selected tool and RMB erases. Invalid placements over a wall, the player, or another authored/active body are rejected.

Scenario JSON v2 stores the grid, player spawn, and authored rocks. Legacy map v1 JSON still loads as a scenario with no rocks. Save exports authored positions, while **Restore positions** reconstructs the player and rocks and clears transient projectiles, particles, and motion.

## Physics model

The player is 75 kg. Rock mass is derived from a 2,600 kg/m3 stone density and spherical volume: about 10.9 kg at 0.1m radius, 294 kg at 0.3m, and 7,940 kg at 0.9m. Rocks collide with walls, the player, and one another.

An explosion applies an instantaneous, radial impulse to bodies within 2.5m. Surface-distance falloff, projected body area, and mass determine velocity change. Solid map cells completely block the impulse ray. The visual particle shower remains presentation-only and does not participate in blast force or wall collision.

See [lantern_mvp_blast_physics.md](./lantern_mvp_blast_physics.md) for the exact model and boundaries.

## Runtime boundary

`src/sim` has no DOM or Canvas dependencies. Browser input and probe mutations become commands consumed at fixed-tick boundaries. Canvas and DOM panels consume copied JSON-safe snapshots and do not mutate simulation state.

The automation surface at `window.__lantern` supports pause/resume/step/reset, snapshots and metrics, spatial queries, tile edits, scenario save/load, rock archetype queries and placement/removal, authored-state restore, command injection/export, and debug flags.
