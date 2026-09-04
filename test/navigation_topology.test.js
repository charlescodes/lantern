import test from "node:test";
import assert from "node:assert/strict";

import {
  AUTHORING_MAP_VERSION,
  authoringMapDiagnostics,
  loadAuthoringMap,
} from "../src/authoring/authoring_map.js";
import {
  createLayer,
  placeElevatorConnector,
  placeNavigationLink,
  placeNavigationNode,
  paintStructureCells,
  removeConnector,
  removeNavigationNode,
  updateConnector,
} from "../src/authoring/authoring_commands.js";
import {
  applyAuthoringCommand,
  commandFromAuthoringAction,
} from "../src/authoring/authoring_history.js";
import { compileAuthoringMap } from "../src/authoring/map_compiler.js";
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

test("authoring-map v5 migrates additively and preserves off-center connectors", () => {
  const upper = createLayer(sourceDocument(), "ground", "above", { baseY: 3 });
  const placed = placeElevatorConnector(upper.document, 4.5, 4.5, {
    lowerLayerId: "ground",
    upperLayerId: upper.layerId,
  });
  const v5 = structuredClone(placed.document);
  v5.version = 5;
  v5.connectors[0].x = 4.2;
  delete v5.nextNavigationNodeOrdinal;
  delete v5.nextNavigationLinkOrdinal;
  delete v5.navigationNodes;
  delete v5.navigationLinks;

  const migrated = loadAuthoringMap(v5);
  assert.equal(migrated.version, AUTHORING_MAP_VERSION);
  assert.equal(migrated.connectors[0].x, 4.2);
  assert.deepEqual(migrated.navigationNodes, []);
  assert.deepEqual(migrated.navigationLinks, []);
  assert.equal(migrated.nextNavigationNodeOrdinal, 1);
  assert.equal(migrated.nextNavigationLinkOrdinal, 1);
  assert.deepEqual(loadAuthoringMap(JSON.stringify(migrated)), migrated);
  assert.ok(authoringMapDiagnostics(migrated).some((issue) => (
    issue.path === "connectors[0]" && issue.code === "legacy-off-center-connector"
  )));
});

test("navigation structures reject malformed endpoints, duplicates, apertures, and bad ordinals", () => {
  const source = sourceDocument();
  const malformed = structuredClone(source);
  malformed.nextNavigationNodeOrdinal = 1;
  malformed.navigationNodes = [
    { id: "navigation-node-0001", layerId: "ground", cx: 2, cz: 2, patrol: false },
    { id: "other", layerId: "ground", cx: 2, cz: 2, patrol: "yes" },
  ];
  malformed.navigationLinks = [{
    id: "navigation-link-0001",
    a: { kind: "node", nodeId: "missing" },
    b: { kind: "future" },
  }];
  assert.throws(
    () => loadAuthoringMap(malformed),
    (error) => {
      const issues = error.issues ?? [];
      return issues.some((issue) => issue.path === "nextNavigationNodeOrdinal" && issue.code === "navigation-node-ordinal")
        && issues.some((issue) => issue.path === "navigationNodes[1]" && issue.code === "duplicate-navigation-node-cell")
        && issues.some((issue) => issue.path === "navigationNodes[1].patrol" && issue.code === "boolean")
        && issues.some((issue) => issue.path === "navigationLinks[0].a.nodeId" && issue.code === "missing-navigation-node")
        && issues.some((issue) => issue.path === "navigationLinks[0].b.kind" && issue.code === "navigation-endpoint-kind");
    },
  );
});

test("semantic navigation commands retain stable IDs and delete incident links atomically", () => {
  const first = placeNavigationNode(sourceDocument(), 2, 2, { patrol: true });
  const second = placeNavigationNode(first.document, 5, 2);
  const linked = placeNavigationLink(
    second.document,
    { kind: "node", nodeId: first.nodeId },
    { kind: "node", nodeId: second.nodeId },
  );
  const command = commandFromAuthoringAction(linked.document, {
    type: "removeNavigationNode",
    nodeId: first.nodeId,
  });
  const removed = applyAuthoringCommand(linked.document, command);
  assert.deepEqual(removed.navigationNodes.map((node) => node.id), [second.nodeId]);
  assert.deepEqual(removed.navigationLinks, []);
  assert.deepEqual(applyAuthoringCommand(removed, command, "reverse"), linked.document);
});

