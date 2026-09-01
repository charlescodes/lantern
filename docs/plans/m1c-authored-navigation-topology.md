# M1C Authored Navigation Topology

> **Status:** decision-complete implementation plan · **Baseline:** Lantern `0.9.3`,
> recording schema v14, authoring-map v5 · **Implementation:** not started

M1C adds a small authored topology above Lantern's existing layer-local
destination fields. Authors describe meaningful places and connections; the
current grid navigation still performs ordinary X/Z movement inside a floor.
Elevator connectors contribute the only cross-floor edges.

The milestone is complete when an unaware enemy can follow an opt-in authored
patrol and an enemy that actually observes the player leave on an elevator can
wait, board the autonomous shuttle, disembark, and resume ordinary perception.
It is not a navmesh, a general planner, or cross-floor omniscience.

## Repository findings that shape the design

- `Simulation.tick()` currently runs perception, `#navigationSystem()`, enemy
  movement preparation, then elevator support/motion and body physics. M1C must
  preserve that ordering; a body boards through the existing support solver on
  a later tick rather than being attached by AI.
- `#preparePerceptiveEnemyMovement()` and the basic/tactical paths explicitly
  hold when enemy and player layers differ. Perception and casting also reject
  cross-layer targets. These are correct pre-M1C boundaries, not bugs.
- `SharedNavigationField` and `DestinationFieldCache` already provide bounded,
  stable, incremental same-floor routing. The cache is currently tied to the
  player's visible `this.map`; cross-floor pursuit requires layer-aware cache
  keys, not a second pathfinder.
- Authoring-map v5 stores map-level connectors with stable IDs and compiles an
  endpoint recipe onto each linked layer. The authoring editor already has
  stable selection, semantic history, atomic compilation, and connector
  picking. Navigation authoring should reuse these seams.
- Both elevator endpoints are physically boardable while the fitting platform
  dwells there. When the platform is absent, the upper endpoint is a real
  aperture, so AI must wait at a staging node and enter only after arrival.
- Elevators remain timer-driven. M1C AI may observe and wait for their state,
  but it never issues `cycleElevator` or `summonElevator` commands.

## Algorithm choice and OpenNox comparison

Lantern does not need a polygon navigation mesh for M1C. Its authored maps are
already cell-based, actor X/Z remains continuous, and
`SharedNavigationField`/`DestinationFieldCache` already build reverse,
incremental Dijkstra cost fields over eight grid neighbors. Cardinal steps cost
10, diagonal steps cost 14, diagonal corner cutting is rejected, and one field
can guide every enemy sharing a destination. Dynamic bodies are currently
resolved later by collision; they do not alter field costs.

The useful name for the M1C architecture is **hierarchical grid navigation**:

1. a small authored graph chooses the next meaningful place, connector, or
   patrol stop;
2. the existing layer-local field chooses cells toward that local goal;
3. ordinary movement, support, and collision execute the next step.

The local OpenNox checkout was inspected at commit
`b184030e76be2b681a7f6d2bcdef52b091d94b9b`. It provides historical
inspiration for this separation, not code to copy. Its `Waypoint` stores up to
32 authored connections, its coarse waypoint traversal writes at most 16 route
nodes, and its separate detailed path search uses a 23-world-unit grid, a
bounded 1,024-node work pool, periodic dynamic-object indexing, and special
cell flags for elevators, shafts, holes, and transporters. Roaming chooses a
waypoint and asks the detailed pathfinder to reach it. That is a coarse graph
plus local grid search—not waypoint-only steering and not a polygon navmesh.

Lantern should preserve the pattern but not the historical constants or search
details. Its shared reverse fields are a better fit for several enemies chasing
one player, and stable tie breaks must replace OpenNox's randomized neighbor
rotation. OpenNox is GPL-3.0; keep it as a read-only behavioral reference and do
not copy source into Lantern.

## Locked product decisions

- Authors place high-level nodes at cell centers and explicitly connect them.
- Authored links are undirected and same-floor. No automatic all-nearby-node
  linking is inferred.
- Elevator endpoints are compiled graph ports. Authors link a normal node to a
  visible endpoint port; the compiler derives the vertical edge between the
  two ports from the existing two-stop connector.
