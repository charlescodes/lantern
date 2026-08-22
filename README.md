# Lantern 0.9.0 / Fireball Investigation AI

A browser-first fixed-step X/Z combat simulation with replay-safe shared Fireball authoring, proximity walking, anonymous running footsteps, one scenario-authored obelisk, enemy wizards that investigate hostile sounds and projectiles, and bounded dead bodies that remain physical briefly before becoming inert scenery. The live pool is sized for 64 enemies while the authored encounter still caps at four alive. Canvas2D remains the regression presentation; an opt-in Three.js 3D vertical consumes the same read-only snapshots, spell table, health state, AI diagnostics, body state, and TrueSight frame. The application boots into a clean, full-viewport playtest mode with the camera locked smoothly to the player's local render pose; press `;` to toggle the developer toolbox.

## Run

```bash
npm start
```

The server prints clickable links for Canvas2D, automatic 3D, and forced WebGL 2. Development requires Node.js 20+ and a modern desktop browser.

To expose the development build to phones and other devices on a trusted LAN:

```bash
npm start -- --host 0.0.0.0
npm start -- --host 0.0.0.0 --port 5000
```

The server enumerates non-loopback IPv4 addresses and prints phone-ready routes. It has no authentication: do not expose it to an untrusted network. Each connected device runs its own local simulation; this is presentation testing, not multiplayer state hosting. Existing `HOST` and `PORT` environment variables remain supported.

Three.js `0.184.0` is the single pinned runtime dependency. `npm install` restores it from `package-lock.json`.

Presentation routes:

- <http://127.0.0.1:4173/?renderer=2d> — Canvas2D, also the default.
- <http://127.0.0.1:4173/?renderer=3d> — Three.js with automatic WebGPU/WebGL 2 selection.
- <http://127.0.0.1:4173/?renderer=3d&backend=webgl> — forced WebGL 2 fallback test.

The Balanced defaults are 16 resident lights, a 1.5× pixel-density cap, antialiasing on, automatic backend selection, dynamic lights, spell-color variation, TrueSight, and sight fading on; bloom, shadows, and sight debug are off. URL options are `lights=8|16|32|64`, `dpr=1|1.5|2`, `aa=0|1`, `dynamicLights=0|1`, `lightColorVariation=0|1`, `bloom=0|1`, `shadows=0|1`, `trueSight=0|1`, `sightFade=0|1`, and `sightDebug=0|1`. The compatibility URL/probe key remains `lightColorVariation`; the UI labels it **Spell color variation**.

## Validate

```bash
npm test
npm run check
npm run test:soak
npm run test:soak:sight
npm run test:soak:spell
npm run test:soak:combat
npm run test:soak:dead-bodies
npm run test:soak:ai
npm run test:soak:perception
npm run test:soak:sound
```

The browser-only 50-mob production-adapter fixture is available at
<http://127.0.0.1:4173/test/browser/perception_stress.html?renderer=2d> after
starting the development server. It adds no gameplay command or simulation
mutation probe.

## Documentation

Start with the [documentation index](./docs/README.md). It separates mutable [soft specifications](./docs/soft-specs/README.md) from the durable [platform contract](./docs/platform.md), chronological milestone contracts, and regression notes. Release `0.9.0` remains the [Fireball Investigation AI](./docs/milestones/0.9.0-fireball-investigation-ai.md) boundary. The current non-release [M1A.1–M1A.4 authoring kit](./docs/notes/map-authoring-foundation.md) now emits authoring-map v4 with map-level connectors and painted floor holes, while [M1B.1–M1B.2](./docs/notes/generic-vertical-bodies-and-elevator.md) adds continuous gameplay Y, per-body support/layer state, elevators, and multi-floor falling without changing snapshot/recording schema v11. Authoring-map v3/v2/v1, legacy scenario v3, and map v1 remain loadable; scenario v3 remains the recording compatibility projection, and Fireball definition v1 is unchanged. Schemas v2-v10 retain their frozen behavior.

