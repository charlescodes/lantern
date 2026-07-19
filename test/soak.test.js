import test from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import os from "node:os";

import { Simulation } from "../src/sim/simulation.js";

test("10 simulated minutes of move/cast stress stay bounded with sim p99 below 8 ms", () => {
  const totalTicks = 10 * 60 * 60;
  const samples = new Float64Array(totalTicks);
  const simulation = new Simulation({ seed: 0x51a7e });
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
  }
  const sorted = Array.from(samples).sort((a, b) => a - b);
  const p99 = sorted[Math.ceil(sorted.length * 0.99) - 1];
  const heapAfter = process.memoryUsage().heapUsed;
  assert.ok(p99 < 8, `simulation p99 ${p99.toFixed(3)} ms exceeded 8 ms`);
  assert.equal(simulation.commandLog.length, simulation.commandLog.capacity);
  assert.equal(simulation.projectiles.dropped, 0);
  assert.equal(simulation.particles.dropped, 0);
  console.log(JSON.stringify({
    hardware: `${os.cpus()[0]?.model ?? "unknown CPU"} (${os.cpus().length} logical), ${Math.round(os.totalmem() / 2 ** 30)} GiB`,
    node: process.version,
    ticks: totalTicks,
    simP99Ms: Number(p99.toFixed(3)),
    heapDeltaMiB: Number(((heapAfter - heapBefore) / 2 ** 20).toFixed(2)),
  }));
});