test("new and moved elevators snap to cell centers while undo restores legacy coordinates", () => {
  const upper = createLayer(sourceDocument(), "ground", "above", { baseY: 3 });
  const placed = placeElevatorConnector(upper.document, 4.1, 4.9, {
    lowerLayerId: "ground",
    upperLayerId: upper.layerId,
  });
  assert.deepEqual(
    { x: placed.document.connectors[0].x, z: placed.document.connectors[0].z },
    { x: 4.5, z: 4.5 },
  );
  const legacy = structuredClone(placed.document);
  legacy.connectors[0].x = 4.2;
  const command = commandFromAuthoringAction(legacy, {
    type: "updateConnector",
    connectorId: placed.connectorId,
    changes: { x: 5.1 },
  });
  const moved = applyAuthoringCommand(legacy, command);
  assert.deepEqual({ x: moved.connectors[0].x, z: moved.connectors[0].z }, { x: 5.5, z: 4.5 });
  assert.equal(applyAuthoringCommand(moved, command, "reverse").connectors[0].x, 4.2);
});

test("compiled topology uses exact grid costs, elevator arcs, and deterministic graph ties", () => {
  let document = sourceDocument();
  const a = placeNavigationNode(document, 1, 1);
  document = a.document;
  const b = placeNavigationNode(document, 3, 1);
  document = b.document;
  const c = placeNavigationNode(document, 1, 3);
  document = c.document;
  const d = placeNavigationNode(document, 3, 3);
  document = d.document;
  for (const [left, right] of [[a.nodeId, b.nodeId], [a.nodeId, c.nodeId], [b.nodeId, d.nodeId], [c.nodeId, d.nodeId]]) {
    document = placeNavigationLink(
      document,
      { kind: "node", nodeId: left },
      { kind: "node", nodeId: right },
    ).document;
  }
  const compiled = compileAuthoringMap(document);
  const route = compiled.navigationTopology.route(`node:${a.nodeId}`, `node:${d.nodeId}`);
  assert.equal(route.ok, true);
  assert.equal(route.cost, 40);
  assert.deepEqual(route.ports.map((port) => port.stableId), [a.nodeId, b.nodeId, d.nodeId]);
  assert.equal(compiled.navigationTopology.nearestNode("ground", 2, 2).port.stableId, a.nodeId);
  assert.deepEqual(
    compiled.navigationTopology.describe(),
    compileAuthoringMap(structuredClone(document)).navigationTopology.describe(),
  );

  const upper = createLayer(document, "ground", "above", { baseY: 3 });
  const elevator = placeElevatorConnector(upper.document, 5.5, 5.5, {
    lowerLayerId: "ground",
    upperLayerId: upper.layerId,
    travelDurationSeconds: 1,
    dwellSeconds: 0.5,
  });
  const lowerNodeResult = placeNavigationNode(elevator.document, 4, 5);
  const lowerNode = lowerNodeResult.nodeId;
  let vertical = lowerNodeResult.document;
  const upperNodeResult = placeNavigationNode(vertical, 4, 5, { layerId: upper.layerId });
  vertical = upperNodeResult.document;
  vertical = placeNavigationLink(vertical, { kind: "node", nodeId: lowerNode }, {
    kind: "connector-endpoint", connectorId: elevator.connectorId, stop: "lower",
  }).document;
  vertical = placeNavigationLink(vertical, { kind: "node", nodeId: upperNodeResult.nodeId }, {
    kind: "connector-endpoint", connectorId: elevator.connectorId, stop: "upper",
  }).document;
  const topology = compileAuthoringMap(vertical).navigationTopology;
  const verticalRoute = topology.route(`node:${lowerNode}`, `node:${upperNodeResult.nodeId}`);
  assert.equal(verticalRoute.ok, true);
  assert.equal(verticalRoute.cost, 110);
  assert.deepEqual(verticalRoute.ports.map((port) => port.kind), [
    "node", "connector-endpoint", "connector-endpoint", "node",
  ]);
});

