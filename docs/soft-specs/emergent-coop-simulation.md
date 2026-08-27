# Emergent Co-op Simulation North Star

| Field | Value |
| --- | --- |
| Status | Working draft |
| Authority | Non-authoritative soft specification |
| Last reviewed | 2026-08-07 |
| Horizon | Feature direction beyond the current 0.9.1 contract; no release assignment |
| Related current documents | [Platform contract](../platform.md), [architecture guide](../architecture-guide.md), [lay of the land](../lay-of-the-land-pseudocode.md) |

This document formalizes an owner brain dump about Lantern's possible future. It is deliberately broader than an implementation plan and narrower than a promise. Its job is to preserve the character of the desired game, expose architectural pressure early, and provide concrete stories from which small features can be promoted.

## North star

**Intent:** Lantern should grow into a playable, Nox/Nox Quest-inspired cooperative action-game laboratory where a small number of players and expressive enemies can improvise with magic, furniture, surfaces, equipment, sound, hazards, and each other.

Lantern is both the game and the proving ground for a reusable simulation kernel. Reuse should be earned by implementing real game stories. The project should remain fun to change in JavaScript now while preserving the boundaries that could support an authoritative server or a native simulation port much later.

The desired feeling is not “thousands of identical agents.” It is a readable scene in which a modest cast can make surprising but explainable choices: a rat wizard rotates a bookshelf across a corridor, a guard investigates metal boots on tile, a barefoot player circles around on a rug, and a lightning spell becomes especially dangerous around water and conductive equipment.

## Aspirational experience envelope

These are design targets, not current guarantees or benchmark claims:

- Up to roughly four cooperating players.
- Encounters that may reach roughly 64 active enemies, with room for both cheap swarm actors and fewer, deeper specialists.
- One-meter cells as a coarse topology and navigation scale, with continuous positions and shapes for actors, projectiles, and movable props.
- A browser-first JavaScript implementation for present experimentation.
- CPU-authoritative simulation with bounded, observable work.
- A possible C++ or native/WASM simulation port years later, reached through stable data and behavior contracts rather than an early rewrite.

The envelope does not commit Lantern to a universal ECS, unrestricted planner, engineering-grade physics, fully destructible worlds, GPU-authoritative gameplay, deterministic cross-machine lockstep, or any particular large-map size.

## Narrative probes

Narrative probes are candidate stories chosen because each is fun on its own and forces several systems to meet at a useful seam.

### 1. The enchanted rat and the bookshelf

**Candidate story:** A magically powerful rat identifies a movable bookshelf, pulls it with telekinesis, rotates its long side across a corridor, and releases it. The shelf immediately blocks bodies, spell trajectories, and line of sight. Once it settles, navigators route around it. A player can manipulate the same shelf using the same authoritative action.

This story probes:

- stable prop identity and authored capabilities;
- continuous translation and rotation;
- oriented collision and occlusion geometry;
- dynamic obstruction versus static map topology;
- replayable manipulation commands and state;
- AI affordances and bounded placement scoring;
- presentation of a shared authoritative prop.

The rat need not search every possible pose. A first intelligent version can evaluate a small, deterministic set of legal shelf placements around relevant corridor cells, score how much each changes reachability or line of sight, and either act or fall back.

### 2. Boots, bare feet, tile, and rugs

**Candidate story:** Metal boots make conspicuous footsteps on tile. A nearby guard hears the sound and investigates its origin. A player removes the boots, crosses a rug more quietly, and flanks the guard.

This story probes:

- surface material separate from collision;
- equipped items and actor capability/state;
- movement producing bounded sound events;
- hearing, occlusion, observation, and personal memory;
- investigation without granting perfect knowledge of an actor;
- deterministic decay and overload behavior for transient stimuli.

### 3. Water, metal, lightning, oil, and fire

**Candidate story:** Water changes how an electrical attack affects a metal-equipped actor. Oil can ignite; water can cool or extinguish fire; an intelligent actor can notice a persistent hazard and choose another route or a countermeasure.

This story probes:

- sparse or grid-aligned environmental fields;
- typed damage and equipment/material tags;
- reactions composed from small rules;
- hazard observations and navigation costs;
- bounded propagation, event ordering, and replay representation.

The goal is not to enumerate every combination in one master table. The goal is for focused systems to exchange clear facts, so a new material or spell can participate without editing every actor's decision tree.

### 4. Co-op identity and spell appearance

**Candidate story:** Four players can distinguish their armor and Fireball presentation using validated palette or material choices, while Fireball mechanics remain an authoritative versioned definition.

This story probes:

- player identity and ownership;
- cosmetic parameters separated from mechanics;
- validated content IDs and bounded customization;
- snapshot and replication shape;
- renderer parity without cosmetic data becoming simulation authority.

