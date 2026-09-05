# M1C Authored Navigation Topology

> **Status:** active, sessionized technical plan · **Baseline:** Lantern `0.9.3`,
> recording schema v14, authoring-map v5 · **Implementation:** M1C.1-M1C.3 complete;
> M1C.4 implemented with manual Canvas/Three acceptance pending; M1C.5 not started

M1C adds a small authored topology above Lantern's existing layer-local
destination fields. Authors describe meaningful places and connections; the
current grid navigation still performs ordinary X/Z movement inside a floor.
Elevator connectors contribute the only cross-floor edges.

The milestone is complete when an unaware enemy can follow an opt-in authored
patrol and an enemy that actually observes the player leave on an elevator can
wait, board the autonomous shuttle, disembark, and resume ordinary perception.
It is not a navmesh, a general planner, or cross-floor omniscience.

This document is also the implementation handoff contract. The numbered
work packets near the end are intentionally sized so one Codex session can
implement, verify, document, and hand off a coherent change in roughly five
hours. A packet that misses its exit gate stops there; the next packet does not
absorb unfinished work merely to preserve a schedule.

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
  keys, not a second pathfinder. Authoring layers may have different grid
  dimensions, so adding only a layer key would be incorrect: completed-field
  buffers and builder indexing must also understand the selected layer's width,
  height, and revision.
- Authoring-map v5 stores map-level connectors with stable IDs and compiles an
  endpoint recipe onto each linked layer. The authoring editor already has
  stable selection, semantic history, atomic compilation, and connector
  picking. Navigation authoring should reuse these seams.
- Both elevator endpoints are physically boardable while the fitting platform
  dwells there. When the platform is absent, the upper endpoint is a real
  aperture, so AI must wait at a staging node and enter only after arrival.
- Elevators remain timer-driven. M1C AI may observe and wait for their state,
  but it never issues `cycleElevator` or `summonElevator` commands.
- `EnemyWizardPool` is a swap-and-pop typed-array pool. Route state therefore
  needs fixed-capacity columns and fixed-stride route rows, and every new field
  must participate in spawn initialization, swap removal, reset, snapshots,
  diagnostics, and tests. Mutable objects and dense pool indices are not
  stable identity.

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

The v6 implementation extends the existing strict normalization and semantic
command machinery rather than adding a parallel document editor:

- `normalizeCurrentDocument()`, `authoringMapDiagnostics()`, and
  `validateAuthoringMapWithDiagnostics()` own structural validation and stable
  diagnostic paths;
- `migrateAuthoringMapV5()` performs only the additive v5-to-v6 migration;
- `createAuthoringCommand()` and `commandFromAuthoringAction()` gain navigation
  node/link patch kinds plus the two ordinal root fields;
- node/connector deletion emits one atomic command containing the deletion and
  all incident-link deletions; and
- `compileAuthoringMap(after)` remains the pre-history acceptance boundary, so
  invalid commands never enter undo/redo history.

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

Topology compilation must not borrow an in-progress runtime destination field.
For each layer, a reusable cold-path Dijkstra scratch buffer computes exact
10/14 static costs with `navigationCanTraverse()`. The scratch capacity is the
largest compiled layer cell count and is reused serially across links; it is
allocated during map compilation/reset, never in the fixed-step loop. The
compiler may group links by source anchor to avoid repeated searches, but that
is an optimization rather than a different result. `GridReachability` alone is
insufficient because it reports only reachable/unreachable and not weighted
cost.

The compiled representation uses indices internally and stable IDs at public
boundaries. Recommended bounded arrays are:

```text
portKind[160]              Uint8
portStableOrder[160]       Uint16
portLayerIndex[160]        Uint16
portCellX/Z[160]           Uint16
portWorldX/Z[160]          Float32
portConnectorIndex[160]    Uint16, 0xffff when not an endpoint
portConnectorRuntimeId[160] Uint32, zero when not an endpoint
portStop[160]              Uint8
adjacencyOffset[161]       Uint16

arcTo[544]                 Uint16
arcCost[544]               Uint32
arcKind[544]               Uint8
arcStableOrder[544]        Uint16
```

