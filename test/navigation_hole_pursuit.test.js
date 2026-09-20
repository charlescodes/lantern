import assert from "node:assert/strict";
import test from "node:test";

import { createLayer, paintSurface } from "../src/authoring/authoring_commands.js";
import {
  ACTOR_TEAM,
  COMBAT,
  ENEMY_AI_PROFILE_INVESTIGATIVE,
  ENEMY_WIZARD,
  GAMEPLAY_PROFILE_OBELISK_DUEL,
  NAVIGATION_EVIDENCE,
  NAVIGATION_ROUTE_PHASE,
  HOLE_PURSUIT_PROFILE_NONE,
  HOLE_PURSUIT_PROFILE_V1,
} from "../src/config.js";
import { GridMap } from "../src/sim/grid_map.js";
import { PERCEPTION_STATE, TARGET_KIND } from "../src/sim/perceptive_wizard.js";
import { ArenaScenario } from "../src/sim/scenario.js";
import { Simulation } from "../src/sim/simulation.js";
import { SUPPORT_KIND, VERTICAL_MODE } from "../src/sim/vertical_body.js";

function holePursuitScenario() {
  const map = new GridMap(12, 12, undefined, { x: 4.5, z: 5.5 });
  for (let cell = 0; cell < 12; cell += 1) {
    map.set(cell, 0, 1);
    map.set(cell, 11, 1);
    map.set(0, cell, 1);
    map.set(11, cell, 1);
  }
  let document = new ArenaScenario(map).toAuthoringJSON();
  const ground = document.playerStart.layerId;
  const upper = createLayer(document, ground, "above", { baseY: 3 });
  document = upper.document;
  document = paintSurface(document, 5, 5, "surface.hole", upper.layerId);
  document.playerStart = { layerId: upper.layerId, x: 4.5, z: 5.5 };
  return new ArenaScenario(document);
}

function createSimulation() {
  const simulation = new Simulation({
    scenario: holePursuitScenario(),
    gameplayProfile: GAMEPLAY_PROFILE_OBELISK_DUEL,
    enemyAiProfile: ENEMY_AI_PROFILE_INVESTIGATIVE,
    particleBurstCount: 0,
  });
  simulation.encounter.enabled = false;
  const enemyId = simulation.enemies.spawn({
    spawnSequence: 1,
    spawnTick: 0,
    x: 2.5,
    z: 5.5,
    radius: ENEMY_WIZARD.radius,
    massKg: ENEMY_WIZARD.massKg,
    maximumHealth: COMBAT.maximumHealth,
    shotReadyTick: 0xffff_ffff,
    facingX: 1,
    facingZ: 0,
    guardX: 2.5,
    guardZ: 5.5,
    worldY: simulation.layerBaseY[1],
    layerIndex: 1,
    perceptionLane: 1,
  });
  const index = simulation.enemies.findIndexById(enemyId);
  simulation.enemies.perceptionState[index] = PERCEPTION_STATE.engaged;
  simulation.enemies.confirmedTargetKind[index] = TARGET_KIND.player;
  simulation.enemies.confirmedTargetId[index] = simulation.player.id;
  simulation.enemies.confirmedTargetTeam[index] = ACTOR_TEAM.player;
  return { simulation, index };
}

function runUntil(simulation, predicate, maximumTicks = 1_200) {
  for (let tick = 0; tick < maximumTicks; tick += 1) {
    simulation.tick(null);
    if (predicate()) return;
  }
  assert.fail(`Condition did not become true within ${maximumTicks} ticks`);
}

test("a direct witness follows the player through a floor hole and searches the drop line", () => {
  const { simulation, index } = createSimulation();
  runUntil(simulation, () => simulation.enemies.currentVisibility[index] === 1, 20);

  runUntil(simulation, () => {
    simulation.tick({ move: { x: 6.5, z: 5.5 } });
    return simulation.enemies.topologyPhase[index] === NAVIGATION_ROUTE_PHASE.approachDrop;
  }, 90);
  assert.equal(simulation.enemies.navigationEvidence[index], NAVIGATION_EVIDENCE.holeTransition);
  assert.equal(simulation.enemies.observedHoleLayer[index], 1);
  assert.deepEqual(
    [simulation.enemies.observedHoleCellX[index], simulation.enemies.observedHoleCellZ[index]],
    [5, 5],
  );

  runUntil(simulation, () => simulation.enemies.topologyPhase[index] === NAVIGATION_ROUTE_PHASE.fallDrop);
  assert.equal(simulation.enemies.verticalMode[index], VERTICAL_MODE.FALLING);
  runUntil(simulation, () => (
    simulation.enemies.layerIndex[index] === 0
    && simulation.enemies.supportKind[index] === SUPPORT_KIND.FLOOR
    && simulation.enemies.topologyPhase[index] === NAVIGATION_ROUTE_PHASE.none
  ));
  assert.equal(simulation.enemies.navigationEvidence[index], NAVIGATION_EVIDENCE.holeTransition);
  assert.ok(simulation.navigationRouteEvents().recent.some((event) => event.type === "drop-landed"));
});

test("unseen player hole drops do not grant cross-floor pursuit evidence", () => {
  const { simulation, index } = createSimulation();
  simulation.enemies.facingX[index] = -1;
  simulation.enemies.currentVisibility[index] = 0;
  for (let tick = 0; tick < 90; tick += 1) {
    simulation.tick({ move: { x: 6.5, z: 5.5 } });
  }
  assert.notEqual(simulation.enemies.navigationEvidence[index], NAVIGATION_EVIDENCE.holeTransition);
  assert.equal(simulation.enemies.topologyPhase[index], NAVIGATION_ROUTE_PHASE.none);
});

test("schema-v18 records witnessed-hole pursuit while schema-v17 replays retain it disabled", () => {
  const { simulation } = createSimulation();
  const recording = simulation.exportCommandLog();
  assert.equal(recording.schemaVersion, 24);
  assert.equal(recording.configuration.holePursuitProfile, HOLE_PURSUIT_PROFILE_V1);
  assert.equal(Simulation.replay(recording).holePursuitProfile, HOLE_PURSUIT_PROFILE_V1);
  const legacy = structuredClone(recording);
  legacy.schemaVersion = 16;
  assert.equal(Simulation.replay(legacy).holePursuitProfile, HOLE_PURSUIT_PROFILE_NONE);
});
