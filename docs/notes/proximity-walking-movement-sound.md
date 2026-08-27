# Proximity Walking and Movement-Sound Checkpoint

> **Status:** implemented development checkpoint after Lantern 0.9.0
>
> **Compatibility:** incorporated into application/package `0.9.1`; snapshot and
> recording schema advances to v11; performance-report schema advances to v4;
> scenario v3, map v1, Fireball definition v1, and schemas v2-v10 remain frozen.

The player's right-mouse movement gesture now controls walking versus running,
and running can produce anonymous sound clues for investigative enemies. This
is authoritative simulation behavior, not WebAudio: no audible footstep is
played, and presentation does not decide whether a mob heard an event.

## Movement and cadence

On the first fixed tick of an RMB hold, the current player position is compared
with the world target. A target at or inside the inclusive `0.75m` radius
(`1.5m` diameter) selects walking at `2.25m/s`; from the center of a one-meter
cell, that circle reaches into all eight neighboring cells. A farther target
selects the existing `4.5m/s` run. A walking hold promotes to running as soon
as its target leaves the circle. Running then has priority for the rest of that
hold, even if the target returns inside. Releasing RMB selects idle, clears the
latch, and uses the existing locomotion braking; walking again requires a new
near-player hold. Schema-v2 through v10 recordings force movement-sound profile `none`,
preserving their original full-speed response for every nonzero movement target.

Walking is absolutely silent. This includes locomotion left over while braking
after release or while beginning a new walking gesture. External velocity from
Fireballs or body contacts never contributes to a footstep.

While running, post-physics locomotion distance advances a deterministic
cadence. The first step occurs after `0.75m`; later steps occur every `1.5m`.
Changing the requested run heading by at least `120 degrees` can emit the same
footstep event after a 12-tick gate. Turn emission wins over stride emission,
so a player produces at most one footstep per tick. Releasing RMB resets the
cadence; the next newly selected or promoted run begins again at the half
stride. Returning a latched run target to the walking circle does not reset its
cadence.

## Bounded sound events

`SoundEventQueue` is a one-tick typed structure-of-arrays queue. It retains
stable event ID, tick, kind, reason, source kind/ID/team, X/Z origin, radius,
and optional effect/projectile identity. Delivery is in insertion order. A full
queue drops the newest event and increments telemetry; it never reallocates.

The default capacity is `projectileCapacity + 1`, or 257 with the standard 256
projectiles: at most every resident projectile can impact and the player can
emit one footstep in a tick. Schema-v11 recordings pin an independently tunable
positive-integer capacity because overflow affects authoritative hearing.
The queue is cleared at the next tick boundary. A separate 128-entry diagnostic
ring retains the newest events and copies at most 32 into a snapshot; diagnostic
retention cannot affect delivery.

Two sources use the queue in schema v11:

- a player run step emits an `8m` hostile, anonymous footstep;
- a Fireball impact emits the existing `16m` hostile, anonymous explosion.

Hearing is an inclusive radial X/Z test against source team. Walls, the
obelisk, rocks, darkness, TrueSight, and renderer state do not attenuate it.
Walking produces no event. Enemy movement, neutral sources, allied sources,
and external player knockback do not produce footsteps.

## Investigation timing and priority

Only `investigative-wizard-v1` consumes these events. Broadphase candidate
collection is followed by the exact radial/team test for each listener. A
heard event stores only its exact origin and event identity: it does not expose
the player or caster, advance visual exposure, share knowledge, or authorize a
cast.

Sound delivery happens after enemy movement and projectile processing. A mob
can accept the clue and enter `INVESTIGATING` on that tick, but movement toward
the new anchor begins on the next tick. Existing central arbitration remains:
direct sight outranks visible projectile trajectory, which outranks stored
last-seen position, damage, and finally sound. Newer sound IDs redirect equal
priority; a Fireball's projectile sample and later impact deduplicate through
their shared effect/projectile identity.

Schema-v2 through v10 retain direct Fireball-hearing delivery and never emit
movement sounds. Their replay path does not enter the schema-v11 queue.

## Observability and verification

Snapshots expose player movement mode/cadence, current and recent sound events,
queue/history occupancy and drops, emitted/heard counts, and listener checks.
The developer toolbox adds sound-pool occupancy. AI View labels `8m` footstep
and `16m` Fireball hearing rings, recent sound origins, and the accepted sound
event on a selected mob. Performance-report v4 adds sound capacity, maximum
per-tick occupancy, drops, and emitted/heard counts without changing capture
behavior.

Automated coverage fixes the inclusive walk boundary, held-gesture promotion
and run priority, release reset, silent walking and knockback, half/full stride
cadence, 119/120-degree turn boundary, team/range hearing, wall-independent
next-tick investigation, newest-clue redirection, Fireball routing, queue
overflow, replay compatibility, and diagnostics.
`npm run test:soak:sound` runs 7,200 fixed ticks with 50 listeners and both
sound sources under the existing 8ms p99 and 64MiB heap-delta ceilings. Manual
browser acceptance remains for the feel of the walk zone and readability of
AI View marks; there is intentionally no player-facing audio in this checkpoint.
