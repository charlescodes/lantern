# Archived post-M1B.4 ChatGPT handoff

> **Archive status:** historical source context from the 2026-08-30 ChatGPT handoff.
> It has no current implementation authority. When it conflicts with current source,
> tests, format contracts, or the [current roadmap](../../roadmap.md), those current
> sources take precedence.

# Lantern Engine — Codex Handoff After M1B.4

> **Handoff date:** 2026-08-30
> **Project:** Lantern
> **Current checkpoint:** M1B.4 implemented and manually exercised
> **Immediate mode:** Repository audit and planning only; do not begin the next feature milestone yet

## 1. Purpose of this handoff

This document closes the long-running ChatGPT design session that helped shape Lantern through M1B.4 and transfers primary planning responsibility to Codex in the actual Git repository.

Codex has an advantage that the design conversation did not: it can inspect the live source, Git history, tests, authored maps, schemas, debug interfaces, and the soft-spec documents accumulated throughout development. Therefore:

- Treat the repository and verified runtime behavior as the source of truth.
- Treat this document as product intent, historical context, constraints, and a starting hypothesis.
- Do not assume every older design document remains current.
- When source, tests, Git history, and documents disagree, identify the disagreement explicitly and recommend which artifact should become canonical.
- Ask the user before resolving meaningful product-design conflicts.

The goal is not to preserve every past idea verbatim. The goal is to preserve the project's identity while consolidating its current truth and making the next stage easier to reason about.

## 2. Project identity

Lantern is a modern JavaScript game engine and evolving game prototype inspired by Westwood Studios' *Nox* (2000). It is not intended to be a one-to-one remake. The aim is to recover the physical immediacy, readable systems, environmental interaction, and distinctive perception mechanics that made *Nox* charming, while allowing Lantern to become its own game.

The intended experience is a fast real-time action/adventure viewed from an elevated isometric-style camera. Internally, ordinary navigation and collision remain primarily two-dimensional on the X/Z ground plane. Gameplay Y provides limited vertical behavior for falling, elevators, jumping, floor layers, and effects without turning the engine into a general-purpose 3D rigid-body simulator.

Long-term product discussions have included a two-player cooperative action-adventure with powerful enemies and bosses. That remains directional context, not an instruction to introduce networking or commit to final combat architecture during the current foundation phase.

## 3. Current milestone status

The user reports that **M1B.4 is implemented** and is happy with the result. Codex must verify the exact implementation and documentation from the repository rather than reconstructing it from milestone names alone.

The conversational milestone progression was approximately:

| Milestone | Intended capability |
| --- | --- |
| M0 | Fixed-step debug arena, player movement, wall collision, fireball, particle burst, deterministic probes and replay-oriented debugging |
| M1A | Authored floor layers, reference-layer editing, dynamic props such as tables and torches, runtime/authored-state separation, and layer-aware presentation foundations |
| M1B.1 | Gameplay Y, vertical bodies, gravity, supports, two-stop elevators, aperture rejection, and per-body layer transitions |
| M1B.2 | Single-cell holes, footprint-fit rules, rim attraction, multi-floor falling, intermediate landings, and falling air control |
| M1B.3 | Committed Nox-style jumping, clearing holes and low clutter, pressure plates, and landing integration |
| M1B.4 | Integrated vertical traversal, elevator completion, breakaway/crumbling pits or floors, mixed-system hardening, editor integration, and related test-arena work |

This table describes intent, not verified repository truth. Determine whether the repository uses different names, subdivisions, or completion criteria.

## 4. Confirmed M1B.4 product behavior

The following points come directly from the user's final manual assessment and should be preserved unless the user later changes them:

### Elevators

