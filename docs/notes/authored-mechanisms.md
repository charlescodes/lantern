# Authored mechanisms: controls, logic, and gates

> **Boundary:** authoring-map v8, snapshot/recording v24,
> `authored-mechanisms-v1`. M1E.1 + M1E.2 are implemented as Pass A.
> Automated checks passed; browser/GPU acceptance remains manual.

Maps own a declarative graph, not executable scripts or subscriptions. Ordinary
instances declare typed ports through the catalog; non-spatial `logic.*` nodes
and directed links live in `mechanisms`. Stable instance/node IDs identify
endpoints across floors. The compiler rejects missing endpoints, mismatched
types, repeated inputs, duplicate IDs, invalid properties, capacity overflow,
and combinational cycles. Fan-out is legal; fan-in uses `logic.any`/`logic.all`.
Unused inputs warn but remain valid while a puzzle is under construction.

The existing v7 map collection remains importable. Migration adds an empty
mechanism section; saves emit v8. Recordings v2–v23 force profile `none` and
retain historical plate behavior. A genuine v23 recording and its expected
physics are frozen in `test/fixtures/mechanisms-legacy-v23.json`, generated from
unmodified commit `450e98e8ae3e8aafc2043227902c58008cf0efca`.
The package/application stays at 0.9.3.

## Clock and authority

At tick N, copy the source/stateful output registers collected at N−1, clear
pending pulses, evaluate combinational nodes in stable topological order, then
capture every input before advancing stateful nodes once. Apply gate requests
before AI, navigation, elevator motion, or physics. Movement, pressure, player
interaction, and projectile impacts collect sources for N+1. Multiple pulses
from one output during one collection tick coalesce. Diagnostic retention is
independent from signal delivery.

Stateful outputs publish on the next clock. A direct plate→gate wire therefore
has one tick of source latency; a plate edge→toggle→gate has two. A repeater
accepting enable at tick T publishes its first pulse at T+1, then every
`intervalTicks`; this is its immediate-on-enable behavior at a synchronous
state boundary. A delay accepting a pulse at T publishes at T+`delayTicks`.
A timer accepting start at T publishes active from T+1 through T+durationTicks,
then publishes elapsed and inactive at T+durationTicks+1. Cancel/reset wins over
start/set/toggle/count in the same evaluation. Stateful feedback is legal;
physical gate observations are also registered feedback, never recursive calls.

Reset samples current initial plate occupancy and initial lever/latch/toggle
levels before the first snapshot, without emitting edges. Mechanism-related
authoring changes rebuild this subsystem and clear its transient state. Live
bodies retain their positions; reject an edit atomically if its initially
closed gate would overlap a live actor, prop, or dynamic corpse. Unrelated
edits retain mechanism state. Source JSON is never rewritten by gate motion.

## Ports and properties

| Definition | Inputs | Outputs | Properties / behavior |
| --- | --- | --- | --- |
| `object.pressure-plate` | — | `pressed` level; `pressedEdge`, `releasedEdge` pulses | Boolean `player`, `enemy`, `prop` default true; `corpse` defaults false. Corpses mean dynamic bodies, not inert decoration. Existing grounded floor/footprint rules apply. |
| `mechanism.gate` | `open` level | `isOpen` level; `opened`, `closed`, `blocked` pulses | One cell; retries closing without crushing or teleporting. |
| `mechanism.lever` | — | `on` level; `changed` pulse | `initialOn`, default false; E toggles. |
| `mechanism.chain` | — | `pulled` pulse | E only; projectiles never pull it. |
| `mechanism.button` | — | `pressed` pulse | Body-contact entry or swept projectile collision; normal projectile impact still happens. |
| `logic.not` | `value` level | `value` level | Boolean inversion. |
| `logic.all`, `logic.any` | `a`, `b` levels | `value` level | AND / OR. |
| `logic.toggle` | `toggle`, `reset` pulses | `on` level | `initialOn`, default false. |
| `logic.latch` | `set`, `reset` pulses | `on` level | `initialOn`, default false. |
| `logic.delay` | `pulse` pulse | `pulse` pulse | `delayTicks` 1–216000 (default 60); `retrigger` restart/ignore. One pending pulse. |
| `logic.timer` | `start`, `cancel` pulses | `active` level; `elapsed` pulse | `durationTicks` 1–216000 (default 60). Start restarts. |
| `logic.repeater` | `enabled` level | `pulse` pulse | `intervalTicks` 1–216000 (default 60). |
| `logic.counter` | `pulse`, `reset` pulses | `reached` level; `reachedEdge` pulse | Saturating `threshold` 1–65535 (default 1). |

