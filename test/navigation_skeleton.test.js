import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  createLayer,
  paintSurface,
  paintStructure,
  placeElevatorConnector,
  placeNavigationNode,
} from "../src/authoring/authoring_commands.js";
import {
  applyAuthoringCommand,
  commandFromAuthoringAction,
} from "../src/authoring/authoring_history.js";
import { generateConnectorNavigationSkeleton } from "../src/authoring/navigation_skeleton.js";
import { GridMap } from "../src/sim/grid_map.js";
import { ArenaScenario } from "../src/sim/scenario.js";

function borderedMap(width = 12, height = 12) {
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

function chainedConnectorDocument() {
  let document = new ArenaScenario(borderedMap()).toAuthoringJSON();
  const middle = createLayer(document, "ground", "above", { baseY: 3 });
  document = middle.document;
  const upper = createLayer(document, middle.layerId, "above", { baseY: 6 });
  document = upper.document;
  document = placeElevatorConnector(document, 4.5, 7.5, {
    lowerLayerId: "ground", upperLayerId: middle.layerId,
  }).document;
  document = placeElevatorConnector(document, 8.5, 4.5, {
    lowerLayerId: middle.layerId, upperLayerId: upper.layerId,
  }).document;
  return document;
}

test("connector skeleton deterministically wires two chained elevators and is idempotent", () => {
  const before = chainedConnectorDocument();
  const generated = generateConnectorNavigationSkeleton(before);
  assert.equal(generated.addedNodeIds.length, 4);
  assert.equal(generated.addedLinkIds.length, 5);
  assert.deepEqual(generated.unresolvedEndpoints, []);
  assert.deepEqual(
    generated.document.navigationNodes.map(({ layerId, cx, cz, patrol }) => ({ layerId, cx, cz, patrol })),
    [
      { layerId: "ground", cx: 4, cz: 6, patrol: false },
      { layerId: "layer-0002", cx: 4, cz: 6, patrol: false },
      { layerId: "layer-0002", cx: 8, cz: 3, patrol: false },
      { layerId: "layer-0003", cx: 8, cz: 3, patrol: false },
    ],
  );
  const scenario = new ArenaScenario(generated.document);
  const route = scenario.navigationTopology.route(
    `node:${generated.addedNodeIds[0]}`,
    `node:${generated.addedNodeIds[3]}`,
  );
  assert.equal(route.ok, true);
  assert.deepEqual(
    route.ports.filter((port) => port.kind === "connector-endpoint").map((port) => port.key),
    [
      "connector:elevator-0001:lower",
      "connector:elevator-0001:upper",
      "connector:elevator-0002:lower",
      "connector:elevator-0002:upper",
    ],
  );

  const again = generateConnectorNavigationSkeleton(generated.document);
  assert.deepEqual(again.document, generated.document);
  assert.deepEqual(again.addedNodeIds, []);
  assert.deepEqual(again.addedLinkIds, []);
  assert.deepEqual(again.unresolvedEndpoints, []);
});

test("connector skeleton preserves manual nodes and joins them with sparse links", () => {
  let document = chainedConnectorDocument();
  const manual = placeNavigationNode(document, 2, 2, { layerId: "ground", patrol: true });
  document = manual.document;
  const generated = generateConnectorNavigationSkeleton(document);
  const retained = generated.document.navigationNodes.find((node) => node.id === manual.nodeId);
  assert.deepEqual(retained, {
    id: manual.nodeId, layerId: "ground", cx: 2, cz: 2, patrol: true,
  });
  assert.ok(generated.document.navigationLinks.some((link) => (
    [link.a, link.b].some((endpoint) => endpoint.kind === "node" && endpoint.nodeId === manual.nodeId)
  )));
});

test("blocked staging cells fall back in cardinal order and unresolved endpoints remain explicit", () => {
  let document = new ArenaScenario(borderedMap()).toAuthoringJSON();
  const upper = createLayer(document, "ground", "above", { baseY: 3 });
  document = upper.document;
  const connector = placeElevatorConnector(document, 5.5, 5.5, {
    lowerLayerId: "ground", upperLayerId: upper.layerId,
  });
  document = connector.document;
  document = paintSurface(document, 5, 4, "surface.hole", "ground");
  let generated = generateConnectorNavigationSkeleton(document);
  assert.deepEqual(
    generated.document.navigationNodes.find((node) => node.layerId === "ground"),
    { id: "navigation-node-0001", layerId: "ground", cx: 6, cz: 5, patrol: false },
  );

  for (const [cx, cz] of [[6, 5], [5, 6], [4, 5]]) {
    document = paintStructure(document, cx, cz, "structure.wall", "ground");
  }
  generated = generateConnectorNavigationSkeleton(document);
  assert.deepEqual(generated.unresolvedEndpoints, [`connector:${connector.connectorId}:lower`]);
  assert.equal(generated.document.navigationNodes.some((node) => node.layerId === "ground"), false);
  assert.equal(generated.document.navigationNodes.some((node) => node.layerId === upper.layerId), true);
});

test("connector generation is one reversible semantic history command", () => {
  const before = chainedConnectorDocument();
  const command = commandFromAuthoringAction(before, { type: "generateConnectorNavigationSkeleton" });
  assert.ok(command);
  assert.equal(command.label, "Fill Connector Navigation");
  const after = applyAuthoringCommand(before, command, "forward");
  assert.equal(after.navigationNodes.length, 4);
  assert.equal(after.navigationLinks.length, 5);
  assert.deepEqual(applyAuthoringCommand(after, command, "reverse"), before);
});

test("connector generation rejects node-capacity overflow without mutating its input", () => {
  let document = new ArenaScenario(borderedMap(16, 16)).toAuthoringJSON();
  const upper = createLayer(document, "ground", "above", { baseY: 3 });
  document = upper.document;
  document = placeElevatorConnector(document, 7.5, 7.5, {
    lowerLayerId: "ground", upperLayerId: upper.layerId,
  }).document;
  const excluded = new Set(["7:7", "7:6", "8:7", "7:8", "6:7"]);
  for (const layerId of ["ground", upper.layerId]) {
    for (let cz = 1; cz < 15 && document.navigationNodes.length < 128; cz += 1) {
      for (let cx = 1; cx < 15 && document.navigationNodes.length < 128; cx += 1) {
        if (excluded.has(`${cx}:${cz}`)) continue;
        document = placeNavigationNode(document, cx, cz, { layerId }).document;
      }
    }
  }
  const before = structuredClone(document);
  assert.throws(() => generateConnectorNavigationSkeleton(document), /128-node limit/);
  assert.deepEqual(document, before);
});

test("the authored navigation-testing-v2 map carries the generated connector skeleton", async () => {
  const document = JSON.parse(await readFile(
    new URL("../maps/navigation-testing-v2.json", import.meta.url),
    "utf8",
  ));
  const generated = generateConnectorNavigationSkeleton(document);
  assert.deepEqual(generated.addedNodeIds, []);
  assert.deepEqual(generated.addedLinkIds, []);
  assert.deepEqual(generated.unresolvedEndpoints, []);
  assert.equal(document.navigationNodes.length, 4);
  assert.equal(document.navigationLinks.length, 5);
  const scenario = new ArenaScenario(document);
  assert.equal(scenario.navigationTopology.route(
    "node:navigation-node-0001",
    "node:navigation-node-0004",
  ).ok, true);
});
