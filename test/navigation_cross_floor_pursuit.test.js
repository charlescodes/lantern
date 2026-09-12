import assert from "node:assert/strict";
import test from "node:test";

import { commandFromAuthoringAction } from "../src/authoring/authoring_history.js";
import {
  ACTOR_TEAM,
  COMBAT,
  ENEMY_AI_PROFILE_INVESTIGATIVE,
  ENEMY_WIZARD,
  GAMEPLAY_PROFILE_OBELISK_DUEL,
  NAVIGATION_EVIDENCE,
  NAVIGATION_ROUTE_PHASE,
  NAVIGATION_TOPOLOGY,
} from "../src/config.js";
import { ELEVATOR_MOTION, ELEVATOR_STOP } from "../src/sim/elevator_pool.js";
import { PERCEPTION_STATE, TARGET_KIND } from "../src/sim/perceptive_wizard.js";
import {
  ArenaScenario,
  createNavigationDebugArenaScenario,
} from "../src/sim/scenario.js";
import { Simulation } from "../src/sim/simulation.js";
import { SUPPORT_KIND } from "../src/sim/vertical_body.js";
import {
  cloneFireballDefinition,
  DEFAULT_FIREBALL_DEFINITION,
} from "../src/spells/fireball_definition.js";

function createSimulation() {
  const simulation = new Simulation({
    scenario: createNavigationDebugArenaScenario(),
    gameplayProfile: GAMEPLAY_PROFILE_OBELISK_DUEL,
    enemyAiProfile: ENEMY_AI_PROFILE_INVESTIGATIVE,
    particleBurstCount: 0,
  });
  simulation.encounter.enabled = false;
  return simulation;
}

function spawnObserver(simulation, x = 7.5, z = 14.5, sequence = 1) {
  const enemyId = simulation.enemies.spawn({
    spawnSequence: sequence,
    spawnTick: simulation.tickCount,
    x,
    z,
    radius: ENEMY_WIZARD.radius,
    massKg: ENEMY_WIZARD.massKg,
    maximumHealth: COMBAT.maximumHealth,
    shotReadyTick: 0xffff_ffff,
    facingX: simulation.player.x - x,
    facingZ: simulation.player.z - z,
    guardX: x,
    guardZ: z,
    worldY: simulation.layerBaseY[0],
    layerIndex: 0,
    perceptionLane: 1,
  });
  const index = simulation.enemies.findIndexById(enemyId);
  simulation.enemies.perceptionState[index] = PERCEPTION_STATE.engaged;
  simulation.enemies.confirmedTargetKind[index] = TARGET_KIND.player;
  simulation.enemies.confirmedTargetId[index] = simulation.player.id;
  simulation.enemies.confirmedTargetTeam[index] = ACTOR_TEAM.player;
  return { enemyId, index };
}

function putPlayerOnElevator(simulation, elevatorIndex, stop) {
  const layerIndex = stop === ELEVATOR_STOP.LOWER
    ? simulation.elevators.lowerLayerIndex[elevatorIndex]
    : simulation.elevators.upperLayerIndex[elevatorIndex];
  const worldY = stop === ELEVATOR_STOP.LOWER
    ? simulation.elevators.lowerY[elevatorIndex]
    : simulation.elevators.upperY[elevatorIndex];
  simulation.elevators.motion[elevatorIndex] = ELEVATOR_MOTION.DWELLING;
  simulation.elevators.currentStop[elevatorIndex] = stop;
  simulation.elevators.worldY[elevatorIndex] = worldY;
  simulation.elevators.previousWorldY[elevatorIndex] = worldY;
  simulation.elevators.velocityY[elevatorIndex] = 0;
  simulation.elevators.dwellRemaining[elevatorIndex] = 60;
  Object.assign(simulation.player, {
    x: simulation.elevators.x[elevatorIndex],
    z: simulation.elevators.z[elevatorIndex],
    previousX: simulation.elevators.x[elevatorIndex],
    previousZ: simulation.elevators.z[elevatorIndex],
    worldY,
    previousWorldY: worldY,
    layerIndex,
    supportKind: SUPPORT_KIND.ELEVATOR,
    supportId: simulation.elevators.id[elevatorIndex],
    transitConnectorId: simulation.elevators.id[elevatorIndex],
  });
}