Interaction resolves in simulation on the player's runtime floor, within an
inclusive 1.25m and a 120° cone around the retained movement heading, with grid
LOS. Walk toward a control to face it. Nearest wins, then stable ID for exact
ties; no target is a no-op. Only players intentionally interact in this pass.
E is an edge command; key repeat does not retrigger. Shift+E now toggles the
developer editor. Wall controls anchor in a wall cell: rotations 0/1/2/3 face
+Z/−X/−Z/+X, and require an open adjacent front cell.

Gate changes clone disposable collision overlays, update the affected floor's
revision, reset destination/reachability caches, and update snapshot occluders
used by TrueSight. Authored navigation can describe routes through open gates;
live movement still respects a currently closed gate. Both renderers consume
the same device visual descriptions. Gates are full-cell barriers, not hinged
doors; sub-cell occlusion remains a separate project.

## Authoring and inspection

Open the toolbox with `;`, enter edit with Shift+E, and select **Mechanisms**.
Stamp plates, gates, levers, buttons, and chains; rotate wall devices with R.
Use **Wire mechanisms**, then click the source and target. A single compatible
port pair connects immediately; multiple choices appear as explicit buttons in
the graph panel. A pending source survives a floor switch. Escape cancels it.

The graph list also selects physical devices on other floors and creates all
non-spatial logic nodes. Selected-device forms come from catalog descriptors;
advanced JSON is collapsed and uses the same validation. Incoming/outgoing
wires show endpoint ports and floor badges, with an Unwire action. Directed
lines and remote-endpoint markers appear only in edit mode. Each operation is
one undoable authoring command, including cascade deletion. Future generators
emit exactly this same v8 map format.

`__lantern.mechanisms()` returns detached counts, clock registers, logic state,
device state, and diagnostic counters. `__lantern.mechanismEvents()` returns
the latest 64 events from a 256-entry ring. Ring overwrites and coalesced pulses
are counted. These reads cannot mutate delivery.

Limits pinned in v24 recordings: 256 logic nodes, 512 total mechanism nodes,
1024 links, 128 controls, 128 gates. The reserved Pass B mover/trap limits are
64/128; no mover or trap implementation exists yet. Input/output registers,
counters, and countdowns use bounded typed arrays.

## Acceptance and next pass

Run `node --test test/mechanisms.test.js test/input_chord.test.js`, then
`npm run check`. Tests cover real v23 compatibility, v7 migration, exact current
replay, clock boundaries, reset conflicts, graph validation/capacities, control
impacts, safe closing, atomic edits, semantic undo, cross-floor wiring, and a
2400-tick deterministic acceptance-map run.

Open `?arena=mechanisms` and repeat with `&renderer=3d`:

1. Walk onto the plate at (3.5, 5.5): it holds the central gate at (7.5, 5.5)
   open. Push the nearby rock onto the plate. Release and block a closing gate.
2. Pull the west-facing chain on wall cell (7, 8): the timer holds the central
   gate for three seconds. Shoot the west-facing button on wall cell (7, 3):
   the Fireball impacts normally and the toggle/delay/latch circuit operates
   the second gate. Pull the chain to reset the latch.
3. Face the lever at (2.5, 7.5) and press E. Its repeater increments a counter;
   the third pulse opens the gate on the Signal gallery floor. The existing
   autonomous elevator at (4.5, 9.5) provides access.
4. Edit links and typed properties, select explicit ports, switch floors while
   wiring, delete a linked device, undo/redo, save/load, and reset. Confirm
   wire overlays disappear in play and hidden devices stay concealed.

No browser/GPU run was available in the implementation environment. This
manual route remains the final readability/usability gate. Pass B is M1E.3 +
M1E.4 in the [train plan](../plans/m1e-mechanisms.md): triggered elevators,
moving blocks, bolt/spell/spike/spear traps, and their integrated acceptance room.