- Elevators now look and operate well in the integrated experience.
- Lantern elevators should remain similar in spirit to *Nox* elevators.
- They are **timer-driven shuttles**. They are not primarily activated by stepping onto the platform.
- Walking onto an elevator should not itself be interpreted as a call or toggle command.
- A rider boards a platform that is already cycling on its schedule, rides while retaining ordinary X/Z freedom, and exits at the appropriate floor.
- Earlier discussions about occupancy-triggered toggling, leave-and-reboard activation, or rider-owned cycling are superseded by this timer-driven decision unless the repository intentionally retains another mode for debug or future mechanisms.
- Elevators remain authoritative kinematic supports: payload mass does not slow, stall, or reverse them.
- Riders are not centered, frozen, parent-locked, or stored in scripted passenger slots.

### Pits and breakaway floors

- Pits or floor sections can open, crumble, and cause the player to fall to a lower level.
- The user has manually experienced a breakaway fall to the second level and considers the result successful.
- These mechanisms should reuse the established support, aperture, gravity, falling, and landing systems rather than owning a separate scripted teleport path.

### Editor

- The editor currently looks good to the user after M1B.4.
- Preserve the distinction between the editor's selected/active authored layer and the runtime layer occupied by the player or another body.
- Authored spawn poses and mechanism settings must remain separate from disposable runtime movement.

## 5. Governing architecture and design constraints

Codex should validate how each principle is currently expressed in code before changing it.

### Simulation model

- World ground plane: X/Z.
- Limited gameplay vertical coordinate: Y.
- Meters are simulation units; pixels are presentation.
- Fixed-step simulation order is part of the behavioral contract.
- Rendering observes simulation state and does not own gameplay truth.
- Floor and elevator supports are explicit; ordinary clutter is not an alternate walkable floor.
- Layer changes belong to individual bodies, not one global simulation-floor switch.
- All authored floors should remain logically available; rendering/editor filtering must not pause or replace the simulation globally.

### Data and performance

- Favor bounded storage, typed arrays, dense pools, stable IDs, and allocation-conscious hot loops where the repository already follows those conventions.
- Preserve existing Structure-of-Arrays and pool patterns instead of creating object-heavy parallel systems.
- Do not perform an abstract ECS rewrite merely because an older architecture essay advocates one.
- The original executable specification deliberately chose `Float32Array` kinematics and deferred fixed-point conversion until networking/replay divergence measurements justify it. An older architecture blueprint discusses fixed-point as an aspiration. Treat this as a known documentation conflict and use the implemented engine plus current tests as authority.
- Do not promise cross-platform lockstep determinism without evidence.

### Physical character

- Lantern should feel like a charming physics game rather than a sterile grid simulation.
- Players, enemies, rocks, chairs, tables, torches, doors, elevators, holes, explosions, and debris should eventually interact through a small number of coherent systems.
- The implementation may be physically simplified when that produces readable, enjoyable, deterministic behavior.
- Avoid heavyweight general 3D stacking, tipping, crushing, and rigid-body simulation unless future evidence proves it necessary.

### Apertures, holes, and clutter

- Holes are single-cell apertures and do not merge automatically into arbitrary multi-cell openings.
- Adjacent holes retain a narrow supporting seam.
- A complete body's footprint must fit through an aperture; center-over-hole alone is insufficient.
- Positive clearance means an object nominally equal to the aperture size should not barely pass because of numerical equality.
- Oversized tables or boulders may bridge an opening without tipping.
- Fitting grounded bodies may receive a gentle, counterable pull toward a hole.
- Falling or jumping bodies may pass over explicitly low/airborne-passable clutter, but full-height blockers remain meaningful.

## 6. Probe-first engineering philosophy

The user wants Lantern's debugging approach made more formal and more consistently “Carmackian” in spirit: expose the machine's truth, make behavior reproducible, measure before guessing, and make failures inspectable without depending solely on visual playtesting.

Do not attribute a specific quotation to John Carmack. Translate the preference into concrete repository practices.

The original M0 contract established a strong rule:

> Every hidden state must be exposed through UI, probes, counters, snapshots, events, or tests.

Codex should audit whether this principle survived the later milestones and propose a formal **Probe and Observability Contract**. That contract should consider:

