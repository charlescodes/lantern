import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ElevatorPool, ELEVATOR_MOTION } from "../src/sim/elevator_pool.js";
import { Simulation } from "../src/sim/simulation.js";
import { ArenaScenario } from "../src/sim/scenario.js";
import { loadAuthoringMap } from "../src/authoring/authoring_map.js";
import { updateConnector, editMechanisms, removeConnector } from "../src/authoring/authoring_commands.js";
import { commandFromAuthoringAction, applyAuthoringCommand } from "../src/authoring/authoring_history.js";

test("genuine v24 fixtures retain gameplay, mechanism clocks and connector edits", () => {
  const fixture = JSON.parse(readFileSync(new URL("./fixtures/mechanisms-legacy-v24.json", import.meta.url)));
  for (const { recording, expected } of fixture.cases) {
    const result = Simulation.replay(recording).snapshot();
    for (const [key, value] of Object.entries(expected)) assert.deepEqual(result[key], value, key);
  }
});

function pool(mode = "triggered") {
  const value = new ElevatorPool(2);
  value.spawn({ authoringId: "lift", lowerLayerIndex: 0, upperLayerIndex: 1, x: 3.5, z: 3.5,
    platformWidth: 0.9, apertureWidth: 0.9, lowerY: 0, upperY: 3,
    travelDurationSeconds: 1, dwellTicks: 2, initialStop: "lower", controlMode: mode });
  return value;
}

test("triggered lifts hold indefinitely, arbitrate calls and bank only one unstoppable return", () => {
  const value = pool();
  for (let i = 0; i < 600; i++) value.step(1 / 60);
  assert.equal(value.worldY[0], 0);
  value.mechanismRequest(0, true, true, true); value.step(1 / 60);
  assert.equal(value.motion[0], ELEVATOR_MOTION.ASCENDING);
  const y = value.worldY[0];
  value.mechanismRequest(0, true, false, false);
  value.mechanismRequest(0, false, true, true);
  value.step(1 / 60); assert.ok(value.worldY[0] > y);
  assert.equal(value.hasDebugRequest[0], 1);
  for (let i = 0; i < 59; i++) value.step(1 / 60);
  assert.equal(value.currentStop[0], 1);
  while (value.motion[0] === ELEVATOR_MOTION.DWELLING) value.step(1 / 60);
  assert.equal(value.motion[0], ELEVATOR_MOTION.DESCENDING);
  for (let i = 0; i < 700; i++) value.step(1 / 60);
  assert.equal(value.worldY[0], 0); assert.equal(value.hasDebugRequest[0], 0);
  value.cycle(0); value.step(1 / 60); assert.ok(value.worldY[0] > 0);
});

test("triggered connector is one wired node; mode/delete cascade is undoable and travel arcs are excluded", () => {
  let document = loadAuthoringMap(JSON.parse(readFileSync(new URL("../maps/elevator.json", import.meta.url))));
  const id = document.connectors[0].id;
  document = updateConnector(document, id, { controlMode: "triggered" });
  document = editMechanisms(document, { type: "addMechanismNode", definitionId: "logic.repeater", properties: { intervalTicks: 60 } });
  document = editMechanisms(document, { type: "addMechanismLink", from: { nodeId: "logic-0001", port: "pulse" }, to: { nodeId: id, port: "cycle" } });
  const value = new Simulation({ scenario: new ArenaScenario(document), particleBurstCount: 0 });
  assert.equal(value.mechanisms.compiled.nodes.filter(n => n.id === id).length, 1);
  assert.equal(value.navigationTopology.describe().arcs.filter(a => a.kind === "elevator").length, 0);
  const node = value.mechanisms.byId.get(id);
  assert.equal(value.mechanisms.values[node.outputs.atLower], 1);
  for (let i = 0; i < 600; i++) value.tick(null);
  assert.equal(value.elevators.worldY[0], value.elevators.lowerY[0]);
  assert.deepEqual(Simulation.replay(value.exportCommandLog()).snapshot(), value.snapshot());
  const change = commandFromAuthoringAction(document, { type: "updateConnector", connectorId: id, changes: { controlMode: "autonomous" } });
  const after = applyAuthoringCommand(document, change);
  assert.equal(after.mechanisms.links.length, 0);
  assert.deepEqual(applyAuthoringCommand(after, change, "reverse"), document);
  assert.equal(removeConnector(document, id).mechanisms.links.length, 0);
  assert.throws(() => updateConnector(document, id, { controlMode: "typo" }), /Control mode/);
});

test("triggered lift publishes each arrival edge once while dwelling", () => {
  const document = loadAuthoringMap(JSON.parse(readFileSync(new URL("../maps/mechanisms-pass-b.json", import.meta.url))));
  const elevatorId = document.connectors[0].id;
  const sourceId = document.mechanisms.links.find(link => link.to.nodeId === elevatorId && link.to.port === "cycle").from.nodeId;
  const value = new Simulation({ scenario: new ArenaScenario(document), particleBurstCount: 0 });
  value.mechanisms.write(sourceId, "changed");
  for (let tick = 0; tick < 240; tick++) value.tick(null);
  assert.equal(value.mechanisms.events.toArray().filter(event => event.nodeId === elevatorId && event.kind === "arrivedUpper").length, 1);
});