## Playtest controls and developer toolbox

- Begin an RMB hold inside the invisible `0.75m`-radius circle around the player to walk silently at `2.25m/s`. From the center of a one-meter tile, this reaches into all eight neighboring tiles. Crossing outside that circle promotes the held gesture to a `4.5m/s` run; returning inside does not restore walking until RMB is released and pressed near the player again. Release RMB to brake.
- Press LMB to cast the selected spell; Fireball is the only handler. Fireballs explode on the first opposing actor, dynamic enemy body, wall, rock, or obelisk they hit and pass through same-team living actors.
- Press `;` to reveal or hide the developer toolbox. The top controls, right-side instruments, bottom coordinate/help rail, authoring windows, debug overlays, and developer shortcuts remain behind this presentation-only gate. Closing the toolbox while editing returns to play mode.
- Open **Spell Lab** from the toolbox while moving and casting. **Recast last target** uses the normal cooldown. **Lock seed** makes both LMB and Recast use the visible hexadecimal variation seed. **Collapse** removes the window from the arena and returns its launcher to the toolbox.
- While the toolbox is open, press `Space` to pause, `.` to pause and advance one tick, `R` to reset the current seed, and `Shift+R` to choose a new seed.
- While the toolbox is open, press `E` to enter the paused scenario editor. Leaving edit mode restores the previous paused/running state; `F` recenters its free camera on the player.
- Use the wheel to zoom. Play zoom stays centered on the player and MMB cannot detach the camera. In edit mode, wheel zoom remains cursor-anchored and MMB drag pans. Toolbox-open hover inspects transiently, and click pins or unpins an entity by stable ID.
- Use **Spark walls** to bypass or enable particle/map sweeps. **Ground bounce** defaults on and independently controls the single ground rebound.
- At zero health, movement and casting freeze for 90 fixed ticks (1.5 seconds), then the same seed restarts automatically. Reset and Spell Lab actions remain available during defeat.

## Spatial units and resolution

Simulation truth uses meters, seconds, and kilograms. Player, enemy, and eligible dynamic-prop world Y is now authoritative fixed-step state alongside continuous X/Z; gravity and floor/elevator supports remain a deliberately limited 2.5D model rather than general 3D rigid-body physics. The static collision map is a separate `1m × 1m` occupancy grid; entities move continuously across it rather than becoming cell-locked bodies.

Both presentation cameras store a visible world height, defaulting to `24m` with a `4-64m` zoom range. During play, their ground target is updated every rendered frame from the same local fixed-tick pose used to draw the player, with no spring, prediction, or network buffer. Edit mode retains a free camera. World-to-viewport scale is derived from the current canvas bounds, so window size and device-pixel ratio do not alter simulation scale. The 3D camera uses 45 degree yaw and 55 degree downward pitch; pointer rays intersect `Y=0`, preserving X/Z commands for movement, casting, editing, and selection. Canvas backing pixels, fixed-screen debug strokes, text size, and pointer click tolerance remain isolated presentation concerns.

There is no component-mask or ECS dispatch layer yet. Systems explicitly process the player and bounded typed-array pools. A future lighting field should declare its own metric cell size and consume explicit light/occluder data; it should not inherit either the collision grid resolution or the canvas raster resolution.

## Scenario editor

Press `;`, then `E` to open the generated map palette, inspector, and Layers panel. Its catalog currently provides stone, moss, and single-cell hole surfaces, walls, three existing movable-rock sizes, a blocking pillar, a standing torch, a pushable table, and a two-stop elevator connector. Paint definitions drag across cells; stamp definitions place once. LMB applies the selection and RMB or **Erase** follows the active channel. Invalid placements over a wall, the player, an enemy, or another authored/active body are rejected. Layers can be created above/below, renamed, assigned signed base heights, and viewed through one non-editable reference overlay.

