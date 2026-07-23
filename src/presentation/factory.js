// @ts-check

import { Camera2D } from "../browser/camera.js";
import { Camera3D } from "./camera_3d.js";
import { CanvasPresentation } from "./canvas_presentation.js";

/**
 * Selects the presentation before either implementation requests a canvas context.
 * @param {HTMLCanvasElement} canvas
 * @param {ReturnType<import('./options.js').parsePresentationOptions>} options
 * @param {ReturnType<import('../sim/simulation.js').Simulation['snapshot']>} initialSnapshot
 * @param {import('./options.js').PresentationFlags} flags
 */
export async function createPresentation(canvas, options, initialSnapshot, flags) {
  if (options.renderer === "3d") {
    const warmupStartedAt = performance.now();
    const { ThreePresentation } = await import("./three_presentation.js");
    const camera = new Camera3D();
    const presentation = new ThreePresentation(
      canvas,
      camera,
      options,
      warmupStartedAt,
      flags,
    );
    await presentation.initialize(initialSnapshot);
    return { camera, presentation };
  }
  const camera = new Camera2D();
  return {
    camera,
    presentation: new CanvasPresentation(
      canvas,
      camera,
      initialSnapshot,
      options,
      flags,
    ),
  };
}
