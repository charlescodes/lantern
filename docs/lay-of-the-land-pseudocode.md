# Lantern: Lay of the Land in Pseudocode

> **Descriptive snapshot:** Lantern 0.9.3 post-M1B.4 development runtime,
> snapshot/recording schema v15 and authoring-map v6.
>
> This is the control-flow companion to the [architecture review and owner's guide](./architecture-guide.md). It describes the current program, not a proposed rewrite. Names are simplified where that makes ownership clearer.

## The one-screen model

```text
PROGRAM LanternBrowserApp
    truth        := one authoritative X/Z Simulation
    clock        := FixedStepRuntime running truth at 60 Hz
    visibility   := presentation-side TrueSight derived from snapshots
    presentation := Canvas2D or Three.js
    tools        := UI + Spell Lab + Render Lab + AI View + window.__lantern

    REPEAT every browser frame
        WHILE enough fixed time is owed
            command := sample input + drain queued actions
            truth.tick(command)                    // gameplay changes here

        snapshot := truth.snapshot()               // copied read model
        sight    := visibility.update(snapshot)    // player-facing concealment
        presentation.render(snapshot, sight)       // pixels only
        tools.update(snapshot, diagnostics)
END
```

The governing direction is:

```text
input / editor / simulation probes
              |
              v
          COMMANDS
              |
              v
    AUTHORITATIVE SIMULATION
              |
              v
       COPIED SNAPSHOTS
              |
       +------+-------+-----------+
       v              v           v
    Canvas2D       Three.js     DOM tools

No render result feeds gameplay back upward.
```

Most importantly, the two kinds of sight are unrelated authorities:

```text
mob vision := simulation facing + range + GridMap line-of-sight
TrueSight  := snapshot geometry + player position + presentation flags

mob vision may change AI state
TrueSight may hide pixels and local interaction
TrueSight never gives knowledge to AI
```

## Boot and frame loop

```text
FUNCTION boot()
    simulation      := new Simulation(default scenario, schema-v15 profiles)
    initialSnapshot := simulation.snapshot()

    options   := parse renderer/backend/visual flags from URL
    flags     := new PresentationFlags(options)
    trueSight := new TrueSightSystem(flags)
    sight     := trueSight.update(initialSnapshot, alpha = 0)

    (camera, presentation) := await createPresentation(
        canvas,
        options,                 // Canvas2D default; Three.js opt-in
        initialSnapshot,
        flags,
        sight,
    )

    runtime := new FixedStepRuntime(
        simulation,
        commandProvider = input.sampleCommand,
        render = publishFrame,
    )

    connect input, UI, labs, diagnostics, and performance capture
    expose window.__lantern
    runtime.start()
    dispatch "lantern:ready"
END

ON animationFrame(now)
    elapsed := clamp(now - previousFrameTime, 0, 0.25 seconds)

    IF not paused
        accumulator += elapsed
        WHILE accumulator >= 1/60 second
            live     := canonicalize(input.sampleCommand())
            injected := drain at most 64 items from queue(capacity = 2,048)
            simulation.tick(merge(live, injected))
            accumulator -= 1/60 second

    alpha    := paused ? 0 : accumulator / (1/60 second)
    snapshot := simulation.snapshot()
    publishFrame(snapshot, alpha, runtime.metrics())
    request next animation frame
END
```

Wall-clock rendering may speed up, slow down, or stall; gameplay advances only in fixed ticks. Presentation interpolates between each body's previous and current position with `alpha`.

Code: [`src/main.js`](../src/main.js) wires the app; [`src/runtime/fixed_step_runtime.js`](../src/runtime/fixed_step_runtime.js) owns the clock, queue, snapshots, and runtime metrics.

## Authoritative state and one tick

```text
STATE Simulation
    compatibility := seed + tick + schema/profile boundaries
    authoredWorld := Scenario(compiled layers, player spawn, dynamic props,
                              one obelisk, two-stop connectors)

    entities :=
        player singleton
        bounded EnemyWizardPool
        bounded DynamicDeadBodyPool
        bounded InertDeadBodyRing     // FIFO scenery; no per-tick interaction
        bounded RockPool
        bounded ElevatorPool
        bounded ProjectilePool
        bounded SoundEventQueue      // one-tick authoritative stimuli
        bounded ParticlePool        // deterministic visuals; no gameplay effect

    infrastructure :=
        immutable-revision SpellRegistry
        navigation fields + destination cache + reachability
        deterministic map-cell broadphase
        deterministic RNG/hash lanes

    boundedHistory :=
        commands + impacts + combat + perception + sound diagnostics + contacts
END

FUNCTION Simulation.tick(rawInput)
    command := canonicalize(rawInput)
    clear the previous tick's sound queue
    clear this tick's contacts
    apply command.actions at the tick boundary

    IF defeated
        advance same-seed restart flow
        record the advancing defeated tick
        RETURN

    nextTick := tickCount + 1

    encounterSystem(nextTick)                  // bounded obelisk spawns
    IF enemy profile == investigative-wizard-v1
        investigativePerceptionSystem(nextTick) // visual/projectile sampling
    navigationSystem()                         // bounded incremental work

    preparePlayerMovement(command.move)
    prepareEnemyMovement(nextTick)
    IF enemy profile uses facing perception
        facingSystem(nextTick)
    elevatorSupportAndMotionSystem()            // acquire, step once, carry exact delta Y
    jumpSystem(command.jump, target)            // supported takeoff, committed X/Z direction
    holeRimAttractionSystem()                   // fitting grounded bodies only
    bodyPhysicsSystem()                         // normal X/Z control, pushing, per-layer grid
    verticalResolutionSystem()                  // release, hole capture, gravity, landing/handoff
    pressurePlateSystem()                       // grounded floor contacts only
    movementSoundSystem(nextTick)               // running cadence; walking is silent

    decrease cooldowns
    castPlayerSpell(command.cast)
    castEnemySpells(nextTick)
    advanceProjectiles()                        // bodies intercept; blast moves them
    deliverQueuedSounds()                       // accepted now; movement starts next tick
    settleExistingDeadBodies(nextTick)
    transferNewlyDeadEnemies(nextTick)          // AI row -> compact body row
    advanceParticles()
    regenerateHealth(nextTick)
    pruneUnreferencedSpellRevisions()

    tickCount += 1
    record canonical command
END
```

That order is gameplay behavior. Extracting a step can be structural; reordering steps is a mechanics and replay change until proven otherwise.

The entity pools are dense structure-of-arrays storage:

```text
spawn(values): append one row across typed-array columns, unless full
remove(index): copy the last active row into the hole, then shorten

stable ID travels with the copied row
pool index is temporary and must never become external identity
```

Code: [`src/sim/simulation.js`](../src/sim/simulation.js) is the crowded scheduler; [`src/sim/pools.js`](../src/sim/pools.js), [`src/sim/dead_body_pool.js`](../src/sim/dead_body_pool.js), and [`src/sim/elevator_pool.js`](../src/sim/elevator_pool.js) own bounded storage.

## Vertical bodies and elevator support

```text
FOR each eligible player/enemy/prop/body
    vertical state := worldY + velocityY + mode + layer
                      + support kind/ID + connector context + capabilities

elevatorSupportAndMotionSystem(dt):
    acquire platform contact by center/support-point and feet-plane tolerance
    step each unstoppable elevator once
    add that exact platform delta Y to every supported body

bodyPhysicsSystem(dt):
    retain normal controllers, momentum, pushing, and co-rider contacts
    query static X/Z collision from each body's own layer

verticalResolutionSystem(dt):
    after X/Z motion, detach bodies that left their support footprint
    capture swept, full-footprint hole or shaft entries
    apply bounded gravity and terminal velocity to falling/jumping bodies
    sweep downward through real elevator/floor support planes
    at every crossed floor plane:
        IF complete footprint fits that individual aperture with positive clearance
            preserve Y velocity and continue to lower plane
        ELSE land on that floor and restore grounded collision
    at an upper elevator frame, reject oversized supported loads with bounded ejection
    on floor landing, reenable low-clutter contact and bounded depenetration
    update visible map only when the player changes layer
```

An elevator never owns passenger slots, centers riders, suppresses controllers,
or changes speed for payload. Runtime Y motion and layer handoffs never modify
the authoring document. See
[`generic-vertical-bodies-and-elevator.md`](./notes/generic-vertical-bodies-and-elevator.md).

## Player movement and sound vertical

```text
FUNCTION preparePlayerMovement(RMB target)
    IF no target
        latched mode := idle
    ELSE IF latched mode == running
        keep running
    ELSE IF distance(player, target) > 0.75m
        latched mode := running
    ELSE IF latched mode == idle
        latched mode := walking

    requested velocity := zero when target is centered
                          otherwise walking ? 2.25m/s : running ? 4.5m/s : 0

    IF RMB released
        reset run cadence
END

AFTER body physics, IF mode == running
    advance cadence by control locomotion only       // never external knockback
    IF heading changed >= 120 degrees AND gate >= 12 ticks
        queue one footstep(reason = turn, radius = 8m)
    ELSE IF first 0.75m or later 1.5m stride reached
        queue one footstep(reason = stride, radius = 8m)
END

SoundEventQueue := bounded typed columns, insertion order, drop newest
default capacity := projectile capacity + one possible player footstep
diagnostic ring := separate 128 entries; never participates in delivery
```

Schema-v2 through v10 select the frozen `none` profile: every nonzero target
uses the old full speed, footsteps are absent, and Fireball hearing retains its
direct delivery path.

## Fireball and combat vertical

```text
ON successful cast(caster, target)
    definition := current Fireball revision
    effectSeed := deterministic caster-local successful-cast seed

    spawn projectile WITH
        owner identity + team
        captured spell revision
        stable effect ID + seed
        X/Z motion + collision + lifetime

    advance cooldown and cast sequence only after successful spawn
END

EACH tick FOR each projectile
    sweep X/Z path against grid/obelisk, rocks, dynamic dead bodies,
    and opposing living actors

    IF hit
        create explosion from captured spell revision
        apply grid-occluded radial impulse to nearby bodies
        apply fixed team-aware combat damage to opposing living actors
        apply impulse-only response to dynamic dead bodies
        give an unseen mob only the impact-point clue, never attacker identity
        queue the Fireball impact as a hostile 16m sound stimulus
        emit deterministic visual particles
        retain bounded diagnostics
        remove projectile
    ELSE
        advance position and age
END
```

Spell Lab affects future casts only. Existing projectiles, impacts, particles, and lights keep the revision captured at spawn.

Code: the orchestration is in [`src/sim/simulation.js`](../src/sim/simulation.js); data/validation lives in [`src/spells`](../src/spells).

## Enemy dead-body lifecycle

```text
ON enemy health exhausted after projectile processing
    remove full enemy AI/caster row immediately
    append compact dynamic body := identity + X/Z body + velocity + facing

    IF dynamic pool was full
        settle oldest body first, tie-breaking by stable ID
END

EACH tick FOR each dynamic body
    collide as a centered X/Z circle with map, actors, rocks, and bodies
    accept either team's Fireball collision and grid-occluded blast impulse

    IF age >= 180 ticks
        settle(reason = timeout)
    ELSE IF fall finished AND quiet for 30 uninterrupted ticks
        settle(reason = quiet)
END

FUNCTION settle(body, reason)
    append cold fields to inert FIFO ring
    overwrite oldest inert row when the ring is full
    swap-remove dynamic row
END

inert bodies are snapshot scenery only; no simulation system queries them
```

The fall is presentation state derived from age and facing. Three.js tilts the
resident cylinder while Canvas2D grows an oriented capsule; neither changes the
authoritative circle. See the [checkpoint contract](./notes/enemy-dead-body-lifecycle.md).

## Perceptive wizard vertical

```text
STATE per mob
    identity + spawn sequence
    facing + personal guard point
    state := unaware | noticing | engaged | hunting | returning
    candidate exposure
    personal last-seen player position/velocity/tick
    optional impact-point clue
    hunt/search goal + timers
    navigation + strafe + dodge + retreat state
END

ON this mob's staggered perception lane
    visible :=
        within 12m
        AND (inside 120-degree facing cone OR within 1.5m close radius)
        AND unobstructed by GridMap

    IF visible
        start/continue noticing
        IF exposure has remained qualified for 15 simulation ticks
            engage
        IF engaged
            refresh personal last-seen memory
    ELSE
        cancel noticing
        IF previously engaged
            stop firing and hunt the personal last-seen point
END

FUNCTION chooseMovement(mob)
    IF dodging a visible projectile threat
        dodge                                  // highest movement overlay
    ELSE IF low-health retreat is active
        move away from visible/memorized threat
    ELSE SWITCH mob.state
        engaged:  approach beyond 9m; withdraw inside 6m; otherwise strafe
        hunting:  visit memory/clue, then search reachable cells for 8 seconds
        returning: navigate to personal guard point
        otherwise: hold guard and sweep facing
END

FUNCTION maybeCast(mob)
    REQUIRE engaged, not retreating, and cooldown/cadence ready
    REQUIRE a fresh same-tick cone/range/GridMap sight check
    cast through the player's Fireball registry using softened intercept aim
END
```

Rocks, darkness, lights, particles, Three.js meshes, and TrueSight do not participate in `visible`. Low-level deterministic calculations live in [`src/sim/perceptive_wizard.js`](../src/sim/perceptive_wizard.js) and [`src/sim/tactical_wizard.js`](../src/sim/tactical_wizard.js); their lifecycle is still orchestrated by `Simulation`.

## Snapshot, TrueSight, and presentation

```text
FUNCTION publishFrame(snapshot, alpha, metrics)
    sight := TrueSight.update(snapshot, alpha, mode)
        cache wall topology until map changes
        interpolate player position as the origin
        cast deterministic corner rays
        build polygon and shared byte mask
        apply presentation-only reveal/conceal fade

    gate hover and stable selection through logical sight
    presentation.render(snapshot, alpha, sight + local view state)
    AI View, UI, Spell Lab, and Render Lab update from read-only data
END

IF Canvas2D
    draw snapshot directly
    draw shared sight mask as world-space void overlay
    remain the regression/oracle renderer

IF Three.js
    copy snapshot rows into preallocated scene resources
    use Y only for visual height over authoritative X/Z
    upload the same sight mask through a resident texture
    update resident effect lights and optional bloom/shadows
    submit scene
```

Neither renderer owns collision bodies, health, AI state, or alternate entity IDs.

Code: [`src/visibility/true_sight.js`](../src/visibility/true_sight.js), [`src/presentation/canvas_presentation.js`](../src/presentation/canvas_presentation.js), and [`src/presentation/three_presentation.js`](../src/presentation/three_presentation.js).

## Mutation, observation, and replay

```text
IF a host action changes simulation truth
    enqueue canonical command -> consume on fixed tick -> record for replay
    // movement, casts, resets, editing, spell revisions, simulation flags

IF a host action only reads
    return copied snapshot or read-only diagnostics
    // metrics, queries, enemy/spell diagnostics

IF a host action changes only the view
    mutate presentation state without a simulation command
    // camera, renderer flags, pixel density, Render Lab, AI View mode
```

```text
FUNCTION exportCommandLog()
    RETURN deepCopy(
        schema + seed + initial scenario
        capacities + behavior profiles + spell baseline
        canonical tick commands + truncation flag
    )
END

FUNCTION Simulation.replay(recording)
    validate schema v2..v11
    choose its frozen behavior profile:
        v2-v4 legacy effects
        v5    versioned Fireball / pre-combat
        v6    basic wizard
        v7    omniscient tactical wizard
        v8    perceptive wizard + v8 scaling metadata
        v9    investigative wizard, no dead bodies, no movement sounds
        v10   investigative wizard + dead bodies, no movement sounds
        v11   proximity walking + queued footsteps/Fireball sounds

    replayed := new Simulation(recorded initial state)
    FOR command IN recording.commands
        replayed.tick(command)
    RETURN replayed
END
```

Enemy choices are regenerated from authoritative state, stable identities, deterministic lanes, and tick order. They are not recorded as synthetic player input.

## Reading route

```text
src/main.js
    -> composition and browser-facing authority routing

src/runtime/fixed_step_runtime.js
    -> command queue, fixed clock, snapshots, publish

src/sim/simulation.js
    -> current schedule and cross-system orchestration
       -> pools.js
       -> dead_body_pool.js
       -> collision.js + explosion.js
       -> perceptive_wizard.js + tactical_wizard.js
       -> navigation_field.js + destination_field_cache.js
       -> ../spells/spell_registry.js + fireball_definition.js

snapshot
    -> visibility/true_sight.js
    -> presentation/factory.js
       -> CanvasPresentation | ThreePresentation
    -> browser UI + labs + AI View

test/*.test.js
    -> executable contracts for determinism, compatibility, parity, and bounds
```

If one sentence must survive the rest of the document:

> Lantern is a deterministic, fixed-tick X/Z game simulation that publishes copied snapshots to replaceable browser presentations; `Simulation` is currently the crowded scheduler holding that boundary together.
