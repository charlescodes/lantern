import assert from "node:assert/strict";
import test from "node:test";

import {
  COMBAT,
  ENEMY_WIZARD,
  NAVIGATION_EVIDENCE,
  NAVIGATION_ROUTE_PHASE,
  NAVIGATION_TOPOLOGY,
} from "../src/config.js";
import { EnemyWizardPool } from "../src/sim/pools.js";

function spawn(pool, sequence) {
  return pool.spawn({
    spawnSequence: sequence,
    spawnTick: sequence,
    x: sequence + 1.5,
    z: 2.5,
    radius: ENEMY_WIZARD.radius,
    massKg: ENEMY_WIZARD.massKg,
    maximumHealth: COMBAT.maximumHealth,
    shotReadyTick: 10,
  });
}

test("bounded enemy route rows clear tails and reject overflow", () => {
  const pool = new EnemyWizardPool(2);
  spawn(pool, 1);
  const maximum = Uint16Array.from(
    { length: NAVIGATION_TOPOLOGY.portCapacity },
    (_, index) => index,
  );
  pool.setNavigationRoute(0, maximum);
  assert.equal(pool.navigationRoute(0).length, NAVIGATION_TOPOLOGY.portCapacity);
  pool.setNavigationRoute(0, [7, 3]);
  assert.deepEqual(pool.navigationRoute(0), [7, 3]);
  const offset = 0;
  assert.equal(pool.routePorts[offset + 2], NAVIGATION_TOPOLOGY.noPort);
  assert.throws(
    () => pool.setNavigationRoute(0, new Uint16Array(NAVIGATION_TOPOLOGY.portCapacity + 1)),
    /at most/,
  );
});

test("swap removal keeps the surviving stable enemy route and evidence", () => {
  const pool = new EnemyWizardPool(4);
  const first = spawn(pool, 1);
  spawn(pool, 2);
  const survivor = spawn(pool, 3);
  pool.setNavigationRoute(2, [4, 8, 12]);
  pool.topologyPhase[2] = NAVIGATION_ROUTE_PHASE.localGoal;
  pool.topologyRevision[2] = 11;
  pool.currentRoutePort[2] = 12;
  pool.previousRoutePort[2] = 8;
  pool.knownTargetLayer[2] = 2;
  pool.navigationEvidence[2] = NAVIGATION_EVIDENCE.none;
  assert.equal(pool.removeSwap(pool.findIndexById(first)), true);
  const index = pool.findIndexById(survivor);
  assert.equal(index, 0);
  assert.deepEqual(pool.navigationRoute(index), [4, 8, 12]);
  assert.equal(pool.topologyPhase[index], NAVIGATION_ROUTE_PHASE.localGoal);
  assert.equal(pool.topologyRevision[index], 11);
  assert.equal(pool.currentRoutePort[index], 12);
  assert.equal(pool.previousRoutePort[index], 8);
  assert.equal(pool.knownTargetLayer[index], 2);
  const clearedOffset = 2 * NAVIGATION_TOPOLOGY.portCapacity;
  assert.equal(pool.routePorts[clearedOffset], NAVIGATION_TOPOLOGY.noPort);
});

test("reset and respawn restore every route column to its inert sentinel", () => {
  const pool = new EnemyWizardPool(2);
  spawn(pool, 1);
  pool.setNavigationRoute(0, [3, 9]);
  pool.topologyPhase[0] = NAVIGATION_ROUTE_PHASE.localGoal;
  pool.topologyRevision[0] = 7;
  pool.currentRoutePort[0] = 9;
  pool.patrolDwellRemaining[0] = 44;
  pool.reset();
  assert.equal(pool.routeLength[0], 0);
  assert.equal(pool.currentRoutePort[0], NAVIGATION_TOPOLOGY.noPort);
  assert.equal(pool.routePorts[0], NAVIGATION_TOPOLOGY.noPort);
  spawn(pool, 2);
  assert.equal(pool.topologyPhase[0], NAVIGATION_ROUTE_PHASE.none);
  assert.equal(pool.topologyRevision[0], 0);
  assert.equal(pool.currentRoutePort[0], NAVIGATION_TOPOLOGY.noPort);
  assert.equal(pool.knownTargetLayer[0], NAVIGATION_TOPOLOGY.noLayer);
  assert.equal(pool.patrolDwellRemaining[0], 0);
  assert.deepEqual(pool.navigationRoute(0), []);
});

test("repeated first, middle, and last removals do not leak route rows", () => {
  const pool = new EnemyWizardPool(4);
  for (let cycle = 0; cycle < 128; cycle += 1) {
    while (pool.activeCount < 4) {
      const sequence = cycle * 4 + pool.activeCount + 1;
      spawn(pool, sequence);
      const index = pool.activeCount - 1;
      pool.setNavigationRoute(index, [index, (index + 1) % 4]);
      pool.topologyRevision[index] = sequence;
    }
    const removedIndex = cycle % 3 === 0 ? 0 : cycle % 3 === 1 ? 1 : pool.activeCount - 1;
    const removedId = pool.id[removedIndex];
    assert.equal(pool.removeSwap(removedIndex), true);
    assert.equal(pool.findIndexById(removedId), -1);
    for (let index = 0; index < pool.activeCount; index += 1) {
      assert.equal(pool.navigationRoute(index).length, 2);
      assert.ok(pool.topologyRevision[index] > 0);
    }
    const clearedOffset = pool.activeCount * NAVIGATION_TOPOLOGY.portCapacity;
    assert.equal(pool.routePorts[clearedOffset], NAVIGATION_TOPOLOGY.noPort);
  }
});
