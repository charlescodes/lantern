# Combat Pillar: Potions, Status Effects, and Combos

## Purpose

Potions should be more than emergency health or mana items. They should function as a broadly available **combat manipulation system**, giving Warriors and other non-magic characters access to some of the expressive combo gameplay normally associated with Wizards and Conjurers.

This supports a core Lantern combat pillar:

> **Combat systems should interact with each other to create useful combinations and emergent results.**

## Potion and Effect Types

Potions may affect entities, terrain, or an area for a limited time.

Example effects:

- **Health / Mana / Cure Poison** — basic restorative utility.
- **Slow** — reduces movement speed.
- **Confusion** — disrupts enemy behavior or targeting.
- **Poison / Acid Cloud** — persistent area damage.
- **Fire / Explosive Mixture** — damage, ignition, or blast effects.
- **Water / Dousing** — extinguishes fire and wets surfaces or targets.
- **Ice / Freezing** — freezes wet ground or affected targets.
- **Oil / Slippery Liquid** — reduces traction and alters movement.
- **Sticky Goo** — slows or temporarily anchors entities.
- **Antidote / Counteragent** — removes or mitigates harmful states.

## Combination Gameplay

Effects should interact rather than behave as isolated attacks.

Examples:

- Slow enemies, then force them through a poison cloud.
- Wet an area, then freeze it into slippery terrain.
- Use water to extinguish fire.
- Burn away sticky material.
- Apply goo or another movement penalty before using knockback or area damage.
- Use terrain, physics, and status effects together to control groups of enemies.

The goal is a simple interaction loop:

**effect → counter-effect → combination → emergent result**

Warriors can use potions as a form of **physical or chemical spellcasting**, while Wizards and Conjurers can combine the same items with their class abilities.

## Enemy Counters

Potions should generally provide **soft counters**, not mandatory hard counters.

Enemies can have weaknesses, resistances, immunities, movement traits, or behaviors that make certain effects especially useful without requiring one exact solution.

Examples:

- Fast enemies make slows valuable.
- Regenerating enemies may be vulnerable to poison or fire.
- Large groups reward area effects.
- Highly mobile enemies may be vulnerable to sticky or slippery terrain.
- Certain creatures may resist or ignore specific status effects.

Most consumables should have multiple useful applications across the game.

## Encounter and Item Cadence

Potion availability should be considered part of map and encounter authoring.

Players should receive consumables frequently enough that they feel comfortable **using them rather than hoarding them**. Encounters can intentionally provide opportunities to experiment with recently discovered or nearby items.

A level may effectively have an informal consumable budget, placing enough useful items before or around encounters that spending several potions during a difficult fight feels normal.

Potion placement can therefore act as part of encounter design rather than purely random loot.

## Engine Direction

Potion effects should eventually use shared systems rather than bespoke logic for every item.

A basic delivery pipeline could be:

**Potion → Impact → Area / Surface Effect → Status Application → Interaction**

Likely shared concepts include:

- Status type
- Duration
- Intensity
- Area or radius
- Surface state
- Damage-over-time
- Movement modifiers
- Resistances / immunities
- Interaction rules
- Effect ownership / source

These effects should fit Lantern's bounded, data-oriented architecture using reusable component pools for temporary statuses, surfaces, clouds, and area effects.

## Design Principle

The inspiration is the systemic combat feel of *Nox*: spells, physics, enemies, terrain, and environmental effects become more interesting when they can interact.

Potions should reinforce that philosophy and help make **combination-driven combat** a defining feature of Lantern.