- Unaware patrol is opt-in per node. Maps without patrol nodes preserve current
  guard behavior.
- Cross-floor pursuit requires observed evidence. Knowing the player's live
  runtime layer merely because it exists in simulation is forbidden.
- The existing local destination field remains responsible for walls,
  doorways, acceleration, collision, and goal approach.
- A separate navigation acceptance arena is safer than modifying the frozen
  M1B holes/elevator route.

## Authoring-map v6

M1C.1 advances the current source format from v5 to v6. The root adds:

```text
nextNavigationNodeOrdinal
nextNavigationLinkOrdinal
navigationNodes[]
navigationLinks[]

navigation node := {
  id, layerId, cx, cz, patrol
}

link endpoint :=
  { kind: "node", nodeId }
  OR
  { kind: "connector-endpoint", connectorId, stop: "lower" | "upper" }

navigation link := {
  id, a: endpoint, b: endpoint
}
```

Nodes use integer cells and resolve to `(cx + 0.5, cz + 0.5)`. This agrees with
the destination-field grid and avoids a second snapping policy. IDs come from
the two monotonic root ordinals. Proposed hard limits are 128 authored nodes
and 256 authored links; the compiler additionally permits the existing maximum
of 16 elevator connectors and their 32 derived ports.

Validation rejects unknown fields, invalid ordinals, duplicate IDs, missing
layers/nodes/connectors, out-of-bounds or solid node cells, duplicate nodes in
one layer/cell, self-links, duplicate undirected pairs, and an authored link
whose endpoints are not on the same layer. A connector endpoint reference must
name the matching stop. Nodes cannot occupy a standalone hole, breakaway cell,
or elevator aperture cell; elevator access is represented by its derived port.

Deleting a node atomically removes its incident authored links in the same
semantic history command. A layer with navigation nodes cannot be deleted until
those nodes are removed. Removing a connector remains explicit and also removes
links that reference its endpoint ports. Move, delete, undo, redo, import, save,
and load preserve stable IDs and document ordering.

V5 and all older supported maps migrate by adding empty navigation arrays and
ordinals set to one. Saving emits v6 only. Legacy scenario-v3 projection stays
unchanged because topology has no representation there.

### Elevator grid alignment

The current v5 elevator definition snaps X/Z to tenths, while navigation nodes
and the destination grid use cell centers. M1C.1 changes newly placed and
explicitly moved elevators to `cell-center` snapping. Connector commands,
inspector edits, and probe adapters must share that rule rather than rounding
through separate paths.

Migration must not silently shift an existing elevator: changing its exact
deck/aperture location could move riders or alter collision. A migrated
off-center v5 connector therefore retains its exact X/Z, remains valid, and
emits a non-blocking `legacy-off-center-connector` authoring diagnostic. Its
compiled endpoint port records both the containing grid cell used for topology
and the exact world-space deck center used for boarding. Moving that connector
in v6 normalizes it to the selected cell center; undo restores its exact prior
coordinate. New v6 connectors are always centered.

## Compiled topology

Add a renderer-independent, bounded `NavigationTopology` under `src/sim`.
Compilation produces dense plain/typed data in stable document order:

- one port for each authored node;
- lower and upper synthetic ports keyed by connector stable ID and stop;
- two directed runtime arcs for every undirected authored link;
- two directed vertical arcs for every elevator connector;
- static arc costs and stable tie-break keys;
- adjacency offsets into one bounded arc array.

Same-floor arc cost is the completed static grid cost between the two anchors,
using the existing traversal rules. An authored link whose endpoints are not
statically reachable is a validation error. A vertical arc uses the connector's
travel ticks plus dwell ticks as a stable planning cost; it does not fluctuate
with the lift's current phase. Dynamic bodies may delay execution but never
rewrite topology.

Route queries use bounded Dijkstra over at most 160 compiled ports. Ties resolve
by total cost, hop count, then stable port/arc order. Queries occur when intent,
topology revision, or known target layer changes—not for every enemy every
tick. Route state stores port IDs/indices and a cursor; it never stores mutable
object references or dense enemy indices as identity.

