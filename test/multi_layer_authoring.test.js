import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  AUTHORING_MAP_FORMAT,
  AUTHORING_MAP_VERSION,
  authoringMapDiagnostics,
  loadAuthoringMap,
  MAX_AUTHORING_LAYERS,
  validateAuthoringMap,
} from "../src/authoring/authoring_map.js";
import {
  createLayer,
  deleteLayer,
  paintStructure,
  paintSurface,
  placeInstance,
  renameLayer,
  setLayerBaseY,
} from "../src/authoring/authoring_commands.js";
import {
  applyAuthoringCommand,
  AuthoringHistory,
  commandFromAuthoringAction,
} from "../src/authoring/authoring_history.js";
import { pickAuthoringTarget } from "../src/authoring/editor_interaction.js";
import { compileAuthoringMap } from "../src/authoring/map_compiler.js";
import { AuthoringEditorController } from "../src/browser/authoring_editor.js";
import {
  ENEMY_AI_PROFILE_NONE,
  GAMEPLAY_PROFILE_PRE_COMBAT,
} from "../src/config.js";
import { mergeCatalogPropLights } from "../src/presentation/catalog_lights.js";
import { GridMap } from "../src/sim/grid_map.js";
import { ArenaScenario } from "../src/sim/scenario.js";
import { Simulation } from "../src/sim/simulation.js";

function borderedMap(width = 10, height = 10) {
  const map = new GridMap(width, height, undefined, { x: 1.5, z: 1.5 });
  for (let x = 0; x < width; x += 1) {
    map.set(x, 0, 1);
    map.set(x, height - 1, 1);
  }
  for (let z = 0; z < height; z += 1) {
    map.set(0, z, 1);
    map.set(width - 1, z, 1);
  }
  return map;
}

function sourceDocument() {
  return new ArenaScenario(borderedMap()).toAuthoringJSON();
}

function threeLayerDocument() {
  const source = sourceDocument();
  const upper = createLayer(source, "ground", "above", { name: "Upper", baseY: 3 });
  const basement = createLayer(upper.document, "ground", "below", {
    name: "Basement",
    baseY: -3,
  });
  return {
    document: basement.document,
    groundId: "ground",
    upperId: upper.layerId,
    basementId: basement.layerId,
  };
}

function simulationFor(document) {
  return new Simulation({
    scenario: new ArenaScenario(document),
    gameplayProfile: GAMEPLAY_PROFILE_PRE_COMBAT,
    enemyAiProfile: ENEMY_AI_PROFILE_NONE,
    particleBurstCount: 0,
  });
}

function compiledView(compiled) {
  return {
    document: compiled.document,
    playerStart: compiled.playerStart,
    layerIds: compiled.layerIds,
    layers: compiled.layers.map((layer) => ({
      id: layer.id,
      name: layer.name,
      baseY: layer.baseY,
      map: layer.map.toJSON(),
      surface: { legend: layer.surface.legend, cells: Array.from(layer.surface.cells) },
      structure: { legend: layer.structure.legend, cells: Array.from(layer.structure.cells) },
      solidMask: Array.from(layer.solidMask),
      occluderMask: Array.from(layer.occluderMask),
      instances: layer.instances,
      entities: layer.entities,
      runtimeMappings: layer.runtimeMappings,
    })),
  };
}

function historyHarness(document) {
  let current = document;
  const history = new AuthoringHistory({
    apply(command, direction) {
      current = applyAuthoringCommand(current, command, direction);
      return { ok: true };
    },
  });
  return {
    history,
    document: () => current,
    execute(action) {
      return history.execute(commandFromAuthoringAction(current, action));
    },
  };
}

