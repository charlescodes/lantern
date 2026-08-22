import test from "node:test";
import assert from "node:assert/strict";

import {
  COMBAT,
  ENEMY_AI_PROFILE_NONE,
  ENEMY_WIZARD,
  GAMEPLAY_PROFILE_PRE_COMBAT,
  SIMULATION,
} from "../src/config.js";
import {
  createLayer,
  placeElevatorConnector,
  placeInstance,
} from "../src/authoring/authoring_commands.js";
import {
  applyAuthoringCommand,
  commandFromAuthoringAction,
} from "../src/authoring/authoring_history.js";
import {
  AUTHORING_MAP_VERSION,
  cloneAuthoringMap,
  loadAuthoringMap,
} from "../src/authoring/authoring_map.js";
import { pickAuthoringTarget } from "../src/authoring/editor_interaction.js";
import {
  footprintFitsSquareAperture,
  projectedFootprintHalfExtents,
} from "../src/sim/aperture_fit.js";
import { ElevatorPool, ELEVATOR_MOTION, ELEVATOR_STOP } from "../src/sim/elevator_pool.js";
import { GridMap } from "../src/sim/grid_map.js";
import { ArenaScenario } from "../src/sim/scenario.js";
import { Simulation } from "../src/sim/simulation.js";
import {
  DEFAULT_ACTOR_VERTICAL_CAPABILITIES,
  SUPPORT_KIND,
  VERTICAL_MODE,
} from "../src/sim/vertical_body.js";
import { mergeCatalogPropLights } from "../src/presentation/catalog_lights.js";

function borderedMap(spawn = { x: 4, z: 4.5 }) {
  const map = new GridMap(10, 10, undefined, spawn);
  for (let x = 0; x < map.width; x += 1) {
    map.set(x, 0, 1);
    map.set(x, map.height - 1, 1);
  }
  for (let z = 0; z < map.height; z += 1) {
    map.set(0, z, 1);
    map.set(map.width - 1, z, 1);
  }
  return map;
}

function elevatorDocument(options = {}) {
  const scenario = new ArenaScenario(borderedMap(options.spawn));
  let document = scenario.toAuthoringJSON();
  const lowerLayerId = document.playerStart.layerId;
  const created = createLayer(document, lowerLayerId, "above", {
    name: "Upper",
    baseY: options.upperY ?? 3,
  });
  document = created.document;
  document.playerStart.x = options.spawn?.x ?? 4;
  document.playerStart.z = options.spawn?.z ?? 4.5;
  document = cloneAuthoringMap(document);
  const connector = placeElevatorConnector(document, 4, 4.5, {
    lowerLayerId,
    upperLayerId: created.layerId,
    platformWidth: options.platformWidth ?? 0.9,
    apertureWidth: options.apertureWidth ?? 0.9,
    travelSpeed: options.travelSpeed ?? 3,
    dwellSeconds: options.dwellSeconds ?? 0,
    initialStop: options.initialStop ?? "lower",
    activationPolicy: options.activationPolicy ?? "manual",
  });
  return {
    document: connector.document,
    lowerLayerId,
    upperLayerId: created.layerId,
    connectorId: connector.connectorId,
  };
}

function simulationFor(document) {
  return new Simulation({
    scenario: new ArenaScenario(document),
    gameplayProfile: GAMEPLAY_PROFILE_PRE_COMBAT,
    enemyAiProfile: ENEMY_AI_PROFILE_NONE,
    particleBurstCount: 0,
  });
}

function runToStop(simulation, connectorId, stop, maximumTicks = 360) {
  simulation.tick({ type: "summonElevator", connectorId, stop });
  for (let tick = 0; tick < maximumTicks; tick += 1) {
    const elevator = simulation.snapshot().elevators[0];
    if (elevator.currentStop === stop && elevator.motionState === "dwelling") return elevator;
    simulation.tick(null);
  }
  assert.fail(`Elevator did not reach ${stop}`);
}

