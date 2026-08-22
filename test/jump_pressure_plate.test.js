import test from "node:test";
import assert from "node:assert/strict";

import { placeInstance } from "../src/authoring/authoring_commands.js";
import { GridMap } from "../src/sim/grid_map.js";
import { ArenaScenario } from "../src/sim/scenario.js";
import { Simulation } from "../src/sim/simulation.js";
import { ENEMY_AI_PROFILE_NONE, GAMEPLAY_PROFILE_PRE_COMBAT } from "../src/config.js";
import { SUPPORT_KIND, VERTICAL_MODE } from "../src/sim/vertical_body.js";

function simulation(document) {
  return new Simulation({
    scenario: new ArenaScenario(document),
    gameplayProfile: GAMEPLAY_PROFILE_PRE_COMBAT,
    enemyAiProfile: ENEMY_AI_PROFILE_NONE,
    particleBurstCount: 0,
  });
}

test("jump is a committed supported-only arc and replay records its edge", () => {
  const source = new ArenaScenario(new GridMap(12, 12, undefined, { x: 3.5, z: 5.5 })).toAuthoringJSON();
  const value = simulation(source);
  value.tick({ move: { x: 10, z: 5.5 }, jump: true });
  assert.equal(value.player.verticalMode, VERTICAL_MODE.JUMPING);
  const start = value.player.x;
  for (let tick = 0; tick < 40; tick += 1) value.tick({ move: { x: 0, z: 5.5 } });
  assert.equal(value.player.verticalMode, VERTICAL_MODE.SUPPORTED);
  assert.equal(value.player.supportKind, SUPPORT_KIND.FLOOR);
  assert.ok(value.player.x > start + 1.5, "movement input must not reverse a committed jump");
  assert.deepEqual(Simulation.replay(value.exportCommandLog()).snapshot().player, value.snapshot().player);
});

test("pressure plate is authored, floor-supported only, and momentary", () => {
  const source = new ArenaScenario(new GridMap(12, 12, undefined, { x: 3.5, z: 5.5 })).toAuthoringJSON();
  const placed = placeInstance(source, "object.pressure-plate", 3.5, 5.5);
  const value = simulation(placed.document);
  value.tick(null);
  assert.equal(value.snapshot().pressurePlates[0].pressed, true);
  value.tick({ move: { x: 10, z: 5.5 }, jump: true });
  assert.equal(value.snapshot().pressurePlates[0].pressed, false);
  assert.equal(value.snapshot().recentPressurePlateEvents.at(-1).kind, "PLATE_RELEASED");
});