function putPlayerOnFloor(simulation, layerIndex, x, z) {
  Object.assign(simulation.player, {
    x,
    z,
    previousX: x,
    previousZ: z,
    worldY: simulation.layerBaseY[layerIndex],
    previousWorldY: simulation.layerBaseY[layerIndex],
    layerIndex,
    supportKind: SUPPORT_KIND.FLOOR,
    supportId: 0,
    transitConnectorId: 0,
  });
}

function facePlayer(simulation, index) {
  const dx = simulation.player.x - simulation.enemies.x[index];
  const dz = simulation.player.z - simulation.enemies.z[index];
  const length = Math.hypot(dx, dz);
  simulation.enemies.facingX[index] = dx / length;
  simulation.enemies.facingZ[index] = dz / length;
}

function runUntil(simulation, predicate, maximumTicks = 5_000) {
  for (let tick = 0; tick < maximumTicks; tick += 1) {
    simulation.tick(null);
    if (predicate()) return tick + 1;
  }
  assert.fail(`Condition did not become true within ${maximumTicks} ticks`);
}

function observeElevatorDeparture(simulation, observerIndex, elevatorIndex, destinationStop) {
  const sourceStop = destinationStop === ELEVATOR_STOP.UPPER
    ? ELEVATOR_STOP.LOWER
    : ELEVATOR_STOP.UPPER;
  putPlayerOnElevator(simulation, elevatorIndex, sourceStop);
  facePlayer(simulation, observerIndex);
  while ((simulation.tickCount + 1) % 4 !== simulation.enemies.perceptionLane[observerIndex]) {
    simulation.tick(null);
  }
  simulation.tick(null);
  assert.equal(
    simulation.enemies.observedConnectorRuntimeId[observerIndex],
    simulation.elevators.id[elevatorIndex],
  );
  putPlayerOnElevator(simulation, elevatorIndex, destinationStop);
  simulation.tick(null);
}

test("only an observer of the same supported connector infers its opposite endpoint", () => {
  const simulation = createSimulation();
  const observer = spawnObserver(simulation);
  const control = spawnObserver(simulation, 2.5, 2.5, 2);
  simulation.enemies.perceptionState[control.index] = PERCEPTION_STATE.unaware;
  simulation.enemies.confirmedTargetKind[control.index] = TARGET_KIND.none;
  simulation.enemies.facingX[control.index] = -1;
  simulation.enemies.facingZ[control.index] = 0;

  observeElevatorDeparture(simulation, observer.index, 0, ELEVATOR_STOP.UPPER);
  const endpoint = simulation.navigationTopology.portMetadata.findIndex(
    (port) => port.key === "connector:elevator-0001:upper",
  );
  assert.equal(simulation.enemies.navigationEvidence[observer.index], NAVIGATION_EVIDENCE.connectorTransition);
  assert.equal(simulation.enemies.knownTargetLayer[observer.index], 1);
  assert.equal(simulation.enemies.knownTargetPort[observer.index], endpoint);
  assert.equal(simulation.enemies.lastSeenX[observer.index], 6.5);
  assert.equal(simulation.enemies.lastSeenZ[observer.index], 18.5);
  assert.equal(simulation.enemies.topologyPhase[observer.index], NAVIGATION_ROUTE_PHASE.approachPort);
  assert.ok(simulation.enemies.routeLength[observer.index] > 0);
  assert.equal(simulation.enemies.navigationEvidence[control.index], NAVIGATION_EVIDENCE.none);
  assert.equal(simulation.enemies.knownTargetLayer[control.index], NAVIGATION_TOPOLOGY.noLayer);
  assert.equal(simulation.enemies.perceptionState[control.index], PERCEPTION_STATE.unaware);

  putPlayerOnFloor(simulation, 1, 20.5, 2.5);
  for (let tick = 0; tick < 30; tick += 1) simulation.tick(null);
  assert.equal(simulation.enemies.lastSeenX[observer.index], 6.5);
  assert.equal(simulation.enemies.lastSeenZ[observer.index], 18.5);
  runUntil(simulation, () => (
    simulation.enemies.layerIndex[observer.index] === 1
    && simulation.enemies.routeLength[observer.index] === 0
  ));
  assert.equal(simulation.enemies.perceptionState[observer.index], PERCEPTION_STATE.hunting);
  assert.equal(simulation.enemies.navigationEvidence[observer.index], NAVIGATION_EVIDENCE.connectorTransition);
  assert.equal(simulation.enemies.huntAnchorX[observer.index], 6.5);
  assert.equal(simulation.enemies.huntAnchorZ[observer.index], 18.5);
  assert.ok(simulation.navigationRouteEvents().recent.some(
    (event) => event.type === "target-layer-inference"
      && event.connectorRuntimeId === simulation.elevators.id[0],
  ));
});