test("M1A v1 and legacy single-layer maps migrate to one base-zero start layer", () => {
  const current = sourceDocument();
  const v1 = {
    format: AUTHORING_MAP_FORMAT,
    version: 1,
    metadata: current.metadata,
    activeLayerId: "ground",
    layers: current.layers.map((layer) => ({
      ...layer,
      markers: {
        ...layer.markers,
        playerSpawn: { x: current.playerStart.x, z: current.playerStart.z },
      },
    })),
  };
  const migrated = loadAuthoringMap(JSON.stringify(v1));
  assert.equal(migrated.version, AUTHORING_MAP_VERSION);
  assert.equal(migrated.layers.length, 1);
  assert.equal(migrated.layers[0].id, "ground");
  assert.equal(migrated.layers[0].baseY, 0);
  assert.deepEqual(migrated.playerStart, { layerId: "ground", x: 1.5, z: 1.5 });
  assert.equal("playerSpawn" in migrated.layers[0].markers, false);

  const legacy = loadAuthoringMap(borderedMap().toJSON());
  assert.equal(legacy.layers.length, 1);
  assert.equal(legacy.layers[0].baseY, 0);
  assert.equal(legacy.playerStart.layerId, legacy.layers[0].id);
});

test("three named layers with signed heights round-trip in deterministic stable-ID order", () => {
  const { document, upperId, basementId } = threeLayerDocument();
  const restored = loadAuthoringMap(JSON.stringify(document));
  assert.deepEqual(restored, document);
  assert.deepEqual(restored.layers.map((layer) => layer.id), [basementId, "ground", upperId]);
  assert.deepEqual(restored.layers.map((layer) => layer.baseY), [-3, 0, 3]);
  assert.deepEqual(
    ArenaScenario.fromJSON(JSON.stringify(document)).toAuthoringJSON(),
    document,
  );
});

test("M1A v1 multi-layer migration preserves floor IDs, ordering, heights, and active spawn ownership", () => {
  const { document, upperId, basementId } = threeLayerDocument();
  const v1 = {
    format: AUTHORING_MAP_FORMAT,
    version: 1,
    metadata: document.metadata,
    activeLayerId: upperId,
    layers: document.layers.map((layer) => ({
      ...layer,
      markers: {
        ...layer.markers,
        playerSpawn: { x: 2.5, z: 2.5 },
      },
    })),
  };
  const migrated = loadAuthoringMap(v1);
  assert.deepEqual(migrated.layers.map((layer) => layer.id), [basementId, "ground", upperId]);
  assert.deepEqual(migrated.layers.map((layer) => layer.baseY), [-3, 0, 3]);
  assert.deepEqual(migrated.playerStart, { layerId: upperId, x: 2.5, z: 2.5 });
  assert.equal(migrated.layers.every((layer) => !("playerSpawn" in layer.markers)), true);
});

test("stable layer IDs survive rename and base-height edits", () => {
  const { document, upperId } = threeLayerDocument();
  const renamed = renameLayer(document, upperId, "Temple Gallery");
  const elevated = setLayerBaseY(renamed, upperId, 7.25);
  const layer = elevated.layers.find((candidate) => candidate.id === upperId);
  assert.equal(layer?.id, upperId);
  assert.equal(layer?.name, "Temple Gallery");
  assert.equal(layer?.baseY, 7.25);
});

test("at least ten floors are supported and the configured sixteen-layer cap is enforced", () => {
  let document = sourceDocument();
  let relativeId = "ground";
  for (let index = 1; index < 10; index += 1) {
    const created = createLayer(document, relativeId, "above");
    document = created.document;
    relativeId = created.layerId;
  }
  assert.equal(document.layers.length, 10);
  while (document.layers.length < MAX_AUTHORING_LAYERS) {
    const created = createLayer(document, relativeId, "above");
    document = created.document;
    relativeId = created.layerId;
  }
  assert.equal(document.layers.length, 16);
  assert.throws(() => createLayer(document, relativeId, "above"), /at most 16 layers/);
});

test("same X/Z cells compile collision and sight independently per stable layer ID", () => {
  const { document, upperId, basementId } = threeLayerDocument();
  let edited = paintStructure(document, 4, 4, "structure.wall", "ground");
  edited = placeInstance(edited, "object.pillar", 4.5, 4.5, {
    layerId: upperId,
  }).document;
  const compiled = compileAuthoringMap(edited);
  const ground = compiled.layers.find((layer) => layer.id === "ground");
  const upper = compiled.layers.find((layer) => layer.id === upperId);
  const basement = compiled.layers.find((layer) => layer.id === basementId);
  const index = 4 * 10 + 4;
  assert.equal(ground?.solidMask[index], 1);
  assert.equal(ground?.occluderMask[index], 1);
  assert.equal(upper?.solidMask[index], 1);
  assert.equal(upper?.occluderMask[index], 1);
  assert.equal(basement?.solidMask[index], 0);
  assert.equal(basement?.occluderMask[index], 0);

  const simulation = simulationFor(edited);
  assert.equal(simulation.snapshot().map.cells[index], 1);
  assert.equal(simulation.snapshot().map.occluderCells[index], 1);
  assert.equal(simulation.activateRuntimeLayer(basementId), true);
  assert.equal(simulation.snapshot().map.cells[index], 0);
  assert.equal(simulation.snapshot().map.occluderCells[index], 0);
  assert.equal(simulation.activateRuntimeLayer(upperId), true);
  assert.equal(simulation.snapshot().map.cells[index], 1);
  assert.equal(simulation.snapshot().map.occluderCells[index], 1);
});

