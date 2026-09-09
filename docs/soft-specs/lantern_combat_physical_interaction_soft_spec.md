# Lantern Combat & Physical Interaction Soft Spec

**Status:** Working soft specification  
**Project:** Lantern Game Engine  
**Scope:** Combat feel, enemy design, terrain interaction, physical hazards, RPG attributes, and emergent encounter composition  
**Intent:** Define the gameplay direction clearly enough to guide future milestones without prematurely locking down implementation details.

---

## 1. Design Thesis

Lantern's combat should be built around **small, understandable systems that create a large possibility space when combined**.

The goal is not to copy *Nox*, *Dark Souls*, *Doom*, *Diablo*, or tabletop RPG systems directly. These games are useful references because they demonstrate different parts of the intended experience:

- **Nox:** fast action-RPG combat, strong enemy identities, physical knockback, useful immunities, sound/light awareness, environmental interaction.
- **Dark Souls:** readable enemy wind-ups, committed attacks, directional avoidance, spacing, blocking, weapon reach, and recovery.
- **Doom:** encounter design based on enemy combinations, spatial pressure, target priority, and room composition.
- **Diablo / D&D-style RPGs:** gradual character progression, attributes, equipment requirements, resistances, skills, and build tradeoffs.

The central design principle is:

> **Enemies, maps, terrain, physical states, spells, weapons, and character attributes should interact through shared systems rather than isolated scripted exceptions.**

Combat should reward understanding of the world and its rules, not only raw statistics or reaction speed.

---

## 2. Combat Volumes as First-Class Gameplay Primitives

Enemy and player attacks should be represented internally as **timed spatial volumes and trajectories**.

Animation should eventually visualize those attacks, but animation should not be the sole authority on whether an attack hits.

During blockout development, combat can be represented using primitive shapes:

- circles
- ellipses
- arcs
- wedges
- rectangles
- capsules
- line or swept-line segments

This allows combat behavior to be tuned before final art or animation exists.

### Example Attack Phases

A typical melee attack may pass through:

1. **Wind-up** — the attack is telegraphed.
2. **Commitment** — the attacker begins the motion and has reduced ability to cancel or redirect.
3. **Active window** — the hit volume or weapon trajectory can make contact.
4. **Impact / resolution** — damage, impulse, block, parry, collision, or environmental interaction occurs.
5. **Recovery** — the attacker is temporarily vulnerable or limited before another action.

These phases should be mechanically meaningful.

### Example Primitive Attacks

- **Overhead smash:** narrow forward or elliptical impact region; high power; strong side-dodge response.
- **Horizontal sweep:** wide arc; good at controlling nearby space; vulnerable to distance or positioning.
- **Thrust:** long, narrow attack volume; strong reach; weak lateral coverage.
- **Short shove or kick:** low reach; interrupts enemies who stand too close.
- **Ground slam:** radial or partial radial area; strong impulse; potentially interacts with loose objects.

The blockout should make it obvious *why* the player was hit.

---

## 3. Physical Weapon Interaction with the Environment

Weapons and attacks should be able to interact with world geometry where practical.

A large attack should not always pass harmlessly through a pillar or wall simply because its damage check is abstract.

Example:

> An ogre begins a wide club swing. The club trajectory intersects a stone pillar before reaching the player. The swing is interrupted, produces an impact sound and particles, and causes an extended recovery.

This creates emergent relationships between:

- weapon reach
- attack direction
- room width
- pillars
- doors
- clutter
- destructible objects
- player positioning

A narrow hallway should naturally favor some attack types and hinder others.

The implementation does not need full articulated rigid-body animation. A simplified weapon trajectory or swept combat volume is sufficient if it creates consistent gameplay.

---

## 4. Enemy Movesets

Ordinary combat enemies should generally have a **small, deliberate moveset**, roughly three to five meaningful actions.

More attacks are not inherently better. Each move should serve a distinct tactical purpose.

A heavy humanoid enemy might have:

1. **Horizontal sweep** — broad space control.
2. **Overhead smash** — high damage, narrow area.
3. **Close shove** — punishes staying directly beside the enemy.
4. **Advancing thrust** — punishes straight-line retreat.
5. **Conditional signature attack** — rare, health-dependent, positional, or state-dependent.

Bosses may have substantially richer movesets, phases, transitions, arena interactions, or signature mechanics.

Not every ordinary enemy requires an "ultimate." A **signature move**, conditional move, or temporary state is often more appropriate.

---

## 5. Strong Enemy Mechanical Identities

Enemies should be identifiable by more than health, damage, and movement speed.

A memorable enemy should possess a small set of traits that form a coherent tactical identity.

A key inspiration is the *Nox* Ember Demon:

- physically small
- low health
- very fast
- dangerous ranged fire attack
- fast close-range attack
- completely immune to fire

The interesting part is not merely the immunity. It is that the immunity changes the player's decision.

A player relying heavily on fire suddenly needs another answer:

- physical damage
- electricity
- energy or arcane attacks
- environmental hazards
- another party/build tool

### Design Rule

> **Resistances and immunities should alter tactics, not merely lengthen time-to-kill.**

Strong enemy identities can include:

- elemental immunity
- physical resistance
- unusually strong footing
- resistance to knockback
- exceptional climbing or terrain navigation
- poor perception but excellent hearing
- fast disengagement
- shield use
- burrowing, jumping, hovering, or other movement traits

These traits should interact with common systems whenever possible.

---

## 6. Enemy Combinations and Encounter Composition

A major source of combat depth should come from **combinations of individually understandable enemies**.

The *Doom* encounter model is a useful reference: enemy mixtures create target-priority and movement problems that do not exist when each enemy appears alone.

Example Lantern encounter:

- a heavy melee enemy advances and constrains space;
- a fragile ranged caster creates persistent danger zones;
- a fast creature pressures exposed positions;
- a scout can alert another room after hearing combat;
- pillars block ranged line of sight;
- furniture provides temporary physical cover;
- a pit or muddy area alters safe movement routes.

No single enemy needs overwhelming complexity. Complexity emerges from their interaction with the room and one another.

### Encounter Formula

A useful mental model is:

> **Enemy set × map geometry × terrain × hazards × player build × available spells/items**

The authored encounter establishes starting conditions. The shared systems determine what happens next.

---

## 7. Blocking, Shields, and Directional Defense

Blocking should ideally be more than a binary damage reduction state.

A shield can be treated as an orientation-dependent defensive region covering a forward arc.

### Possible Defensive Modes

**Strong block**
- high stability
- strong damage or impulse reduction
- larger defensive commitment
- slower turning or movement
- greater stamina/resource cost

**Mobile / weak block**
- lower stability
- smaller defensive region
- better mobility
- faster transition into attacks

A one-handed weapon may remain usable while blocking, creating a defensive short-reach fighting style.

### Weapon Tradeoffs

**Sword + shield**
- strong defense
- shorter threat range
- reactive play
- lower attack commitment

**Great weapon**
- large attack volumes
- high impulse/stagger potential
- long recovery
- difficult or impossible shield use for ordinary characters

**Light / dual weapons**
- fast recovery
- high mobility
- weak stability
- lower control against heavy attacks

These should behave differently because of reach, mass, commitment, and defensive capability rather than only DPS.

---

## 8. Attributes and Equipment Capability

Lantern should avoid unnecessary hard class restrictions when character attributes can produce the desired limitation naturally.

For example, a great weapon may normally require two hands, but an exceptionally strong character might eventually wield it one-handed.

Possible weapon-related properties include:

- mass
- reach
- required strength
- moment / inertia
- recovery cost
- one-hand stability requirement
- stamina or exertion cost

Possible character attributes include:

- **Strength** — weapon handling, heavy equipment, impulse resistance, restraint escape.
- **Dexterity / Agility** — footing, recovery, turning, difficult terrain handling, balance.
- **Endurance** — sustained exertion, climbing, sprinting, repeated blocking.
- **Attunement / Magical Affinity** — effectiveness or receptivity to magical effects, potions, or magical equipment.
- **Weapon skills** — gradual specialization and proficiency.

