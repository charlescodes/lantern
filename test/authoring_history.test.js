import test from "node:test";
import assert from "node:assert/strict";

import {
  applyAuthoringCommand,
  AuthoringHistory,
  commandFromAuthoringAction,
  createAuthoringCommand,
} from "../src/authoring/authoring_history.js";
import {
  paintStructure,
  placeInstance,
  removeInstance,
  updateInstanceProperties,
  updateInstanceTransform,
} from "../src/authoring/authoring_commands.js";
import { getPlaceableDefinition } from "../src/authoring/definition_catalog.js";
import { compileAuthoringMap } from "../src/authoring/map_compiler.js";
import { getOccupiedCells } from "../src/authoring/footprint.js";
import {
  ENEMY_AI_PROFILE_NONE,
  GAMEPLAY_PROFILE_PRE_COMBAT,
} from "../src/config.js";
import { GridMap } from "../src/sim/grid_map.js";
import { gridRayBlocked } from "../src/sim/collision.js";
import { ArenaScenario } from "../src/sim/scenario.js";
import { Simulation } from "../src/sim/simulation.js";
import { AuthoringEditorController } from "../src/browser/authoring_editor.js";
import { mergeCatalogPropLights } from "../src/presentation/catalog_lights.js";

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

function historyHarness(options = {}) {
  let document = options.document ?? sourceDocument();
  const history = new AuthoringHistory({
    capacity: options.capacity,
    apply(command, direction) {
      document = applyAuthoringCommand(document, command, direction);
      return { ok: true };
    },
  });
  return {
    history,
    document: () => document,
    execute(action) {
      return history.execute(commandFromAuthoringAction(document, action));
    },
  };
}

function controllerHarness(document = sourceDocument()) {
  const simulation = new Simulation({
    scenario: new ArenaScenario(document),
    gameplayProfile: GAMEPLAY_PROFILE_PRE_COMBAT,
    enemyAiProfile: ENEMY_AI_PROFILE_NONE,
    particleBurstCount: 0,
  });
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
    validatePlacement: (definitionId, x, z, rotation, ignoreId) => (
      simulation.validateInstanceTransform(definitionId, x, z, rotation, ignoreId)
    ),
    commit(action) {
      const result = history.execute(
        commandFromAuthoringAction(simulation.authoringDocument(), action),
      );
      return {
        ok: result.ok,
        error: result.error,
        snapshot: result.snapshot ?? simulation.snapshot(),
      };
    },
    historySnapshot: () => history.snapshot(),
    undo: () => history.undo(),
    redo: () => history.redo(),
  });
  return { simulation, history, controller };
}

test("apply, undo, and redo restore exact authoring documents", () => {
  const harness = historyHarness();
  const original = harness.document();
  const result = harness.execute({
    type: "paintSurfaceStroke",
    definitionId: "surface.moss",
    cells: [{ cx: 2, cz: 2 }, { cx: 3, cz: 2 }],
  });
  assert.equal(result.ok, true);
  assert.equal(result.recorded, true);
  const edited = harness.document();
  assert.notDeepEqual(edited, original);

  assert.equal(harness.history.undo().ok, true);
  assert.deepEqual(harness.document(), original);
  assert.equal(harness.history.redo().ok, true);
  assert.deepEqual(harness.document(), edited);
});

test("one stroke stores each revisited cell once with its original before value", () => {
  const harness = historyHarness();
  const original = harness.document();
  const command = commandFromAuthoringAction(original, {
    type: "paintSurfaceStroke",
    definitionId: "surface.moss",
    cells: [
      { cx: 2, cz: 2 },
      { cx: 3, cz: 2 },
      { cx: 2, cz: 2 },
      { cx: 2, cz: 2 },
    ],
  });
  const cells = command.patches.filter((patch) => patch.kind === "cell");
  assert.deepEqual(cells, [
    {
      kind: "cell",
      layerId: "ground",
      channel: "surface",
      cellIndex: 22,
      before: "surface.stone",
      after: "surface.moss",
    },
    {
      kind: "cell",
      layerId: "ground",
      channel: "surface",
      cellIndex: 23,
      before: "surface.stone",
      after: "surface.moss",
    },
  ]);
  assert.equal(harness.history.execute(command).recorded, true);
  assert.equal(harness.history.snapshot().undoDepth, 1);
});