test("tables remain active-layer movement bodies without becoming sight occluders", () => {
  const { document, upperId } = threeLayerDocument();
  const placed = placeInstance(document, "object.table", 4.5, 4.5, {
    rotation: 1,
    layerId: upperId,
  });
  const compiled = compileAuthoringMap(placed.document);
  const ground = compiled.layers.find((layer) => layer.id === "ground");
  const upper = compiled.layers.find((layer) => layer.id === upperId);
  assert.equal(ground?.entities.some((entity) => entity.authoringId === placed.instanceId), false);
  const table = upper?.entities.find((entity) => entity.authoringId === placed.instanceId);
  assert.equal(table?.collider, "box");
  assert.equal(table?.fixedRotation, true);
  assert.equal(table?.massKg, 320);
  for (const [cx, cz] of [[4, 4], [4, 5]]) {
    assert.equal(upper?.solidMask[cz * 10 + cx], 0, "the dynamic body owns movement collision");
    assert.equal(upper?.occluderMask[cz * 10 + cx], 0);
  }
});

test("all authored layers retain runtime bodies while presentation lights stay layer-filterable", () => {
  const { document, upperId } = threeLayerDocument();
  const groundTorch = placeInstance(document, "object.torch", 3.5, 3.5, {
    layerId: "ground",
  });
  const upperTorch = placeInstance(groundTorch.document, "object.torch", 6.5, 6.5, {
    layerId: upperId,
  });
  const upperTable = placeInstance(upperTorch.document, "object.table", 3.5, 5.5, {
    layerId: upperId,
  });
  const simulation = simulationFor(upperTable.document);

  assert.deepEqual(
    new Set(simulation.snapshot().rocks.map((body) => body.authoringId)),
    new Set([groundTorch.instanceId, upperTorch.instanceId, upperTable.instanceId]),
  );
  let lights = mergeCatalogPropLights(
    [],
    simulation.snapshot().rocks.filter((body) => body.layerId === "ground"),
    16,
  );
  assert.deepEqual(lights.map((light) => light.authoringId), [groundTorch.instanceId]);

  assert.equal(simulation.activateRuntimeLayer(upperId), true);
  assert.equal(simulation.snapshot().rocks.length, 3);
  lights = mergeCatalogPropLights(
    [],
    simulation.snapshot().rocks.filter((body) => body.layerId === upperId),
    16,
    3,
  );
  assert.deepEqual(lights.map((light) => light.authoringId), [upperTorch.instanceId]);
  assert.equal(simulation.snapshot().map.baseY, 3);

  assert.equal(simulation.activateRuntimeLayer("ground"), true);
  assert.equal(simulation.activateRuntimeLayer(upperId), true);
  assert.equal(simulation.snapshot().rocks.length, 3, "view-layer changes must not duplicate bodies");
  assert.equal(
    mergeCatalogPropLights(
      [],
      simulation.snapshot().rocks.filter((body) => body.layerId === upperId),
      16,
      3,
    )
      .filter((light) => light.authoringId === upperTorch.instanceId).length,
    1,
  );
});