test("authoring-map v2 migrates without connectors and elevator connector history round-trips exactly", () => {
  const source = elevatorDocument({ spawn: { x: 2.5, z: 2.5 } });
  const v2 = structuredClone(source.document);
  v2.version = 2;
  delete v2.nextConnectorOrdinal;
  delete v2.connectors;
  const migrated = loadAuthoringMap(v2);
  assert.equal(migrated.version, AUTHORING_MAP_VERSION);
  assert.deepEqual(migrated.connectors, []);
  assert.equal(migrated.nextConnectorOrdinal, 1);
  assert.throws(
    () => loadAuthoringMap({ ...v2, connectors: [] }),
    (error) => error.issues?.some((issue) => issue.code === "unknown-field"),
  );

  const withoutConnector = structuredClone(source.document);
  withoutConnector.connectors = [];
  withoutConnector.nextConnectorOrdinal = 1;
  const baseline = cloneAuthoringMap(withoutConnector);
  const command = commandFromAuthoringAction(baseline, {
    type: "placeConnector",
    lowerLayerId: source.lowerLayerId,
    upperLayerId: source.upperLayerId,
    x: 4,
    z: 4.5,
    travelSpeed: 2,
  });
  const applied = applyAuthoringCommand(baseline, command, "forward");
  const connectorId = applied.connectors[0].id;
  assert.deepEqual(loadAuthoringMap(JSON.stringify(applied)), applied);
  assert.deepEqual(applyAuthoringCommand(applied, command, "reverse"), baseline);
  assert.equal(applyAuthoringCommand(baseline, command, "forward").connectors[0].id, connectorId);
});

test("malformed elevator connectors produce structured validation diagnostics", () => {
  const source = elevatorDocument();
  const malformed = structuredClone(source.document);
  malformed.connectors.push({
    ...malformed.connectors[0],
    upperLayerId: "missing-floor",
    platformWidth: 1.25,
    travelSpeed: 0,
  });
  assert.throws(
    () => loadAuthoringMap(malformed),
    (error) => {
      const codes = new Set(error.issues?.map((issue) => issue.code));
      return codes.has("duplicate-connector-id")
        && codes.has("missing-connector-layer")
        && codes.has("connector-cell-fit")
        && codes.has("connector-travel-speed");
    },
  );
  assert.throws(
    () => placeElevatorConnector(source.document, 4, 4.5, {
      lowerLayerId: source.lowerLayerId,
      upperLayerId: source.upperLayerId,
      activationPolicy: "not-a-policy",
    }),
    (error) => error.issues?.some((issue) => issue.code === "connector-activation-policy"),
  );
});

test("connector endpoint picking is stable on both linked authoring layers", () => {
  const source = elevatorDocument();
  const simulation = simulationFor(source.document);
  for (const layerId of [source.lowerLayerId, source.upperLayerId]) {
    simulation.activateRuntimeLayer(layerId);
    const snapshot = simulation.authoringSnapshot();
    const target = pickAuthoringTarget(snapshot, 4, 4.5);
    assert.deepEqual(target, { kind: "connector", layerId, connectorId: source.connectorId });
  }
});

test("pure aperture containment rotates rectangles and requires positive circle clearance", () => {
  assert.deepEqual(projectedFootprintHalfExtents({
    type: "rectangle",
    halfWidth: 0.8,
    halfDepth: 0.25,
    rotation: 0,
  }), { halfX: 0.8, halfZ: 0.25 });
  assert.deepEqual(projectedFootprintHalfExtents({
    type: "rectangle",
    halfWidth: 0.8,
    halfDepth: 0.25,
    rotation: 1,
  }), { halfX: 0.25, halfZ: 0.8 });
  assert.equal(footprintFitsSquareAperture(
    { type: "circle", x: 4, z: 4.5, radius: 0.45 },
    { x: 4, z: 4.5, width: 0.9 },
  ), false);
  assert.equal(footprintFitsSquareAperture(
    { type: "circle", x: 4, z: 4.5, radius: 0.18 },
    { x: 4, z: 4.5, width: 0.9 },
  ), true);
});

