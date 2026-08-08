# Lantern Architecture Review and Owner's Guide

> **Review snapshot:** the Lantern 0.8.0 working tree built on commit `2727c2e`, before the human visual/behavioral release gate.
>
> **Purpose:** explain the code as it exists, distinguish strong foundations from accumulating debt, and provide a practical route for reviewing and later refactoring it. This is a living engineering guide, not a frozen release contract. For a control-flow-first view, use the companion [lay of the land in pseudocode](./lay-of-the-land-pseudocode.md).

## Bottom line

Lantern is still fundamentally a two-dimensional authoritative game simulation with replaceable presentation adapters. Three.js has not become the source of gameplay truth. Collision, movement, targeting, perception, damage, navigation, and replay all operate in the X/Z simulation and do not depend on a Three.js scene, camera, light, or render result.

It is also not yet a general-purpose game engine or a full entity-component-system. It is a game-specific engine kernel for a Nox-like prototype. That is a reasonable place to be.

The code is not a uniformly coupled mess. In fact, several of its hardest-to-recover foundations are in good shape: deterministic fixed ticks, commands, bounded typed-array storage, stable IDs, replay fixtures, renderer independence, and inspectability. The main architectural risk is concentrated in one place: [`src/sim/simulation.js`](../src/sim/simulation.js) now owns nearly every system and every serialization concern. The underlying data and low-level algorithms are more salvageable than the current orchestration.

In one sentence:

> Keep the simulation/presentation boundary and typed-array kernel; gradually turn `Simulation` back into a scheduler instead of replacing the engine wholesale.

## A mental model using infrastructure language

These software-engineering terms map fairly well to infrastructure concepts:

| Term | Meaning here | Infrastructure analogy |
| --- | --- | --- |
| Authority | The one state that decides gameplay outcomes | The control plane or source-of-truth API, not a dashboard cache |
| Composition root | The place that creates and wires the application | A deployment/bootstrap layer that assembles controllers and dependencies |
| Seam | A narrow interface where one part can be replaced | An API, CRD, or provider interface between independently changeable systems |
| System | Logic that reads some state and writes some state each tick | A reconciliation controller |
| Snapshot | A copied, read-only description of current state | An observed-state/read-model payload |
| SoA | One dense array per field instead of one object per entity | Columnar storage rather than row-shaped documents |
| Bounded | A declared maximum with explicit drop/fallback behavior | Resource requests, limits, and backpressure instead of unbounded queues |
| Deterministic | Same initial state and commands produce the same result | Reproducible reconciliation from the same desired state and event log |
| Coupling | A change in one concern forces unrelated code to change | An internal change that leaks across service or API boundaries |
| Cohesion | Code in a module changes for the same reason | A controller or service with one well-defined responsibility |

A large file is not automatically bad. [`src/visibility/true_sight.js`](../src/visibility/true_sight.js) is large, but most of it serves one cohesive pipeline: derive, rasterize, fade, and report a visibility mask. `simulation.js` is riskier because it changes for many unrelated reasons: AI, physics, combat, effects, diagnostics, replay, and more.

## The application in one picture

```text
DOM controls / pointer / keyboard / window.__lantern
                       |
                       | canonical command
                       v
              FixedStepRuntime (60 Hz)
                       |
                       | Simulation.tick(command)
                       v
       +---------------------------------------+
       | Authoritative 2D simulation           |
       | map, pools, physics, AI, spells,       |
       | damage, navigation, replay state       |
       +---------------------------------------+
                       |
                       | copied JSON-safe snapshot
                       v
          presentation-side TrueSight frame
                       |
             +---------+----------+
             |         |          |
          Canvas2D   Three.js   DOM / AI View
```

The most important direction is downward. Presentation may observe a snapshot, but it must not send render-derived facts back into gameplay. In particular, TrueSight, lighting, camera height, particles on screen, and frame rate must never become AI perception inputs.

There are a few controlled exceptions to the simplified picture. Browser orchestration reads `simulation.levelState`, `simulation.player`, `simulation.map`, and the read-only `queryAt`/selection methods directly. Those reads do not give Three.js authority, but they mean the browser host is not literally snapshot-only today.

