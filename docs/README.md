# Lantern Documentation

Lantern `0.9.0` is the current application release. The development runtime is now at snapshot/recording schema v11. Documents are separated by purpose so historical milestone contracts remain intact without obscuring the current runtime boundary.

## Start here

- [Architecture review and owner's guide](./architecture-guide.md) — a current code map, plain-language mental model, strengths and drift assessment, review route, and staged refactoring strategy.
- [Lay of the land in pseudocode](./lay-of-the-land-pseudocode.md) — the current startup, fixed-tick, simulation, combat, AI, presentation, command, and replay flows in one compact trace.

## Soft specifications

These documents preserve future intent and candidate experiments. They are mutable and non-authoritative: current code, tests, and contracts still define shipped behavior.

- [Soft-specification collection and promotion rules](./soft-specs/README.md) — how brainstorming becomes a candidate, implementation plan, and eventually a proven contract without rewriting milestone history.
- [Emergent co-op simulation north star](./soft-specs/emergent-coop-simulation.md) — the rat wizard, movable furniture, stealth and sound, elemental surfaces, layered world data, AI composition, CPU/GPU authority, networking shape, portability, and architectural pressure.
- [Candidate feature roadmap](./soft-specs/candidate-roadmap.md) — small vertical slices from player telekinesis through the enchanted rat, sound, elemental contact, actor composition, co-op authority, and larger-world experiments.
- [Long-term improvement ledger](./soft-specs/long-term-improvements.md) — trigger-driven architecture work, beginning with moving visual particles and lighting behind a client-effect event boundary before authoritative multiplayer.

## Current contracts

- [Platform contract](./platform.md) — browser-first host, fixed-step simulation, and presentation boundary.
- [Proximity walking and movement sound](./notes/proximity-walking-movement-sound.md) — silent close-pointer walking, deterministic run footsteps, a bounded shared sound queue, schema-v11 replay, and performance-report v4.
- [Enemy dead-body lifecycle checkpoint](./notes/enemy-dead-body-lifecycle.md) — bounded dynamic-to-inert enemy bodies, deterministic overflow, schema-v10 replay, renderer parity, and performance-report v3.
- [0.3.0 3D presentation](./milestones/0.3.0-3d-presentation.md) — stable eight-light topology, renderer warmup, diagnostics, and acceptance state.
- [Foreground wall fading](./notes/foreground-wall-fading.md) — camera-aware 33% opacity for nearby foreground walls while complete wall geometry and gameplay authority remain intact.
- [Kinetic explosion fragments](./notes/kinetic-fragment-pool.md) — a deterministic 512-slot presentation pool for tumbling, bouncing charcoal triangles expanded from generic explosion events.
- [0.3.0 renderer regression notes](./notes/0.3.0-renderer-regressions.md) — cold-pipeline and stale-instance symptoms that future renderer changes must not reintroduce.
- [Dynamic-contact velocity channels](./notes/dynamic-contact-velocity-channels.md) — current player/body response contract that prevents controller contact from storing external recoil.
- [0.3.2 spark-light affinity regression](./notes/0.3.2-spark-light-affinity.md) — carrier leases, smooth tail fades, and keyed resident-light slots.
- [0.3.3 Render Lab and effect-local lighting](./notes/0.3.3-render-lab-performance.md) — atomic fireball light groups, URL settings, performance capture, LAN testing, and current support thresholds.
- [0.4.0 TrueSight visibility and shroud](./notes/0.4.0-true-sight.md) — player-centered wall LOS, shared renderer masks, local interaction gating, fades, probes, and performance-report v2.
- [0.5.0 Spell Lab and versioned Fireball authoring](./milestones/0.5.0-spell-lab.md) — strict definitions, immutable revisions, effect-local seeds, schema-v5 replay, live controls, and stable presentation resources.
- [0.6.0 Obelisk Combat Foundation](./milestones/0.6.0-obelisk-combat.md) — singleton obelisk encounter, bounded enemy wizards, symmetric health/damage, schema-v6 replay, defeat/restart, and presentation parity.
- [0.6.1 health-bar compositing regression](./notes/0.6.1-health-bar-compositing.md) — keeps Three.js health fills above their dark tracks through normal visibility and TrueSight fading.
- [0.7.0 Tactical Wizard AI](./milestones/0.7.0-tactical-wizard-ai.md) — shared bounded navigation, deterministic strafe/intercept/dodge/retreat behavior, schema-v7 diagnostics, and frozen schema-v6 basic replay.
- [0.8.0 Visual Perception and Hunting](./milestones/0.8.0-visual-perception-hunting.md) — geometry-only vision, personal memory/search/guard behavior, bounded 50-mob infrastructure, schema-v8 replay, and frozen schema-v7 tactical replay.
- [0.8.1 Playtest Mode and Developer Toolbox](./milestones/0.8.1-playtest-developer-toolbox.md) — clean full-viewport boot, one semicolon-gated developer workspace, parked authoring windows, and presentation-only diagnostic suppression without a schema change.
- [0.8.2 Player-Follow Camera](./milestones/0.8.2-player-follow-camera.md) — exact local render-pose following in play, free camera authoring in edit, and pointer-stable camera input without a schema change.
- [0.9.0 Fireball Investigation AI](./milestones/0.9.0-fireball-investigation-ai.md) — anonymous projectile and explosion clues, deterministic priority arbitration and search, schema-v9 replay, and frozen schema-v8 perception.
- [AI View debug overlay](./notes/ai-view.md) — read-only Off/Selected/All mob diagnostics shared by Canvas2D and Three.js without changing AI or replay state.

## Open defects

- [Enemy health bar visible through solid walls](./bugs/enemy-health-bar-through-wall.md) — first noticed during 0.7.0 review, suspected to relate to 0.6.x health-bar presentation; investigation and repair are deferred.

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

## Version boundaries

These identifiers evolve independently:

- Application/package release: `0.9.0`.
- Snapshot and command-recording schema: v11.
- Scenario JSON schema: v3; legacy scenario v2 and map v1 remain importable.
- Fireball definition format: v1.
- Performance-report schema: v4.
- Default particle behavior profile: `m0.2.5-balanced`.
- Historical replay particle profile: `m0.2`.
- Narrow accepted replay alias: `m0.25-balanced` normalizes to `m0.2.5-balanced`.

Release numbering must not rename a frozen profile or increment a serialization schema unless that compatibility contract changes. Schema-v2/v3/v4 recordings remain on frozen legacy Fireball and global-RNG paths; schema v5 retains versioned Fireballs with frozen pre-combat behavior; schema v6 is the obelisk-duel and frozen basic-wizard boundary; schema v7 selects the frozen omniscient tactical wizard; schema v8 selects the frozen perceptive wizard and records the 64-capacity/four-alive scaling boundary; schema v9 selects the investigative wizard without dead bodies; schema v10 keeps that AI behavior and adds `enemy-dead-body-v1` with replay-pinned capacities; schema v11 adds `proximity-walk-footsteps-v1` and a replay-pinned sound-event capacity while retaining the schema-v10 body lifecycle.
