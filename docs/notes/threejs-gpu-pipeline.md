# Three.js and GPU pipeline guide

> **Status:** current implementation overview, verified 2026-09-18
>
> **Authority:** presentation only. Live source and performance captures take
> precedence when this guide drifts.

This guide explains what the GPU does for Lantern, what Three.js owns, how
simulation data reaches it, why the more expensive Render Lab settings can
struggle, and where structure-of-arrays is and is not used.

## Short version

The simulation runs on the CPU and remains the source of truth. Three.js does
not run Lantern's physics, AI, particles, collision, damage, or TrueSight
geometry. It receives a detached snapshot, converts visible objects into GPU
buffers, selects materials and lights, and asks WebGPU or WebGL 2 to draw the
scene.

Lantern uses three distinct data layouts along that path:

1. **Simulation:** bounded typed-array structure-of-arrays (SoA) pools.
2. **Snapshot boundary:** JSON-safe arrays of ordinary objects (AoS).
3. **Three.js/GPU boundary:** resident instanced meshes with contiguous matrix,
   color, emissive, and opacity attributes.

This is not zero-copy SoA-to-GPU rendering. It is a deliberate authority and
debugging boundary followed by a bounded repacking step.

The Render Lab does not currently have one global “High” preset. **High** is
the label for the 32-resident-light tier only. Pixel density, antialiasing,
bloom, shadows, and the other flags are independent. Several of those settings
together can multiply GPU work even though instancing keeps the draw-call count
small.

## CPU, GPU, and Three.js in plain language

The CPU is good at branching, game rules, and changing irregular state. The
GPU is good at applying the same small program to many vertices or pixels at
once. A frame crosses the boundary approximately like this:

```text
fixed 60 Hz simulation on CPU
  typed-array SoA pools
          |
          v
detached JSON-safe snapshot
  arrays of entity objects
          |
          +--> CPU TrueSight polygon and 8-bit visibility mask
          |
          v
ThreePresentation on CPU
  interpolate poses
  compose instance matrices
  write matrix/color/emissive/opacity attributes
  stage TrueSight texture and light objects
          |
          v
Three.js renderer
  build/cache shader pipelines and GPU resources
  submit WebGPU commands or WebGL 2 calls
          |
          v
GPU
  optional shadow pass
  vertex processing and triangle rasterization
  material, light, and TrueSight work per covered pixel
  optional bloom post-processing
          |
          v
canvas pixels
```

Three.js is the translation and resource-management layer in the middle. It
provides the scene graph, cameras, geometries, materials, `InstancedMesh`, node
materials/TSL, lights, textures, backend selection, shader compilation, and
render submission. Lantern still decides what exists and writes the changing
values each frame.

Lantern imports `three/webgpu` and constructs `WebGPURenderer`. The automatic
route requests WebGPU where the browser permits it and otherwise falls back to
WebGL 2. `?renderer=3d&backend=webgl` forces WebGL 2 for comparison. A backend
change can affect performance because Three.js translates the same scene
through different browser and driver APIs.

## What the GPU actually receives

### Geometry

A geometry contains reusable vertex data: the vertices of one wall box, one
low-poly spark, one rock, one actor cylinder, and so on. Lantern does not send a
separate copy of that geometry for every wall or particle.

### Instance attributes

For repeated objects, one `InstancedMesh` combines shared geometry and material
with a per-instance transform. Lantern preallocates each pool to a bounded
capacity and writes only its active prefix. Depending on the pool, the GPU
receives:

- one 4-by-4 transform matrix per active instance;
- an optional RGB instance color;
- an optional RGB emissive value;
- a per-wall opacity value for foreground-wall fading.

Walls, surface cells, pillars, tables, pressure plates, elevators, rocks,
torches, enemies, facing markers, dead bodies, health bars, Fireballs, sparks,
kinetic fragments, and TrueSight hit-cell diagnostics use resident instanced
resources where appropriate. Instancing is why thousands of particles can be
drawn in a small number of submissions.