## Is the 3D layer really presentation-only?

For gameplay, yes.

Evidence in the current tree:

- `src/sim`, `src/spells`, and `src/core` do not import Three.js, DOM, Canvas, or presentation modules.
- Three.js imports are confined to presentation adapters such as [`three_presentation.js`](../src/presentation/three_presentation.js), [`instanced_pool.js`](../src/presentation/instanced_pool.js), and [`true_sight_transport.js`](../src/presentation/true_sight_transport.js).
- Authoritative actors and projectiles use X/Z positions and X/Z collision. The 3D camera projects pointer commands back onto the `Y=0` ground plane.
- Both renderers receive the same simulation snapshot. Three.js does not own an alternate physics body, AI state, health value, or entity ID.
- AI visual checks use grid geometry and authoritative facing, not player-facing TrueSight or rendered visibility.

Two nuances are worth knowing:

1. Visual spark particles have `y`, `vy`, gravity, and bounce state inside `Simulation`. They are prohibited from affecting gameplay, but their visual-effect lifecycle is simulated and replayed on the authoritative side. Therefore the gameplay model is 2D, while not every calculation under `src/sim` is strictly two-dimensional.
2. The folder named `visibility` means player-facing presentation visibility. Enemy sight lives under `src/sim`. This separation is correct, but the generic folder name makes the distinction easier to misunderstand than it needs to be.