test("layer create, rename, height, and delete commands undo and redo exact snapshots", () => {
  const harness = historyHarness(sourceDocument());
  const original = harness.document();
  assert.equal(harness.execute({
    type: "createLayer",
    layerId: "ground",
    relativeLayerId: "ground",
    direction: "above",
  }).recorded, true);
  const created = harness.document().layers.find((layer) => layer.id !== "ground");
  assert.ok(created);
  const createdId = created.id;
  assert.equal(harness.execute({ type: "renameLayer", layerId: createdId, name: "Upper" }).ok, true);
  assert.equal(harness.execute({ type: "setLayerBaseY", layerId: createdId, baseY: 6 }).ok, true);
  const placed = placeInstance(harness.document(), "object.torch", 4.5, 4.5, {
    layerId: createdId,
    properties: { hue: "amber" },
  });
  const placeCommand = commandFromAuthoringAction(harness.document(), {
    type: "placeInstance",
    layerId: createdId,
    definitionId: "object.torch",
    x: 4.5,
    z: 4.5,
    rotation: 0,
    properties: { hue: "amber" },
  });
  assert.equal(harness.history.execute(placeCommand).ok, true);
  const instanceId = harness.document().layers
    .find((layer) => layer.id === createdId).instances[0].id;
  assert.equal(instanceId, placed.instanceId);

  const beforeDelete = harness.document();
  assert.equal(harness.execute({ type: "deleteLayer", layerId: createdId }).ok, true);
  assert.equal(harness.document().layers.some((layer) => layer.id === createdId), false);
  assert.equal(harness.history.undo().ok, true);
  assert.deepEqual(harness.document(), beforeDelete);
  assert.equal(
    harness.document().layers.find((layer) => layer.id === createdId).instances[0].id,
    instanceId,
  );
  assert.equal(harness.history.redo().ok, true);
  assert.equal(harness.document().layers.some((layer) => layer.id === createdId), false);

  while (harness.history.snapshot().canUndo) assert.equal(harness.history.undo().ok, true);
  assert.deepEqual(harness.document(), original);
});

test("player-start layer ownership is one reversible semantic command", () => {
  const { document, upperId } = threeLayerDocument();
  const harness = historyHarness(document);
  const originalStart = { ...document.playerStart };
  const result = harness.execute({ type: "setPlayerStartLayer", layerId: upperId });
  assert.equal(result.recorded, true);
  assert.deepEqual(harness.document().playerStart, { ...originalStart, layerId: upperId });
  assert.equal(harness.history.undo().ok, true);
  assert.deepEqual(harness.document().playerStart, originalStart);
  assert.equal(harness.history.redo().ok, true);
  assert.deepEqual(harness.document().playerStart, { ...originalStart, layerId: upperId });
});

test("final-layer and player-start deletion rules reject unsafe operations", () => {
  assert.throws(() => deleteLayer(sourceDocument(), "ground"), /final authoring layer/);
  const { document, upperId } = threeLayerDocument();
  assert.throws(() => deleteLayer(document, "ground"), /player-start layer/);
  assert.doesNotThrow(() => deleteLayer(document, upperId));
});