New saves emit `lantern-authoring-map` v4 with metadata, an explicit player-start layer, independently compiled named floors, separate surface/structure grids, stable layer/instance IDs, signed base heights, layer-owned markers, independent floor apertures, and one map-level connector collection. The default obelisk occupies cell `(20, 18)` at `(20.5, 18.5)`; its structure and marker are protected from editor erasure. Authoring-map v3/v2/v1, legacy map v1, and scenario v2/v3 JSON migrate explicitly and resave in v4. Entering edit pauses the live simulation on the player’s current floor; authoring changes recompile and reconcile only affected authored content, while **Restore positions**, reset, and load/import explicitly reconstruct authored body/elevator starts. The singleton obelisk is map-owned and always spawns its encounter on its authored layer. Save exports authored transforms, so runtime pushing, falling, elevator travel, and body layer transitions never rewrite them.

For the M1B.1 fixture, start a route with `?arena=elevator` (or `?arena=elevator&renderer=3d`). It contains two floors, a fitting prop and lit torch, an enemy, and an oversized table. The occupancy-controlled lift carries any supported capable body without centering or locking X/Z control; the console probes `__lantern.elevators()`, `__lantern.verticalBody(kind, id)`, `__lantern.cycleElevator(id)`, and `__lantern.summonElevator(id, stop)` expose and drive deterministic diagnostics.

## Spell Lab

Spell Lab starts parked in the developer toolbox. Opening it creates a non-modal arena overlay and a bottom drawer on narrow screens; collapsing it removes the overlay and restores the toolbox launcher. It edits a validated complete Fireball definition v1 draft. Numeric fields pair a range control with an exact numeric input; collapsible sections cover essentials, projectile motion, distribution, lifecycle, collision, palette, emissive response, and lighting. The visible formulas explain the size-linked lifetime and lower-biased vertical sample.

Its primary purpose is developer-side effect tuning. Player and enemy wizards cast from the same applied Fireball registry and current definition; Apply affects future casts from either side, while every existing effect retains its captured revision. Revision numbers remain runtime bookkeeping, not a player-facing version-management feature. Combat damage is a fixed shared rule and is intentionally not authorable in Fireball definition v1.

**Apply** creates a monotonically numbered immutable revision for future casts only. Existing projectiles, impacts, particles, colors, collision responses, and light leases continue resolving through the revision captured when that cast spawned. **Revert to applied** discards draft edits; **Reset draft to defaults** changes only the draft. Import replaces the draft and never applies it. Apply, Copy, and Download remain unavailable until the complete document validates. A reset preserves the applied definition and the panel draft, while a browser reload returns to built-in defaults because no Spell Lab state is written to the URL or local storage.

Player automatic variation seeds remain stable 32-bit hashes of simulation seed, spell code, and the player's successful-cast sequence. Enemy seeds use a separate domain containing stable spawn sequence and that enemy's successful-cast sequence, so enemy activity cannot perturb player fixtures or Spell Lab preview seeds. Rejected casts do not advance a sequence. **Clear active effects** removes Fireball projectiles, sparks, retained impact visuals, and their presentation light leases; physical impulses already applied to bodies are not reversed.

The authoritative definition format, limits, replay boundary, and extension seam are in the [0.5.0 Spell Lab milestone](./docs/milestones/0.5.0-spell-lab.md).

## TrueSight

TrueSight derives a player-centered, 360-degree visibility polygon from the current interpolated X/Z position and the loaded grid map. Solid wall cells, including the obelisk cell, block sight; the camera, rocks, particles, and fireballs do not. Visibility has no range cutoff and no remembered exploration. Edit mode reveals the complete map immediately.

The hard logical mask gates hover, pin presentation, inspector details, enemy meshes and health bars, and every hostile Fireball mesh, particle, emissive response, and light. Raw `queryAt`, casting, projectiles, explosions, damage, recoil, collision, AI knowledge, recordings, and replay remain unrestricted. A hidden pinned entity keeps its stable pin and reappears when visible. The display mask reveals over 100 ms and conceals over 150 ms, with immediate snaps for resets, map changes, timeline rollback, movement jumps over two meters, and edit-mode transitions.