test("unsupported, wrong-connector, and hidden layer changes cannot create transition evidence", () => {
  for (const mode of ["unsupported", "wrong-connector", "hidden-layer-change"]) {
    const simulation = createSimulation();
    const observer = spawnObserver(simulation);
    putPlayerOnElevator(simulation, 0, ELEVATOR_STOP.LOWER);
    facePlayer(simulation, observer.index);
    simulation.tick(null);
    assert.equal(
      simulation.enemies.observedConnectorRuntimeId[observer.index],
      simulation.elevators.id[0],
    );
    if (mode === "wrong-connector") {
      putPlayerOnElevator(simulation, 1, ELEVATOR_STOP.UPPER);
    } else {
      putPlayerOnFloor(simulation, 1, 20.5, 2.5);
    }
    if (mode === "hidden-layer-change") {
      simulation.enemies.observedConnectorRuntimeId[observer.index] = 0;
      simulation.enemies.observedConnectorLayer[observer.index] = NAVIGATION_TOPOLOGY.noLayer;
    }
    simulation.tick(null);
    assert.notEqual(
      simulation.enemies.navigationEvidence[observer.index],
      NAVIGATION_EVIDENCE.connectorTransition,
      mode,
    );
    assert.equal(simulation.enemies.routeLength[observer.index], 0, mode);
  }
});

test("losing sight before the player boards never arms an unseen connector transition", () => {
  const simulation = createSimulation();
  const observer = spawnObserver(simulation);
  putPlayerOnFloor(simulation, 0, 6.5, 18.5);
  runUntil(simulation, () => {
    facePlayer(simulation, observer.index);
    return simulation.enemies.hasLastSeen[observer.index] === 1;
  }, 20);
  assert.equal(simulation.enemies.observedConnectorRuntimeId[observer.index], 0);

  simulation.enemies.facingX[observer.index] = 0;
  simulation.enemies.facingZ[observer.index] = -1;
  putPlayerOnElevator(simulation, 0, ELEVATOR_STOP.LOWER);
  for (let tick = 0; tick < 8; tick += 1) simulation.tick(null);
  putPlayerOnElevator(simulation, 0, ELEVATOR_STOP.UPPER);
  simulation.tick(null);
  assert.notEqual(
    simulation.enemies.navigationEvidence[observer.index],
    NAVIGATION_EVIDENCE.connectorTransition,
  );
  assert.equal(simulation.enemies.knownTargetLayer[observer.index], 0);
  assert.equal(simulation.enemies.routeLength[observer.index], 0);
});

