import test from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import os from "node:os";

import {
  DEAD_BODY,
  ENEMY_AI_PROFILE_NONE,
  ENEMY_WIZARD,
  GAMEPLAY_PROFILE_PRE_COMBAT,
} from "../src/config.js";
import { DEAD_BODY_SETTLE_REASON } from "../src/sim/dead_body_pool.js";
import { GridMap } from "../src/sim/grid_map.js";
import { Simulation } from "../src/sim/simulation.js";

function stressMap() {
  const map = new GridMap(96, 96, undefined, { x: 4.5, z: 4.5 });
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

test("64 dynamic and 1,000 inert dead bodies stay bounded below 8 ms", () => {
  const simulation = new Simulation({
    map: stressMap(),
    seed: 0xded_b0d1,
    gameplayProfile: GAMEPLAY_PROFILE_PRE_COMBAT,
    enemyAiProfile: ENEMY_AI_PROFILE_NONE,
    particleBurstCount: 0,
    dynamicDeadBodyCapacity: DEAD_BODY.maximumDynamicCapacity,
    inertDeadBodyCapacity: DEAD_BODY.maximumInertCapacity,
  });
  for (let id = 1; id <= DEAD_BODY.maximumInertCapacity; id += 1) {
    simulation.inertDeadBodies.push({
      id,
      spawnSequence: id,
      deathTick: 0,
      settledTick: 0,
      x: 50 + (id % 32) * 0.7,
      z: 50 + Math.floor(id / 32) * 0.7,
      facingX: 1,
      facingZ: 0,
      radius: ENEMY_WIZARD.radius,
      massKg: ENEMY_WIZARD.massKg,
      settleReason: DEAD_BODY_SETTLE_REASON.quiet,
    });
  }

  let nextId = DEAD_BODY.maximumInertCapacity + 1;
  const fillDynamic = () => {
    while (
      simulation.dynamicDeadBodies.activeCount
      < simulation.dynamicDeadBodies.capacity
    ) {
      const ordinal = simulation.dynamicDeadBodies.activeCount;
      const x = 20 + (ordinal % 8) * 0.72;
      const z = 20 + Math.floor(ordinal / 8) * 0.72;
      const speed = ordinal % 2 === 0 ? 2 : -2;
      const index = simulation.dynamicDeadBodies.spawn({
        id: nextId,
        spawnSequence: nextId,
        deathTick: simulation.tickCount,
        x,
        z,
        vx: speed,
        vz: ordinal % 3 === 0 ? -speed : 0,
        facingX: speed > 0 ? 1 : -1,
        facingZ: 0,
        radius: ENEMY_WIZARD.radius,
        massKg: ENEMY_WIZARD.massKg,
      });
      assert.ok(index >= 0);
      nextId += 1;
    }
  };

  const totalTicks = 7_200;
  const samples = new Float64Array(totalTicks);
  const heapBefore = process.memoryUsage().heapUsed;
  let minimumDynamic = simulation.dynamicDeadBodies.capacity;
  for (let tick = 0; tick < totalTicks; tick += 1) {
    fillDynamic();
    const started = performance.now();
    simulation.tick(null);
    samples[tick] = performance.now() - started;
    minimumDynamic = Math.min(minimumDynamic, simulation.dynamicDeadBodies.activeCount);
    assert.ok(
      simulation.dynamicDeadBodies.activeCount
      <= simulation.dynamicDeadBodies.capacity,
    );
    assert.equal(simulation.inertDeadBodies.length, simulation.inertDeadBodies.capacity);
  }
  const sorted = Array.from(samples).sort((left, right) => left - right);
  const p99 = sorted[Math.ceil(sorted.length * 0.99) - 1];
  const heapAfter = process.memoryUsage().heapUsed;
  assert.ok(p99 < 8, `dead-body simulation p99 ${p99.toFixed(3)} ms exceeded 8 ms`);
  assert.ok(heapAfter - heapBefore < 64 * 2 ** 20, "dead-body stress exceeded 64 MiB");
  assert.ok(simulation.inertDeadBodies.overwritten > 0);
  assert.ok(minimumDynamic < simulation.dynamicDeadBodies.capacity);
  assert.doesNotThrow(() => JSON.stringify(simulation.snapshot()));
  console.log(JSON.stringify({
    hardware: `${os.cpus()[0]?.model ?? "unknown CPU"} (${os.cpus().length} logical)`,
    node: process.version,
    ticks: totalTicks,
    dynamicCapacity: simulation.dynamicDeadBodies.capacity,
    inertCapacity: simulation.inertDeadBodies.capacity,
    inertOverwrites: simulation.inertDeadBodies.overwritten,
    simP99Ms: Number(p99.toFixed(3)),
    heapDeltaMiB: Number(((heapAfter - heapBefore) / 2 ** 20).toFixed(2)),
  }));
});
