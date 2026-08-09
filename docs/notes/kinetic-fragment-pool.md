# Presentation Kinetic-Fragment Pool

> **Status:** implemented development checkpoint after Lantern 0.9.0
>
> **Authority:** presentation only; simulation, snapshot/recording schema v11,
> performance-report schema v4, combat, AI, sound, navigation, and replay truth
> are unchanged

Generic explosion events produce a brief burst of non-emissive charcoal
triangles. Fireball is the first producer, but the consumer checks only the
`explosion` event contract: stable event ID and effect seed, X/Y/Z origin,
radius, pressure impulse, hit kind, and X/Z contact normal. It does not inspect
or transfer Fireball render geometry.

## Deterministic recipe and budget

Each presentation owns a typed-array structure-of-arrays pool with 512 slots
and O(1) swap-and-pop removal. An explosion requests between 8 and 24 fragments;
the default `2.5m`, `800 N·s/m²` Fireball has normalized strength `1` and
requests 16. Strength is:

```text
radiusTerm   = sqrt(clamp(radius / 2.5, 0, 4))
pressureTerm = sqrt(clamp(pressureImpulse / 800, 0, 9))
strength     = clamp(0.55 * radiusTerm + 0.45 * pressureTerm, 0, 2)
```

The stable effect seed, explosion ID, and fragment ordinal select the recipe.
Open impacts use a seeded golden-angle sequence; wall impacts map a seeded
low-discrepancy sequence across the free-space half-plane. Small seeded jitter
breaks visible regularity without creating clumps or using `Math.random`.
Wall origins move `3.5cm` along the normalized contact normal before emission.

Strength primarily increases admission count and linear velocity, with smaller
increases to lift, tumble, size, and lifetime. Triangle edges remain clamped to
`2–7cm`, and lifetime remains at most `1.35s`. Saturation retains existing
fragments, rejects new samples without allocating storage, and increments the
visible `dropped` diagnostic for every rejected fragment.

The authored edge length stays `2–7cm`, but the metric camera would project a
typical fragment to substantially less than one covered pixel at the default
24m view. Both renderers therefore apply the same bounded readability scale:
target a `48 CSS px` edge at the current zoom, never magnify an authored edge by
more than `72x`, and multiply that result by the ordinary lifetime shrink. This
keeps the effect rasterizable without changing motion, capacity, admission, or
the deterministic physical recipe, and it naturally returns to literal metric
size when the camera is close enough.

## Local kinematics and event cursor

Fragment position, previous position, velocity, Euler orientation, previous
orientation, angular velocity, age, lifetime, size, identity, and bounce state
are resident typed-array columns. Motion advances only when snapshot tick
increases, at the simulation's fixed `1/60s` effect step. Repeated render frames
at one tick interpolate but do not advance state.

Each step applies `-9.81m/s²` gravity, bounded linear and angular drag, and
orientation integration. Ground contact retains `38%` of downward speed,
`68%` of horizontal and angular motion, and permits one or two seeded bounces.
A fragment expires at its bounce limit, at negligible first-contact energy, or
at its fixed lifetime; visible edge length shrinks over normalized age. There
is no wall sweep after emission and no dynamic-object collision.

The pool follows the scorch consumer's timeline rules. Renderer construction
primes retained event IDs without reconstructing old fragments. New explosions
are consumed once in tick/ID order. Timeline rewind, seed change, impact-history
clear, or map-topology replacement clears transient state. Replay from tick zero
recreates the same recipes, while late presentation construction intentionally
does not recreate already-expired effects.

## Renderer boundary and diagnostics

Three.js uses one resident equilateral triangle geometry, one double-sided
unlit TrueSight-masked material, and one 512-slot instanced mesh. Canvas2D
projects the same rotated world triangles with the established faux-height
projection and fills them in one batched charcoal path. Fragments create no
lights, shadows, gameplay bodies, commands, events, or snapshot fields.

Presentation diagnostics expose capacity, active count, dropped samples,
ingested explosions, resets, cumulative spawns, expirations, bounces, invalid
or duplicate events, and observed ID gaps. Automated coverage fixes deterministic
sampling, bounded strength, saturation, complete swap copying, fixed-step
motion, bounce and lifetime expiry, reset and snapshot immutability, a repeated
explosion stress case, resident renderer identity, batching, and TrueSight
material plumbing. Real-browser WebGPU/WebGL and Canvas review remains the gate
for apparent scale, tumble readability, overlap, and charcoal contrast.