test("bounded fixed-step elevator travel reaches both stops without drift", () => {
  const pool = new ElevatorPool(1);
  pool.spawn({
    id: 1,
    authoringId: "lift",
    lowerLayerIndex: 0,
    upperLayerIndex: 1,
    x: 2,
    z: 2,
    platformWidth: 0.9,
    apertureWidth: 0.9,
    lowerY: -2,
    upperY: 3,
    travelSpeed: 1.3,
    dwellTicks: 0,
    initialStop: "lower",
    activationPolicy: 0,
  });
  for (let cycle = 0; cycle < 8; cycle += 1) {
    const target = cycle % 2 === 0 ? ELEVATOR_STOP.UPPER : ELEVATOR_STOP.LOWER;
    pool.request(0, target);
    for (let tick = 0; tick < 600 && pool.currentStop[0] !== target; tick += 1) {
      pool.step(SIMULATION.dt);
    }
    assert.equal(pool.motion[0], ELEVATOR_MOTION.DWELLING);
    assert.equal(pool.worldY[0], target === ELEVATOR_STOP.UPPER ? 3 : -2);
  }
});

test("player, enemy, and fitting clutter can share a ride without centering or controller lock", () => {
  let source = elevatorDocument({ spawn: { x: 3.7, z: 4.5 } });
  const rock = placeInstance(source.document, "object.rock.small", 4, 4.1, {
    layerId: source.lowerLayerId,
  });
  source = { ...source, document: rock.document };
  const simulation = simulationFor(source.document);
  const enemyId = simulation.enemies.spawn({
    spawnSequence: 77,
    spawnTick: 0,
    x: 4.3,
    z: 4.5,
    radius: ENEMY_WIZARD.radius,
    massKg: ENEMY_WIZARD.massKg,
    maximumHealth: COMBAT.maximumHealth,
    shotReadyTick: 0xffff_ffff,
    worldY: 0,
    layerIndex: 0,
    verticalCapabilities: DEFAULT_ACTOR_VERTICAL_CAPABILITIES,
  });
  const enemyIndex = simulation.enemies.findIndexById(enemyId);
  simulation.enemies.castSequence[enemyIndex] = 9;
  simulation.tick({ type: "cycleElevator", connectorId: source.connectorId });
  assert.equal(simulation.player.supportKind, SUPPORT_KIND.ELEVATOR);
  assert.ok(Math.abs(simulation.player.x - 3.7) < 0.02, "support must not recenter the player");
  assert.equal(simulation.enemies.supportKind[enemyIndex], SUPPORT_KIND.ELEVATOR);
  assert.equal(simulation.rocks.supportKind[0], SUPPORT_KIND.ELEVATOR);
  const beforeZ = simulation.player.z;
  for (let tick = 0; tick < 4; tick += 1) {
    simulation.tick({ move: { x: 3.7, z: 4.72 } });
  }
  assert.ok(simulation.player.z > beforeZ, "horizontal controller remains active during the ride");
  assert.ok(simulation.snapshot().elevators[0].currentY > 0);
  assert.ok(simulation.snapshot().elevators[0].supportedBodyCount >= 2);
});

test("an enemy preserves stable physical and AI identity through a fitting ride", () => {
  const source = elevatorDocument({ spawn: { x: 2.5, z: 2.5 } });
  const simulation = simulationFor(source.document);
  const enemyId = simulation.enemies.spawn({
    spawnSequence: 77,
    spawnTick: 0,
    x: 4,
    z: 4.5,
    radius: ENEMY_WIZARD.radius,
    massKg: ENEMY_WIZARD.massKg,
    maximumHealth: COMBAT.maximumHealth,
    shotReadyTick: 0xffff_ffff,
    worldY: 0,
    layerIndex: 0,
    verticalCapabilities: DEFAULT_ACTOR_VERTICAL_CAPABILITIES,
  });
  const enemyIndex = simulation.enemies.findIndexById(enemyId);
  simulation.enemies.castSequence[enemyIndex] = 9;
  simulation.player.layerIndex = 1;
  simulation.player.worldY = 3;
  simulation.player.previousWorldY = 3;
  runToStop(simulation, source.connectorId, "upper");
  const afterEnemyIndex = simulation.enemies.findIndexById(enemyId);
  assert.ok(afterEnemyIndex >= 0);
  assert.equal(simulation.enemies.spawnSequence[afterEnemyIndex], 77);
  assert.equal(simulation.enemies.castSequence[afterEnemyIndex], 9);
  assert.equal(simulation.snapshot().enemies[afterEnemyIndex].layerId, source.upperLayerId);
});

