import assert from "node:assert/strict";
import test from "node:test";

import {
  createLayer,
  placeElevatorConnector,
  placeInstance,
  placeNavigationLink,
  placeNavigationNode,
} from "../src/authoring/authoring_commands.js";
import {
  AUTHORING_MAP_VERSION,
  loadAuthoringMap,
  NAVIGATION_AUTHORING_MAP_VERSION,
} from "../src/authoring/authoring_map.js";
import {
  COMBAT,
  ENEMY_ARCHETYPE,
  ENEMY_HOME_PROFILE_NONE,
  ENEMY_HOME_PROFILE_V1,
  ENEMY_WIZARD,
  OBELISK_ENCOUNTER_PROFILE_NONE,
  OBELISK_ENCOUNTER_PROFILE_V1,
  SCHEMA_VERSION,
} from "../src/config.js";
import { PERCEPTION_STATE } from "../src/sim/perceptive_wizard.js";
import { GridMap } from "../src/sim/grid_map.js";
import { ArenaScenario, createDebugArenaScenario } from "../src/sim/scenario.js";
import { Simulation } from "../src/sim/simulation.js";

function borderedMap(width = 18, height = 14) {
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

function addObelisk(document, layerId, x, z, properties) {
  return placeInstance(document, "object.obelisk", x, z, {
    layerId,
    properties,
  });
}

function runUntil(simulation, predicate, maximumTicks = 4_000) {
  for (let tick = 0; tick < maximumTicks; tick += 1) {
    simulation.tick(null);
    if (predicate()) return tick + 1;
  }
  assert.fail(`Condition did not become true within ${maximumTicks} ticks`);
}

test("authoring-map v6 migrates its marker to one editable v7 obelisk instance", () => {
  const current = createDebugArenaScenario().toAuthoringJSON();
  const layer = current.layers[0];
  const index = layer.instances.findIndex(
    (instance) => instance.definitionId === "object.obelisk",
  );
  const [obelisk] = layer.instances.splice(index, 1);
  layer.markers = { obelisk: { x: obelisk.x, z: obelisk.z } };
  const wallCode = layer.structure.legend.indexOf("structure.wall");
  layer.structure.cells[Math.floor(obelisk.z) * layer.width + Math.floor(obelisk.x)] = wallCode;
  layer.nextInstanceOrdinal -= 1;
  current.version = NAVIGATION_AUTHORING_MAP_VERSION;

  const migrated = loadAuthoringMap(current);
  const instances = migrated.layers[0].instances.filter(
    (instance) => instance.definitionId === "object.obelisk",
  );
  assert.equal(migrated.version, AUTHORING_MAP_VERSION);
  assert.deepEqual(migrated.layers[0].markers, {});
  assert.equal(instances.length, 1);
  assert.deepEqual(instances[0].properties, {
    enemyArchetype: "wizard",
    maximumAlive: 4,
    spawnIntervalTicks: ENEMY_WIZARD.spawnIntervalTicks,
  });
  assert.equal(
    migrated.layers[0].structure.cells[
      Math.floor(obelisk.z) * migrated.layers[0].width + Math.floor(obelisk.x)
    ],
    0,
  );
});

test("multiple authored obelisks spawn independently with local archetypes and living caps", () => {
  let document = new ArenaScenario(borderedMap()).toAuthoringJSON();
  const layerId = document.playerStart.layerId;
  const wizard = addObelisk(document, layerId, 6.5, 7.5, {
    enemyArchetype: "wizard",
    maximumAlive: 1,
    spawnIntervalTicks: 1,
  });
  document = wizard.document;
  const urchin = addObelisk(document, layerId, 13.5, 7.5, {
    enemyArchetype: "urchin",
    maximumAlive: 2,
    spawnIntervalTicks: 1,
  });
  document = urchin.document;
  const simulation = new Simulation({
    scenario: new ArenaScenario(document),
    particleBurstCount: 0,
  });
  assert.ok(simulation.listPlaceableDefinitions().some(
    (definition) => definition.id === "object.obelisk"
      && definition.placementTarget === "instance",
  ));

  simulation.tick(null);
  simulation.tick(null);
  const snapshot = simulation.snapshot();
  assert.equal(snapshot.enemies.length, 3);
  assert.deepEqual(
    snapshot.enemies.map((enemy) => enemy.archetype).sort(),
    ["urchin", "urchin", "wizard"],
  );
  assert.deepEqual(
    snapshot.encounter.obelisks.map((state) => [state.maximumAlive, state.alive]),
    [[1, 1], [2, 2]],
  );
  assert.ok(snapshot.enemies.every((enemy) => enemy.home.obeliskSpawnId !== null));

  const wizardSpawnId = snapshot.encounter.obelisks[0].spawnId;
  const firstWizardId = snapshot.enemies.find(
    (enemy) => enemy.home.obeliskSpawnId === wizardSpawnId,
  ).id;
  simulation.enemies.removeSwap(simulation.enemies.findIndexById(firstWizardId));
  simulation.tick(null);
  const afterReplacement = simulation.snapshot();
  const replacementWizard = afterReplacement.enemies.find(
    (enemy) => enemy.home.obeliskSpawnId === wizardSpawnId,
  );
  assert.ok(replacementWizard);
  assert.notEqual(replacementWizard.id, firstWizardId);
  assert.equal(afterReplacement.encounter.obelisks[0].successfulSpawns, 2);

  simulation.tick({
    actions: [{ type: "removeInstance", authoringId: wizard.instanceId }],
  });
  const afterRemoval = simulation.snapshot();
  assert.equal(afterRemoval.encounter.obelisks.length, 1);
  assert.ok(afterRemoval.enemies.some((enemy) => enemy.id === replacementWizard.id));

  const urchinEnemy = afterRemoval.enemies.find((enemy) => enemy.archetype === "urchin");
  const capturedHome = structuredClone(urchinEnemy.home);
  simulation.tick({
    actions: [{
      type: "updateInstanceTransform",
      authoringId: urchin.instanceId,
      x: 14.5,
      z: 3.5,
      rotation: 0,
    }],
  });
  const afterMove = simulation.snapshot();
  assert.deepEqual(
    afterMove.enemies.find((enemy) => enemy.id === urchinEnemy.id).home,
    capturedHome,
  );
  assert.deepEqual(afterMove.encounter.obelisks[0].position, { x: 14.5, z: 3.5 });
});

test("placing the first obelisk in a running map activates its encounter", () => {
  const simulation = new Simulation({
    scenario: new ArenaScenario(borderedMap()),
    particleBurstCount: 0,
  });
  assert.equal(simulation.snapshot().encounter.enabled, false);

  simulation.tick({
    actions: [{
      type: "placeInstance",
      definitionId: "object.obelisk",
      x: 8.5,
      z: 7.5,
      properties: {
        enemyArchetype: "wizard",
        maximumAlive: 1,
        spawnIntervalTicks: 1,
      },
    }],
  });
  assert.equal(simulation.snapshot().encounter.enabled, true);
  simulation.tick(null);
  assert.equal(simulation.snapshot().enemies.length, 1);
});

test("runtime obelisk presentation stays on the viewed floor when the editor changes layers", () => {
  let document = new ArenaScenario(borderedMap()).toAuthoringJSON();
  const lowerLayerId = document.playerStart.layerId;
  const upper = createLayer(document, lowerLayerId, "above", { baseY: 3 });
  document = upper.document;
  document = addObelisk(document, lowerLayerId, 6.5, 7.5, {
    enemyArchetype: "wizard",
    maximumAlive: 1,
    spawnIntervalTicks: 60,
  }).document;
  document = addObelisk(document, upper.layerId, 12.5, 7.5, {
    enemyArchetype: "urchin",
    maximumAlive: 1,
    spawnIntervalTicks: 60,
  }).document;
  const simulation = new Simulation({ scenario: new ArenaScenario(document), particleBurstCount: 0 });

  simulation.tick({ actions: [{ type: "activateLayer", layerId: upper.layerId }] });
  assert.deepEqual(simulation.snapshot().obelisks.map((item) => item.layerId), [lowerLayerId]);
  assert.equal(simulation.activateRuntimeLayer(upper.layerId), true);
  assert.deepEqual(simulation.snapshot().obelisks.map((item) => item.layerId), [upper.layerId]);
});

function homeRouteScenario() {
  let document = new ArenaScenario(borderedMap(14, 14)).toAuthoringJSON();
  const lowerLayerId = document.playerStart.layerId;
  const upper = createLayer(document, lowerLayerId, "above", { baseY: 3 });
  document = upper.document;
  const connector = placeElevatorConnector(document, 7, 7, {
    lowerLayerId,
    upperLayerId: upper.layerId,
    initialStop: "lower",
    travelDurationSeconds: 1,
    dwellSeconds: 1,
  });
  document = connector.document;
  const lowerHome = placeNavigationNode(document, 3, 7, { layerId: lowerLayerId });
  document = lowerHome.document;
  const lowerStage = placeNavigationNode(document, 6, 7, { layerId: lowerLayerId });
  document = lowerStage.document;
  const upperStage = placeNavigationNode(document, 8, 7, { layerId: upper.layerId });
  document = upperStage.document;
  const upperSource = placeNavigationNode(document, 11, 7, { layerId: upper.layerId });
  document = upperSource.document;
  for (const [a, b] of [
    [{ kind: "node", nodeId: lowerHome.nodeId }, { kind: "node", nodeId: lowerStage.nodeId }],
    [{ kind: "node", nodeId: lowerStage.nodeId }, {
      kind: "connector-endpoint", connectorId: connector.connectorId, stop: "lower",
    }],
    [{ kind: "connector-endpoint", connectorId: connector.connectorId, stop: "upper" }, {
      kind: "node", nodeId: upperStage.nodeId,
    }],
    [{ kind: "node", nodeId: upperStage.nodeId }, { kind: "node", nodeId: upperSource.nodeId }],
  ]) document = placeNavigationLink(document, a, b).document;
  const home = addObelisk(document, lowerLayerId, 12.5, 11.5, {
    enemyArchetype: "wizard",
    maximumAlive: 1,
    spawnIntervalTicks: 1_800,
  });
  return {
    scenario: new ArenaScenario(home.document),
    lowerLayerId,
    upperLayerId: upper.layerId,
    homeAuthoringId: home.instanceId,
  };
}

test("a returning enemy routes through an elevator to its captured home layer and point", () => {
  const fixture = homeRouteScenario();
  const simulation = new Simulation({ scenario: fixture.scenario, particleBurstCount: 0 });
  simulation.encounter.enabled = false;
  for (const state of simulation.obeliskEncounters) state.enabled = false;
  const lowerIndex = simulation.layerIdToIndex.get(fixture.lowerLayerId);
  const upperIndex = simulation.layerIdToIndex.get(fixture.upperLayerId);
  const home = simulation.scenario.allRuntimeEntities().find(
    (entity) => entity.authoringId === fixture.homeAuthoringId,
  );
  const enemyId = simulation.enemies.spawn({
    spawnSequence: 1,
    spawnTick: simulation.tickCount,
    archetype: ENEMY_ARCHETYPE.wizard,
    x: 11.5,
    z: 7.5,
    radius: ENEMY_WIZARD.radius,
    massKg: ENEMY_WIZARD.massKg,
    maximumHealth: COMBAT.maximumHealth,
    shotReadyTick: 0xffff_ffff,
    guardX: 11.5,
    guardZ: 11.5,
    guardLayerIndex: lowerIndex,
    homeObeliskSpawnId: home.spawnId,
    worldY: simulation.layerBaseY[upperIndex],
    layerIndex: upperIndex,
  });
  const enemyIndex = simulation.enemies.findIndexById(enemyId);
  simulation.enemies.perceptionState[enemyIndex] = PERCEPTION_STATE.returning;

  runUntil(simulation, () => (
    simulation.enemies.layerIndex[enemyIndex] === lowerIndex
    && simulation.enemies.perceptionState[enemyIndex] === PERCEPTION_STATE.unaware
  ));
  const enemy = simulation.snapshot().enemies.find((item) => item.id === enemyId);
  assert.equal(enemy.home.layerId, fixture.lowerLayerId);
  assert.equal(enemy.home.obeliskSpawnId, home.spawnId);
  assert.ok(Math.hypot(enemy.x - 11.5, enemy.z - 11.5) <= 0.55);
  assert.ok(simulation.navigationRouteEvents().recent.some(
    (event) => event.type === "route-planned" && event.intent === "return-home",
  ));
  assert.ok(simulation.navigationRouteEvents().recent.some((event) => event.type === "ride"));
});

test("schema v20 records both profiles while v19 and v18 select their frozen boundaries", () => {
  const simulation = new Simulation({ particleBurstCount: 0 });
  const current = simulation.exportCommandLog();
  assert.equal(current.schemaVersion, SCHEMA_VERSION);
  assert.equal(current.configuration.enemyHomeProfile, ENEMY_HOME_PROFILE_V1);
  assert.equal(
    current.configuration.obeliskEncounterProfile,
    OBELISK_ENCOUNTER_PROFILE_V1,
  );

  const v19 = structuredClone(current);
  v19.schemaVersion = 19;
  delete v19.configuration.obeliskEncounterProfile;
  const replay19 = Simulation.replay(v19);
  assert.equal(replay19.enemyHomeProfile, ENEMY_HOME_PROFILE_V1);
  assert.equal(replay19.obeliskEncounterProfile, OBELISK_ENCOUNTER_PROFILE_NONE);

  const v18 = structuredClone(v19);
  v18.schemaVersion = 18;
  delete v18.configuration.enemyHomeProfile;
  const replay18 = Simulation.replay(v18);
  assert.equal(replay18.enemyHomeProfile, ENEMY_HOME_PROFILE_NONE);
  assert.equal(replay18.obeliskEncounterProfile, OBELISK_ENCOUNTER_PROFILE_NONE);
});
