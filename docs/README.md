# Lantern Documentation

Lantern `0.9.3` is the current application release. The development runtime is at snapshot/recording schema v25 and authoring-map v9. Documents are separated by purpose so historical milestone contracts remain intact without obscuring the current runtime boundary.

| Boundary | Current value | Primary owner |
| --- | --- | --- |
| Application/package | `0.9.3` | root README and release milestone |
| Snapshot/recording | v25 | [platform contract](./platform.md) |
| Authoring map | v9 | [map-authoring contract](./notes/map-authoring-foundation.md) |
| Legacy scenario/map | scenario v3 / map v1 | [platform contract](./platform.md) |
| Fireball definition | v1 | [Spell Lab milestone](./milestones/0.5.0-spell-lab.md) |
| Performance report | v4 | [platform contract](./platform.md) |

## Document ownership

| Location | Purpose | Maintenance rule |
| --- | --- | --- |
| `platform.md`, `roadmap.md`, and this index | Current boundaries and ordering | Update whenever current behavior or ordering changes |
| `plans/` | Decision-complete work and delivered implementation plans | Keep status explicit; move completed plans out of the Active list |
| `notes/` | Focused subsystem contracts and regression explanations | State whether a version is current or merely the feature's compatibility boundary |
| `milestones/` | Frozen release contracts | Do not rewrite them to describe later development |
| `bugs/` | Open and mixed-resolution defect records | Maintain disposition in the [bug index](./bugs/README.md) |
| `soft-specs/` | Non-binding product direction and idea seeds | Promote through the documented review path before implementation |
| `archive/` | Superseded handoffs and context | Never treat as current authority |

## Start here

