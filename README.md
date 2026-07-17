# Lantern M0 / Debug Arena

A browser-first fixed-step 2D X/Z simulation proving Lantern's simulation, collision, projectile, particle, and probe boundaries before a production renderer is introduced.

## Run

```bash
npm start
```

Open <http://127.0.0.1:4173/>. The project has no runtime or development dependencies beyond Node.js 20+ and a modern desktop browser.

## Validate

```bash
npm test
npm run check
```

## Controls

- Hold RMB to accelerate toward the pointer; release it to brake.
- Press LMB to cast a fireball.
- Press `Space` to pause, `.` to pause and advance exactly one tick, `R` to reset the current seed, and `Shift+R` to choose a new seed.
- Press `E` to switch play/edit mode. In edit mode, drag LMB to paint walls and RMB to erase them.
- Press `F` to focus the player. Use the wheel to zoom and MMB drag to pan.
- Hover to inspect transiently. Click to pin or unpin an entity by stable ID.

## Runtime boundary

`src/sim` contains no DOM or Canvas dependencies. Browser input and probe mutations become commands consumed at fixed-tick boundaries. Canvas and DOM panels consume copied JSON-safe snapshots and do not mutate simulation state.

The documented automation surface is available at `window.__lantern`. It supports pause/resume/step/reset, bounded snapshots and metrics, spatial queries, tick-boundary map mutation, map serialization, command injection/export, and debug flags.
