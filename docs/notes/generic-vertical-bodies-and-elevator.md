# M1B.1–M1B.2 Generic vertical bodies, elevator, and floor holes

> **Status:** current non-release implementation contract · **Authoring format:** `lantern-authoring-map` v4 · **Runtime recording schema:** unchanged at v11

M1B.1 keeps Lantern's authoritative X/Z collision model and adds one bounded
world-Y degree of freedom. It is not a general 3D rigid-body system. Floors and
elevators are support planes; actors and eligible dynamic clutter own their
vertical state and may gain or lose those supports independently.

## Runtime body and support model

The player singleton and the typed-array enemy, dynamic-prop, and dynamic-corpse
pools expose equivalent vertical fields:

- `worldY`, previous world Y, and vertical velocity;
- mode (`SUPPORTED` or `FALLING`, with reserved codes for later modes);
- support kind (`FLOOR`, `ELEVATOR`, or `NONE`) and stable runtime support ID;
- stable layer index plus connector/transit context;
- capability bits for gravity, elevator riding, and elevator activation;
- the latest aperture-fit diagnostic.

Pool rows remain bounded SoA storage and swap-and-pop indices remain temporary.
Stable gameplay and authoring identities move with a body when its layer changes.
The player uses the same semantic fields without assuming it will forever be the
only actor type capable of riding.

Support is contact-derived, not an elevator-owned passenger manifest. A capable
body may acquire a platform when its support point is over the platform and its
feet are at or descending through the platform plane within tolerance. The
complete body footprint need not fit just to ride. Each fixed tick computes the
platform displacement once and applies that exact displacement to every current
support contact before X/Z physics, so there is no one-tick carry lag. Riders
retain controller input, AI, pushing, momentum, and co-rider collision. Leaving
the platform footprint clears support after horizontal resolution and begins a
fall with the platform's current vertical velocity.

Gravity is fixed-step, terminal-velocity bounded, and swept against real floor
and elevator support planes. The first valid plane crossed while descending
wins. Landing snaps to that plane, resolves the appropriate body layer once,
reenables grounded low-clutter contacts, and performs the existing bounded
solver passes for deterministic separation. Props and corpses never become
walkable supports.

Grounded bodies collide with low dynamic clutter. A falling body may pass over a
low body whose catalog trait compiles to `airbornePassable`; full grid blockers
remain blocking. Bodies on the same elevator support still collide regardless
of height or layer handoff state.

## Elevator connector and aperture

Authoring-map v3 adds one deterministic, map-level `connectors` collection and a
`nextConnectorOrdinal`. `connector.elevator.two-stop` stores a stable connector
ID, two distinct stable layer IDs, one aligned X/Z endpoint, platform and square
aperture widths, speed, dwell, initial stop, and `manual` or `occupancy`
activation. Lower and upper Y are derived from the referenced layers' signed
`baseY` values. The connector is stored once; compilation adds endpoint recipes
to both layers and one bounded elevator spawn recipe.

The platform is an unstoppable kinematic support. Payload mass, crowding, and
failed clearance never change its speed, reverse it, or stall it. Occupancy
activation counts capable actors only; rocks, tables, torches, and corpses may
ride without selecting the next stop. Debug commands can summon either stop or
cycle the request explicitly.

Upper passage uses the reusable pure `footprintFitsSquareAperture()` utility.
Circles must fit inside the aperture inset by radius plus positive clearance.
Oriented rectangles use rotation-projected half extents. Unknown footprint
shapes conservatively fail. A nominal 0.90m-diameter body therefore does not fit
a 0.90m aperture. A wide table may overhang and ride upward, but it is rejected
at the upper frame.

Rejected ascending loads retain their old layer, detach, and receive the minimum
ordered cardinal X/Z displacement that clears the aperture and the upper layer's
static grid. The tie break is deterministic. If all candidates are blocked, a
bounded best-effort displacement is used and a failed-ejection diagnostic is
incremented; the elevator continues. An oversized upper-floor body cannot
acquire a descending platform through the aperture, so it remains on the upper
floor while the lift leaves.

## Per-body layers and presentation