The exact attribute list is not yet fixed.

### Build Tradeoffs

A very strong character may gain unusual equipment combinations while sacrificing magical or technical capability.

A highly agile character may handle slopes, mud, pits, and evasive movement more effectively.

A magically attuned character may receive more benefit from potions or magical effects.

The objective is not to make one stat universally superior. Attributes should change *how the player solves physical and combat problems*.

---

## 9. Terrain as a Gameplay System

Terrain should participate directly in movement and combat.

The 2.5D structure does not prevent Lantern from supporting meaningful elevation or surface behavior.

### Slopes

Traversable terrain may have a local slope or grade.

Movement can respond differently depending on direction:

- uphill — increased effort and reduced speed
- downhill — reduced effort or increased speed
- cross-slope — balance or handling penalty
- downhill sprint — potentially faster, but harder to steer or stop

The engine does not require fully general 3D terrain physics for this. A surface can expose slope information to the movement system while retaining a simplified simulation.

### Terrain Materials

Surfaces may apply gameplay properties such as:

- mud
- loose gravel
- ice
- shallow water
- rubble
- vegetation

Mud, for example, may reduce acceleration or movement speed and interact with slope.

Terrain response should depend partly on the entity.

A swamp creature may ignore mud.  
A heavily armored warrior may sink or accelerate poorly.  
A dexterous character may retain better footing.

---

## 10. Holes, Pits, and Navigation Hazards

Holes and pits should be meaningful both to the player and AI.

Different entities may have different ability to:

- notice a hole
- stop before an edge
- route around it
- jump it
- recover from a bad approach
- intentionally use it against others

A creature with excellent terrain navigation may fight confidently near pits while an inexperienced or encumbered player is at greater risk.

This creates terrain expertise as a genuine enemy trait.

Pits also interact naturally with existing knockback and falling systems.

---

## 11. Impulse, Shockwaves, and Environmental Damage

Physical displacement should be capable of producing secondary consequences.

An attack does not need to deal all of its damage directly.

Examples:

- shockwave pushes an enemy into spikes;
- explosion knocks a table into another entity;
- heavy attack sends a creature into a wall;
- air blast pushes the player toward a pit;
- moving object crushes or traps something against geometry.

### Example Resolution Chain

> shockwave → impulse → displacement → spike collision → penetration / pin check → damage → restrained state

This is preferable to creating a special-case "shockwave into spike" scripted interaction.

Each system should contribute one part of the result.

---

## 12. Restraints, Nets, and Pinned States

Several gameplay effects can share a common **restraint / constraint model**.

Potential sources include:

- nets
- webs
- vines
- spike pinning
- traps
- collapsed debris
- certain enemy grapples

A restrained entity may experience:

- reduced or disabled movement
- reduced turning
- limited attack selection
- periodic damage
- increased vulnerability
- repeated escape attempts

Possible restraint data may include:

- restraint type
- restraint strength
- escape difficulty
- movement multiplier
- damage interval
- escape interval
- source entity or environment reference

The important architectural idea is that a net, web, and spike pin should not require three completely independent gameplay systems if they can share the same underlying state model.

---

## 13. Real-Time "Saving Throw" Style Resolution

Lantern is a real-time action RPG, but some tabletop-like mechanics can be represented through **periodic checks within continuous simulation**.

The main simulation can run at its normal fixed tick while slower gameplay decisions resolve at a lower frequency.

Example:

> A pinned character receives an escape attempt every 0.5 or 1.0 seconds.

The escape result might use:

- strength
- dexterity
- current stamina
- restraint strength
- injury
- leverage
- creature size
- equipment
- optional randomness

A saving throw does not necessarily need to be random.

It may be a deterministic contest with randomness applied only when uncertainty improves gameplay.

This creates turn-like mechanical depth without stopping real-time action.

---

## 14. ECS / Component Philosophy

These features should be composed from broad reusable components rather than an ever-growing list of one-off flags.

