# Doors and dynamic occlusion

| Field | Value |
| --- | --- |
| Status | Candidate |
| Authority | Non-authoritative |
| Last reviewed | 2026-09-18 |
| Related current contracts | [TrueSight](../notes/0.4.0-true-sight.md), [platform](../platform.md), [map authoring](../notes/map-authoring-foundation.md), [roadmap](../roadmap.md) |

## Why this exists

Lantern wants hinged doors, round pillars, moving stone blocks, and other
world-scale objects whose visible silhouette matters. The current TrueSight
input cannot represent those silhouettes faithfully: it reduces every authored
`blocksSight` footprint to blocked map cells. A round pillar therefore casts
the shadow of its complete cell, and a partly open door could not reveal a
narrow view while its leaf still concealed the space behind it.

The archived post-M1B.4 handoff called doors part of a provisional “Candidate
M1C.” That label was superseded when M1C became the now-complete authored
navigation milestone. The door idea was not rejected or implemented; this
document gives it a current home without changing the meaning of M1C or
scheduling another milestone.

This is a candidate for a focused design and measurement pass, not an
implementation contract. It deliberately does not choose final camera limits,
capacities, door physics, or occluder primitives.

## Current reality

- TrueSight is player-centered, map-bounded, presentation-only, and currently
  has no distance cutoff. Camera position and zoom do not affect its result.
- Rays traverse a binary grid and stop at the first occluding cell. The
  topology is rebuilt when that grid changes and a frame is bounded to 2,048
  rays.
- The logical and fading display masks target eight texels per meter, then
  scale down uniformly so neither dimension exceeds 256. The Three.js
  transport is permanently allocated at `256x256`.
- Mask resolution and occluder resolution are different concerns. More mask
  texels would make the edge of the existing visibility polygon smoother, but
  would not turn a whole-cell pillar into a circular obstacle.
- `object.pillar` is a static placeholder with a one-cell footprint and
  `blocksSight: true`; map compilation marks that complete cell in the
  occluder mask. There is no authored door or bounded runtime dynamic-occluder
  collection today.
- Existing TrueSight “doorway” tests cover static gaps in grid walls, not
  moving door leaves.

## Intent

World geometry should hide and reveal space in a way that agrees with its
visible footprint. A player should be able to crack a door and peek through the
opening, see around the sides of a column, and watch the shadow of a moving
block follow the block. The result should remain deterministic, bounded,
renderer-independent, and useful on the deliberately tight camera scale of the
game.

## Candidate stories

### Hinged door

A full-height door occupies an authored aperture and has an authoritative
hinge angle. When closed, the aperture is concealed. As the leaf opens, the
player sees a growing wedge through the opening while the leaf itself continues
to hide whatever lies behind it. Collision and visibility agree closely enough
that a visibly open passage does not remain mysteriously solid or opaque.

This story does not yet decide whether a door is pushed physically, opened by
an interaction command, driven by a mechanism, locked, broken, stalled by a
body, or capable of crushing one. Those are simulation and game-design
decisions, not consequences of TrueSight.

### Round pillar

A player near a round column can see around its sides. Its concealed region
starts at the visible cylindrical footprint rather than at the edges of the
entire containing cell. This is the smallest static case that can prove finer
occluder geometry without introducing door state or motion.

### Moving blocker

An authoritative large block moves along a bounded path. Its collision shape
and sight-blocking footprint follow the same fixed-tick pose, while renderers
only interpolate and display the resulting snapshot. The shadow does not lag,
leave a stale blocked cell, or reveal a hidden body during the transition.

### Tight visibility horizon

The future camera has an explicit maximum useful view extent. TrueSight does
only the work needed for that view plus a tested safety margin, rather than
degrading a map-wide mask or scanning map-wide geometry merely because a level
is large. Zoom, camera lock, query range, and interaction concealment have one
documented relationship.

## Architecture hypotheses to test

### Prefer a hybrid occluder model

Retain the current grid topology as the fast path for cell walls. Add a bounded
fine-geometry path for objects whose silhouette matters. Plausible primitives
are finite segments, circles, or small convex outlines. A door leaf is likely a
thin rectangle or segment rooted at a hinge; a pillar is likely a circle or a
small convex approximation; a moving block is likely a translated convex
outline.

This is preferable to merely increasing grid or mask resolution as a starting
hypothesis. A higher-resolution grid would multiply map storage and rebuild
work while still making rotation and continuous motion awkward. Arbitrary
renderer-mesh raycasting would couple gameplay-facing concealment to the
renderer and would be difficult to bound consistently across Canvas2D and
Three.js.

The investigation must still compare the hybrid against simpler alternatives
and reject it if measurements or correctness tests do not support it.

### Separate static topology from dynamic pose

Static wall and authored-object geometry can be compiled and cached behind a
topology revision. Dynamic occluders should live in a fixed-capacity collection
with stable IDs and snapshot-visible poses. Their presence should not force the
whole static topology to be rebuilt every presentation frame.

The visibility implementation may need a bounded spatial lookup around the
observer. Merely cropping the output mask is insufficient if every distant
occluder corner still generates rays. Capacity, query radius, overflow policy,
and maximum candidate rays must be chosen from measurements rather than guessed
here.

### Share geometry, not TrueSight authority

A door's hinge pose, collision state, and any gameplay-relevant open/closed
threshold belong to the fixed-step simulation and recording schema. A detached
snapshot may expose the bounded geometry needed for presentation. Canvas2D and
Three.js should consume the same TrueSight result; neither renderer decides
whether a door blocks sight.

