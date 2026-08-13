# M1A.1 Map-authoring foundation

> **Status:** current non-release implementation contract · **Authoring format:** `lantern-authoring-map` v1 · **Runtime recording schema:** unchanged at v11

M1A.1 separates friendly saved source from the compact grid and bounded pools used by the live simulation. The editor still changes authoritative state only through fixed-tick commands, but its palette and compiler now resolve stable catalog IDs instead of treating HTML button names as gameplay data.

## Source document and compiled state

An authoring document contains map metadata, one or more named layers, one active layer ID, each layer's `baseY`, dimensions, separate surface and structure grids, sparse instances, and required markers. Surface and structure grids store compact legend indices; the legends contain stable definition IDs. Sparse instances contain a stable string `id`, `definitionId`, X/Z position, quarter-turn `rotation`, and optional JSON properties.

Only the active layer is compiled in this slice. Compilation creates the existing `GridMap` collision cells, the matching occluder mask, presentation-facing surface/structure codes, and initial rock spawn descriptors. Wall structures and pillar footprints contribute occupied cells. Moss changes presentation data only. A torch is a saved debug placeholder and has no lighting authority.

The authoring document is never a pool snapshot. Runtime rock positions, velocities, pool indices, enemies, projectiles, particles, health, and AI state are absent. Moving a rock in physics therefore cannot rewrite its saved placement; entering play mode, **Restore positions**, reset, load, and replay reconstruct runtime state from the authoring source.

The central modules are:

- `src/authoring/definition_catalog.js`: stable IDs, labels, categories, placement modes, footprints, debug appearance, future asset slots, and runtime traits.
- `src/authoring/authoring_map.js`: format validation, JSON-safe cloning, and explicit legacy migration.
- `src/authoring/authoring_commands.js`: `paintSurface`, `paintStructure`, `eraseStructure`, `placeInstance`, and `removeInstance` source mutations.
- `src/authoring/map_compiler.js`: deterministic, DOM-free authoring-to-runtime compilation and placement validation.
- `src/sim/scenario.js`: compatibility adapter between the authoring source, schema-v11's legacy scenario projection, and the simulation.

Stable authoring IDs are mapped to numeric runtime spawn IDs where a pool needs one. Neither identity is a pool index.

## Catalog and palette

The generated palette groups the catalog's current definitions:

- Surfaces: `surface.stone`, `surface.moss`
- Structures: `structure.wall`
- Objects: `object.rock.small`, `object.rock.medium`, `object.rock.large`, `object.pillar`, `object.torch`

Definitions declare `paint` or `stamp`; input drag behavior follows that metadata. The erase and restore controls are generic palette actions, not placeable definitions. Canvas2D and Three.js read the same surface/structure data and catalog placeholder metadata.

To add a definition:

1. Add one entry to `PLACEABLE_DEFINITIONS` with a unique stable ID, target, placement mode, footprint, debug appearance, `renderAsset` slot, and traits.
2. A new surface generally needs only catalog debug/render metadata. It must not set movement or sight blocking.
3. A new cell structure declares its blocking traits; the compiler folds the footprint into masks.
4. A new sparse placeholder declares instance snapping and blocking traits. Add specialized runtime-spawn or final presentation handling only if it needs behavior beyond the generic static footprint/placeholder path.
5. Add migration only when replacing a previously persisted identity. Never silently reuse an old ID for different semantics.

## Legacy loading and recordings

Map v1 and scenario v2/v3 JSON remain loadable. The compatibility loader validates dimensions, binary legacy tiles, player spawn, entity kinds, rock archetypes, and obelisk constraints, then creates a stone surface, a wall structure grid, deterministic legacy rock IDs, and current markers. Saving after load emits authoring-map v1.

Snapshot/recording schema remains v11. Recordings keep their compiled scenario-v3 field for frozen compatibility and add `initialAuthoringMap` for current authoring data. Replay prefers that field only for the current schema, so older schema fixtures retain their existing loader and gameplay branches.

The probe exposes `authoring()`, `listPlaceableDefinitions()`, palette selection, the five authoring operations, and compatibility `setTile`/rock methods. `authoring()` reports the schema version, active layer, selected palette definition, available IDs, placed instances, and runtime mappings.

## Deferred

This slice intentionally does not add undo/redo, selection inspectors, arbitrary collider shapes, final assets, lighting, sound propagation, regions, triggers, traps, wiring, elevators, vertical transitions, prefabs, or multi-layer travel. Only one active layer is compiled. Pillars temporarily occupy collision/occlusion cells, and torches remain debug placeholders.

## Try it

Run `npm start`, open the printed Canvas2D or 3D URL, press `;`, then `E`. Paint stone/moss and walls, stamp rocks/pillars/torches, and use RMB or **Erase** to remove a structure or instance. Press `E` again to enter play from freshly compiled authoring state. **Save scenario** downloads authoring-map v1; load that file or use **Restore positions** to confirm authored placements remain independent from runtime rock movement.
