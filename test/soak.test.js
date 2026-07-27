import test from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import os from "node:os";

import {
  ENEMY_AI_PROFILE_NONE,
  GAMEPLAY_PROFILE_PRE_COMBAT,
} from "../src/config.js";
import { GridMap } from "../src/sim/grid_map.js";
import { Simulation } from "../src/sim/simulation.js";

test("10 simulated minutes of move/cast stress stay bounded with sim p99 below 8 ms", () => {
  const totalTicks = 10 * 60 * 60;
  const samples = new Float64Array(totalTicks);
  const simulation = new Simulation({
    seed: 0x51a7e,
    gameplayProfile: GAMEPLAY_PROFILE_PRE_COMBAT,
    enemyAiProfile: ENEMY_AI_PROFILE_NONE,
  });
  const heapBefore = process.memoryUsage().heapUsed;
  for (let tick = 0; tick < totalTicks; tick += 1) {
    const started = performance.now();
    simulation.tick({
      move: tick % 600 < 300 ? { x: 20.5, z: 18.5 } : { x: 2.5, z: 5.5 },
      cast: tick % 15 === 0 ? { x: 11.5, z: 19.5 } : null,
    });
    samples[tick] = performance.now() - started;
    assert.ok(simulation.rocks.activeCount <= simulation.rocks.capacity);
    assert.ok(simulation.projectiles.activeCount <= simulation.projectiles.capacity);
    assert.ok(simulation.particles.activeCount <= simulation.particles.capacity);
    for (let index = 0; index < simulation.particles.activeCount; index += 1) {
      assert.equal(
        simulation.map.get(
          Math.floor(simulation.particles.x[index]),
          Math.floor(simulation.particles.z[index]),
        ),
        0,
      );
    }
  }
  const sorted = Array.from(samples).sort((a, b) => a - b);
  const p99 = sorted[Math.ceil(sorted.length * 0.99) - 1];
  const heapAfter = process.memoryUsage().heapUsed;
  assert.ok(p99 < 8, `simulation p99 ${p99.toFixed(3)} ms exceeded 8 ms`);
  assert.equal(simulation.commandLog.length, simulation.commandLog.capacity);
  assert.equal(simulation.projectiles.dropped, 0);
  assert.equal(simulation.particles.dropped, 0);
  assert.ok(simulation.particles.groundBounces > 0);
  assert.ok(heapAfter - heapBefore < 64 * 2 ** 20, "bounded histories exceeded 64 MiB");
  console.log(JSON.stringify({
    hardware: `${os.cpus()[0]?.model ?? "unknown CPU"} (${os.cpus().length} logical), ${Math.round(os.totalmem() / 2 ** 30)} GiB`,
    node: process.version,
    ticks: totalTicks,
    simP99Ms: Number(p99.toFixed(3)),
    heapDeltaMiB: Number(((heapAfter - heapBefore) / 2 ** 20).toFixed(2)),
    particleWallBounces: simulation.particles.wallBounces,
    particleGroundBounces: simulation.particles.groundBounces,
    particleCollisionDiscards: simulation.particles.collisionDiscards,
  }));
});

test("4,096 ricocheting corridor particles stay bounded with sim p99 below 8 ms", () => {
  const map = new GridMap(5, 66, undefined, { x: 2.5, z: 1.5 });
  for (let z = 0; z < map.height; z += 1) {
    map.set(1, z, 1);
    map.set(3, z, 1);
  }
  const simulation = new Simulation({
    map,
    seed: 0xc0_441d_0f,
    particleBurstCount: 0,
  });
  for (let index = 0; index < simulation.particles.capacity; index += 1) {
    const id = simulation.particles.spawn({
      x: 2.5,
      y: 10,
      z: 1.5 + (index % 64),
      vx: index % 2 === 0 ? 7 : -7,
      vy: 0,
      vz: 0,
      lifetime: 0.8,
      size: 0.05,
    });
    assert.ok(id > 0);
  }
  assert.equal(simulation.particles.activeCount, 4_096);
  assert.equal(simulation.particles.dropped, 0);

  const samples = new Float64Array(48);
  const heapBefore = process.memoryUsage().heapUsed;
  for (let tick = 0; tick < samples.length; tick += 1) {
    const started = performance.now();
    simulation.tick(null);
    samples[tick] = performance.now() - started;
    assert.ok(simulation.particles.activeCount <= simulation.particles.capacity);
    for (let index = 0; index < simulation.particles.activeCount; index += 1) {
      assert.equal(
        map.get(
          Math.floor(simulation.particles.x[index]),
          Math.floor(simulation.particles.z[index]),
        ),
        0,
      );
    }
  }
  for (let tick = 0; tick < 16; tick += 1) simulation.tick(null);

  const sorted = Array.from(samples).sort((a, b) => a - b);
  const p99 = sorted[Math.ceil(sorted.length * 0.99) - 1];
  const heapAfter = process.memoryUsage().heapUsed;
  assert.ok(p99 < 8, `corridor simulation p99 ${p99.toFixed(3)} ms exceeded 8 ms`);
  assert.equal(simulation.particles.activeCount, 0);
  assert.ok(simulation.particles.wallBounces > 0);
  assert.equal(simulation.particles.collisionDiscards, 0);
  assert.equal(simulation.particles.x.length, simulation.particles.capacity);
  assert.equal(simulation.particles.wallBounceCount.length, simulation.particles.capacity);
  assert.ok(simulation.commandLog.length <= simulation.commandLog.capacity);
  assert.ok(heapAfter - heapBefore < 32 * 2 ** 20, "corridor stress exceeded 32 MiB");
  console.log(JSON.stringify({
    particles: 4_096,
    ticks: samples.length,
    simP99Ms: Number(p99.toFixed(3)),
    heapDeltaMiB: Number(((heapAfter - heapBefore) / 2 ** 20).toFixed(2)),
    wallBounces: simulation.particles.wallBounces,
  }));
});
