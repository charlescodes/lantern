# Playtest Defect Backlog — 2026-09-11

- **Status:** Mixed ledger. The lowered-elevator Fireball report is resolved in
  schema v18; remaining reports are open, unprioritized, and not yet
  independently reproduced.
- **Context:** Manual play in the multi-floor navigation arena, including the
  third/top floor. Exact renderer, backend, seed, enemy IDs, and elevator phase
  were not captured.
- **Purpose:** Preserve symptoms and player-facing expectations without choosing
  an implementation or reopening a completed milestone.

## Downward enemy pursuit is unreliable

Enemies appear to continue a chase down an elevator or open elevator shaft only
about half the time. In the other cases, pursuit stops or fails to make the
downward transition even though the player used that route.

Expected behavior: an enemy with the required evidence and a physically valid
downward route should pursue consistently. A future reproduction should first
separate open-shaft falling from riding the elevator downward and record what
the enemy knew when it stopped.

## A lowered elevator can block an upper-floor Fireball

**Resolved in development schema v18** under
`projectile-height-collision-v1`. This report remains as the original
playtest context and acceptance record.

A Fireball cast by the player or an Urchin can explode at an elevator opening
even when the elevator is fully down and appears vertically clear of the shot.
The current vertical contract says an upper-layer projectile must not collide
with a shaft travelling below that floor, so the reported result is a defect if
that is the exact impact context.

Current behavior: a projectile hits elevator geometry only when that geometry
intersects the projectile's layer and vertical flight band. This is
also an example of the broader, already-captured
[height-aware projectile blocker](../soft-specs/idea-bin.md#spells-and-projectile-readability)
need; it should not be patched by making every movement blocker a projectile
blocker.

## Guard return can target home coordinates on the wrong floor

An enemy pursued the player to the third/top floor, lost track, searched or
circulated, and then returned to the X/Z coordinates of its obelisk or spawn
while remaining on the top floor. The actual home location was on the first
floor.

Expected behavior: an enemy's home/guard post includes its floor identity. If a
valid route home exists, return behavior should use it; if not, the enemy should
not treat matching X/Z coordinates on another floor as arrival. This report is
about runtime per-body layer state and must not be addressed by changing the
editor's active layer or authored spawn data.

## Hole capture feels too immediately committed

Once the player begins falling through a floor hole, the fall currently feels
irreversible too early. The desired feel is a small saving-grace interval in
which strong movement back onto valid floor can cancel the drop and restore
floor support.

Candidate tuning from this playtest: keep that recovery available for roughly
the first `0.20m` below the floor plane, then commit to the ordinary fall. The
exact threshold and snap feel remain subject to manual tuning; this is a feel
request rather than a fixed physics contract.

## Vertical-state authority needs a consolidation audit

Capture a follow-up investigation into how a body's jump/fall height and
vertical velocity are represented and consumed across the simulation. In
particular, verify which world-Y values are authoritative for jump and fall
resolution, height-aware Fireball contacts, supports, and layer transitions;
then identify any duplicated, stale, or presentation-only height paths that
could diverge from that authority.

This is not yet a claim that a specific jump or Fireball behavior is broken.
The desired outcome is a compact, documented vertical-state contract and a
smallest-safe consolidation plan, preserving Lantern's limited 2.5D model:
authoritative X/Z movement with per-body world Y, rather than general 3D
physics.

## Wall scorch marks clip at segment boundaries

A blast mark near the edge of a wall segment is cut off instead of continuing
onto the adjacent wall segment, leaving an obvious half-mark. The current
scorch implementation deliberately clips generated triangles to the struck
one-meter wall face, which matches the symptom but does not give the desired
decal-like result.

Expected behavior: a mark on a continuous wall should read as one two-dimensional
scorch decal across compatible neighbouring wall faces. Corners, gaps,
non-coplanar faces, map edges, Canvas/Three.js parity, and TrueSight concealment
remain reproduction and design questions.

## Related design question: one reusable aperture concept

An elevator's upper opening feels like the same atomic world element as a floor
hole and may eventually deserve one reusable authored/runtime aperture concept.
The current system already shares the pure footprint-fit helper and ordinary
fall pipeline between standalone holes and upper elevator shafts, but it keeps
their authored records and debug geometry distinct.

That separation is not itself recorded as a bug. Revisit it only if future
elevator, navigation, collision, or authoring work shows harmful duplication;
any consolidation must preserve connector topology, elevator support behavior,
and standalone-hole semantics.