test("topology compilation supports unequal layer dimensions and rejects unreachable authored links", () => {
  const created = createLayer(sourceDocument(), "ground", "above", { baseY: 3 });
  const document = structuredClone(created.document);
  const upper = document.layers.find((layer) => layer.id === created.layerId);
  upper.width = 6;
  upper.height = 7;
  upper.surface.cells = new Array(42).fill(0);
  upper.structure.cells = new Array(42).fill(0);
  const first = placeNavigationNode(document, 1, 1, { layerId: created.layerId });
  const second = placeNavigationNode(first.document, 4, 5, { layerId: created.layerId });
  const linked = placeNavigationLink(second.document,
    { kind: "node", nodeId: first.nodeId },
    { kind: "node", nodeId: second.nodeId });
  assert.equal(compileAuthoringMap(linked.document).navigationTopology.route(
    `node:${first.nodeId}`,
    `node:${second.nodeId}`,
  ).ok, true);

  let blocked = sourceDocument();
  const wall = Array.from({ length: 7 }, (_, index) => ({ cx: 4, cz: index + 1 }));
  blocked = paintStructureCells(blocked, wall, "structure.wall");
  const left = placeNavigationNode(blocked, 2, 4);
  const right = placeNavigationNode(left.document, 6, 4);
  const impossible = placeNavigationLink(right.document,
    { kind: "node", nodeId: left.nodeId },
    { kind: "node", nodeId: right.nodeId });
  assert.throws(
    () => compileAuthoringMap(impossible.document),
    (error) => error.issues?.some((issue) => (
      issue.path === "navigationLinks[0]" && issue.code === "navigation-link-unreachable"
    )),
  );
  assert.throws(
    () => commandFromAuthoringAction(right.document, {
      type: "placeNavigationLink",
      a: { kind: "node", nodeId: left.nodeId },
      b: { kind: "node", nodeId: right.nodeId },
    }),
    (error) => error.issues?.some((issue) => issue.code === "navigation-link-unreachable"),
  );
});

test("topology probes are detached and schema-v15 recordings pin capacities", () => {
  const simulation = new Simulation({ scenario: new ArenaScenario(sourceDocument()), particleBurstCount: 0 });
  const probe = simulation.navigationTopologySnapshot();
  probe.ports.push({ broken: true });
  assert.equal(simulation.navigationTopologySnapshot().ports.length, 0);
  const recording = simulation.exportCommandLog();
  assert.equal(recording.schemaVersion, 15);
  assert.equal(recording.configuration.authoredNavigationTopologyProfile, "authored-navigation-topology-v1");
  assert.equal(recording.configuration.navigationTopologyCapacities.ports, 160);
  assert.deepEqual(Simulation.replay(recording).snapshot().player, simulation.snapshot().player);
  const invalidCapacity = structuredClone(recording);
  invalidCapacity.configuration.navigationTopologyCapacities.ports = 161;
  assert.throws(() => Simulation.replay(invalidCapacity), /invalid navigation-topology capacities/);
  const missingMap = structuredClone(recording);
  delete missingMap.initialAuthoringMap;
  assert.throws(() => Simulation.replay(missingMap), /missing its authoring-map v6 baseline/);

  for (let index = 0; index < 140; index += 1) {
    simulation.queryNavigationRoute("node:missing-a", "node:missing-b");
  }
  const events = simulation.navigationRouteEvents();
  assert.equal(events.retained, 128);
  assert.equal(events.capacity, 128);
  assert.equal(events.dropped, 13);
  assert.equal(events.recent.length, 32);
  events.recent[0].type = "mutated";
  assert.notEqual(simulation.navigationRouteEvents().recent[0].type, "mutated");

  const v14 = structuredClone(recording);
  v14.schemaVersion = 14;
  delete v14.configuration.authoredNavigationTopologyProfile;
  delete v14.configuration.navigationTopologyCapacities;
  assert.equal(Simulation.replay(v14).authoredNavigationTopologyProfile, "none");
});