test("a continuous controller stroke commits once and cancellation remains transient", () => {
  const { simulation, history, controller } = controllerHarness();
  controller.setDefinition("surface.moss");
  const original = simulation.saveMap();
  controller.pointerDown(0, 2.5, 2.5);
  controller.pointerMove(3.5, 2.5, true);
  controller.pointerMove(2.5, 2.5, true);
  controller.pointerMove(4.5, 2.5, true);
  assert.equal(controller.snapshot().history.transactionActive, true);
  assert.equal(history.snapshot().undoDepth, 0);
  assert.equal(controller.pointerUp(0, 4.5, 2.5, { moved: true }), true);
  assert.equal(history.snapshot().undoDepth, 1);

  assert.equal(controller.undo(), true);
  assert.equal(simulation.saveMap(), original);
  assert.equal(controller.redo(), true);

  const beforeCanceledStroke = simulation.saveMap();
  controller.pointerDown(0, 5.5, 2.5);
  controller.pointerMove(6.5, 2.5, true);
  assert.equal(controller.cancel(), true);
  assert.equal(simulation.saveMap(), beforeCanceledStroke);
  assert.equal(history.snapshot().undoDepth, 1);

  controller.pointerDown(0, 5.5, 2.5);
  assert.equal(controller.undo(), false, "first shortcut cancels the active gesture");
  assert.equal(history.snapshot().undoDepth, 1);
  assert.equal(controller.snapshot().history.transactionActive, false);
});

test("history traversal reconciles selection without recording it", () => {
  const { simulation, history, controller } = controllerHarness();
  controller.setDefinition("object.table");
  controller.pointerMove(3.5, 3.5, true);
  controller.pointerDown(0, 3.5, 3.5);
  assert.equal(controller.pointerUp(0, 3.5, 3.5), true);
  const selected = controller.snapshot().selectedTarget;
  assert.equal(selected.kind, "instance");
  const instanceId = selected.instanceId;
  assert.equal(history.snapshot().undoDepth, 1);

  assert.equal(controller.undo(), true);
  assert.equal(controller.snapshot().selectedTarget, null);
  assert.equal(simulation.getAuthoredInstance(instanceId), null);
  assert.equal(controller.redo(), true);
  assert.equal(simulation.getAuthoredInstance(instanceId).id, instanceId);
  assert.equal(history.snapshot().undoDepth, 1);
});

test("no-op and malformed commands neither enter history nor invalidate redo", () => {
  const harness = historyHarness();
  harness.execute({
    type: "paintSurface",
    definitionId: "surface.moss",
    cx: 2,
    cz: 2,
  });
  harness.history.undo();
  assert.equal(harness.history.snapshot().canRedo, true);

  const noOp = commandFromAuthoringAction(harness.document(), {
    type: "paintSurface",
    definitionId: "surface.stone",
    cx: 2,
    cz: 2,
  });
  assert.equal(noOp, null);
  assert.deepEqual(harness.history.execute(noOp), {
    ok: true,
    recorded: false,
    error: null,
    snapshot: undefined,
  });
  assert.equal(harness.history.snapshot().canRedo, true);

  const invalid = harness.history.execute({ label: "Broken", patches: "not an array" });
  assert.equal(invalid.ok, false);
  assert.equal(harness.history.snapshot().canRedo, true);
});

