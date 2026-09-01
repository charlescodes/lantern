# Lantern product vision

> **Status:** current product direction. This is not a shipped-behavior or
> release contract.

Lantern is a browser-first JavaScript game and game-engine kernel: a fast,
readable action-adventure inspired by the physical immediacy and distinctive
perception of *Nox*, without being a remake. The camera is elevated and
isometric in feel. The world should invite play with movement, spells,
obstacles, light, sound, and modestly physical objects.

The simulation is deliberately 2.5D. Ordinary navigation and collision happen
in X/Z; a limited gameplay Y supports floors, falls, jumps, elevators, and
effects without committing Lantern to general 3D rigid-body physics. Readable,
deterministic-feeling interaction matters more than literal physical accuracy.

Lantern should become a small engine with strong game-specific fundamentals:
fixed-step authority, replayable commands, bounded state, stable identity,
inspectable hidden state, authored worlds, and presentation that observes rather
than owns gameplay. It is not a mandate for an ECS rewrite, networking, or an
abstract general-purpose engine.

The intended game experience includes authored temples and dungeon-like spaces,
environmental mechanisms, tactical creatures, spells, and eventually a short
cooperative action-adventure. Cooperative play is a direction, not permission to
add networking before single-machine behavior and determinism are proven.

The immediate sequence is deliberately concrete: build and test navigation in
authored worlds, make a hand-authored Temple of Ix, then use those proven rooms
and mechanisms to inform any later procedural-dungeon work. See the
[roadmap](./roadmap.md) for scope and ordering.
