# Presentation Scorch-Mark Pool

> **Status:** implemented development checkpoint after Lantern 0.9.0
>
> **Authority:** presentation only; snapshot/recording schema v11,
> performance-report schema v4, scenario v3, map v1, Fireball definition v1,
> combat, AI, physics, sound, and replay truth are unchanged

Fireball explosion events now leave a bounded charcoal mark on static map
surfaces. This is the first deliberately narrow decal consumer anticipated by
LT-001; it does not move particle simulation or any gameplay outcome into a
client-effect system.

## Local lifecycle

Each presentation owns a 200-entry FIFO ring. It primes against the event
window present when the renderer starts, then consumes newly observed explosion
events in stable tick/ID order. A mark has no age and performs no per-tick work:
it remains until entry 201 overwrites entry 1. Page or renderer reload, seed or
timeline reset, impact-history clear, and map-topology edits clear the local
pool. Replaying forward from tick zero reconstructs the same recipes; loading a
late snapshot does not reconstruct older marks.

The pool reports occupancy, overwrites, ingested/skipped events, input
duplicates, missed event-ID gaps, resets, and resident triangle counts through
presentation diagnostics. It never writes into a snapshot or creates a command,
recording field, collision row, AI stimulus, sound event, or light lease.

## Deterministic recipe

The captured blast radius is the primary footprint measure. Pressure impulse
adds a bounded, diminishing modifier:

```text
pressureScale = 0.75 + 0.25 * clamp(sqrt(pressureImpulse / 800), 0, 3)
markRadius    = clamp(0.4 * blastRadius * pressureScale, 0.15m, 4m)
```

The default `2.5m`/`800 N·s/m²` Fireball therefore leaves a `1m`-radius mark.
The stable effect seed and explosion ID select eight inner triangles with
`15–30%` radius edges and sixteen outer flecks with `2–10%` radius edges. At the
default footprint those ranges are 15–30cm and 2–10cm. No sample uses
`Math.random`.

Ordinary wall-cell hits use the captured contact normal and the same `0.9m`
presentation height as the rendered 3D Fireball. This is intentionally separate
from the Fireball definition's particle `spawnHeight`: X/Z collision remains
authoritative and two-dimensional, while the wall contact height remains a
visual convention. Wall triangles are scaled and translated into the struck
one-meter face and the `2.5m` wall height so geometry cannot hang past an edge.
Rock, player, enemy, dead-body, obelisk, and unknown prop impacts still project
onto the floor; triangles entering an ordinary solid map cell or leaving the
map are discarded. Marks never attach to a movable object.

## Rendering budget

Three.js owns two resident dynamic geometries and two unlit, transparent,
TrueSight-masked charcoal materials: one core layer and one fleck layer. The
full pool has at most 4,800 source triangles and adds at most two draw calls;
buffers change only when the pool changes. Small ground and wall-normal offsets
prevent z-fighting.

Canvas2D fills the same two deterministic triangle sets in two batched paths.
Ground geometry is drawn directly in X/Z. Because the top-down renderer has no
vertical wall plane, wall-local height maps into a shallow strip inside the
contacted cell edge. Obelisks and dynamic actors are drawn afterward so a floor
mark remains beneath them.

Automated coverage fixes the sizing curve, sample counts and scales, stable
variation, wall bounds, ground rejection, priming and reset rules, snapshot
immutability, 1,000-impact FIFO saturation, Canvas palette/layers, resident 3D
resources, and TrueSight material plumbing. Real-browser review remains the
acceptance gate for charcoal opacity, wall-edge readability, large overlap, and
automatic WebGPU versus forced WebGL output.
