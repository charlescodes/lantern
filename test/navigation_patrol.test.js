import assert from "node:assert/strict";
import test from "node:test";

import {
  createLayer,
  placeNavigationLink,
  placeNavigationNode,
} from "../src/authoring/authoring_commands.js";
import {
  AUTHORED_NAVIGATION_TOPOLOGY_PROFILE_V1,
  AUTHORED_NAVIGATION_TOPOLOGY_PROFILE_NONE,
  COMBAT,
  ENEMY_AI_PROFILE_INVESTIGATIVE,
  ENEMY_WIZARD,
  GAMEPLAY_PROFILE_OBELISK_DUEL,
  NAVIGATION_ROUTE_PHASE,
  NAVIGATION_TOPOLOGY,
} from "../src/config.js";
import { GridMap } from "../src/sim/grid_map.js";
import { PERCEPTION_STATE } from "../src/sim/perceptive_wizard.js";
import { ArenaScenario } from "../src/sim/scenario.js";
import { Simulation } from "../src/sim/simulation.js";

function borderedMap(width = 30, height = 15) {
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

function patrolDocument() {
  let document = new ArenaScenario(borderedMap()).toAuthoringJSON();
  const lowerA = placeNavigationNode(document, 24, 5, { patrol: true });
  document = lowerA.document;
  const lowerB = placeNavigationNode(document, 19, 5, { patrol: true });
  document = lowerB.document;
  const lowerC = placeNavigationNode(document, 21, 9, { patrol: true });
  document = lowerC.document;
  document = placeNavigationLink(document,
    { kind: "node", nodeId: lowerA.nodeId },
    { kind: "node", nodeId: lowerB.nodeId }).document;
  document = placeNavigationLink(document,
    { kind: "node", nodeId: lowerA.nodeId },
    { kind: "node", nodeId: lowerC.nodeId }).document;
  document = placeNavigationLink(document,
    { kind: "node", nodeId: lowerB.nodeId },
    { kind: "node", nodeId: lowerC.nodeId }).document;
  const upper = createLayer(document, "ground", "above", { baseY: 3 });
  document = upper.document;
  const upperLayer = document.layers.find((layer) => layer.id === upper.layerId);
  upperLayer.width = 22;
  upperLayer.height = 12;
  upperLayer.surface.cells = new Array(22 * 12).fill(0);
  upperLayer.structure.cells = new Array(22 * 12).fill(0);
  const upperA = placeNavigationNode(document, 18, 8, { layerId: upper.layerId, patrol: true });
  document = upperA.document;
  const upperB = placeNavigationNode(document, 14, 8, { layerId: upper.layerId, patrol: true });
  document = upperB.document;
  document = placeNavigationLink(document,
    { kind: "node", nodeId: upperA.nodeId },
    { kind: "node", nodeId: upperB.nodeId }).document;
  return { document, upperLayerId: upper.layerId };
}

function replayPatrolDocument() {
  let document = new ArenaScenario(borderedMap()).toAuthoringJSON();
  const ground = document.layers[0];
  let wallIndex = ground.structure.legend.indexOf("structure.wall");
  if (wallIndex < 0) {
    ground.structure.legend.push("structure.wall");
    wallIndex = ground.structure.legend.length - 1;
  }
  ground.structure.cells[10 * ground.width + 25] = wallIndex;
  ground.markers.obelisk = { x: 25.5, z: 10.5 };
  const first = placeNavigationNode(document, 25, 9, { patrol: true });
  document = first.document;
  const second = placeNavigationNode(document, 20, 9, { patrol: true });
  document = second.document;
  return placeNavigationLink(document,
    { kind: "node", nodeId: first.nodeId },
    { kind: "node", nodeId: second.nodeId }).document;
}

function spawnEnemy(simulation, layerIndex, x, z, sequence) {
  return simulation.enemies.spawn({
    spawnSequence: sequence,
    spawnTick: 0,
    x,
    z,
    radius: ENEMY_WIZARD.radius,
    massKg: ENEMY_WIZARD.massKg,
    maximumHealth: COMBAT.maximumHealth,
    shotReadyTick: 10_000,
    facingX: 1,
    facingZ: 0,
    guardX: x,
    guardZ: z,
    worldY: simulation.layerBaseY[layerIndex],
    layerIndex,
  });
}

function patrolSimulation(options = {}) {
  const source = patrolDocument();
  const simulation = new Simulation({
    scenario: new ArenaScenario(source.document),
    gameplayProfile: GAMEPLAY_PROFILE_OBELISK_DUEL,
    enemyAiProfile: ENEMY_AI_PROFILE_INVESTIGATIVE,
    particleBurstCount: 0,
    ...options,
  });
  return { simulation, upperLayerId: source.upperLayerId };
}

test("unaware enemies patrol independently on two layers through one field budget", () => {
  const { simulation, upperLayerId } = patrolSimulation();
  const upperIndex = simulation.layerIdToIndex.get(upperLayerId);
  spawnEnemy(simulation, 0, 24.5, 5.5, 1);
  spawnEnemy(simulation, upperIndex, 18.5, 8.5, 2);
  simulation.tick(null);
  assert.equal(simulation.enemies.topologyPhase[0], NAVIGATION_ROUTE_PHASE.localGoal);
  assert.equal(simulation.enemies.topologyPhase[1], NAVIGATION_ROUTE_PHASE.localGoal);
  assert.equal(simulation.enemies.patrolDwellRemaining[0], 60);
  assert.equal(simulation.enemies.patrolDwellRemaining[1], 60);
  const detached = simulation.snapshot();
  const firstRouteKey = detached.enemies[0].navigationRoute.ports[0].key;
  detached.enemies[0].navigationRoute.ports[0].key = "mutated";
  assert.equal(simulation.snapshot().enemies[0].navigationRoute.ports[0].key, firstRouteKey);
  assert.deepEqual(
    simulation.snapshot().navigation.layers.map((layer) => layer.revision),
    [1, 1],
  );
  for (let tick = 0; tick < 75; tick += 1) simulation.tick(null);
  assert.notEqual(simulation.enemies.previousRoutePort[0], NAVIGATION_TOPOLOGY.noPort);
  assert.notEqual(simulation.enemies.previousRoutePort[1], NAVIGATION_TOPOLOGY.noPort);
  assert.ok(simulation.enemies.x[0] < 24.5);
  assert.ok(simulation.enemies.x[1] < 18.5);
  assert.equal(simulation.snapshot().navigation.expansionsThisTick <= 2_048, true);
  assert.equal(simulation.snapshot().enemies[1].layerId, upperLayerId);
});

test("perception intent interrupts patrol and clears its bounded route", () => {
  const { simulation } = patrolSimulation();
  spawnEnemy(simulation, 0, 24.5, 5.5, 1);
  simulation.tick(null);
  simulation.enemies.perceptionState[0] = PERCEPTION_STATE.engaged;
  simulation.tick(null);
  assert.equal(simulation.enemies.topologyPhase[0], NAVIGATION_ROUTE_PHASE.none);
  assert.deepEqual(simulation.enemies.navigationRoute(0), []);
  assert.equal(simulation.navigationRouteEvents().recent.at(-1).type, "route-cleared");
  simulation.enemies.perceptionState[0] = PERCEPTION_STATE.unaware;
  simulation.tick(null);
  assert.equal(simulation.enemies.topologyPhase[0], NAVIGATION_ROUTE_PHASE.localGoal);
  simulation.enemies.health[0] = 30;
  simulation.tick(null);
  assert.equal(simulation.enemies.topologyPhase[0], NAVIGATION_ROUTE_PHASE.none);
});

test("spawn rotation is deterministic and patrol avoids an immediate reversal", () => {
  const targetForSequence = (sequence) => {
    const { simulation } = patrolSimulation();
    spawnEnemy(simulation, 0, 24.5, 5.5, sequence);
    for (let tick = 0; tick < 61; tick += 1) simulation.tick(null);
    return simulation.snapshot().enemies[0].navigationRoute.currentPort.key;
  };
  assert.equal(targetForSequence(0), targetForSequence(0));
  assert.notEqual(targetForSequence(0), targetForSequence(1));

  const { simulation } = patrolSimulation();
  spawnEnemy(simulation, 0, 24.5, 5.5, 1);
  simulation.tick(null);
  const portAt = (cx, cz) => simulation.navigationTopology.portMetadata.findIndex(
    (port) => port.kind === "node" && port.layerId === "ground" && port.cx === cx && port.cz === cz,
  );
  const previous = portAt(24, 5);
  const current = portAt(19, 5);
  const expected = portAt(21, 9);
  simulation.enemies.x[0] = 19.5;
  simulation.enemies.z[0] = 5.5;
  simulation.enemies.previousX[0] = 19.5;
  simulation.enemies.previousZ[0] = 5.5;
  simulation.enemies.previousRoutePort[0] = previous;
  simulation.enemies.currentRoutePort[0] = current;
  simulation.enemies.patrolPort[0] = current;
  simulation.enemies.patrolDwellRemaining[0] = 1;
  simulation.enemies.setNavigationRoute(0, [previous, current]);
  simulation.tick(null);
  assert.equal(simulation.enemies.currentRoutePort[0], expected);
});

test("schema-v15 patrol state and route events replay exactly", () => {
  const simulation = new Simulation({
    scenario: new ArenaScenario(replayPatrolDocument()),
    gameplayProfile: GAMEPLAY_PROFILE_OBELISK_DUEL,
    enemyAiProfile: ENEMY_AI_PROFILE_INVESTIGATIVE,
    particleBurstCount: 0,
  });
  for (let tick = 0; tick < 90; tick += 1) simulation.tick(null);
  const recording = simulation.exportCommandLog();
  assert.equal(
    recording.configuration.authoredNavigationTopologyProfile,
    AUTHORED_NAVIGATION_TOPOLOGY_PROFILE_V1,
  );
  const replay = Simulation.replay(recording);
  assert.deepEqual(replay.snapshot().enemies, simulation.snapshot().enemies);
  assert.deepEqual(replay.navigationRouteEvents(), simulation.navigationRouteEvents());
});

test("the frozen topology-none profile leaves authored patrol nodes inert", () => {
  const { simulation } = patrolSimulation({
    authoredNavigationTopologyProfile: AUTHORED_NAVIGATION_TOPOLOGY_PROFILE_NONE,
  });
  spawnEnemy(simulation, 0, 24.5, 5.5, 1);
  for (let tick = 0; tick < 90; tick += 1) simulation.tick(null);
  assert.equal(simulation.enemies.topologyPhase[0], NAVIGATION_ROUTE_PHASE.none);
  assert.equal(simulation.enemies.x[0], 24.5);
});

test("a map without patrol nodes stays inert and rate-limits failed attachment", () => {
  const simulation = new Simulation({
    scenario: new ArenaScenario(borderedMap()),
    gameplayProfile: GAMEPLAY_PROFILE_OBELISK_DUEL,
    enemyAiProfile: ENEMY_AI_PROFILE_INVESTIGATIVE,
    particleBurstCount: 0,
  });
  spawnEnemy(simulation, 0, 24.5, 5.5, 1);
  simulation.tick(null);
  const retryTick = simulation.enemies.routeReplanTick[0];
  assert.equal(retryTick, 1 + 30);
  for (let tick = 0; tick < 10; tick += 1) simulation.tick(null);
  assert.equal(simulation.enemies.routeReplanTick[0], retryTick);
  assert.equal(simulation.enemies.topologyPhase[0], NAVIGATION_ROUTE_PHASE.none);
  assert.equal(simulation.enemies.x[0], 24.5);
});
