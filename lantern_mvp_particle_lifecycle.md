# Project Lantern - MVP 0.2.5: Size-Linked Ember Lifecycles

> **Status:** implemented supplement to M0.2
> **Runtime:** browser JavaScript ES modules
> **Purpose:** connect visible spark size, lifetime, shrink, and ground response while retaining bounded presentation-only particles.

M0.2 remains authoritative for map collision. This document owns particle emission height, size-linked lifetime, age-based visible radius, the single ground bounce, and schema-3 lifecycle compatibility.

## 1. Player-visible behavior

- Maximum radius stays uniformly randomized from `0.025-0.085m`.
- Larger sparks generally live longer; nearby sizes retain slight seeded lifetime variation.
- Spark and ground-shadow radius shrink smoothly toward zero over normalized age.
- Emission preserves some high sparks but biases the shower toward low arcs and ground contact.
- Ground bounce defaults enabled and remains independent from **Spark walls**.
- Each particle may bounce from `Y=0` once. Its next ground contact settles it.
- Bounce never extends lifetime, and particle collision remains point-based in X/Z.

Burst count stays 224 and capacity stays 4,096.

## 2. Balanced M0.2.5 profile

For sampled maximum size `size`:

```text
s        = (size - 0.025) / (0.085 - 0.025)
lifetime = clamp(0.22 + 0.83*s + (lifetimeRoll - 0.5)*0.12, 0.18, 1.10)
vy       = 0.6 + 5.9*verticalRoll^2
```

The six seeded emission draws retain their existing order: horizontal angle, horizontal speed, outward bias, vertical roll, lifetime roll, and size roll. This keeps RNG advancement aligned between supported profiles while allowing their derived particle values to differ.

The squared vertical roll retains occasional `6.5m/s` launches while concentrating more particles near the `0.6m/s` minimum. A full seeded burst should place 50-70% of particles on the ground before lifetime expiry.

## 3. Radius over lifetime

The pool's existing `size` component remains maximum radius. Current visible radius is derived without another hot-loop array:

```text
remainingLife = 1 - clamp(age / lifetime, 0, 1)
currentSize   = size * remainingLife^0.65
```

Snapshots expose both `size` and `currentSize`. The renderer uses `currentSize` for the spark and its shadow. Hover/picking uses the current radius plus the existing selection tolerance. Inspector `radius` is current size and `maxRadius` is the sampled maximum.

Radius does not affect wall collision, ground contact, damage, or force.

## 4. Ground response

On the first `Y<=0` contact while **Ground bounce** is enabled:

```text
y  = 0
vy = abs(vy) * 0.45
vx = vx * 0.82
vz = vz * 0.82
```

The per-particle `bounced` flag prevents another rebound. On later ground contacts, the balanced profile clamps `y` and `vy` to zero and retains 82% of horizontal speed per fixed tick, creating a short slide. The ember remains active and continues shrinking until its assigned age limit removes it. Disabling **Ground bounce** still removes it on the first contact.

The legacy `m0.2` profile retains its historical second-contact removal so schema-v2 and schema-v3 recordings replay exactly.

`ParticlePool.groundBounces` is a cumulative counter exposed with wall bounces and collision discards in snapshot/UI telemetry. Pool reset clears it.

## 5. Profiles and replay

Snapshot, fixed-runtime metric, and command-recording schema is version 4. Scenario JSON remains version 2.

Two frozen profiles exist:

```text
m0.2.5-balanced = size-linked lifetime, shrinking radius, low-biased arcs,
                  45% vertical / 82% horizontal ground response
m0.2           = independent 0.25-0.80s lifetime, constant radius,
                  2.2-7.5m/s vertical launch,
                  35% vertical / 75% horizontal ground response
```

Schema-v4 recordings capture `particleProfile`, initial `particleBounce`, and initial `particleWallCollision`. Later toggle changes remain tick-boundary commands.

Schema-v3 recordings select `m0.2`, assume the historical initial Ground-bounce default `false`, and retain their stored wall-collision mode. Schema-v2 also selects `m0.2` with wall collision disabled. Unknown profile names fail instead of silently selecting another behavior.

## 6. Verification and boundaries

Automated coverage verifies:

- exact maximum-size and lifetime bounds plus separated small/large lifetime quartiles
- approximately 50-70% ground contact for a 4,096-particle seeded burst
- current radius at spawn, half-life, and near expiry
- snapshot, picking, and inspector use of current/max radius
- exact 45%/82% response, one-bounce settling, age-authoritative expiry, and toggle-off kill
- cumulative ground telemetry and reset behavior
- bit-for-bit M0.2 seeded particle and ground-response fixtures
- schema-v4 replay plus schema-v3 and schema-v2 compatibility
- existing collision, 36,000-tick soak, and 4,096-particle corridor performance checks

Particles remain presentation-only: no player, rock, particle, damage, force, or finite-height wall interaction is added.
