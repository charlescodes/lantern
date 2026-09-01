# M1A.1–M1A.4 Map-authoring kit

> **Status:** current non-release implementation contract · **Authoring format:** `lantern-authoring-map` v5 · **Current runtime recording schema:** v14 (M1A itself did not introduce a recording-schema change)

M1A.1 separates friendly saved source from the compact grid and bounded pools used by the live simulation. M1A.2 adds deterministic selection, inspection, previews, and practical sparse-instance edits. M1A.3 wraps those edits in bounded undo/redo and saved-revision tracking. M1A.4 makes the same kit multi-layer, validates complete documents with structured diagnostics, and makes replacement atomic. The editor still changes authoritative state only through fixed-tick commands, and its palette and compiler resolve stable catalog IDs instead of treating HTML button names as gameplay data.

## Source document and compiled state

An authoring document contains map metadata, `nextLayerOrdinal`, `nextConnectorOrdinal`, one authoritative top-level `playerStart` with a stable `layerId`, an ordered nonempty layer collection, and a deterministic map-level connector collection. Each layer has an opaque stable `id`, human name, signed finite `baseY`, dimensions, separate surface and structure grids, sparse instances, layer-owned markers, and `nextInstanceOrdinal`. Surface and structure grids store compact legend indices; the legends contain stable definition IDs. Sparse instances contain a stable string `id`, `definitionId`, X/Z position, quarter-turn `rotation`, and optional JSON properties. Layer, instance, and connector IDs never derive from array position or display name.

Every layer is compiled independently into a deterministic recipe keyed by stable layer ID. Each recipe contains its own `GridMap` collision cells, occluder mask, surface/structure codes, markers, initial bounded dynamic-body descriptors, and connector endpoints. Identical X/Z cells on different floors never share masks. Wall structures and pillar footprints contribute static occupied cells and TrueSight occlusion. A table instead compiles into the bounded dynamic-body pool as a fixed-orientation box: it blocks physical movement at its live position but contributes no TrueSight occluder cells. Moss changes presentation data only. A standing torch compiles as a lightweight upright circular body and declares a small presentation-only lamp; it does not become a TrueSight occluder or authoritative light source. The map compiler also emits each two-stop connector once as a bounded runtime elevator recipe.

The authoring document is never a pool snapshot. Runtime rock, torch, and table positions and velocities, pool indices, enemies, projectiles, particles, health, and AI state are absent. Moving a prop in physics therefore cannot rewrite its saved placement; **Restore positions**, reset, load, and replay reconstruct runtime state from the authoring source.

The central modules are:

- `src/authoring/definition_catalog.js`: stable IDs, labels, categories, placement modes, footprints, debug appearance, future asset slots, and runtime traits.
- `src/authoring/authoring_map.js`: format validation, JSON-safe cloning, and explicit legacy migration.
- `src/authoring/authoring_commands.js`: atomic surface/structure strokes, sparse-instance edits, stable layer mutations, and map-level connector operations.
- `src/authoring/authoring_history.js`: plain-data command diffs, atomic forward/reverse reduction, action labeling, bounded history, revision identity, and saved-state tracking.
- `src/authoring/footprint.js`: the shared anchor, quarter-turn rotation, occupied-cell, bounds, and simple extent calculations.
- `src/authoring/placement_validation.js`: lightweight, non-mutating bounds and overlap checks shared by previews and compilation.
- `src/authoring/editor_interaction.js`: DOM-free editor state, deterministic picking, target reconciliation, and eyedropper rules.
- `src/authoring/map_compiler.js`: deterministic, DOM-free authoring-to-runtime compilation.
- `src/sim/scenario.js`: compatibility adapter between the authoring source, schema-v14's legacy scenario projection, and the simulation.
- `src/browser/layer_panel.js`: fixed layer management, reference selection, and concise structured validation diagnostics.

Stable authoring IDs are mapped to numeric runtime spawn IDs where a pool needs one. Neither identity is a pool index.

## Layer identity, coordinate space, and activation

All floors share one finite X/Z cell space. Width and height remain on each layer for direct migration compatibility, but validation requires every layer to match; the engine's cell size is the fixed one-meter grid and layers cannot define independent origins or cell sizes. `baseY` is a signed world-space elevation in meters, not identity and not an X/Z offset. Three.js translates the complete active world and camera target by `baseY`; Canvas2D remains a top-down shared-X/Z view and reports the floor height through editor UI/probes.

M1B.1 retains these editor/runtime distinctions while making runtime layer ownership per body:

- **Active editor layer:** transient controller state; all paint, erase, stamp, pick, drag, eyedropper, inspector, and extent operations target this layer only.
- **Reference layer:** zero or one transient, dim alignment overlay. It is never picked, edited, compiled into the active masks, or activated for gameplay merely by being visible.
- **Player-start layer:** saved in the authoritative top-level `playerStart.layerId`; the same record owns the one initial X/Z spawn.
- **Visible runtime layer:** the floor currently presented and used for player-facing map queries. Each live body separately owns its authoritative runtime layer.

The fixed Layers panel lists stable ID, name, signed base Y, player-start badge, dimensions, and instance count. It creates blank layers above or below the active floor at a default three-meter offset, renames, edits base Y, activates a floor, chooses a reference, assigns the player-start floor, and deletes with confirmation. A map retains at least one layer, supports up to 16, and rejects deletion of the current player-start layer until the start is reassigned. Switching active/reference floors is UI state and never dirties history. Create, delete, rename, base-height, and start-layer changes are semantic history commands; delete/restore carries one full layer snapshot so stable layer and instance IDs and deterministic ordering survive undo.

Initial play starts the player on the saved player-start layer. M1B.1 keeps every authored layer recipe and dynamic prop loaded; actors and clutter query collision by their own layer, while presentation follows the visible player/editor layer. An elevator or falling handoff changes one body rather than replacing the global simulation. Entering edit pauses on the player's current runtime floor, editor layer switches remain view-only, and leaving edit resumes the same live body state. See [M1B.1 vertical bodies and elevator](./generic-vertical-bodies-and-elevator.md) for support and transition behavior.

## Selection, picking, and footprints

An editor instance target is `{ kind: "instance", layerId, instanceId }`; a cell target is `{ kind: "cell", layerId, x, z }`. Selection stores only the stable authoring ID. It never retains a runtime pool index, Three.js object, Canvas reference, or mutable entity-array slot. Recompilation and pool compaction therefore cannot redirect a selection. Deleting the instance or loading a document that lacks the ID clears it during state reconciliation.

Picking uses the active layer and authoring extents rather than renderer geometry. A connector endpoint wins first, then instances win over their underlying cell. If multiple extents overlap, the connector or instance later in document placement order wins; stable ID descending is the final deterministic tie-breaker within that target kind. Outside-layer clicks clear selection. Runtime prop movement is deliberately ignored: authoring-space picking continues to find each prop at its saved starting transform.

Sparse X/Z identifies the center of an **anchor cell**. Catalog footprint offsets are integer cells rotated around that fixed anchor; the anchor does not drift when rotation changes. Quarter turns normalize to `0`, `1`, `2`, or `3`. Thus `object.table` occupies anchor plus `+X` at rotation 0 and anchor plus `+Z` at rotation 1. Bounds checks, overlap validation, picking, selection outlines, previews, and extents all call the same `getOccupiedCells()` operation. The table's runtime box is centered on those rotated footprint bounds while retaining the authored quarter turn.

## Tools and inspector

Editor interaction state is transient and never saved: active tool, active channel, selected catalog definition, hover, selection, preview rotation/validity, drag candidate, and the authoring-extents toggle. Catalog selection chooses the matching surface, structure, instance, or connector channel and returns to Paint / stamp. The tools are:

- **Select:** selects instances before cells; dragging an instance previews one candidate and commits one stable-ID transform on release.
- **Paint / stamp:** accumulates surface or structure cells into one release-time stroke, commits one sparse instance stamp, or places one map-level connector endpoint.
- **Erase:** resets surface cells to legend code 0, clears structure cells, or removes an instance according to the explicitly active channel. RMB is a temporary channel-aware erase gesture.
- **Eyedropper:** samples the active channel first, then falls back instance → structure → surface, selects the existing catalog definition, and returns to Paint / stamp. Selecting the Surface channel explicitly samples beneath a wall.

`R` rotates the stamp preview or selected instance in edit mode; the palette and inspector also expose buttons. Escape cancels the current drag or stroke. Pointer previews do not mutate or recompile source. Each release, inspector submission, erase, rotation, or placement is one fixed-tick semantic action and one undoable history entry.

The fixed, collapsible inspector reads authoring source and compiled diagnostics. Instance IDs/layer are read-only; X/Z, quarter-turn rotation, and the JSON property bag validate through the authoring API before compilation. Each accepted form submission is one command rather than one command per keystroke. Rejection leaves the source and stable selection unchanged and reports a message. Cell inspection shows source surface/structure definitions and read-only solid/occluding flags. The property editor preserves unknown JSON without introducing a catalog property-schema language.

## Semantic history and saved state

History commands are detached data records. Cell patches identify layer, channel, cell index, and stable definition IDs before/after. Legend patches preserve the compact source representation exactly when a stroke introduces a new definition. Instance patches carry the complete before/after snapshot, stable authoring ID, and before/after placement index. Small layer-field patches preserve name, `baseY`, and ordinals; layer add/delete uses one full before/after layer record plus ordering index; the player-start record is a map-level patch. Records contain no functions, DOM nodes, renderer objects, pool indices, physics references, or mutable source aliases.

