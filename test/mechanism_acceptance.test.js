import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadAuthoringMap } from "../src/authoring/authoring_map.js";
import { ArenaScenario } from "../src/sim/scenario.js";
import { Simulation } from "../src/sim/simulation.js";

test("Pass B acceptance arena loads through the current authoring and runtime boundaries", () => {
  const source = JSON.parse(readFileSync(new URL("../maps/mechanisms-pass-b.json", import.meta.url)));
  const document = loadAuthoringMap(source);
  const scenario = new ArenaScenario(document);
  assert.equal(document.version, 9);
  assert.equal(document.metadata.id, "mechanisms-pass-b");
  assert.equal(scenario.compiledLayerIds.length, 2);
  assert.equal(scenario.connectors[0].controlMode, "triggered");
  assert.ok(scenario.mechanisms.nodes.some(node => node.definitionId === "mechanism.spiked-mover"));
  assert.ok(scenario.mechanisms.nodes.some(node => node.definitionId === "mechanism.bolt-emitter"));
  assert.ok(scenario.mechanisms.nodes.some(node => node.definitionId === "mechanism.spell-emitter"));
  const crossLayer = document.mechanisms.links.find(link => link.to.nodeId.startsWith("mechanism-wall-spear"));
  assert.ok(crossLayer);
  assert.match(crossLayer.from.nodeId, /^mechanism-chain-/);

  const simulation = new Simulation({ scenario, particleBurstCount: 0 });
  for (let tick = 0; tick < 120; tick++) simulation.tick(null);
  assert.equal(simulation.snapshot().schemaVersion, 25);
  assert.equal(simulation.snapshot().mechanisms.counts.nodes, 17);
});