Neither issue is an urgent violation. If Lantern eventually needs a strict server simulation with no visual-effect work, particle state is the first candidate to split into a deterministic client-effect stream driven by authoritative impact events. That trigger, target boundary, compatibility posture, and acceptance evidence are tracked as [LT-001: Client-owned presentation effects](./soft-specs/long-term-improvements.md#lt-001-client-owned-presentation-effects).

## Repository map

### Host and browser wiring

- [`src/main.js`](../src/main.js) is the composition root. It constructs the simulation, runtime, input, UI, visibility, presentation, labs, and `window.__lantern` probe. It should wire subsystems, not own gameplay rules.
- [`src/browser/input.js`](../src/browser/input.js) converts pointer and keyboard activity into commands.
- [`src/browser/ui.js`](../src/browser/ui.js), [`spell_lab.js`](../src/browser/spell_lab.js), and [`ai_view.js`](../src/browser/ai_view.js) own DOM-facing tools.
- [`src/browser/renderer.js`](../src/browser/renderer.js) is the original Canvas2D debug renderer and remains a useful regression oracle.

### Runtime

- [`src/runtime/fixed_step_runtime.js`](../src/runtime/fixed_step_runtime.js) separates wall-clock rendering from fixed 60 Hz simulation ticks. It owns the bounded command queue, accumulator, pause/step behavior, and timing metrics.
- It calls only `simulation.tick(command)` to mutate gameplay and `simulation.snapshot()` to publish state.

This is one of the strongest seams in the project and should remain boring.

### Authoritative simulation

- [`src/sim/simulation.js`](../src/sim/simulation.js) currently owns state construction, the tick schedule, system integration, editor actions, queries, diagnostics, snapshots, recording, and replay.
- [`src/sim/pools.js`](../src/sim/pools.js) contains bounded dense SoA pools for enemy wizards, rocks, projectiles, and particles; [`dead_body_pool.js`](../src/sim/dead_body_pool.js) owns the compact dynamic body pool and inert FIFO ring.
- [`src/sim/grid_map.js`](../src/sim/grid_map.js) and [`scenario.js`](../src/sim/scenario.js) own versioned map and authored scenario data.
- [`src/sim/collision.js`](../src/sim/collision.js), [`explosion.js`](../src/sim/explosion.js), and [`dynamic_body_velocity.js`](../src/sim/dynamic_body_velocity.js) contain reusable geometry/response calculations.
- [`src/sim/tactical_wizard.js`](../src/sim/tactical_wizard.js) and [`perceptive_wizard.js`](../src/sim/perceptive_wizard.js) contain deterministic AI calculations. State-machine orchestration still lives in `Simulation`.
- [`src/sim/navigation_field.js`](../src/sim/navigation_field.js), [`destination_field_cache.js`](../src/sim/destination_field_cache.js), [`grid_reachability.js`](../src/sim/grid_reachability.js), and [`map_cell_broadphase.js`](../src/sim/map_cell_broadphase.js) are bounded data-oriented infrastructure.

### Spell data

- [`src/spells/fireball_definition.js`](../src/spells/fireball_definition.js) defines and validates the data contract for Fireball.
- [`src/spells/spell_registry.js`](../src/spells/spell_registry.js) owns stable spell codes and immutable applied revisions.
- Palette, seeded sampling, and snapshot helpers live beside the definition.

This is the most mature data-driven vertical. It is still a one-spell registry: a second spell handler will be the real test of whether the abstraction generalizes.

### Visibility and presentation

- [`src/visibility/true_sight.js`](../src/visibility/true_sight.js) computes player-facing concealment from snapshot/map geometry. It is presentation authority, not gameplay or AI authority.
- [`src/visibility/presentation_gate.js`](../src/visibility/presentation_gate.js) applies that visibility to hover and selection.
- [`src/presentation/factory.js`](../src/presentation/factory.js) chooses a Canvas2D or Three.js adapter.
- [`src/presentation/canvas_presentation.js`](../src/presentation/canvas_presentation.js) wraps the original Canvas renderer.
- [`src/presentation/three_presentation.js`](../src/presentation/three_presentation.js) translates snapshots into resident Three.js resources.
- Shared helpers such as [`ai_view_model.js`](../src/presentation/ai_view_model.js), [`combat_visuals.js`](../src/presentation/combat_visuals.js), [`enemy_facing.js`](../src/presentation/enemy_facing.js), and [`dead_body_pose.js`](../src/presentation/dead_body_pose.js) reduce renderer disagreement.

The conceptual renderer seam is good, but the folder dependency direction is muddled: `presentation/factory.js` imports a camera from `browser`, `canvas_presentation.js` imports the renderer from `browser`, and `browser/renderer.js` imports shared helpers from `presentation`. There is no demonstrated runtime cycle, but file placement no longer communicates a clean one-way layer graph.

### Tests and documents

- `test/*.test.js` is both a regression suite and an executable behavioral specification.
- Focused tests cover pure calculations, integrated behavior, replay compatibility, renderer parity, and broadphase equivalence.
- Soaks exercise bounded pools and long deterministic runs.
- [`docs/platform.md`](./platform.md) is the current authority-boundary contract. Milestone documents preserve historical promises rather than being rewritten after every release.

## What one simulation tick does

[`Simulation.tick`](../src/sim/simulation.js) is worth reading before any of its individual systems. Its current order is approximately:

1. Canonicalize the command and apply command actions.
2. Advance defeat/reset handling when necessary.
3. Run encounter spawning.
4. Sample perception for the live perceptive AI profile.
5. Advance navigation-field work.
6. Prepare player and enemy desired movement.
7. Turn enemy facing.
8. Integrate and resolve body physics/collisions.
9. Advance cooldowns.
10. Cast player and enemy spells.
11. Move projectiles and resolve hits, explosions, damage, and impulses.
12. Advance existing dead-body settlement, then transfer newly dead enemies out of AI.
13. Advance particles.
14. Regenerate health and prune unused spell revisions.
15. Increment the tick and record the canonical command.

That explicit order is valuable. Many game bugs are really ordering bugs. The refactoring goal should be to preserve this schedule while moving each numbered operation behind a narrower system interface.

## The data-oriented core

### What SoA means here

An object-oriented entity layout might look like this:

```js
enemies = [
  { x: 1, z: 2, health: 100 },
  { x: 3, z: 4, health: 75 },
];
```

Lantern instead stores columns:

```js
enemyX      = new Float32Array(capacity);
enemyZ      = new Float32Array(capacity);
enemyHealth = new Float32Array(capacity);
```

That is structure-of-arrays, or SoA. A movement loop walks contiguous position/velocity columns without pulling unrelated object properties into the hot path. The fixed capacities also prevent garbage growth and make overload behavior explicit.

The current major pools are homogeneous:

- every active projectile occupies the same projectile columns;
- every active rock occupies the same rock columns;
- every active particle occupies the same particle columns;
- every active enemy wizard occupies the same enemy columns.
- every dynamic dead enemy occupies compact physics columns, while settled
  bodies move to a cold FIFO ring with no per-tick system participation.

The player is a singleton object because one row does not benefit from a dense pool. Maps, registries, event histories, and snapshots use other representations appropriate to their access patterns. This mixture is healthy; “data-oriented” does not mean every value must be a `Float32Array`.

### Stable IDs versus pool indices

An active entity has a stable ID and a temporary dense-array index. Removal uses swap-and-pop: the last live row moves into the removed row, then `activeCount` shrinks. This keeps iteration dense, but an index is not identity. Pins, owners, events, and diagnostics correctly use stable IDs.

This is a good core pattern. The maintenance problem is that `EnemyWizardPool` currently declares roughly 96 typed columns, initializes them individually on spawn, and lists them again for swap removal. Adding one field requires remembering every lifecycle location. The pool is tested, but its correctness depends too much on a human maintaining parallel lists.

### Float32 is a policy, not a religion

`Float32Array` is useful for dense, bounded hot state and mirrors common engine/GPU layouts. It also rounds values, so `0.3` may be stored as `0.30000001192092896`. Tests must compare with `Math.fround` or tolerances where exact float32 representation matters.

Counters, IDs, enum codes, cell coordinates, and flags appropriately use integer arrays. Cold configuration and serialized JSON should remain ordinary JavaScript numbers/objects unless profiling proves a need to change them.

## Is this an ECS with stateless processors and bitmasks?

Not currently.

Lantern has ECS-like ingredients—stable entity IDs, component-shaped columns, dense iteration, and explicit systems—but it has no general entity registry, component mask, query dispatcher, or scheduler over declared read/write sets. The original M0 contract intentionally chose “explicit systems plus dense typed-array pools” and deferred a full ECS until repeated need appeared.

The present design is best described as **data-oriented, ECS-light, type-specific SoA pools**.

It is only partly stateless:

- Pure helpers such as `visualCheck`, `turnFacing`, `computeExplosionResponse`, intercept prediction, collision tests, and navigation queries are close to stateless processors.
- Integrated systems such as perception, casting, projectiles, damage, particles, and snapshots are private methods on `Simulation`. They reach through `this` to any state they need and sometimes call one another.

### Why a bitmask would not help much yet

Within `EnemyWizardPool`, every row has every enemy-wizard column. All rows therefore have the same implicit component signature. Testing a mask before processing them would only restate something the pool already guarantees.

Masks become valuable when one shared actor population contains different capabilities, for example:

```text
player          = Transform | Body | Health | Team | Caster
enemy wizard    = Transform | Body | Health | Team | Caster | Perception | Navigator
melee critter   = Transform | Body | Health | Team | Perception | Navigator
static trigger  = Transform | Trigger
```

A system can then require a conceptual set:

```js
const required = Component.Transform | Component.Health;
if ((world.mask[id] & required) !== required) continue;
```

In JavaScript, ordinary bitwise operators operate on 32-bit integers. Keep masks to fewer than roughly 32 conceptual components, use unsigned normalization carefully, or use multiple `Uint32Array` words. Do not assign one bit per field; `x` and `z` are fields of a Transform component, while the many perception fields are one conceptual Perception component.

The right trigger is not “engines should have masks.” The trigger is a concrete new vertical—such as friendly actors, critters, summons, or multiple caster types—that currently forces duplicated loops or large `kind` branches. Until then, homogeneous archetype pools are often faster and simpler than a universal entity table.

## Architecture scorecard

| Concern | Current state | Assessment |
| --- | --- | --- |
| 2D gameplay authority | Simulation owns X/Z physics, AI, collision, combat, and replay | Strong |
| Renderer independence | Canvas2D and Three.js consume common snapshots; no Three imports in sim | Strong |
| Determinism | Fixed ticks, canonical commands, seeded/local hash lanes, golden replay traces | Strong |
| Bounded resource behavior | Typed pools, ring buffers, cache budgets, broadphase scratch, drop telemetry | Strong |
| Observability | Snapshots, diagnostics, AI View, probes, timing, event histories | Strong |
| Low-level algorithm cohesion | Physics helpers, AI geometry, navigation, cache, and broadphase are separately testable | Strong |
| System modularity | Most integrated systems and state transitions remain in one 5,500-line class | At risk |
| Pool lifecycle safety | Dense and fast, but the 96-column enemy lifecycle is manually synchronized | At risk |
| Data-driven content | Fireball and rocks are data-backed; actors, AI profiles, and system dispatch are hard-coded | Mixed |
| Generic actor extensibility | Player singleton and enemy-specific loops dominate | Early |
| Replay maintainability | Compatibility behavior is excellent; version branches are accumulating in live orchestration | Mixed |
| Test safety | Broad and unusually exact; many fixtures directly mutate internal arrays | Strong behavior, high refactor tax |
| Static architecture tooling | `npm run check` parses and tests, but does not enforce types, lint, or import boundaries | Needs improvement |
| Folder dependency clarity | Simulation boundary is clear; `browser` and `presentation` depend across folder labels | Mixed |

## What the code is doing especially well

### 1. It protects the expensive architectural boundary

Replacing a renderer is possible without rewriting gameplay. Canvas2D remains a real implementation rather than dead scaffolding, and shared renderer-independent view models reduce the chance that Three.js invents separate rules.

### 2. It treats determinism as a product feature

Fixed ticks, canonical commands, captured spell revisions, stable IDs, enemy-local hash lanes, and frozen replay profiles make failures reproducible. Broadphase tests compare against the brute-force implementation rather than merely asserting plausible outcomes. That is excellent engine practice.

### 3. It makes resource limits explicit

Projectile, particle, actor, dead-body, event, command, navigation, and presentation resources have declared capacities or budgets. Excess work drops, waits, settles early, overwrites FIFO history, falls back, or reports telemetry rather than growing silently. This is exactly the kind of operational thinking that transfers well from infrastructure engineering.

### 4. It separates hot and cold representations

Typed arrays are used where dense iteration matters. JSON-safe objects are used for external inspection and serialization. Immutable spell definitions and ordinary maps are used for cold authored state. This is more useful than forcing the whole program through one abstraction.

### 5. It has unusually good characterization tests for a prototype

The suite preserves exact replay boundaries, tick timing, candidate ordering, first-hit behavior, pool swaps, renderer parity, and soak limits. That safety net makes extraction realistic.

## Where coupling and drift are accumulating

### 1. `Simulation` has too many reasons to change

At this review point it is over 6,000 lines and owns:

- command interpretation and editor actions;
- encounter spawning;
- perception and hunting transitions;
- tactical movement, facing, dodge, and retreat;
- navigation requests;
- player and body physics;
- every body-pair collision resolver;
- dynamic-to-inert dead-body lifecycle and overflow policy;
- casting, projectiles, explosions, damage, and regeneration;
- particle emission and lifecycle;
- spell revision retention;
- queries and inspector descriptions;
- snapshot/diagnostic construction;
- recording export and all replay-version selection.

This is the primary debt. `Simulation.tick` is still a readable schedule, but the class is both the scheduler and almost every controller it schedules. A change in any gameplay vertical risks conflicts in the same file.

### 2. Enemy state lifecycle is manually synchronized

The enemy pool's columns are a useful layout, but constructor allocation, spawn defaults, swap removal, snapshot projection, diagnostics, and tests all need to agree. A missed swap entry can silently attach one mob's memory or navigation slot to another stable ID.

A declarative field registry or small code-generated schema could own allocation and swap/copy/reset mechanics while leaving hot loops as direct typed-array access. This is a better first abstraction than a full ECS rewrite.

### 3. Historical replay branches live beside current behavior

Preserving schemas v2–v9 is a real strength, but profile and schema selection are referenced throughout `Simulation`. Frozen legacy behavior and live behavior increasingly share the same orchestration methods with branches.

Compatibility should remain, but profile selection can move toward explicit strategies or versioned construction adapters so the current tick path does not become a permanent ladder of release checks.

### 4. The snapshot is both a clean seam and a large projection

Snapshots deliberately allocate copied object graphs so renderers and tools cannot mutate simulation state. That is an excellent authority boundary. It also means one large method knows the shape of every pool, diagnostic, event, spell revision, and compatibility field, and the runtime builds a snapshot for every published frame.

Keep the copied snapshot contract, but move projection into dedicated serializers/view builders and continue measuring `snapshotMs`. Do not replace it with renderers reading raw pools merely to save allocations without profiling.

### 5. Browser/presentation packaging no longer matches the conceptual layers

The renderer interface works, but cameras, the Canvas renderer, and shared render helpers straddle `browser/` and `presentation/`. A reader cannot infer allowed dependency direction from the folder names alone.

This can be cleaned up after higher-risk simulation work: put renderer adapters and cameras together, keep DOM tools together, and make the presentation factory depend only downward on adapter modules.

### 6. Tests are behavior-rich but representation-aware

A rough scan finds hundreds of direct test references to `simulation.enemies`, `projectiles`, `particles`, `rocks`, and `player`. Those white-box fixtures are valuable for precise engine tests, but renaming or regrouping fields will touch many tests even when behavior is unchanged.

Keep low-level pool tests white-box. For integrated behavior, prefer fixture builders and command/snapshot assertions so a future storage refactor has fewer call sites.

### 7. `// @ts-check` is not enforced by the main check

Source files carry JSDoc and `// @ts-check`, but `npm run check` currently runs Node's syntax parser and the test suite. There is no checked-in TypeScript configuration, linter, cycle check, or import-boundary test.

The comments still help editors, but they are not a CI guarantee. A small boundary checker preventing `src/sim` from importing browser/presentation/Three modules would protect the most important invariant cheaply. Enforced JavaScript type checking can follow once its initial error budget is understood.

### 8. The actor model is still game-specific

Targets have future-ready kind/ID/team fields, but this release exposes one player singleton and enemy-wizard-specific systems. Adding friendly wizards, critters, summons, or co-op players would currently touch collision, targeting, damage, navigation, queries, snapshots, presentation, and replay in several places.

That is the point at which a common Actor representation or small archetype ECS becomes justified. It is not evidence that the current prototype failed; it is the next abstraction boundary becoming visible.

## A change-impact map

This is a practical way to recognize coupling during review:

| Proposed change | Likely current touch points | Coupling signal |
| --- | --- | --- |
| Add one enemy memory field | Pool allocate, spawn, swap, state transitions, snapshot, diagnostics, tests, possibly AI View | High and mechanical |
| Add a new renderer | Factory, one adapter, shared view helpers, acceptance tests | Relatively low |
| Add a Fireball tuning field | Definition/validation, sampling or simulation consumer, snapshot, both renderers, tests/docs | Intentional vertical coupling |
| Add a second spell behavior | Registry, command/cast dispatch, projectile/effect handling, UI, replay, presentation | Abstraction not yet proven |
| Add a friendly/critter actor | Pools, every actor/body loop, teams, targeting, damage, queries, snapshots, renderers, replay | High; likely ECS/archetype trigger |
| Change AI behavior | Pure helper plus several `Simulation` methods, snapshots/AI View, replay fixtures | Medium to high |
| Change Three.js appearance only | Three adapter/shared presentation helper, visual tests | Correctly isolated |
| Change TrueSight fade or mask transport | Visibility/presentation only | Correctly isolated |

If a presentation-only change starts touching `src/sim`, or an AI change starts reading `sightFrame`, stop: that is authority drift. If a new actor requires another copy of every physics/combat loop, stop and design the actor seam first.

## Recommended refactoring sequence

Do this after the current schema-v11 movement-sound checkpoint, in behavior-preserving slices. Do not combine it with a new spell, actor type, networking, or perception feature.

### Stage 0: freeze the current behavior

- Retain the v2-v11 replay fixtures and broadphase-versus-brute-force oracles.
- Add a simple import-boundary test for `src/sim`, `src/spells`, and `src/core`.
- Record representative snapshot fixtures at a few ticks rather than snapshotting every implementation detail everywhere.
- Keep Canvas2D and Three.js acceptance as separate human gates.

### Stage 1: extract read-only and compatibility concerns

Start with code that does not participate in hot mutation order:

- move command canonicalization to a command module;
- move snapshot and diagnostic projection to read-only builders;
- move recording export/replay validation and version selection to a recording codec/factory;
- keep `Simulation` as the public facade so callers and tests do not all change at once.

This reduces file pressure before touching physics or AI.

### Stage 2: make the tick schedule explicit

Keep `Simulation.tick` as a short ordered schedule, but make systems functions with explicit inputs:

```js
stepPerception(world, services, simulationTick);
stepNavigation(world, services, simulationTick);
prepareEnemyMovement(world, services, simulationTick);
stepBodies(world, services, dt);
stepCasting(world, services, command.cast, simulationTick);
stepProjectiles(world, services, dt, simulationTick);
stepParticles(world, services, dt);
```

`world` should contain authoritative mutable state. `services` should contain the map, definitions, event sinks, deterministic helpers, and preallocated scratch structures. A system should not receive the browser, renderer, DOM, camera, or TrueSight frame.

Document each system's important reads and writes. That is more immediately useful than building a generic scheduler.

### Stage 3: make pool lifecycle declarative

Define each pool's columns once so allocation, reset, swap, and invariant testing derive from the same schema. Hot code can continue using `pool.x[index]` directly; no per-tick dynamic lookup is required.

Group fields conceptually in documentation even if storage remains flat:

- Identity: ID, spawn sequence, team/kind.
- Transform/body: current/previous position, velocity channels, radius/mass.
- Health/combat: health, damage timers, cooldown, cast sequence.
- Tactics: movement goal, strafe, aim, threat, dodge, retreat.
- Perception: state, candidate/confirmed target, exposure, facing, memory.
- Guard/hunt/navigation: guard, search, stimulus, destination slot.

This gives a future component model vocabulary without paying for a universal ECS now.

### Stage 4: introduce an actor model only with the next actor vertical

Before implementing the first friendly, critter, summon, or second player, decide between:

1. **Archetype pools:** separate dense pools per stable behavior shape, with shared system adapters.
2. **Common ActorPool plus capability masks:** common transform/body/health/team columns, with optional caster/perception/navigation component tables.

Use a real feature to test the design. Preserve typed arrays, stable IDs, bounded capacity, deterministic iteration order, and replay truth whichever model wins.

### Stage 5: clean presentation packaging

- Place cameras and renderer adapters under one clear presentation boundary.
- Keep DOM panels/input under browser/host.
- Keep shared view-model calculations renderer-neutral.
- Consider renaming or nesting player-facing visibility so it cannot be confused with AI perception.

This is lower risk and lower urgency than splitting `Simulation`.

## What not to do

- Do not rewrite the project in another language merely to obtain architectural discipline. JavaScript is not causing the central coupling.
- Do not introduce a universal ECS, dependency-injection framework, or event bus in one large rewrite.
- Do not make Three.js scene objects authoritative physics or actor objects.
- Do not let TrueSight, lighting, shadows, or rendered occlusion feed AI decisions.
- Do not expose raw mutable pools to renderers as a shortcut around snapshot cost without a measured need and a read-only contract.
- Do not delete historical replay behavior as part of file organization. Isolate it.
- Do not refactor system order and add gameplay behavior in the same patch.
- Most importantly, do not keep adding complete verticals directly to `simulation.js` now that the pattern has clearly crossed its comfortable scale.

## A practical owner review path

You do not need to read 20,000 lines in file order. Use these passes.

### Pass 1: establish the boundary, about 60 minutes

1. Read the first two sections of [`platform.md`](./platform.md) and the governing rules in the historical [`M0 debug arena`](./milestones/m0-debug-arena.md).
2. Scan [`config.js`](../src/config.js) to see the units, capacities, profiles, and tuning constants.
3. Read the top of [`main.js`](../src/main.js) until the runtime is constructed. Identify what is wiring versus gameplay.
4. Read all of [`fixed_step_runtime.js`](../src/runtime/fixed_step_runtime.js).
5. Read only `Simulation`'s constructor, `reset`, and `tick` first. Do not descend into every private method yet.

At the end, explain aloud: “What can mutate gameplay, when can it mutate, and what does a renderer receive?” If that answer is clear, the first pass succeeded.

### Pass 2: trace one Fireball, about 60–90 minutes

Follow this path:

```text
InputController command
  -> FixedStepRuntime command queue
  -> Simulation.tick
  -> cast system
  -> ProjectilePool
  -> projectile collision
  -> explosion/damage/particle event
  -> snapshot
  -> Canvas2D or Three.js adapter
```

Read [`fireball_definition.js`](../src/spells/fireball_definition.js), [`spell_registry.js`](../src/spells/spell_registry.js), and the focused combat/replay tests alongside the implementation. Ask which values are current configuration and which are captured per cast.

### Pass 3: trace one enemy decision, about 90 minutes

Start with [`perceptive_wizard.test.js`](../test/perceptive_wizard.test.js), then read [`perceptive_wizard.js`](../src/sim/perceptive_wizard.js), and only then jump to the `#perceptionSystem`, `#preparePerceptiveEnemyMovement`, `#facingSystem`, and `#enemyCastSystem` methods in `Simulation`.

Trace these state transitions:

```text
unaware -> noticing -> engaged -> hunting -> returning -> unaware
```

Watch the difference between a tactical overlay such as dodge/retreat and persistent perception state. Also verify that `sightFrame` never enters this path.

### Pass 4: compare the renderers, about 60 minutes

Run the same encounter with:

```text
?renderer=2d
?renderer=3d
?renderer=3d&backend=webgl
```

Read the presentation factory, Canvas wrapper, shared facing/AI view models, and only the update methods of `three_presentation.js`. Ignore shader/material setup on the first pass. The question is: “Are both renderers translating the same snapshot, or inventing separate rules?”

### Pass 5: inspect the safety net

Run:

```bash
npm run check
node --test test/perceptive_wizard.test.js
node --test test/broadphase.test.js
node --test test/perception_replay.test.js
```

Then inspect the soak scripts in `package.json`. Tests are often easier to understand than the integrated method because each fixture names one contract.

## Questions to ask during every future audit

- Who owns this state?
- Can it affect gameplay, or is it only presentation?
- What is the stable identity: entity ID, pool index, spawn sequence, or effect ID?
- Is mutation restricted to a fixed-tick boundary?
- Is iteration order deterministic?
- Does randomness come from the correct local seed/lane?
- What is the capacity, overload behavior, and telemetry?
- Does this hot loop allocate objects or grow arrays?
- Does this module read more state than its responsibility needs?
- If the renderer disappeared, would the simulation still work?
- If a second renderer appeared, would gameplay code change?
- If a second actor type appeared, which loops would need duplication?
- Does a replay schema need to preserve this change?
- Is the test asserting behavior, representation, or both?
- Can the change be reviewed independently from a gameplay change?

## Suggested review verdict

Lantern has a real, salvageable engine core. The strongest parts are exactly the parts that are expensive to retrofit later: authority separation, fixed-step determinism, bounded data, stable identity, replay, and observability. The Three.js experiment has not contaminated gameplay authority.

The prototype is now large enough that continuing to add vertical features through `Simulation` and `EnemyWizardPool` will turn concentrated debt into systemic debt. The next engineering milestone should be a replay-identical extraction pass, not a rewrite and not a new framework. If that work leaves the tick schedule obvious, systems explicit about their state, and pools just as dense and bounded, it will move the project closer to the engine you have in mind without discarding what already works.