An enemy attaches to the nearest statically reachable authored node on its
current layer, ordered by completed grid cost and then stable node ID. A known
same-layer target continues to use the ordinary destination field directly. A
different-layer target attaches to its legitimately remembered endpoint or the
nearest reachable node on that remembered layer. Missing source/target anchors
produce an explicit no-route result; the planner never invents a link.

## Layer-local navigation integration

`DestinationFieldCache` becomes layer-aware while retaining one global 2,048
expansion budget and one preallocated builder. Goal/actor cache keys add stable
layer index, and each completed slot records the corresponding layer revision.
The cache selects from `layerMaps` for the requested slot instead of always
using the player's visible `this.map`. This avoids allocating one full cache per
floor while allowing enemies on different floors to move simultaneously.

Introduce a bounded topology-intent step after perception and before the
existing navigation system:

```text
perception / evidence update
topology intent and route reconciliation
layer-aware destination-field requests and bounded build
enemy movement preparation toward the current local goal
facing
existing elevator support/motion
existing breakaway, jump, X/Z physics, and vertical resolution
```

M1C must not move elevator support after body physics. An enemy that enters a
dwelling platform on the final dwell tick may miss it and wait for the next
cycle; that is valid autonomous-elevator behavior.

## Enemy route and elevator phases

New route state is stored in bounded enemy-pool columns and included in spawn,
swap removal, reset, snapshots, diagnostics, and replay-derived behavior:

```text
NONE -> APPROACH_PORT -> WAIT_PLATFORM -> BOARD
     -> RIDE -> DISEMBARK -> APPROACH_PORT / LOCAL_GOAL -> NONE
```

- **Approach port:** move through the current layer's destination field to the
  authored staging node linked to the elevator endpoint.
- **Wait platform:** stop on the safe staging node. Observe connector phase;
  issue no call/cycle request.
- **Board:** only target the endpoint center while the platform is dwelling at
  this stop with enough dwell remaining to make progress. Physical collision
  and support acquisition decide whether boarding succeeds.
- **Ride:** once `supportKind === ELEVATOR` and support ID matches, request zero
  AI locomotion. The elevator carries the body; there is no passenger list,
  centering, input suppression, or mass-dependent motion.
- **Disembark:** after the existing layer handoff at the destination dwell,
  target the linked destination staging node and walk off normally.
- **Failure/replan:** topology edits, connector removal, displacement, death,
  or two missed full shuttle cycles clear the current route and replan after a
  deterministic 30-tick cooldown. Alternate paths use the normal stable graph
  tie breaks.

Multiple enemies may wait or board and continue to use ordinary body collision.
M1C does not add elevator reservations or scripted passenger ownership. The
automated proof includes two riders to ensure stable crowd behavior, while the
release gate requires only one enemy to complete the route reliably.

## Patrol and knowledge rules

An unaware enemy with a reachable `patrol: true` node on its current layer may
join that patrol component. It approaches the nearest reachable patrol node,
waits 60 ticks, then chooses an outgoing same-floor patrol neighbor in stable
link order rotated by spawn sequence. It avoids immediately reversing when
another neighbor exists. Evidence, engagement, investigation, retreat, defeat,
or displacement cancels patrol immediately; existing perception priorities win.
Maps with no patrol nodes behave exactly as they do in schema v14.

Cross-floor pursuit stores the layer associated with legitimate target memory.
Direct sight updates last-seen X/Z/layer as today. A narrow elevator inference
is allowed when an enemy has confirmed sight of the player supported by a known
connector: if the player remains on that connector through its layer handoff,
the enemy may update the remembered layer to the connector's opposite endpoint.
It then routes to that endpoint—not to the player's unseen live X/Z. After
disembarking, it searches at the remembered endpoint and resumes pursuit only
if ordinary same-layer perception reacquires the player.

An enemy that did not see the boarding/transit receives no layer update. Sound,
TrueSight, presentation visibility, editor state, and `player.layerIndex` by
itself cannot create cross-floor knowledge.

## Replay, reset, and observability

M1C.1 introduces recording schema v15 together with authoring-map v6 because a
recording embeds the current authoring document. Schema v15 pins an
`authored-navigation-topology-v1` profile and the topology capacities. Schemas
v2-v14 remain on their frozen authoring/replay paths and retain the current
cross-layer hold behavior. No application release number is assigned until an
M1C closure checkpoint.