The maximum 544 directed arcs covers 256 undirected authored links plus 16
two-way elevator connectors. Overflow is a validation error, not truncation.
Stable document order determines port and arc order. A cold-path immutable
metadata table maps each port index to its string authoring key for detached
probes/editor diagnostics; string IDs never enter fixed-step route rows. Route
query scratch arrays are capacity 160 and use a binary heap or bounded linear
minimum selection; either is acceptable at this scale if tests pin total-cost,
hop-count, then stable-order tie breaks. The topology module has no renderer,
DOM, enemy-pool, or elevator-pool dependency.

## Layer-local navigation integration

`DestinationFieldCache` becomes layer-aware while retaining one global 2,048
expansion budget and one preallocated builder. Goal/actor cache keys add stable
layer index, and each completed slot records the corresponding layer revision.
The cache selects from `layerMaps` for the requested slot instead of always
using the player's visible `this.map`. This avoids allocating one full cache per
floor while allowing enemies on different floors to move simultaneously.

Layers are not required to share dimensions. At reset/map replacement, the
cache sizes its 68 completed-field buffers and single builder scratch to the
largest authored layer cell count. Each slot stores `layerIndex`, `width`,
`height`, and `layerRevision`; only the first `width * height` entries are
meaningful. Request keys become `(kind, stableTargetId, targetCell,
layerIndex, layerRevision)`. `update(layerMaps, 2048)` spends the same one
global budget against whichever slot owns the active builder, and
`gradientStep(layerMaps[slot.layerIndex], slot, ...)` interprets indices using
that slot's width. This retains bounded memory proportional to the largest
floor rather than allocating a full cache per floor or incorrectly indexing a
different-sized map.

The cache keeps its current four actor and 64 goal slots, deterministic request
priority, retained completed field during rebuild, and telemetry. Map edits
increment only the affected layer revision plus topology revision; unrelated
completed slots remain reusable when their layer revision is unchanged.

Add `layerMapRevisions`, a fixed `Uint32Array(MAX_AUTHORING_LAYERS)`, to
`Simulation`. Preserve the existing scalar `mapRevision` as the aggregate
compatibility/diagnostic counter for callers outside the cache. A collision or
surface edit increments the addressed layer entry and the aggregate counter; a
topology-only edit increments `topologyRevision` but not a layer map revision.
Full map replacement/reset initializes all live layer entries deterministically.

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

Use scalar typed-array columns for phase, topology revision, route length and
cursor, active connector stable runtime ID, wait-start tick, missed cycles,
replan tick, patrol/current/previous port, dwell remaining, known target layer,
evidence kind, and last failure code. Use `0xffff` as the no-port/no-layer
sentinel and zero as the no-runtime-ID sentinel.
The route itself is a fixed-stride `Uint16Array(enemyCapacity * 160)`; each
enemy owns one 160-port row, so the maximum storage is 10,240 entries (20 KiB
at the current 64-enemy capacity). `removeSwap()` copies the scalar columns and
the entire fixed route row from the moved enemy before clearing the tail. Tests
must swap-remove an enemy with a non-empty route and prove that the surviving
stable ID retains its route and evidence.

- **Approach port:** move through the current layer's destination field to the
  authored staging node linked to the elevator endpoint.
- **Wait platform:** stop on the safe staging node. Observe connector phase;
  issue no call/cycle request.
- **Board:** only target the endpoint center while the platform is dwelling at
  this stop with enough dwell remaining to make progress. “Enough” is computed
  every fixed tick as `ceil(distanceToDeck / maximumEnemySpeed / FIXED_DT) + 2`
  ticks; do not introduce a presentation-time timeout. Physical collision and
  support acquisition decide whether boarding succeeds. If the platform leaves
  before support is acquired, return to `WAIT_PLATFORM` for the next cycle.
- **Ride:** once `supportKind === ELEVATOR` and support ID matches, request zero
  AI locomotion. The elevator carries the body; there is no passenger list,
  centering, input suppression, or mass-dependent motion.
- **Disembark:** after the existing layer handoff at the destination dwell,
  target the linked destination staging node and walk off normally.
- **Failure/replan:** topology edits, connector removal, displacement, death,
  or two missed full shuttle cycles clear the current route and replan after a
  deterministic 30-tick cooldown. Alternate paths use the normal stable graph
  tie breaks.

