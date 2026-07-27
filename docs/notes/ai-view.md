# AI View Debug Overlay

> **Authority:** read-only presentation and developer diagnostics
>
> **Compatibility:** simulation behavior, AI decisions, command recordings, replay, snapshot schema v7, scenario schema v3, renderer topology, and TrueSight authority are unchanged

## Purpose

AI View makes tactical state inspectable while the simulation continues to run.
It is deliberately a **view toggle**, never an AI enable/disable switch. Opening
the panel, changing its mode, or selecting a mob does not inject a command,
pause an actor, change a decision, or enter recording/replay state.

The floating panel offers three display modes:

- **Off** clears the overlay while every mob AI remains active.
- **Selected mob** draws one stable `kind:id` identity chosen from the selector.
- **All mobs** draws every living AI-bearing actor currently exposed by the
  snapshot adapter. This mode is intentionally allowed to become visually busy.

Clicking an enemy in the arena continues to pin it in the ordinary inspector
and also makes it the selected AI View mob. Pool compaction or list reordering
does not move the selection to another actor because selection uses stable
identity rather than pool index.

## Displayed truth

The renderer-neutral view model consumes the same copied schema-v7 snapshot as
Canvas2D and Three.js. For each displayed mob it prints identity, AI profile,
visibility, behavior and retreat state, health, position and velocity, desired
velocity, movement goal, navigation-field cost/version, strafe schedule,
predicted aim and lead, line of sight, tracked projectile threat, dodge timers,
cast sequence/cooldown, and global navigation rebuild status.

World-space marks include the 6m withdrawal and 9m approach boundaries,
movement-goal and desired-velocity vectors, predicted aim, player line of sight,
tracked threat, and dodge direction. A shared transparent Canvas2D overlay is
placed above either primary renderer, so the debug geometry has one projection
path and adds no Three.js meshes, materials, lights, or shader topology.

The snapshot adapter currently receives enemy wizards. It also accepts generic
AI mob, friendly, and critter collections with the same stable `kind:id`
contract, allowing later actor types to participate without turning this panel
into an enemy-only system.

## TrueSight and interaction boundary

AI View diagnostics intentionally remain visible through TrueSight darkness and
solid-wall concealment. This is a developer inspection exception, visibly
labeled in the panel; it does not make the owning actor visible to ordinary
presentation, pin interaction, the simulation, or another AI. The diagnostic
overlay is pointer-transparent and sits below normal arena controls, editor
tools, defeat presentation, Spell Lab, and the AI View panel.

The browser probe exposes read-only UI state through
`window.__lantern.aiView()`. Tests and local debugging may use
`window.__lantern.setAiView(mode, id?, kind?)`, where `mode` is `"off"`,
`"selected"`, or `"all"`. This changes only the presentation view and returns
`false` for an invalid mode or unavailable requested identity.

## Verification boundary

Automated coverage verifies mode filtering, stable identity through list/pool
reordering, interpolation, threat lookup, future friendly/critter collection
support, snapshot immutability, diagnostic text, and UI wording that cannot be
mistaken for an AI behavior toggle. Human acceptance still covers label
readability and overlap in Canvas2D, automatic 3D, forced WebGL 2, narrow-screen
layout, selection by arena pin, and intentional visibility through TrueSight.