test("surface, structure, and instance erasure are exact and reversible", () => {
  let document = sourceDocument();
  document = applyAuthoringCommand(
    document,
    commandFromAuthoringAction(document, {
      type: "paintSurface",
      definitionId: "surface.moss",
      cx: 2,
      cz: 2,
    }),
  );
  document = applyAuthoringCommand(
    document,
    commandFromAuthoringAction(document, {
      type: "paintStructure",
      definitionId: "structure.wall",
      cx: 3,
      cz: 3,
    }),
  );
  const placed = placeInstance(document, "object.torch", 5.5, 5.5, {
    properties: { flame: "ember", fuel: 12 },
  });
  document = placed.document;
  const harness = historyHarness({ document });

  for (const action of [
    { type: "eraseSurface", cx: 2, cz: 2 },
    { type: "eraseStructure", cx: 3, cz: 3 },
    { type: "removeInstance", authoringId: placed.instanceId },
  ]) {
    const before = harness.document();
    assert.equal(harness.execute(action).ok, true);
    assert.equal(harness.history.undo().ok, true);
    assert.deepEqual(harness.document(), before);
    assert.equal(harness.history.redo().ok, true);
  }
});

test("instance placement and deletion preserve stable ID, properties, transform, and order", () => {
  const harness = historyHarness();
  harness.execute({
    type: "placeInstance",
    definitionId: "object.torch",
    x: 3.5,
    z: 3.5,
    rotation: 2,
    properties: { color: "orange", nested: { fuel: 4 } },
  });
  const placed = harness.document().layers[0].instances[0];
  assert.equal(harness.history.undo().ok, true);
  assert.equal(harness.document().layers[0].instances.length, 0);
  assert.equal(harness.history.redo().ok, true);
  assert.deepEqual(harness.document().layers[0].instances[0], placed);

  harness.execute({
    type: "placeInstance",
    definitionId: "object.pillar",
    x: 6.5,
    z: 6.5,
    rotation: 0,
  });
  const beforeDelete = harness.document();
  assert.equal(harness.execute({ type: "removeInstance", authoringId: placed.id }).ok, true);
  assert.equal(harness.history.undo().ok, true);
  assert.deepEqual(harness.document(), beforeDelete);
  assert.deepEqual(
    harness.document().layers[0].instances.map((instance) => instance.id),
    beforeDelete.layers[0].instances.map((instance) => instance.id),
  );
});

test("move, rotation, and property submissions are separate reversible commands", () => {
  const placed = placeInstance(sourceDocument(), "object.table", 3.5, 3.5, {
    properties: { finish: "plain" },
  });
  const harness = historyHarness({ document: placed.document });
  const id = placed.instanceId;

  assert.equal(harness.execute({
    type: "updateInstanceTransform",
    authoringId: id,
    x: 5.5,
    z: 3.5,
    rotation: 0,
  }).ok, true);
  assert.equal(harness.execute({
    type: "updateInstanceTransform",
    authoringId: id,
    x: 5.5,
    z: 3.5,
    rotation: 1,
  }).ok, true);
  assert.equal(harness.execute({
    type: "updateInstanceProperties",
    authoringId: id,
    properties: { finish: "mossy", note: [1, 2] },
  }).ok, true);
  assert.equal(harness.history.snapshot().undoDepth, 3);

  harness.history.undo();
  assert.deepEqual(harness.document().layers[0].instances[0].properties, { finish: "plain" });
  harness.history.undo();
  assert.equal(harness.document().layers[0].instances[0].rotation, 0);
  harness.history.undo();
  assert.deepEqual(
    { x: harness.document().layers[0].instances[0].x, z: harness.document().layers[0].instances[0].z },
    { x: 3.5, z: 3.5 },
  );
});

test("new edits invalidate redo and capacity pruning retains a coherent boundary", () => {
  const harness = historyHarness({ capacity: 2 });
  harness.execute({ type: "paintSurface", definitionId: "surface.moss", cx: 2, cz: 2 });
  harness.execute({ type: "paintSurface", definitionId: "surface.moss", cx: 3, cz: 2 });
  harness.execute({ type: "paintSurface", definitionId: "surface.moss", cx: 4, cz: 2 });
  assert.equal(harness.history.snapshot().undoDepth, 2);
  assert.equal(harness.history.undo().ok, true);
  assert.equal(harness.history.snapshot().redoDepth, 1);
  harness.execute({ type: "paintSurface", definitionId: "surface.moss", cx: 5, cz: 2 });
  assert.equal(harness.history.snapshot().canRedo, false);
  assert.equal(harness.history.snapshot().undoDepth, 2);
  assert.equal(harness.history.undo().ok, true);
  assert.equal(harness.history.undo().ok, true);
  assert.equal(harness.history.undo().ok, false);
});