All authored layer recipes and all authored dynamic props are now present in the
simulation at once. Collision, occlusion, projectiles, actors, and dynamic-body
contacts use each body's own layer association rather than a single globally
installed floor. A fitting rider changes layer exactly once at a stop while
retaining identity, velocity, AI state, physical state, and attached effects.
The player transition updates the visible runtime view; it does not rebuild or
pause the other layers. General cross-layer pathfinding, sight, sound, and
projectiles remain unsupported.

Canvas2D and Three.js filter ordinary world presentation to the active visible
layer. Three.js converts simulation `worldY` to layer-local render height. The
elevator platform and aperture have distinct debug geometry; Canvas2D also
labels current elevator height. A transported torch keeps one catalog light key
and the light follows its live X/Z/Y without leaving an emitter behind.

Reset, **Restore positions**, successful map replacement, and replay setup
reconstruct body and elevator starts from authored data. Ordinary authoring
execute/undo/redo recompiles layer recipes while preserving unrelated live
state and reconciling only affected authored props. Runtime pushing, falling,
support changes, elevator movement, and layer handoffs never mutate the
authoring document or enter authoring history.

## Single-cell holes and multi-floor falling

`surface.hole` is a normal catalog-backed surface paint value. Its compiled
recipe owns one centered `0.90m × 0.90m` square aperture in a single 1m cell,
with the remaining cell area acting as a supporting frame. Adjacent hole cells
remain independent apertures and retain a seam; they never merge. A standalone
hole cannot share the same layer/cell as an elevator endpoint.

Holes and elevator frames call the same pure full-footprint containment helper.
Circles and quarter-turn rectangles are inset by their projected radius/extent
plus positive clearance, so nominally equal dimensions fail. Unsupported
shapes fail conservatively. A table can therefore bridge a hole indefinitely;
clutter never becomes a support plane.

On a grounded floor body, a bounded rim field sums gentle deterministic pulls
from nearby apertures it could fit. It is capped, remains slower than normal
walking, and goes through existing X/Z velocity paths, so input, AI, walls,
friction, and opposing neighbouring pulls still matter. After X/Z resolution,
the body sweep is intersected with every individual eroded aperture; the first
entry (then stable aperture ID) captures it without a fast-body skip.

Falling uses continuous world Y and scans descending floor planes in a bounded
order. At each exact within-tick crossing it interpolates X/Z: a fitting hole
continues the fall and moves that body’s layer band, while a frame or floor
lands it, restores low-clutter contact, and performs normal deterministic
depenetration. The player retains responsive, separately tuned horizontal air
control; enemies keep their existing controllers and props retain momentum.
The bottom test floor catches all normal M1B.2 fixtures. A bounded void rescue
is diagnostic-only rather than a damage/death system.

## Fixed-step order

After command-boundary actions, encounter/perception/navigation, and actor
controller preparation, the relevant order is:

1. acquire support contacts, count capable activators, step every elevator once,
   and carry existing riders by that tick's platform delta;
2. sum applicable hole rim attraction, then resolve ordinary X/Z actor and
   dynamic-body physics while controllers remain active;
3. release invalid platform contacts, capture swept floor holes, apply gravity,
   sweep all crossed support planes, land or pass apertures, perform aperture
   rejection/layer handoff, then synchronize the player's visible layer;
4. continue movement sound, spell cooldown/casts, layer-scoped projectiles,
   bodies, particles, health, and history exactly once.

The elevator/body loops use fixed capacities and reusable scratch records. They
do not allocate passenger arrays, footprint objects, closures, or events per
simulation tick.

## Authoring, validation, and probes

The generated Connectors palette entry places an endpoint between the active
layer and the deterministic nearest layer at a different height. Either linked
floor displays and can pick the same connector. The fixed inspector edits linked
layers, X/Z, widths, speed, dwell, initial stop, and activation policy. Placement,
inspection changes, and deletion use the existing semantic history, stable IDs,
dirty checkpoint, atomic validation/compilation, and undo/redo path. Elevator
motion is never historical state.

Validation rejects missing/equal/reversed linked layers, duplicate IDs, unknown
connector definitions, non-finite or misaligned endpoints, out-of-bounds
positions, invalid widths, speeds, dwell values, stops, policies, and capacity
overflow. It also rejects invalid catalog hole dimensions/clearance and a
standalone hole sharing a connector endpoint cell. Authoring-map v3 migrates
deterministically to v4 because holes are a catalog surface value and do not
need a grid reshape; v2, v1, and legacy scenario/map documents continue through
the existing migrations. Saving emits v4 only.

