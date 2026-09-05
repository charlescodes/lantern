import assert from "node:assert/strict";
import test from "node:test";

import {
  createLayer,
  placeElevatorConnector,
  placeNavigationLink,
  placeNavigationNode,
} from "../src/authoring/authoring_commands.js";
import {
  COMBAT,
  ENEMY_AI_PROFILE_INVESTIGATIVE,
  ENEMY_WIZARD,
  GAMEPLAY_PROFILE_OBELISK_DUEL,
  NAVIGATION_ROUTE_FAILURE,
  NAVIGATION_ROUTE_PHASE,
} from "../src/config.js";
import { ELEVATOR_MOTION, ELEVATOR_STOP } from "../src/sim/elevator_pool.js";
import { GridMap } from "../src/sim/grid_map.js";
import {
  ArenaScenario,
  createNavigationDebugArenaScenario,
} from "../src/sim/scenario.js";
import { Simulation } from "../src/sim/simulation.js";
import { SUPPORT_KIND } from "../src/sim/vertical_body.js";

function borderedMap() {
  const map = new GridMap(14, 14, undefined, { x: 1.5, z: 1.5 });
  for (let cell = 0; cell < 14; cell += 1) {
    map.set(cell, 0, 1);
    map.set(cell, 13, 1);
    map.set(0, cell, 1);
    map.set(13, cell, 1);
  }
  return map;
}

function routeFixture(options = {}) {
  let document = new ArenaScenario(borderedMap()).toAuthoringJSON();
  const lowerLayerId = document.playerStart.layerId;
  const upper = createLayer(document, lowerLayerId, "above", { baseY: 3 });
  document = upper.document;
  document.playerStart = { layerId: lowerLayerId, x: 1.5, z: 1.5 };
  const connector = placeElevatorConnector(document, 7, 7, {
    lowerLayerId,
    upperLayerId: upper.layerId,
    initialStop: options.initialStop ?? "lower",
    travelDurationSeconds: 1,
    dwellSeconds: options.dwellSeconds ?? 1,
  });
  document = connector.document;
  const lowerSource = placeNavigationNode(document, 3, 7, { layerId: lowerLayerId });
  document = lowerSource.document;
  const lowerStage = placeNavigationNode(document, 6, 7, { layerId: lowerLayerId });
  document = lowerStage.document;
  const lowerSecondStage = placeNavigationNode(document, 7, 6, { layerId: lowerLayerId });
  document = lowerSecondStage.document;
  const upperStage = placeNavigationNode(document, 8, 7, { layerId: upper.layerId });
  document = upperStage.document;
  const upperTarget = placeNavigationNode(document, 11, 7, { layerId: upper.layerId });
  document = upperTarget.document;
  const links = [
    [{ kind: "node", nodeId: lowerSource.nodeId }, { kind: "node", nodeId: lowerStage.nodeId }],
    [{ kind: "node", nodeId: lowerStage.nodeId }, {
      kind: "connector-endpoint", connectorId: connector.connectorId, stop: "lower",
    }],
    [{ kind: "node", nodeId: lowerSecondStage.nodeId }, {
      kind: "connector-endpoint", connectorId: connector.connectorId, stop: "lower",
    }],
    [{ kind: "connector-endpoint", connectorId: connector.connectorId, stop: "upper" }, {
      kind: "node", nodeId: upperStage.nodeId,
    }],
    [{ kind: "node", nodeId: upperStage.nodeId }, { kind: "node", nodeId: upperTarget.nodeId }],
  ];
  for (const [from, to] of links) document = placeNavigationLink(document, from, to).document;
  return {
    document,
    lowerLayerId,
    upperLayerId: upper.layerId,
    connectorId: connector.connectorId,
    lowerSourceKey: `node:${lowerSource.nodeId}`,
    lowerStageKey: `node:${lowerStage.nodeId}`,
    lowerSecondStageKey: `node:${lowerSecondStage.nodeId}`,
    upperTargetKey: `node:${upperTarget.nodeId}`,
  };
}