Canvas2D draws the shared byte mask as a world-space void overlay. Three.js uploads the same mask as a resident red `DataTexture` and applies it to world node materials, shadow masks, emissive geometry before bloom, and dynamic-light intensity. The 24m arena uses a `192×192` mask; larger maps uniformly reduce resolution to stay within `256×256`. See the [0.4.0 TrueSight contract](./docs/notes/0.4.0-true-sight.md).

## AI View

Open **AI View** for a read-only tactical diagnostics window. **Off** clears only the debug drawing, **Selected mob** follows one stable `kind:id` chosen from the selector or an arena pin, and **All mobs** prints and draws the state of every living AI mob. AI continues running in every mode; the panel never enables, disables, pauses, or otherwise mutates a mob.

The shared overlay shows the 6–9m engagement band, the selected mob's `120°`/`12m` perception cone and `1.5m` close-awareness circle, facing, exposure progress, target, investigation source and priority, recent sound origins, `8m` footstep and `16m` Fireball hearing radii, projectile observation and reverse-trajectory origin, search goal, guard point, movement, aim, navigation, threat, dodge, and retreat state. It explicitly distinguishes **player sight** through TrueSight from **mob vision** in the simulation. The overlay is drawn over either Canvas2D or Three.js and intentionally remains visible through TrueSight so hidden decisions can be inspected. That visibility is debug-only and supplies no simulation or AI knowledge. `window.__lantern.aiView()` reports the UI state, while `setAiView("off" | "selected" | "all", id?, kind?)` changes only the view. See the [AI View diagnostic contract](./docs/notes/ai-view.md).

## Physics model

Player and enemy wizards each have a `0.3m` radius, `75kg` mass, the same movement fundamentals, and `100` maximum health. Health regenerates at `1 HP/s` after five damage-free seconds. Direct opposing Fireball hits deal `25`; splash deals `25 × clamp(1 - surfaceDistance / capturedBlastRadius, 0, 1)`. Walls and the obelisk block splash. Casters and allies are immune to health damage, while the existing blast impulse remains team-neutral.

Player running uses a deterministic distance cadence: the first footstep after `0.75m`, then every `1.5m`; a heading change of at least `120°` can emit the same event behind a 12-tick gate. Turn emission wins over stride emission, so there is at most one footstep per tick. Walking, release braking, and external velocity are silent. Footsteps are authoritative `8m` AI stimuli only—this checkpoint adds no WebAudio or enemy footsteps.

On death, an enemy immediately leaves every AI and caster loop and transfers its stable identity, X/Z circle, last facing, mass, and post-impact velocity into a 16-entry dynamic dead-body pool. Dynamic bodies collide with the map, actors, rocks, one another, and either team's Fireballs. Their visual cylinder falls toward last facing over 36 ticks, but authoritative collision remains the centered `0.3m` circle. After the fall, 30 uninterrupted quiet ticks settle a body; 180 ticks is the hard ceiling. A full dynamic pool settles its oldest body early.

Settled bodies enter a 100-entry typed FIFO ring and become entirely inert: no collision, projectiles, blasts, placement checks, AI, or per-tick simulation work. New entries overwrite the oldest when full. Supported replay-pinned tuning ranges are 1-64 dynamic and 1-1,000 inert. Schema v10 owns this lifecycle; schemas v2-v9 force it off. See the [dead-body checkpoint](./docs/notes/enemy-dead-body-lifecycle.md).

The default encounter spawns one enemy on fixed tick 1, attempts another every 1,800 ticks (30 seconds), caps at four alive, and never queues capped or blocked attempts. It rotates deterministically through north, east, south, west, northeast, southeast, southwest, and northwest cells around the obelisk.