test("schema-v15 replay rebuilds an inert authored topology without changing movement", () => {
  const first = placeNavigationNode(sourceDocument(), 2, 2);
  const second = placeNavigationNode(first.document, 5, 2);
  const linked = placeNavigationLink(second.document,
    { kind: "node", nodeId: first.nodeId },
    { kind: "node", nodeId: second.nodeId });
  const simulation = new Simulation({
    scenario: new ArenaScenario(linked.document),
    particleBurstCount: 0,
  });
  const before = simulation.snapshot().enemies;
  const replayed = Simulation.replay(simulation.exportCommandLog());
  assert.deepEqual(replayed.navigationTopologySnapshot(), simulation.navigationTopologySnapshot());
  assert.deepEqual(replayed.snapshot().enemies, before);
  assert.equal(replayed.navigationTopology.route(
    `node:${first.nodeId}`,
    `node:${second.nodeId}`,
  ).cost, 30);
});

test("connector and node deletion helpers cascade their incident links", () => {
  const upper = createLayer(sourceDocument(), "ground", "above", { baseY: 3 });
  const elevator = placeElevatorConnector(upper.document, 5.5, 5.5, {
    lowerLayerId: "ground",
    upperLayerId: upper.layerId,
  });
  const node = placeNavigationNode(elevator.document, 4, 5);
  const linked = placeNavigationLink(node.document, { kind: "node", nodeId: node.nodeId }, {
    kind: "connector-endpoint", connectorId: elevator.connectorId, stop: "lower",
  });
  assert.deepEqual(removeConnector(linked.document, elevator.connectorId).navigationLinks, []);
  assert.deepEqual(removeNavigationNode(linked.document, node.nodeId).navigationLinks, []);
  assert.equal(updateConnector(linked.document, elevator.connectorId, { x: 6.1 }).connectors[0].x, 6.5);
});

test("the maximum authored envelope compiles to exactly 160 ports and 544 arcs", () => {
  const base = new ArenaScenario(borderedMap(20, 10)).toAuthoringJSON();
  const created = createLayer(base, "ground", "above", { baseY: 3 });
  const document = structuredClone(created.document);
  const cells = [];
  for (let cz = 1; cz < 9; cz += 1) {
    for (let cx = 1; cx < 19; cx += 1) cells.push({ cx, cz });
  }
  document.connectors = cells.slice(0, 16).map((cell, index) => ({
    id: `elevator-${String(index + 1).padStart(4, "0")}`,
    definitionId: "connector.elevator.two-stop",
    lowerLayerId: "ground",
    upperLayerId: created.layerId,
    x: cell.cx + 0.5,
    z: cell.cz + 0.5,
    platformWidth: 0.9,
    apertureWidth: 0.9,
    travelDurationSeconds: 1,
    dwellSeconds: 0,
    initialStop: "lower",
  }));
  document.nextConnectorOrdinal = 17;
  document.navigationNodes = cells.slice(16, 144).map((cell, index) => ({
    id: `navigation-node-${String(index + 1).padStart(4, "0")}`,
    layerId: "ground",
    cx: cell.cx,
    cz: cell.cz,
    patrol: false,
  }));
  document.nextNavigationNodeOrdinal = 129;
  const pairs = [];
  for (let left = 0; left < 128 && pairs.length < 256; left += 1) {
    for (let right = left + 1; right < 128 && pairs.length < 256; right += 1) {
      pairs.push([left, right]);
    }
  }
  document.navigationLinks = pairs.map(([left, right], index) => ({
    id: `navigation-link-${String(index + 1).padStart(4, "0")}`,
    a: { kind: "node", nodeId: document.navigationNodes[left].id },
    b: { kind: "node", nodeId: document.navigationNodes[right].id },
  }));
  document.nextNavigationLinkOrdinal = 257;
  const topology = compileAuthoringMap(document).navigationTopology;
  assert.equal(topology.portCount, 160);
  assert.equal(topology.arcCount, 544);
});