### 5. Cheap mobs and deep specialists

**Candidate story:** A simple creature pursues using a small capability set while a wizard senses hazards, remembers observations, and considers a few tactical affordances. Both use common collision, health, team, targeting, and snapshot rules.

This story probes a shared actor foundation without requiring every actor to pay the memory and computation cost of the most intelligent one.

## Current foothold

The present engine already protects several foundations described by the [platform contract](../platform.md): fixed 60 Hz simulation authority, commands, copied snapshots, replay versions, stable entity identity, bounded typed-array pools, deterministic AI inputs, shared navigation infrastructure, broadphase queries, versioned spell data, and renderer independence.

The shipped [0.9.0 Fireball Investigation AI](../milestones/0.9.0-fireball-investigation-ai.md) and current [schema-v11 movement-sound checkpoint](../notes/proximity-walking-movement-sound.md) are narrow first slices of this direction. Wizards can anonymously infer a visible Fireball's launch point, hear its impact, or hear a running footstep, arbitrate that clue against personal memory and damage, and run a bounded search. The shared typed queue proves bounded transient sound facts, but this is deliberately not yet the proposed surface/footwear acoustics system or a broad personality model.

The current world and navigation data are intentionally narrower than this north star:

- `GridMap.cells` is a CPU-side `Uint8Array` with one byte per cell, currently normalized to `0 = floor` or `1 = solid`.
- A navigation field is a CPU-side `Uint32Array` of cost-to-destination values plus bounded build scratch. Following decreasing costs approaches the destination; following increasing costs can support withdrawal.
- The destination cache retains several completed cost arrays for actor targets and goal cells while sharing one incremental Dijkstra workspace.
- Reachability owns reusable flood-fill marks and a queue. It answers whether a sparse candidate cell belongs to the connected walkable region from a starting cell; it is not another rendered map.
- Actor, projectile, rock, and AI state live in CPU RAM. Renderers receive copied snapshots and derive their own GPU resources.

These arrays are useful to imagine as labeled sheets laid over the same cell coordinates. They are not one giant map object, and they do not all need the same lifetime, precision, or update rate.

## Working world model

**Working hypothesis:** keep static occupancy semantically small and compose the world from parallel layers and entity tables.

| Concern | Likely representation | Update character | Example values |
| --- | --- | --- | --- |
| Static occupancy | Dense cell array | Authored or rare revisions | floor, solid wall |
| Surface material | Dense or chunked material-ID array | Mostly static | tile, rug, grass, clay |
| Dynamic navigation obstruction | Overlay/revision derived from settled props | Event-driven | shelf footprint, closed door |
| Environmental fields | Separate dense, sparse, or chunked arrays | Different bounded cadences | water depth, oil, heat, fire, mud, magical residue |
| Authored props and actors | Stable IDs plus component-shaped tables | Fixed-tick systems | transform, oriented body, health, equipment, telekinesis target |
| Transient facts | Bounded event/history buffers | Produced and consumed by ticks | noise, impact, damage, ignition, observation |
| Presentation | Snapshot-derived CPU/GPU resources | Per rendered frame or on revision | meshes, materials, instance transforms, particles, visibility textures |

Not every scenario must allocate every layer. Layers may later be chunked or sparse when measurements justify it. A surface ID can refer to a cold registry containing friction, footstep, conductivity, flammability, and presentation metadata rather than duplicating those properties into every cell.

### Dynamic obstruction policy

Collision, visibility, and global navigation have different latency and cost needs:

1. An actively moving shelf changes exact body collision and authoritative line of sight immediately.
2. Nearby actors can use local avoidance around its current shape.
3. Its conservative occupied-cell footprint becomes global navigation topology only after it is released or stable long enough to avoid rebuilding fields for every drag movement.
4. The topology revision invalidates or rebuilds affected navigation data under a fixed budget.
5. If a requested field is stale, actors use a deterministic fallback rather than silently walking through the shelf or doing unbounded work.

Small chairs and constantly moving creatures may remain local obstacles only. Large settled shelves, doors, and similar chokepoint objects are candidates for the navigation overlay. The distinction should be data-driven and observable.

## Interaction composition

**Working hypothesis:** systems should publish or consume bounded facts rather than actors containing giant cross-product conditionals.

```text
movement + footwear + surface
    -> NoiseEvent(position, loudness, spectrum, source hints)

NoiseEvent + hearing + geometry
    -> Observation(kind = sound, estimated position, confidence)

electric damage + water contact + conductive equipment
    -> damage response modifier and secondary reaction

fire contact + oil field
    -> bounded ignition/spread request

water application + fire field
    -> cooling/extinguish request
```

