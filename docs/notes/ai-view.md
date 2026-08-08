# AI View Debug Overlay

> **Authority:** read-only presentation and developer diagnostics
>
> **Compatibility:** Off/Selected/All behavior and stable selection remain unchanged; schema-v11 adds read-only movement-sound diagnostics without making sound or dead-body rows AI View mobs or adding a command or mutation surface

## Purpose

AI View makes perception, investigation, hunting, and tactical state inspectable while the
simulation continues to run. It is a view toggle, never an AI enable/disable
switch. Opening the panel, changing its mode, or selecting a mob does not inject
a command, pause an actor, change a decision, or enter recording/replay state.

The floating panel retains three display modes:

- **Off** clears the diagnostic overlay while every mob AI remains active.
- **Selected mob** draws one stable `kind:id` identity chosen from the selector.
- **All mobs** draws every living AI-bearing actor currently exposed by the
  snapshot adapter. This mode is deliberately cluttered and has no performance
  guarantee.

Clicking an enemy in the arena continues to pin it in the ordinary inspector
and also makes it the selected AI View mob. Pool compaction or list reordering
does not move the selection to another actor because selection uses stable
identity rather than pool index.

## Displayed truth

The renderer-neutral view model consumes the same copied schema-v11 snapshot as
Canvas2D and Three.js. It labels **player sight** separately from **mob vision**:
player sight is the presentation-only TrueSight result, while mob vision is the
authoritative cone/range/grid-occlusion sample. Neither value is inferred from
the other.

For each displayed mob the panel includes:

- perception state and knowledge source, current visibility, sample tick,
  five-lane identity, and exposure progress toward the 15-tick threshold;
- normalized facing, candidate and confirmed target identity, guard point,
  personal last-seen data, investigation source/priority/anchor/timestamps,
  effect and projectile IDs, observed projectile pose/velocity, inferred
  origin, hunt phase, search goal, and active timers;
- behavior and retreat state, health, position and velocity, desired velocity,
  movement goal, strafe schedule, intercept aim, line of sight, tracked visible
  projectile threat, dodge timers, and cast sequence/cooldown;
- destination-cache slot, key, cost, version, and stale/building flags.

World-space marks include the `120°`/`12m` perception cone, `1.5m` close-awareness
circle, selected-wizard `8m` footstep and `16m` Fireball hearing radii, recent
sound origins, facing and exposure, the `6-9m`
engagement band, target, last-seen, sound-impact or damage marker, projectile
observation point, reverse-trajectory ray, inferred-origin marker, search point,
guard point, movement goal, desired velocity, predicted aim, line of sight,
tracked threat, dodge direction, and navigation state. `INVESTIGATING` has a
distinct state color. The cone, close-awareness circle, and hearing radius are
never drawn when AI View is Off.
The small hood/nose direction marker on the ordinary hostile silhouette is not
debug geometry and remains available in normal rendering.

A shared transparent Canvas2D overlay is placed above either primary renderer,
so the debug geometry has one projection path and adds no Three.js meshes,
materials, lights, or shader topology. The snapshot adapter currently receives
enemy wizards. It also accepts generic AI mob, friendly, and critter collections
with the same stable `kind:id` contract, without asserting that those deferred
actor types have perception behavior.

## Diagnostics and event history

`window.__lantern.enemyDiagnostics(id?)` returns the same copied per-enemy
perception, investigation, hunt, tactical, and destination-field data for every enemy or one
stable ID. The global diagnostics replace the old single player-rooted field
status with the bounded destination-cache slots, current builder, expansion
budget, reference counts, map revision, and completed/stale versions.

The simulation retains a bounded 128-entry perception-event ring. Diagnostics
expose its latest 32 detection, loss, search, return, damage-alert,
reacquisition, awareness-clear, projectile-observation, footstep-hearing, explosion-hearing,
redirect, deduplication, and priority-rejection events plus retained, capacity,
and dropped counts. Bounded aggregate counters report projectile observations,
heard footsteps and explosions, accepted redirects, deduplication, and priority rejection.
Reading diagnostics cannot affect event retention, decisions, or replay.

A separate 128-entry sound-event ring exposes the latest 32 stable sound IDs,
kinds, reasons, sources, origins, radii, and optional effect/projectile IDs. AI
View draws at most eight origins from the last 30 ticks. The ring is diagnostic
only; authoritative delivery uses the one-tick typed queue.

## TrueSight and interaction boundary

AI View diagnostics intentionally remain visible through TrueSight darkness and
solid-wall concealment. This is a developer inspection exception, visibly
labeled in the panel; it does not make the owning actor visible to ordinary
presentation, pin interaction, the simulation, or another AI. The ordinary
facing marker shares the hostile silhouette's TrueSight concealment. The debug
overlay is pointer-transparent and sits below normal arena controls, editor
tools, defeat presentation, Spell Lab, and the AI View panel.

The browser probe exposes read-only UI state through
`window.__lantern.aiView()`. Tests and local debugging may use
`window.__lantern.setAiView(mode, id?, kind?)`, where `mode` is `"off"`,
`"selected"`, or `"all"`. This changes only presentation state and returns
`false` for an invalid mode or unavailable requested identity. There is no
gameplay command or simulation mutation API for the browser stress harness.

## Verification boundary

Automated coverage verifies mode filtering, stable identity through list/pool
reordering, interpolation, perception geometry, facing-marker parity, TrueSight
concealment, threat lookup, future collection support, snapshot immutability,
diagnostic text, and UI wording that cannot be mistaken for an AI behavior
toggle. The browser-only fixture at
`test/browser/perception_stress.html?renderer=2d` runs the production simulation
and presentation adapters with 12 engaged casters and 38 occluded searching or
guarding mobs.

Human acceptance still covers label readability and overlap in Canvas2D,
automatic Three.js, forced WebGL 2, and LAN-phone layouts. AI View Off is the
release performance case; Selected mode is exercised separately. All mode
remains an intentionally dense diagnostic.