function simulationFor(source) {
  return new Simulation({
    scenario: new ArenaScenario(source.document),
    gameplayProfile: GAMEPLAY_PROFILE_OBELISK_DUEL,
    enemyAiProfile: ENEMY_AI_PROFILE_INVESTIGATIVE,
    particleBurstCount: 0,
  });
}

function spawnEnemy(simulation, layerId, x, z, sequence = 1) {
  const layerIndex = simulation.layerIdToIndex.get(layerId);
  return simulation.enemies.spawn({
    spawnSequence: sequence,
    spawnTick: simulation.tickCount,
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
  });
}

function installRoute(simulation, enemyId, sourceKey, targetKey) {
  const route = simulation.navigationTopology.route(sourceKey, targetKey);
  assert.equal(route.ok, true);
  const ports = route.ports.map((metadata) => simulation.navigationTopology.portMetadata.findIndex(
    (candidate) => candidate.key === metadata.key,
  ));
  const index = simulation.enemies.findIndexById(enemyId);
  simulation.enemies.setNavigationRoute(index, ports);
  simulation.enemies.topologyPhase[index] = NAVIGATION_ROUTE_PHASE.approachPort;
  simulation.enemies.topologyRevision[index] = simulation.topologyRevision;
  simulation.enemies.currentRoutePort[index] = ports[0];
  simulation.enemies.routeFailure[index] = NAVIGATION_ROUTE_FAILURE.none;
  simulation.enemies.routeReplanTick[index] = 0;
  simulation.enemies.routeMissedCycles[index] = 0;
  return { index, ports };
}

function runUntil(simulation, predicate, maximumTicks = 2_000) {
  for (let tick = 0; tick < maximumTicks; tick += 1) {
    simulation.tick(null);
    if (predicate()) return tick + 1;
  }
  assert.fail(`Condition did not become true within ${maximumTicks} ticks`);
}

test("one enemy physically rides an autonomous elevator in both directions", () => {
  const source = routeFixture();
  const simulation = simulationFor(source);
  const enemyId = spawnEnemy(simulation, source.lowerLayerId, 3.5, 7.5);
  let route = installRoute(simulation, enemyId, source.lowerSourceKey, source.upperTargetKey);
  const runtimeId = simulation.navigationTopology.portConnectorRuntimeId[route.ports[2]];
  runUntil(simulation, () => simulation.enemies.routeLength[route.index] === 0);
  assert.equal(simulation.enemies.layerIndex[route.index], simulation.layerIdToIndex.get(source.upperLayerId));
  assert.ok(simulation.enemies.x[route.index] > 10.5);
  const events = simulation.navigationRouteEvents().recent;
  assert.ok(events.some((event) => event.type === "ride" && event.supportId === runtimeId));
  assert.ok(events.some((event) => event.type === "disembark"));

  route = installRoute(simulation, enemyId, source.upperTargetKey, source.lowerSourceKey);
  runUntil(simulation, () => simulation.enemies.routeLength[route.index] === 0);
  assert.equal(simulation.enemies.layerIndex[route.index], simulation.layerIdToIndex.get(source.lowerLayerId));
  assert.ok(simulation.enemies.x[route.index] < 4.5);
  assert.equal(simulation.elevators.hasDebugRequest[0], 0);
  assert.equal(
    simulation.exportCommandLog().commands.some((entry) => entry.command.actions.some(
      (action) => action.type === "summonElevator" || action.type === "cycleElevator",
    )),
    false,
  );
});

test("an initially absent platform is observed and boarded without a request", () => {
  const source = routeFixture({ initialStop: "upper" });
  const simulation = simulationFor(source);
  const enemyId = spawnEnemy(simulation, source.lowerLayerId, 3.5, 7.5);
  const route = installRoute(simulation, enemyId, source.lowerSourceKey, source.upperTargetKey);
  runUntil(simulation, () => simulation.enemies.routeLength[route.index] === 0);
  assert.equal(simulation.enemies.layerIndex[route.index], simulation.layerIdToIndex.get(source.upperLayerId));
  assert.equal(simulation.elevators.hasDebugRequest[0], 0);
});

