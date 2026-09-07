import assert from "node:assert/strict";
import test from "node:test";

import {
  createLayer,
  placeElevatorConnector,
} from "../src/authoring/authoring_commands.js";
import {
  COMBAT,
  ENEMY_AI_PROFILE_INVESTIGATIVE,
  ENEMY_WIZARD,
  GAMEPLAY_PROFILE_OBELISK_DUEL,
  NAVIGATION_TOPOLOGY,
} from "../src/config.js";
import { GridMap } from "../src/sim/grid_map.js";
import { ArenaScenario } from "../src/sim/scenario.js";
import { Simulation } from "../src/sim/simulation.js";

function maximumTopologyDocument() {
  const map = new GridMap(24, 24, undefined, { x: 1.5, z: 1.5 });
  for (let cell = 0; cell < 24; cell += 1) {
    map.set(cell, 0, 1);
    map.set(cell, 23, 1);
    map.set(0, cell, 1);
    map.set(23, cell, 1);
  }
  let document = new ArenaScenario(map).toAuthoringJSON();
  const upper = createLayer(document, "ground", "above", { baseY: 3 });
  document = upper.document;
  for (let connector = 0; connector < 16; connector += 1) {
    document = placeElevatorConnector(document, connector + 3, 2, {
      lowerLayerId: "ground",
      upperLayerId: upper.layerId,
      travelDurationSeconds: 1,
      dwellSeconds: 1,
    }).document;
  }
  const layerIds = ["ground", upper.layerId];
  const nodeIdsByLayer = [];
  document.navigationNodes = [];
  let ordinal = 1;
  for (const layerId of layerIds) {
    const nodeIds = [];
    for (let index = 0; index < 64; index += 1) {
      const id = `navigation-node-${String(ordinal).padStart(4, "0")}`;
      ordinal += 1;
      nodeIds.push(id);
      document.navigationNodes.push({
        id,
        layerId,
        cx: 2 + (index % 20),
        cz: 4 + Math.floor(index / 20),
        patrol: true,
      });
    }
    nodeIdsByLayer.push(nodeIds);
  }
  document.nextNavigationNodeOrdinal = ordinal;
  document.navigationLinks = [];
  let linkOrdinal = 1;
  for (const nodeIds of nodeIdsByLayer) {
    let count = 0;
    for (let left = 0; left < nodeIds.length && count < 128; left += 1) {
      for (let right = left + 1; right < nodeIds.length && count < 128; right += 1) {
        document.navigationLinks.push({
          id: `navigation-link-${String(linkOrdinal).padStart(4, "0")}`,
          a: { kind: "node", nodeId: nodeIds[left] },
          b: { kind: "node", nodeId: nodeIds[right] },
        });
        linkOrdinal += 1;
        count += 1;
      }
    }
  }
  document.nextNavigationLinkOrdinal = linkOrdinal;
  return document;
}

test("maximum navigation topology and enemy capacity stay bounded for ten simulated minutes", () => {
  const scenario = new ArenaScenario(maximumTopologyDocument());
  const simulation = new Simulation({
    scenario,
    gameplayProfile: GAMEPLAY_PROFILE_OBELISK_DUEL,
    enemyAiProfile: ENEMY_AI_PROFILE_INVESTIGATIVE,
    enemyCapacity: ENEMY_WIZARD.capacity,
    encounterMaximumAlive: ENEMY_WIZARD.capacity,
    particleBurstCount: 0,
  });
  assert.equal(simulation.navigationTopology.portCount, NAVIGATION_TOPOLOGY.portCapacity);
  assert.equal(simulation.navigationTopology.arcCount, NAVIGATION_TOPOLOGY.arcCapacity);
  for (let index = 0; index < ENEMY_WIZARD.capacity; index += 1) {
    const layerIndex = index < 32 ? 0 : 1;
    const local = index % 32;
    const x = 2.5 + (local % 20);
    const z = 4.5 + Math.floor(local / 20);
    assert.ok(simulation.enemies.spawn({
      spawnSequence: index + 1,
      spawnTick: 0,
      x,
      z,
      radius: ENEMY_WIZARD.radius,
      massKg: ENEMY_WIZARD.massKg,
      maximumHealth: COMBAT.maximumHealth,
      shotReadyTick: 0xffff_ffff,
      facingX: 1,
      facingZ: 0,
      guardX: x,
      guardZ: z,
      worldY: simulation.layerBaseY[layerIndex],
      layerIndex,
    }) > 0);
  }
  const routeStorage = simulation.enemies.routePorts;
  const completedStorage = simulation.destinationFields.completedCosts;
  const fieldBuffers = [
    simulation.destinationFields.buildingCosts,
    ...simulation.destinationFields.completedCosts,
  ];
  let maximumExpansionsInOneTick = 0;
  for (let tick = 0; tick < 36_000; tick += 1) {
    simulation.tick(null);
    maximumExpansionsInOneTick = Math.max(
      maximumExpansionsInOneTick,
      simulation.destinationFields.expansionsThisTick,
    );
  }
  const events = simulation.navigationRouteEvents();
  assert.equal(simulation.enemies.activeCount, ENEMY_WIZARD.capacity);
  assert.equal(simulation.enemies.routePorts, routeStorage);
  assert.equal(simulation.destinationFields.completedCosts, completedStorage);
  assert.ok(fieldBuffers.includes(simulation.destinationFields.buildingCosts));
  assert.ok(simulation.destinationFields.completedCosts.every(
    (buffer) => fieldBuffers.includes(buffer),
  ));
  assert.ok(events.retained <= events.capacity);
  assert.ok(events.recent.length <= NAVIGATION_TOPOLOGY.routeEventSnapshotCount);
  assert.ok(events.dropped > 0);
  assert.ok(maximumExpansionsInOneTick <= 2_048);
  assert.ok(simulation.snapshot().navigation.expansionsThisTick <= 2_048);
});
