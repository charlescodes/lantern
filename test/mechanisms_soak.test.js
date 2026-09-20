import test from "node:test";
import assert from "node:assert/strict";
import { ArenaScenario } from "../src/sim/scenario.js";
import { GridMap } from "../src/sim/grid_map.js";
import {
  createLayer,
  editMechanisms,
  paintStructureCells,
  placeElevatorConnector,
  placeInstance,
} from "../src/authoring/authoring_commands.js";
import { Simulation } from "../src/sim/simulation.js";
import { ENEMY_AI_PROFILE_NONE, GAMEPLAY_PROFILE_PRE_COMBAT } from "../src/config.js";

function soakScenario() {
  let document = new ArenaScenario(new GridMap(12, 12, undefined, { x: 1.5, z: 1.5 })).toAuthoringJSON();
  const upper = createLayer(document, "ground", "above", { baseY: 3 });
  document = upper.document;
  const elevator = placeElevatorConnector(document, 3.5, 8.5, {
    lowerLayerId: "ground", upperLayerId: upper.layerId, controlMode: "triggered",
    initialStop: "lower", travelDurationSeconds: 0.5, dwellSeconds: 0,
  });
  document = elevator.document;
  const place = (definitionId, x, z, options = {}) => {
    const placed = placeInstance(document, definitionId, x, z, options);
    document = placed.document; return placed.instanceId;
  };
  const wire = (fromId, fromPort, toId, toPort) => {
    document = editMechanisms(document, { type: "addMechanismLink",
      from: { nodeId: fromId, port: fromPort }, to: { nodeId: toId, port: toPort } });
  };
  const lever = place("mechanism.lever", 2.5, 2.5, { properties: { initialOn: true } });
  const mover = place("mechanism.mover", 5.5, 10.5, { rotation: 3,
    properties: { distanceCells: 2, speed: 8 } });
  const spikes = place("mechanism.floor-spikes", 9.5, 10.5);
  document = editMechanisms(document, { type: "addMechanismNode", definitionId: "logic.repeater",
    properties: { intervalTicks: 120 } });
  const repeater = document.mechanisms.nodes.at(-1).id;
  document = editMechanisms(document, { type: "addMechanismNode", definitionId: "logic.toggle", properties: {} });
  const toggle = document.mechanisms.nodes.at(-1).id;
  wire(lever, "on", repeater, "enabled");
  wire(repeater, "pulse", toggle, "toggle");
  wire(toggle, "on", mover, "positionB");
  wire(lever, "on", spikes, "extended");
  wire(repeater, "pulse", elevator.connectorId, "cycle");

  const anchors = [];
  for (let z = 3; z <= 8; z++) anchors.push({ cx: 10, cz: z });
  document = paintStructureCells(document, anchors, "structure.wall", "ground");
  for (let z = 3; z <= 8; z++) {
    const emitter = place("mechanism.bolt-emitter", 10.5, z + 0.5, { rotation: 1 });
    wire(repeater, "pulse", emitter, "fire");
  }
  return new ArenaScenario(document);
}

function run() {
  const simulation = new Simulation({ scenario: soakScenario(), particleBurstCount: 0,
    enemyAiProfile: ENEMY_AI_PROFILE_NONE, gameplayProfile: GAMEPLAY_PROFILE_PRE_COMBAT });
  for (let tick = 0; tick < 36_000; tick++) simulation.tick(null);
  return simulation;
}

test("36k-tick Pass B soak is bounded and deterministic across repeaters, fan-out, lifts, movers and bolts", () => {
  const first = run(), second = run();
  assert.deepEqual(second.snapshot(), first.snapshot());
  assert.ok(first.projectiles.activeCount <= first.projectiles.capacity);
  assert.ok(first.mechanisms.events.length <= 256);
  assert.ok(first.elevators.currentStop[0] === 0 || first.elevators.currentStop[0] === 1);
  assert.equal(first.movers.progress[0] === 0 || first.movers.progress[0] === 2, true);
});