test("a final-dwell miss waits for the next cycle and retains physical support identity", () => {
  const source = routeFixture();
  const simulation = simulationFor(source);
  const enemyId = spawnEnemy(simulation, source.lowerLayerId, 6.5, 7.5);
  const route = installRoute(simulation, enemyId, source.lowerSourceKey, source.upperTargetKey);
  simulation.enemies.routeCursor[route.index] = 2;
  simulation.enemies.topologyPhase[route.index] = NAVIGATION_ROUTE_PHASE.board;
  simulation.enemies.currentRoutePort[route.index] = route.ports[2];
  const runtimeId = simulation.navigationTopology.portConnectorRuntimeId[route.ports[2]];
  simulation.enemies.routeConnectorRuntimeId[route.index] = runtimeId;
  simulation.elevators.dwellRemaining[0] = 1;
  simulation.tick(null);
  assert.equal(simulation.enemies.routeMissedCycles[route.index], 1);
  assert.equal(simulation.enemies.topologyPhase[route.index], NAVIGATION_ROUTE_PHASE.waitPlatform);
  runUntil(simulation, () => simulation.enemies.routeLength[route.index] === 0);
  assert.equal(simulation.enemies.layerIndex[route.index], simulation.layerIdToIndex.get(source.upperLayerId));
  assert.ok(simulation.navigationRouteEvents().recent.some(
    (event) => event.type === "ride" && event.supportId === runtimeId,
  ));
  assert.equal(simulation.elevators.motion[0] === ELEVATOR_MOTION.DWELLING, true);
});

test("two complete but insufficient dwell windows trigger the bounded cooldown", () => {
  const source = routeFixture({ dwellSeconds: 0.1 });
  const simulation = simulationFor(source);
  const enemyId = spawnEnemy(simulation, source.lowerLayerId, 3.5, 7.5);
  const route = installRoute(simulation, enemyId, source.lowerSourceKey, source.upperTargetKey);
  runUntil(simulation, () => (
    simulation.enemies.routeFailure[route.index] === NAVIGATION_ROUTE_FAILURE.missedCycles
  ), 1_000);
  assert.equal(simulation.enemies.routeMissedCycles[route.index], 2);
  assert.equal(simulation.enemies.routeReplanTick[route.index], simulation.tickCount + 30);
  assert.equal(simulation.navigationRouteEvents().recent.filter(
    (event) => event.type === "platform-missed" && event.reason === "insufficient-dwell",
  ).length, 2);
});

