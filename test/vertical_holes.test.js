import test from "node:test";
import assert from "node:assert/strict";

import {
  createLayer,
  paintSurface,
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
import { compileAuthoringMap } from "../src/authoring/map_compiler.js";
import {
  footprintCanFitSquareAperture,
  footprintFitsSquareAperture,
  sweptFootprintEntrySquareAperture,
} from "../src/sim/aperture_fit.js";
import { GridMap } from "../src/sim/grid_map.js";
import { ArenaScenario } from "../src/sim/scenario.js";
import { Simulation } from "../src/sim/simulation.js";
import {
  COMBAT,
  ENEMY_AI_PROFILE_NONE,
  ENEMY_AI_PROFILE_BASIC,
  ENEMY_AI_PROFILE_INVESTIGATIVE,
  ENEMY_WIZARD,
  GAMEPLAY_PROFILE_OBELISK_DUEL,
  GAMEPLAY_PROFILE_PRE_COMBAT,
} from "../src/config.js";
import { SUPPORT_KIND, VERTICAL_MODE } from "../src/sim/vertical_body.js";

function borderedMap() {
  const map = new GridMap(12, 12, undefined, { x: 5.5, z: 5.5 });
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

function holeDocument({ layers = 4 } = {}) {
  let document = new ArenaScenario(borderedMap()).toAuthoringJSON();
  const ids = [document.playerStart.layerId];
  for (let index = 1; index < layers; index += 1) {
    const created = createLayer(document, ids[ids.length - 1], "above", {
      name: `Deck ${index}`,
      baseY: index * 3,
    });
    document = created.document;
    ids.push(created.layerId);
  }
  // The lowest floor catches. Every higher floor owns an independent hole.
  for (let index = 1; index < ids.length; index += 1) {
    document = paintSurface(document, 5, 5, "surface.hole", ids[index]);
  }
  document.playerStart = { layerId: ids[ids.length - 1], x: 5.5, z: 5.5 };
  return { document: cloneAuthoringMap(document), ids };
}

function simulationFor(document) {
  return new Simulation({
    scenario: new ArenaScenario(document),
    gameplayProfile: GAMEPLAY_PROFILE_PRE_COMBAT,
    enemyAiProfile: ENEMY_AI_PROFILE_NONE,
    particleBurstCount: 0,
  });
}

test("catalog-backed hole paint round-trips and is one reversible authoring command", () => {
  const source = new ArenaScenario(borderedMap()).toAuthoringJSON();
  const command = commandFromAuthoringAction(source, {
    type: "paintSurface",
    cx: 5,
    cz: 5,
    definitionId: "surface.hole",
  });
  const painted = applyAuthoringCommand(source, command, "forward");
  const restored = applyAuthoringCommand(painted, command, "reverse");
  assert.deepEqual(restored, source);
  assert.equal(loadAuthoringMap(JSON.stringify(painted)).version, AUTHORING_MAP_VERSION);
  assert.equal(compileAuthoringMap(painted).layers[0].holes.length, 1);
});

test("M1B.1 v3 documents migrate to v4 unchanged when they contain no holes", () => {
  const source = new ArenaScenario(borderedMap()).toAuthoringJSON();
  const v3 = structuredClone(source);
  v3.version = 3;
  const migrated = loadAuthoringMap(v3);
  assert.equal(migrated.version, AUTHORING_MAP_VERSION);
  assert.equal(compileAuthoringMap(migrated).layers[0].holes.length, 0);
});

test("adjacent holes remain separate apertures and cannot share an elevator cell", () => {
  let { document, ids } = holeDocument({ layers: 2 });
  document = paintSurface(document, 6, 5, "surface.hole", ids[1]);
  const compiled = compileAuthoringMap(document);
  assert.deepEqual(
    compiled.layers[1].holes.map((hole) => [hole.cx, hole.cz]),
    [[5, 5], [6, 5]],
  );
  assert.throws(
    () => placeElevatorConnector(document, 5.5, 5.5, {
      lowerLayerId: ids[0],
      upperLayerId: ids[1],
    }),
    (error) => error.issues?.some((issue) => issue.code === "aperture-owner-conflict"),
  );
});

test("shared aperture fitting uses positive clearance, rotation, and swept entry", () => {
  const aperture = { x: 5.5, z: 5.5, width: 0.9 };
  assert.equal(footprintFitsSquareAperture({ type: "circle", x: 5.5, z: 5.5, radius: 0.3 }, aperture), true);
  assert.equal(footprintFitsSquareAperture({ type: "circle", x: 5.5, z: 5.5, radius: 0.45 }, aperture), false);
  assert.equal(footprintCanFitSquareAperture({ type: "rectangle", halfWidth: 1, halfDepth: 0.5, rotation: 1 }, aperture), false);
  const hit = sweptFootprintEntrySquareAperture(
    { type: "circle", radius: 0.3 }, 4.5, 5.5, 6.5, 5.5, aperture,
  );
  assert.ok(hit && hit.t > 0 && hit.t < 1);
});

test("centered fitting player falls through aligned floors and lands on the bottom", () => {
  const { document, ids } = holeDocument();
  const simulation = simulationFor(document);
  for (let tick = 0; tick < 240; tick += 1) simulation.tick(null);
  assert.equal(simulation.player.layerIndex, 0);
  assert.equal(simulation.player.worldY, 0);
  assert.equal(simulation.player.verticalMode, VERTICAL_MODE.SUPPORTED);
  assert.equal(simulation.player.supportKind, SUPPORT_KIND.FLOOR);
  assert.equal(simulation.snapshot().holeMetrics.floorPlanePassed, ids.length - 1);
});

test("walking at a hole captures the player instead of re-landing on the source floor", () => {
  const { document, ids } = holeDocument({ layers: 2 });
  document.playerStart = { layerId: ids[1], x: 4.5, z: 5.5 };
  const simulation = simulationFor(cloneAuthoringMap(document));
  let captured = false;
  let observedFalling = false;
  for (let tick = 0; tick < 90; tick += 1) {
    simulation.tick({ move: { x: 6.5, z: 5.5 } });
    captured ||= simulation.snapshot().holeMetrics.captured > 0;
    observedFalling ||= simulation.player.verticalMode === VERTICAL_MODE.FALLING;
    if (captured && observedFalling) break;
  }
  assert.equal(captured, true);
  assert.equal(observedFalling, true);
  assert.notEqual(simulation.player.worldY, 3);
});

test("falling player can steer onto an intermediate frame", () => {
  const { document } = holeDocument();
  const simulation = simulationFor(document);
  // Let capture happen, then steer far enough sideways before the 6m plane.
  for (let tick = 0; tick < 55; tick += 1) {
    simulation.tick({ move: { x: 8.5, z: 5.5 } });
  }
  assert.equal(simulation.player.verticalMode, VERTICAL_MODE.SUPPORTED);
  assert.equal(simulation.player.worldY, 6);
  assert.ok(simulation.player.x > 5.95);
});

test("oversized authored table bridges a floor hole rather than losing floor support", () => {
  let { document, ids } = holeDocument({ layers: 2 });
  // Replace the player start so the top layer can compile normally, then add
  // a table centered above its hole. Its 2x1 authored footprint cannot fit.
  document.playerStart = { layerId: ids[0], x: 2.5, z: 2.5 };
  const placed = placeInstance(document, "object.table", 5.5, 5.5, { layerId: ids[1] });
  const simulation = simulationFor(placed.document);
  const tableIndex = simulation.snapshot().rocks.find((rock) => rock.definitionId === "object.table")?.index;
  assert.notEqual(tableIndex, undefined);
  for (let tick = 0; tick < 10; tick += 1) simulation.tick(null);
  assert.equal(simulation.rocks.supportKind[tableIndex], SUPPORT_KIND.FLOOR);
  assert.equal(simulation.rocks.verticalMode[tableIndex], VERTICAL_MODE.SUPPORTED);
});

test("authoring commands preserve live player state until explicit restore", () => {
  const { document, ids } = holeDocument({ layers: 2 });
  document.playerStart = { layerId: ids[1], x: 4.5, z: 5.5 };
  const simulation = simulationFor(document);
  simulation.player.x = 7.25;
  simulation.player.z = 4.75;
  simulation.player.worldY = 2.1;
  simulation.player.verticalMode = VERTICAL_MODE.FALLING;
  const command = commandFromAuthoringAction(simulation.authoringDocument(), {
    type: "paintSurface",
    layerId: ids[0],
    cx: 3,
    cz: 3,
    definitionId: "surface.moss",
  });
  simulation.tick({ actions: [{ type: "applyAuthoringCommand", command, direction: "forward" }] });
  assert.equal(simulation.player.x, 7.25);
  assert.equal(simulation.player.z, 4.75);
  assert.equal(simulation.player.worldY < 2.1, true);
  assert.equal(simulation.player.verticalMode, VERTICAL_MODE.FALLING);
});

test("encounter obelisk is map-owned and spawns enemies on its own layer", () => {
  let { document, ids } = holeDocument({ layers: 2 });
  document.playerStart = { layerId: ids[0], x: 2.5, z: 2.5 };
  document = paintSurface(document, 5, 5, "surface.stone", ids[1]);
  // Obelisks deliberately occupy a solid structure cell.
  const upper = document.layers.find((layer) => layer.id === ids[1]);
  upper.structure.legend.push("structure.wall");
  upper.structure.cells[5 * upper.width + 5] = upper.structure.legend.length - 1;
  upper.markers.obelisk = { x: 5.5, z: 5.5 };
  const simulation = new Simulation({
    scenario: new ArenaScenario(document),
    gameplayProfile: GAMEPLAY_PROFILE_OBELISK_DUEL,
    enemyAiProfile: ENEMY_AI_PROFILE_BASIC,
    particleBurstCount: 0,
  });
  simulation.tick(null);
  assert.equal(simulation.enemies.activeCount, 1);
  assert.equal(simulation.enemies.layerIndex[0], 1);
  assert.equal(simulation.enemies.worldY[0], 3);
});

test("investigative wizards cannot see or react to a player on another floor", () => {
  const source = new ArenaScenario(borderedMap()).toAuthoringJSON();
  const upper = createLayer(source, source.playerStart.layerId, "above", {
    name: "Upper",
    baseY: 3,
  });
  const document = upper.document;
  document.playerStart = { layerId: upper.layerId, x: 5.5, z: 5.5 };
  const simulation = new Simulation({
    scenario: new ArenaScenario(document),
    gameplayProfile: GAMEPLAY_PROFILE_OBELISK_DUEL,
    enemyAiProfile: ENEMY_AI_PROFILE_INVESTIGATIVE,
    particleBurstCount: 0,
  });
  simulation.enemies.spawn({
    spawnSequence: 1,
    spawnTick: 0,
    x: 5.5,
    z: 5.5,
    radius: ENEMY_WIZARD.radius,
    massKg: ENEMY_WIZARD.massKg,
    maximumHealth: COMBAT.maximumHealth,
    shotReadyTick: 0xffff_ffff,
    facingX: 1,
    facingZ: 0,
    guardX: 5.5,
    guardZ: 5.5,
    guardBaseFacingX: 1,
    guardBaseFacingZ: 0,
    perceptionLane: 1,
    guardSweepPhase: 0,
    worldY: 0,
    layerIndex: 0,
  });
  for (let tick = 0; tick < 20; tick += 1) simulation.tick(null);
  assert.equal(simulation.enemies.currentVisibility[0], 0);
  assert.equal(simulation.enemies.lineOfSight[0], 0);
  assert.equal(simulation.enemies.desiredVx[0], 0);
  assert.equal(simulation.enemies.desiredVz[0], 0);
});