Instancing saves draw calls and repeated geometry storage. It does **not** make
the triangles or pixels free. Every visible instance still produces vertex and
fragment work, and every applicable light, shadow, transparency, and
post-processing operation can increase the cost of those fragments.

### Materials and shaders

Most world meshes use `MeshStandardNodeMaterial`. Three.js turns material,
light, TrueSight, shadow, transparency, and backend choices into GPU shader
pipelines. Lantern's TrueSight node samples one resident red-channel texture
and applies the result to ordinary color, emissive output, alpha, and shadow
masking.

Shaders are compiled during 3D warmup for the default topology. The 3D route
pre-creates the configured resident light count and makes normally hidden
materials visible to `compileAsync()` so ordinary first use does not discover
every pipeline during play. Bloom and shadows remain optional paths, so their
first live activation can still cause a cold compilation or allocation spike
in addition to their sustained cost.

### Textures and render targets

TrueSight owns a fixed `256x256` one-byte texture and a 65,536-byte CPU staging
array. The active mask is copied into it and uploaded each presentation frame.
The fixed allocation avoids resizing GPU resources after warmup.

Bloom uses the rendered scene as an input texture and performs additional
full-screen processing. Shadows render depth from the directional light's
point of view into a `1024x1024` shadow map before the main view samples it.
These extra image-sized operations are fundamentally different from adding one
more instance matrix.

## Where Lantern uses SoA

### Simulation: yes

Projectile, particle, rock, enemy, elevator, dead-body, sound-event, and related
pools store separate typed columns such as `x`, `z`, `vx`, `health`, and `id`.
Dense active prefixes and swap-and-pop removal keep their hot loops bounded and
cache-friendly. This is Lantern's clearest use of structure-of-arrays.

### Presentation-only pools: sometimes

Kinetic fragments and damage numbers also use typed-array SoA pools on the CPU.
TrueSight uses reusable typed buffers for rays, polygon coordinates, and masks.
Scorch and debug geometry use preallocated position buffers.

### Snapshot: no

`Simulation.snapshot()` reads the SoA columns and constructs detached arrays of
ordinary projectile, particle, enemy, rock, and elevator objects. This shape is
easy to inspect, serialize, test, and expose through probes. It also means
object construction and field copying happen before rendering.

### GPU feed: mixed, not direct SoA

`ThreePresentation` loops over those snapshot objects, interpolates positions,
composes a matrix, and calls `setMatrixAt`, `setColorAt`, and the custom
emissive writer. Three.js owns the typed backing attributes and uploads the
active ranges.

The GPU data is separated by attribute—matrices, colors, emissive values, and
wall opacity are distinct streams—but each transform is a contiguous 16-float
matrix. Calling the result purely SoA would hide the more important fact: the
simulation columns are not uploaded directly and there is no reusable typed
presentation frame between simulation and Three.js.

There is also no GPU simulation, compute-driven particle system, indirect draw
pipeline, or raw WebGPU resource manager. Those would add substantial
complexity and are not justified merely by the existence of SoA pools.

## Resource lifetime and per-frame work

Lantern deliberately keeps most GPU-facing identities resident:

| Resource | Created or rebuilt | Ordinary update |
| --- | --- | --- |
| Shared geometries and materials | 3D startup | Reused |
| Dynamic instance pools | Startup or a bounded capacity change | Active matrix/color/emissive prefix uploaded |
| Surface and wall instances | Map dimension/topology change | Reused; wall opacity may change with camera/player pose |
| Pillar and authored static instances | Authored-instance hash change | Reused |
| Actors, rocks, elevators, projectiles, particles | Pool resident | Repacked from the snapshot each rendered frame |
| Resident point lights | Startup light tier | Position, color, intensity, and distance changed in place |
| TrueSight texture | Startup, fixed at `256x256` | Active mask staged and uploaded |
| Scorch geometry | Startup | Position ranges updated only when its revision changes |
| Bloom render pipeline | Startup object; optional path remains cold | Extra scene-texture/post-process work when enabled |
| Directional shadow map | Light configured at startup; backing map may allocate on first enable | Extra shadow rendering when enabled |

