# Lantern 3D Presentation and Dynamic-Lighting Contract

## Status and boundary

This is a bounded presentation vertical layered after Lantern's fixed 60 Hz simulation. It does not revise the historical M0, M0.1, M0.2, or M0.2.5 behavior contracts.

```text
input -> fixed 60 Hz X/Z simulation -> read-only JSON-safe snapshot
                                         |-> Canvas2D regression presentation
                                         `-> Three.js 3D presentation + visual lights
```

The simulation remains authoritative for movement, collision, explosions, particles, editing, selection, commands, recordings, and replay. The 3D renderer may interpolate copied positions and add presentation-only height, materials, lights, post-processing, and shadows. Those additions must never affect AI, visibility, collision, damage, replay truth, or future multiplayer authority. Snapshot/recording schema stays v4 and scenario schema stays v2.

Canvas2D remains the default until the 3D presentation passes the human acceptance gate below.

## Runtime and backend selection

Three.js `0.184.0` is the only runtime dependency and is pinned exactly in `package-lock.json`. The browser continues to use native ES modules and the local server; `index.html` maps the Three package installed under `node_modules`.

- `?renderer=2d` selects the established Canvas2D renderer and is the default.
- `?renderer=3d` selects Three.js `WebGPURenderer`, which requests WebGPU and automatically falls back to WebGL 2.
- `?renderer=3d&backend=webgl` forces Three's WebGL 2 backend for regression testing.

Renderer selection occurs before either implementation asks the shared canvas for a rendering context. Three's renderer remains experimental, which is why the Canvas2D recovery route and forced-WebGL route are part of this contract. See the [Three.js WebGPURenderer guide](https://threejs.org/manual/en/webgpurenderer) and [MDN WebGPU API status](https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API).

Local development remains on `http://127.0.0.1:4173`. Loopback origins are potentially trustworthy for secure-context features; see [MDN secure contexts](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Secure_Contexts).

## Camera and input

Both cameras expose the input-facing operations `resize`, `focus`, `viewportToWorld`, `panByWorld`, and cursor-anchored zoom. Both retain a 24 m default orthographic view and clamp zoom to 4-64 m.

The 3D camera uses 45 degree yaw and 55 degree downward pitch. Pointer coordinates define an orthographic ray that is intersected with gameplay ground `Y=0`; the resulting command remains an X/Z target. Panning compares two ground intersections, so it stays world-meter based at any zoom. Movement, casting, editor placement, erasing, hovering, and selection do not acquire a gameplay Y dimension.

## Minimal 3D scene

- The floor lies at `Y=0` and retains a one-meter presentation grid.
- Every solid map cell is one instance of a 1 m by 2.5 m wall box.
- The player is a 1.6 m block with the existing 0.3 m radius represented as a 0.6 m square footprint.
- Rocks are instances of one low-poly sphere and rest at `Y=radius`.
- Fireballs are instanced low-poly spheres shown at a presentation-only 0.9 m chest height.
- All particles share one instanced low-poly spark mesh and use their existing `x/y/z` and `currentSize` snapshot fields.

