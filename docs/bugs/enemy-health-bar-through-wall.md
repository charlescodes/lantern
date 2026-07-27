# Enemy Health Bar Visible Through Solid Walls

- **Status:** Open; investigation and repair intentionally deferred.
- **First observed:** During Lantern 0.7.0 review, human visual report on 2026-07-27.
- **Suspected origin:** The 0.6.x health-bar presentation; earliest affected version is unconfirmed.
- **Area:** Actor health-bar visibility and Three.js presentation.
- **Impact:** Presentation information leak; no simulation, replay, or schema failure has been observed.
- **Renderer/backend:** Not captured in the original report.
- **Product direction:** World-space enemy health bars are likely prototype/debug presentation and may not ship in the final game.

## Reported symptom

While the player was inside the closed room on the test map, an enemy health bar was visible through the solid wall. This can reveal an enemy's presence and health when its presentation should be occluded or concealed with the owning actor. The issue was only noticed during 0.7.0 review, but the reporter suspects it relates to the health-bar work introduced in 0.6.x rather than the tactical-AI changes.

## Expected behavior

An enemy health bar is subordinate to that enemy's visibility. A solid wall between the player and enemy should prevent the bar from appearing through the wall, and the bar should reveal or conceal together with its actor through TrueSight transitions.

## Current reproduction record

The report has not yet been independently reproduced or minimized. The best available steps are:

1. Run Lantern 0.7.0 using the same 3D route and backend as the original observation.
2. Enter the closed room on the test map while an enemy remains outside on the other side of a solid wall.
3. Look toward the wall as the enemy moves nearby.
4. Observe whether the enemy health bar appears through the wall while the enemy should be occluded.

The exact renderer route, backend, device, DPR, camera angle, enemy position, enemy health, frequency, and TrueSight diagnostic state were not recorded. Canvas2D has not been assessed for this report.

## Investigation notes

No root cause or introducing release is assigned yet. Health bars were introduced in 0.6.0, and Lantern 0.6.1 deliberately left their depth testing and depth writing disabled while placing the fill and track in one transparent render queue; that repaired the black-fill compositing defect. The new symptom may involve that depth state, the screen-right bar offset, instance visibility, or TrueSight opacity/mask sampling, but those are hypotheses only. Reproducing against both 0.6.0 and 0.6.1 is required before attributing the regression.

A future investigation should capture:

- the exact `?renderer=3d` or `?renderer=3d&backend=webgl` route, device, DPR, and camera position;
- the enemy ID, position, health, snapshot visibility data, and `window.__lantern.isVisible(...)` result;
- actor, track, and fill instance opacity across the reveal/conceal transition;
- whether wall depth alone, TrueSight alone, or their interaction permits the leak;
- Canvas2D behavior as the renderer-independent regression oracle.

## Acceptance boundary for a future repair

Future triage has two valid dispositions: repair occlusion if world-space enemy health bars are retained, or remove the bars from the relevant final-game presentation and verify that no replacement leaks enemy information through walls. No decision is required while the current prototype bars remain deferred.

- An enemy and both resident health-bar meshes remain concealed behind the closed-room wall in automatic 3D and forced WebGL 2.
- The bar reveals and fades with its owning actor, including partial TrueSight transitions and the screen-right offset.
- Green, amber, and red fills remain visible above the dark track when the actor is legitimately visible; the 0.6.1 black-fill defect must not return.
- Canvas2D/Three.js visibility parity, resident resource identity, and the existing light/material topology remain intact.
- Simulation visibility, AI knowledge, replay behavior, and schemas remain unchanged.
