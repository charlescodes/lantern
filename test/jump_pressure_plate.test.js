import test from "node:test";
import assert from "node:assert/strict";

import { placeInstance } from "../src/authoring/authoring_commands.js";
import { GridMap } from "../src/sim/grid_map.js";
import { ArenaScenario } from "../src/sim/scenario.js";
import { Simulation } from "../src/sim/simulation.js";
import { ENEMY_AI_PROFILE_NONE, GAMEPLAY_PROFILE_PRE_COMBAT } from "../src/config.js";
import { SUPPORT_KIND, VERTICAL_MODE } from "../src/sim/vertical_body.js";
import { footprintOverlapsAxisAlignedRectangle } from "../src/sim/aperture_fit.js";

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

test("pressure plate overlap uses the live circle or quarter-turn box footprint", () => {
  const plate = { x: 5.5, z: 5.5, halfWidth: 0.45, halfDepth: 0.45 };
  assert.equal(footprintOverlapsAxisAlignedRectangle(
    { type: "circle", x: 5.98, z: 5.5, radius: 0.3 }, plate,
  ), true, "a circle can press a plate across its edge");
  assert.equal(footprintOverlapsAxisAlignedRectangle(
    { type: "circle", x: 6.25, z: 5.5, radius: 0.3 }, plate,
  ), false, "tangent-only contact does not press");
  assert.equal(footprintOverlapsAxisAlignedRectangle(
    { type: "rectangle", x: 4.5, z: 5.5, halfWidth: 0.9, halfDepth: 0.36, rotation: 0 }, plate,
  ), true, "a table end presses before its center reaches the plate");
  assert.equal(footprintOverlapsAxisAlignedRectangle(
    { type: "rectangle", x: 5.5, z: 4.5, halfWidth: 0.9, halfDepth: 0.36, rotation: 1 }, plate,
  ), true, "a quarter-turn table uses its rotated live extent");
});

test("one supported body can press adjacent plates and a table presses by box overlap", () => {
  let source = new ArenaScenario(new GridMap(12, 12, undefined, { x: 6, z: 5.5 })).toAuthoringJSON();
  source = placeInstance(source, "object.pressure-plate", 5.5, 5.5).document;
  source = placeInstance(source, "object.pressure-plate", 6.5, 5.5).document;
  const playerValue = simulation(source);
  playerValue.tick(null);
  assert.deepEqual(
    playerValue.snapshot().pressurePlates.map((plate) => plate.occupantCount),
    [1, 1],
    "the player footprint overlaps both neighboring plates",
  );

  let tableSource = new ArenaScenario(new GridMap(12, 12, undefined, { x: 2.5, z: 2.5 })).toAuthoringJSON();
  tableSource = placeInstance(tableSource, "object.pressure-plate", 6.5, 5.5).document;
  tableSource = placeInstance(tableSource, "object.table", 3.5, 5.5).document;
  const tableValue = simulation(tableSource);
  // This is a live push result, not an authored overlap: moving clutter may
  // enter a plate's contact area after compilation.
  tableValue.rocks.x[0] = 5.5;
  tableValue.rocks.previousX[0] = 5.5;
  tableValue.tick(null);
  assert.equal(tableValue.snapshot().pressurePlates[0].pressed, true);
  assert.equal(tableValue.snapshot().pressurePlates[0].occupantCount, 1);
});