test("different floors still exclude sight, casting, and sound hearing", () => {
  const simulation = createSimulation();
  const observer = spawnObserver(simulation);
  putPlayerOnFloor(simulation, 1, 7.5, 14.5);
  simulation.enemies.shotReadyTick[observer.index] = 0;
  const heardBefore = simulation.soundEventMetrics.heardFootsteps;
  const listenerChecksBefore = simulation.soundEventMetrics.listenerChecks;
  const endTick = simulation.tickCount + 240;
  while (
    simulation.soundEventMetrics.emittedFootsteps === 0
    && simulation.tickCount < endTick
  ) {
    simulation.tick({ move: { x: 20.5, z: 14.5 } });
  }
  assert.ok(simulation.soundEventMetrics.emittedFootsteps > 0);
  assert.equal(simulation.enemies.currentVisibility[observer.index], 0);
  assert.equal(simulation.enemies.lineOfSight[observer.index], 0);
  assert.equal(simulation.projectiles.activeCount, 0);
  assert.equal(simulation.soundEventMetrics.heardFootsteps, heardBefore);
  assert.equal(simulation.soundEventMetrics.listenerChecks, listenerChecksBefore);
});

test("live connector removal clears the armed ID and deterministically replans retained evidence", () => {
  const simulation = createSimulation();
  const observer = spawnObserver(simulation);
  observeElevatorDeparture(simulation, observer.index, 0, ELEVATOR_STOP.UPPER);
  putPlayerOnFloor(simulation, 1, 20.5, 2.5);
  const command = commandFromAuthoringAction(simulation.authoringDocument(), {
    type: "removeConnector",
    connectorId: "elevator-0001",
  });
  simulation.tick({ actions: [{ type: "applyAuthoringCommand", command }] });
  assert.equal(simulation.lastError, null);
  assert.equal(simulation.enemies.observedConnectorRuntimeId[observer.index], 0);
  assert.equal(simulation.enemies.knownTargetPort[observer.index], NAVIGATION_TOPOLOGY.noPort);
  assert.equal(simulation.enemies.navigationEvidence[observer.index], NAVIGATION_EVIDENCE.connectorTransition);
  assert.equal(simulation.enemies.routeLength[observer.index], 0);
  const retryTick = simulation.enemies.routeReplanTick[observer.index];
  while (simulation.tickCount < retryTick) simulation.tick(null);
  assert.equal(simulation.enemies.routeLength[observer.index], 0);
  assert.equal(simulation.snapshot().enemies[observer.index].navigationRoute.failure, "disconnected");
});

test("live layer edits remap remembered targets by stable ID and clear deleted evidence", () => {
  const simulation = createSimulation();
  const observer = spawnObserver(simulation);
  const rememberedLayerId = simulation.layerIds[1];
  putPlayerOnFloor(simulation, 2, 2.5, 2.5);
  simulation.enemies.knownTargetLayer[observer.index] = 1;
  simulation.enemies.navigationEvidence[observer.index] = NAVIGATION_EVIDENCE.directSight;

  const createCommand = commandFromAuthoringAction(simulation.authoringDocument(), {
    type: "createLayer",
    layerId: simulation.layerIds[0],
    relativeLayerId: simulation.layerIds[0],
    direction: "below",
    name: "Temporary",
  });
  simulation.tick({ actions: [{ type: "applyAuthoringCommand", command: createCommand }] });
  assert.equal(simulation.lastError, null);
  assert.equal(
    simulation.layerIds[simulation.enemies.knownTargetLayer[observer.index]],
    rememberedLayerId,
  );
  const temporaryLayerId = simulation.layerIds[0];
  assert.equal(temporaryLayerId.startsWith("layer-"), true);

  simulation.enemies.knownTargetLayer[observer.index] = 0;
  simulation.enemies.navigationEvidence[observer.index] = NAVIGATION_EVIDENCE.directSight;
  const deleteCommand = commandFromAuthoringAction(simulation.authoringDocument(), {
    type: "deleteLayer",
    layerId: temporaryLayerId,
  });
  simulation.tick({ actions: [{ type: "applyAuthoringCommand", command: deleteCommand }] });
  assert.equal(simulation.lastError, null);
  assert.equal(simulation.enemies.knownTargetLayer[observer.index], NAVIGATION_TOPOLOGY.noLayer);
  assert.equal(simulation.enemies.navigationEvidence[observer.index], NAVIGATION_EVIDENCE.none);
});