Enemy perception is a separate authoritative simulation concern. It may reuse
pure occluder geometry and intersection code, but it must not consult the
player's fading mask, interpolated camera frame, or presentation flags. Whether
AI can see through a partly open door needs its own explicit rule and replay
tests.

### Start in two dimensions

The first useful slice can treat door leaves, pillars, and large blocks as
full-height occluders on one gameplay layer. Height-aware sight, windows,
looking across vertical apertures, and multiple observers remain separate
extensions. This matches Lantern's X/Z gameplay with limited per-body world Y
without pretending the eventual problem is general 3D visibility.

## Constraints

- Simulation truth remains independent of Canvas, Three.js, DOM state, camera
  interpolation, and frame rate.
- Door and moving-block state must use stable identity, bounded storage,
  deterministic ordering and tie breaks, explicit reset/swap cleanup, and a
  replay branch if they become authoritative state.
- Fine occluders must not become an unbounded list of arbitrary scene meshes.
- The current wall-grid path and old recording profiles must remain available
  unless a promoted plan explicitly migrates them.
- TrueSight concealment must continue to gate local hover and pinned
  presentation without revealing hidden bodies, health information, or
  effects. Edit mode may retain its intentional full reveal.
- Canvas2D and Three.js must agree on the logical result. Automated checks are
  not a substitute for a real-browser Canvas2D/WebGL/WebGPU readability pass.
- A camera or zoom restriction is a product contract, not a hidden performance
  hack. The supported extent and behavior outside it must be stated before the
  visibility horizon changes.
- Opening a door visually must not silently define pushing, damage, sound,
  traps, AI interaction, or mechanism wiring. Those systems may connect later
  through explicit commands and events.

## Investigation packets

These packets can be completed in one focused design effort without committing
to the full door feature.

1. **Baseline measurement.** Build deterministic diagnostic arrangements for
   a one-cell pillar, narrow static opening, long wall, and several map sizes.
   Record topology, ray, raster, total TrueSight time, mask scale, and visual
   artifacts under the supported renderers.
2. **Geometry spike.** In a test-only or disposable branch, compare a circular
   pillar and a rotating thin door leaf against the current grid path. Prove
   corner/tangent behavior, exact-hit tie breaks, polygon stability, and hard
   upper bounds before selecting primitives.
3. **Dynamic update spike.** Exercise several moving leaves and blocks without
   rebuilding static wall topology. Measure candidate gathering, rays, mask
   rasterization, storage reuse, and overflow behavior.
4. **Camera contract.** Decide the maximum supported gameplay view, permitted
   zoom, visibility margin, and behavior on maps much larger than that window.
   Then derive budgets from the decision rather than choosing an arbitrary
   200-meter range.
5. **Door vertical-slice plan.** Only after the evidence above, specify one
   authored single-layer door, its fixed-tick state and commands, collision,
   replay/schema branch, snapshot shape, TrueSight integration, probes, tests,
   editor workflow, and manual acceptance route.

The pillar case is a useful first proof because it isolates static geometric
quality. The moving-block case proves dynamic transport. The hinged door should
be planned after both seams are understood because it combines geometry,
authoritative motion, collision, interaction, authoring, and visibility.

## Acceptance seeds

- A closed door conceals its aperture; a partly open door exposes only the
  geometrically valid wedge; the leaf continues to conceal space behind it;
  and a sufficiently open door agrees with collision traversal.
- A round pillar produces a footprint-appropriate shadow and permits sight
  around both sides without corner flicker as the observer moves.
- A moving block's logical shadow follows its authoritative pose with no stale
  cell, hidden-entity leak, allocation growth, or renderer disagreement.
- Boundary rays and exact tangent/corner cases have deterministic tie breaks
  under repeated runs and recordings.
- The selected camera extent and worst supported occluder arrangement meet
  measured CPU, ray-count, memory, and texture budgets without depending on an
  unrestricted zoom-out.
- TrueSight-off and edit-mode behavior remain explicit; AI line of sight and
  old replay profiles are tested independently.

## Open questions

- What is the maximum gameplay camera extent, and is zoom fixed, clamped, or
  authored per area?
- Which fine primitives give enough fidelity without introducing a general
  polygon or physics framework?
- Does the initial door use direct interaction, mechanism control, physical
  pushing, or one deliberately limited combination?
- What blocks a moving door, and does it stop, reverse, push, damage, or ignore
  bodies?
- At what opening angle or clearance may each body size pass, and should that
  be derived from collision geometry rather than thresholds?
- Must enemy line of sight match the player's geometric aperture exactly, or
  can AI use a separately bounded approximation?
- How are dynamic occluder height and cross-floor viewing represented after the
  two-dimensional first slice?
- What fixed capacities, local-query structure, and overflow behavior satisfy
  measured worst cases?
- Should the display mask remain map-sized with reduced density, become a
  player-centered window, or use another transport once the camera contract is
  known?

## Promotion trigger

Promote one decision-complete plan when a hand-authored Temple of Ix room or an
M1E mechanism genuinely needs a pillar-quality fix, moving blocker, or hinged
door. Promotion requires baseline measurements, a selected bounded occluder
representation, an explicit camera/view contract, replay and AI boundaries,
authoring workflow, automated acceptance, and a real-browser visual acceptance
route. Do not promote all three stories merely because one is ready.
