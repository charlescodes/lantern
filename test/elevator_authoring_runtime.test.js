import test from "node:test";
import assert from "node:assert/strict";

import { createLayer, paintSurface, placeElevatorConnector } from "../src/authoring/authoring_commands.js";
import { commandFromAuthoringAction } from "../src/authoring/authoring_history.js";
import { ArenaScenario } from "../src/sim/scenario.js";
import { GridMap } from "../src/sim/grid_map.js";
import { Simulation } from "../src/sim/simulation.js";
import { ENEMY_AI_PROFILE_NONE, GAMEPLAY_PROFILE_PRE_COMBAT } from "../src/config.js";

function twoFloorDocument() {
  let document = new ArenaScenario(
    new GridMap(12, 12, undefined, { x: 2.5, z: 2.5 }),
  ).toAuthoringJSON();
  const upper = createLayer(document, "ground", "above", { name: "Upper", baseY: 3 });
  document = upper.document;
  return { document, upperId: upper.layerId };
}

function simulation(document) {
  return new Simulation({
    scenario: new ArenaScenario(document),
    gameplayProfile: GAMEPLAY_PROFILE_PRE_COMBAT,
    enemyAiProfile: ENEMY_AI_PROFILE_NONE,
    particleBurstCount: 0,
  });
}

test("connector authoring commands immediately reconcile the live elevator pool", () => {
  const source = twoFloorDocument();
  const value = simulation(source.document);
  const place = commandFromAuthoringAction(value.authoringDocument(), {
    type: "placeConnector",
    x: 5.5,
    z: 5.5,
    lowerLayerId: "ground",
    upperLayerId: source.upperId,
  });
  value.tick({ type: "applyAuthoringCommand", command: place, direction: "forward" });
  assert.equal(value.lastError, null);
  assert.equal(value.authoringDocument().connectors.length, 1);
  assert.equal(value.snapshot().elevators.length, 1);

  value.tick({ type: "applyAuthoringCommand", command: place, direction: "reverse" });
  assert.equal(value.lastError, null);
  assert.equal(value.authoringDocument().connectors.length, 0);
  assert.equal(value.snapshot().elevators.length, 0);
});

test("editor layer activation remains independent from the player's runtime layer", () => {
  const source = twoFloorDocument();
  const document = paintSurface(source.document, 1, 1, "surface.breakaway", source.upperId);
  const value = simulation(document);
  value.tick({ type: "activateLayer", layerId: source.upperId });
  let snapshot = value.snapshot();
  assert.equal(snapshot.authoring.activeEditorLayerId, source.upperId);
  assert.equal(snapshot.runtimeLayerId, "ground");
  assert.equal(snapshot.map.layerId, "ground");
  assert.equal(snapshot.editorMap.layerId, source.upperId);
  assert.equal(snapshot.map.surface.legend[snapshot.map.surface.cells[13]], "surface.stone");
  assert.equal(snapshot.editorMap.surface.legend[snapshot.editorMap.surface.cells[13]], "surface.breakaway");
  value.tick(null);
  snapshot = value.snapshot();
  assert.equal(snapshot.authoring.activeEditorLayerId, source.upperId);
  assert.equal(snapshot.runtimeLayerId, "ground");
});

test("an occupied elevator cannot be removed through authoring history", () => {
  const source = twoFloorDocument();
  const placed = placeElevatorConnector(source.document, 5.5, 5.5, {
    lowerLayerId: "ground",
    upperLayerId: source.upperId,
  });
  placed.document.playerStart = { layerId: "ground", x: 5.5, z: 5.5 };
  const value = simulation(placed.document);
  value.tick(null);
  const command = commandFromAuthoringAction(value.authoringDocument(), {
    type: "removeConnector",
    connectorId: placed.connectorId,
  });
  value.tick({ type: "applyAuthoringCommand", command, direction: "forward" });
  assert.match(value.lastError, /cannot be edited while a body is riding/);
  assert.equal(value.authoringDocument().connectors.length, 1);
  assert.equal(value.snapshot().elevators.length, 1);
});
