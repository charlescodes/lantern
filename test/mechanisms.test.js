import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { GridMap } from "../src/sim/grid_map.js";
import { ArenaScenario } from "../src/sim/scenario.js";
import { Simulation } from "../src/sim/simulation.js";
import { MechanismRuntime } from "../src/sim/mechanisms.js";
import { compileMechanisms, MECHANISM_LIMITS } from "../src/authoring/mechanism_catalog.js";
import { loadAuthoringMap, validateAuthoringMap } from "../src/authoring/authoring_map.js";
import { placeInstance, removeInstance, editMechanisms, paintStructure, createLayer, placeNavigationNode, placeNavigationLink } from "../src/authoring/authoring_commands.js";
import { applyAuthoringCommand, commandFromAuthoringAction } from "../src/authoring/authoring_history.js";
import { ENEMY_AI_PROFILE_NONE, GAMEPLAY_PROFILE_PRE_COMBAT } from "../src/config.js";
import { AuthoringEditorController } from "../src/browser/authoring_editor.js";
import { mechanismWires, mechanismVisual, visibleMechanismInstances } from "../src/presentation/mechanism_view.js";

function blank() { return new ArenaScenario(new GridMap(12, 12, undefined, { x: 2.5, z: 5.5 })).toAuthoringJSON(); }
function sim(document, extra = {}) { return new Simulation({ scenario: new ArenaScenario(document),
  gameplayProfile: GAMEPLAY_PROFILE_PRE_COMBAT, enemyAiProfile: ENEMY_AI_PROFILE_NONE, particleBurstCount: 0, ...extra }); }
function place(document, definitionId, x, z, properties = {}, rotation = 0) {
  const result = placeInstance(document, definitionId, x, z, { rotation, properties });
  const node = result.document.layers[0].instances.at(-1);
  node.properties = properties;
  return { document: validateAuthoringMap(result.document), id: node.id };
}
function wire(document, from, output, to, input) {
  return editMechanisms(document, { type: "addMechanismLink", from: { nodeId: from, port: output }, to: { nodeId: to, port: input } });
}
function plateGate() {
  const plate = place(blank(), "object.pressure-plate", 2.5, 5.5);
  const gate = place(plate.document, "mechanism.gate", 6.5, 5.5);
  return { document: wire(gate.document, plate.id, "pressed", gate.id, "open"), plate: plate.id, gate: gate.id };
}

test("v7 migration is additive; graph links validate and cascade through undo/redo", () => {
  const old = blank(); old.version = 7; delete old.mechanisms;
  const next = loadAuthoringMap(old);
  assert.equal(next.version, 8); assert.deepEqual(next.mechanisms.nodes, []); assert.equal(old.version, 7);
  const puzzle = plateGate();
  const command = commandFromAuthoringAction(puzzle.document, { type: "removeInstance", authoringId: puzzle.plate });
  const deleted = applyAuthoringCommand(puzzle.document, command);
  assert.equal(deleted.mechanisms.links.length, 0);
  assert.deepEqual(applyAuthoringCommand(deleted, command, "reverse"), puzzle.document);
  assert.equal(removeInstance(puzzle.document, puzzle.gate).mechanisms.links.length, 0);
  const invalid = structuredClone(puzzle.document);
  invalid.mechanisms.links[0].from.port = "pressedEdge";
  assert.throws(() => validateAuthoringMap(invalid), /incompatible/);
  invalid.mechanisms.links[0].from.nodeId = "missing";
  assert.throws(() => validateAuthoringMap(invalid), /Missing endpoint/);
});

