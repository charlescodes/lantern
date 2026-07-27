import test from "node:test";
import assert from "node:assert/strict";

import { GridMap } from "../src/sim/grid_map.js";
import {
  NAVIGATION_NEIGHBORS,
  SharedNavigationField,
} from "../src/sim/navigation_field.js";

function borderedMap(width, height, spawn = { x: 1.5, z: 1.5 }) {
  const map = new GridMap(width, height, undefined, spawn);
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

function complete(field, map, revision, cx, cz, budget = 2_048) {
  let guard = 10_000;
  do {
    field.update(map, revision, cx, cz, budget);
    guard -= 1;
  } while (field.building && guard > 0);
  assert.ok(guard > 0, "navigation field did not complete");
}

test("shared navigation reaches through a doorway and follows fixed descending costs", () => {
  const map = borderedMap(11, 9, { x: 2.5, z: 4.5 });
  for (let z = 1; z < 8; z += 1) {
    if (z !== 4) map.set(5, z, 1);
  }
  const field = new SharedNavigationField(map);
  complete(field, map, 1, 2, 4);
  assert.equal(field.completed, true);
  assert.ok(field.costAt(8, 4) > 0);
  const step = field.gradientStep(map, 8, 4, "approach");
  assert.deepEqual(
    { cx: step.cx, cz: step.cz, direction: step.direction },
    { cx: 7, cz: 4, direction: "west" },
  );
});

test("diagonal corner cutting is forbidden and gradient ties use north-east-south-west order", () => {
  assert.deepEqual(
    NAVIGATION_NEIGHBORS.map((entry) => entry.name),
    ["north", "east", "south", "west", "northeast", "southeast", "southwest", "northwest"],
  );
  const blocked = borderedMap(5, 5);
  blocked.set(2, 1, 1);
  blocked.set(1, 2, 1);
  const blockedField = new SharedNavigationField(blocked);
  complete(blockedField, blocked, 1, 1, 1);
  assert.equal(blockedField.costAt(2, 2), null);

  const open = borderedMap(7, 7, { x: 3.5, z: 3.5 });
  const openField = new SharedNavigationField(open);
  complete(openField, open, 1, 3, 3);
  const retreat = openField.gradientStep(open, 3, 3, "retreat");
  assert.deepEqual(
    { cx: retreat.cx, cz: retreat.cz, direction: retreat.direction, cost: retreat.cost },
    { cx: 4, cz: 2, direction: "northeast", cost: 14 },
  );
});

test("incremental rebuilds are bounded and retain the stale completed field", () => {
  const map = borderedMap(64, 64, { x: 2.5, z: 2.5 });
  const field = new SharedNavigationField(map);
  field.update(map, 1, 2, 2, 17);
  assert.equal(field.completed, false);
  assert.equal(field.building, true);
  assert.equal(field.expansionsThisTick, 17);
  complete(field, map, 1, 2, 2, 17);
  assert.equal(field.version, 1);
  const previousCost = field.costAt(60, 60);

  field.update(map, 1, 60, 60, 17);
  assert.equal(field.completed, true);
  assert.equal(field.building, true);
  assert.equal(field.version, 1);
  assert.equal(field.costAt(60, 60), previousCost);
  assert.equal(field.diagnostics(1, 60, 60).stale, true);
  assert.ok(field.expansionsThisTick <= 17);
  complete(field, map, 1, 60, 60, 17);
  assert.equal(field.version, 2);
  assert.equal(field.costAt(60, 60), 0);

  map.set(32, 32, 1);
  field.update(map, 2, 60, 60, 17);
  assert.equal(field.building, true);
  assert.equal(field.version, 2);
  assert.equal(field.diagnostics(2, 60, 60).stale, true);
});

test("disconnected regions remain explicitly unreachable", () => {
  const map = borderedMap(9, 7, { x: 2.5, z: 3.5 });
  for (let z = 1; z < 6; z += 1) map.set(4, z, 1);
  const field = new SharedNavigationField(map);
  complete(field, map, 1, 2, 3);
  assert.equal(field.costAt(6, 3), null);
  assert.equal(field.gradientStep(map, 6, 3, "approach"), null);
});