test("saved revision identity tracks undo, redo, branch changes, and clear", () => {
  const harness = historyHarness();
  assert.equal(harness.history.snapshot().dirty, false);
  harness.execute({ type: "paintSurface", definitionId: "surface.moss", cx: 2, cz: 2 });
  harness.history.markSaved();
  const saved = harness.history.snapshot().savedRevisionId;
  assert.equal(harness.history.snapshot().dirty, false);
  harness.execute({ type: "paintSurface", definitionId: "surface.moss", cx: 3, cz: 2 });
  assert.equal(harness.history.snapshot().dirty, true);
  harness.history.undo();
  assert.equal(harness.history.snapshot().dirty, false);
  assert.equal(harness.history.snapshot().currentRevisionId, saved);
  harness.history.undo();
  assert.equal(harness.history.snapshot().dirty, true);
  harness.history.redo();
  assert.equal(harness.history.snapshot().dirty, false);
  harness.history.redo();
  assert.equal(harness.history.snapshot().dirty, true);
  harness.history.clear();
  assert.equal(harness.history.snapshot().dirty, false);
  assert.equal(harness.history.snapshot().undoDepth, 0);
});

test("only a successful save advances the clean checkpoint", () => {
  const harness = historyHarness();
  harness.execute({ type: "paintSurface", definitionId: "surface.moss", cx: 2, cz: 2 });
  const checkpoint = harness.history.snapshot().savedRevisionId;
  const failedSave = () => {
    throw new Error("synthetic download failure");
  };
  assert.throws(failedSave, /synthetic download failure/);
  assert.equal(harness.history.snapshot().savedRevisionId, checkpoint);
  assert.equal(harness.history.snapshot().dirty, true);

  const serialized = JSON.stringify(harness.document());
  assert.ok(serialized.length > 0);
  harness.history.markSaved();
  assert.equal(harness.history.snapshot().dirty, false);
});

test("simulation reset and authored-position restoration do not clear editor history", () => {
  const { simulation, history, controller } = controllerHarness();
  controller.setDefinition("surface.moss");
  controller.pointerDown(0, 2.5, 2.5);
  controller.pointerUp(0, 2.5, 2.5);
  const before = history.snapshot();
  simulation.reset();
  assert.equal(history.snapshot().undoDepth, before.undoDepth);
  assert.equal(history.snapshot().dirty, before.dirty);
  simulation.tick({ type: "restoreScenario" });
  assert.equal(history.snapshot().undoDepth, before.undoDepth);
  assert.equal(history.snapshot().dirty, before.dirty);
});

test("failed replay is atomic and leaves the history cursor unchanged", () => {
  let document = sourceDocument();
  let rejectUndo = false;
  const history = new AuthoringHistory({
    apply(command, direction) {
      if (rejectUndo && direction === "reverse") return { ok: false, error: "synthetic failure" };
      document = applyAuthoringCommand(document, command, direction);
      return true;
    },
  });
  const command = commandFromAuthoringAction(document, {
    type: "paintSurface",
    definitionId: "surface.moss",
    cx: 2,
    cz: 2,
  });
  history.execute(command);
  const edited = structuredClone(document);
  rejectUndo = true;
  const result = history.undo();
  assert.equal(result.ok, false);
  assert.equal(history.snapshot().undoDepth, 1);
  assert.deepEqual(document, edited);
});

test("history snapshots cannot be mutated through the apply callback", () => {
  let document = sourceDocument();
  const history = new AuthoringHistory({
    apply(command, direction) {
      document = applyAuthoringCommand(document, command, direction);
      command.label = "mutated outside";
      command.patches[0].before = "surface.missing";
      return true;
    },
  });
  const command = commandFromAuthoringAction(document, {
    type: "paintSurface",
    definitionId: "surface.moss",
    cx: 2,
    cz: 2,
  });
  assert.equal(history.execute(command).ok, true);
  assert.equal(history.snapshot().nextUndoLabel, "Paint Moss floor");
  assert.equal(history.undo().ok, true);
  assert.equal(history.snapshot().canRedo, true);
});