test("plate opens gates before the first snapshot; edges have one tick latency; closing stalls safely", () => {
  const puzzle = plateGate(), value = sim(puzzle.document);
  assert.equal(value.snapshot().mechanisms.devices[0].open, true);
  assert.equal(value.map.get(6, 5), 0);
  assert.equal(value.snapshot().map.occluderCells[5 * 12 + 6], 0);
  assert.equal(value.snapshot().mechanisms.recentEvents.length, 0);
  value.player.x = 6.5; value.player.previousX = 6.5;
  value.tick(null); value.tick(null);
  assert.equal(value.map.get(6, 5), 0, "never close around a player");
  assert.equal(value.snapshot().mechanisms.devices[0].blocked, true);
  value.player.x = 8.5; value.player.previousX = 8.5; value.tick(null);
  assert.equal(value.map.get(6, 5), 1);
  assert.equal(value.snapshot().map.occluderCells[5 * 12 + 6], 1);
  assert.equal(value.authoringDocument().layers[0].structure.cells[5 * 12 + 6], 0);
  value.reset(); assert.equal(value.map.get(6, 5), 0);
});

test("lever interaction is same-floor, range/facing/LOS constrained and replays exactly", () => {
  const lever = place(blank(), "mechanism.lever", 3.5, 5.5);
  const gate = place(lever.document, "mechanism.gate", 6.5, 5.5);
  const document = wire(gate.document, lever.id, "on", gate.id, "open");
  const value = sim(document);
  value.tick({ interact: true });
  assert.equal(value.map.get(6, 5), 1);
  value.tick(null); assert.equal(value.map.get(6, 5), 0);
  assert.deepEqual(Simulation.replay(value.exportCommandLog()).snapshot(), value.snapshot());
  value.player.movementDirectionX = -1;
  value.tick({ interact: true }); value.tick(null); assert.equal(value.map.get(6, 5), 0);
  value.reset(); assert.equal(value.map.get(6, 5), 1);
});

test("combinational ordering is stable; reject cycles, duplicate inputs, and limits", () => {
  let document = blank();
  document = editMechanisms(document, { type: "addMechanismNode", definitionId: "logic.not" });
  document = editMechanisms(document, { type: "addMechanismNode", definitionId: "logic.not" });
  document = wire(document, "logic-0001", "value", "logic-0002", "value");
  assert.throws(() => wire(document, "logic-0002", "value", "logic-0001", "value"), /cycle/);
  assert.throws(() => wire(document, "logic-0001", "value", "logic-0002", "value"), /already wired/);
  const runtime = new MechanismRuntime(document); runtime.evaluate(1);
  assert.equal(runtime.values[runtime.byId.get("logic-0002").outputs.value], 0);
  const reordered = structuredClone(document); reordered.mechanisms.nodes.reverse();
  assert.deepEqual(compileMechanisms(reordered), compileMechanisms(document));
  document.mechanisms.nodes = Array.from({ length: MECHANISM_LIMITS.logicNodes + 1 }, (_, i) => ({ id: `n${i}`, definitionId: "logic.not" }));
  assert.throws(() => compileMechanisms(document), /capacity/);
});

