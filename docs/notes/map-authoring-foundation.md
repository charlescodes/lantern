# M1A.1–M1A.3 Map-authoring foundation and semantic history

> **Status:** current non-release implementation contract · **Authoring format:** `lantern-authoring-map` v1 · **Runtime recording schema:** unchanged at v11

M1A.1 separates friendly saved source from the compact grid and bounded pools used by the live simulation. M1A.2 adds deterministic selection, inspection, previews, and practical sparse-instance edits without changing that boundary. M1A.3 wraps those semantic edits in bounded undo/redo and saved-revision tracking. The editor still changes authoritative state only through fixed-tick commands, and its palette and compiler resolve stable catalog IDs instead of treating HTML button names as gameplay data.

## Source document and compiled state

An authoring document contains map metadata, one or more named layers, one active layer ID, each layer's `baseY`, dimensions, separate surface and structure grids, sparse instances, and required markers. Surface and structure grids store compact legend indices; the legends contain stable definition IDs. Sparse instances contain a stable string `id`, `definitionId`, X/Z position, quarter-turn `rotation`, and optional JSON properties.

Only the active layer is compiled in this slice. Compilation creates the existing `GridMap` collision cells, the matching occluder mask, presentation-facing surface/structure codes, and initial bounded dynamic-body spawn descriptors. Wall structures and pillar footprints contribute static occupied cells and TrueSight occlusion. A table instead compiles into the bounded dynamic-body pool as a fixed-orientation box: it blocks physical movement at its live position but contributes no TrueSight occluder cells. Moss changes presentation data only. A standing torch compiles as a lightweight upright circular body and declares a small presentation-only lamp; it does not become a TrueSight occluder or authoritative light source.

The authoring document is never a pool snapshot. Runtime rock, torch, and table positions and velocities, pool indices, enemies, projectiles, particles, health, and AI state are absent. Moving a prop in physics therefore cannot rewrite its saved placement; entering play mode, **Restore positions**, reset, load, and replay reconstruct runtime state from the authoring source.

The central modules are:

- `src/authoring/definition_catalog.js`: stable IDs, labels, categories, placement modes, footprints, debug appearance, future asset slots, and runtime traits.
- `src/authoring/authoring_map.js`: format validation, JSON-safe cloning, and explicit legacy migration.
- `src/authoring/authoring_commands.js`: atomic surface/structure strokes plus place, transform, and remove source mutations.
- `src/authoring/authoring_history.js`: plain-data command diffs, atomic forward/reverse reduction, action labeling, bounded history, revision identity, and saved-state tracking.
- `src/authoring/footprint.js`: the shared anchor, quarter-turn rotation, occupied-cell, bounds, and simple extent calculations.
- `src/authoring/placement_validation.js`: lightweight, non-mutating bounds and overlap checks shared by previews and compilation.
- `src/authoring/editor_interaction.js`: DOM-free editor state, deterministic picking, target reconciliation, and eyedropper rules.
- `src/authoring/map_compiler.js`: deterministic, DOM-free authoring-to-runtime compilation.
- `src/sim/scenario.js`: compatibility adapter between the authoring source, schema-v11's legacy scenario projection, and the simulation.

Stable authoring IDs are mapped to numeric runtime spawn IDs where a pool needs one. Neither identity is a pool index.

## Selection, picking, and footprints

An editor instance target is `{ kind: "instance", layerId, instanceId }`; a cell target is `{ kind: "cell", layerId, x, z }`. Selection stores only the stable authoring ID. It never retains a runtime pool index, Three.js object, Canvas reference, or mutable entity-array slot. Recompilation and pool compaction therefore cannot redirect a selection. Deleting the instance or loading a document that lacks the ID clears it during state reconciliation.

Picking uses the active layer and authoring extents rather than renderer geometry. Instances win over their underlying cell. If multiple extents overlap, the instance later in document placement order wins; stable ID descending is the final deterministic tie-breaker. Outside-layer clicks clear selection. Runtime prop movement is deliberately ignored: authoring-space picking continues to find each prop at its saved starting transform.

Sparse X/Z identifies the center of an **anchor cell**. Catalog footprint offsets are integer cells rotated around that fixed anchor; the anchor does not drift when rotation changes. Quarter turns normalize to `0`, `1`, `2`, or `3`. Thus `object.table` occupies anchor plus `+X` at rotation 0 and anchor plus `+Z` at rotation 1. Bounds checks, overlap validation, picking, selection outlines, previews, and extents all call the same `getOccupiedCells()` operation. The table's runtime box is centered on those rotated footprint bounds while retaining the authored quarter turn.