Useful high-level component concepts may include:

- physical body
- movement
- combatant
- health
- terrain response
- resistance profile
- restraint
- attack state
- AI/navigation

Bitmasks can identify which broad systems apply to an entity.

Detailed state should generally live in component data rather than consuming a unique component bit for every temporary condition.

For example, avoid needing independent structural components for:

- muddy
- webbed
- netted
- pinned
- burning
- slowed
- shocked

Instead, use reusable status/terrain/restraint data where appropriate.

The exact ECS layout remains an implementation concern and should be refined when these systems enter an active milestone.

---

## 15. Emergent-System Architecture

The desired gameplay can be summarized by keeping system responsibilities narrow.

For example:

- A **shockwave** produces impulse.
- The **physics system** moves the entity.
- The **terrain/environment system** detects collision with spikes.
- The **damage system** resolves physical injury.
- The **restraint system** determines whether the entity becomes pinned.
- The **character system** provides attributes for escape.
- The **AI system** chooses what the enemy does while trapped.

No system needs explicit knowledge of the complete chain.

This is the foundation for emergent gameplay.

> **The game should author rules and starting conditions more often than authored outcomes.**

---

## 16. Suggested Development Order

These ideas should not derail the current map-authoring and engine-foundation milestones.

A sensible future progression is:

1. **Combat blockout primitives**
   - wind-up
   - attack volumes
   - hit resolution
   - recovery
   - simple dodge/block

2. **Basic enemy movesets**
   - three to five attacks
   - attack selection
   - range and positioning

3. **Directional defense and weapon differences**
   - shield arc
   - stability
   - weapon reach
   - attack commitment

4. **Terrain response**
   - slope
   - surface/material modifiers
   - pits and edge handling

5. **Physical interaction**
   - stronger impulse consequences
   - weapon/world collision
   - movable combat geometry

6. **Resistances and enemy identities**
   - elemental resistance/immunity
   - knockback/terrain traits
   - specialized movement

7. **Restraints and environmental hazards**
   - nets
   - pinning
   - periodic escape checks

8. **Encounter composition tooling**
   - author rooms specifically around enemy and environmental combinations

9. **RPG progression integration**
   - attributes
   - weapon skills
   - equipment capability
   - build tradeoffs

The exact milestone numbering should be decided against the main Lantern roadmap rather than defined by this soft spec.

---

## 17. Open Questions

These are intentionally unresolved:

- How directional should blocking become?
- Should shields use discrete arcs or continuous orientation geometry?
- How much stamina/resource management belongs in combat?
- How much randomness should exist in saving-roll-style mechanics?
- Which attributes will be part of the final character system?
- Should downhill movement create passive acceleration or simply modify target speed?
- How physically accurate should weapon/world collision be?
- Which attacks can be interrupted by geometry?
- Which environmental hazards cause restraint rather than immediate damage?
- How should immunities be communicated visually and audibly?
- How much terrain knowledge should AI possess versus discover dynamically?
- Which status effects deserve reusable generalized components?
- How much of boss behavior should use shared combat systems versus bespoke scripting?

These should be answered through prototypes rather than decided entirely on paper.

---

## 18. Guiding Principles

When evaluating future combat features, prefer designs that satisfy several of these principles:

- **Readable:** the player can understand what happened.
- **Physical:** position, mass, movement, geometry, and timing matter.
- **Composable:** the mechanic works with existing systems.
- **Reusable:** multiple gameplay features can share the same underlying representation.
- **Tactical:** it changes player decisions.
- **Build-sensitive:** attributes or equipment can alter the response.
- **Enemy-sensitive:** creatures can possess meaningful exceptions or advantages.
- **Environment-sensitive:** the room matters.
- **Emergent:** systems can create outcomes that were not individually scripted.
- **Prototype-friendly:** the behavior can be tested with primitive geometry before final art exists.

The long-term objective is a combat system where a simple room, a handful of well-crafted enemies, several physical objects, and one unusual terrain feature can produce many different fights depending on player build and behavior.