`window.__lantern` adds detached elevator and vertical-body diagnostics plus
`cycleElevator(connectorId)` and `summonElevator(connectorId, "lower" | "upper")`.
The authoring probes can inspect, place, update, or remove connectors while in
edit mode. Snapshot/inspector records expose world Y, vertical mode/velocity,
layer, support, transit connector, footprint, aperture result, motion/requested
stop, observed activator/rider counts, and rejection counters without exposing
mutable pool storage.

## Try it

Run `npm start -- --port 4174`, then open either printed route with
`?arena=elevator` (add `&renderer=3d` for the Three.js view). The fixture has two
floors three meters apart, one two-stop elevator at `(8, 18.5)`, player/enemy
access, a fitting rock, a lit movable torch, and an oversized table with clear
upper ejection space.

- Occupancy policy sends the lift when a capable actor boards. Normal RMB X/Z
  movement remains active during the ride, so walking off demonstrates falling.
- Open the toolbox with `;`; use `E` for authoring. Select **Two-stop elevator**
  in Connectors to place one, then use the inspector and ordinary Undo/Redo.
- In the console, inspect `__lantern.elevators()` and
  `__lantern.verticalBody("player", 1)`. Use
  `__lantern.cycleElevator("elevator-0001")` or
  `__lantern.summonElevator("elevator-0001", "upper")` for a deterministic
  debug request (substitute the fixture's reported connector ID if needed).
- Push the torch during or after a ride and verify its one light follows. Place
  the table with its center over the platform and verify it rides upward, is
  displaced at the frame, never changes layer, and never stalls the lift.

For holes, use `?arena=holes` (optionally `&renderer=3d`). It starts atop four
3m-separated floors with a vertical hole column, a no-hole bottom catcher, an
intermediate landing deck, adjacent seam holes, an adjacent wall, fitting rock/
torch, table, and nominally aperture-sized boulder. In edit mode paint or erase
**Floor hole** exactly like Moss. Save/reload and Undo/Redo use ordinary surface
history. In play, keep the player centered to fall through every aligned hole,
or steer sideways while falling to land on an intermediate frame. Inspect
`__lantern.holes()` and `__lantern.holeDiagnostics()` for detached recipes and
bounded events/counters.

Automated renderer tests verify snapshot adaptation and bounded resource use;
actual WebGPU/WebGL lighting, shadows, visibility, and visual readability still
require a real-browser/GPU pass.

## M1B.3 jumping and pressure plates

M1B.3 adds a committed player jump without creating a second vertical-physics
path. Space emits one replayed fixed-tick jump edge (P is the developer pause
shortcut). A supported player takes off along the current RMB direction, or
their facing when idle, and follows a 2m/0.55s gravity arc. Input does not steer
that arc; an aperture miss transitions to ordinary `FALLING`, where M1B.2 air
control resumes. Jumping ignores catalog-marked airborne-passable clutter but
still respects walls and other full-height blockers. The shared support solver
lands on floors or elevators and restores ordinary grounded collision.

**Pressure plate** is a catalog-backed sparse one-cell instance. It is momentary:
it is pressed only while a player, living enemy, or eligible dynamic prop is
supported by the same ordinary floor and has its center over the plate cell.
Airborne bodies, elevator riders, and corpses do not activate it. Compiled plate
state is bounded runtime data; authoring IDs, history, save/load, selection, and
the inspector remain generic. Plates cannot be placed on holes or elevator
apertures. `__lantern.pressurePlates()` and `__lantern.pressurePlateEvents()`
return detached diagnostics.

The current replay/snapshot schema is v12. v2–v11 commands have no jump edge
and retain their frozen behavior. Authoring-map v4 is unchanged because pressure
plates use the existing sparse-instance format.

## Deferred

Levitation, breakaway floors, clutter
stacking/support, tipping, crushing, explosion-launched Y, general 3D interval or
mesh collision, doors, cross-layer enemy routing, deliberate AI elevator use,
cross-layer sight/sound/navigation/projectiles, simulation streaming/dormancy,
inactive-floor live-state persistence, multiplayer, and pathological enclosed
ejection are intentionally deferred to M1B.3 and later slices.