Reset, Restore positions, map replacement, and replay rebuild topology and
clear disposable route state. Live authoring recompiles topology, increments a
topology revision, preserves unrelated bodies, and causes affected AI routes to
reconcile on the next fixed tick.

Extend `window.__lantern` and AI View without exposing mutable storage:

- `navigationTopology()` returns detached nodes, endpoint ports, arcs,
  capacities, revision, and validation/compile summaries;
- `navigationRouteEvents()` returns the newest 32 entries from a 128-entry ring
  plus retained/capacity/dropped counters;
- enemy diagnostics include patrol node, route ports/cursor, phase, connector,
  wait/missed-cycle counters, known target layer and evidence source, and last
  failure;
- the debug overlay draws authored nodes/links, derived elevator arcs, the
  selected enemy route, and current local goal only while developer tools are
  open.

Suggested bounded events are route planned/cleared, port reached, platform
wait, board, ride, disembark, target-layer inference, replan, and failure. They
are diagnostics only and do not drive behavior.

## Implementation slices

### M1C.1 — data, migration, compilation, and pure queries

Implement authoring-map v6, schema-v15 compatibility selection, topology
validation/compilation, deterministic route queries, and detached read probes.
Do not change enemy movement yet.

Expected files: `src/authoring/authoring_map.js`,
`src/authoring/authoring_commands.js`, `src/authoring/authoring_history.js`,
`src/authoring/map_compiler.js`, `src/sim/scenario.js`, `src/sim/simulation.js`,
`src/config.js`, a new `src/sim/navigation_topology.js`, recording tests, and
authoring/topology tests.

Acceptance: v5 migrates exactly; invalid topology produces structured paths and
codes; save/load/undo/redo retain stable IDs; graph ties are deterministic;
schema-v14 replay fixtures remain byte-for-behavior frozen.

Recommended implementation model: `gpt-5.6-sol`, medium reasoning, because
schema/replay compatibility is the dominant risk.

### M1C.2 — editor and topology visibility

Add the Navigation palette/channel, node stamp/select/move/delete, two-click
link creation, endpoint-port picking, inspector fields, semantic history,
Canvas/Three debug geometry, and the topology probe/overlay. Partial link
gestures are transient editor state and never dirty the map.

Expected files: `src/authoring/definition_catalog.js`,
`src/authoring/editor_interaction.js`, `src/browser/authoring_editor.js`,
`src/browser/map_palette.js`, `src/browser/authoring_inspector.js`,
`src/browser/renderer.js`, `src/presentation/three_presentation.js`,
`src/main.js`, and editor/presentation tests.

Acceptance: create, link, select from either endpoint, move, delete, undo,
redo, save/reload, layer switching, and endpoint linking all preserve stable
selection and never affect runtime body layers.

Recommended implementation model: `gpt-5.6-terra`, medium reasoning.

### M1C.3 — layer-aware local fields and opt-in patrol

Make `DestinationFieldCache` layer-aware, add topology route/patrol state to the
enemy pool, and implement same-floor patrol only. Existing evidence and combat
states interrupt it. Add route diagnostics and a small patrol fixture.

Expected files: `src/sim/destination_field_cache.js`, `src/sim/pools.js`,
`src/sim/simulation.js`, `src/config.js`, `src/browser/ai_view.js`, and focused
navigation/perception/replay/soak tests.

Acceptance: two enemies can patrol on different layers within the existing
global expansion budget; maps without patrol nodes and all schema-v14 fixtures
remain unchanged; pool swaps preserve route identity.

Recommended implementation model: `gpt-5.6-sol`, medium reasoning.

### M1C.4 — autonomous elevator execution

Implement the approach/wait/board/ride/disembark phases against existing
elevator and support state. Add the separate three-floor navigation arena with
two chained autonomous connectors, safe staging nodes, an opt-in patrol loop,
and readable landmarks.

Expected files: `src/sim/simulation.js`, `src/sim/pools.js`,
`src/sim/scenario.js`, AI View/presentation adapters, and new connector-route
integration tests. `elevator_pool.js` should change only if a missing read-only
query is proven; its autonomous clock is not redesigned.

