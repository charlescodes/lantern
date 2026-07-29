import test from "node:test";
import assert from "node:assert/strict";

import { PERCEPTIVE_WIZARD } from "../src/config.js";
import { DestinationFieldCache } from "../src/sim/destination_field_cache.js";
import { GridMap } from "../src/sim/grid_map.js";
import { NAVIGATION_UNREACHABLE } from "../src/sim/navigation_field.js";

function borderedMap(width, height) {
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

function complete(cache, map, maximumTicks = 10_000) {
  let ticks = 0;
  while (cache.diagnostics(1).building || cache.diagnostics(1).staleSlots > 0) {
    cache.update(map, PERCEPTIVE_WIZARD.navigationExpansionsPerTick);
    ticks += 1;
    assert.ok(ticks < maximumTicks, "destination cache did not complete");
  }
}

test("four actor slots are pinned and shared goal cells reuse one referenced slot", () => {
  const map = borderedMap(12, 10);
  const cache = new DestinationFieldCache(map);
  cache.beginTick();
  const actors = [];
  for (let id = 1; id <= 4; id += 1) {
    actors.push(cache.requestActor(1, id, 1, 1, id + 1, 2));
  }
  assert.deepEqual(actors, [0, 1, 2, 3]);
  assert.equal(cache.requestActor(1, 5, 1, 1, 7, 2), -1);
  const first = cache.requestGoal(1, 8, 7);
  const shared = cache.requestGoal(1, 8, 7);
  assert.equal(first, 4);
  assert.equal(shared, first);
  assert.equal(cache.slotDiagnostics(first).references, 2);
  cache.update(map, PERCEPTIVE_WIZARD.navigationExpansionsPerTick);
  const diagnostics = cache.diagnostics(1);
  assert.ok(diagnostics.expansionsThisTick <= 2_048);
  assert.equal(diagnostics.actorTargetSlots, 4);
  assert.equal(diagnostics.goalCellSlots, 64);
  assert.deepEqual(
    diagnostics.slots.slice(0, 5).map((slot) => slot.slot),
    [0, 1, 2, 3, 4],
  );
});

test("one builder retains completed costs while target-cell and map revisions rebuild", () => {
  const map = borderedMap(18, 14);
  const cache = new DestinationFieldCache(map);
  cache.beginTick();
  const slot = cache.requestActor(1, 1, 1, 1, 2, 2);
  cache.update(map, 2_048);
  assert.equal(cache.isCurrent(slot), true);
  const oldCost = cache.rawCostAt(slot, 14, 10);
  assert.notEqual(oldCost, NAVIGATION_UNREACHABLE);
  const oldVersion = cache.slotDiagnostics(slot).version;

  cache.beginTick();
  assert.equal(cache.requestActor(1, 1, 1, 1, 3, 2), slot);
  cache.update(map, 7);
  let state = cache.slotDiagnostics(slot);
  assert.equal(state.stale, true);
  assert.equal(state.building, true);
  assert.equal(state.version, oldVersion);
  assert.equal(cache.rawCostAt(slot, 14, 10), oldCost);
  assert.equal(cache.isCurrent(slot), false);
  while (!cache.isCurrent(slot)) cache.update(map, 37);
  state = cache.slotDiagnostics(slot);
  assert.equal(state.version, oldVersion + 1);
  assert.deepEqual(state.completedGoalCell, { cx: 3, cz: 2 });

  map.set(8, 6, 1);
  cache.beginTick();
  cache.requestActor(1, 1, 1, 2, 3, 2);
  cache.update(map, 5);
  state = cache.slotDiagnostics(slot);
  assert.equal(state.stale, true);
  assert.equal(state.completedMapRevision, 1);
  assert.equal(state.requestedMapRevision, 2);
});

test("the total expansion budget is global and stable slot order builds actors before goals", () => {
  const map = borderedMap(64, 64);
  const cache = new DestinationFieldCache(map);
  cache.beginTick();
  const actor = cache.requestActor(1, 1, 1, 1, 2, 2);
  const goal = cache.requestGoal(1, 60, 60);
  const expanded = cache.update(map, PERCEPTIVE_WIZARD.navigationExpansionsPerTick);
  assert.equal(expanded, PERCEPTIVE_WIZARD.navigationExpansionsPerTick);
  assert.equal(cache.diagnostics(1).buildingSlot, actor);
  assert.equal(cache.slotDiagnostics(goal).building, false);
  assert.equal(cache.diagnostics(1).expansionsThisTick, 2_048);
});

test("disconnected cells remain unreachable and referenced goals cannot be evicted", () => {
  const map = borderedMap(20, 12);
  for (let z = 1; z < map.height - 1; z += 1) map.set(10, z, 1);
  const cache = new DestinationFieldCache(map);
  cache.beginTick();
  const slot = cache.requestGoal(1, 3, 5);
  cache.update(map, 2_048);
  assert.equal(cache.rawCostAt(slot, 15, 5), NAVIGATION_UNREACHABLE);
  assert.equal(cache.gradientStep(map, slot, 15, 5, "approach"), null);

  cache.reset(map);
  cache.beginTick();
  const slots = [];
  for (let index = 0; index < 64; index += 1) {
    const cx = 1 + index % 8;
    const cz = 1 + Math.floor(index / 8);
    slots.push(cache.requestGoal(1, cx, cz));
  }
  assert.equal(new Set(slots).size, 64);
  assert.equal(cache.requestGoal(1, 18, 10), -1);
  assert.equal(cache.slotDiagnostics(slots[0]).references, 1);
});
