# Probe and observability contract

> **Status:** current operational contract. The documented surface describes
> existing behavior first; new probe work requires a bounded, evidence-driven
> change and relevant tests.

`window.__lantern` is Lantern's browser-side inspection and controlled-command
surface. It exists to make hidden simulation state reproducible and inspectable,
not to grant arbitrary mutation of live arrays.

## Rules

- Read APIs return detached, JSON-safe data and identify gameplay entities by
  stable identity, never dense pool index.
- Mutations enter through commands and are consumed at fixed-tick boundaries.
- Snapshots, diagnostic queues, counters, and test fixtures remain bounded.
- Presentation probes may report renderer state, but rendering cannot become
  gameplay authority.
- A useful bug report includes arena/map, seed or recording, commands, stable
  IDs, tick, relevant probe output, and a manual observation.

## Current surface

The live definition is the frozen `probe` object in
[`src/main.js`](../src/main.js). These categories are a working catalog, not a
second compatibility versioning scheme.

| Category | Read-oriented calls | Controlled mutations | Notes |
| --- | --- | --- | --- |
| Runtime and replay | `snapshot`, `metrics`, `exportCommandLog` | `pause`, `resume`, `step`, `reset`, `injectCommand`, `restoreScenario` | `step` pauses first. A queued mutation is consumed on a fixed tick; while paused, the host advances that tick immediately. |
| World and vertical | `queryAt`, `verticalBody`, `elevators`, `holes`, `holeDiagnostics`, `pressurePlates`, `pressurePlateEvents`, `breakawayFloors`, `breakawayFloorEvents` | `cycleElevator`, `summonElevator` | Elevator helpers are debug requests to the existing autonomous shuttle, not a player-facing activation model. |
| AI and visibility | `encounterDiagnostics`, `enemyDiagnostics`, `aiView`, `trueSight`, `isVisible` | `setAiView` | AI View and TrueSight calls are diagnostic/presentation controls; they do not grant simulation knowledge. |
| Authoring | `authoring`, `editor`, `authoringHistory`, `authoringLayer`, `getAuthoredInstance`, `getAuthoredConnector`, `validateAuthoringMap`, placement predicates | editor, layer, connector, paint, instance, undo/redo, save/load calls | Authoring actions validate/compile atomically through the existing authoring command/history boundary. They are not raw pool writes. |
| Spells and presentation | spell listing/definition/diagnostics, `presentation`, performance-report reads | spell definition/cast/effect calls, debug flags, presentation flags, density cap, metric reset, performance capture | Presentation mutation is local-only. Capture is asynchronous and manual browser/GPU review remains required. |

Snapshot state includes the current tick, seed, recording-schema/profile data,
runtime/editor layer data, entity records, and bounded event/counter summaries.
The vertical helpers return detached data sourced from snapshots or selection
descriptions. Current bounded diagnostic retention includes a 128-entry hole
ring and 128-entry pressure-plate and breakaway rings; snapshots expose their
recent entries rather than unbounded histories.

Use `snapshot()` when one coherent cross-system frame matters. Use a narrow
helper when inspecting one mechanism between steps. Pair a mutating call with
`step(1)` or an immediately refreshed `snapshot()` before drawing conclusions
about fixed-tick state.

## Reproduction report minimum

Record the route (`?arena=...` or an exported map), seed/recording, current
tick, command sequence, stable IDs, relevant probe return values, and expected
versus observed behavior. Include renderer/browser/GPU facts for a presentation
failure. A screenshot or clip is useful evidence, but it does not replace the
authoritative state needed to reproduce a simulation failure.

### Current gaps deliberately left for later

There is no generic per-system event bus, no unbounded trace log, and no promise
that every internal helper becomes public. M1C should add topology-specific
diagnostics only when topology exists. Cross-floor AI, general triggers, and
network inspection remain future work, not reasons to widen the probe now.
