# Foreground Wall Fading

> **Status:** implemented development checkpoint after Lantern 0.9.0
>
> **Authority:** Three.js presentation only; map cells, collision, movement,
> TrueSight authority, Canvas2D, snapshots, recordings, and replay are unchanged

Every ordinary 3D wall cell remains a complete one-meter-wide, `2.5m`-tall
box, including its top face. A wall renders at `33%` opacity when both of these
conditions hold:

- the shortest X/Z distance from the interpolated player center to the wall's
  one-meter footprint is inside the inclusive `0.75m` walking-designation
  radius;
- the player lies on the screen-top side of the wall's projected diagonal.

The second condition is camera-relative. The dot product from wall center to
player against `Camera3D.groundForward` must be positive. With the default
45-degree yaw, that is the northeast half-plane that projects as the top
triangle of a diamond-shaped cell. The exact dividing diagonal stays opaque.
Changing camera yaw rotates the classification without changing map data.

## Rendering boundary

The resident wall mesh carries one dynamic opacity scalar per instance. Values
are either `1.0` or `0.33`; the wall material multiplies that value by the
existing TrueSight display opacity. Smooth alpha blending replaces alpha
hashing for walls. Depth testing and depth writing remain enabled, while
lighting and the existing shadow policy remain unchanged. Matrix buffers, mesh
identity, and draw count stay fixed while the player moves; only the active
opacity prefix uploads when player position, map topology, or camera direction
changes.

The test depends on proximity, not idle, walking, or running state. Authored
obelisks retain their existing mesh, and an obelisk's replaced cell remains
excluded from the ordinary wall pool. Diagnostics report total, opaque, and
faded wall counts with the configured opacity and proximity radius.

This remains a deliberately narrow battleground readability policy. When
Lantern gains roofs, authored walls, tall props, or multi-level spaces,
foreground treatment should become an explicit camera-aware occluder policy.
That future policy may add authored groups, object-specific opacity, or timed
transitions, but it must not change collision, TrueSight, AI perception, or
replay truth.

Automated coverage fixes proximity and diagonal boundaries, camera-relative
classification, full-box geometry, resident opacity storage, update caching,
diagnostics, and TrueSight composition. Real-browser GPU review remains the
acceptance gate for blending order, wall-corner overlap, scorch readability,
and player visibility on automatic WebGPU and forced WebGL 2.