The active connector is stored as the compiled connector's stable numeric
runtime ID. Resolve its current dense `ElevatorPool` index with `findIndexById()`
on each observation tick because pool swap-removal can move elevators. `RIDE`
compares the body's support ID with that runtime ID; it never trusts a cached
dense pool index. Authoring string IDs remain available only in topology
metadata and detached diagnostics.
The route cursor advances only after physical facts are observed: staging goal
reached, matching elevator support acquired, existing layer handoff completed,
and destination staging goal reached. Planner intent alone never advances it.

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
Schema v15 extends direct-sight memory from last-seen X/Z to last-seen
X/Z/layer. A narrow elevator inference is allowed when an enemy has confirmed
sight of the player supported by a known connector: if the player remains on
that connector through its layer handoff, the enemy may update the remembered
layer to the connector's opposite endpoint. It then routes to that endpoint—not
to the player's unseen live X/Z. After disembarking, it searches at the
remembered endpoint and resumes pursuit only if ordinary same-layer perception
reacquires the player.

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

## Navigation acceptance arena

Add `createNavigationDebugArenaScenario()` and route it only through
`?arena=navigation`; do not extend the M1B holes or elevator fixtures. The arena
is an authored v6 document with three 24-by-24 layers at Y 0, 3, and 6, two
autonomous two-stop connectors, and no multi-stop abstraction. The following
cells are implementation targets; a cell may move during the arena packet only
to resolve a demonstrated collision/visibility problem, and the final fixture
and this table must then be updated together.

| Layer | Connector/deck cell | Required staging/path nodes | Purpose |
| --- | --- | --- | --- |
| lower | A `(6,18)` | `(3,18)`, `(7,18)`, `(7,14)` | deterministic player/enemy start sightline, lower patrol segment, A queue |
| middle | A `(6,18)`, B `(17,10)` | `(7,18)`, `(11,18)`, `(11,10)`, `(16,10)` | disembark A, traverse a visible corridor, queue for B |
| upper | B `(17,10)` | `(16,10)`, `(16,6)`, `(20,6)` | disembark/search area and upper patrol segment |

The compiler derives connector ports at deck centers `(6.5,18.5)` and
`(17.5,10.5)`. Explicit same-floor links connect each staging node to its
visible endpoint and connect the listed corridor/patrol nodes in order. Patrol
flags form one short loop on the lower floor and remain opt-in. Safe queue cells
must not overlap the aperture, walls, dynamic props, or the natural walk-off
lane. Use fixed dwell/travel ticks from the existing elevator fixture rather
than introducing arena-only elevator logic.

The arena includes a lower-floor obelisk/encounter spawn positioned so an enemy
can first acquire the player on the same floor, one second enemy for crowding,
strong per-floor color/landmark differences, and a deterministic lower-floor
player reset. The fixture exposes scripted test helpers only through existing
simulation/probe seams; no hidden teleport or passenger attachment is allowed
in the manual acceptance path. `scripts/serve_options.mjs` gains Canvas and
Three.js navigation URLs, and `test/serve_options.test.js` pins them.

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

## Five-hour implementation work packets

The five milestone slices above are review boundaries. The packets below are
the execution units. Each packet should fit one focused session, but the exit
gate—not elapsed time—decides whether it is complete. Do not begin a dependent
packet in the remaining minutes of a session.

### Dependency ledger

| Packet | Depends on | Behavior enabled at exit | Preferred model |
| --- | --- | --- | --- |
| C1.1 format envelope | baseline | v6 load/save/migration only | Terra, medium |
| C1.2 semantic authoring | C1.1 | programmatic topology edits only | Terra, medium |
| C1.3 topology compiler | C1.2 | pure compiled routes only | Sol, high |
| C1.4 schema/probes | C1.3 | v15 compatibility branch and read-only probes | Sol, medium |
| C2.1 editor gestures | C1.2 | nodes/links editable in UI | Terra, medium |
| C2.2 topology display | C1.3, C2.1 | Canvas/Three inspection | Terra, medium |
| C3.1 layer-aware fields | C1.3 | local fields on any floor | Sol, high |
| C3.2 enemy route storage | C1.4 | bounded inert route/patrol state | Terra, medium |
| C3.3 same-floor patrol | C3.1, C3.2 | opt-in patrol | Sol, high |
| C4.1 elevator executor | C3.1, C3.2 | one connector traversable by AI | Sol, high |
| C4.2 navigation arena | C2.2, C3.3, C4.1 | three-floor manual fixture | Terra, medium |
| C4.3 elevator hardening | C4.2 | missed-cycle, crowd, reset coverage | Sol, high |
| C5.1 observed pursuit | C4.3 | legitimate cross-floor pursuit | Sol, high |
| C5.2 closure | C5.1 | golden, soak, manual and contract closure | Sol, high |

