# Lantern Research and Inspiration Shelf

> **Status:** living, non-authoritative bibliography · **Last reviewed:**
> 2026-09-01

This is Lantern's maintained shelf of external research and inspirational
projects. It exists to give future investigations a useful starting point
without turning every interesting engine, paper, or talk into project scope.

Read the [archived post-M1B.4 handoff](./archive/handoffs/2026-08-30-post-m1b4-chatgpt-handoff.md)
when historical product context is needed, but inspect the live repository
before making recommendations. When external research is relevant, retrieve
only the sources needed for the current question, prefer primary sources, cite
them, distinguish repository evidence from inference, and do not treat
reference material as an automatic implementation requirement.

## Source roles

- **Direct reference:** evidence about Nox or a specific behavior Lantern is
  intentionally studying.
- **Foundation:** a durable technical or design source that helps evaluate an
  existing Lantern decision.
- **Inspiration:** a shipped engine, toolchain, project, or development process
  worth learning from without copying its architecture wholesale.
- **Future reference:** useful only after the associated capability becomes an
  active milestone.

Source, test, authored-map, replay, and measured runtime evidence remain more
authoritative than every item on this shelf. Record the exact source and the
Lantern-specific inference whenever research changes a plan.

## Nox and historical engines

| Role and source | Lantern use | Boundary |
| --- | --- | --- |
| **Direct reference:** [OpenNox](https://github.com/opennox/opennox) | Inspect community-preserved Nox behavior, source structure, waypoint/path handling, map mechanics, audio, elevators, and object interactions when original-game observation is insufficient. | GPL-3.0, unofficial, and not guaranteed to match every original version. Use as read-only behavioral evidence; do not copy source or assets. |
| **Direct reference:** [OpenNox documentation](https://opennox.github.io/docs/index.html) | Find terminology and likely code areas before verifying important claims in source or original gameplay. | Community documentation is an index, not final authority. |
| **Direct reference:** [OpenNox libraries](https://github.com/noxworld-dev/opennox-lib) | Research known Nox formats and supporting data structures. | Review licensing and architectural fit before any reuse. |
| **Inspiration:** [Game Engine Black Book: DOOM](https://fabiensanglard.net/gebbdoom/) | Study how a small shipped engine's renderer, data, tools, and hardware constraints form one coherent whole. | Extract engineering reasoning, not software-renderer prescriptions. |
| **Inspiration:** [Quake III Arena source](https://github.com/id-Software/Quake-III-Arena) and [Quake tools](https://github.com/id-Software/quake-tools) | Study runtime/tool separation, content compilation, debug facilities, and inspectable state. | Historical C is not a browser-JavaScript template; check individual licenses before reuse. |
| **Inspiration:** [John Carmack `.plan` archive](https://github.com/oliverbenns/john-carmack-plan) | Historical process reading about concrete problems, measurements, experiments, and outcomes. | Unofficial mirror. Verify an original entry before attributing a quotation. |

## Simulation, data, and collision

| Role and source | Lantern use | Boundary |
| --- | --- | --- |
| **Foundation:** Glenn Fiedler, [Fix Your Timestep!](https://gafferongames.com/post/fix_your_timestep/) | Fixed-step accumulation, render/simulation separation, bounded catch-up, and performance headroom. | A fixed step improves reproducibility but does not prove cross-platform determinism. |
| **Foundation:** Robert Nystrom, [Game Programming Patterns](https://gameprogrammingpatterns.com/index.html) | Vocabulary for game loops, commands, event queues, pools, data locality, and spatial partitions. | Patterns are options, not refactoring mandates. |
| **Foundation:** Richard Fabian, [Data-Oriented Design](https://www.dataorienteddesign.com/dodbook/) | Evaluate typed-array pools, bounded loops, and transformations around actual access patterns. | Do not infer that Lantern needs a general ECS. |
| **Inspiration:** Mike Acton, [Data-Oriented Design and C++](https://www.youtube.com/watch?v=rX0ItVEVjHc) | Data-first problem framing when a measured hot path needs representation work. | Re-measure all C++-specific conclusions in the browser JavaScript engines Lantern supports. |
| **Foundation:** Christer Ericson, [Real-Time Collision Detection](https://realtimecollisiondetection.net/) | Robust circles, boxes, footprints, apertures, sweeps, spatial queries, and numerical tolerances. | Prefer the smallest robust X/Z query; do not drift into general 3D rigid-body physics. |
| **Selective reference:** Jason Gregory, [Game Engine Architecture](https://www.gameenginebook.com/) | Checklist for subsystem boundaries and a later production pipeline. | Consult selectively; its AAA breadth can overscope a solo engine. |

These sources support Lantern's current fixed-step X/Z simulation, limited
gameplay Y, stable IDs, authored/runtime separation, and bounded hot paths. They
do not independently justify fixed point, GPU simulation, zero allocation, or
an ECS rewrite.

## Browser runtime, rendering, and audio

| Role and source | Lantern use | Boundary |
| --- | --- | --- |
| **Foundation:** MDN, [Anatomy of a video game](https://developer.mozilla.org/en-US/docs/Games/Anatomy) | Browser game-loop and scheduling context. | Lantern's simulation contract remains more specific. |
| **Foundation:** MDN, [`requestAnimationFrame`](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame) | Presentation scheduling and interpolation. | Callback timestamps are not variable physics timesteps; account for background throttling. |
| **Foundation:** Chrome DevTools, [Performance profiling](https://developer.chrome.com/docs/devtools/performance) | Reproducible main-thread, rendering, and allocation measurements. | One trace is not a benchmark; record scene, warm-up, browser, and hardware. |
| **Foundation:** MDN, [Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API) and [spatialization basics](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Web_audio_spatialization_basics) | Audible presentation after simulation sound-event, floor, and occlusion rules are defined. | Web Audio output cannot become enemy-hearing authority. |
| **Future reference:** NVIDIA GPU Gems, [High-Speed, Off-Screen Particles](https://developer.nvidia.com/gpugems/gpugems3/part-iv-image-effects/chapter-23-high-speed-screen-particles) | Compare GPU particle techniques only if profiling identifies a real CPU or overdraw bottleneck. | It does not justify moving current kinetic fragments to the GPU. |

## Visibility, navigation, perception, and AI

| Role and source | Lantern use | Boundary |
| --- | --- | --- |
| **Foundation:** Amit Patel, [2D Visibility](https://www.redblobgames.com/articles/visibility/) | Visibility polygons, occlusion reasoning, and readable sight/debug overlays. | Lantern still needs explicit gameplay rules for dynamic blockers and layers. |
| **Foundation:** Amit Patel, [Introduction to A*](https://www.redblobgames.com/pathfinding/a-star/introduction.html) and [grid optimizations](https://www.redblobgames.com/pathfinding/grids/algorithms.html) | Graph representation, A*/Dijkstra tradeoffs, distance fields, and sparse decision points. | Do not introduce a navmesh merely because it is common elsewhere. |
| **Foundation:** Botea, Muller, and Schaeffer, [Near Optimal Hierarchical Path-Finding](https://webdocs.cs.ualberta.ca/~mmueller/ps/2004/hpastar.pdf) | Compare coarse topology plus fine local search with Lantern's authored semantic graph and layer-local fields. | HPA* automatically clusters a map; M1C's graph is intentionally authored and semantic. |
| **Foundation:** Elijah Emerson, [Crowd Pathfinding and Steering Using Flow Field Tiles](https://www.gameaipro.com/GameAIPro/GameAIPro_Chapter23_Crowd_Pathfinding_and_Steering_Using_Flow_Field_Tiles.pdf) | Shared integration/flow fields for many units with common goals. | Lantern does not need Supreme Commander scale or tiled flow infrastructure by default. |
| **Reference library:** [Game AI Pro](https://www.gameaipro.com/) | Select one relevant practitioner chapter for a concrete perception, pathfinding, behavior, or debugging question. | Link to chapters; do not copy or redistribute them. |
| **Comparative inspiration:** [Recast Navigation](https://github.com/recastnavigation/recastnavigation) | Understand navmesh generation, path queries, links, crowds, and debug utilities as an alternative architecture. | Likely excessive for Lantern's current cell-authored 2.5D world. |
| **Comparative foundation:** [Godot 2D navigation](https://docs.godotengine.org/en/stable/tutorials/navigation/navigation_introduction_2d.html) | Compare regions, arbitrary links, agents, avoidance, and obstacles as separate responsibilities. | Godot's API is a conceptual comparison, not a dependency recommendation. |
| **Future reference:** Koenig and Likhachev, [D* Lite](https://publications.ri.cmu.edu/d-lite) | Consider incremental repair after localized cost changes if profiling shows full rebuilds are expensive. | Not a prerequisite for authored topology or initial dynamic hazard costs. |

The active application of these references is documented in the
[M1C authored-navigation plan](./plans/m1c-authored-navigation-topology.md).

## Game design and game feel

| Role and source | Lantern use | Boundary |
| --- | --- | --- |
| **Foundation:** Liz England, [The Door Problem](https://lizengland.com/blog/the-door-problem/) | Check cross-system implications of seemingly small mechanisms such as doors, elevators, pits, and traps. | Dependency awareness does not require every edge case in the first slice. |
| **Foundation:** Hunicke, LeBlanc, and Zubek, [MDA](https://aaai.org/papers/ws04-04-001-mda-a-formal-approach-to-game-design-and-game-research/) | Connect exact mechanics to emergent dynamics and intended player experience. | Vocabulary for iteration, not proof that a mechanic is fun. |
| **Inspiration:** Jan Willem Nijman, [The Art of Screenshake](https://www.youtube.com/watch?v=SkgkIXZ_13Y) | Later combat feedback, impact confirmation, sound, animation, camera response, and readability. | Preserve legibility and motion-sensitivity options; do not add every effect. |
| **Interactive inspiration:** [Juice it or lose it](https://longwelwind.net/blog/juice-it/) | Isolate which presentation layers improve feel in an interactive comparison. | Re-evaluate every effect in Lantern's own camera and combat context. |

For a new mechanism, distinguish its exact simulation **mechanic**, the
decisions and situations that emerge as **dynamics**, and the intended player
**experience**. Manual play remains the authority for feel.

## Debugging, tools, and enthusiast-engine practice

| Role and source | Lantern use | Boundary |
| --- | --- | --- |
| **Inspiration:** [Handmade Hero](https://hero.handmade.network/) and its [episode guide](https://guide.handmadehero.org/) | Topic-specific examples of from-scratch engine work, debugging, profiling, memory, tools, and incremental architecture. | Enormous and C/C++-specific; search targeted episodes rather than imitating the project wholesale. |
| **Future reference:** GDC Vault, [Implementing a Rewindable Instant Replay System](https://gdcvault.com/play/1017769/Implementing-a-Rewindable-Instant-Replay) | Compare rewind-oriented state capture with Lantern's command logs, snapshots, reset, and failure reproduction. | Rewind adds state/versioning costs; begin from an actual debugging need. |

Lantern's operational preference is to expose hidden state through bounded
probes, counters, overlays, events, and snapshots; reproduce before theorizing;
measure stable scenarios; retain useful instrumentation; and keep manual
playtesting alongside automated verification.

## Networking, later

| Role and source | Lantern use | Boundary |
| --- | --- | --- |
| **Future reference:** Glenn Fiedler, [Networked Physics](https://gafferongames.com/categories/networked-physics/) | Lockstep, snapshot interpolation, state synchronization, bandwidth, and latency tradeoffs when cooperation becomes active scope. | Cross-platform floating-point determinism is difficult; do not preemptively retrofit fixed point or rollback. |
| **Future reference:** Valve, [Source Multiplayer Networking](https://developer.valvesoftware.com/wiki/Source_Multiplayer_Networking) | Comparative vocabulary for ticks, snapshots, interpolation, prediction, and latency. | Source's competitive FPS requirements are not automatically Lantern's requirements. |

## Research workflow

1. State one repository-aware question.
2. Inspect the relevant Lantern source, tests, probes, maps, contracts, and Git
   history first.
3. Retrieve only the relevant entries from this shelf, then prefer their
   primary source or official documentation.
4. Separate source claims, repository evidence, and inference.
5. Compare viable options against Lantern's actual constraints and measured
   behavior.
6. Record a durable research note only when the result changes a decision or is
   likely to be reused.

A durable note should capture the question, inspected repository evidence,
sources, Lantern constraints, options, current decision or hypothesis, a test
that could falsify it, and the condition that should trigger reconsideration.
Milestone plans remain self-contained and cite only the subset that materially
supports their decisions.
