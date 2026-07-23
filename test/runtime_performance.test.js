import test from "node:test";
import assert from "node:assert/strict";

import { FixedStepRuntime } from "../src/runtime/fixed_step_runtime.js";
import { Simulation } from "../src/sim/simulation.js";

test("raw frame spacing is recorded before the 250 ms simulation clamp", () => {
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;
  let queuedFrame = null;
  globalThis.requestAnimationFrame = (callback) => {
    queuedFrame = callback;
    return 1;
  };
  globalThis.cancelAnimationFrame = () => {};

  const simulation = new Simulation();
  const runtime = new FixedStepRuntime({ simulation });
  try {
    runtime.start();
    const firstFrame = queuedFrame;
    firstFrame(1_000);
    const secondFrame = queuedFrame;
    secondFrame(1_400);

    const metrics = runtime.metrics();
    assert.equal(metrics.frameMs.last, 400);
    assert.equal(metrics.frameMs.max, 400);
    assert.equal(metrics.clampedFrameCount, 1);
    assert.equal(metrics.droppedWallTimeMs, 150);
    assert.equal(simulation.tickCount, 15);

    const tick = simulation.tickCount;
    runtime.resetPerformanceMetrics();
    const reset = runtime.metrics();
    assert.deepEqual(reset.frameMs, {
      last: 0,
      p50: 0,
      p95: 0,
      p99: 0,
      max: 0,
    });
    assert.equal(reset.clampedFrameCount, 0);
    assert.equal(reset.droppedWallTimeMs, 0);
    assert.equal(simulation.tickCount, tick);
  } finally {
    runtime.stop();
    if (originalRequestAnimationFrame) {
      globalThis.requestAnimationFrame = originalRequestAnimationFrame;
    } else {
      delete globalThis.requestAnimationFrame;
    }
    if (originalCancelAnimationFrame) {
      globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
    } else {
      delete globalThis.cancelAnimationFrame;
    }
  }
});