The reducer checks every patch precondition before mutating a detached document, applies forward and reverse through the same path, then validates the complete result. A command is sent through the fixed-tick simulation boundary only after the proposed edited document compiles successfully. The simulation recompiles collision/occlusion data and reconciles authored runtime recipes after execute, undo, and redo: untouched live bodies, effects, and lights retain their disposable state, while added, removed, or explicitly transformed authored props are synchronized exactly once. Reset, Restore positions, and load/import remain the explicit full authored-state reconstruction paths. Undo/redo traversal never records another command.

Surface and structure pointer gestures are transactions. Pointer down begins a transient stroke, movement accumulates each cell once, and pointer up emits one deterministic delta containing the original pre-stroke value and final value. Stamp, delete, rotate, accepted inspector submission, and completed drag each emit one command. Preview movement never edits source. Escape and pointer cancellation discard the pending gesture; requesting undo or redo during a gesture cancels it without traversing history, so a second request performs the traversal.

History retains at most 256 semantic commands by default. Oldest reachable entries are pruned at the boundary. Editing after undo permanently drops that redo branch. Monotonic revision identities—not array indexes—track the current and last successfully saved authoring states, so pruning and branch changes cannot produce a false clean state. A successful scenario download or probe save marks the current revision clean without clearing undo. Undoing or redoing exactly to that identity is clean; either side is dirty. Failed saves do not advance it. Loading/importing/replacing a document clears history and establishes a clean baseline. Simulation reset, **Restore positions**, and edit/play transitions leave authoring history untouched.

The palette shows **Undo**, **Redo**, their next command labels, disabled states, and a modest Saved/Unsaved changes indicator. In edit mode, `Ctrl+Z` or `Meta+Z` undoes; `Ctrl+Y`, `Meta+Y`, `Ctrl+Shift+Z`, or `Meta+Shift+Z` redoes. Text inputs, textareas, selects, and content-editable controls retain native text undo. Selection is not historical state: it remains attached when its stable ID survives traversal and is reconciled to empty if traversal removes that instance.

Gameplay and presentation state never enter this history. Pushing a rock, table, or torch changes only the live bounded body. It neither dirties the map nor changes an authored starting transform. Explicit reset/load paths respawn each at its source transform; ordinary authoring commands reconcile only added, removed, or directly transformed authored props. The table remains a fixed-orientation, movement-blocking, non-occluding box, while the torch remains an upright movable body with exactly one presentation light following its current runtime position.

## Catalog and palette

The generated palette groups the catalog's current definitions:

- Surfaces: `surface.stone`, `surface.moss`, `surface.hole`
- Structures: `structure.wall`
- Objects: `object.rock.small`, `object.rock.medium`, `object.rock.large`, `object.pillar`, `object.torch`, `object.table`
- Connectors: `connector.elevator.two-stop`

Definitions declare `paint` or `stamp`; input behavior follows that metadata. The plain table is a pushable 2×1 directional placeholder with a 320 kg fixed-orientation box, slightly heavier than the medium rock. Physics can translate it but has no angular state, so pushing never pivots, tips, or changes its authored quarter turn. It blocks movement without blocking TrueSight. The standing torch is a lightweight, pushable circular prop that stays upright; Three.js renders a 1.72m post plus a red-orange lamp for an approximately 2m total height. Its catalog light leases a bounded resident presentation-light slot and never casts a point-light shadow. Tool, channel, rotate, extents, and restore controls are generic palette actions, not placeable definitions. Canvas2D and Three.js read the same source and runtime prop state.

To add a definition:

1. Add one entry to `PLACEABLE_DEFINITIONS` with a unique stable ID, target, placement mode, footprint, debug appearance, `renderAsset` slot, and traits.
2. A new surface generally needs only catalog debug/render metadata. It must not set movement or sight blocking. `surface.hole` is the deliberate exception: it compiles one centered supporting-frame aperture recipe and uses the shared vertical aperture contract; it remains a surface paint/erase/eyedrop/history action.
3. A new cell structure declares its blocking traits; the compiler folds the footprint into masks.
4. A new sparse placeholder declares instance snapping and blocking traits. Add specialized runtime-spawn or final presentation handling only if it needs behavior beyond the generic static footprint/placeholder path.
5. Add migration only when replacing a previously persisted identity. Never silently reuse an old ID for different semantics.

## Validation and atomic persistence