Events are not a license for an unbounded global event bus. Each authoritative fact needs a capacity, deterministic order, overflow/fallback policy, lifetime, diagnostics, and replay decision. Direct function/data flow remains preferable when a relationship is local and synchronous.

## AI composition

**Working hypothesis:** intelligence is a bounded pipeline rather than a single enormous behavior tree.

```text
sensors
   -> observations
   -> personal memory / knowledge
   -> available affordances
   -> bounded scoring or planning
   -> authoritative command/action
   -> movement, spell, prop, and interaction systems
```

Actors can differ without changing the meaning of the pipeline:

- Sensors determine what can be seen, heard, felt, or inferred.
- Memory determines what persists, for how long, and with what uncertainty.
- Capabilities determine possible actions: move, cast, open, carry, manipulate, extinguish, investigate.
- Intelligence changes candidate count, planning cadence, lookahead, knowledge quality, and budget—not whether the actor may read renderer results or hidden world truth.
- A fallback action is required when a budget or cache is exhausted.

Physics can remain frequent while sensing is staggered and expensive deliberation runs less often or on meaningful observation changes. The exact cadences are implementation decisions to measure, not promises in this document.

### Deterministic imperfection and search temperament

**Intent:** A group should look like individuals making plausible choices, not synchronized copies executing one visibly perfect pattern. Their differences should still be explainable, bounded, replayable, and independent of frame rate or renderer state.

The current foothold already derives each wizard's search rotation, reversal, and scan phase from named enemy-local hash lanes using the simulation seed and stable spawn sequence. Every wizard obeys the same radius, timeout, and reachability rules, but several wizards need not inspect nearby cells in the same order.

**Working hypothesis:** future AI profiles may derive a small search temperament once per stable actor, then use it to weight an otherwise shared candidate set. Candidate traits include:

- preference for near versus outer search cells;
- clockwise versus counterclockwise sweep order;
- shorter decisive scans versus longer cautious pauses;
- willingness to revisit a plausible cell after other candidates fail;
- tendency to favor cover edges, corridor mouths, or the incoming clue direction;
- source-sensitive uncertainty, so a vague sound produces a broader search than a seen trajectory.

These are bounded biases, not permission to read hidden player state. A cautious wizard may inspect a less efficient reachable cell or linger longer, but it cannot know which route the unseen player actually took. Variation should be sampled from named actor-local lanes or stored as explicit versioned profile data, never consumed from global simulation RNG on each decision.

**Constraints:**

- The same schema, seed, actor identity, observations, and commands reproduce the same choices.
- Search traits alter ordering and timing only inside declared candidate, duration, navigation-work, and memory limits.
- No trait may change geometry truth, identify an anonymous caster, bypass exposure, or turn an inferred position into a firing target.
- Diagnostics should expose the chosen temperament and why a waypoint won, so apparent mistakes remain readable rather than arbitrary.
- Existing replay schemas retain their frozen search behavior; a materially different live profile requires an explicit compatibility decision.

**Acceptance seed:** Give four guards the same anonymous clue in a symmetric room. At least two choose observably different legal search sequences or scan rhythms, every guard remains within the same bounded work and return rules, and rerunning the recording reproduces each individual path exactly.

## Actor and capability shape

Lantern is currently data-oriented and ECS-light, with type-specific structure-of-arrays pools. That remains a valid shape.

**Working hypothesis:** introduce a common actor/capability seam only when the first genuinely different actor vertical would otherwise duplicate core loops. A likely composition is:

```text
common actor facts
    identity | transform | body | team | health

optional capability/state tables
    caster | vision | hearing | navigation | equipment
    inventory | telekinesis | AI memory | planner
```

A capability mask may cheaply route eligible actors into a system. It should say that a capability exists, not store the capability's fields. No universal ECS, query scheduler, or component-per-property model is implied.

## CPU RAM, GPU VRAM, and network authority

**Constraint:** gameplay truth remains on the authoritative CPU side unless a later contract explicitly and deliberately replaces that model.

| CPU RAM: authoritative or inspectable | GPU VRAM: disposable presentation copy |
| --- | --- |
| fixed tick, commands, stable IDs | vertex and index buffers |
| map and world layers | meshes and instancing buffers |
| actor/component SoA columns | material parameters and textures |
| collision and occluder shapes | interpolated display transforms |
| navigation fields, cache, reachability | visibility/shroud textures |
| AI observation, memory, and decisions | lights, particles, bloom, shadows |
| health, damage, reactions, replay state | cosmetic variants derived from validated IDs |

The GPU may perform substantial rendering work, but pixels, depth buffers, lighting, and presentation-only TrueSight do not report gameplay facts back to AI or physics. Avoiding GPU readback keeps authority deterministic, testable, server-capable, and renderer-independent.

