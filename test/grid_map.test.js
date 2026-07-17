import test from "node:test";
import assert from "node:assert/strict";

import { cellToWorldCenter, createDebugArenaMap, GridMap, worldToCell } from "../src/sim/grid_map.js";

test("world and cell mapping handles exact, negative, and out-of-range boundaries", () => {
  assert.equal(worldToCell(0), 0);
  assert.equal(worldToCell(0.999_999), 0);
  assert.equal(worldToCell(1), 1);
  assert.equal(worldToCell(-0.000_001), -1);
  assert.equal(worldToCell(-1), -1);
  assert.equal(cellToWorldCenter(0), 0.5);
  assert.equal(cellToWorldCenter(-1), -0.5);

  const map = new GridMap(2, 2);
  assert.equal(map.get(-1, 0), 1);
  assert.equal(map.get(2, 1), 1);
  assert.equal(map.set(2, 1, 0), false);
});

test("versioned maps round-trip without sharing mutable cell storage", () => {
  const original = createDebugArenaMap();
  const restored = GridMap.fromJSON(JSON.stringify(original.toJSON()));
  assert.deepEqual(restored.toJSON(), original.toJSON());
  restored.set(1, 1, 1);
  assert.notEqual(restored.get(1, 1), original.get(1, 1));
});

test("map loading rejects invalid tile values and solid spawns", () => {
  assert.throws(
    () => GridMap.fromJSON({ version: 1, width: 1, height: 1, cells: [2], playerSpawn: { x: 0.5, z: 0.5 } }),
    /Invalid tile/,
  );
  assert.throws(
    () => GridMap.fromJSON({ version: 1, width: 1, height: 1, cells: [1], playerSpawn: { x: 0.5, z: 0.5 } }),
    /floor cell/,
  );
});