test("the authored navigation arena routes and physically traverses both chained connectors", () => {
  const scenario = createNavigationDebugArenaScenario();
  const document = scenario.toAuthoringJSON();
  assert.equal(document.version, 6);
  assert.equal(document.layers.length, 3);
  assert.deepEqual(document.layers.map((layer) => [layer.width, layer.height]), [
    [24, 24],
    [24, 24],
    [24, 24],
  ]);
  assert.deepEqual(document.layers.map((layer) => layer.baseY), [0, 3, 6]);
  assert.deepEqual(document.connectors.map((connector) => connector.initialStop), ["lower", "lower"]);
  assert.deepEqual(document.playerStart, { layerId: document.layers[0].id, x: 3.5, z: 18.5 });
  assert.deepEqual(document.layers[0].markers.obelisk, { x: 14.5, z: 18.5 });
  assert.ok(Math.hypot(
    document.playerStart.x - document.layers[0].markers.obelisk.x,
    document.playerStart.z - document.layers[0].markers.obelisk.z,
  ) <= 12);
  assert.deepEqual(new ArenaScenario(document).toAuthoringJSON(), document);
  const pureRoute = scenario.navigationTopology.route(
    "node:navigation-node-0003",
    "node:navigation-node-0010",
  );
  assert.equal(pureRoute.ok, true);
  assert.deepEqual(
    pureRoute.ports.filter((port) => port.kind === "connector-endpoint").map((port) => port.key),
    [
      "connector:elevator-0001:lower",
      "connector:elevator-0001:upper",
      "connector:elevator-0002:lower",
      "connector:elevator-0002:upper",
    ],
  );

  const simulation = new Simulation({
    scenario,
    gameplayProfile: GAMEPLAY_PROFILE_OBELISK_DUEL,
    enemyAiProfile: ENEMY_AI_PROFILE_INVESTIGATIVE,
    particleBurstCount: 0,
  });
  simulation.encounter.enabled = false;
  const enemyId = spawnEnemy(simulation, document.layers[0].id, 7.5, 14.5);
  let route = installRoute(
    simulation,
    enemyId,
    "node:navigation-node-0003",
    "node:navigation-node-0010",
  );
  runUntil(simulation, () => simulation.enemies.routeLength[route.index] === 0, 5_000);
  assert.equal(simulation.enemies.layerIndex[route.index], 2);
  assert.ok(simulation.enemies.x[route.index] > 19.5);
  route = installRoute(
    simulation,
    enemyId,
    "node:navigation-node-0010",
    "node:navigation-node-0003",
  );
  runUntil(simulation, () => simulation.enemies.routeLength[route.index] === 0, 5_000);
  assert.equal(simulation.enemies.layerIndex[route.index], 0);
  assert.ok(simulation.enemies.z[route.index] > 13.5);
  assert.equal(simulation.elevators.hasDebugRequest[0], 0);
  assert.equal(simulation.elevators.hasDebugRequest[1], 0);
});

test("two riders approach from ordinary queue nodes and complete without reservations", () => {
  const source = routeFixture();
  const simulation = simulationFor(source);
  const firstId = spawnEnemy(simulation, source.lowerLayerId, 3.5, 7.5, 1);
  const secondId = spawnEnemy(simulation, source.lowerLayerId, 7.5, 6.5, 2);
  const first = installRoute(simulation, firstId, source.lowerSourceKey, source.upperTargetKey);
  const second = installRoute(
    simulation,
    secondId,
    source.lowerSecondStageKey,
    source.upperTargetKey,
  );
  runUntil(simulation, () => (
    simulation.enemies.routeLength[simulation.enemies.findIndexById(firstId)] === 0
    && simulation.enemies.routeLength[simulation.enemies.findIndexById(secondId)] === 0
  ), 5_000);
  for (const enemyId of [firstId, secondId]) {
    const index = simulation.enemies.findIndexById(enemyId);
    assert.ok(index >= 0);
    assert.equal(simulation.enemies.layerIndex[index], simulation.layerIdToIndex.get(source.upperLayerId));
    assert.equal(simulation.enemies.routeFailure[index], NAVIGATION_ROUTE_FAILURE.none);
  }
  assert.equal(simulation.elevators.supportedBodyCount[0], 0);
  assert.ok(simulation.navigationRouteEvents().retained <= 128);
  assert.notEqual(first.index, -1);
  assert.notEqual(second.index, -1);
});