Acceptance: one enemy and then two enemies traverse both directions without
summon/cycle commands, retain stable IDs and physical support, tolerate a
missed dwell, and recover after reset/replay.

Recommended implementation model: `gpt-5.6-sol`, high reasoning, because
fixed-step phase timing and physical boarding interact tightly.

### M1C.5 — observed cross-floor pursuit proof

Add remembered layer/elevator evidence, route to the last legitimately known
endpoint, search/reacquisition, schema-v15 golden replay, and the final manual
acceptance route. Preserve cross-floor casting, sight, and sound exclusions.

Expected files: `src/sim/pools.js`, `src/sim/simulation.js`, perceptive helper
modules as needed, `src/browser/ai_view.js`, replay fixtures, cross-floor
integration/soak tests, and current contracts after acceptance.

Acceptance: an observer follows a player it saw depart through two chained
connectors and resumes pursuit only after same-floor reacquisition; a second
enemy that did not observe departure remains unaware; replay and reset reproduce
the route and no fixed-tick budget grows with elapsed play time.

Recommended implementation model: `gpt-5.6-sol`, high reasoning.

## Automated test matrix

- Authoring v5-to-v6 migration, unknown future version rejection, validation
  diagnostics, capacities, stable IDs, semantic history, and atomic load.
- Pure graph compilation and route tie cases, disconnected graphs, derived
  elevator ports/arcs, stable costs, and bounded overflow behavior.
- Layer-aware destination fields under one global expansion budget and retained
  completed fields during rebuild.
- Patrol opt-in/interrupt/resume, deterministic neighbor choice, pool swap, and
  maps with no topology.
- Elevator arrival timing, upper/lower boarding, missed dwell, ride support,
  layer handoff, disembark, crowding, connector edit invalidation, and reset.
- Observed transition inference versus unobserved/hidden player, no unseen live
  X/Z tracking, no cross-layer casting/sight/sound, and ordinary reacquisition.
- Schema-v15 recording/golden/soak plus frozen schema-v14 and older fixtures.
- Canvas/Three topology view-model parity and bounded resident debug resources.

## Manual acceptance

1. Open `?arena=navigation` in Canvas and Three.js on separate passes; enable
   developer tools, AI View, and topology overlay.
2. Watch the enemy complete a same-floor patrol, including its 60-tick node
   dwell and stable neighbor choice.
3. Let the enemy see the player board the first elevator. Ride to the middle
   floor, wait for same-floor reacquisition, then let it see the player board
   the second elevator to the top without using debug cycle/summon.
4. Confirm the overlay shows staging, waiting, boarding, riding, disembarking,
   and endpoint search rather than a live unseen player target.
5. Allow same-floor reacquisition at the top; confirm normal pursuit/casting
   resumes only then.
6. Descend and repeat once. Miss one elevator deliberately and confirm the
   enemy waits for a later clock cycle rather than calling or teleporting it.
7. Reset and replay the recorded command log; confirm authored elevator starts,
   patrol, inferred transition, stable IDs, and route event order reproduce.
8. In edit mode move a node, undo/redo, link an endpoint, save/reload, and
   verify the active editor layer remains independent from runtime layers.

## Risk containment and rollback points

- Each slice lands independently and keeps `npm run check` green. M1C.1 and
  M1C.2 have no enemy-behavior change and can be reverted without touching M1B.
- The schema-v15 branch is explicit; never modify schema-v14 behavior to make a
  new golden pass.
- Keep topology in a separate module and route columns in the existing enemy
  pool. Do not turn `Simulation` extraction or a general actor/ECS refactor into
  a prerequisite.
- If layer-aware destination caching cannot retain the global budget without
  memory growth, stop after M1C.2 and revise M1C.3; do not allocate one complete
  cache per authored floor.
- If reliable physical elevator boarding needs scripted attachment, stop and
  report the failing support case. Passenger ownership is outside M1C.
- If observed connector inference cannot be demonstrated without revealing
  hidden live state, finish M1C at patrol/elevator traversal and defer pursuit
  rather than weakening perception authority.

