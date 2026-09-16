# Obelisk activation range is difficult to distinguish from occlusion

- **Status:** Open; deferred diagnostics/readability bug.
- **Priority:** Polish before encounter-heavy map authoring.
- **Reported:** 2026-09-16.
- **Route:** `?renderer=3d&arena=navigation-testing`.

## Symptom

An obelisk configured with a 20-meter activation radius appears during play to
have roughly a 10-meter radius. The one-meter editor grid makes the apparent
discrepancy especially noticeable.

The distance calculation is currently correct. In `navigation-testing`, the
player start at `(3.5, 18.5)` is about `17.03m` from the obelisk at
`(20.5, 19.5)`, but intervening solid cells block the separate line-of-sight
requirement. Because the UI exposes neither test, the first position where
line-of-sight opens can be mistaken for the range boundary.

## Expected correction

Keep the current sentry rules unless playtesting changes their design: same
floor, no more than 20 meters away, and unobstructed map line-of-sight. Add
detached, bounded obelisk diagnostics to the stable-identity inspector or an
appropriate encounter debug view. At minimum, expose:

- measured player distance and configured activation radius;
- same-floor result;
- in-range result;
- line-of-sight result; and
- a concise dormant reason such as `different-floor`, `out-of-range`,
  `occluded`, `capped`, or `waiting-for-cadence`.

The diagnostics must observe simulation truth without moving spawn authority
into the DOM or renderer. Canvas2D and Three.js should communicate the same
reason, and the final acceptance check should reproduce the original
navigation-testing route in a real browser.