test("an armed stable connector ID survives an unrelated elevator pool swap", () => {
  const simulation = createSimulation();
  const observer = spawnObserver(simulation, 16.5, 10.5);
  simulation.enemies.layerIndex[observer.index] = 1;
  simulation.enemies.worldY[observer.index] = simulation.layerBaseY[1];
  simulation.enemies.previousWorldY[observer.index] = simulation.layerBaseY[1];
  putPlayerOnElevator(simulation, 1, ELEVATOR_STOP.LOWER);
  const stableId = simulation.elevators.id[1];
  runUntil(simulation, () => {
    facePlayer(simulation, observer.index);
    return simulation.enemies.observedConnectorRuntimeId[observer.index] === stableId;
  }, 20);
  assert.equal(simulation.enemies.observedConnectorRuntimeId[observer.index], stableId);
  assert.equal(simulation.elevators.removeSwap(0), true);
  assert.equal(simulation.elevators.id[0], stableId);
  putPlayerOnElevator(simulation, 0, ELEVATOR_STOP.UPPER);
  simulation.tick(null);
  assert.equal(simulation.enemies.navigationEvidence[observer.index], NAVIGATION_EVIDENCE.connectorTransition);
  assert.equal(simulation.enemies.knownTargetLayer[observer.index], 2);
  assert.ok(simulation.navigationRouteEvents().recent.some(
    (event) => event.type === "target-layer-inference" && event.connectorRuntimeId === stableId,
  ));
});

test("same-floor sight reacquires after endpoint search and can arm the second connector", () => {
  const simulation = createSimulation();
  const observer = spawnObserver(simulation);
  observeElevatorDeparture(simulation, observer.index, 0, ELEVATOR_STOP.UPPER);
  putPlayerOnFloor(simulation, 1, 20.5, 2.5);
  runUntil(simulation, () => (
    simulation.enemies.layerIndex[observer.index] === 1
    && simulation.enemies.routeLength[observer.index] === 0
  ));
  putPlayerOnFloor(
    simulation,
    1,
    simulation.enemies.x[observer.index] + 2,
    simulation.enemies.z[observer.index],
  );
  runUntil(simulation, () => {
    facePlayer(simulation, observer.index);
    return simulation.enemies.perceptionState[observer.index] === PERCEPTION_STATE.engaged;
  }, 20);
  assert.equal(simulation.enemies.navigationEvidence[observer.index], NAVIGATION_EVIDENCE.directSight);
  assert.equal(simulation.enemies.knownTargetLayer[observer.index], 1);

  for (const [x, z] of [[11.5, 18.5], [11.5, 10.5], [15.5, 10.5]]) {
    putPlayerOnFloor(simulation, 1, x, z);
    runUntil(simulation, () => {
      facePlayer(simulation, observer.index);
      return simulation.enemies.lastSeenX[observer.index] === x
        && simulation.enemies.lastSeenZ[observer.index] === z;
    }, 20);
  }
  putPlayerOnElevator(simulation, 1, ELEVATOR_STOP.LOWER);
  runUntil(simulation, () => {
    facePlayer(simulation, observer.index);
    return simulation.enemies.observedConnectorRuntimeId[observer.index]
      === simulation.elevators.id[1];
  }, 20);
  putPlayerOnElevator(simulation, 1, ELEVATOR_STOP.UPPER);
  simulation.tick(null);
  assert.equal(simulation.enemies.navigationEvidence[observer.index], NAVIGATION_EVIDENCE.connectorTransition);
  assert.equal(simulation.enemies.knownTargetLayer[observer.index], 2);
  putPlayerOnFloor(simulation, 2, 2.5, 2.5);
  runUntil(simulation, () => (
    simulation.enemies.layerIndex[observer.index] === 2
    && simulation.enemies.routeLength[observer.index] === 0
  ));
  assert.equal(simulation.enemies.huntAnchorX[observer.index], 17.5);
  assert.equal(simulation.enemies.huntAnchorZ[observer.index], 10.5);
});

