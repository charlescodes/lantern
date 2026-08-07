# Lantern Long-Term Improvement Ledger

| Field | Value |
| --- | --- |
| Status | Working draft |
| Authority | Non-authoritative soft specification |
| Last reviewed | 2026-08-06 |
| Scheduling | Trigger-driven; no release assignment |
| Related current documents | [Platform contract](../platform.md), [architecture guide](../architecture-guide.md), [candidate roadmap](./candidate-roadmap.md) |

This ledger preserves architectural improvements that are credible and important but should not interrupt current feature experiments. An entry is neither a defect report nor scheduled work. It records the present compromise, the desired boundary, the event that should promote the work, and the evidence required to call it complete.

## Improvement index

| ID | Improvement | State | Promotion trigger |
| --- | --- | --- | --- |
| LT-001 | [Client-owned presentation effects](#lt-001-client-owned-presentation-effects) | Candidate | Before a strict authoritative server or particle state becomes a measured simulation/snapshot bottleneck |
| LT-002 | [Parkable developer windows](#lt-002-parkable-developer-windows) | Working draft | When the next stateful developer panel is added or substantially revised, with AI View as the likely first conversion |

## LT-001: Client-owned presentation effects

### Summary

Keep authoritative spell, projectile, collision, damage, impulse, and environmental outcomes in the simulation. Replace authoritative-side visual-particle lifecycles with compact effect events that each client expands locally into particles, lights, sound, decals, trails, bloom, and camera response.

The deterministic seed remains useful as a compact visual recipe. Individual spark positions, velocities, bounces, ages, and light-carrier choices must not become multiplayer authority or network state.

### Current state

Lantern currently uses one in-process simulation and no network replication:

- Fireball requests 224 particles per impact and the bounded particle pool holds at most 4,096 entries.
- `ParticlePool` stores position, velocity, age, lifetime, size, bounce diagnostics, spell/revision identity, effect identity, and deterministic sample seeds in typed-array columns.
- `Simulation` generates, advances, collides, and removes those particles at fixed-tick boundaries even though no particle can affect health, collision responses, AI knowledge, navigation, commands, or other gameplay truth.
- Every local snapshot expands live particles into presentation-facing objects. This snapshot is currently an in-process read model, not a network packet.
- Command recordings store the initial configuration, spell baseline, seed, and commands rather than serializing every particle. Replay regenerates the same visual particles.
- The default Three.js presentation owns 16 resident point lights. One admitted Fireball effect uses an eight-slot group with at most seven spark carriers; there is not one point light per particle.

This placement was reasonable for a browser-first prototype. It enabled exact particle fixtures, renderer parity, deterministic Spell Lab comparisons, profile-compatible replay, bounded collision/lifecycle experiments, and useful diagnostics. It becomes the wrong ownership boundary only when a separate authoritative host/server must spend time and bandwidth on gameplay truth.

### Target boundary

```text
AUTHORITATIVE SIMULATION / SERVER

cast command
  -> spell definition and captured revision
  -> authoritative projectile or immediate spell action
  -> collision, damage, impulse, and world reactions
  -> bounded EffectEvent
       effect ID
       spell code + definition revision
       event kind + authoritative tick
       position + relevant direction/normal
       cosmetic profile ID
       optional visual seed

                    snapshot / network event
                              |
                              v

CLIENT EFFECT SYSTEM

EffectEvent
  -> local quality and cosmetic policy
  -> local particles and decorative collision
  -> local lights, sound, decals, trails, bloom, and camera response
  -> Canvas2D or Three.js presentation
```

The authoritative event communicates that something happened. It does not prescribe every decorative sample used to depict it.

### Authority matrix

| Authoritative or replicated | Client-owned and disposable |
| --- | --- |
| successful cast and caster identity | particle count and allocation |
| spell code and captured mechanics revision | individual particle position and velocity |
| projectile position and gameplay collision | decorative ground/wall bounce state |
| impact point, direction/normal, and tick | spark lifetime, size, and ordinal |
| damage, physical impulse, and environmental reactions | light-carrier selection and light pool leases |
| gameplay-relevant cast/impact cue | bloom, trail, decal, camera shake, and sound variant |
| validated cosmetic profile/content ID when shared | local quality reductions and presentation fallback |

Some cast and impact cues should remain reliable because players use them to understand combat. Their decorative expansion remains local.

### Seed policy

Separate two conceptual domains:

```text
gameplay seed
    authoritative only when randomness changes an outcome

visual seed
    presentation-only; may be carried by EffectEvent or derived locally from
    stable effect ID + cosmetic profile ID
```

A visual seed costs four bytes and can preserve reproducible captures, bug reports, and replay presentation without replicating particle state. Ordinal-based sampling also permits different quality tiers: a low-quality client may draw the first 32 samples while a high-quality client draws 224, with the shared samples remaining stable.

Exact cross-client particle sprays are not required. Different frame rates, backends, or quality levels may produce visibly different decorative lifecycles as long as gameplay cues remain legible and no result feeds back into simulation authority.

### Candidate migration

1. Define a bounded, ordered, deduplicatable client-effect stream using stable effect IDs and explicit overflow diagnostics. Reuse existing cast/impact facts rather than introduce an unbounded global event bus.
2. Create a client-side effect system that consumes those events and owns emission, particle motion, decorative map collision, local quality budgets, and effect teardown.
3. Make Canvas2D, Three.js, and the light budget consume the same local effect model. Keep presentation resources resident and bounded.
4. Remove live particle objects from new authoritative snapshots and server ticks. Active gameplay projectiles and recent effect events remain observable.
5. Preserve existing recording schemas through their current deterministic particle path or a compatibility adapter. A new recording boundary may derive visual effects from events without requiring exact historical particle state.
6. Add a headless-authority configuration that runs combat, AI, navigation, projectiles, damage, and effects events without constructing or advancing cosmetic particles, lights, audio, DOM, Canvas, or Three.js state.

This is a migration outline, not approval to implement or assign a schema number. The exact event shape and compatibility strategy require a decision-complete plan against the live tree when the promotion trigger is reached.

### Failure modes to prevent

- Do not replicate per-particle snapshots merely because the current local snapshot contains them.
- Do not make a server wait for GPU or client-effect results.
- Do not let visual seeds, quality tiers, dropped particles, or decorative collision affect damage, visibility, AI, sound detection, or environmental reactions.
- Do not require late joiners to reconstruct expired sparks. Replicate active gameplay projectiles and only the bounded recent cues required for readability.
- Do not remove the deterministic reference path until Canvas2D/Three.js behavior, replay compatibility, and effect-event parity are characterized.
- Do not equate client-owned with unbounded. Particle, light, audio, decal, and event budgets still require explicit capacities and fallback behavior.

### Acceptance evidence

Promoted work is complete only when:

- A headless simulation produces identical gameplay outcomes and command/replay traces without allocating or ticking visual particles.
- Network/snapshot inspection shows one bounded effect event rather than per-particle state for a Fireball impact.
- Changing a client's particle count, quality tier, renderer, or visual seed cannot change authoritative state.
- Canvas2D and Three.js consume the same effect events while remaining free to render different quality levels.
- Old recording schemas retain their promised behavior; the new boundary has deterministic fixtures for event identity, ordering, overflow, and deduplication.
- Particle and presentation performance is measured separately from server simulation cost.
- Human browser checks confirm that cast and impact cues remain readable when events are dropped, quality is reduced, or several effects compete for local budgets.

### Promotion trigger

Promote LT-001 into an implementation plan before Lantern introduces a strict authoritative multiplayer/server runtime. It may be promoted earlier only if profiling shows that cosmetic particle simulation or snapshot projection materially obstructs nearer feature work.

Until then, preserve the present particle implementation as a bounded deterministic reference and keep its gameplay influence at exactly zero.

## LT-002: Parkable developer windows

### Summary

Use the 0.8.1 Spell Lab interaction as the preferred pattern for qualifying
developer windows: a toolbar launcher opens a panel over the arena, the launcher
gets out of the way while that panel is open, and Collapse or Close parks the
panel back into the toolbox without discarding its local state.

This is a small consistency rule, not approval to build a general window
manager. Apply it when a real second consumer proves what should be shared.

### Current state

- Spell Lab is the reference implementation. It starts parked, opens as a
  desktop overlay or narrow-screen drawer, and collapses completely back to its
  launcher while retaining its draft, revision, seed lock, and last target.
- AI View opens and closes a stateful diagnostic panel, but its launcher and
  lifecycle do not yet follow the complete Spell Lab parking pattern.
- Render Lab is a modal dialog whose launcher remains in the toolbar.
- Frame instrumentation, bounded pools, Inspector, debug layers, events, and
  artifact controls remain one persistent developer sidebar.
- The outer semicolon gate already hides all developer surfaces together and
  remains separate from each panel's parked/open state.

### Qualifying tools

The parkable-window pattern applies to stateful tools with content that benefits
from remaining open while the arena stays interactive. Current candidates are
AI View, Render Lab, and a future window containing the existing instrumentation
sections.

Immediate commands remain direct toolbar controls. Pause or Resume, Step,
Reset, Enter Edit or Return to Play, and Focus do not become empty windows or
participate in panel lifecycle state.

### Target behavior

- A parked tool has one clearly labeled launcher in the developer toolbox.
- Opening the tool shows its established overlay, drawer, or dialog and hides
  or marks its launcher so duplicate instances cannot be created.
- Collapse or Close removes the panel from the arena and restores its launcher.
- Parking preserves meaningful session-local state such as AI selection/view
  mode, Render Lab settings/report, instrumentation choices, and scroll position
  where practical. Browser reload persistence is not implied.
- The outer semicolon gate can hide and restore all open developer surfaces
  without injecting a simulation command, changing replay data, or discarding
  panel state.
- Desktop and narrow-screen behavior remain explicit per panel until repeated
  use proves a shared responsive shell.

### Deliberately deferred

Do not add dragging, arbitrary resizing, docking, snapping, z-order management,
saved layouts, cross-window collision avoidance, or a desktop-style window
registry as part of the first conversions. Whether several panels may overlap,
auto-arrange, or become mutually exclusive remains a future product decision.

Do not force unlike controls through one abstraction. Extract a small shared
park/open lifecycle only after AI View or another real panel reproduces the
Spell Lab behavior and exposes the common seam.

### Acceptance evidence

Promoted work is complete for each converted panel only when:

- launcher, open, park, and reopen behavior is keyboard- and pointer-usable;
- reopening retains the panel's meaningful session state;
- the panel cannot create duplicate instances or escape the semicolon gate;
- closing the outer toolbox cannot leave hidden edit or modal focus traps;
- Canvas2D and Three.js arena interaction remain available where that panel's
  existing contract allows it;
- automated DOM/state coverage and a real-browser desktop/narrow-screen check
  confirm the lifecycle without changing simulation, schema, or replay truth.

### Promotion trigger

Promote LT-002 into a decision-complete implementation plan when AI View is next
substantially revised, when another stateful developer panel is introduced, or
when repeated one-off launcher/panel behavior starts crowding the toolbox. Use
that concrete panel as the second consumer; do not build generalized window
management in anticipation of unspecified tools.

## Entry template

Future entries should identify:

- the current compromise and why it was reasonable;
- the desired boundary, not merely a preferred technology;
- the measurable or product trigger for acting;
- compatibility and failure constraints;
- evidence required for promotion and completion.