Validation emits deterministic records with `severity`, stable `code`, source `path`, human message, and affected `layerId` where available. Errors cover format/version, metadata, the nonempty 16-layer-bounded collection, unique IDs, nonempty names, finite base heights/transforms, shared dimensions, exact grid lengths and legend codes, known catalog definitions, canonical rotations, JSON-safe properties, footprint bounds/overlap, dynamic-pool capacity, player-start ownership/bounds/solid overlap, current obelisk constraints, and complete connector references/geometry/timing. Duplicate base heights are valid but produce warnings. Unknown newer authoring versions are explicit errors; definitions and malformed values are never replaced with defaults.

Load/import parses into a candidate, detects and migrates its supported version, validates the whole source, compiles every layer, checks bounded runtime capacity, and only then swaps the simulation document. Any failure leaves the current source, runtime layer, selection, history, dirty checkpoint, bodies, and lights intact and puts structured diagnostics in the Layers panel. A successful replacement activates the player-start layer, clears selection/reference and history, and establishes a clean revision. Saving recompiles and validates first, permits warnings, refuses errors, and marks clean only after successful JSON export. Editor layer/reference state, selection, hover, previews, history, runtime transforms, pooled bodies, and emitters are never serialized.

## Legacy loading and recordings

Map v1 and scenario v2/v3 JSON remain loadable. The compatibility loader validates dimensions, binary legacy tiles, player spawn, entity kinds, rock archetypes, and obelisk constraints, then creates one `ground` layer at `baseY: 0`, a stone surface, wall structure grid, deterministic legacy rock IDs, current markers, and explicit top-level start ownership. Authoring-map v1 from M1A.1–M1A.3 migrates explicitly: its former active layer becomes the v2 player-start owner and its per-layer player marker becomes the top-level spawn. Authoring-map v2 then migrates to v3 by adding an empty deterministic connector envelope; v3 migrates to v4 where `surface.hole` is a catalog-backed surface value, so no grid reshape is needed. V4 connector speed and occupancy-policy data migrates to v5's autonomous clock duration. Saving after any migration emits authoring-map v5 only.

Snapshot/recording schema is v14. Recordings keep their compiled scenario-v3 field for frozen compatibility and add `initialAuthoringMap` for current authoring data. Schema v14 adds the breakaway-floor profile; schema v13 additionally records the elevator-projectile collision profile; schema v12 retains its committed jump edge and frozen projectile behavior. Replay uses `initialAuthoringMap` for schema v12 and later, preserving older schema fixtures and branches.

The probe preserves the M1A.1–M1A.3 surface and adds safe layer activation/reference/validation, connector, and layer-operation adapters. `authoring()` reports schema/revision, detached layer/connector summaries, editor/reference/start/runtime layer IDs, compiled layer IDs, base heights/dimensions/counts, validation diagnostics/counts, layer capacity, catalog IDs, active placed instances, runtime mappings, hover/selection, preview transform/validity, the extents toggle, undo/redo depths and labels, dirty and saved revision identities, and active-transaction state without exposing mutable commands, masks, or internal arrays.

## Deferred

Persistent history across reloads, history inside map JSON, autosave/crash recovery, applying pushed physics transforms back to source, runtime time travel, copy/paste, duplication, multi-selection, marquee selection, layer duplication/resizing/reordering UI, moving selections between layers, full property schemas, arbitrary or rotating collider shapes, final assets, table tipping/destruction, authoritative lighting, dynamic point-light shadows, cross-layer sound/navigation/sight/projectiles, regions, general trigger graphs, wiring, stairs, arbitrary or merged multi-cell holes, portals, general cross-layer actor routing, retained inactive-floor snapshots, prefabs, streaming, and collaboration remain deferred. M1B.4's breakaway surface is deliberately a narrow implemented trap, not a general trigger system. Pillars temporarily occupy collision/occlusion cells; tables and torches reuse the bounded dynamic-body solver with translation only and never become TrueSight occluders.

## Try it

Run `npm start -- --port 4174` if the default port is occupied, open the printed Canvas2D or 3D URL, press `;`, then `E`. In **Layers**, create Upper and Basement above/below Ground, assign distinct positive/negative heights, and switch the active editor floor. Choose at most one Reference overlay to align X/Z cells without making that floor pickable. Use **Validate map** for current warnings/errors. The generated palette paints stone/moss and holes plus walls; stamps rocks, pillars, torches, and horizontal/vertical tables; and places a two-stop elevator between the active and nearest differently elevated layer. Select/drag, inspect exact transforms/properties, rotate with `R`, use channel-specific Erase/Eyedropper, and toggle authoring extents. Layer operations and long strokes each undo as one action. Save/reload and confirm layer/instance/connector IDs and authored starts survive. Leaving edit resumes the paused live simulation; **Restore positions** explicitly reconstructs authored starts. Push a torch or table to confirm live physics and light follow the runtime body without dirtying source.