test("two missed boarding windows impose an exact deterministic cooldown before retry", () => {
  const source = routeFixture();
  const simulation = simulationFor(source);
  const enemyId = spawnEnemy(simulation, source.lowerLayerId, 6.5, 7.5);
  const route = installRoute(simulation, enemyId, source.lowerSourceKey, source.upperTargetKey);
  simulation.enemies.routeCursor[route.index] = 2;
  simulation.enemies.topologyPhase[route.index] = NAVIGATION_ROUTE_PHASE.board;
  simulation.enemies.currentRoutePort[route.index] = route.ports[2];
  simulation.enemies.routeConnectorRuntimeId[route.index]
    = simulation.navigationTopology.portConnectorRuntimeId[route.ports[2]];
  simulation.elevators.dwellRemaining[0] = 1;
  simulation.tick(null);
  assert.equal(simulation.enemies.routeMissedCycles[route.index], 1);
  runUntil(simulation, () => (
    simulation.elevators.motion[0] === ELEVATOR_MOTION.DWELLING
    && simulation.elevators.currentStop[0] === ELEVATOR_STOP.LOWER
  ));
  simulation.enemies.topologyPhase[route.index] = NAVIGATION_ROUTE_PHASE.board;
  simulation.elevators.dwellRemaining[0] = 1;
  simulation.tick(null);
  const retryTick = simulation.tickCount + 30;
  assert.equal(simulation.enemies.topologyPhase[route.index], NAVIGATION_ROUTE_PHASE.none);
  assert.equal(simulation.enemies.routeFailure[route.index], NAVIGATION_ROUTE_FAILURE.missedCycles);
  assert.equal(simulation.enemies.routeReplanTick[route.index], retryTick);
  while (simulation.tickCount < retryTick - 1) simulation.tick(null);
  assert.equal(simulation.enemies.topologyPhase[route.index], NAVIGATION_ROUTE_PHASE.none);
  simulation.tick(null);
  assert.notEqual(simulation.enemies.topologyPhase[route.index], NAVIGATION_ROUTE_PHASE.none);
  runUntil(simulation, () => simulation.enemies.routeLength[route.index] === 0);
  assert.equal(simulation.enemies.layerIndex[route.index], simulation.layerIdToIndex.get(source.upperLayerId));
});

test("support loss, connector removal, and topology revision invalidate bounded routes", () => {
  const source = routeFixture();
  let simulation = simulationFor(source);
  let enemyId = spawnEnemy(simulation, source.lowerLayerId, 3.5, 7.5);
  let route = installRoute(simulation, enemyId, source.lowerSourceKey, source.upperTargetKey);
  runUntil(simulation, () => (
    simulation.enemies.topologyPhase[route.index] === NAVIGATION_ROUTE_PHASE.ride
  ));
  simulation.enemies.supportKind[route.index] = SUPPORT_KIND.FLOOR;
  simulation.enemies.supportId[route.index] = 0;
  simulation.tick(null);
  assert.equal(simulation.enemies.routeFailure[route.index], NAVIGATION_ROUTE_FAILURE.displaced);

  simulation = simulationFor(source);
  enemyId = spawnEnemy(simulation, source.lowerLayerId, 3.5, 7.5);
  route = installRoute(simulation, enemyId, source.lowerSourceKey, source.upperTargetKey);
  runUntil(simulation, () => (
    simulation.enemies.topologyPhase[route.index] === NAVIGATION_ROUTE_PHASE.waitPlatform
  ));
  simulation.elevators.removeSwap(0);
  simulation.tick(null);
  assert.equal(simulation.enemies.routeFailure[route.index], NAVIGATION_ROUTE_FAILURE.missingConnector);

  simulation = simulationFor(source);
  enemyId = spawnEnemy(simulation, source.lowerLayerId, 3.5, 7.5);
  route = installRoute(simulation, enemyId, source.lowerSourceKey, source.upperTargetKey);
  simulation.topologyRevision += 1;
  simulation.tick(null);
  assert.equal(simulation.enemies.routeFailure[route.index], NAVIGATION_ROUTE_FAILURE.routeInvalid);
  assert.equal(simulation.enemies.routeLength[route.index], 0);
});