C2.1 may run after C1.2 while C1.3 is being reviewed, but no two agents should
edit the authoring schema/commands simultaneously in one working tree. C3.2 may
be implemented before C3.1, but route behavior remains disabled until both are
complete. All other arrows are hard dependencies.

### Packet C1.1 — v6 format envelope and migration

**Scope:** advance authoring-map v5 to v6 without compiling or using topology.

- Add the two monotonic ordinals and normalized node/link arrays to
  `src/authoring/authoring_map.js`.
- Add strict endpoint normalization and structured diagnostics with exact
  document paths. Reject unknown fields and capacity overflow.
- Add `migrateAuthoringMapV5()`; preserve connector X/Z exactly and emit the
  non-blocking legacy off-center diagnostic.
- Keep v1-v4 migrations compositional through v5 into v6. Do not touch legacy
  scenario-v3 projection.
- Centralize the new navigation capacities and enum/sentinel values in
  `src/config.js`; reuse the existing authoring layer/elevator limits rather
  than duplicating or relocating them.

**Focused verification:** authoring-map load/round-trip, every older migration,
future-version rejection, malformed endpoints, duplicate pairs, ordinals, and
capacity edges. Run the authoring-map and multi-layer authoring tests.

**Exit gate:** a v5 fixture migrates to a byte-stable normalized v6 document;
save/reload is stable; no compiler, runtime, editor, or replay behavior changes.

**Likely files:** `src/config.js`, `src/authoring/authoring_map.js`,
`test/authoring_map.test.js`, `test/multi_layer_authoring.test.js`, fixtures.

### Packet C1.2 — semantic commands, history, and connector snapping

**Scope:** make topology fully editable through pure authoring commands, still
without editor UI or runtime behavior.

- Add place/move/update/remove node and place/remove link commands with stable
  ordinal allocation and canonical undirected endpoint ordering.
- Extend history patch cloning/diff/application for root ordinals, nodes, and
  links. Node or connector deletion removes incident links atomically.
- Change new/moved v6 elevator placement to the shared cell-center snap rule;
  do not reposition migrated connectors until the user moves one.
- Ensure `commandFromAuthoringAction()` validates the complete post-command
  document through `compileAuthoringMap()` before history mutation.
- Add scenario/probe adapters only when they delegate to these commands; no
  second mutation path.

**Focused verification:** CRUD, duplicate prevention, exact undo/redo, deletion
cascades, restored ordinals, moved legacy connector undo, and rejected-command
history cleanliness.

**Exit gate:** a headless test can construct the full three-floor topology,
undo it to v6-empty state, redo it, save/reload it, and retain every stable ID.

**Likely files:** `src/authoring/authoring_commands.js`,
`src/authoring/authoring_history.js`, `src/authoring/definition_catalog.js`,
`src/sim/scenario.js`, authoring command/history tests.

### Packet C1.3 — pure topology compiler and queries

**Scope:** compile and query topology without reading or changing AI state.

- Add `src/sim/navigation_topology.js` with the bounded arrays, sentinels,
  adjacency construction, cold-path static-cost scratch, and pure route query.
- Extend `compileAuthoringMap()` to compile connector ports after every layer
  and connector is known; attach the immutable topology result and diagnostics.
- Validate endpoint layer agreement and static reachability using 10/14 grid
  costs and corner-cut rejection.
- Implement source/target anchor selection by completed static cost, then stable
  ID. Pin no-anchor and disconnected results.
- Return detached stable-ID projections from public query helpers; do not leak
  internal typed arrays.

**Focused verification:** zero topology, maximum capacities, exact port/arc
counts, costs, disconnected graphs, different layer dimensions, equal-cost tie
breaks, two-way elevator arcs, off-center deck world coordinates, and repeat
compilation byte equality.