const SCHEMA_V15_NAVIGATION_GOLDEN = Object.freeze([
  [0, "reset"],
  [180, "target-layer-inference"],
  [180, "route-planned"],
  [250, "port-reached"],
  [250, "platform-wait"],
  [359, "board"],
  [376, "ride"],
  [538, "disembark"],
  [551, "port-reached"],
  [551, "route-complete"],
  [1254, "target-layer-inference"],
  [1254, "route-planned"],
  [1337, "port-reached"],
  [1337, "platform-wait"],
  [1433, "board"],
  [1448, "ride"],
  [1612, "disembark"],
  [1625, "port-reached"],
  [1625, "route-complete"],
]);

function runSchemaV15NavigationGolden() {
  const document = createNavigationDebugArenaScenario().toAuthoringJSON();
  document.playerStart = { layerId: document.layers[0].id, x: 6.5, z: 18.5 };
  const fireball = cloneFireballDefinition(DEFAULT_FIREBALL_DEFINITION);
  fireball.projectile.speed = 0.1;
  fireball.projectile.lifetime = 0.1;
  fireball.impact.blastRadius = 0;
  fireball.impact.pressureImpulse = 0;
  fireball.emission.burstCount = 0;
  const simulation = new Simulation({
    scenario: new ArenaScenario(document),
    seed: 0x1a2b_3c4d,
    particleBurstCount: 0,
    initialFireballDefinition: fireball,
  });
  let boardedSecondConnector = false;
  for (let tick = 0; tick < 1_750; tick += 1) {
    let move;
    if (tick < 180) move = null;
    else if (tick < 650) move = { x: 9.5, z: 18.5 };
    else if (tick < 800) move = { x: 11.5, z: 18.5 };
    else if (tick < 1_000) move = { x: 11.5, z: 10.5 };
    else if (simulation.player.layerIndex === 2) move = { x: 16.5, z: 6.5 };
    else {
      if (
        simulation.player.supportKind === SUPPORT_KIND.ELEVATOR
        && simulation.player.supportId === simulation.elevators.id[1]
      ) boardedSecondConnector = true;
      move = boardedSecondConnector ? null : { x: 17, z: 10.5 };
    }
    simulation.tick({ move });
  }
  return simulation;
}

test("current-schema golden replays two observed connectors and reacquisition twice exactly", () => {
  const simulation = runSchemaV15NavigationGolden();
  const recording = simulation.exportCommandLog();
  assert.equal(recording.schemaVersion, 18);
  const events = simulation.navigationRouteEvents();
  assert.deepEqual(
    events.recent.map((event) => [event.tick, event.type]),
    SCHEMA_V15_NAVIGATION_GOLDEN,
  );
  assert.equal(events.dropped, 0);
  const finalEnemy = simulation.snapshot().enemies[0];
  assert.equal(finalEnemy.layerIndex, 2);
  assert.equal(finalEnemy.perceptionState, "engaged");
  assert.equal(finalEnemy.navigationRoute.evidence, "direct-sight");
  for (let pass = 0; pass < 2; pass += 1) {
    const replay = Simulation.replay(recording);
    assert.deepEqual(replay.snapshot(), simulation.snapshot());
    assert.deepEqual(replay.navigationRouteEvents(), events);
  }
});