1. **Stable agent-facing probe surface**
   - A documented, bounded, JSON-safe API for pause, resume, fixed-step advance, reset, snapshots, metrics, queries, command injection, and debug flags.
   - Mutations should enter through commands at tick boundaries rather than arbitrary live-state writes.
   - Stable IDs, not transient dense-pool indices, identify entities.

2. **System-specific state inspection**
   - Vertical mode, support kind and ID, world Y, vertical velocity, runtime layer, connector/transit state, hole/aperture fit, jump state, pressure-plate occupancy, elevator phase and schedule, breakaway-floor state, AI intent, perception inputs, and attached effects where applicable.

3. **Bounded diagnostic events and counters**
   - Capture, takeoff, landing, layer handoff, support loss, aperture rejection, elevator arrival/departure, trap activation, failed depenetration, pool overflow, dropped event, replay mismatch, and rescue/recovery behavior.
   - Diagnostics must not introduce unbounded logs or hot-loop allocation.

4. **Reproduction tools**
   - Fixed seed, command logs, snapshot export, pause/single-step, deterministic reset, and compact scenario fixtures.
   - A failure report should contain enough state to reproduce or narrow the issue.

5. **Latency and performance visibility**
   - Continue exposing simulation/render percentiles, pool pressure, dropped counts, and expensive-system timing where useful.
   - Diagnose actual bottlenecks before changing data representation or introducing complexity.

6. **Human and agent usability**
   - Debug overlays must remain readable and toggleable.
   - The agent-facing probe should allow Codex or browser automation to verify behavior without replacing manual feel testing.
   - Manual playtesting remains essential for movement feel, hole attraction, jump commitment, elevator timing, and environmental readability.

The formalization effort should prefer one coherent probe contract over several milestone-specific debug APIs.

## 7. Previously observed risks to verify, not blindly assume

These problems were observed during earlier M1B iterations. They may already be fixed. Codex should find evidence before reopening them:

- footsteps or explosion sounds leaking unintentionally between floors;
- the editor active floor snapping back to the runtime player's floor;
- unstable or overly strong hole rim attraction;
- support, gravity, landing, or layer-transition edge cases;
- inadequate authored maps for exercising elevators and complete vertical traversal;
- debug/probe latency or insufficient visibility during complex interactions.

Classify each as fixed, reproducible, unverified, intentionally deferred, or obsolete.

## 8. Long-term gameplay compass

The following ideas influenced Lantern and should be retained as a backlog/vision compass rather than treated as immediate requirements:

- Hinged doors that swing and physically obstruct motion.
- Door apertures and authored room layouts that naturally keep oversized boulders away from elevator shafts.
- Explosion strength coupling to physical impulses.
- Small triangle debris or sparks with bounded pooled storage, gravity, rotation, and force inherited from impacts.
- Rocks, furniture, torches, enemies, players, and eventually corpses responding coherently to pushing and explosions.
- Corpse motion, sleep, bounded lifetime, and cleanup later—not as part of the current vertical foundation.
- Sound events that enemies can hear, including footsteps, running, and explosions.
- Light and visibility affecting detection, including moving lights and intelligent creatures noticing them.
- True Sight and occlusion as important engine identity.
- AI states such as idle, move/patrol, investigate, hunt, attack, and flee.
- Waypoints or a compiled navigation representation.
- Different creatures having different perception/tracking capabilities; dogs were noted as a useful inspiration for strong tracking behavior.
- Enemy generators/obelisks and eventual active/dormant/despawn policies.
- Authored persistent objects versus runtime transient entities.
- A capstone progression toward sophisticated bosses, with *Nox* enemies such as golems, necromancers, and Hecuba serving only as behavioral inspiration.
- Eventual cooperative play, but networking architecture should wait until the single-machine simulation and measured determinism requirements are mature.

## 9. Provisional roadmap after M1B.4

This roadmap was discussed before Codex gained repository access. It is a hypothesis to evaluate, not a mandate.

