# Candidate Feature Roadmap

| Field | Value |
| --- | --- |
| Status | Working draft |
| Authority | Non-authoritative soft specification |
| Last reviewed | 2026-08-04 |
| Scheduling | No dates, release numbers, or commitments |
| Parent direction | [Emergent co-op simulation north star](./emergent-coop-simulation.md) |

This roadmap is a sequence of experiments, not a backlog that must be completed in full. Each slice should create a playable result and prove one or two reusable seams. The next plan may reorder, split, replace, or retire any candidate after inspecting the live tree.

## Roadmap principles

- Promote one story at a time.
- Generalize from a second real use, not an imagined catalog of future uses.
- Extract only the part of `Simulation` or a pool that the story needs; avoid a broad framework precondition.
- Give every authoritative feature a command/mutation path, bounded state/work, deterministic order, snapshot or diagnostic view, replay decision, and test.
- Keep visual polish and human GPU/feel acceptance explicit but separate from simulation correctness.
- Record architectural lessons after each slice and revise this roadmap.

## Candidate sequence

### 1. Player-controlled movable bookshelf

**Playable result:** The player can acquire, translate, rotate, and release one bookshelf. It collides and occludes while moving; after settling it changes navigation topology. Recording and replay reproduce the manipulation.

**Seams tested:** stable prop identity, oriented body geometry, telekinesis command/state, dynamic occlusion, navigation overlay revisions, snapshot/presentation parity.

**Keep deliberately narrow:** one authored prop shape, one manipulation ability, one deterministic placement/release policy. Do not begin with a general inventory, construction, or rigid-body framework.

**Acceptance seed:** A shelf placed lengthwise across a two-cell passage prevents body traversal and Fireball line of effect, hides a target behind it from simulation sight, and causes a navigator to use a valid alternate route after the topology update.

### 2. Enchanted rat reuses the bookshelf

**Playable result:** A rat-wizard specialist can choose from a bounded set of useful shelf poses and manipulate the same prop through the same authoritative action path as the player.

**Seams tested:** sensors, personal knowledge, affordance discovery, deterministic candidate generation/scoring, action reservation, failure fallback, AI diagnostics.

**Keep deliberately narrow:** a few authored candidate poses near a relevant corridor or threat line. No unrestricted symbolic planner.

**Acceptance seed:** Given the same seed and observations, the rat chooses the same legal placement; if the shelf is unavailable or movement fails, it times out and selects a deterministic fallback without blocking the tick.

### 3. Footwear, surfaces, sound, and investigation

**Playable result:** Boots and bare feet make measurably different sounds on tile and rug; a hearing-capable guard investigates an audible origin without gaining perfect actor identity.

**Seams tested:** surface registry/layer, equipment state, bounded noise facts, hearing sensor, observation uncertainty, personal memory, investigation behavior.

**Keep deliberately narrow:** two footwear states, two surfaces, one sound type, one hearing profile, and no voice/squad communication.

**Acceptance seed:** A fixed movement trace produces deterministic noise events. The guard investigates boots-on-tile inside its hearing conditions but ignores or loses a barefoot-on-rug trace below threshold.

### 4. First elemental contact: water, metal, and lightning

**Playable result:** A bounded water representation and conductive equipment modify an electrical effect using explicit tags and reactions.

**Seams tested:** environmental field storage, material/equipment tags, typed damage, reaction ordering, field snapshots/diagnostics, replay serialization.

**Keep deliberately narrow:** one water state, one conductive equipment tag, one electrical effect, and no general chemistry system.

**Acceptance seed:** The same electrical hit resolves differently for dry/nonconductive and wet/conductive fixtures according to a documented rule, with deterministic ordering and no renderer dependency.

### 5. Second elemental contact: oil, fire, and water

**Playable result:** Oil ignites within a fixed propagation budget and water cools or extinguishes affected cells. Actors recognize persistent dangerous cells as hazards.

**Seams tested:** multiple field interaction, bounded propagation queue, reaction priority, hazard observation, temporary navigation cost, overload telemetry.

