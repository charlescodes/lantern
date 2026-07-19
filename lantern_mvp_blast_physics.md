# Project Lantern - MVP 0.1: Blast Physics

> **Status:** implemented supplement to M0
> **Runtime:** browser JavaScript ES modules
> **Purpose:** add inspectable explosion force and a minimal set of solid dynamic bodies without introducing a general ECS, damage system, or particle physics.

The original M0 contract remains the historical simulation foundation. This document owns the M0.1 additions and intentional changes.

## 1. Player-visible behavior

- A fireball explodes on the first solid map cell or rock it hits.
- The same explosion event produces the visual particle burst and gameplay impulse. Particles do not create or carry force.
- The player, including the caster, and all rocks inside the blast radius are candidates for knockback.
- A solid cell between the explosion origin and a body blocks that body's blast impulse.
- Rocks collide with map walls, the player, and other rocks.
- The debug renderer shows blast radius, blast rays, blocked rays, response vectors, body contacts, mass, and separate player external velocity.

Fireball lifetime is 4 seconds in M0.1 so a missed shot in the bounded 24m arena reaches a wall instead of disappearing in open floor.

## 2. Units and body properties

The simulation continues to use meters, seconds, kilograms, and X/Z ground-plane motion.

```text
player radius = 0.30 m
player mass   = 75 kg

rock density = 2,600 kg/m3
rock mass    = (4/3) * pi * radius^3 * density
```

| Archetype | Radius | Approximate mass |
| --- | ---: | ---: |
| small | 0.10 m | 10.9 kg |
| medium | 0.30 m | 294 kg |
| large | 0.90 m | 7,940 kg |

These are intentionally physical defaults. The blast constant is the gameplay tuning control; rock masses are not made artificially similar just to equalize motion.

## 3. Explosion impulse

Default explosion parameters:

```text
blast radius       = 2.5 m
pressure impulse   = 800 N*s/m2
application        = instantaneous
map occlusion      = binary, solid cells block
dynamic occlusion  = none
```

For each candidate body:

```text
centerDistance  = length(bodyCenter - explosionOrigin)
surfaceDistance = max(0, centerDistance - bodyRadius)
t               = clamp(surfaceDistance / blastRadius, 0, 1)
falloff         = 1 - smoothstep(t)
projectedArea   = pi * bodyRadius^2
impulse         = pressureImpulse * projectedArea * falloff
deltaSpeed      = impulse / bodyMass
deltaVelocity   = radialDirection * deltaSpeed
```

Bodies whose surface distance exceeds the radius receive no response. A deterministic grid DDA checks the segment from the wall-offset explosion origin to the candidate center. A blocked candidate is retained in debug event data with zero applied impulse and its nonzero potential impulse.

This is a metric-consistent gameplay pressure-impulse model, not a fluid or fragmentation simulation.

## 4. Dynamic collision

The player and rocks are circles in X/Z. Dynamic collision uses:

```text
maximum body solver passes = 4
body restitution           = 0.10
body friction              = 0.35
rock-wall restitution      = 0.18
rock-wall friction         = 0.20
rock linear damping        = 1.5 /s
rock settle threshold      = 0.02 m/s
rock speed cap             = 20 m/s
```

The number of integration substeps is chosen from current maximum body speed and minimum body radius, bounded to eight. Circle/circle penetration correction and collision impulses are inverse-mass weighted.

Player motion has two velocity channels:

```text
locomotionVelocity = control-driven acceleration/braking
externalVelocity   = explosion and contact response
totalVelocity      = locomotionVelocity + externalVelocity
```

External player velocity damps at 2/s. Keeping it separate prevents the movement controller from erasing knockback on the next tick.

## 5. Authored scenarios

Scenario JSON v2 extends map v1:

```json
{
  "version": 2,
  "width": 24,
  "height": 24,
  "cells": [1, 1, 1],
  "playerSpawn": { "x": 3.5, "z": 3.5 },
  "entities": [
    { "kind": "rock", "archetype": "small", "x": 5, "z": 18.5 }
  ]
}
```

The abbreviated `cells` array above only illustrates shape; a real file contains exactly `width * height` entries.

- Map v1 remains accepted and produces an empty entity list.
- Save writes authored rock positions, not their displaced runtime positions.
- Reset and Restore positions reconstruct runtime rocks from authored state.
- Adding a wall or rock that overlaps authored or active bodies is rejected.
- Entering edit mode pauses the runtime. Leaving restores the run state that existed before editing.
- Rock pools are bounded at 64 active bodies and use dense typed arrays with swap-and-pop deletion.

## 6. Commands and probe surface

New tick-boundary actions:

```js
{ type: "loadScenario", json }
{ type: "placeRock", archetype: "small", x: 5, z: 6 }
{ type: "removeEntity", kind: "rock", id: 4 }
{ type: "restoreScenario" }
```

`loadMap` remains a compatibility alias for `loadScenario`.

New `window.__lantern` methods:

```js
saveScenario()
loadScenario(json)
listRockArchetypes()
canPlaceRock(archetype, x, z)
placeRock(archetype, x, z)
removeEntity("rock", id)
restoreScenario()
```

`saveMap()` and `loadMap()` remain compatibility aliases and now understand scenario v2.

Explosion events expose origin, radius, source projectile, owner, hit target, and per-body response records. Snapshots expose rock identity, archetype, mass, authored spawn identity, velocity, pool counters, and body/grid contacts.

## 7. Pipeline

```text
consume commands
prepare player locomotion
damp and substep player/rock dynamics
resolve grid and dynamic-body contacts
spawn fireball
sweep projectiles against grid and rocks
create explosion event
apply wall-occluded body impulses
emit visual particles
advance visual particles
publish snapshot and command record
```

The command log stores the initial scenario and rock pool configuration. Replay supports both new `initialScenario` recordings and legacy `initialMap` recordings.

## 8. Explicitly deferred

- health, damage, status effects, teams, and ownership rules beyond source identity
- destructible walls or rocks
- projectile momentum transfer separate from explosion impulse
- angular velocity, torque, rolling, and irregular rock shapes
- dynamic-body blast occlusion
- particle collision with map walls
- entity-component-system migration
- fixed-point or cross-runtime lockstep guarantees

M0.1 keeps the force path independent from particles so later particle collision work cannot change gameplay physics.
