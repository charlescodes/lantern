# Editable, Floor-Aware Obelisks and Reliable Enemy Homes

> **Status:** implemented 2026-09-12, extended 2026-09-16 · application `0.9.3` · recording schema
> v21 · authoring-map v7

This work replaces the original singleton obelisk marker with a bounded,
editable instance model while preserving older replay behavior. Simulation
state remains authoritative; renderers consume floor-local snapshot data.

## Delivered checkpoints

1. **Floor ownership:** obelisk rendering, queries, projectile impact identity,
   and encounter placement resolve against the relevant runtime layer rather
   than the editor's active layer.
2. **Reliable homes (schema v19):** each spawned enemy captures its home
   obelisk stable ID, layer, and guard point. A returning enemy uses authored
   topology and autonomous elevators to reach that layer before local movement
   resumes. An unreachable home remains stable and retries; it is not silently
   rebased onto the wrong floor.
3. **Independent authoring (schema v20 / authoring-map v7):** `object.obelisk`
   appears in the ordinary object palette and supports stable placement, move,
   property editing, deletion, undo/redo, save/load, and replay. Maps may hold
   up to 64 obelisks. Each selects `wizard` or `urchin` (default `urchin`), a
   living cap from 1 through 4 (default 4), and a bounded spawn interval
   (default 1,800 ticks / 30 seconds).

The enemy pool remains globally bounded at 64. Each obelisk may keep at most 4
of its own enemies alive at once and may replace them after death. Spawn
attempts, direction cursors, skips, and counts remain deterministic and bounded.
Moving or deleting an obelisk does not delete existing enemies or rewrite their
captured home; it only changes future spawning.

Follow-up authoring behavior keeps encounter sources distinct from authored
starting actors. Wizard and urchin instances may be stamped directly into a
map; they start immediately on load/reset, have no obelisk owner, and return to
their authored guard point. Current authored obelisks only spawn while the
player shares their floor, is within 20 meters, and has unobstructed map
line-of-sight. A loaded/reset encounter remains eligible on its first tick;
placing a new obelisk in an existing editor session schedules its first attempt
after its configured interval.

Authoring-map v6 migrates its single marker into an `object.obelisk` instance,
removing the replaced wall cell while retaining equivalent collision. Schemas
v2-v18 keep legacy home/encounter profiles; schema v19 enables floor-aware
homes with the legacy singleton encounter; schema v20 enables independent
authored encounters.

Automated acceptance covers migration, palette exposure, independent mixed
archetype spawning and living caps, move/delete preservation, floor-local
presentation, complete elevator return-home traversal, and replay-profile
selection. Real-browser Canvas2D and Three.js readability remains a manual
acceptance gate.
