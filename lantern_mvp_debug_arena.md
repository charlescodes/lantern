# Project Lantern — MVP 0: Debug Arena

> **Historical contract:** M0 is complete. The implemented solid-body/explosion-force and map-colliding-particle extensions are specified separately in `lantern_mvp_blast_physics.md` and `lantern_mvp_particle_collision.md`.

> **Status:** implementation contract · **Runtime:** browser JavaScript ES modules (`// @ts-check`) · **Goal:** prove the simulation skeleton, collision model, projectile/particle path, and debug/probe workflow before art, 3D rendering, AI, networking, audio, or lighting.

## 0. Product sentence

Build a deterministic-feeling, fixed-step **2D X/Z action simulation** in which one circular player navigates a painted floor/wall grid with momentum, casts a fireball, collides with walls, and produces height-aware ballistic particles—all observable, pausable, inspectable, reproducible, and scriptable.

**Working codename:** `Lantern` (replace later).  
**First executable:** `Lantern M0 / Debug Arena`.

## 1. Governing rules

- **Debug representation is the first renderer**, not a temporary afterthought.
- **Simulation owns truth; rendering only observes snapshots.**
- **Meters are world units; pixels are presentation.**
- **Fixed simulation:** `tickHz=60`, `dt=1/60 s`; render may run independently.
- **CPU simulation first; GPU/3D deferred.**
- **No full ECS yet.** Use explicit systems + dense typed-array pools; introduce abstraction only after repeated need.
- **No avoidable allocation in per-tick hot loops.** Preallocate bounded pools.
- Every hidden state must be exposed through UI, probes, counters, snapshots, or tests.

## 2. Coordinate + scale contract

```text
ground plane = X/Z
vertical     = Y
1 world unit = 1 meter
map cell     = 1.0 m × 1.0 m
debug scale  = 32 px/m at zoom=1
```

The observed `32 px` wall module becomes a convenient **display scale**, not simulation resolution. A later ~`1.8 m` character appears near `58 px` tall at this scale. Do not quantize motion to cells: the grid is authoring/broad-phase data; entities move continuously.

```text
player radius = 0.30 m
one-cell passage = 1.0 m wide => 0.40 m total clearance
wall cell = solid axis-aligned 1 m square
floor cell = non-solid
map MVP = 24×24 cells, bounded
```

## 3. MVP behavior

### Map/editor

- `Uint8Array(width*height)`: `0=floor`, `1=wall`.
- Edit mode: paint/erase by dragging; visible cell coordinates and tile value.
- Save/load a versioned JSON map; include width, height, cells, player spawn.
- Include one boxed room, corridor, corners, one-cell doorway, and isolated pillars for collision tests.
- Runtime collision geometry is derived directly from solid cells; mesh generation is out of scope.

### Player

```text
RMB held -> desired direction = normalize(mouseWorld - playerXZ)
desiredSpeed = tunable, default 4.5 m/s
acceleration = 22 m/s²
braking      = 28 m/s²
```

Velocity approaches desired velocity with bounded acceleration; releasing RMB approaches zero with braking. Integrate position, then resolve circle-vs-solid-cell penetration. Prevent browser context menus. The player may slide along walls and must not enter solids.

### Fireball

```text
LMB press      -> cast toward mouseWorld
radius         = 0.12 m
speed          = 9 m/s
lifetime       = 2.0 s
cooldown       = 0.20 s
projectile cap = 128
```

Spawn outside the player collider. Use swept circle/grid collision or conservative substeps so a projectile cannot tunnel through a one-cell wall. First hit => impact event, projectile removal, explosion emission.

### Explosion particles: 2.5D only

Particle state: `x,y,z,vx,vy,vz,age,lifetime,size,id`.

```text
particle cap      = 4096
impact burst      = 192–256
initial Y         = 0.10 m
gravity           = -9.81 m/s²
lifetime          = randomized 0.25–0.80 s
horizontal/vertical velocity = seeded randomized cone/sphere distribution
```

Particles do not affect gameplay and need no wall collision in M0. Ground behavior may be `kill at y<=0` or one damped bounce, controlled by one flag.

**Pool rule:** active particles/projectiles use **dense SoA + swap-and-pop** deletion. A circular buffer is reserved for fixed-history data: input commands, impact events, logs, and frame metrics. When a pool is full, reject excess spawns and increment a visible `dropped` counter.

## 4. Tick pipeline

