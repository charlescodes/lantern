import test from "node:test";
import assert from "node:assert/strict";

import { createLayer, paintSurface, placeInstance } from "../src/authoring/authoring_commands.js";
import { ArenaScenario } from "../src/sim/scenario.js";
import { GridMap } from "../src/sim/grid_map.js";
import { Simulation } from "../src/sim/simulation.js";
import {
  BREAKAWAY_FLOOR_PROFILE_NONE,
  ENEMY_AI_PROFILE_NONE,
  GAMEPLAY_PROFILE_PRE_COMBAT,
  VERTICAL_PHYSICS,
} from "../src/config.js";
import { SUPPORT_KIND, VERTICAL_MODE } from "../src/sim/vertical_body.js";

function documentWithBreakaway() {
  let document = new ArenaScenario(
    new GridMap(12, 12, undefined, { x: 5.5, z: 5.5 }),
  ).toAuthoringJSON();
  const upper = createLayer(document, "ground", "above", { name: "Upper", baseY: 3 });
  document = paintSurface(upper.document, 5, 5, "surface.breakaway", upper.layerId);
  document.playerStart = { layerId: upper.layerId, x: 5.5, z: 5.5 };
  return { document, upperId: upper.layerId };
}

function simulation(document, options = {}) {
  return new Simulation({
    scenario: new ArenaScenario(document),
    gameplayProfile: GAMEPLAY_PROFILE_PRE_COMBAT,
    enemyAiProfile: ENEMY_AI_PROFILE_NONE,
    particleBurstCount: 0,
    ...options,
  });
}

test("an eligible supported body latches an 18-tick breakaway countdown then falls through its aperture", () => {
  const source = documentWithBreakaway();
  const value = simulation(source.document);
  value.tick(null);
  value.tick(null);
  let [floor] = value.snapshot().breakawayFloors;
  assert.equal(floor.state, "cracking");
  assert.equal(floor.ticksRemaining, VERTICAL_PHYSICS.breakawayCountdownTicks);
  for (let tick = 0; tick < VERTICAL_PHYSICS.breakawayCountdownTicks; tick += 1) value.tick(null);
  floor = value.snapshot().breakawayFloors[0];
  assert.equal(floor.state, "open");
  assert.equal(value.snapshot().recentBreakawayFloorEvents.at(-1).kind, "BREAKAWAY_OPENED");
  assert.ok(
    value.player.verticalMode === VERTICAL_MODE.FALLING
      || value.player.supportKind === SUPPORT_KIND.FLOOR,
  );
  for (let tick = 0; tick < 120 && value.player.layerIndex !== 0; tick += 1) value.tick(null);
  assert.equal(value.player.layerIndex, 0);
  assert.equal(value.player.supportKind, SUPPORT_KIND.FLOOR);
});

test("a breakaway countdown latches after departure and reset restores the intact authored floor", () => {
  const source = documentWithBreakaway();
  const value = simulation(source.document);
  value.tick(null);
  value.tick(null);
  value.player.x = 2.5;
  value.player.z = 2.5;
  for (let tick = 0; tick < VERTICAL_PHYSICS.breakawayCountdownTicks; tick += 1) value.tick(null);
  assert.equal(value.snapshot().breakawayFloors[0].state, "open");
  value.tick({ type: "restoreScenario" });
  assert.equal(value.snapshot().breakawayFloors[0].state, "intact");
});

test("an oversized table opens a breakaway tile but bridges its ordinary square aperture", () => {
  const source = documentWithBreakaway();
  source.document.playerStart = { layerId: source.upperId, x: 2.5, z: 2.5 };
  const table = placeInstance(source.document, "object.table", 5.5, 5.5, {
    layerId: source.upperId,
  });
  const value = simulation(table.document);
  for (let tick = 0; tick <= VERTICAL_PHYSICS.breakawayCountdownTicks + 1; tick += 1) value.tick(null);
  const body = value.snapshot().rocks[0];
  assert.equal(value.snapshot().breakawayFloors[0].state, "open");
  assert.equal(body.layerId, source.upperId);
  assert.equal(body.supportKind, "floor");
});

test("schema-v13 replays retain no-breakaway behavior", () => {
  const source = documentWithBreakaway();
  const value = simulation(source.document);
  value.tick(null);
  const recording = value.exportCommandLog();
  recording.schemaVersion = 13;
  delete recording.configuration.breakawayFloorProfile;
  const replayed = Simulation.replay(recording);
  assert.equal(replayed.breakawayFloorProfile, BREAKAWAY_FLOOR_PROFILE_NONE);
  assert.equal(replayed.snapshot().breakawayFloors.length, 0);
  assert.equal(replayed.player.layerIndex, 1);
});