test("history records never leak into serialized authoring maps", () => {
  const harness = historyHarness();
  harness.execute({ type: "paintSurface", definitionId: "surface.moss", cx: 2, cz: 2 });
  const serialized = JSON.stringify(harness.document());
  assert.doesNotMatch(serialized, /undoDepth|savedRevisionId|authoring-revision|patches/);
});

test("simulation applies history commands through compilation and exact runtime reconstruction", () => {
  const simulation = new Simulation({
    scenario: new ArenaScenario(sourceDocument()),
    gameplayProfile: GAMEPLAY_PROFILE_PRE_COMBAT,
    enemyAiProfile: ENEMY_AI_PROFILE_NONE,
    particleBurstCount: 0,
  });
  const command = commandFromAuthoringAction(simulation.authoringDocument(), {
    type: "placeInstance",
    definitionId: "object.table",
    x: 3.5,
    z: 3.5,
    rotation: 0,
  });
  simulation.tick({ type: "applyAuthoringCommand", command, direction: "forward" });
  assert.equal(simulation.lastError, null);
  const instance = simulation.authoringSnapshot().instances[0];
  const body = simulation.snapshot().rocks.find((item) => item.authoringId === instance.id);
  assert.ok(body);
  assert.equal(instance.definitionId, "object.table");

  simulation.tick({ type: "applyAuthoringCommand", command, direction: "reverse" });
  assert.equal(simulation.lastError, null);
  assert.equal(simulation.authoringSnapshot().instances.length, 0);
  assert.equal(simulation.snapshot().rocks.length, 0);

  simulation.tick({ type: "applyAuthoringCommand", command, direction: "forward" });
  assert.equal(simulation.authoringSnapshot().instances[0].id, instance.id);
  assert.equal(simulation.snapshot().rocks.length, 1);
  const replayed = Simulation.replay(simulation.exportCommandLog());
  assert.equal(replayed.lastError, null);
  assert.equal(replayed.saveMap(), simulation.saveMap());
  assert.equal(replayed.snapshot().rocks.length, 1);
});

test("undo and redo rebuild runtime collision and occlusion masks", () => {
  const simulation = new Simulation({
    scenario: new ArenaScenario(sourceDocument()),
    gameplayProfile: GAMEPLAY_PROFILE_PRE_COMBAT,
    enemyAiProfile: ENEMY_AI_PROFILE_NONE,
    particleBurstCount: 0,
  });
  const command = commandFromAuthoringAction(simulation.authoringDocument(), {
    type: "paintStructureStroke",
    definitionId: "structure.wall",
    cells: [{ cx: 4, cz: 4 }, { cx: 5, cz: 4 }],
  });
  simulation.tick({ type: "applyAuthoringCommand", command, direction: "forward" });
  assert.equal(simulation.map.get(4, 4), 1);
  assert.equal(simulation.snapshot().map.occluderCells[4 * simulation.map.width + 4], 1);
  simulation.tick({ type: "applyAuthoringCommand", command, direction: "reverse" });
  assert.equal(simulation.map.get(4, 4), 0);
  assert.equal(simulation.snapshot().map.occluderCells[4 * simulation.map.width + 4], 0);
  simulation.tick({ type: "applyAuthoringCommand", command, direction: "forward" });
  assert.equal(simulation.map.get(5, 4), 1);
  assert.equal(simulation.snapshot().map.occluderCells[4 * simulation.map.width + 5], 1);
});