test("stateful clock boundaries, reset priority, coalescing, exact timer/repeater cadence and bounded diagnostics", () => {
  const plate = place(blank(), "object.pressure-plate", 2.5, 5.5);
  let document = plate.document;
  const definitions = ["logic.toggle", "logic.latch", "logic.delay", "logic.timer", "logic.repeater", "logic.counter"];
  for (const definitionId of definitions) document = editMechanisms(document, { type: "addMechanismNode", definitionId,
    properties: definitionId === "logic.delay" ? { delayTicks: 2 } : definitionId === "logic.timer" ? { durationTicks: 2 }
      : definitionId === "logic.repeater" ? { intervalTicks: 2 } : definitionId === "logic.counter" ? { threshold: 2 } : {} });
  for (const [id, input] of [["logic-0001", "toggle"], ["logic-0002", "set"], ["logic-0003", "pulse"], ["logic-0004", "start"], ["logic-0006", "pulse"]]) {
    document = wire(document, plate.id, "pressedEdge", id, input);
  }
  document = wire(document, plate.id, "releasedEdge", "logic-0001", "reset");
  document = wire(document, plate.id, "releasedEdge", "logic-0002", "reset");
  document = wire(document, plate.id, "releasedEdge", "logic-0004", "cancel");
  document = wire(document, plate.id, "pressed", "logic-0005", "enabled");
  const runtime = new MechanismRuntime(document);
  const output = (id, port) => Boolean(runtime.values[runtime.byId.get(id).outputs[port]]);
  runtime.write(plate.id, "pressed", true);
  runtime.write(plate.id, "pressedEdge"); runtime.write(plate.id, "pressedEdge");
  assert.equal(runtime.coalescedPulses, 1);
  runtime.evaluate(1);
  assert.equal(output("logic-0001", "on"), false, "stateful results publish on the following clock");
  runtime.evaluate(2);
  assert.equal(output("logic-0001", "on"), true);
  assert.equal(output("logic-0002", "on"), true);
  assert.equal(output("logic-0005", "pulse"), true);
  assert.equal(output("logic-0004", "active"), true);
  assert.equal(output("logic-0003", "pulse"), false);
  runtime.evaluate(3);
  assert.equal(output("logic-0003", "pulse"), true, "delay 2 outputs two clocks after acceptance");
  assert.equal(output("logic-0005", "pulse"), false);
  runtime.write(plate.id, "pressedEdge"); runtime.write(plate.id, "releasedEdge");
  runtime.evaluate(4);
  assert.equal(output("logic-0005", "pulse"), true);
  assert.equal(output("logic-0004", "elapsed"), true);
  runtime.evaluate(5);
  assert.equal(output("logic-0001", "on"), false, "reset wins");
  assert.equal(output("logic-0002", "on"), false);
  assert.equal(output("logic-0004", "active"), false);
  assert.equal(output("logic-0006", "reached"), true);
  assert.equal(output("logic-0006", "reachedEdge"), true);
  for (let i = 6; i < 1000; i += 1) runtime.evaluate(i);
  assert.equal(runtime.events.length, 256); assert.ok(runtime.overwrittenEvents > 0);
  assert.equal(runtime.snapshot().recentEvents.length, 64);
  const snapshot = runtime.snapshot(); snapshot.nodes[0].outputs.pressed = false;
  assert.equal(output(plate.id, "pressed"), true);
});

test("genuine schema-v23 fixture retains plate physics, events, and map; profile/capacities are pinned", async () => {
  const fixture = JSON.parse(await readFile(new URL("./fixtures/mechanisms-legacy-v23.json", import.meta.url), "utf8"));
  assert.equal(fixture.recording.schemaVersion, 23); assert.equal(fixture.recording.initialAuthoringMap.version, 7);
  const value = Simulation.replay(fixture.recording), snapshot = value.snapshot();
  assert.equal(snapshot.mechanismProfile, "none"); assert.equal(snapshot.mechanisms, null);
  assert.deepEqual({ player: snapshot.player, pressurePlates: snapshot.pressurePlates,
    recentPressurePlateEvents: snapshot.recentPressurePlateEvents, mapCells: snapshot.map.cells }, fixture.expected);
  const recording = sim(plateGate().document).exportCommandLog();
  recording.configuration.mechanismCapacities.links += 1;
  assert.throws(() => Simulation.replay(recording), /pinned capacities/);
});

test("wall orientation, player use, projectile button activation and chain projectile immunity", () => {
  const document = paintStructure(blank(), 5, 5, "structure.wall");
  for (let rotation = 0; rotation < 4; rotation++) {
    assert.doesNotThrow(() => place(document, "mechanism.button", 5.5, 5.5, {}, rotation));
  }
  const blocked = paintStructure(document, 5, 6, "structure.wall");
  assert.throws(() => place(blocked, "mechanism.button", 5.5, 5.5), /outward cell/);
  for (const definition of ["mechanism.button", "mechanism.chain"]) {
    const control = place(document, definition, 5.5, 5.5, {}, 1);
    const value = sim(control.document);
    value.tick({ cast: { x: 5.5, z: 5.5 } });
    for (let i = 0; i < 50; i++) value.tick(null);
    const events = value.snapshot().mechanisms.recentEvents;
    assert.equal(events.some((e) => e.kind === "pressed"), definition === "mechanism.button");
    assert.equal(events.some((e) => e.kind === "pulled"), false);
    assert.ok(value.snapshot().recentEvents.length > 0, "normal Fireball impact still occurs");
    if (definition === "mechanism.chain") {
      value.player.x = 4.1; value.player.previousX = 4.1;
      value.tick({ interact: true });
      assert.ok(value.snapshot().mechanisms.recentEvents.some((e) => e.kind === "pulled"));
    }
  }
});