**Exit gate:** pure tests route lower-to-upper through two chained connectors
with deterministic port sequence, while unreachable/overflow maps fail with
stable codes and paths. No enemy behavior changes.

**Likely files:** new `src/sim/navigation_topology.js`,
`src/authoring/map_compiler.js`, new `test/navigation_topology.test.js`, compiler
tests.

### Packet C1.4 — schema-v15 compatibility and read-only probes

**Scope:** create the new compatibility envelope before behavior enters it.

- Advance current recording schema to v15 and pin the
  `authored-navigation-topology-v1` profile/capacities.
- Add an explicit v15 replay branch. Leave every v2-v14 branch and fixture
  unchanged; do not make old recordings migrate into new AI behavior.
- Rebuild topology on construct/reset/map replacement/replay and expose a
  detached `navigationTopology()` probe.
- Create the bounded route-event ring and probe shape, but emit only compiler,
  reset, or route-query events available at this packet.
- Pin reset and Restore positions semantics: authored map and elevator initial
  stops restore; disposable route/event state clears deterministically.

**Focused verification:** schema-v15 record/replay with an inert topology,
v14 golden compatibility, detached probe mutation resistance, ring capacity,
map replacement, and reset.

**Exit gate:** v15 is recordable/replayable and reports topology, while the same
simulation under v14 retains its prior cross-layer hold behavior.

**Likely files:** `src/config.js`, `src/sim/simulation.js`, `src/main.js`, replay
inspector/compatibility tests, probe tests.

### Packet C2.1 — navigation editor gestures and inspector

**Scope:** author nodes and links in the browser using semantic commands.

- Add a Navigation channel and node stamp/select/move/delete behavior.
- Add a Link tool whose first endpoint is transient `EditorInteractionState`;
  only the valid second click creates one history command.
- Pick normal nodes and visible connector endpoint ports on the active editor
  layer. Never derive endpoint selection from the player's runtime layer.
- Add patrol toggle and stable ID/layer/cell fields to the inspector. Cell X/Z
  edits use the same validation/snap path as pointer edits.
- Escape, tool/channel change, layer change, import, reset, and selection loss
  cancel a partial link without dirtying the document.

**Focused verification:** pointer hit priority, link both directions, duplicate
rejection, partial cancellation, select/move/delete, inspector edit, undo/redo,
active-layer independence, save/reload, and keyboard focus safeguards.

**Exit gate:** a human can author the C4.2 topology entirely in the editor with
no console commands and inspect all validation failures in the existing UI.

**Likely files:** `src/authoring/editor_interaction.js`,
`src/browser/authoring_editor.js`, `src/browser/map_palette.js`,
`src/browser/authoring_inspector.js`, CSS/HTML only as required, editor tests.

### Packet C2.2 — shared topology view model and renderer parity

**Scope:** make topology and one selected route inspectable; no navigation
behavior.

- Add one renderer-independent topology view model that consumes detached
  topology/enemy diagnostics.
- Draw nodes, same-floor links, endpoint ports, derived vertical arcs, selected
  route, phase, and current local goal while developer tools are open.
- Canvas and Three.js adapters consume the same view model. Keep geometry and
  labels bounded and reuse resident Three.js resources.
- Extend AI View details with topology revision, route result/failure, and
  evidence fields, showing explicit empty/inactive values.
- Add Canvas/Three parity tests at the view-model boundary; renderer tests do
  not substitute for a browser/GPU check.

**Focused verification:** detached inputs, empty topology, maximum topology,
layer filtering, selected-enemy swap/removal, overlay toggle, and bounded Three
resource counts.

**Exit gate:** both renderers show the same authored graph and selected route;
manual browser review records readability but does not block later headless
data work if only cosmetic tuning remains.

**Likely files:** new `src/presentation/navigation_topology_view_model.js`,
`src/browser/renderer.js`, `src/presentation/three_presentation.js`,
`src/presentation/ai_view_model.js`, `src/browser/ai_view.js`, presentation tests.

### Packet C3.1 — variable-dimension layer-aware destination fields

**Scope:** generalize the existing cache without changing AI intent.

- Size slot/builder storage from maximum authored layer cell count at reset.
- Add layer index/dimensions/revision to request and completed-slot identity.
- Change request, update, cost, and gradient APIs to select the correct layer
  map while retaining one builder and one 2,048-expansion global budget.
