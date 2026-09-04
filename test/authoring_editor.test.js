import test from "node:test";
import assert from "node:assert/strict";

import {
  eraseStructure,
  createLayer,
  paintStructure,
  paintSurface,
  placeElevatorConnector,
  placeInstance,
  removeInstance,
  updateInstanceTransform,
} from "../src/authoring/authoring_commands.js";
import {
  EditorInteractionState,
  pickAuthoringTarget,
  sampleAuthoredDefinition,
} from "../src/authoring/editor_interaction.js";
import { getPlaceableDefinition } from "../src/authoring/definition_catalog.js";
import { getOccupiedCells, getRuntimeBodyTransform } from "../src/authoring/footprint.js";
import { compileAuthoringMap } from "../src/authoring/map_compiler.js";
import { validateInstancePlacement } from "../src/authoring/placement_validation.js";
import { AuthoringEditorController } from "../src/browser/authoring_editor.js";
import { commandFromAuthoringAction } from "../src/authoring/authoring_history.js";
import {
  ENEMY_AI_PROFILE_NONE,
  GAMEPLAY_PROFILE_PRE_COMBAT,
} from "../src/config.js";
import { GridMap } from "../src/sim/grid_map.js";
import { ArenaScenario } from "../src/sim/scenario.js";
import { Simulation } from "../src/sim/simulation.js";