test("a body entering a wall button presses once until it leaves, including propelled rocks", () => {
  let document = paintStructure(blank(), 5, 5, "structure.wall");
  const button = place(document, "mechanism.button", 5.5, 5.5, {}, 1);
  document = place(button.document, "object.rock.small", 3.5, 3.5).document;
  const value = sim(document);
  value.rocks.x[0] = 4.7; value.rocks.z[0] = 5.5; value.rocks.vx[0] = 8;
  for (let i = 0; i < 4; i++) value.tick(null);
  assert.equal(value.snapshot().mechanisms.recentEvents.filter((e) => e.kind === "pressed").length, 1);
  value.rocks.x[0] = 3.5; value.tick(null);
  value.rocks.x[0] = 4.7; value.rocks.vx[0] = 8; value.tick(null);
  assert.equal(value.snapshot().mechanisms.recentEvents.filter((e) => e.kind === "pressed").length, 2);
});

test("mechanism edits reject occupied initially-solid gates atomically and preserve unrelated bodies/state", () => {
  const lever = place(blank(), "mechanism.lever", 3.5, 5.5);
  const gate = place(lever.document, "mechanism.gate", 6.5, 5.5);
  const document = wire(gate.document, lever.id, "on", gate.id, "open");
  const value = sim(document);
  value.tick({ interact: true }); value.tick(null);
  const command = commandFromAuthoringAction(value.authoringDocument(), { type: "renameLayer", layerId: "ground", name: "Renamed" });
  value.tick({ type: "applyAuthoringCommand", command });
  assert.equal(value.snapshot().mechanisms.devices.find((d) => d.id === gate.id).open, true, "unrelated edit retains lever state");
  value.player.x = 6.5; value.player.previousX = 6.5;
  const before = value.authoringDocument();
  const edit = commandFromAuthoringAction(before, { type: "addMechanismNode", definitionId: "logic.not" });
  value.tick({ type: "applyAuthoringCommand", command: edit });
  assert.match(value.lastError, /overlap/);
  assert.deepEqual(value.authoringDocument(), before);
  assert.equal(value.player.x, 6.5);
});

test("editor wires physical and logic nodes without JSON and retains cross-floor source selection", () => {
  const plate = place(blank(), "object.pressure-plate", 2.5, 5.5);
  const layer = createLayer(plate.document, "ground", "above");
  const gate = placeInstance(layer.document, "mechanism.gate", 6.5, 5.5, { layerId: layer.layerId });
  const gateId = gate.document.layers[1].instances[0].id;
  const value = sim(gate.document);
  const editor = new AuthoringEditorController({ snapshot: value.snapshot(), validatePlacement: () => ({ valid: true }),
    activateLayer: (id) => { value.activateRuntimeLayer(id); return { ok: true, snapshot: value.snapshot() }; },
    commit: (action) => {
      const command = commandFromAuthoringAction(value.authoringDocument(), action);
      value.tick({ type: "applyAuthoringCommand", command });
      return { ok: !value.lastError, error: value.lastError, snapshot: value.snapshot() };
    } });
  editor.setTool("wire"); editor.selectMechanism(plate.id);
  editor.activateLayer(layer.layerId);
  assert.equal(editor.snapshot().wireSource, plate.id);
  assert.equal(editor.selectMechanism(gateId), true);
  assert.equal(value.authoringDocument().mechanisms.links.length, 1);
  assert.equal(value.snapshot().mechanisms.devices.find((d) => d.id === gateId).open, true);
  assert.equal(editor.editMechanism({ type: "addMechanismNode", definitionId: "logic.toggle" }), true);
  editor.selectMechanism(plate.id); editor.selectMechanism("logic-0001");
  assert.equal(editor.snapshot().wirePairs.length, 4, "ambiguous pulse ports require explicit selection");
  assert.equal(editor.completeWire("pressedEdge", "toggle"), true);
  editor.setTool("select");
  editor.selectMechanism("logic-0001");
  editor.selectInstance(gateId);
  assert.equal(editor.snapshot().selectedMechanismId, gateId, "world selection replaces panel selection");
  const wires = mechanismWires(value.snapshot().authoring, gateId);
  assert.ok(wires.badges.length > 0);
  assert.equal(mechanismVisual({ definitionId: "mechanism.gate", x: 1, z: 1 }, { open: true }).height, 0.07);
});