```text
frame(now):
  accumulate elapsed time (clamped)
  while accumulator >= dt:
    sample/consume input command
    movementSystem(dt)
    playerWorldCollisionSystem()
    projectileSystem(dt)
    projectileCollisionSystem() -> impact events
    explosionEmissionSystem(events)
    particleSystem(dt)
    telemetrySystem()
    accumulator -= dt
  publish read-only render/debug snapshot
  render(snapshot, alpha)
```

Stable system order is part of the contract. Seeded RNG + resettable initial state must reproduce the same run from the same command stream. M0 does **not** promise cross-browser lockstep determinism.

## 5. Debug renderer + purpose-built probe layer

Use one Canvas2D world view plus DOM panels.

### Required overlays

- floor/wall cells; grid coordinates; solid-cell fill
- player circle, center, radius, velocity arrow, desired-velocity arrow
- projectile circles + swept segment
- particles with ground shadow; draw particle at `screenY -= y*heightScale`, plus optional vertical stem
- collision contacts/normals and corrected penetration
- mouse world coordinate and hovered cell
- fixed-tick count, accumulator, FPS, sim/render p50/p95/p99
- active/capacity/dropped counts for each pool
- current seed, paused/running state, selected entity

### Interaction

```text
Space = pause/resume
.     = exactly one simulation tick
R     = reset current seed
Shift+R = reset with new seed
E     = play/edit mode
F     = focus player
wheel = zoom
MMB drag = pan
hover = transient inspect
click = pin/unpin inspection
```

Pinned inspector shows: `kind,id,index,position,velocity,radius/cell,age/lifetime,flags`, plus raw component values. Because swap-and-pop changes pool indices, `id` must travel with the record; UI must never treat index as stable identity.

### AI-agent probe API

Expose a documented, side-effect-controlled surface:

```js
window.__lantern = {
  pause(), resume(), step(n=1), reset(seed),
  snapshot(), metrics(), queryAt(x,z),
  setTile(cx,cz,type), saveMap(), loadMap(json),
  injectCommand(command), exportCommandLog(),
  setDebugFlag(name,value)
};
```

`snapshot()` returns bounded JSON-safe data, schema version, seed, tick, player state, pool counts, and recent events. Mutations occur only through commands at tick boundaries.

## 6. Data layout

```text
Map: Uint8Array
Player: singleton numeric state
Projectiles: bounded typed-array SoA + activeCount
Particles: bounded typed-array SoA + activeCount
Events/commands/metrics: bounded ring buffers
Renderer snapshot: copied/packed read model; no renderer mutation of simulation
```

Prefer `Float32Array` for MVP kinematics and fixed `dt`. Do not add fixed-point arithmetic until replay/network requirements and divergence tests justify its complexity. Avoid object-per-particle/projectile and `.splice()` in hot paths.

## 7. Automated checks

1. **Grid mapping:** world↔cell conversion correct at boundaries and negative/out-of-range coordinates.
2. **Collision:** player never remains inside a wall after a tick; corner sliding is stable; one-cell doorway is passable.
3. **Projectile:** high-speed shot cannot cross a solid cell without impact.
4. **Pool invariant:** `0<=activeCount<=capacity`; swap-and-pop copies every component including `id`.
5. **Replay:** same seed + command log => matching player/projectile state for the tested browser/runtime.
6. **Inspector:** hover/pin resolves stable IDs after pool compaction.
7. **Soak:** 10-minute cast/move stress run has bounded memory, no uncaught errors, and stable 60 Hz simulation; record hardware and `sim p99`, target `<8 ms`.

## 8. Definition of done

M0 is complete when a fresh clone can:

1. launch locally in a browser;
2. edit/save/load the test grid;
3. move the circular player with RMB momentum and wall sliding;
4. cast LMB fireballs that reliably impact walls;
5. render a seeded 2.5D particle burst with gravity;
6. pause, single-step, reset, inspect, export a snapshot/command log, and expose telemetry;
7. pass the automated checks above.

## 9. Explicit non-goals

No monsters/AI/navmesh, destructible walls, items, health/damage, sound propagation, true sight/lighting, multiplayer, rollback, full ECS, GPU physics/particles, WebGL/WebGPU world renderer, sprites, animation, orthographic/isometric camera, asset pipeline, or production editor.

## 10. Next slice after M0

Add a render adapter without changing simulation truth:

```text
orthographic camera
yaw ≈45°
downward pitch tunable ≈45–60° from horizontal
X/Z simulation + Y visual height -> 3D instance buffer
blocked wall/floor/player geometry only
```

Then add **one** perception vertical: either sound-event propagation or light/visibility—not both—using the same probe-first pattern.
