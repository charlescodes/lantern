// @ts-check

import { createPresentation } from "../../src/presentation/factory.js";
import {
  parsePresentationOptions,
  PresentationFlags,
} from "../../src/presentation/options.js";
import { TrueSightSystem } from "../../src/visibility/true_sight.js";
import {
  createPerceptionStressSimulation,
  PERCEPTION_STRESS_CASTERS,
  PERCEPTION_STRESS_MOBS,
} from "../support/perception_stress_fixture.js";

function percentile(values, fraction) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * fraction) - 1] ?? 0;
}

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

/**
 * Browser-only production-path harness. It deliberately returns local results
 * instead of registering a gameplay command or a window mutation surface.
 * @param {{canvas:HTMLCanvasElement,search?:string,frames?:number}} options
 */
export async function runPerceptionStressHarness(options) {
  const simulation = createPerceptionStressSimulation(0x0800_ba5e);
  const presentationOptions = parsePresentationOptions(
    options.search ?? globalThis.location?.search ?? "",
  );
  const flags = new PresentationFlags(presentationOptions);
  const trueSight = new TrueSightSystem({ flags });
  let snapshot = simulation.snapshot();
  let sightFrame = trueSight.update(snapshot, 0, { mode: "play", deltaMs: 0 });
  const { camera, presentation } = await createPresentation(
    options.canvas,
    presentationOptions,
    snapshot,
    flags,
    sightFrame,
  );
  camera.focus(simulation.player.x, simulation.player.z);
  presentation.resetPerformanceMetrics();
  const simulationMs = [];
  const frameGaps = [];
  let previousFrame = performance.now();
  const frames = Math.max(1, Math.trunc(options.frames ?? 600));
  for (let frame = 0; frame < frames; frame += 1) {
    await nextFrame();
    const now = performance.now();
    frameGaps.push(now - previousFrame);
    previousFrame = now;
    simulation.player.maximumHealth = 10_000;
    simulation.player.health = 10_000;
    const started = performance.now();
    simulation.tick(null);
    simulationMs.push(performance.now() - started);
    snapshot = simulation.snapshot();
    sightFrame = trueSight.update(snapshot, 0, { mode: "play" });
    presentation.render(snapshot, 0, {
      mouseWorld: { x: simulation.player.x, z: simulation.player.z },
      mouseInside: false,
      hover: null,
      selected: null,
      mode: "play",
      editorTool: "wall",
      placementValid: true,
      sightFrame,
    });
  }
  const gaps = frameGaps.slice(30);
  const medianGap = percentile(gaps, 0.5);
  return {
    renderer: presentation.diagnostics().activeBackend,
    frames,
    fixture: {
      livingMobs: PERCEPTION_STRESS_MOBS,
      engagedCasters: PERCEPTION_STRESS_CASTERS,
      occludedGuardsAndSearchers: PERCEPTION_STRESS_MOBS - PERCEPTION_STRESS_CASTERS,
    },
    simulationP99Ms: percentile(simulationMs.slice(30), 0.99),
    presentationP99Ms: presentation.diagnostics().presentationCpuMs.total.p99,
    medianFps: medianGap > 0 ? 1_000 / medianGap : 0,
    frameP95Ms: percentile(gaps, 0.95),
    presentation: presentation.diagnostics(),
  };
}