test("authored navigation can describe a route through a gate while runtime collision stays closed", () => {
  const map = new GridMap(12, 12, undefined, { x: 2.5, z: 5.5 });
  for (let z = 0; z < 12; z++) if (z !== 5) map.set(6, z, 1);
  let document = place(new ArenaScenario(map).toAuthoringJSON(), "mechanism.gate", 6.5, 5.5).document;
  document = placeNavigationNode(document, 3, 5).document;
  document = placeNavigationNode(document, 8, 5).document;
  document = placeNavigationLink(document, { kind: "node", nodeId: document.navigationNodes[0].id },
    { kind: "node", nodeId: document.navigationNodes[1].id }).document;
  const value = sim(document);
  assert.equal(value.map.get(6, 5), 1);
  assert.ok(value.navigationTopology.arcCount > 0);
});

test("exact interaction boundary and stable ID ties; player-only plate filters", () => {
  const first = place(blank(), "mechanism.lever", 3.5, 4.5);
  const second = place(first.document, "mechanism.lever", 3.5, 6.5);
  const value = sim(second.document);
  value.player.x = 3; value.player.previousX = 3;
  // Both are in range, but outside the facing cone until facing toward +Z.
  value.tick({ interact: true });
  assert.ok(value.mechanismDevices.every((d) => !d.on));
  value.player.x = 2.8; value.tick({ interact: true });
  assert.equal(value.mechanismDevices.find((d) => d.id === first.id).on, true);
  assert.equal(value.mechanismDevices.find((d) => d.id === second.id).on, false, "equal distances choose the stable ID");
  value.reset();
  value.player.x = 3.5; value.player.z = 3.25;
  value.player.movementDirectionX = 0; value.player.movementDirectionZ = 1;
  value.tick({ interact: true });
  assert.equal(value.mechanismDevices.find((d) => d.id === first.id).on, true, "inclusive 1.25m range");
  value.player.z = 3.249; value.tick({ interact: true });
  assert.equal(value.mechanismDevices.find((d) => d.id === first.id).on, true);
  const plate = place(blank(), "object.pressure-plate", 2.5, 5.5, { player: false, enemy: false, prop: false, corpse: false });
  assert.equal(sim(plate.document).snapshot().pressurePlates[0].pressed, false);
  const oldProfile = sim(plate.document, { mechanismProfile: "none" }); oldProfile.tick(null);
  assert.equal(oldProfile.snapshot().pressurePlates[0].pressed, true, "legacy profile keeps historical activation");
});

test("mechanism acceptance map runs a deterministic bounded repeater/fan-out soak", async () => {
  const document = JSON.parse(await readFile(new URL("../maps/mechanisms.json", import.meta.url), "utf8"));
  const a = sim(document), b = sim(document);
  // Use a recorded move route toward the lever before interaction.
  for (let tick = 0; tick < 2400; tick++) {
    const command = tick < 25 ? { move: { x: 2.5, z: 6.5 } } : tick === 25 ? { interact: true } : null;
    a.tick(command); b.tick(command);
  }
  assert.deepEqual(a.snapshot(), b.snapshot());
  assert.deepEqual(Simulation.replay(a.exportCommandLog()).snapshot(), a.snapshot());
  assert.ok(a.mechanisms.events.length <= 256);
  assert.equal(a.mechanisms.compiled.nodes.length, 16);
  assert.equal(a.mechanisms.state[a.mechanisms.byId.get("logic-0009").index], 3);
  assert.equal(a.snapshot().mechanisms.devices.find((d) => d.layerId === "layer-0002").open, true);
});