test("active/reference switching is ephemeral and reference data never enters picking", () => {
  const { document, upperId, basementId } = threeLayerDocument();
  const withGroundPillar = placeInstance(document, "object.pillar", 5.5, 5.5, {
    layerId: "ground",
  }).document;
  const simulation = simulationFor(withGroundPillar);
  const history = new AuthoringHistory({
    apply(command, direction) {
      simulation.tick({ type: "applyAuthoringCommand", command, direction });
      return {
        ok: !simulation.lastError,
        error: simulation.lastError,
        snapshot: simulation.snapshot(),
      };
    },
  });
  const controller = new AuthoringEditorController({
    snapshot: simulation.snapshot(),
    validatePlacement: (definitionId, x, z, rotation, ignoreId, layerId) => (
      simulation.validateInstanceTransform(definitionId, x, z, rotation, ignoreId, layerId)
    ),
    commit(action) {
      const result = history.execute(commandFromAuthoringAction(simulation.authoringDocument(), action));
      return {
        ok: result.ok,
        error: result.error,
        snapshot: result.snapshot ?? simulation.snapshot(),
      };
    },
    activateLayer(layerId) {
      const ok = simulation.activateRuntimeLayer(layerId);
      return { ok, error: simulation.lastError, snapshot: simulation.snapshot() };
    },
    layerSnapshot: (layerId) => simulation.authoringLayerSnapshot(layerId),
    historySnapshot: () => history.snapshot(),
    undo: () => history.undo(),
    redo: () => history.redo(),
  });

  assert.equal(controller.activateLayer(upperId), true);
  assert.equal(controller.setReferenceLayer("ground"), true);
  assert.equal(history.snapshot().undoDepth, 0);
  assert.equal(history.snapshot().dirty, false);
  assert.deepEqual(controller.selectAt(5.5, 5.5), {
    kind: "cell",
    layerId: upperId,
    x: 5,
    z: 5,
  });
  assert.deepEqual(pickAuthoringTarget(simulation.authoringSnapshot(), 5.5, 5.5), {
    kind: "cell",
    layerId: upperId,
    x: 5,
    z: 5,
  });

  controller.setDefinition("surface.moss");
  controller.pointerDown(0, 2.5, 2.5);
  assert.equal(controller.pointerUp(0, 2.5, 2.5), true);
  const saved = simulation.authoringDocument();
  const ground = saved.layers.find((layer) => layer.id === "ground");
  const upper = saved.layers.find((layer) => layer.id === upperId);
  assert.equal(ground.surface.legend[ground.surface.cells[22]], "surface.stone");
  assert.equal(upper.surface.legend[upper.surface.cells[22]], "surface.moss");
  assert.equal(history.snapshot().undoDepth, 1);

  assert.equal(controller.setReferenceLayer(basementId), true);
  assert.equal(controller.deleteLayer(basementId), true);
  assert.equal(controller.snapshot().referenceLayerId, null);
  assert.equal(history.snapshot().undoDepth, 2);
  assert.equal(controller.undo(), true);
  assert.equal(simulation.authoringDocument().layers.some((layer) => layer.id === basementId), true);
  assert.equal(controller.snapshot().referenceLayerId, null, "reference choice is not historical state");
});

test("structured validation reports deterministic paths, codes, layers, and warnings", () => {
  const { document, upperId } = threeLayerDocument();
  const malformed = structuredClone(document);
  malformed.layers[1].surface.cells.pop();
  malformed.layers[2].id = malformed.layers[1].id;
  malformed.layers[2].width = 9;
  malformed.layers[0].baseY = Number.POSITIVE_INFINITY;
  malformed.layers[0].instances.push({
    id: "invalid-transform",
    definitionId: "object.torch",
    x: Number.NaN,
    z: 4.5,
    rotation: 0,
  });
  malformed.layers[2].surface.legend[0] = "surface.missing";
  malformed.playerStart.layerId = "missing-layer";
  const diagnostics = authoringMapDiagnostics(malformed);
  const codes = diagnostics.map((entry) => entry.code);
  assert.ok(codes.includes("grid-length"));
  assert.ok(codes.includes("duplicate-layer-id"));
  assert.ok(codes.includes("finite-number"));
  assert.ok(codes.includes("unknown-definition"));
  assert.ok(codes.includes("incompatible-layer-dimensions"));
  assert.ok(codes.includes("invalid-player-start-layer"));
  assert.ok(diagnostics.some((entry) => entry.path === "layers[1].surface.cells"));
  assert.ok(diagnostics.some((entry) => entry.path === "layers[0].instances[0].x"));
  assert.ok(diagnostics.some((entry) => entry.layerId === "ground"));

  const leakedEditorState = structuredClone(document);
  leakedEditorState.activeLayerId = "ground";
  leakedEditorState.layers[0].markers.playerSpawn = { x: 1.5, z: 1.5 };
  const leakedDiagnostics = authoringMapDiagnostics(leakedEditorState);
  assert.ok(leakedDiagnostics.some((entry) => (
    entry.code === "unknown-field" && entry.path === "activeLayerId"
  )));
  assert.ok(leakedDiagnostics.some((entry) => (
    entry.code === "unknown-field" && entry.path === "layers[0].markers.playerSpawn"
  )));

  const duplicateHeight = setLayerBaseY(document, upperId, 0);
  assert.ok(authoringMapDiagnostics(duplicateHeight).some((entry) => (
    entry.severity === "warning" && entry.code === "duplicate-base-y"
  )));

  const future = structuredClone(document);
  future.version = AUTHORING_MAP_VERSION + 1;
  assert.throws(
    () => loadAuthoringMap(future),
    (error) => error.issues?.some((entry) => entry.code === "unknown-future-schema"),
  );

  const blockedStart = paintStructure(document, 1, 1, "structure.wall", "ground");
  assert.throws(
    () => compileAuthoringMap(blockedStart),
    (error) => error.issues?.some((entry) => entry.code === "player-start-solid-overlap"),
  );
});