test("walking off a moving elevator detaches the player and begins a real fall", () => {
  const source = elevatorDocument({ travelSpeed: 1, spawn: { x: 4, z: 4.5 } });
  const simulation = simulationFor(source.document);
  simulation.tick({ type: "cycleElevator", connectorId: source.connectorId });
  for (let tick = 0; tick < 70; tick += 1) simulation.tick(null);
  assert.ok(simulation.player.worldY > 1);
  let observedFalling = false;
  for (let tick = 0; tick < 30; tick += 1) {
    simulation.tick({ move: { x: 7.5, z: 4.5 } });
    observedFalling ||= simulation.player.verticalMode === VERTICAL_MODE.FALLING;
    if (observedFalling) break;
  }
  assert.equal(observedFalling, true);
  assert.notEqual(simulation.player.supportKind, SUPPORT_KIND.ELEVATOR);
});

test("fitting torch transfers once and its one presentation light follows live Y", () => {
  let source = elevatorDocument({ spawn: { x: 2.5, z: 2.5 } });
  const placed = placeInstance(source.document, "object.torch", 4, 4.5, {
    layerId: source.lowerLayerId,
  });
  source = { ...source, document: placed.document };
  const simulation = simulationFor(source.document);
  simulation.tick({ type: "cycleElevator", connectorId: source.connectorId });
  for (let tick = 0; tick < 20; tick += 1) simulation.tick(null);
  let snapshot = simulation.snapshot();
  const movingTorch = snapshot.rocks.find((body) => body.authoringId === placed.instanceId);
  assert.ok(movingTorch.worldY > 0 && movingTorch.worldY < 3);
  let lights = mergeCatalogPropLights([], [movingTorch], 16, 0);
  assert.equal(lights.length, 1);
  assert.ok(Math.abs(lights[0].y - (movingTorch.worldY + 1.82)) < 1e-5);
  runToStop(simulation, source.connectorId, "upper");
  snapshot = simulation.snapshot();
  const arrivedTorch = snapshot.rocks.find((body) => body.authoringId === placed.instanceId);
  assert.equal(arrivedTorch.layerId, source.upperLayerId);
  lights = mergeCatalogPropLights([], [arrivedTorch], 16, 3);
  assert.equal(lights.length, 1);
  assert.equal(lights[0].key, `prop:${placed.instanceId}:light`);
  assert.ok(Math.abs(lights[0].y - 1.82) < 1e-5);
});

test("overhanging tables and nominally aperture-sized boulders are lifted then rejected without stalling", () => {
  for (const [definitionId, authoredX] of [
    ["object.table", 3.5],
    ["object.rock.large", 4],
  ]) {
    let source = elevatorDocument({ spawn: { x: 2.5, z: 2.5 } });
    const placed = placeInstance(source.document, definitionId, authoredX, 4.5, {
      layerId: source.lowerLayerId,
    });
    source = { ...source, document: placed.document };
    const simulation = simulationFor(source.document);
    simulation.tick({ type: "cycleElevator", connectorId: source.connectorId });
    assert.equal(simulation.rocks.supportKind[0], SUPPORT_KIND.ELEVATOR);
    for (let tick = 0; tick < 20; tick += 1) simulation.tick(null);
    assert.ok(simulation.rocks.worldY[0] > 0, `${definitionId} should initially be lifted by center support`);
    const elevator = runToStop(simulation, source.connectorId, "upper");
    const body = simulation.snapshot().rocks[0];
    assert.equal(body.layerId, source.lowerLayerId);
    assert.equal(body.latestApertureFit, false);
    assert.equal(elevator.currentStop, "upper");
    assert.equal(elevator.rejectedLoadCount, 1);
    assert.ok(Math.hypot(body.x - 4, body.z - 4.5) > 0.45);
  }
});

