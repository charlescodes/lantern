# Lantern Documentation

Lantern `0.5.0` is the current application release. Documents are separated by purpose so historical milestone contracts remain intact without obscuring the current runtime boundary.

## Current contracts

- [Platform contract](./platform.md) — browser-first host, fixed-step simulation, and presentation boundary.
- [0.3.0 3D presentation](./milestones/0.3.0-3d-presentation.md) — stable eight-light topology, renderer warmup, diagnostics, and acceptance state.
- [0.3.0 renderer regression notes](./notes/0.3.0-renderer-regressions.md) — cold-pipeline and stale-instance symptoms that future renderer changes must not reintroduce.
- [Dynamic-contact velocity channels](./notes/dynamic-contact-velocity-channels.md) — current player/body response contract that prevents controller contact from storing external recoil.
- [0.3.2 spark-light affinity regression](./notes/0.3.2-spark-light-affinity.md) — carrier leases, smooth tail fades, and keyed resident-light slots.
- [0.3.3 Render Lab and effect-local lighting](./notes/0.3.3-render-lab-performance.md) — atomic fireball light groups, URL settings, performance capture, LAN testing, and current support thresholds.
- [0.4.0 TrueSight visibility and shroud](./notes/0.4.0-true-sight.md) — player-centered wall LOS, shared renderer masks, local interaction gating, fades, probes, and performance-report v2.
- [0.5.0 Spell Lab and versioned Fireball authoring](./milestones/0.5.0-spell-lab.md) — strict definitions, immutable revisions, effect-local seeds, schema-v5 replay, live controls, and stable presentation resources.

## Release and milestone history

| Version | Contract | Scope |
| --- | --- | --- |
| M0 | [Debug arena](./milestones/m0-debug-arena.md) | Fixed-step X/Z simulation, commands, snapshots, bounded pools, Canvas2D, probes |
| 0.1.0 | [Blast physics](./milestones/0.1.0-blast-physics.md) | Dynamic rocks, occluded explosion impulses, scenario editing |
| 0.2.0 | [Map-colliding sparks](./milestones/0.2.0-particle-collision.md) | Presentation-only particle sweeps and wall response |
| 0.2.5 | [Size-linked ember lifecycles](./milestones/0.2.5-particle-lifecycle.md) | Shrink, lifetime, ground settling, replay profiles |
| 0.3.0 | [3D presentation and dynamic lighting](./milestones/0.3.0-3d-presentation.md) | Three.js adapter, stable lights, warmup, bounded presentation profiling |
| 0.3.1 | [Dynamic-contact velocity channels](./notes/dynamic-contact-velocity-channels.md) | Prevent controller contact from storing external recoil while preserving genuine impact knockback |
| 0.3.2 | [Spark-light affinity](./notes/0.3.2-spark-light-affinity.md) | Prevent dying spark lights from hopping to older surviving carriers |
| 0.3.3 | [Effect-local lighting and Render Lab](./notes/0.3.3-render-lab-performance.md) | Atomic eight-slot fireball groups, 16-light default, live render controls, capture reports, and LAN phone routes |
| 0.4.0 | [TrueSight visibility and shroud](./notes/0.4.0-true-sight.md) | 360-degree wall LOS, shared Canvas/Three shroud, local interaction gating, and report v2 |
| 0.5.0 | [Spell Lab and versioned Fireball authoring](./milestones/0.5.0-spell-lab.md) | Current spell registry, Fireball definition v1, future-casts-only revisions, deterministic seeds, and schema v5 |

## Version boundaries

These identifiers evolve independently:

- Application/package release: `0.5.0`.
- Snapshot and command-recording schema: v5.
- Scenario JSON schema: v2; legacy map JSON remains v1.
- Default particle behavior profile: `m0.2.5-balanced`.
- Historical replay particle profile: `m0.2`.
- Narrow accepted replay alias: `m0.25-balanced` normalizes to `m0.2.5-balanced`.

Release numbering must not rename a frozen particle profile or increment a serialization schema unless that specific compatibility contract changes. Schema-v2/v3/v4 recordings remain on frozen legacy Fireball and global-RNG paths; schema v5 is the versioned-definition boundary.
