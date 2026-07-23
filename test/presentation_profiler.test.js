import test from "node:test";
import assert from "node:assert/strict";

import {
  CachedTimingSamples,
  PERFORMANCE_SAMPLE_CAPACITY,
} from "../src/core/performance.js";
import { CanvasPresentation } from "../src/presentation/canvas_presentation.js";
import {
  PRESENTATION_SPIKE_CAPACITY,
  PresentationProfiler,
} from "../src/presentation/profiler.js";
import { PresentationWarmupStatus } from "../src/presentation/warmup.js";

function timing(overrides = {}) {
  return {
    tick: 1,
    projectileCount: 0,
    particleCount: 0,
    activeLightCount: 0,
    updateMs: 4,
    lightsMs: 2,
    submitMs: 30,
    totalMs: 36,
    ...overrides,
  };
}

test("cached timing summaries do not sort when diagnostics are read", () => {
  const samples = new CachedTimingSamples({ summaryRefreshInterval: 4 });
  const toSortedArray = samples.samples.toSortedArray.bind(samples.samples);
  let sorts = 0;
  samples.samples.toSortedArray = () => {
    sorts += 1;
    return toSortedArray();
  };
  samples.push(1);
  assert.equal(sorts, 1);
  for (let index = 0; index < 20; index += 1) samples.summary();
  assert.equal(sorts, 1);
  samples.push(2);
  samples.push(3);
  samples.summary();
  assert.equal(sorts, 1);
});

test("presentation profiler uses bounded timing and spike histories", () => {
  const defaults = new PresentationProfiler();
  assert.equal(defaults.phases.totalMs.samples.capacity, PERFORMANCE_SAMPLE_CAPACITY);
  assert.equal(defaults.spikes.capacity, PRESENTATION_SPIKE_CAPACITY);

  const profiler = new PresentationProfiler({
    sampleCapacity: 3,
    spikeCapacity: 2,
    summaryRefreshInterval: 1,
  });
  profiler.prime({ projectileCount: 0, particleCount: 0, activeLightCount: 0 });
  profiler.record(timing({ tick: 1, projectileCount: 1, activeLightCount: 1 }));
  profiler.record(timing({
    tick: 2,
    projectileCount: 0,
    particleCount: 224,
    activeLightCount: 8,
    submitMs: 40,
    totalMs: 46,
  }));
  profiler.record(timing({
    tick: 3,
    projectileCount: 0,
    particleCount: 0,
    activeLightCount: 0,
    updateMs: 34,
    submitMs: 1,
    totalMs: 37,
  }));

  assert.equal(profiler.phases.totalMs.samples.length, 3);
  assert.equal(profiler.recentSpikes().length, 2);
  const latest = profiler.recentSpikes().at(-1);
  assert.deepEqual(latest.projectileCountTransition, { from: 0, to: 0 });
  assert.deepEqual(latest.particleCountTransition, { from: 224, to: 0 });
  assert.deepEqual(latest.activeLightCountTransition, { from: 8, to: 0 });
  assert.equal(latest.dominantPhase, "updateMs");
  assert.equal(profiler.summary().totalMs.max, 46);
});

test("presentation metric reset clears histories and spikes but keeps transition baseline", () => {
  const profiler = new PresentationProfiler({ summaryRefreshInterval: 1 });
  profiler.prime({ projectileCount: 0, particleCount: 0, activeLightCount: 0 });
  profiler.record(timing({ projectileCount: 1, activeLightCount: 1 }));
  profiler.reset();

  assert.deepEqual(profiler.recentSpikes(), []);
  assert.deepEqual(profiler.summary().totalMs, {
    last: 0,
    p50: 0,
    p95: 0,
    p99: 0,
    max: 0,
  });
  profiler.record(timing({
    tick: 2,
    projectileCount: 0,
    particleCount: 224,
    activeLightCount: 8,
  }));
  const spike = profiler.recentSpikes()[0];
  assert.deepEqual(spike.projectileCountTransition, { from: 1, to: 0 });
  assert.deepEqual(spike.particleCountTransition, { from: 0, to: 224 });
});

test("warmup status reports ready, failure, and Canvas2D not-required states", () => {
  let now = 100;
  const ready = new PresentationWarmupStatus(true, () => now, now);
  now = 135;
  assert.deepEqual(ready.snapshot(), { state: "warming", durationMs: 35 });
  now = 180;
  ready.complete();
  assert.deepEqual(ready.snapshot(), { state: "ready", durationMs: 80 });

  now = 200;
  const failed = new PresentationWarmupStatus(true, () => now, now);
  now = 225;
  failed.fail();
  assert.deepEqual(failed.snapshot(), { state: "failed", durationMs: 25 });

  const canvas = new PresentationWarmupStatus(false, () => now, now);
  assert.deepEqual(canvas.snapshot(), { state: "not-required", durationMs: 0 });
});

test("Canvas2D exposes the shared profiler with no resident lights or warmup", () => {
  const canvas = {
    getContext() {
      return {};
    },
  };
  const presentation = new CanvasPresentation(
    /** @type {any} */ (canvas),
    /** @type {any} */ ({}),
    /** @type {any} */ ({ projectiles: [], particles: [] }),
  );
  const diagnostics = presentation.diagnostics();
  assert.equal(diagnostics.residentLightCount, 0);
  assert.deepEqual(diagnostics.warmup, {
    state: "not-required",
    durationMs: 0,
  });
  assert.deepEqual(diagnostics.presentationCpuMs.totalMs, {
    last: 0,
    p50: 0,
    p95: 0,
    p99: 0,
    max: 0,
  });
});