test("reset during a ride clears route state and restores the authored elevator stop", () => {
  const source = routeFixture();
  const simulation = simulationFor(source);
  const enemyId = spawnEnemy(simulation, source.lowerLayerId, 3.5, 7.5);
  const route = installRoute(simulation, enemyId, source.lowerSourceKey, source.upperTargetKey);
  runUntil(simulation, () => (
    simulation.enemies.topologyPhase[route.index] === NAVIGATION_ROUTE_PHASE.ride
  ));
  assert.equal(simulation.enemies.supportKind[route.index], SUPPORT_KIND.ELEVATOR);
  simulation.reset();
  assert.equal(simulation.enemies.activeCount, 0);
  assert.equal(simulation.elevators.currentStop[0], ELEVATOR_STOP.LOWER);
  assert.equal(simulation.elevators.motion[0], ELEVATOR_MOTION.DWELLING);
  assert.equal(simulation.elevators.supportedBodyCount[0], 0);
  assert.deepEqual(simulation.navigationRouteEvents().recent.map((event) => event.type), ["reset"]);
  const replay = Simulation.replay(simulation.exportCommandLog());
  assert.deepEqual(replay.navigationTopologySnapshot(), simulation.navigationTopologySnapshot());
  assert.equal(replay.elevators.currentStop[0], ELEVATOR_STOP.LOWER);
  assert.equal(replay.enemies.activeCount, 0);
});

test("stable connector IDs survive elevator pool swap-removal during a route", () => {
  const scenario = createNavigationDebugArenaScenario();
  const simulation = new Simulation({
    scenario,
    gameplayProfile: GAMEPLAY_PROFILE_OBELISK_DUEL,
    enemyAiProfile: ENEMY_AI_PROFILE_INVESTIGATIVE,
    particleBurstCount: 0,
  });
  simulation.encounter.enabled = false;
  const middleLayerId = scenario.toAuthoringJSON().layers[1].id;
  const enemyId = spawnEnemy(simulation, middleLayerId, 16.5, 10.5);
  const route = installRoute(
    simulation,
    enemyId,
    "node:navigation-node-0007",
    "node:navigation-node-0010",
  );
  const connectorRuntimeId = simulation.elevators.id[1];
  assert.equal(simulation.elevators.removeSwap(0), true);
  assert.equal(simulation.elevators.id[0], connectorRuntimeId);
  runUntil(simulation, () => simulation.enemies.routeLength[route.index] === 0, 3_000);
  assert.equal(simulation.enemies.layerIndex[route.index], 2);
  assert.ok(simulation.navigationRouteEvents().recent.some(
    (event) => event.type === "ride" && event.connectorRuntimeId === connectorRuntimeId,
  ));
});

test("a blocked rider remains bounded through ten simulated minutes", () => {
  const source = routeFixture();
  const simulation = simulationFor(source);
  const enemyId = spawnEnemy(simulation, source.lowerLayerId, 3.5, 7.5);
  const route = installRoute(simulation, enemyId, source.lowerSourceKey, source.upperTargetKey);
  runUntil(simulation, () => (
    simulation.enemies.topologyPhase[route.index] === NAVIGATION_ROUTE_PHASE.waitPlatform
  ));
  simulation.elevators.removeSwap(0);
  simulation.tick(null);
  const routeStorage = simulation.enemies.routePorts;
  const fieldBuffers = [
    simulation.destinationFields.buildingCosts,
    ...simulation.destinationFields.completedCosts,
  ];
  const completedStorage = simulation.destinationFields.completedCosts;
  for (let tick = 0; tick < 36_000; tick += 1) simulation.tick(null);
  const events = simulation.navigationRouteEvents();
  assert.equal(simulation.enemies.routePorts, routeStorage);
  assert.equal(simulation.destinationFields.completedCosts, completedStorage);
  assert.ok(fieldBuffers.includes(simulation.destinationFields.buildingCosts));
  assert.ok(simulation.destinationFields.completedCosts.every(
    (buffer) => fieldBuffers.includes(buffer),
  ));
  assert.ok(events.retained <= events.capacity);
  assert.ok(events.recent.length <= 32);
  assert.ok(simulation.snapshot().navigation.expansionsThisTick <= 2_048);
});