Dynamic instanced pools disable mesh-level frustum culling. This avoids losing a
whole pool because one combined bound is stale, but it also means Three.js does
not automatically cull individual off-screen instances. Lantern instead relies
on active-layer filtering and bounded capacities. Large authored maps may
eventually justify spatially chunked static instance pools, but that should be
driven by a capture rather than assumed now.

## Why the expensive settings can struggle

GPU cost is better approximated by this relationship than by draw calls alone:

```text
frame cost ~= CPU packing and submission
           + vertices processed across every pass
           + covered pixels x material/light cost across every pass
           + full-screen post-processing and memory bandwidth
```

The current controls affect different terms:

| Setting | Balanced/default | More expensive choice | Main cost |
| --- | ---: | ---: | --- |
| Resident lights | 16 | 32 “High”, 64 “Lab” | Larger compiled light topology and potentially more per-pixel lighting; reload required |
| DPR cap | 1.5x | 2x | `2² / 1.5² = 1.78x` as many backing pixels at the same CSS size |
| Antialiasing | On | On | Multisample storage, rasterization, and resolve cost; reload required |
| Dynamic lights | On | More active effects within the resident tier | Per-pixel light evaluation and CPU light assignment |
| Bloom | Off | On | Additional full-screen texture and post-process passes |
| Directional shadows | Off | On | An extra `1024x1024` scene pass plus shadow sampling |
| TrueSight | On | Debug additionally enabled | CPU polygon/mask work, one texture upload, shader sampling; debug adds geometry |
| Damage numbers | On | Many simultaneous events | Separate Canvas overlay and CPU projection/drawing |

The word **High** beside 32 lights is therefore easy to misread. It is not a
coordinated quality preset that adjusts the other controls. If 32 lights, 2x
DPR, bloom, and shadows are all enabled, the costs compound.

The most likely sustained GPU pressure comes from pixel density, resident light
topology, shadows, and bloom. The most likely CPU presentation pressure comes
from snapshot construction, per-frame object iteration, matrix composition,
attribute uploads, light selection, and the damage-number overlay. Those are
informed hypotheses; only a capture on the affected browser and GPU can assign
the bottleneck.

## How to tell what is slow

Render Lab's live instrument separates several signals:

- **frame ms** is the user-visible frame interval;
- **renderer CPU** is time around the presentation call, including submission;
- **present CPU** breaks out ThreePresentation update, lights, submit, and total;
- **TrueSight CPU** isolates the visibility computation;
- **GPU timing** is available only during a ten-second capture and only when the
  backend/device exposes timestamp queries;
- draw calls, triangles, active lights, resident lights, CSS resolution,
  backing resolution, and effective DPR describe the workload.

Interpret them cautiously:

- High frame and GPU time with low presentation CPU suggests a GPU/pixel,
  lighting, shadow, or post-process limit.
- High presentation update time suggests snapshot traversal, matrix building,
  CPU-side effects, or attribute preparation.
- High simulation or snapshot time is upstream of Three.js.
- A large first spike followed by recovery suggests cold shader/pipeline or
  render-target work.
- `gpuRenderMs: null` means direct GPU timing was unavailable, not that GPU time
  was zero. A browser may also queue work asynchronously, so CPU submission time
  alone cannot prove that the GPU is fast.

For a useful comparison, keep the same arena, camera, resolution, and action,
then capture ten seconds after each single change:

1. Balanced baseline: 16 lights, 1.5x DPR, AA on, bloom off, shadows off.
2. Change only resident lights to 32 and reload.
3. Return to 16 lights; change only DPR to 2x.
4. Toggle bloom alone.
5. Toggle directional shadows alone.
6. Disable dynamic lights to isolate their material-lighting contribution.
7. Compare automatic backend with forced WebGL 2 if the browser supports both.