**Keep deliberately narrow:** one fuel field, one fire field, one extinguish operation, conservative limits, and no attempt to simulate fluids physically.

**Acceptance seed:** A golden fixture records ignition, bounded spread, extinguishing, damage/hazard output, and queue-overflow behavior exactly.

### 6. Common actor foundation with one new archetype

**Playable result:** Add a genuinely different actor—likely a simple melee creature—without duplicating identity, transform, collision, health, team, targeting, snapshot, and replay rules.

**Seams tested:** common actor tables, optional capabilities, capability routing, heterogeneous broadphase/targeting, lifecycle helpers, presentation dispatch.

**Keep deliberately narrow:** extract only common facts demonstrated by the wizard and new archetype. Do not require a universal ECS or migrate every entity kind.

**Acceptance seed:** Wizard behavior/replays remain unchanged, the new actor omits caster/planner state it does not use, and common systems process both through stable IDs with bounded storage.

### 7. Two-player then four-player authority

**Playable result:** First, two independently commanded players share one authoritative encounter; then exercise the same model with four. A later experiment may place authority in a host or headless server.

**Seams tested:** player pool/identity, command ownership, spawn/join/leave, target selection, per-player cosmetics, snapshot/delta shape, latency and reconciliation policy.

**Keep deliberately narrow:** mechanics first, validated cosmetic IDs second, WAN production concerns later. Do not assume peer lockstep.

**Acceptance seed:** Every command names a valid player, the authoritative tick resolves conflicts deterministically, replay reproduces all players, and renderer/client state cannot mutate another player's mechanics.

### 8. Larger-world experiment

**Playable result:** A scenario larger than the current comfortable full-field model runs with an explicit memory/work budget using one measured combination of chunks, active regions, or hierarchical routing.

**Seams tested:** chunk lifecycle, cross-region topology, navigation cache scope, dirty revisions, sleeping/distant simulation, visible-chunk presentation upload.

**Keep deliberately narrow:** choose a target scenario and budget from profiling. Do not build an open-world streaming framework without a concrete map.

**Acceptance seed:** Report authoritative memory by layer, navigation expansions and fallback rates, active/sleeping actor work, chunk transitions, and deterministic replay across the chosen route.

## Cross-cutting completion checklist

A promoted vertical should answer these questions before it is called complete:

- What player-visible story now works?
- Which state is authoritative, and which presentation data is derived?
- Which command or deterministic system may mutate it, and at what tick phase?
- What stable IDs and versioned codes cross snapshots, recordings, or the network boundary?
- What are the capacity, update budget, fallback, and overload diagnostics?
- Does it alter collision, occlusion, navigation, perception, damage, or system ordering?
- What current replay schemas remain frozen, and what new schema behavior is required?
- Which pure tests, integrated fixtures, replay fixtures, and soaks cover it?
- What requires a human browser, GPU, audio, network, or game-feel check?
- What architectural hypothesis did the slice prove or disprove?

## Review triggers

Pause feature expansion for a focused architecture review when any of these becomes true:

- A second actor type duplicates core lifecycle or combat loops.
- A new system must reach through most of `Simulation` to do local work.
- One feature adds fields to an unrelated type-specific pool.
- Dynamic props cause navigation rebuilds to exceed their budget or remain stale too often.
- Full-map layers or cached destination fields approach the declared memory budget.
- A hot actor loop scans all actors, props, projectiles, or fields every tick.
- Event capacity overflow affects normal play rather than an exceptional load case.
- Snapshot/replay version branches obscure the current tick schedule.
- Canvas2D and Three.js require different gameplay facts.
- A network experiment cannot identify one authoritative mutation path.

## Near-term recommendation

The first design-ready candidate should be the player-controlled bookshelf. It is a compact demonstration of physicality, occlusion, navigation, authority, replay, and future AI reuse. Plan the smallest replayable vertical first; let the enchanted rat become the second consumer that proves which abstractions deserve to survive.