function borderedMap(width = 9, height = 9) {
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

/** @param {Record<string,unknown>} [document] */
function simulationFor(document = sourceDocument()) {
  return new Simulation({
    scenario: new ArenaScenario(document),
    gameplayProfile: GAMEPLAY_PROFILE_PRE_COMBAT,
    enemyAiProfile: ENEMY_AI_PROFILE_NONE,
    particleBurstCount: 0,
  });
}

/** @param {Simulation} simulation */
function controllerFor(simulation) {
  return new AuthoringEditorController({
    snapshot: simulation.snapshot(),
    validatePlacement: (definitionId, x, z, rotation, ignoreId) => (
      simulation.validateInstanceTransform(definitionId, x, z, rotation, ignoreId)
    ),
    commit: (action) => {
      const command = commandFromAuthoringAction(simulation.authoringDocument(), action);
      simulation.tick({ type: "applyAuthoringCommand", command });
      return {
        ok: !simulation.lastError,
        error: simulation.lastError,
        snapshot: simulation.snapshot(),
      };
    },
  });
}

test("a 2x1 table footprint becomes 1x2 around a fixed anchor after a quarter turn", () => {
  const table = getPlaceableDefinition("object.table");
  assert.ok(table);
  assert.deepEqual(getOccupiedCells(table, { x: 3.5, z: 4.5, rotation: 0 }), [
    { cx: 3, cz: 4 },
    { cx: 4, cz: 4 },
  ]);
  assert.deepEqual(getOccupiedCells(table, { x: 3.5, z: 4.5, rotation: 1 }), [
    { cx: 3, cz: 4 },
    { cx: 3, cz: 5 },
  ]);
});

test("compiler, validation, preview cells, and picking share table occupancy", () => {
  const placed = placeInstance(sourceDocument(), "object.table", 3.5, 3.5, { rotation: 1 });
  const compiled = compileAuthoringMap(placed.document);
  const instance = placed.document.layers[0].instances[0];
  const table = getPlaceableDefinition(instance.definitionId);
  const occupiedCells = getOccupiedCells(table, instance);
  const validation = validateInstancePlacement(
    placed.document,
    instance.definitionId,
    instance,
    { ignoreInstanceId: instance.id },
  );
  const authoring = simulationFor(placed.document).authoringSnapshot();

  assert.deepEqual(validation.occupiedCells, occupiedCells);
  const runtimeTransform = getRuntimeBodyTransform(table, instance);
  const entity = compiled.entities.find((candidate) => candidate.authoringId === instance.id);
  assert.equal(entity?.collider, "box");
  assert.deepEqual(
    { x: entity?.x, z: entity?.z, rotation: entity?.rotation },
    runtimeTransform,
  );
  for (const cell of occupiedCells) {
    assert.equal(compiled.map.get(cell.cx, cell.cz), 0);
    assert.equal(compiled.occluderMask[cell.cz * compiled.map.width + cell.cx], 0);
    assert.deepEqual(pickAuthoringTarget(authoring, cell.cx + 0.5, cell.cz + 0.5), {
      kind: "instance",
      layerId: authoring.activeLayer.id,
      instanceId: instance.id,
    });
  }
});

test("overlapping authoring extents pick deterministically by placement order and stable ID", () => {
  const authoring = simulationFor().authoringSnapshot();
  authoring.instances = [
    { id: "instance-a", definitionId: "object.torch", x: 4.5, z: 4.5, rotation: 0 },
    { id: "instance-b", definitionId: "object.pillar", x: 4.5, z: 4.5, rotation: 0 },
  ];
  assert.deepEqual(pickAuthoringTarget(authoring, 4.5, 4.5), {
    kind: "instance",
    layerId: authoring.activeLayer.id,
    instanceId: "instance-b",
  });
  assert.deepEqual(pickAuthoringTarget(authoring, 2.5, 2.5), {
    kind: "cell",
    layerId: authoring.activeLayer.id,
    x: 2,
    z: 2,
  });
  assert.equal(pickAuthoringTarget(authoring, -0.1, 2.5), null);
});

test("navigation editor stamps, moves, and links nodes as separate semantic commands", () => {
  const simulation = simulationFor();
  const editor = controllerFor(simulation);
  assert.equal(editor.setChannel("navigation"), true);
  editor.pointerDown(0, 2.5, 2.5);
  assert.equal(editor.pointerUp(0, 2.5, 2.5), true);
  editor.pointerDown(0, 4.5, 2.5);
  assert.equal(editor.pointerUp(0, 4.5, 2.5), true);
  let nodes = simulation.authoringSnapshot().navigationNodes;
  assert.equal(nodes.length, 2);

  editor.setTool("select");
  editor.pointerDown(0, 2.5, 2.5);
  editor.pointerMove(3.5, 2.5);
  assert.equal(editor.pointerUp(0, 3.5, 2.5, { moved: true }), true);
  nodes = simulation.authoringSnapshot().navigationNodes;
  assert.deepEqual(nodes[0] && { cx: nodes[0].cx, cz: nodes[0].cz }, { cx: 3, cz: 2 });

  editor.setTool("link");
  const savedBeforePartialLink = simulation.saveMap();
  assert.equal(editor.pointerDown(0, 3.5, 2.5), true);
  assert.equal(simulation.saveMap(), savedBeforePartialLink);
  assert.equal(editor.snapshot().history.transactionActive, false);
  assert.equal(editor.pointerDown(0, 4.5, 2.5), true);
  assert.equal(simulation.authoringSnapshot().navigationLinks.length, 1);
  assert.equal(editor.cancel(), false);
});

test("navigation node picking is layer-authored and does not consult runtime body layers", () => {
  const authoring = simulationFor().authoringSnapshot();
  authoring.navigationNodes = [{
    id: "navigation-node-0001", layerId: authoring.activeLayer.id, cx: 3, cz: 3, patrol: false,
  }];
  const state = new EditorInteractionState();
  state.setChannel("navigation");
  assert.deepEqual(
    pickAuthoringTarget(authoring, 3.5, 3.5),
    { kind: "cell", layerId: authoring.activeLayer.id, x: 3, z: 3 },
  );
  assert.equal(state.snapshot().activeChannel, "navigation");
});

test("link tool accepts a visible connector endpoint without changing the runtime layer", () => {
  const upper = createLayer(sourceDocument(), "ground", "above", { baseY: 3 });
  const elevator = placeElevatorConnector(upper.document, 5.5, 4.5, {
    lowerLayerId: "ground", upperLayerId: upper.layerId,
  });
  const simulation = simulationFor(elevator.document);
  const editor = controllerFor(simulation);
  editor.setChannel("navigation");
  editor.pointerDown(0, 2.5, 2.5);
  assert.equal(editor.pointerUp(0, 2.5, 2.5), true);
  const runtimeLayerBefore = simulation.snapshot().runtimeLayerId;
  editor.setTool("link");
  assert.equal(editor.pointerDown(0, 2.5, 2.5), true);
  assert.equal(editor.pointerDown(0, 5.5, 4.5), true);
  assert.equal(simulation.authoringSnapshot().navigationLinks.length, 1);
  assert.equal(simulation.snapshot().runtimeLayerId, runtimeLayerBefore);
});

test("moving and rotating an instance preserves its stable ID through save/load", () => {
  const placed = placeInstance(sourceDocument(), "object.table", 3.5, 3.5);
  const moved = updateInstanceTransform(placed.document, placed.instanceId, {
    x: 5.5,
    z: 4.5,
    rotation: 1,
  });
  const restored = ArenaScenario.fromJSON(JSON.stringify(moved)).toAuthoringJSON();
  const instance = restored.layers[0].instances[0];

  assert.equal(instance.id, placed.instanceId);
  assert.deepEqual(
    { x: instance.x, z: instance.z, rotation: instance.rotation },
    { x: 5.5, z: 4.5, rotation: 1 },
  );
});

test("invalid simulation moves and rotations leave the authoring document unchanged", () => {
  const placed = placeInstance(sourceDocument(), "object.table", 3.5, 3.5);
  const simulation = simulationFor(placed.document);
  const before = simulation.saveMap();

  simulation.tick({
    type: "updateInstanceTransform",
    authoringId: placed.instanceId,
    x: 0.5,
    z: 3.5,
    rotation: 2,
  });
  assert.match(simulation.lastError, /outside|invalid/i);
  assert.equal(simulation.saveMap(), before);

  simulation.tick({
    type: "updateInstanceTransform",
    authoringId: placed.instanceId,
    x: 3.5,
    z: 3.5,
    rotation: 0.5,
  });
  assert.match(simulation.lastError, /quarter turns|rotation/i);
  assert.equal(simulation.saveMap(), before);
});

test("surface, structure, and instance erase semantics affect only their channel", () => {
  let source = paintSurface(sourceDocument(), 3, 3, "surface.moss");
  source = paintStructure(source, 3, 3, "structure.wall");
  const placed = placeInstance(source, "object.torch", 5.5, 5.5);
  const simulation = simulationFor(placed.document);

  simulation.tick({ type: "eraseSurface", cx: 3, cz: 3 });
  let snapshot = simulation.snapshot();
  let index = 3 * snapshot.map.width + 3;
  assert.equal(snapshot.map.surface.legend[snapshot.map.surface.cells[index]], "surface.stone");
  assert.equal(snapshot.map.structure.legend[snapshot.map.structure.cells[index]], "structure.wall");
  assert.ok(simulation.getAuthoredInstance(placed.instanceId));

  simulation.tick({ type: "eraseStructure", cx: 3, cz: 3 });
  snapshot = simulation.snapshot();
  index = 3 * snapshot.map.width + 3;
  assert.equal(snapshot.map.structure.legend[snapshot.map.structure.cells[index]], null);
  assert.ok(simulation.getAuthoredInstance(placed.instanceId));

  simulation.tick({ type: "removeInstance", authoringId: placed.instanceId });
  assert.equal(simulation.getAuthoredInstance(placed.instanceId), null);
});

test("eyedropper samples all channels and explicitly reaches a surface under a wall", () => {
  let source = paintSurface(sourceDocument(), 3, 3, "surface.moss");
  source = paintStructure(source, 3, 3, "structure.wall");
  source = placeInstance(source, "object.torch", 5.5, 5.5).document;
  const snapshot = simulationFor(source).snapshot();

  assert.deepEqual(sampleAuthoredDefinition(snapshot, 3.5, 3.5, "surface"), {
    definitionId: "surface.moss",
    channel: "surface",
    target: { kind: "cell", layerId: "ground", x: 3, z: 3 },
  });
  assert.equal(
    sampleAuthoredDefinition(snapshot, 3.5, 3.5, "structure")?.definitionId,
    "structure.wall",
  );
  assert.equal(
    sampleAuthoredDefinition(snapshot, 5.5, 5.5, "instance")?.definitionId,
    "object.torch",
  );
  assert.equal(
    sampleAuthoredDefinition(snapshot, 3.5, 3.5, "instance")?.definitionId,
    "structure.wall",
  );
});

test("table runtime box follows its authored transform without becoming static map cells", () => {
  const placed = placeInstance(sourceDocument(), "object.table", 3.5, 3.5);
  const simulation = simulationFor(placed.document);
  const runtimeId = simulation.snapshot().rocks[0].id;
  assert.equal(simulation.map.get(3, 3), 0);
  assert.equal(simulation.map.get(4, 3), 0);
  assert.equal(simulation.snapshot().rocks[0].x, 4);
  assert.equal(simulation.snapshot().rocks[0].z, 3.5);
  assert.equal(simulation.snapshot().rocks[0].rotation, 0);
  assert.equal(simulation.queryAt(4.75, 3.5)?.kind, "table");
  assert.notEqual(simulation.queryAt(4, 4)?.kind, "table");

  simulation.tick({
    type: "updateInstanceTransform",
    authoringId: placed.instanceId,
    x: 5.5,
    z: 3.5,
    rotation: 1,
  });
  assert.equal(simulation.lastError, null);
  const table = simulation.snapshot().rocks[0];
  assert.equal(table.id, runtimeId);
  assert.equal(table.x, 5.5);
  assert.equal(table.z, 4);
  assert.equal(table.rotation, 1);
  assert.equal(table.fixedRotation, true);
  assert.equal(simulation.map.get(5, 3), 0);
  assert.equal(simulation.map.get(5, 4), 0);
  assert.equal(simulation.queryAt(5.5, 4.75)?.kind, "table");
  assert.notEqual(simulation.queryAt(6.25, 4)?.kind, "table");
});

test("controller selection remains a stable authoring ID across move and runtime rebuild", () => {
  const placed = placeInstance(sourceDocument(), "object.table", 3.5, 3.5);
  const simulation = simulationFor(placed.document);
  const controller = controllerFor(simulation);
  controller.setTool("select");
  controller.pointerDown(0, 3.5, 3.5);
  controller.pointerMove(5.5, 3.5, true);
  assert.equal(controller.pointerUp(0, 5.5, 3.5, { moved: true }), true);

  assert.equal(controller.snapshot().selectedTarget.instanceId, placed.instanceId);
  assert.equal(simulation.getAuthoredInstance(placed.instanceId).x, 5.5);
  simulation.tick({ type: "restoreScenario" });
  controller.sync(simulation.snapshot(), { x: 5.5, z: 3.5, inside: true });
  assert.equal(controller.snapshot().selectedTarget.instanceId, placed.instanceId);
});

test("brush pointer moves remain preview-only and commit one semantic stroke on release", () => {
  const simulation = simulationFor();
  const controller = controllerFor(simulation);
  controller.setDefinition("surface.moss");
  const beforeTick = simulation.tickCount;
  const beforeSource = simulation.saveMap();
  controller.pointerDown(0, 2.5, 2.5);
  controller.pointerMove(3.5, 2.5, true);
  controller.pointerMove(4.5, 2.5, true);

  assert.equal(simulation.tickCount, beforeTick);
  assert.equal(simulation.saveMap(), beforeSource);
  assert.equal(controller.snapshot().placementPreview.occupiedCells.length, 3);
  assert.equal(controller.pointerUp(0, 4.5, 2.5, { moved: true }), true);
  assert.equal(simulation.tickCount, beforeTick + 1);
  const snapshot = simulation.snapshot();
  for (const cx of [2, 3, 4]) {
    const index = 2 * snapshot.map.width + cx;
    assert.equal(
      snapshot.map.surface.legend[snapshot.map.surface.cells[index]],
      "surface.moss",
    );
  }
});

test("selection clears safely after deletion or replacement with a map lacking the ID", () => {
  const placed = placeInstance(sourceDocument(), "object.torch", 4.5, 4.5);
  const simulation = simulationFor(placed.document);
  const controller = controllerFor(simulation);
  assert.equal(controller.selectInstance(placed.instanceId), true);
  assert.equal(controller.removeInstance(placed.instanceId), true);
  assert.equal(controller.snapshot().selectedTarget, null);

  const second = placeInstance(sourceDocument(), "object.pillar", 4.5, 4.5);
  const state = new EditorInteractionState();
  state.setSelectedTarget({
    kind: "instance",
    layerId: "ground",
    instanceId: second.instanceId,
  });
  state.reconcile(simulationFor(second.document).authoringSnapshot());
  assert.ok(state.selectedTarget);
  state.reconcile(simulationFor(sourceDocument()).authoringSnapshot());
  assert.equal(state.selectedTarget, null);
});

test("runtime movement of an authored rock does not affect authoring-space picking", () => {
  const scenario = new ArenaScenario(borderedMap(), [
    { kind: "rock", archetype: "small", x: 4.5, z: 4.5 },
  ]);
  const simulation = new Simulation({
    scenario,
    gameplayProfile: GAMEPLAY_PROFILE_PRE_COMBAT,
    enemyAiProfile: ENEMY_AI_PROFILE_NONE,
    particleBurstCount: 0,
  });
  const authoredId = simulation.authoringSnapshot().instances[0].id;
  simulation.rocks.x[0] = 6.5;
  simulation.rocks.z[0] = 6.5;

  assert.equal(simulation.authoredInstanceAt(6.5, 6.5), null);
  assert.equal(simulation.authoredInstanceAt(4.5, 4.5)?.id, authoredId);
  assert.equal(JSON.parse(simulation.saveMap()).layers[0].instances[0].x, 4.5);
});

test("legacy single-cell command adapters remain compatible", () => {
  let source = paintStructure(sourceDocument(), 4, 4, "structure.wall");
  source = eraseStructure(source, 4, 4);
  const placed = placeInstance(source, "object.pillar", 4.5, 4.5);
  const removed = removeInstance(placed.document, placed.instanceId);
  assert.equal(compileAuthoringMap(removed).map.get(4, 4), 0);
});

test("semantic strokes and instance transforms replay deterministically", () => {
  const simulation = simulationFor();
  simulation.tick({
    type: "paintSurfaceStroke",
    cells: [{ cx: 2, cz: 2 }, { cx: 3, cz: 2 }],
    definitionId: "surface.moss",
  });
  simulation.tick({
    type: "paintStructureStroke",
    cells: [{ cx: 6, cz: 2 }, { cx: 6, cz: 3 }],
    definitionId: "structure.wall",
  });
  simulation.tick({
    type: "placeInstance",
    definitionId: "object.table",
    x: 3.5,
    z: 4.5,
    rotation: 0,
  });
  const tableId = simulation.authoringSnapshot().instances.find(
    (instance) => instance.definitionId === "object.table",
  ).id;
  simulation.tick({
    type: "updateInstanceTransform",
    authoringId: tableId,
    x: 4.5,
    z: 5.5,
    rotation: 1,
  });
  simulation.tick({ type: "eraseStructureStroke", cells: [{ cx: 6, cz: 2 }] });

  const replayed = Simulation.replay(simulation.exportCommandLog());
  assert.equal(replayed.saveMap(), simulation.saveMap());
  assert.deepEqual(replayed.authoringSnapshot(), simulation.authoringSnapshot());
  assert.deepEqual(Array.from(replayed.map.cells), Array.from(simulation.map.cells));
});