Live `investigative-wizard-v1` enemies sample geometry-only vision at `12Hz` across five spawn-sequence lanes. A target or hostile Fireball must be within `12m`, inside a `120°` facing cone (or the `1.5m` 360-degree close radius), and unobstructed by the grid. Walls and the obelisk occlude; rocks, lighting, darkness, TrueSight, particles, and rendering do not. Fifteen uninterrupted ticks of qualifying player samples confirm the player, but one Fireball observation is sufficient to reconstruct its clamped launch point from authoritative position, velocity, and age. Facing turns at no more than `180°/s`; an unaware guard sweeps `±45°` around its base heading over six seconds.

Confirmed enemies keep personal last-seen position, velocity, and tick. Lost sight stops casting immediately, sends the mob to that point, then starts an exact eight-second deterministic search across reachable radius-1 through radius-3 cells. Search completion returns the mob to its guard point and clears memory. An unreachable guard must remain proven unreachable for 12 seconds before it is rebased. Evidence priority is current direct sight, seen Fireball trajectory, stored last-seen player position, personal damage, then hostile sound: a running footstep within an inclusive `8m` or a Fireball impact within `16m`. Projectile and sound clues remain anonymous, never advance player exposure, and never permit firing at an inferred or heard position. Lower-priority evidence cannot redirect stronger behavior; a newer clue at the same priority can. Knowledge is never shared between mobs. The bounded one-tick sound queue ignores walls, rocks, darkness, and TrueSight; surface acoustics, enemy footsteps, audible player feedback, squad knowledge, co-op target policy, and friendly/critter perception remain deferred.

While engaged, the 0.7 tactics remain intact: approach beyond `9m`, withdraw inside `6m`, strafe at `3.5m/s`, softened intercept aim, visible-projectile dodge, and low-health retreat. Casting requires engaged state, no retreat, and a fresh same-tick perception check; enemies never fire at remembered coordinates. Dodge and retreat are movement overlays, so perception and search clocks continue underneath them. All choices use stable enemy-local named hash lanes rather than global RNG or presentation state.

Schema-v11 navigation keeps the schema-v10 four pinned future actor-target slots and 64 shared goal-cell fields, one preallocated builder, stable slot order, and a global 2,048-expansion tick budget. A completed field is retained while its replacement builds, but movement uses direct wall-sliding until the requested field is current. The preallocated map-cell broadphase also indexes dynamic dead bodies and sound listeners for deterministic queries. Schema-v10 retains the same AI and bodies with full-speed silent player movement and direct Fireball hearing; schema-v9 investigative behavior remains frozen without bodies; schema-v8 scheduling and `perceptive-wizard-v1` replay remain frozen; schema-v7 keeps the omniscient `tactical-wizard-v1`, and schema-v6 keeps `basic-wizard-v1` and its intentional lack of pathfinding, strafing, leading, dodging, or healing retreat.

Rock mass is derived from a 2,600 kg/m3 stone density and spherical volume: about 10.9 kg at 0.1m radius, 294 kg at 0.3m, and 7,940 kg at 0.9m. Rocks collide with walls, actors, and one another.

Player velocity remains split between control-driven locomotion and damped external momentum. Player/rock contact now resolves genuine body or external momentum through the external channel, while controller-driven closure reacts through locomotion with zero restitution. This prevents held movement against a heavy rock from storing delayed recoil without suppressing real impact knockback. See the [dynamic-contact velocity-channel regression contract](./docs/notes/dynamic-contact-velocity-channels.md).

The default Fireball explosion applies an instantaneous, radial impulse to bodies within 2.5m using an 800 N·s/m² pressure budget. Both values are authorable simulation fields. Surface-distance falloff, projected body area, and mass determine velocity change. Solid map cells completely block the impulse ray.

The visual spark shower remains presentation-only. Spark centers sweep against solid map cells and map boundaries and ignore the player, rocks, other particles, and gameplay force. Walls are infinitely tall for this X/Z test; particle Y does not bypass them. Wall response retains 80% of normal speed and 95% of tangential speed.