- Preserve current request priority, goal/actor slot counts, retained completed
  field during rebuild, stable ties, telemetry, and allocation-free tick work.
- Adapt current single-layer callers mechanically with their real layer; do not
  enable cross-floor goals here.

**Focused verification:** simultaneous requests on unequal-size layers,
same-cell coordinates on different layers, one-layer edit invalidation, retained
field, starvation/priority, total expansion budget, and no per-tick allocation.

**Exit gate:** enemies can consume valid local fields on multiple simulated
floors during one tick sequence, and all existing navigation/perception tests
remain behaviorally unchanged.

**Likely files:** `src/sim/destination_field_cache.js`,
`src/sim/simulation.js`, `test/destination_field_cache.test.js`, navigation
tests.

### Packet C3.2 — inert bounded enemy route state

**Scope:** add storage, reset, snapshot, and diagnostics before route behavior.

- Add the scalar columns and fixed-stride 160-port route rows described above.
- Add small pool helpers to clear/set/copy a route row without allocating.
- Initialize all sentinels at spawn; clear on reset/death/removal; copy on
  swap-removal; never key by dense enemy index outside the pool.
- Add detached snapshot/AI diagnostic fields and bounded route-event emitters.
- Keep the topology phase `NONE` for all live behavior in this packet.

**Focused verification:** spawn defaults, maximum route, overflow rejection,
shorter-route tail clearing, swap-remove first/middle/last, reset, snapshot
detachment, stable ID, and repeated spawn/remove soak.

**Exit gate:** pool swap and reset tests prove no route/evidence state can leak
between stable enemy IDs. Existing replay output changes only on schema v15 and
only by the newly pinned diagnostic/snapshot contract.

**Likely files:** `src/sim/pools.js`, `src/sim/simulation.js`, AI view model,
pool/snapshot/replay tests.

### Packet C3.3 — opt-in same-floor patrol

**Scope:** use topology only for unaware same-floor patrol; no elevator entry.

- Add topology intent/reconciliation after perception and before navigation.
- Attach to the nearest reachable patrol node; request its layer-local field;
  dwell 60 ticks; select the next same-floor patrol neighbor using stable order
  rotated by spawn sequence.
- Avoid immediate reversal when another patrol neighbor is available.
- Existing evidence/engagement/investigation/retreat/defeat/displacement wins
  immediately and clears patrol intent. Define re-entry only after the existing
  state returns to unaware/guard.
- Maps and schemas without enabled topology take the exact old path.

**Focused verification:** no-node invariance, disconnected patrol components,
two floors concurrently, deterministic rotation, dwell, interruption/resume,
body collision, pool swap during patrol, reset, v15 replay, v14 frozen fixture.

**Exit gate:** two enemies patrol independently on unequal-size floors within
the one global field budget, and ordinary perception interrupts them on the
same fixed tick ordering.

**Likely files:** `src/sim/simulation.js`, optional small pure patrol helper,
`src/config.js`, AI diagnostics, new `test/navigation_patrol.test.js`.

### Packet C4.1 — one-connector autonomous elevator executor

**Scope:** execute an already planned route through one timer-driven connector.

- Implement `APPROACH_PORT`, `WAIT_PLATFORM`, `BOARD`, `RIDE`, and `DISEMBARK`
  against existing layer fields, elevator clock state, support IDs, and layer
  handoff. Do not modify the elevator clock.
- Resolve connectors/elevators by stable ID each tick; use exact deck world
  center only during board and the linked staging node during approach/walk-off.
- Apply the dwell sufficiency formula and return to wait if departure wins.
- Advance route cursor only from observed physical state. Emit bounded phase
  events and diagnostic failure codes.
- Keep ordinary X/Z collision and support authoritative; no attachment,
  centering, teleport, reservation, or payload-dependent motion.

**Focused verification:** lower-to-upper, upper-to-lower, initially absent
platform, final-dwell miss, exact support ID, layer handoff, jump/push off,
connector/elevator swap, route invalidation, and no summon/cycle request.

**Exit gate:** one enemy traverses both directions through one connector from a
synthetic fixture for repeated cycles, including at least one deliberately
missed boarding window.

