# Enemy Dead-Body Lifecycle Checkpoint

> **Status:** implemented development checkpoint after Lantern 0.9.0
>
> **Compatibility:** application/package version remains `0.9.0`; snapshot and
> recording schema advances to v10; performance-report schema advances to v3;
> scenario v3, map v1, Fireball definition v1, and schemas v2-v9 remain frozen.

Enemy death now transfers the wizard out of the live AI pool and into an
enemy-specific, bounded dead-body lifecycle. This is deliberately not a generic
remains, decal, or visual-inert entity framework. Other persistent effects can
copy the pattern if their requirements become concrete.

## Authoritative lifecycle

Death transfer happens after projectile processing on the lethal tick. The live
enemy row is removed immediately, so it no longer perceives, navigates,
regenerates, casts, or participates in any AI loop. A compact dynamic row keeps
only stable identity, spawn sequence, death tick, X/Z transform and previous
transform, velocity, normalized last facing, radius, mass, inverse mass, quiet
progress, and a per-tick interaction flag.

The default dynamic pool contains 16 dense SoA rows and accepts a replay-pinned
capacity from 1 through 64. While dynamic, a body remains a `0.3m`, `75kg` X/Z
circle. It collides with the grid, player, living enemies, rocks, and other
dynamic dead bodies. Either team's Fireball can hit it; a hit stops the
projectile and the resulting grid-occluded blast applies impulse but never
health damage. Dynamic bodies also block actor/rock placement and encounter
spawn safety. The cylinder's visual fall does not rotate or elongate this
authoritative circular footprint.

A dynamic body becomes inert on the first applicable boundary:

- after the 36-tick visual fall, 30 consecutive ticks at or below `0.05m/s`
  with no actor, rock, body, or blast interaction settles it as `quiet`;
- age 180 ticks settles it as `timeout`;
- when the dynamic pool is full, the oldest row by death tick and stable ID is
  settled as `capacity` before the new death transfers.

Settlement copies the cold fields into a typed FIFO ring, then swap-removes the
dynamic row. The inert ring defaults to 100 entries and accepts a replay-pinned
capacity from 1 through 1,000. Inert bodies have no collision, projectile,
blast, navigation, placement, AI, or per-tick state work. When full, inserting a
new body overwrites the oldest entry. Reset and authored-state restore clear
both stores and their telemetry.

## Presentation

Both renderers consume the same copied dead-body snapshot and shared fall-pose
helper. The body uses a dark, desaturated enemy material with no health bar or
facing marker and remains under TrueSight concealment.

Three.js reuses the enemy cylinder geometry in one resident instanced pool sized
to the configured dynamic plus inert capacities. Over 36 ticks it tilts the
cylinder 90 degrees toward last facing while its center moves from `Y=0.8m` to
`Y=radius`; X/Z stays centered on the authoritative circle. Canvas2D draws the
same progression as an oriented capsule whose footprint grows from the upright
circle to the `1.6m` body length. This is a renderer-only death animation, not
ragdoll or 3D rigid-body authority.

## Replay and observability

Schema-v10 recordings require `enemy-dead-body-v1`,
`dynamicDeadBodyCapacity`, and `inertDeadBodyCapacity`. Replay constructs those
capacities before tick zero. Schemas v2-v9 force profile `none`, so old recordings
retain immediate enemy removal and cannot acquire bodies from current defaults.

Snapshots expose ordered `deadBodies.dynamic` and `deadBodies.inert` arrays plus
pool capacity, quiet/timeout/capacity settlement, speed-clamp, and FIFO-overwrite
metrics. The developer toolbox shows both occupancy bars and counters.
Performance-report v3 records capacity, maximum occupancy, forced settlement,
and overwrite maxima. `npm run test:soak:dead-bodies` exercises the supported
64-dynamic/1,000-inert ceiling for 7,200 fixed ticks.

Automated tests cover pool compaction and FIFO order, every dynamic collision
pair, both Fireball teams, inert non-interaction, lifecycle boundaries,
overflow, reset, replay compatibility, broadphase equivalence, Canvas/Three
pose parity, TrueSight material use, and the maximum-capacity soak. A real
browser/GPU review remains the acceptance gate for the look of the fall,
capsule silhouette, concealment edge, and large corpse piles.