The built-in Fireball default still samples maximum spark size from `0.025-0.085m` and seeded lifetime from `0.18-1.10s`, so larger embers persist longer while every visible radius shrinks smoothly toward zero. A lower-biased vertical distribution sends roughly 60% of a full burst to the ground. The first default ground contact retains 45% vertical and 82% horizontal speed; the next contact settles the ember at `Y=0`, where it slows and remains visible until its assigned lifetime expires. Schema-v5 effects use the collision and lifecycle values captured with their definition revision; schema-v2/v3/v4 replay stays on the frozen legacy paths.

See [0.1.0 blast physics](./docs/milestones/0.1.0-blast-physics.md) for the force model, [0.2.0 particle collision](./docs/milestones/0.2.0-particle-collision.md) for wall behavior, and [0.2.5 particle lifecycle](./docs/milestones/0.2.5-particle-lifecycle.md) for size-linked lifetime behavior.

## 3D presentation vertical

The opt-in 3D route renders a floor, 2.5m instanced wall cells, a procedural obelisk, preallocated player/enemy silhouettes and health tracks, low-poly rocks, chest-height fireballs, and one instanced spark mesh using existing particle `x/y/z` and `currentSize` values. All 64 enemy instances, 64 front-facing hood/nose markers, 65 `0.10m × 0.90m` health tracks/fills, and the configured 116 default dead-body instances exist before renderer warmup. Dead bodies reuse the cylinder geometry with a darker material and a shared fall pose; Canvas2D renders the same pose as an oriented capsule. Both share TrueSight concealment and add no light. The default light pool still contains 16 resident, shadowless point lights: two atomic eight-slot effect groups.

Particles associate presentation-side with their captured effect identity; legacy/direct fixtures retain the nearest-impact and deterministic orphan fallbacks. Projectile, spark, impact, and light colors use one allocation-free palette sampler. The `lightColorVariation` compatibility switch is the global A/B master for per-cast and per-particle variation across both renderers and light assignments.

Dynamic lights, emissive energy, bloom response, and color are visual-only. They cannot affect AI, visibility, collision, damage, replay, or command authority. Projectile and particle color/emissive attributes are preallocated at full pool capacity before warmup; applying a definition updates resident bytes without replacing geometry, materials, nodes, buffers, pipelines, or the eight-slot light-group topology. Bloom and directional shadows default off. See the [0.3.0 3D presentation contract](./docs/milestones/0.3.0-3d-presentation.md), [renderer regression notes](./docs/notes/0.3.0-renderer-regressions.md), [0.3.2 spark-light affinity regression](./docs/notes/0.3.2-spark-light-affinity.md), and [0.3.3 Render Lab/performance note](./docs/notes/0.3.3-render-lab-performance.md). Canvas2D remains the default regression route.

## Render Lab and capture

Open **Render Lab** before, during, or after renderer warmup. Renderer, backend, resident-light capacity, and antialiasing are startup topology and show **reload required** when changed. Pixel-density cap, dynamic lights, Spell color variation, bloom, directional shadows, TrueSight, sight fading, and sight debug apply live. Settings persist only through the visible URL; Lantern does not keep a second `localStorage` configuration.

The developer pool instruments report dynamic/inert body and sound-event occupancy plus settlement, overwrite, and sound-drop counters. Render Lab reports backend, CSS/backing resolution, effective DPR, active/resident lights, frame and CPU timing, TrueSight geometry/mask/timing, and GPU timestamp availability. **Capture 10 seconds** resets timing histories without scripting gameplay. Performance-report v4 retains the v3 body and v2 TrueSight fields and adds sound capacity, maximum per-tick occupancy, drops, and emitted/heard footstep and Fireball-impact counts to the browser/device, workload, presentation, light, spike, and GPU data.

## Snapshots and recordings

Snapshots, runtime metrics, and command recordings use schema v11. Scenario JSON uses v3. Player snapshots add movement mode, target distance, and run cadence. Enemy snapshots retain the perception, investigation, navigation, tactical, combat, and dead-body records, with accepted sound event/kind/radius when applicable. The one-tick sound queue and newest 32 of a separate 128-entry diagnostic ring expose stable source/event identity, origin, radius, and bounded occupancy/drop/hearing counters. The compact `spells` table still includes only current and referenced immutable revisions; effects retain spell code, definition revision, effect ID, and effect seed.