**Likely files:** `src/sim/simulation.js`, optional pure route-execution helper,
`src/sim/pools.js` only for proven missing state, AI diagnostics, new
`test/navigation_elevator_route.test.js`. Change `elevator_pool.js` only for a
missing read-only query demonstrated by a test.

### Packet C4.2 — authored three-floor navigation arena

**Scope:** build the exact acceptance fixture and browser routes described
above; do not add pursuit knowledge yet.

- Add `createNavigationDebugArenaScenario()` as authored v6 data with the
  listed nodes, links, patrol flags, connectors, spawns, and landmarks.
- Add `?arena=navigation` selection and Canvas/Three serve-option URLs.
- Add two-connector pure route and physical traversal fixtures using the same
  authored document, avoiding a divergent test-only topology.
- Verify editor load/save of the arena and topology overlay readability.
- If an exact target cell moves for collision safety, update the arena table in
  this plan in the same commit and record why in the test name/comment.

**Focused verification:** authored validation, route sequence, lower/middle/top
layer mapping, connector initial stops, reset spawn, URLs, Canvas view-model,
Three resource bounds, and one full AI traversal in both directions.

**Exit gate:** a human can open either renderer, see and inspect the graph, and
watch patrol plus chained traversal without editor teleport or debug elevator
commands. Cross-floor target pursuit is not expected yet.

**Likely files:** `src/sim/scenario.js`, `src/main.js`,
`scripts/serve_options.mjs`, AI/presentation adapters, scenario/serve/integration
tests.

### Packet C4.3 — elevator traversal hardening and reset

**Scope:** close the mixed-body and lifecycle cases before perception authority
is added.

- Exercise two riders queuing, boarding, colliding, disembarking, and missing
  different cycles without reservations.
- Prove deterministic cooldown after two missed cycles and stable alternate
  path replanning when a connector/topology edit invalidates a route.
- Cover jump/push off, occupied destination space, death/removal during every
  phase, Restore positions, reset, replay rebuild, and live authoring revision.
- Confirm props/torches remain ordinary payloads and do not enter AI route
  storage; preserve existing elevator/fireball and support behavior.
- Add bounded telemetry assertions so an endlessly blocked rider does not grow
  events, fields, routes, or allocations with elapsed play time.

**Focused verification:** dedicated integration matrix, 10-minute fixed-step
soak, stable ID/pool swaps, event-ring counters, memory/capacity telemetry, and
full `npm run check`.

**Exit gate:** one rider is release-reliable, two riders remain deterministic
and recoverable, lifecycle operations restore authored initial elevator stops,
and no scripted passenger ownership was introduced.

**Likely files:** mostly tests plus narrow `simulation.js`/route-helper fixes,
soak harness, diagnostics. A broad elevator rewrite fails this packet's scope.

### Packet C5.1 — observed connector transition evidence

**Scope:** enable cross-floor pursuit only from legitimate schema-v15 evidence.

- Store last-seen layer with direct same-layer sight evidence.
- Arm connector-transition observation only after the observer sees the player
  supported by a known connector. Update remembered layer only if the same
  supported player crosses that connector's existing layer handoff.
- Plan to the remembered opposite endpoint, not live unseen player X/Z. Search
  there after disembarking and resume chase/casting only after ordinary
  same-layer perception reacquires the player.
- Clear/expire inference with the existing evidence lifecycle; map edit,
  connector removal, reset, and replay must not leave an armed stale ID.
- Do not use sound, TrueSight, presentation visibility, editor floor, or direct
  `player.layerIndex` lookup as a substitute for observation.

**Focused verification:** observed boarding/transit, lost sight before boarding,
wrong connector, player jumps off, hidden player changes layer, unobserving
second enemy, no live X/Z tracking, no cross-layer sight/cast/sound, search and
same-floor reacquisition, reset, and replay.

**Exit gate:** the observing enemy follows through both arena connectors and
the control enemy remains unaware. Tests fail if hidden live player state is
substituted for remembered evidence.

**Likely files:** `src/sim/pools.js`, `src/sim/simulation.js`, perception helper
if a pure evidence transition is extracted, AI diagnostics, new
`test/navigation_cross_floor_pursuit.test.js`.

### Packet C5.2 — M1C closure, golden, soak, and contracts

**Scope:** validate and document the integrated result; add no new feature.