test("logic/device/total/link bounds reject atomically, including unknown properties and duplicate IDs", () => {
  const make = (logicCount, gateCount, controlCount, plateCount) => {
    const document = blank();
    document.mechanisms.nodes = Array.from({ length: logicCount }, (_, i) => ({ id: `n${i}`, definitionId: "logic.all" }));
    document.layers[0].instances = [
      ...Array.from({ length: gateCount }, (_, i) => ({ id: `g${i}`, definitionId: "mechanism.gate" })),
      ...Array.from({ length: controlCount }, (_, i) => ({ id: `c${i}`, definitionId: "mechanism.lever" })),
      ...Array.from({ length: plateCount }, (_, i) => ({ id: `p${i}`, definitionId: "object.pressure-plate" })),
    ];
    return document;
  };
  assert.equal(compileMechanisms(make(256, 128, 128, 0)).nodes.length, 512);
  assert.throws(() => compileMechanisms(make(257, 0, 0, 0)), /capacity/);
  assert.throws(() => compileMechanisms(make(256, 128, 128, 1)), /capacity/);
  assert.throws(() => compileMechanisms(make(0, 129, 0, 0)), /capacity/);
  assert.throws(() => compileMechanisms(make(0, 0, 129, 0)), /capacity/);
  const document = make(1, 0, 0, 0);
  document.mechanisms.links = Array.from({ length: 1025 }, () => ({}));
  assert.throws(() => compileMechanisms(document), /capacity/);
  document.mechanisms.links = [];
  document.mechanisms.nodes[0].properties = { surprise: true };
  assert.throws(() => compileMechanisms(document), /Unknown.*property/);
  document.mechanisms.nodes[0].properties = {};
  document.mechanisms.nodes.push({ ...document.mechanisms.nodes[0] });
  assert.throws(() => compileMechanisms(document), /duplicate/);
});

test("gates wait for dynamic corpses; plate corpse activation is opt-in", () => {
  const puzzle = plateGate(), value = sim(puzzle.document);
  value.player.x = 8.5; value.player.previousX = 8.5;
  value.dynamicDeadBodies.spawn({ id: 999, spawnSequence: 999, deathTick: 0, x: 6.5, z: 5.5,
    vx: 0, vz: 0, facingX: 1, facingZ: 0, radius: 0.3, massKg: 75, layerIndex: 0, worldY: 0 });
  value.tick(null); value.tick(null);
  assert.equal(value.map.get(6, 5), 0);
  assert.equal(value.snapshot().mechanisms.devices[0].blocked, true);
  value.dynamicDeadBodies.x[0] = 2.5; value.tick(null);
  assert.equal(value.map.get(6, 5), 1);
  assert.equal(value.snapshot().pressurePlates[0].pressed, false);
  const enabled = structuredClone(puzzle.document);
  enabled.layers[0].instances.find((i) => i.id === puzzle.plate).properties = { player: false, corpse: true };
  const corpsePlate = sim(enabled);
  corpsePlate.player.x = 8.5;
  corpsePlate.dynamicDeadBodies.spawn({ id: 888, spawnSequence: 888, deathTick: 0, x: 2.5, z: 5.5,
    vx: 0, vz: 0, facingX: 1, facingZ: 0, radius: 0.3, massKg: 75, layerIndex: 0, worldY: 0 });
  corpsePlate.tick(null);
  assert.equal(corpsePlate.snapshot().pressurePlates[0].pressed, true);
});

test("device presentation follows the visible floor independently of editor selection", () => {
  const snapshot = sim(plateGate().document).snapshot();
  const gate = snapshot.mechanisms.devices[0];
  assert.ok(visibleMechanismInstances(snapshot).some((instance) => instance.id === gate.id));
  snapshot.map.layerId = "other-floor";
  snapshot.mechanisms.devices.push({ ...gate, id: "other-gate", layerId: "other-floor" });
  const before = structuredClone(snapshot);
  const devices = visibleMechanismInstances(snapshot).filter((instance) => instance.definitionId.startsWith("mechanism."));
  assert.deepEqual(devices.map((device) => device.id), ["other-gate"]);
  assert.deepEqual(snapshot, before);
});
