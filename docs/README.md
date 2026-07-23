# Lantern Documentation

Lantern `0.3.0` is the current application release. Documents are separated by purpose so historical milestone contracts remain intact without obscuring the current runtime boundary.

## Current contracts

- [Platform contract](./platform.md) — browser-first host, fixed-step simulation, and presentation boundary.
- [0.3.0 3D presentation](./milestones/0.3.0-3d-presentation.md) — stable eight-light topology, renderer warmup, diagnostics, and acceptance state.
- [0.3.0 renderer regression notes](./notes/0.3.0-renderer-regressions.md) — cold-pipeline and stale-instance symptoms that future renderer changes must not reintroduce.

## Milestone history

| Version | Contract | Scope |
| --- | --- | --- |
| M0 | [Debug arena](./milestones/m0-debug-arena.md) | Fixed-step X/Z simulation, commands, snapshots, bounded pools, Canvas2D, probes |
| 0.1.0 | [Blast physics](./milestones/0.1.0-blast-physics.md) | Dynamic rocks, occluded explosion impulses, scenario editing |
| 0.2.0 | [Map-colliding sparks](./milestones/0.2.0-particle-collision.md) | Presentation-only particle sweeps and wall response |
| 0.2.5 | [Size-linked ember lifecycles](./milestones/0.2.5-particle-lifecycle.md) | Shrink, lifetime, ground settling, replay profiles |
| 0.3.0 | [3D presentation and dynamic lighting](./milestones/0.3.0-3d-presentation.md) | Three.js adapter, stable lights, warmup, bounded presentation profiling |

## Version boundaries

These identifiers evolve independently:

- Application/package release: `0.3.0`.
- Snapshot and command-recording schema: v4.
- Scenario JSON schema: v2; legacy map JSON remains v1.
- Default particle behavior profile: `m0.2.5-balanced`.
- Historical replay particle profile: `m0.2`.
- Narrow accepted replay alias: `m0.25-balanced` normalizes to `m0.2.5-balanced`.

Release numbering must not rename a frozen particle profile or increment a serialization schema unless that specific compatibility contract changes.