Instancing bounds walls, rocks, fireballs, and up to 4,096 particles to a small number of draw calls. It does not introduce GPU simulation or a second source of entity truth. See [Three.js InstancedMesh](https://threejs.org/docs/pages/InstancedMesh.html).

## Dynamic-light budget

The baseline scene uses a cool ambient fill and one dim directional light for shape readability. Dynamic fire lighting is a fixed pool of eight non-shadow-casting point lights with inverse-square decay:

1. Recent explosion pulses, about 5 m range.
2. Active fireballs, about 3 m range.
3. Stable leases on large, young spark carriers, about 1.5 m range.

Spark leases persist until their carrier disappears or becomes ineligible; a newly ranked spark does not reshuffle every light each frame. Fire color progresses from a yellow core through amber to red-orange decay. Particle and projectile meshes remain emissive.

`dynamicLights`, `bloom`, and `shadows` are presentation-only A/B flags. Bloom defaults off and uses Three's TSL render pipeline when enabled. Shadows default off; the flag affects only the single directional light. Dynamic point lights never cast shadows because each shadowed point light would require six shadow renders. See [Three.js shadow costs](https://threejs.org/manual/en/shadows.html).

Colored point lights can bleed through walls while shadows are disabled. If that is visually unacceptable, a later presentation slice may add a wall-aware RGB X/Z light field with an explicitly chosen metric resolution and a TSL material sampler. It must not reuse the collision grid as its lighting resolution.

## Diagnostics and performance gate

`window.__lantern.presentation()` returns:

- requested renderer and backend plus the active backend;
- draw calls and triangles from Three, or zero for Canvas2D;
- active dynamic-light count and current presentation flags;
- snapshot-construction p50/p95/p99;
- presentation render CPU p50/p95/p99.

`window.__lantern.setPresentationFlag(name, value)` accepts only `dynamicLights`, `bloom`, and `shadows`. It does not enqueue a simulation command. Existing probe commands, debug flags, snapshots, recordings, and replays retain their current contracts.

The renderer continues to consume the JSON-safe snapshot initially. If a 4,096-visible-particle browser stress run reports presentation CPU p99 above 8 ms, only the renderer feed may be replaced by a reusable typed-array presentation frame. JSON snapshots remain available for probes and exports.

## Validation and acceptance gate

Automated coverage must retain all existing collision, explosion, lifecycle, replay, and soak tests and add:

- renderer query parsing;
- orthographic projection and ground-plane pointer conversion;
- cursor-anchored 3D zoom;
- deterministic eight-light priority and stable leases;
- identical simulation state when the same recording is consumed by 2D and 3D presentation paths.

Browser validation must cover automatic WebGPU selection, forced WebGL 2, resize, pan/zoom, editor placement, selection, pause/step, presentation flags, and recovery through `?renderer=2d`. At 1,920 by 1,080 with 4,096 visible particles, record hardware and backend and require unchanged simulation p99, presentation CPU p99 below 8 ms, and at least 55 FPS on the reference machine.

Human acceptance must confirm that particle arcs, bounces, shrinking, and wall behavior still read correctly; firelight colors nearby floor and wall faces and mixes/fades naturally; camera and input feel correct; and blocked geometry is readable. Until this gate passes, 2D remains the default and the 3D route is not visually accepted.

### Implementation validation on 2026-07-21

The browser matrix ran in Headless Chrome 147 on Linux with Google SwiftShader (`architecture: swiftshader`); the WebGL renderer identified itself as ANGLE over Vulkan/SwiftShader. The automatic route initialized Three's WebGPU backend, and the forced route initialized WebGL 2. Canvas2D recovery, resize, pan/zoom, editor placement, player selection, pause/step, and all three presentation flags completed without page errors or failed requests.

A temporary browser-only stress override filled the existing bounded pool with 4,096 visible particles at 1,920 by 1,080. Both 3D backends retained all 4,096 particles, the fixed eight-light budget, 9 draw calls, and 84,123 triangles without changing repository configuration. Snapshot p99 was 1.7 ms on WebGPU and 1.5 ms on forced WebGL 2; simulation p99 was 2.5 ms and 2.0 ms respectively.

SwiftShader rendered this stress case at about 4 FPS and included shader/pipeline compilation stalls in render p99, so those timing results are not a reference-machine performance acceptance and do not justify changing the renderer feed. Forced WebGL 2 produced a visually inspectable image. Headless SwiftShader's WebGPU capture did not produce a usable scene image even for an isolated minimal Three.js control scene, so WebGPU visual acceptance, the 55 FPS/8 ms reference thresholds, and the full human acceptance checklist remain open.

## Explicit non-goals

This slice does not add raw WebGPU pipelines, WebAssembly, an ECS, GPU particle simulation, production assets, skeletal animation, gameplay lighting, or 3D navigation/physics. WebAssembly is a CPU compilation target rather than a rendering or lighting API; see the [WebAssembly high-level goals](https://webassembly.org/docs/high-level-goals/).