### Immediate checkpoint — M1B stabilization and documentation

- Verify M1B.1–M1B.4 behavior against code, tests, Git history, and manual arenas.
- Record the final vertical/support/elevator/hole/jump/trap contracts.
- Consolidate milestone documents and archive superseded plans.
- Formalize the probe/observability contract.
- Identify regressions and technical debt without mixing them into new feature work.
- Establish a clean baseline before beginning M1C.

### Candidate M1C — Forces, doors, and physical interaction

- General gameplay impulse delivery.
- Explosion strength affecting players, enemies, and movable props.
- Hinged door behavior and doorway aperture rules.
- Bounded debris/triangle impact effects coupled to force.
- Consistent mass/pushing conventions.
- Sleeping/waking rules only where they demonstrably reduce simulation cost.

This was the preferred next direction because it strengthens Lantern's distinctive physical personality and supports later combat, perception, traps, and AI. Codex should compare it with repository maturity and recommend whether it remains the best next milestone.

### Candidate M1D — Perception

- Floor-aware sound-event propagation and attenuation.
- Occlusion through walls, doors, and vertical separation.
- Lighting/visibility gameplay queries.
- True Sight foundations.
- Agent/debug visualization of what an entity hears and sees.

### Candidate M1E — Navigation and enemy intelligence

- Waypoints or navigation graph.
- Investigate sound, pursue visible targets, remember last-known positions, and flee.
- Connector-aware cross-floor routes using elevators and other traversals.
- Creature-specific perception and tracking policies.

### Candidate M1F — Combat loop

- Health, damage, death, attacks, spell interactions, generators, pickups, and bounded cleanup.
- Avoid designing this milestone in detail until physical interaction, perception, and AI foundations are validated.

### Candidate M2 — Playable vertical slice

- A coherent authored level and short gameplay loop.
- Art, animation, audio, camera, and presentation improvements built on stable simulation contracts.
- Content-driven evaluation of whether earlier abstractions are sufficient.

Codex may recommend different names, boundaries, or ordering after the repository audit. Preserve the underlying capability dependencies and explain any proposed reordering.

## 10. Documentation consolidation objectives

The repository may contain implementation contracts, planning prompts, architecture essays, milestone notes, completed plans, stale proposals, and duplicated rules. The next planning task should inventory and classify them rather than immediately rewriting everything.

For every relevant document, determine:

- purpose and intended audience;
- whether it is current, partially current, historical, superseded, conflicting, or redundant;
- which source files/tests/Git commits support or contradict it;
- whether it should remain canonical, be condensed, link elsewhere, or move to an archive;
- whether any durable rule belongs in `AGENTS.md` rather than a milestone document;
- whether any repeated workflow belongs in a dedicated plan/checklist rather than `AGENTS.md`.

A possible target structure—adapt it to the repository rather than forcing it—might distinguish:

- project vision and gameplay identity;
- current architecture and invariants;
- current roadmap;
- milestone completion records;
- active implementation plans;
- architecture decisions or decision records;
- probe/debugging contract;
- authoring/editor documentation;
- test and manual-verification procedures;
- historical/superseded material.

Keep `AGENTS.md` short and operational: repository layout, commands, engineering constraints, verification expectations, and references to deeper documents. Do not turn it into the entire game-design archive.

## 11. First Codex assignment — Plan mode only

Use this document as the initial context for a repository-aware transition audit.

### Goal

Establish the verified post-M1B.4 project baseline, design a documentation consolidation, formalize the probe-first engineering contract, and recommend the next roadmap milestone.

### Required investigation

1. Read all applicable `AGENTS.md` and repository guidance.
2. Inspect Git status first and preserve unrelated or uncommitted user changes.
3. Inspect Git history relevant to M0 through M1B.4, including milestone branches/commits/tags if present.
4. Inventory project documentation and identify references among documents.
5. Locate the live implementations and tests for:
   - fixed-step simulation and command/replay flow;
   - entity IDs, pools, and allocation-sensitive systems;
   - layers, vertical bodies, supports, elevators, holes, falling, jumping, pressure plates, and breakaway floors;
   - editor/runtime separation and save/load/schema migration;
   - audio, lighting, AI, rendering, debug overlays, probes, metrics, and test arenas.