- Record and pin one schema-v15 golden covering patrol, observed departure,
  wait/board/ride/disembark through two connectors, endpoint search,
  reacquisition, reset, and replay.
- Run the full automated matrix and a long deterministic soak at maximum
  topology/enemy capacities. Add `test:soak:navigation` to `package.json` and
  record capacity/drop/budget telemetry.
- Perform the manual acceptance below in Canvas and Three.js. Capture remaining
  browser/GPU visual concerns separately rather than weakening simulation tests.
- Update roadmap, architecture/current-contract/release documentation only with
  behavior actually accepted. Assign an application release number only here.
- Audit diffs for frozen schema-v14 fixtures, accidental OpenNox inclusion,
  unbounded collections, runtime allocations, and unrelated refactors.

**Focused verification:** `npm run check`, v15 golden twice with identical
output, frozen older fixtures, soak, serve-option smoke, Canvas and Three manual
checklist.

**Exit gate:** every automated and human acceptance item is recorded as pass or
an explicit scoped follow-up; M1C is not called complete while the browser/GPU
gate is merely inferred from headless tests.

**Likely files:** fixtures/tests and accepted contract docs. Gameplay source
changes indicate an earlier packet was not actually closed and should be
reviewed as such.

### Focused verification command guide

These are the minimum post-implementation commands; packet authors may add
narrower test-name filters while iterating. Newly named tests are created by
the packet that first lists them.

| Packets | Focused command before the full gate |
| --- | --- |
| C1.1-C1.2 | `node --test --test-concurrency=1 test/authoring_map.test.js test/multi_layer_authoring.test.js test/authoring_history.test.js` |
| C1.3 | `node --test --test-concurrency=1 test/navigation_topology.test.js test/navigation_field.test.js` |
| C1.4 | `node --test --test-concurrency=1 test/replay_inspector.test.js test/scenario.test.js` |
| C2.1 | `node --test --test-concurrency=1 test/authoring_editor.test.js test/map_palette.test.js test/input_authoring_history.test.js` |
| C2.2 | `node --test --test-concurrency=1 test/ai_view.test.js test/presentation_parity.test.js test/presentation_instances.test.js` |
| C3.1 | `node --test --test-concurrency=1 test/destination_field_cache.test.js test/navigation_field.test.js` |
| C3.2 | `node --test --test-concurrency=1 test/pools.test.js test/ai_view.test.js test/replay_inspector.test.js` |
| C3.3 | `node --test --test-concurrency=1 test/navigation_patrol.test.js test/perceptive_wizard.test.js test/perception_replay.test.js` |
| C4.1-C4.3 | `node --test --test-concurrency=1 test/navigation_elevator_route.test.js test/vertical_elevator.test.js test/elevator_authoring_runtime.test.js` |
| C5.1 | `node --test --test-concurrency=1 test/navigation_cross_floor_pursuit.test.js test/perception_tactics.test.js test/movement_sound.test.js` |
| C5.2 | `npm run check` then `npm run test:soak:navigation`, followed by the manual checklist |

Every packet finishes with `npm run check`, even when its focused command is
green. The command guide does not authorize updating unrelated golden fixtures.

### Per-session Codex handoff protocol

Every implementation session starts and ends with the same small contract:

1. Read `AGENTS.md`, this plan, the packet's source seams, and the immediately
   preceding handoff/commit. Run `git status --short` before editing.
2. Report unrelated dirty paths and leave them untouched. In particular,
   `opennox/` is a local GPL reference checkout and must never be staged.
3. Restate the packet scope, dependencies, exit gate, and explicit exclusions.
   If a dependency is missing, stop rather than implementing around it.
4. Add the focused failing test first where practical, implement the smallest
   contract, then run the packet's focused tests and `npm run check`.
5. Perform required manual browser/GPU review only in packets C2.2, C4.2, and
   C5.2; state clearly when it remains outstanding.
6. Before a requested commit, stage exact paths/hunks, inspect
   `git diff --cached`, and use one packet-scoped commit. Never combine cleanup,
   OpenNox, or a later packet.
7. Hand off: commit hash if committed; files changed; tests and manual checks;
   exact exit-gate status; capacities/schema effects; remaining defect or open
   question; and the next unblocked packet. A partial packet stays partial.

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
