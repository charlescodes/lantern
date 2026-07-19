# Project Lantern - MVP 0.2: Map-Colliding Sparks

> **Status:** implemented supplement to M0 and M0.1
> **Runtime:** browser JavaScript ES modules
> **Purpose:** make fireball sparks respect solid map cells without turning presentation particles into gameplay bodies.

The M0 simulation skeleton and M0.1 blast-force model remain authoritative for their original scopes. This document owns particle/map collision, its observability, and recording compatibility.

## 1. Player-visible behavior

- Fireball sparks collide with solid cells and map boundaries in X/Z.
- Sparks may ricochet repeatedly until their existing lifetime expires.
- The rendered particle radius may overlap a wall slightly because collision uses the particle center as a point.
- Walls are infinitely tall for particles. A spark's Y position never allows its center to cross a solid X/Z cell.
- Particles ignore the player, rocks, and other particles. They still cause no damage, force, or gameplay event.
- **Spark walls** controls runtime wall sweeps and defaults enabled.
- **Ground bounce** remains an independent vertical toggle with its M0 behavior.

The existing burst and ballistic ranges are unchanged:

```text
burst count              = 224
particle capacity        = 4,096
lifetime                 = 0.25-0.80 s
maximum horizontal speed = 7 m/s
gravity                  = -9.81 m/s2
initial Y                = 0.10 m
```

## 2. Emission and safe spawn placement

The seeded emitter first constructs the same bounded horizontal velocity as before. If that velocity points into the impacted surface, its normal component is mirrored into the outward half-plane. Mirroring preserves the sampled horizontal speed. Vertical velocity, lifetime, size, RNG sequencing, gravity, capacity, and burst count retain their existing ranges.

Every attempted particle spawn checks its X/Z point against the map, even when **Spark walls** is disabled. A reusable correction record moves an invalid point along the impact normal for at most eight solid-cell exits. If it still cannot reach a floor cell, the particle is rejected and the particle pool's cumulative `collisionDiscards` counter increments.

This bounded correction prevents bad corner or boundary contacts from creating particles inside walls without allowing an unbounded map search.

## 3. Swept point collision

`sweepPointAgainstGrid` is an allocation-free grid DDA. The caller provides one reusable output record:

```text
x, z       = earliest hit position
time       = normalized time in [0,1] along the requested sweep
cx, cz     = deterministic solid cell
nx, nz     = outward contact normal
```

The query visits crossed grid cells instead of sampling only the endpoint. Axial crossings return an axis normal. Exact corner crossings test both adjacent cells and the diagonal cell; closed or diagonal-only corners return a deterministic cell and a combined outward normal. Out-of-bounds cells use the map's existing solid-boundary rule.

Particle endpoints are rounded to the same `Float32` representation stored by the pool before the sweep. This prevents a mathematically safe double-precision endpoint from rounding into a solid cell after collision has already been checked.

## 4. Ricochet response

Each particle processes at most four wall contacts per fixed tick. After a hit it moves a small representable distance along the outward normal, reflects its horizontal velocity, and continues through the unused fraction of the timestep.

For incoming horizontal velocity `v` and outward unit normal `n`:

```text
normalSpeed = dot(v, n)
tangent     = v - normalSpeed * n
v'          = tangent * 0.95 - normalSpeed * 0.80 * n
```

Vertical velocity is not part of wall response. Gravity and the later ground check run independently. If the four-contact safety bound is reached, the particle remains at the last safe contact instead of consuming the remaining movement through a wall.

## 5. Pool state and observability

`ParticlePool` adds:

```text
wallBounceCount  Uint16Array, one value per active particle
wallBounces      cumulative reflected wall contacts
collisionDiscards cumulative failed spawn/runtime corrections
```

Swap-and-pop copies `wallBounceCount` with every other particle component and stable ID. Reset clears both cumulative counters.

Snapshots and inspector records expose `wallBounceCount`. Particle-pool telemetry exposes `wallBounces` and `collisionDiscards`. Particle wall impacts intentionally do not enter the 256-entry player/rock contact history; a full burst could otherwise erase more useful gameplay contact data every tick.

## 6. Schemas and replay

Snapshot, fixed-runtime metric, and command-recording schema is version 3. Scenario JSON remains version 2.

Schema-v3 recordings store the initial `particleWallCollision` mode in their configuration. Later changes continue to be normal tick-boundary `setDebugFlag` commands, so replay reconstructs the original mode sequence.

Schema-v2 recordings start replay with particle wall collision disabled. Those recordings predate map-colliding sparks, so this preserves their non-colliding runtime behavior.

## 7. Pipeline

```text
create explosion event and apply gameplay impulse
construct seeded outward particle velocity
sanitize particle spawn against map (always)
advance particle age and vertical velocity
if Spark walls:
  sanitize unexpected embedded point
  sweep point through grid
  reflect and consume unused time, up to four contacts
else:
  advance X/Z without a wall query
advance Y
apply unchanged Ground bounce or ground kill
publish particle state and pool counters
```

## 8. Verification and performance boundary

Automated coverage includes:

- axial, diagonal, closed-corner, and out-of-bounds sweeps
- high-speed one-cell-wall tunneling prevention
- outward-half-plane emission and exact reflection retention
- bounded spawn correction and counted rejection
- repeated corridor ricochet, floor-cell containment, and lifetime expiry
- no player or rock interaction
- independent wall and ground toggles
- swap-and-pop, snapshot, inspector, schema-v3 replay, and schema-v2 compatibility
- the existing 36,000-tick soak plus a 4,096-particle corridor stress case

The performance target remains simulation p99 below 8 ms with bounded pools and histories. Collision work is proportional to active particles and the small number of grid cells crossed during their fixed-tick movement.

## 9. Explicit non-goals

- particle/player, particle/rock, or particle/particle collision
- damage, impulse, pressure, ownership, teams, or gameplay contacts from particles
- particle radius collision or rendered-shape-perfect contact
- finite wall height or particle traversal over walls
- lifetime extension or a bounce-count kill rule
- GPU particle physics or a general physics-engine integration