6. Run safe existing read-only or standard verification commands as needed to determine current behavior. Do not change code merely to complete the audit.
7. Compare documents against source, tests, runtime fixtures, and Git evidence.
8. Identify undocumented invariants, obsolete promises, duplication, and contradictions.
9. Verify the timer-driven elevator decision and ensure older occupancy-triggered proposals are marked superseded.
10. Evaluate whether the provisional M1C physical-interaction milestone remains the correct next step.

### Questions and planning behavior

- Work in Plan mode and do not edit files yet.
- Summarize repository findings with concrete file and symbol references.
- Separate verified facts from inferences and recommendations.
- Challenge assumptions in this handoff when repository evidence warrants it.
- Ask the user a short, prioritized set of questions for decisions that materially affect document authority, milestone closure, probe scope, or roadmap ordering.
- Wait for answers before producing the final plan.

### Required final plan

After the user answers, produce a staged plan containing:

1. **Post-M1B.4 state report**
   - Verified implemented behavior.
   - Tests and arenas that prove it.
   - Known gaps, regressions, and deferred behaviors.
   - Whether M1B can be formally closed.

2. **Documentation inventory and disposition matrix**
   - Document path.
   - Current purpose.
   - Authority/status.
   - Conflicts or duplication.
   - Proposed keep, condense, supersede, link, rename, or archive action.

3. **Proposed documentation architecture**
   - Exact target paths and responsibilities.
   - Canonical source for product intent, current architecture, roadmap, probes, milestones, and verification.
   - A restrained `AGENTS.md` update strategy if needed.

4. **Probe and observability plan**
   - Existing probe surface and gaps.
   - Stable contract proposal.
   - Required snapshots, queries, metrics, bounded events, overlays, replay hooks, and scenario fixtures.
   - Performance/latency measurement strategy.
   - What belongs in code, tests, documentation, or agent guidance.

5. **Roadmap recommendation**
   - Recommended next milestone and why.
   - Dependency ordering.
   - Proposed slices and acceptance gates.
   - Ideas explicitly deferred.
   - Whether the provisional M1C–M2 naming should be retained or revised.

6. **Execution sequence**
   - Small reviewable changes.
   - Validation after each slice.
   - Rollback/containment points.
   - Clear distinction between documentation-only work, probe hardening, bug fixes, and new feature implementation.

### Completion condition for the transition task

The transition is complete when the user can point future Codex sessions to a small set of canonical repository documents and Codex can answer these questions without reconstructing the project from chat history:

- What is Lantern trying to be?
- What behavior is implemented through M1B.4?
- What architectural invariants must not be broken?
- How can hidden state be inspected and failures reproduced?
- Which documents are canonical and which are historical?
- What is the next milestone, why is it next, and what is explicitly deferred?

Do not implement new features, reorganize documents, commit, or publish during the initial Plan-mode audit. First inspect, ask questions, and present the plan for approval.

## 12. Suggested execution after plan approval

Once the audit and consolidation plan are approved:

1. Perform documentation cleanup as its own reviewable change.
2. Perform probe-contract formalization/hardening as a separate change if code modifications are required.
3. Run the complete M1B verification and record the milestone closure.
4. Begin the approved next milestone only after the new canonical roadmap is accepted.
5. Implement future milestones in small slices, testing each manually and automatically before proceeding.

For model usage, the established working preference is:

- Sol Medium for repository-aware planning and architecture reconciliation.
- Terra Medium for bounded implementation slices.
- Increase reasoning only when a specific task demonstrates the need; do not use maximum reasoning as routine insurance.

---

This handoff intentionally ends the chat-first planning phase. Codex should now derive technical truth from the repository while preserving the product character and engineering principles recorded here.
