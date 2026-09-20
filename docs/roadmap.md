# Lantern roadmap

> **Status:** current planning authority. It orders future work but does not
> redefine frozen release contracts. Current repository baseline: application
> `0.9.3`, recording schema v24, authoring-map v8. M1C.1–M1C.5 are
> implemented; the separate M1C manual acceptance and deferred crowding report
> are recorded in their respective documents.

## Transition after M1B.4

The immediate goal is a trusted post-M1B.4 baseline, not new gameplay.

| Slice | Outcome | Boundary |
| --- | --- | --- |
| T.1 | Canonical documentation foundation and handoff archive | Complete; documentation only. |
| T.2 | Probe and verification baseline | Complete; strengthened existing canonical docs without a parallel runtime probe system. |
| T.3 | Formal M1B / `0.9.3` closure | Complete; application/package bump only, preserving schema v14 and authoring-map v5. |
| T.4 | [M1C authored-navigation topology](./plans/m1c-authored-navigation-topology.md) | Complete; topology authoring, patrol, autonomous elevator traversal, and observed cross-floor pursuit. |

## M1C — authored navigation topology

M1C delivered deliberately small, inspectable navigation rather than a navmesh
replacement. Its five focused slices are complete.

1. **M1C.1 — topology data:** authored high-level nodes and explicit
   bidirectional same-floor links; compile autonomous elevator links from the
   existing connector data.
2. **M1C.2 — authoring and visibility:** editor placement/editing, validation,
   stable IDs, and a readable debug overlay/probe.
3. **M1C.3 — local movement and patrol:** use the topology only to choose goals;
   preserve the existing layer-local movement system for getting there.
4. **M1C.4 — elevator traversal plan:** prove a bounded wait/board/disembark
   policy for the autonomous shuttle, with no rider-owned call behavior.
5. **M1C.5 — cross-floor pursuit proof:** let a confirmed target route through
   topology and resume ordinary pursuit after arrival.

M1C does not provide a general navmesh, arbitrary graph/pathfinding framework,
multi-stop elevators, cross-floor clairvoyance, or a rewrite of current AI.
The later connector-skeleton authoring helper remains within this boundary: it
explicitly writes ordinary inspectable nodes and links and does not infer a
hidden runtime graph.

## After M1C

- **Near-term authoring reliability:** investigate the [navigation floor-transition reports](./bugs/navigation-floor-debug-and-ai.md) before substantial map authoring: stale debug overlay, suspected AI retargeting, and unclear navigation visualization.
- **Editable, floor-aware obelisks:** complete. Obelisks are ordinary authored
  instances on explicit layers; schema v19 gives every enemy a stable home and
  cross-floor return route, while schema v20 enables independent obelisks with
  authored archetypes, living caps, and spawn cadence. Schema v23 makes their
  fixed 600-point runtime health destructible: death stops that encounter,
  opens the occupied cell, and leaves presentation-only rubble until reset.
- **M1D — Temple of Ix:** make ordinary editable authored maps and a Room Lab,
  then hand-build a complete temple. It should teach and test the established
  traversal systems and eventually offer three alternative exit goals. These
  are map assets, not a room-prefab schema.
- **M1E — mechanisms:** the user brought forward the foundation pass without
  marking M1D complete. [Pass A (M1E.1 + M1E.2)](./plans/m1e-mechanisms.md)
  implements bounded signal graphs, plates, full-cell gates, levers, wall
  buttons/chains, logic, and editor wiring. Browser acceptance remains pending.
  Pass B (M1E.3 + M1E.4) retains controlled elevators, moving blocks, and traps
  as unimplemented work. A hinged door or sub-cell moving blocker needs the bounded geometry and camera questions
  in the [doors and dynamic occlusion candidate](./soft-specs/doors-and-dynamic-occlusion.md)
  resolved. The archived provisional “Candidate M1C” label for doors is
  historical and does not redefine the completed navigation M1C.
- **M1F — procedural generation:** only after hand-authored rooms and the temple
  establish useful constraints. A later seeded generator should emit ordinary,
  inspectable authoring documents rather than replace authoring.
- **M1G — progression and difficulty staging:** design an explicit level/stage
  model only after authored encounters provide enough playtest data to balance.
  Candidate progression axes are enemy and obelisk health, obelisk living caps
  and spawn cadence, enemy composition, trap/puzzle damage or enabled features,
  boss and miniboss frequency, and proportional loot/treasure rewards. The
  system must define how player level and area/stage difficulty interact before
  any formula becomes replay authority. Obelisk health remains fixed at 600
  until that contract exists; intermediate cracked/damaged presentation states
  and a bespoke destruction burst are deferred polish within this milestone.

Additional spells, new actor types, expanded combat, cooperative networking,
and larger-world systems remain later backlog. The open
[health-bar-through-wall defect](./bugs/enemy-health-bar-through-wall.md) stays
separate from this roadmap unless its diagnosis becomes a direct prerequisite.
The [elevator enemy queueing report](./bugs/elevator-enemy-queueing.md) is also
deferred: it is not a prerequisite for M1D's authored-map work.

Deferred engineering cleanup is tracked in the
[long-term improvement ledger](./soft-specs/long-term-improvements.md#lt-003-retire-procedural-arena-builders):
clarify saved-map versus test-fixture ownership, retaining useful stable test
builders and removing duplicate playable-map definitions.
