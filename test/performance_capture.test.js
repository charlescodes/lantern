import test from "node:test";
import assert from "node:assert/strict";

import {
  PERFORMANCE_CAPTURE_DURATION_MS,
  PERFORMANCE_REPORT_VERSION,
  PerformanceCapture,
  summarizeGpuSamples,
} from "../src/presentation/performance_capture.js";

function diagnostics(overrides = {}) {
  return {
    requestedRenderer: "3d",
    requestedBackend: "auto",
    activeBackend: "webgpu",
    settings: { lights: 16, dpr: 1.5, aa: true },
    flags: {
      dynamicLights: true,
      lightColorVariation: true,
      bloom: false,
      shadows: false,
    },
    presentationCpuMs: {
      updateMs: { p50: 1, p95: 2, p99: 3, max: 4 },
      lightsMs: { p50: 0.1, p95: 0.2, p99: 0.3, max: 0.4 },
      submitMs: { p50: 2, p95: 3, p99: 4, max: 5 },
      totalMs: { p50: 3, p95: 5, p99: 7, max: 9 },
    },
    activeLightCount: 8,
    residentLightCount: 16,
    recentSpikes: [{ tick: 1, totalMs: 35 }],
    warmup: { state: "ready", durationMs: 50 },
    drawCalls: 10,
    triangles: 200,
    lightGroups: { admittedGroupCount: 1 },
    trueSightCpuMs: { p50: 0.4, p95: 0.8, p99: 1.1, max: 1.5 },
    trueSight: {
      rayCount: 96,
      polygonVertexCount: 18,
      visibleWallCount: 12,
      maskWidth: 192,
      maskHeight: 192,
    },
    ...overrides,
  };
}

function runtime() {
  return {
    fps: 60,
    frameMs: { p50: 16, p95: 18, p99: 20, max: 25 },
    simMs: { p50: 0.1, p95: 0.2, p99: 0.3 },
    snapshotMs: { p50: 0.2, p95: 0.3, p99: 0.4 },
    renderMs: { p50: 3, p95: 5, p99: 7 },
  };
}

test("ten-second capture resets histories, observes unscripted workload, and reports shape", async () => {
  let now = 100;
  let resets = 0;
  let gpuBegins = 0;
  let gpuEnds = 0;
  const capture = new PerformanceCapture({
    now: () => now,
    wait: async (durationMs) => {
      assert.equal(durationMs, PERFORMANCE_CAPTURE_DURATION_MS);
      capture.observe(
        {
          projectiles: [{}, {}],
          particles: Array(224),
          rocks: Array(5),
          deadBodies: {
            dynamic: Array(6),
            inert: Array(81),
          },
          pools: {
            dynamicDeadBodies: { capacity: 16, forcedSettles: 2 },
            inertDeadBodies: { capacity: 100, overwritten: 7 },
            soundEvents: { capacity: 257 },
          },
          soundEventMetrics: {
            maximumEventsPerTick: 3,
            queueDropped: 2,
            emittedFootsteps: 12,
            heardFootsteps: 5,
            emittedFireballImpacts: 4,
            heardFireballImpacts: 3,
          },
          contacts: Array(3),
        },
        runtime(),
        diagnostics({ activeLightCount: 15 }),
      );
      now += durationMs;
    },
    resetMetrics: () => {
      resets += 1;
    },
    runtimeMetrics: runtime,
    presentationDiagnostics: diagnostics,
    deviceFacts: () => ({ userAgent: "test" }),
    beginGpuCapture: () => {
      gpuBegins += 1;
      return true;
    },
    endGpuCapture: () => {
      gpuEnds += 1;
      return [3, 1, 2, 4];
    },
  });

  const firstPromise = capture.capture();
  const secondPromise = capture.capture();
  assert.equal(firstPromise, secondPromise);
  const report = await firstPromise;
  assert.equal(resets, 1);
  assert.equal(gpuBegins, 1);
  assert.equal(gpuEnds, 1);
  assert.equal(report.actualDurationMs, 10_000);
  assert.equal(report.reportVersion, PERFORMANCE_REPORT_VERSION);
  assert.equal(PERFORMANCE_REPORT_VERSION, 4);
  assert.equal(report.workloadMaxima.maxParticles, 224);
  assert.equal(report.workloadMaxima.maxActiveLights, 15);
  assert.equal(report.workloadMaxima.maxTrueSightRays, 96);
  assert.equal(report.workloadMaxima.maxTrueSightPolygonVertices, 18);
  assert.deepEqual(report.deadBodies, {
    dynamicCapacity: 16,
    inertCapacity: 100,
    maximumDynamic: 6,
    maximumInert: 81,
    forcedSettles: 2,
    overwrites: 7,
  });
  assert.deepEqual(report.soundEvents, {
    capacity: 257,
    maximumPerTick: 3,
    dropped: 2,
    emitted: { footsteps: 12, fireballImpacts: 4 },
    heard: { footsteps: 5, fireballImpacts: 3 },
  });
  assert.deepEqual(report.trueSight.maxima, {
    rays: 96,
    polygonVertices: 18,
    visibleWalls: 12,
    maskWidth: 192,
    maskHeight: 192,
  });
  assert.equal(report.timings.trueSightCpuMs.p99, 1.1);
  assert.deepEqual(report.gpuRenderMs, {
    sampleCount: 4,
    samples: [3, 1, 2, 4],
    p50: 2,
    p95: 4,
    p99: 4,
    max: 4,
  });
  assert.equal(report.timings.frameMs.p95, 18);
  assert.deepEqual(report.spikes, [{ tick: 1, totalMs: 35 }]);
  assert.equal(capture.latestReport, report);
  assert.equal(capture.active, false);
});

test("unsupported GPU timers produce null without ending a timer session", async () => {
  let ended = false;
  const capture = new PerformanceCapture({
    durationMs: 1,
    wait: async () => {},
    resetMetrics: () => {},
    runtimeMetrics: runtime,
    presentationDiagnostics: () => diagnostics({ activeBackend: "canvas2d" }),
    deviceFacts: () => ({}),
    beginGpuCapture: () => false,
    endGpuCapture: () => {
      ended = true;
      return [1];
    },
  });
  const report = await capture.capture();
  assert.equal(ended, false);
  assert.equal(report.gpuRenderMs, null);
  assert.equal(summarizeGpuSamples([]), null);
});

test("capture cleanup allows a later independent capture", async () => {
  let resets = 0;
  const capture = new PerformanceCapture({
    durationMs: 1,
    wait: async () => {},
    resetMetrics: () => {
      resets += 1;
    },
    runtimeMetrics: runtime,
    presentationDiagnostics: diagnostics,
    deviceFacts: () => ({}),
  });
  await capture.capture();
  await capture.capture();
  assert.equal(resets, 2);
});

test("a failed wait still stops GPU timestamp collection and clears lifecycle state", async () => {
  let stops = 0;
  const capture = new PerformanceCapture({
    durationMs: 1,
    wait: async () => {
      throw new Error("interrupted");
    },
    resetMetrics: () => {},
    runtimeMetrics: runtime,
    presentationDiagnostics: diagnostics,
    deviceFacts: () => ({}),
    beginGpuCapture: () => true,
    endGpuCapture: () => {
      stops += 1;
      return [];
    },
  });
  await assert.rejects(capture.capture(), /interrupted/);
  assert.equal(stops, 1);
  assert.equal(capture.active, false);
  assert.equal(capture.capturePromise, null);
});