The exported reports preserve the setting and workload facts. Comparing those
reports is more actionable than describing one mode as generally slow.

## Current strengths

- Gameplay authority never depends on GPU results or frame rate.
- Bounded instance pools and stable resident resources prevent unbounded GPU
  allocation during play.
- Instancing shares geometry and limits draw calls for the largest populations.
- Matrix, color, emissive, and dynamic-geometry buffers use explicit active
  ranges rather than rebuilding whole scene objects; the mask instead keeps one
  fixed-size texture identity.
- Light capacities, particle capacity, TrueSight texture size, shadow-map size,
  and quality settings are bounded.
- Automatic WebGPU, forced WebGL 2, and Canvas2D provide comparison and recovery
  routes.
- The ten-second report can separate simulation, snapshot, presentation CPU,
  frame, and—where supported—GPU timing.

## Pressure points and evidence-driven next steps

These are investigation candidates, not a commitment to rewrite the renderer.

1. **Name complete presets or clarify the UI.** The current “Low / Balanced /
   High / Lab” labels describe only light capacity. If users treat them as
   overall modes, introduce explicit whole-setting presets or relabel them as
   light tiers.
2. **Capture the reported slowdown.** Compare one setting at a time and inspect
   backing resolution, resident/active lights, frame p95, presentation CPU p99,
   GPU p95 when available, draws, and triangles.
3. **If CPU packing is the limit, test a presentation frame.** Keep the
   JSON-safe snapshot for probes and exports, but prototype a reusable typed
   frame consumed by both renderers. This is the existing promotion trigger for
   replacing the snapshot renderer feed; it does not require GPU simulation.
4. **If off-screen static geometry is the limit, test chunks.** Split large
   surface/wall/prop instance pools into bounded spatial chunks with stable
   rebuild rules and ordinary frustum visibility.
5. **If attribute bandwidth is the limit, narrow dirty ranges.** Static pools
   already avoid ordinary rebuilds. Dynamic pools currently republish their
   active prefixes; measurements should identify whether narrower updates or
   position/scale attributes are worth the complexity.
6. **If lights dominate, reduce topology before changing architecture.** Test
   lower resident tiers, tighter admission, emissive-only decorative sparks, or
   smaller effect-local light budgets before considering clustered or deferred
   lighting.
7. **If bloom or shadows dominate, treat them as hardware tiers.** Their extra
   passes may simply be inappropriate defaults for some devices. Warm optional
   pipelines only if first-use stalls, rather than sustained cost, are the
   measured problem.

Any promoted optimization must preserve Canvas2D/Three.js behavior boundaries,
TrueSight concealment, bounded resources, deterministic simulation, stable
replay behavior, and a real-browser WebGPU/WebGL visual and performance pass.

## Source map

- [`src/presentation/three_presentation.js`](../../src/presentation/three_presentation.js)
  owns the Three.js scene, GPU-facing resources, frame packing, rendering, and
  diagnostics.
- [`src/presentation/instanced_pool.js`](../../src/presentation/instanced_pool.js)
  owns bounded instance allocation and active upload ranges.
- [`src/presentation/true_sight_transport.js`](../../src/presentation/true_sight_transport.js)
  owns the fixed visibility texture and TSL sampling nodes.
- [`src/presentation/options.js`](../../src/presentation/options.js) defines the
  bounded URL and Render Lab settings.
- [`src/presentation/render_lab.js`](../../src/presentation/render_lab.js) shows
  live diagnostics and records ten-second reports.
- [`src/sim/pools.js`](../../src/sim/pools.js) contains the principal simulation
  SoA pools.
- [`src/sim/simulation.js`](../../src/sim/simulation.js) constructs the detached
  snapshot consumed by presentation.
- [Effect-local lighting and Render Lab](./0.3.3-render-lab-performance.md)
  defines the setting and performance-report contract.
- [3D presentation milestone](../milestones/0.3.0-3d-presentation.md) preserves
  the original implementation boundary and browser acceptance history.
