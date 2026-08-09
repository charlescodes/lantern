# Near-Player Wall-Cap Relief

> **Status:** implemented development checkpoint after Lantern 0.9.0
>
> **Authority:** Three.js presentation only; map cells, collision, movement,
> TrueSight authority, Canvas2D, snapshots, recordings, and replay are unchanged

Ordinary 3D wall cells use two resident instanced meshes: an open-top side
shell and a separate upward-facing cap. The side shell is always submitted for
every ordinary solid cell. A cap is omitted when the shortest X/Z distance from
the interpolated player center to that cell's one-meter footprint is inside the
inclusive `0.75m` walking-designation radius.

The test is based only on proximity, not the player's current idle, walking, or
running state. This prevents an occluding cap from reappearing because the RMB
gesture changed while the character remained beside the wall. Authored
obelisks retain their existing mesh, and an obelisk's replaced wall cell remains
excluded from both ordinary wall pools.

The cap pool is allocated to the same fixed map-cell capacity as the wall-side
pool and shares its lit, TrueSight-masked material. Map topology changes rebuild
the instance lists; otherwise caps are republished only when the interpolated
player position changes. Diagnostics report visible and suppressed cap counts,
capacity, and the shared relief radius.

This is deliberately a battleground cutaway convention, not a general-purpose
occlusion system. When Lantern gains authored walls, roofs, tall props, or
multi-level spaces, foreground-cap treatment should become an explicit
camera-aware presentation policy attached to occluding surfaces. That future
work may use cutaways, fades, or authored visibility groups, but it must not
change collision, TrueSight, AI perception, or replay truth.

Automated coverage fixes the inclusive footprint-distance boundary, open-top
side geometry, upward cap geometry, bounded resident mesh identity, cap height,
proximity updates, diagnostics, and shared TrueSight material. Real-browser GPU
review remains the acceptance gate for seams, interior-wall appearance, and
player readability on automatic WebGPU and forced WebGL 2.