test("an oversized upper-floor load stays on its floor while the unstoppable platform descends", () => {
  let source = elevatorDocument({
    spawn: { x: 2.5, z: 2.5 },
    initialStop: "upper",
  });
  const table = placeInstance(source.document, "object.table", 3.5, 4.5, {
    layerId: source.upperLayerId,
  });
  source = { ...source, document: table.document };
  const simulation = simulationFor(source.document);
  simulation.tick({ type: "cycleElevator", connectorId: source.connectorId });
  for (let tick = 0; tick < 20; tick += 1) simulation.tick(null);
  const body = simulation.snapshot().rocks[0];
  const elevator = simulation.snapshot().elevators[0];
  assert.equal(body.layerId, source.upperLayerId);
  assert.equal(body.supportKind, "floor");
  assert.equal(body.worldY, 3);
  assert.ok(elevator.currentY < 3);
  assert.equal(elevator.motionState, "descending");
});

test("floor landing re-enables low-clutter collision and reset restores authored starts", () => {
  let source = elevatorDocument({ spawn: { x: 2.5, z: 2.5 } });
  source.document.connectors = [];
  source.document.nextConnectorOrdinal = 1;
  const boulder = placeInstance(cloneAuthoringMap(source.document), "object.rock.large", 4.65, 4.5, {
    layerId: source.lowerLayerId,
  });
  const simulation = simulationFor(boulder.document);
  simulation.player.x = 4;
  simulation.player.z = 4.5;
  simulation.player.worldY = 2;
  simulation.player.previousWorldY = 2;
  simulation.player.verticalVelocityY = -1;
  simulation.player.verticalMode = VERTICAL_MODE.FALLING;
  simulation.player.supportKind = SUPPORT_KIND.NONE;
  simulation.player.layerIndex = 1;
  for (let tick = 0; tick < 120 && simulation.player.supportKind !== SUPPORT_KIND.FLOOR; tick += 1) {
    simulation.tick(null);
  }
  assert.equal(simulation.player.supportKind, SUPPORT_KIND.FLOOR);
  assert.equal(simulation.snapshot().player.layerId, source.lowerLayerId);
  assert.ok(
    Math.hypot(simulation.player.x - simulation.rocks.x[0], simulation.player.z - simulation.rocks.z[0])
      >= simulation.player.radius + simulation.rocks.radius[0] - 0.02,
  );
  simulation.tick({ type: "restoreScenario" });
  assert.equal(simulation.player.worldY, 0);
  assert.deepEqual(
    [simulation.rocks.x[0], simulation.rocks.z[0]],
    [simulation.rocks.previousX[0], simulation.rocks.previousZ[0]],
  );
});

test("the same elevator command stream is deterministic", () => {
  const source = elevatorDocument({ spawn: { x: 3.8, z: 4.5 }, travelSpeed: 1.7 });
  const run = () => {
    const simulation = simulationFor(source.document);
    for (let tick = 0; tick < 160; tick += 1) {
      simulation.tick(tick === 0
        ? { type: "cycleElevator", connectorId: source.connectorId }
        : tick > 30 && tick < 36
          ? { move: { x: 3.9, z: 4.7 } }
          : null);
    }
    const snapshot = simulation.snapshot();
    return {
      player: snapshot.player,
      elevators: snapshot.elevators,
      rocks: snapshot.rocks,
      runtimeLayerId: snapshot.runtimeLayerId,
    };
  };
  assert.deepEqual(run(), run());
});