## Explicit non-goals and later backlog

No navmesh, automatic graph generation, arbitrary directed/action links,
stairs/portals/jumps as graph edges, multi-stop or called elevators, elevator
reservations, squad knowledge, cross-floor sound or sight, hidden-target
tracking, general creature planner, dynamic obstacle topology rebuild, hazard
cost field, general trigger graph, procedural dungeon generation, networking,
or simulation-wide ECS/refactor belongs to M1C.

### Later dynamic traversal-cost slice

Fire, water, ice, furniture, crowds, and temporary holes should not be folded
into M1C merely because they affect movement. The later bounded design should
keep three distinct inputs:

- **static traversal:** walls, authored apertures, and permanently blocked
  cells, represented by the existing map revision;
- **dynamic occupancy:** only sufficiently large or long-lived bodies that can
  make a cell temporarily impassable, with local collision remaining the
  fallback for small clutter and other agents;
- **hazard channels:** sparse per-cell fire, slip, water, or similar costs,
  transformed by a small set of agent profiles into blocked or weighted cells.

A circular fire patch does not require circular pathfinding. Rasterize the
circle conservatively into the cells it overlaps, then let the actor's policy
decide whether those cells are forbidden, expensive, or acceptable. A lethal
fire can be blocked for a vulnerable creature while a resistant creature uses
a lower cost; avoid one unique field per actor.

Start that later slice by rebuilding referenced fields from sparse dirty cells
within the existing global budget. Adopt an incremental repair algorithm such
as LPA* or D* Lite only if profiling shows repeated full-field rebuilds are the
actual bottleneck. Crowd avoidance or reservations are a separate local-motion
problem and must not be presented as global pathfinding.

## Research references

- The broader, non-authoritative [Lantern research and inspiration shelf](../references.md)
  provides reusable engine, browser, AI, design, and process references. M1C
  depends only on the sources below.
- **Direct inspiration:** [OpenNox repository](https://github.com/opennox/opennox),
  [documentation](https://opennox.github.io/docs/index.html), and
  [supporting libraries](https://github.com/noxworld-dev/opennox-lib) — local
  behavioral comparison for authored waypoints, bounded detailed paths, known
  formats, and special traversal cells; GPL-3.0 reference only.
- **Foundation:** [Introduction to A*](https://www.redblobgames.com/pathfinding/a-star/introduction.html)
  and [grid-pathfinding optimizations](https://www.redblobgames.com/pathfinding/grids/algorithms.html)
  by Amit Patel — graph representation, Dijkstra/A* tradeoffs, distance fields,
  and reducing a dense grid to meaningful decision points.
- **Foundation:** [Near Optimal Hierarchical Path-Finding](https://webdocs.cs.ualberta.ca/~mmueller/ps/2004/hpastar.pdf)
  by Botea, Muller, and Schaeffer — the formal coarse/fine search pattern most
  analogous to M1C, though Lantern's authored graph is semantic rather than an
  automatically clustered HPA* abstraction.
- **Foundation:** [Crowd Pathfinding and Steering Using Flow Field Tiles](https://www.gameaipro.com/GameAIPro/GameAIPro_Chapter23_Crowd_Pathfinding_and_Steering_Using_Flow_Field_Tiles.pdf)
  by Elijah Emerson — why shared goal fields are effective for many units and
  how integration and flow layers can be separated.
- **Comparative inspiration:** [Recast Navigation](https://github.com/recastnavigation/recastnavigation) —
  the principal polygon-navmesh alternative. Its geometry rasterization,
  polygon generation, Detour queries, and crowd modules are useful comparison
  points, but are unnecessary for Lantern's current cell-authored world.
- **Comparative foundation:** [Godot 2D navigation overview](https://docs.godotengine.org/en/stable/tutorials/navigation/navigation_introduction_2d.html)
  — a clear industry-facing separation among navmesh regions, arbitrary links,
  agents, avoidance, and obstacles. In particular, avoidance obstacles do not
  automatically change global paths.
- **Future reference:** [D* Lite](https://publications.ri.cmu.edu/d-lite) by
  Koenig and Likhachev — a
  later option for repairing similar searches after localized cost changes,
  not a prerequisite for M1C.