## Tools and inspector

Editor interaction state is transient and never saved: active tool, active channel, selected catalog definition, hover, selection, preview rotation/validity, drag candidate, and the authoring-extents toggle. Catalog selection chooses the matching surface, structure, or instance channel and returns to Paint / stamp. The tools are:

- **Select:** selects instances before cells; dragging an instance previews one candidate and commits one stable-ID transform on release.
- **Paint / stamp:** accumulates surface or structure cells into one release-time stroke, or commits one sparse instance stamp.
- **Erase:** resets surface cells to legend code 0, clears structure cells, or removes an instance according to the explicitly active channel. RMB is a temporary channel-aware erase gesture.
- **Eyedropper:** samples the active channel first, then falls back instance → structure → surface, selects the existing catalog definition, and returns to Paint / stamp. Selecting the Surface channel explicitly samples beneath a wall.

`R` rotates the stamp preview or selected instance in edit mode; the palette and inspector also expose buttons. Escape cancels the current drag or stroke. Pointer previews do not mutate or recompile source. Each release, inspector submission, erase, rotation, or placement is one fixed-tick semantic action and one undoable history entry.

The fixed, collapsible inspector reads authoring source and compiled diagnostics. Instance IDs/layer are read-only; X/Z, quarter-turn rotation, and the JSON property bag validate through the authoring API before compilation. Each accepted form submission is one command rather than one command per keystroke. Rejection leaves the source and stable selection unchanged and reports a message. Cell inspection shows source surface/structure definitions and read-only solid/occluding flags. The property editor preserves unknown JSON without introducing a catalog property-schema language.

## Semantic history and saved state

History commands are detached data records. Cell patches identify layer, channel, cell index, and stable definition IDs before/after. Legend patches preserve the compact source representation exactly when a stroke introduces a new definition. Instance patches carry the complete before/after snapshot, stable authoring ID, and before/after placement index; layer patches preserve `nextInstanceOrdinal`. Records contain no functions, DOM nodes, renderer objects, pool indices, physics references, or mutable source aliases.

The reducer checks every patch precondition before mutating a detached document, applies forward and reverse through the same path, then validates the complete result. A command is sent through the fixed-tick simulation boundary only after the proposed edited document compiles successfully. The simulation recompiles and reconstructs disposable runtime state after execute, undo, and redo, so collision/occlusion masks, dynamic bodies, and catalog prop lights cannot accumulate stale copies. Undo/redo traversal never records another command.

Surface and structure pointer gestures are transactions. Pointer down begins a transient stroke, movement accumulates each cell once, and pointer up emits one deterministic delta containing the original pre-stroke value and final value. Stamp, delete, rotate, accepted inspector submission, and completed drag each emit one command. Preview movement never edits source. Escape and pointer cancellation discard the pending gesture; requesting undo or redo during a gesture cancels it without traversing history, so a second request performs the traversal.

History retains at most 256 semantic commands by default. Oldest reachable entries are pruned at the boundary. Editing after undo permanently drops that redo branch. Monotonic revision identities—not array indexes—track the current and last successfully saved authoring states, so pruning and branch changes cannot produce a false clean state. A successful scenario download or probe save marks the current revision clean without clearing undo. Undoing or redoing exactly to that identity is clean; either side is dirty. Failed saves do not advance it. Loading/importing/replacing a document clears history and establishes a clean baseline. Simulation reset, **Restore positions**, and edit/play transitions leave authoring history untouched.

The palette shows **Undo**, **Redo**, their next command labels, disabled states, and a modest Saved/Unsaved changes indicator. In edit mode, `Ctrl+Z` or `Meta+Z` undoes; `Ctrl+Y`, `Meta+Y`, `Ctrl+Shift+Z`, or `Meta+Shift+Z` redoes. Text inputs, textareas, selects, and content-editable controls retain native text undo. Selection is not historical state: it remains attached when its stable ID survives traversal and is reconciled to empty if traversal removes that instance.

Gameplay and presentation state never enter this history. Pushing a rock, table, or torch changes only the live bounded body. It neither dirties the map nor changes an authored starting transform. Rebuild or play-mode restoration respawns each at its source transform; the table remains a fixed-orientation, movement-blocking, non-occluding box, while the torch remains an upright movable body with exactly one presentation light following its current runtime position.

