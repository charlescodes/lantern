# Verification guide

> **Status:** current working procedure. Automated checks establish regression
> evidence; visual feel and GPU presentation still require manual review.

## Baseline

Run `npm run check` for the repository suite. For a narrow change, run its
focused tests first, then the full check before handoff. Use `git diff --check`
for every documentation or source change. A passing Node or headless renderer
check is not proof of browser/WebGL/WebGPU readability.

For a probe-assisted reproduction, pause, capture `__lantern.snapshot()`, make
one controlled action, advance an exact number of ticks with `step(count)`, and
capture the result again. Prefer stable IDs from the snapshot over dense pool
indices. See the [probe contract](./probe-contract.md) for the supported
inspection and command categories.

## M1B manual route

Start the app and open `?arena=holes` (add `&renderer=3d` for the Three.js
route). From the deterministic bottom spawn:

1. Ride the autonomous elevators from bottom to top and back; wait through at
   least one complete dwell/travel cycle and retain ordinary X/Z movement.
2. Fall through the aligned holes, then use falling air control to choose the
   intermediate landing.
3. Cross a jumpable opening and low clutter; confirm the committed jump lands
   through the common support pipeline.
4. Trigger a breakaway tile and confirm its countdown becomes an ordinary hole;
   reset or Restore positions and confirm it returns intact.
5. Test a fitting prop, an oversized prop, and a movable lit torch at an
   elevator aperture. Confirm rejection, layer retention, and light continuity
   where applicable.
6. In edit mode, change the active authored layer while the player remains on
   another runtime layer; confirm the editor selection does not snap back.
7. Fire at a deck and lower-floor shaft as applicable; confirm layer-local
   Fireball impact behavior.

Use `__lantern.elevators()`, `__lantern.verticalBody("player", 1)`,
`__lantern.holes()`, `__lantern.holeDiagnostics()`,
`__lantern.breakawayFloors()`, and authoring probes to capture the state around
a failure. Record the route, map or arena, seed/recording, tick, commands,
stable IDs, expected versus observed result, and probe output with the report.
