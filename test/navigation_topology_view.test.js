import assert from "node:assert/strict";
import test from "node:test";

import { createNavigationTopologyView } from "../src/presentation/navigation_topology_view.js";

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