A live v11 recording stores `gameplayProfile: "obelisk-duel-v1"`, `enemyAiProfile: "investigative-wizard-v1"`, `enemyCapacity: 64`, `encounterMaximumAlive: 4`, `deadBodyProfile: "enemy-dead-body-v1"`, `movementSoundProfile: "proximity-walk-footsteps-v1"`, both body capacities, and the sound-event capacity alongside the spell baseline. Replay reconstructs movement cadence, hearing, AI, dynamic-body physics, settlement, and FIFO overwrites exactly; autonomous decisions and transitions are not synthetic input commands. Schema v10 retains AI and bodies but forces full-speed silent movement and direct Fireball hearing, schema v9 retains investigative AI with corpse-free immediate removal, schema v8 selects the frozen `perceptive-wizard-v1`, schema v7 selects the frozen `tactical-wizard-v1` with its historical four-entry enemy pool, schema v6 selects frozen `basic-wizard-v1`, schema v5 keeps versioned Fireballs with frozen pre-combat behavior, and schemas v2 through v4 retain their existing legacy Fireball and particle profiles. The default projectile pool is 256 and sound queue is 257; bounded drops remain valid under excessive authored effects or deliberately reduced tuning capacities.

Particle snapshots retain maximum `size` and expose derived `currentSize`. Inspector output uses the current radius and reports its maximum separately. Pool telemetry exposes cumulative wall bounces, ground bounces, and collision-safety discards without copying particle impacts into the main contact history.

## Runtime boundary

`src/sim` has no DOM, Canvas, or Three.js dependencies. Browser input and probe mutations become commands consumed at fixed-tick boundaries. Canvas2D, Three.js, and DOM panels consume copied JSON-safe snapshots and do not mutate simulation state.

The automation surface at `window.__lantern` supports pause/resume/step/reset, snapshots and metrics, spatial queries, tile edits, scenario save/load, rock archetype queries and placement/removal, authored-state restore, command injection/export, and debug flags including `particleWallCollision`. `encounterDiagnostics()` includes bounded destination-cache/build telemetry and summarized mob state; `enemyDiagnostics(id?)` returns the read-only perception, memory, navigation, tactical, and event record for every enemy or one stable ID. `aiView()` reports the read-only debug-window state, and `setAiView(mode, id?, kind?)` selects only its Off/Selected/All presentation. Spell probes are `listSpells()`, `getSpellDefinition(id)`, `applySpellDefinition(id, definition, expectedRevision?)`, `castSpell(id, x, z, options?)`, `clearSpellEffects(id)`, and `spellDiagnostics(id)`. Invalid definitions and probe arguments return structured errors rather than being clamped. `trueSight()` returns JSON-safe origin, polygon, mask, ray, wall, flag, snap, and timing diagnostics. `isVisible(x, z, radius = 0)` queries the current hard logical mask.

`window.__lantern.presentation()` reports renderer/backend, resolution, effective DPR, warmup duration, effect groups, active/resident lights, draw counts, cached presentation and TrueSight timings, recent 32 ms spikes, GPU timing availability, snapshot timing, render CPU timing, and visual flags. Runtime metrics include raw frame spacing plus clamp/discard totals. `resetPerformanceMetrics()` clears runtime, presentation, and TrueSight timing histories. `setPixelDensityCap(value)` applies `1`, `1.5`, or `2` live; `setPresentationFlag(name, value)` accepts the lighting flags plus `trueSight`, `sightFade`, and `sightDebug` without adding simulation commands.

`capturePerformance()` and its alias `startPerformanceCapture()` return the asynchronous ten-second report. `latestPerformanceReport()` and `performanceReport()` return the latest completed report or `null`.
