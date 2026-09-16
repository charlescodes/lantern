# Lantern roadmap

> **Status:** current planning authority. It orders future work but does not
> redefine frozen release contracts. Current repository baseline: application
> `0.9.3`, recording schema v20, authoring-map v7. M1C.1–M1C.5 are
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

## After M1C

- **Editable, floor-aware obelisks:** complete. Obelisks are ordinary authored
  instances on explicit layers; schema v19 gives every enemy a stable home and
  cross-floor return route, while schema v20 enables independent obelisks with
  authored archetypes, living caps, and spawn cadence.
- **M1D — Temple of Ix:** make ordinary editable authored maps and a Room Lab,
  then hand-build a complete temple. It should teach and test the established
  traversal systems and eventually offer three alternative exit goals. These
  are map assets, not a room-prefab schema.
- **M1E — mechanisms:** extend proven, content-driven mechanisms only after the
  temple exposes a real need. Pressure plates are a foundation; triggers,
  levers, chains, doors, and richer trap behavior are not assumed together.
- **M1F — procedural generation:** only after hand-authored rooms and the temple
  establish useful constraints. A later seeded generator should emit ordinary,
  inspectable authoring documents rather than replace authoring.

Additional spells, new actor types, expanded combat, cooperative networking,
and larger-world systems remain later backlog. The open
[health-bar-through-wall defect](./bugs/enemy-health-bar-through-wall.md) stays
separate from this roadmap unless its diagnosis becomes a direct prerequisite.
The [elevator enemy queueing report](./bugs/elevator-enemy-queueing.md) is also
deferred: it is not a prerequisite for M1D's authored-map work.
