# Elevator Crowding During Enemy Traversal

- **Status:** Open; deferred after M1C navigation acceptance.
- **First observed:** Manual M1C navigation review on 2026-09-08.
- **Area:** Multi-enemy elevator traversal, local body collision, and route
  execution.
- **Impact:** Enemies can crowd a small elevator while attempting upward
  traversal, so typically only one rider completes the trip per cycle. The
  single-rider route remains functional.

## Reported symptom

Several enemies converge on the same elevator staging/deck area while pursuing
across floors. Their ordinary body collision makes the crowd visibly bunch up,
and the small platform normally admits one enemy at a time. The remaining
enemies can delay one another instead of forming a readable queue.

This is not a cross-floor clairvoyance, replay, or single-rider traversal
failure. M1C intentionally leaves reservations and passenger ownership out of
scope, so the current behavior is an accepted limitation rather than a reason
to reopen the completed milestone.

## Expected future behavior

A future traversal/crowd slice should make upward elevator use legible and
reliable for multiple enemies. Candidate directions include a larger authored
platform or a bounded queue policy that gives a rider already on the deck
priority while other enemies stage and dequeue in a stable order. The design
must preserve autonomous elevator timing: AI may observe and wait, but may not
call, cycle, teleport, or acquire scripted passenger ownership.

Downward traversal deserves separate evaluation. The desired feel is that an
enemy can continue its hunt by taking an ordinary, physically valid downward
opening more easily than it can board a crowded upward platform. Whether that
means using an existing open elevator aperture, falling, or another authored
descent rule is not yet specified; it must retain the established aperture,
support, and fall authority rather than adding a special-case teleport.

## Current reproduction record

1. Start `?arena=navigation` and allow multiple enemies to pursue toward an
   upper-floor elevator.
2. Let them converge at the same staging/deck area while the autonomous lift
   cycles.
3. Observe crowding and that one rider normally boards while others remain
   blocked or delayed.

Canvas/Three.js parity, exact enemy count, elevator phase, and a minimized
route have not yet been recorded. This report intentionally does not prescribe
a fix.

## Acceptance boundary for a future repair

- Multiple enemies form a bounded, deterministic waiting/rider policy or use a
  deliberately enlarged authored deck.
- A current rider retains priority without changing the autonomous elevator
  schedule.
- Missed cycles, topology edits, death, body collision, replay, reset, and
  pool swap-removal remain deterministic.
- Legitimate downward traversal is tested separately from upward queueing.
- Single-rider M1C behavior and the prohibition on cross-floor clairvoyance
  remain intact.