test("failed simulation loads preserve source, active runtime layer, and history state", () => {
  const { document, upperId } = threeLayerDocument();
  const simulation = simulationFor(document);
  assert.equal(simulation.activateRuntimeLayer(upperId), true);
  const before = simulation.saveMap();
  const beforeRuntimeLayer = simulation.snapshot().runtimeLayerId;
  const harness = historyHarness(simulation.authoringDocument());
  harness.execute({
    type: "paintSurface",
    layerId: upperId,
    definitionId: "surface.moss",
    cx: 2,
    cz: 2,
  });
  const historyBefore = harness.history.snapshot();
  const invalid = structuredClone(document);
  invalid.layers[0].structure.cells.pop();
  simulation.tick({ type: "loadScenario", json: invalid });
  assert.match(simulation.lastError, /Structure grid must contain exactly/);
  assert.equal(simulation.saveMap(), before);
  assert.equal(simulation.snapshot().runtimeLayerId, beforeRuntimeLayer);
  assert.deepEqual(harness.history.snapshot(), historyBefore);
});

test("successful replacement can establish a clean history baseline and starts on player layer", () => {
  const { document, upperId } = threeLayerDocument();
  const replacement = {
    ...document,
    playerStart: { ...document.playerStart, layerId: upperId },
  };
  validateAuthoringMap(replacement);
  const simulation = simulationFor(sourceDocument());
  const harness = historyHarness(simulation.authoringDocument());
  harness.execute({
    type: "paintSurface",
    layerId: "ground",
    definitionId: "surface.moss",
    cx: 2,
    cz: 2,
  });
  assert.equal(harness.history.snapshot().dirty, true);
  simulation.tick({ type: "loadScenario", json: replacement });
  assert.equal(simulation.lastError, null);
  harness.history.clear();
  assert.equal(harness.history.snapshot().dirty, false);
  assert.equal(harness.history.snapshot().undoDepth, 0);
  assert.equal(simulation.snapshot().runtimeLayerId, upperId);
});

test("serialized maps exclude editor, history, reference, and disposable runtime state", () => {
  const { document, upperId } = threeLayerDocument();
  const placed = placeInstance(document, "object.rock.small", 4.5, 4.5, {
    layerId: upperId,
  });
  const simulation = simulationFor(placed.document);
  simulation.activateRuntimeLayer(upperId);
  simulation.rocks.vx[0] = 2;
  simulation.tick(null);
  const saved = JSON.parse(simulation.saveMap());
  const text = JSON.stringify(saved);
  assert.deepEqual(Object.keys(saved), [
    "format",
    "version",
    "metadata",
    "nextLayerOrdinal",
    "nextConnectorOrdinal",
    "playerStart",
    "layers",
    "connectors",
  ]);
  assert.equal(text.includes("activeEditorLayerId"), false);
  assert.equal(text.includes("referenceLayerId"), false);
  assert.equal(text.includes("history"), false);
  assert.equal(text.includes("runtimeLayerId"), false);
  assert.equal(text.includes("emitter"), false);
  assert.equal(
    saved.layers.find((layer) => layer.id === upperId).instances[0].x,
    4.5,
  );
});

test("multi-layer compiler output is deterministic and 3D presentation consumes baseY", async () => {
  const { document, upperId, basementId } = threeLayerDocument();
  let edited = paintSurface(document, 2, 2, "surface.moss", upperId);
  edited = paintStructure(edited, 3, 3, "structure.wall", basementId);
  edited = placeInstance(edited, "object.torch", 5.5, 5.5, { layerId: upperId }).document;
  assert.deepEqual(
    compiledView(compileAuthoringMap(edited)),
    compiledView(compileAuthoringMap(structuredClone(edited))),
  );

  const source = await readFile(new URL("../src/presentation/three_presentation.js", import.meta.url), "utf8");
  assert.match(source, /worldRoot\.position\.y = this\.activeBaseY/);
  assert.match(source, /pose\.position\.y \+ this\.activeBaseY/);
  assert.match(source, /editor\.referenceLayer/);
});