For eventual co-op, the likely authority flow is:

```text
player input
   -> validated per-player command
   -> authoritative host/server tick
   -> bounded state changes and events
   -> snapshot or delta replication
   -> each client's presentation
```

Stable actor IDs, bounded content IDs, command schemas, snapshot schemas, and deterministic server behavior are useful now. Exact cross-language floating-point lockstep between clients is not assumed.

## Large-world pressure

Dense grid arrays are simple and fast, but every full-map field scales with cell count. Destination fields multiply that cost by the number of retained goals. A much larger world therefore cannot be approached by merely raising the current map limit and retaining every full-resolution field.

Candidate techniques, to introduce only after a measured story needs them, include:

- chunked world layers and visible/active chunk uploads;
- navigation fields scoped to active regions;
- room/portal or hierarchical routing above the one-meter grid;
- dirty-region invalidation for settled topology changes;
- sleeping or lower-frequency simulation for distant actors;
- explicit cache memory budgets and eviction telemetry.

## Portability posture

A future C++ or native/WASM port should replace an implementation behind known boundaries, not cause JavaScript to imitate C++ today.

Portable assets worth preserving now are:

- fixed units and a written tick order;
- canonical commands and versioned snapshots/recordings;
- stable IDs and content codes;
- bounded arrays, work queues, and overload behavior;
- explicit system reads, writes, and ownership;
- renderer-independent authoritative logic;
- golden replay fixtures and deterministic behavioral tests.

Before a real port, numeric semantics will need an explicit contract. JavaScript `Number` calculations mixed with `Float32Array` storage are currently practical, but a native implementation must decide where float32 rounding, float64 calculation, integers, tolerances, or fixed-point rules are authoritative.

## Architectural pressure register

| Pressure | Early warning | Preferred response |
| --- | --- | --- |
| `Simulation` becomes the home of every feature | A vertical touches unrelated private methods and replay branches | Extract the smallest cohesive system/state interface needed by the next story while preserving tick order. |
| `EnemyWizardPool` becomes the universal actor | A melee actor or co-op player must pretend to be a wizard | Introduce the common actor/capability seam with that concrete vertical. |
| `GridMap` becomes a god object | Surfaces, water, fire, props, art, and occupancy become fields of one cell record | Keep parallel layers and registries with independent precision and cadence. |
| Navigation rebuilds thrash | A dragged prop invalidates every cached goal every tick | Separate exact/local response from settled topology revisions and budget rebuilds. |
| AI becomes a combination explosion | Every new material edits every enemy decision tree | Compose observations, affordances, reaction facts, and bounded candidate scoring. |
| Events become invisible global coupling | Producers can allocate arbitrary messages or consumers depend on incidental order | Prefer direct flow where possible; otherwise bound, order, version, and diagnose events. |
| Cosmetic data leaks into mechanics | Armor color or rendered fire color changes damage, perception, or replay | Keep validated cosmetic IDs separate from authoritative definitions. |
| GPU presentation becomes gameplay truth | AI or collision reads depth, pixels, frame timing, or Three.js state | Derive presentation from snapshots only; keep server-capable CPU authority. |
| Large-map memory rises quadratically in practice | More cached full-map layers are added whenever dimensions increase | Measure bytes and work by layer; introduce chunking/hierarchy before raising limits. |
| Portability drives premature abstractions | JavaScript code is contorted around an imagined C++ layout | Preserve behavioral/data contracts now; port only when profiling and product needs justify it. |
| Feature work outruns characterization | A new interaction has no replay, budget, diagnostics, or deterministic fixture | Promote it as a complete vertical, including failure and overload behavior. |

## Open questions

- What is the smallest useful authoritative oriented-body model for furniture?
- Which objects can alter global navigation topology, and how long must they be stable first?
- Should environmental fields be dense, sparse, chunked, or mixed for the first elemental story?
- What information does a sound observation reveal about source identity and material?
- Which reactions are immediate, and which become queued bounded work?
- What first non-wizard actor best proves the common actor seam?
- What is the first co-op authority experiment: local multi-input, host-authoritative LAN, or a headless Node server?
- Which state belongs in authoritative replication versus cosmetic client configuration?
- At what measured map size or cache budget should hierarchical navigation replace full-map destination fields?
- Which exact numeric rules must be frozen before a native port becomes credible?

## Promotion trigger

Promote one narrative probe when it has a narrow player-facing outcome, explicit authoritative state, bounded work and fallback behavior, replay/snapshot implications, deterministic tests, and a stated human acceptance check. The [candidate feature roadmap](./candidate-roadmap.md) proposes an initial sequence.