- [Product vision](./product-vision.md) — Lantern's durable game identity and direction; it does not redefine shipped behavior.
- [Current roadmap](./roadmap.md) — the authoritative ordering for transition work and future milestones.
- [Architecture review and owner's guide](./architecture-guide.md) — a point-in-time architecture review whose durable boundaries remain useful; use live source and the platform contract for the current inventory.
- [Lay of the land in pseudocode](./lay-of-the-land-pseudocode.md) — a conceptual startup and fixed-tick trace, not an exhaustive current profile/version inventory.
- [Probe and observability contract](./probe-contract.md) — rules for detached inspection, fixed-tick mutations, bounded diagnostics, and reproducible reports.
- [Verification guide](./verification.md) — automated checks and the manual M1B traversal route.
- [Research and inspiration shelf](./references.md) — a curated, non-authoritative bibliography of Nox references, released engines, technical foundations, talks, and later research leads.

## Soft specifications

These documents preserve future intent and candidate experiments. They are mutable and non-authoritative: current code, tests, and contracts still define shipped behavior.

- [Soft-specification collection and promotion rules](./soft-specs/README.md) — how brainstorming becomes a candidate, implementation plan, and eventually a proven contract without rewriting milestone history.
- [Gameplay idea bin](./soft-specs/idea-bin.md) — unprioritized mechanics, monsters, traps, spell behavior, and unfinished sparks kept as non-binding seeds.
- [Emergent co-op simulation north star](./soft-specs/emergent-coop-simulation.md) — the rat wizard, movable furniture, stealth and sound, elemental surfaces, layered world data, AI composition, CPU/GPU authority, networking shape, portability, and architectural pressure.
- [Doors and dynamic occlusion](./soft-specs/doors-and-dynamic-occlusion.md) — a bounded candidate for hinged-door peeking, footprint-accurate pillars, moving blockers, camera limits, and a future TrueSight geometry investigation.
- [Retired candidate feature roadmap](./soft-specs/candidate-roadmap.md) — preserved historical ordering and idea seeds; use the current roadmap for active sequencing.
- [Long-term improvement ledger](./soft-specs/long-term-improvements.md) — trigger-driven architecture work, beginning with moving visual particles and lighting behind a client-effect event boundary before authoritative multiplayer.

## Current behavior and subsystem references

- [Authored mechanisms](./notes/authored-mechanisms.md) — M1E.1–M1E.4: bounded signals, gates, controls, logic, triggered lifts, safe movers, traps, wiring, replay boundaries, and acceptance routes. Browser acceptance remains pending.
- [Platform contract](./platform.md) — browser-first host, fixed-step simulation, and presentation boundary.
- [M1A.1–M1A.4 authoring kit](./notes/map-authoring-foundation.md) — current authoring-map v9, multi-layer editing, deterministic selection, bounded semantic undo/redo, structured validation, atomic persistence, map-level connectors, the M1C.1 topology data envelope, and editable mechanism/obelisk instances.
- [M1C authored navigation topology](./plans/m1c-authored-navigation-topology.md) — implemented v6 topology data, editor tooling, route diagnostics, patrol, and cross-floor pursuit under the schema-v15 compatibility boundary.
- [Editable, floor-aware obelisks](./plans/editable-floor-aware-obelisks.md) — implemented independent authored generators and reliable per-enemy cross-floor homes under schemas v19-v20.
- [M1B.1–M1B.4 vertical bodies, elevator, holes, jumping, and breakaways](./notes/generic-vertical-bodies-and-elevator.md) — continuous gameplay Y, contact-derived supports, per-body layer handoff, reusable apertures, an unstoppable two-stop lift, multi-floor falls, committed jumps, grounded plates, live connector authoring, and breakaway floors.
- [Proximity walking and movement sound](./notes/proximity-walking-movement-sound.md) — silent close-pointer walking, deterministic run footsteps, a bounded shared sound queue, schema-v11 replay, and performance-report v4.
- [Enemy dead-body lifecycle checkpoint](./notes/enemy-dead-body-lifecycle.md) — bounded dynamic-to-inert enemy bodies, deterministic overflow, schema-v10 replay, renderer parity, and performance-report v3.
- [Foreground wall fading](./notes/foreground-wall-fading.md) — camera-aware 33% opacity for nearby foreground walls while complete wall geometry and gameplay authority remain intact.
- [Kinetic explosion fragments](./notes/kinetic-fragment-pool.md) — a deterministic 512-slot presentation pool for tumbling, bouncing charcoal triangles expanded from generic explosion events.
- [0.3.0 renderer regression notes](./notes/0.3.0-renderer-regressions.md) — cold-pipeline and stale-instance symptoms that future renderer changes must not reintroduce.
- [Dynamic-contact velocity channels](./notes/dynamic-contact-velocity-channels.md) — current player/body response contract that prevents controller contact from storing external recoil.
- [0.3.2 spark-light affinity regression](./notes/0.3.2-spark-light-affinity.md) — carrier leases, smooth tail fades, and keyed resident-light slots.
- [0.3.3 Render Lab and effect-local lighting](./notes/0.3.3-render-lab-performance.md) — atomic fireball light groups, URL settings, performance capture, LAN testing, and current support thresholds.
- [Three.js and GPU pipeline guide](./notes/threejs-gpu-pipeline.md) — how CPU simulation snapshots become resident instance buffers, materials, lights, TrueSight textures, render passes, and pixels; also explains SoA boundaries and expensive settings.
- [0.4.0 TrueSight visibility and shroud](./notes/0.4.0-true-sight.md) — player-centered wall LOS, shared renderer masks, local interaction gating, fades, probes, and performance-report v2.
- [0.6.1 health-bar compositing regression](./notes/0.6.1-health-bar-compositing.md) — keeps Three.js health fills above their dark tracks through normal visibility and TrueSight fading.
- [AI View debug overlay](./notes/ai-view.md) — read-only Off/Selected/All mob diagnostics shared by Canvas2D and Three.js without changing AI or replay state.

## Open defects

The [bug index](./bugs/README.md) owns current disposition. Individual reports
retain reproduction context even when one item in a mixed backlog is resolved.

- [Obelisk activation range versus occlusion readability](./bugs/obelisk-activation-readability.md) — the 20-meter radius is correct, but hidden line-of-sight rejection makes the effective boundary look much smaller; add explicit activation diagnostics later.
- [Navigation floor transitions and debug readability](./bugs/navigation-floor-debug-and-ai.md) — mixed ledger: overlay and wrong-floor presentation fixes are delivered, while suspected pursuit/retargeting still needs a controlled reproduction.
- [Enemy health bar visible through solid walls](./bugs/enemy-health-bar-through-wall.md) — first noticed during 0.7.0 review, suspected to relate to 0.6.x health-bar presentation; investigation and repair are deferred.
- [Elevator crowding during enemy traversal](./bugs/elevator-enemy-queueing.md) — M1C's single-rider route works, but multi-enemy upward boarding needs a later bounded queue or larger-deck decision.
- [2026-09-11 playtest defect backlog](./bugs/2026-09-11-playtest-backlog.md) — remaining unprioritized reports on pursuit, guard return, hole-fall forgiveness, scorch seams, and aperture reuse; its lowered-elevator Fireball report is resolved in schema v18.

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
| 0.6.0 | [Obelisk Combat Foundation](./milestones/0.6.0-obelisk-combat.md) | Singleton obelisk, basic enemy encounter, shared Fireball combat, health/defeat flow, and schema v6 |
| 0.6.1 | [Health-bar compositing regression](./notes/0.6.1-health-bar-compositing.md) | Correct Three.js track/fill render-queue ordering without simulation or schema changes |
| 0.7.0 | [Tactical Wizard AI](./milestones/0.7.0-tactical-wizard-ai.md) | Shared incremental navigation, strafe/lead/dodge/retreat tactics, diagnostics, and schema v7 |
| 0.8.0 | [Visual Perception and Hunting](./milestones/0.8.0-visual-perception-hunting.md) | Vision, personal memory/search/return, destination cache, broadphase scaling, and schema v8 |
| 0.8.1 | [Playtest Mode and Developer Toolbox](./milestones/0.8.1-playtest-developer-toolbox.md) | Clean playtest boot, semicolon-gated developer chrome and diagnostics, parked Spell Lab, no schema change |
| 0.8.2 | [Player-Follow Camera](./milestones/0.8.2-player-follow-camera.md) | Exact play-camera lock, free edit camera, centered play zoom, no schema change |
| 0.9.0 | [Fireball Investigation AI](./milestones/0.9.0-fireball-investigation-ai.md) | Anonymous Fireball sight/hearing clues, priority arbitration, deterministic investigation, and schema v9 |
| 0.9.1 | [Authoring and Vertical Traversal](./milestones/0.9.1-authoring-and-vertical-traversal.md) | Map-authoring v5, multi-floor vertical bodies, holes, autonomous elevators, jumping, plates, and schema v12 |
| 0.9.2 | [Elevator Spell Impacts](./milestones/0.9.2-elevator-spell-impacts.md) | Layer-local Fireball impacts on elevator decks and lower shafts, with schema v13 replay |
| 0.9.3 | [M1B vertical traversal closure](./milestones/0.9.3-m1b-vertical-traversal-closure.md) | Formal closure of M1B.1–M1B.4 under schema v14; no authoring-map migration |

## Historical context

- [Post-M1B.4 ChatGPT handoff](./archive/handoffs/2026-08-30-post-m1b4-chatgpt-handoff.md) — archived planning context. It is not current authority; code, tests, current contracts, and the roadmap take precedence.

## Version boundaries

These identifiers evolve independently:

- Application/package release: `0.9.3`.
- Snapshot and command-recording schema: v25.
- Authoring-map schema: `lantern-authoring-map` v9; v8, v7, v6, v5, v4, v3, v2, v1, and legacy map/scenario documents migrate explicitly.
- Legacy compiled scenario schema: v3; scenario v2 and map v1 remain importable and scenario v3 remains the recording compatibility projection.
- Fireball definition format: v1.
- Performance-report schema: v4.
- Default particle behavior profile: `m0.2.5-balanced`.
- Historical replay particle profile: `m0.2`.
- Narrow accepted replay alias: `m0.25-balanced` normalizes to `m0.2.5-balanced`.

Release numbering does not rename frozen profiles. The [platform contract](./platform.md)
owns the current schema chronology and compatibility rules; milestone documents
retain the exact boundary at which each behavior shipped.