## Catalog and palette

The generated palette groups the catalog's current definitions:

- Surfaces: `surface.stone`, `surface.moss`
- Structures: `structure.wall`
- Objects: `object.rock.small`, `object.rock.medium`, `object.rock.large`, `object.pillar`, `object.torch`, `object.table`

Definitions declare `paint` or `stamp`; input behavior follows that metadata. The plain table is a pushable 2×1 directional placeholder with a 320 kg fixed-orientation box, slightly heavier than the medium rock. Physics can translate it but has no angular state, so pushing never pivots, tips, or changes its authored quarter turn. It blocks movement without blocking TrueSight. The standing torch is a lightweight, pushable circular prop that stays upright; Three.js renders a 1.72m post plus a red-orange lamp for an approximately 2m total height. Its catalog light leases a bounded resident presentation-light slot and never casts a point-light shadow. Tool, channel, rotate, extents, and restore controls are generic palette actions, not placeable definitions. Canvas2D and Three.js read the same source and runtime prop state.

To add a definition:

1. Add one entry to `PLACEABLE_DEFINITIONS` with a unique stable ID, target, placement mode, footprint, debug appearance, `renderAsset` slot, and traits.
2. A new surface generally needs only catalog debug/render metadata. It must not set movement or sight blocking.
3. A new cell structure declares its blocking traits; the compiler folds the footprint into masks.
4. A new sparse placeholder declares instance snapping and blocking traits. Add specialized runtime-spawn or final presentation handling only if it needs behavior beyond the generic static footprint/placeholder path.
5. Add migration only when replacing a previously persisted identity. Never silently reuse an old ID for different semantics.

## Legacy loading and recordings

Map v1 and scenario v2/v3 JSON remain loadable. The compatibility loader validates dimensions, binary legacy tiles, player spawn, entity kinds, rock archetypes, and obelisk constraints, then creates a stone surface, a wall structure grid, deterministic legacy rock IDs, and current markers. Saving after load emits authoring-map v1.

Snapshot/recording schema remains v11. Recordings keep their compiled scenario-v3 field for frozen compatibility and add `initialAuthoringMap` for current authoring data. Replay prefers that field only for the current schema, so older schema fixtures retain their existing loader and gameplay branches.

The probe preserves the M1A.1/M1A.2 surface and adds history-safe property updates, `undoAuthoring()`, `redoAuthoring()`, and `authoringHistory()`. `authoring()` reports schema/revision, active layer, catalog IDs, placed instances, runtime mappings, hover/selection, preview transform/validity, the extents toggle, undo/redo depths and labels, capacity, dirty state, current/saved revision identities, and active-transaction state without exposing mutable commands or internal arrays.

## Deferred

Persistent history across reloads, history inside map JSON, autosave/crash recovery, applying pushed physics transforms back to source, runtime time travel, copy/paste, duplication, multi-selection, marquee selection, full property schemas, arbitrary or rotating collider shapes, final assets, table tipping/destruction, authoritative lighting, dynamic point-light shadows, sound propagation, regions, triggers, traps, wiring, elevators, vertical transitions, prefabs, collaboration, and multi-layer management/travel remain deferred beyond M1A.3. Only one active layer is compiled. Pillars temporarily occupy collision/occlusion cells; tables and torches reuse the bounded dynamic-body solver with translation only and never become TrueSight occluders.

## Try it

Run `npm start -- --port 4174` if the default port is occupied, open the printed Canvas2D or 3D URL, press `;`, then `E`. Choose a catalog entry to paint stone/moss and walls or stamp rocks, pillars, torches, and horizontal/vertical tables. Use Select to click/drag, the inspector for exact transforms/properties, `R` or **Rotate 90°**, channel-specific Erase, and Eyedropper. Toggle **Show authoring extents** for footprint/identity diagnostics. Invalid ghosts are red and cannot commit. Paint a long stroke and use **Undo**/`Ctrl+Z`, then **Redo**/`Ctrl+Shift+Z`; make a new edit after undo to see the old redo branch disappear. **Save scenario** marks the current revision clean without clearing history. Press `E` to enter play from freshly compiled source. Push a torch to see its upright body and lamp move together, and push a table to see it slide without rotating or cutting a hole in TrueSight; neither live move dirties the map. Re-enter edit/play or use **Restore positions** to confirm authored starts and history remain independent from runtime physics.
