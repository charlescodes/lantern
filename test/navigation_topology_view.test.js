import assert from "node:assert/strict";
import test from "node:test";

import { createNavigationTopologyView } from "../src/presentation/navigation_topology_view.js";
import { createNavigationDebugArenaScenario } from "../src/sim/scenario.js";

const topology = {
  revision: 7,
  diagnostics: [{ severity: "warning", code: "example" }],
  ports: [
    { key: "node:n1", stableId: "n1", kind: "node", layerId: "ground", cx: 2, cz: 3, x: 2.5, z: 3.5, patrol: true },
    { key: "node:n2", stableId: "n2", kind: "node", layerId: "ground", cx: 5, cz: 3, x: 5.5, z: 3.5 },
    { key: "connector:e1:lower", stableId: "e1", kind: "connector-endpoint", connectorId: "e1", stop: "lower", layerId: "ground", cx: 7, cz: 3, x: 7.5, z: 3.5 },
    { key: "connector:e1:upper", stableId: "e1", kind: "connector-endpoint", connectorId: "e1", stop: "upper", layerId: "upper", cx: 7, cz: 3, x: 7.5, z: 3.5 },
  ],
  arcs: [
    { from: "node:n1", to: "node:n2", kind: "authored-link", cost: 3 },
    { from: "node:n2", to: "node:n1", kind: "authored-link", cost: 3 },
    { from: "connector:e1:lower", to: "connector:e1:upper", kind: "elevator", cost: 20 },
    { from: "connector:e1:upper", to: "connector:e1:lower", kind: "elevator", cost: 20 },
  ],
};

test("topology view is detached, layer-scoped, and deduplicates bidirectional arcs", () => {
  const view = createNavigationTopologyView({
    topology,
    editor: {
      activeLayerId: "ground",
      selectedTarget: { kind: "navigation-node", nodeId: "n1" },
      pendingLinkStart: { kind: "connector-endpoint", connectorId: "e1", stop: "lower" },
    },
    developerToolsOpen: true,
  });
  assert.equal(view.visible, true);
  assert.equal(view.nodes.length, 2);
  assert.equal(view.ports.length, 1);
  assert.equal(view.links.length, 1);
  assert.equal(view.verticalArcs.length, 1);
  assert.equal(view.selectedPortKey, "node:n1");
  assert.equal(view.pendingLinkStartKey, "connector:e1:lower");
  view.nodes[0].x = 99;
  assert.equal(topology.ports[0].x, 2.5);
});

test("topology view remains empty while developer diagnostics are closed", () => {
  const view = createNavigationTopologyView({ topology, editor: { activeLayerId: "ground" } });
  assert.deepEqual(view, {
    visible: false,
    revision: 7,
    layerId: "ground",
    nodes: [], ports: [], links: [], verticalArcs: [], selectedRoute: [], localGoal: null,
    selectedPortKey: null, pendingLinkStartKey: null, diagnostics: [],
  });
});

test("selected runtime patrol route and local goal are detached presentation data", () => {
  const selectedRoute = [topology.ports[0], topology.ports[1]];
  const view = createNavigationTopologyView({
    topology: { ...topology, selectedRoute, localGoal: topology.ports[1] },
    editor: { activeLayerId: "ground" },
    developerToolsOpen: true,
  });
  assert.deepEqual(view.selectedRoute.map((port) => port.key), ["node:n1", "node:n2"]);
  assert.equal(view.localGoal.key, "node:n2");
  view.selectedRoute[0].x = 99;
  view.localGoal.x = 88;
  assert.equal(topology.ports[0].x, 2.5);
  assert.equal(topology.ports[1].x, 5.5);
});

test("the authored navigation arena produces a bounded layer-scoped overlay view", () => {
  const scenario = createNavigationDebugArenaScenario();
  const topologySnapshot = scenario.navigationTopologySnapshot();
  const document = scenario.toAuthoringJSON();
  const expectedCounts = [
    { nodes: 3, ports: 1, links: 4, verticalArcs: 1 },
    { nodes: 4, ports: 2, links: 5, verticalArcs: 2 },
    { nodes: 3, ports: 1, links: 3, verticalArcs: 1 },
  ];
  for (let layerIndex = 0; layerIndex < document.layers.length; layerIndex += 1) {
    const view = createNavigationTopologyView({
      topology: topologySnapshot,
      editor: { activeLayerId: document.layers[layerIndex].id },
      developerToolsOpen: true,
    });
    assert.equal(view.visible, true);
    assert.deepEqual({
      nodes: view.nodes.length,
      ports: view.ports.length,
      links: view.links.length,
      verticalArcs: view.verticalArcs.length,
    }, expectedCounts[layerIndex]);
    assert.ok(view.nodes.length + view.ports.length <= topologySnapshot.capacities.portCapacity);
    assert.ok(view.links.length + view.verticalArcs.length <= topologySnapshot.capacities.arcCapacity);
  }
});