test("table history rebuilds preserve blocking physics without creating sight occlusion", () => {
  const before = sourceDocument();
  const command = commandFromAuthoringAction(before, {
    type: "placeInstance",
    definitionId: "object.table",
    x: 3.5,
    z: 3.5,
    rotation: 1,
  });
  const after = applyAuthoringCommand(before, command, "forward");
  const compiled = compileAuthoringMap(after);
  const table = after.layers[0].instances[0];
  const occupied = compiled.runtimeMappings.find(
    (mapping) => mapping.authoringId === table.id,
  );
  assert.equal(getPlaceableDefinition("object.table").traits.blocksMovement, true);
  assert.equal(getPlaceableDefinition("object.table").traits.blocksSight, false);
  assert.deepEqual(occupied.collisionCells, [], "the movable table remains a runtime body");
  assert.equal(compiled.entities[0].collider, "box");
  assert.equal(compiled.entities[0].fixedRotation, true);
  assert.equal(gridRayBlocked(compiled.map, 2.5, 3.5, 7.5, 3.5), false);
  for (const cell of getOccupiedCells(getPlaceableDefinition("object.table"), table)) {
    assert.equal(compiled.occluderMask[cell.cz * compiled.map.width + cell.cx], 0);
  }

  const walled = compileAuthoringMap(paintStructure(before, 5, 3, "structure.wall"));
  assert.equal(gridRayBlocked(walled.map, 2.5, 3.5, 7.5, 3.5), true);
  const pillar = placeInstance(before, "object.pillar", 5.5, 3.5).document;
  assert.equal(gridRayBlocked(compileAuthoringMap(pillar).map, 2.5, 3.5, 7.5, 3.5), true);
});

test("repeated torch undo and redo produces exactly one body and one following light", () => {
  const simulation = new Simulation({
    scenario: new ArenaScenario(sourceDocument()),
    gameplayProfile: GAMEPLAY_PROFILE_PRE_COMBAT,
    enemyAiProfile: ENEMY_AI_PROFILE_NONE,
    particleBurstCount: 0,
  });
  const command = commandFromAuthoringAction(simulation.authoringDocument(), {
    type: "placeInstance",
    definitionId: "object.torch",
    x: 4.5,
    z: 4.5,
    rotation: 0,
  });
  for (let cycle = 0; cycle < 8; cycle += 1) {
    simulation.tick({ type: "applyAuthoringCommand", command, direction: "forward" });
    assert.equal(simulation.lastError, null);
    let bodies = simulation.snapshot().rocks.filter((body) => body.definitionId === "object.torch");
    assert.equal(bodies.length, 1);
    let lights = mergeCatalogPropLights([], bodies, 16)
      .filter((light) => light.kind === "catalog-prop");
    assert.equal(lights.length, 1);
    assert.equal(lights[0].authoringId, bodies[0].authoringId);
    assert.equal(lights[0].x, bodies[0].x);

    simulation.tick({ type: "applyAuthoringCommand", command, direction: "reverse" });
    assert.equal(simulation.lastError, null);
    bodies = simulation.snapshot().rocks.filter((body) => body.definitionId === "object.torch");
    lights = mergeCatalogPropLights([], bodies, 16)
      .filter((light) => light.kind === "catalog-prop");
    assert.equal(bodies.length, 0);
    assert.equal(lights.length, 0);
  }
});

test("live rock, table, and torch motion neither enters history nor changes authored starts", () => {
  let source = placeInstance(sourceDocument(), "object.rock.small", 3.5, 5.5).document;
  source = placeInstance(source, "object.table", 5.5, 5.5).document;
  source = placeInstance(source, "object.torch", 8.5, 5.5).document;
  const { simulation, history } = controllerHarness(source);
  const authoredBefore = simulation.authoringDocument();
  const runtimeBefore = simulation.snapshot().rocks.map((body) => body.x);
  for (let index = 0; index < simulation.rocks.activeCount; index += 1) {
    simulation.rocks.vx[index] = 2;
  }
  simulation.tick(null);
  assert.equal(history.snapshot().undoDepth, 0);
  assert.equal(history.snapshot().dirty, false);
  assert.deepEqual(simulation.authoringDocument(), authoredBefore);
  assert.equal(
    simulation.snapshot().rocks.some((body, index) => body.x !== runtimeBefore[index]),
    true,
  );
});
