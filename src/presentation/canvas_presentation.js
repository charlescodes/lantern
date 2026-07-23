// @ts-check

import { DebugRenderer } from "../browser/renderer.js";
import { PresentationFlags } from "./options.js";

export class CanvasPresentation {
  /** @param {HTMLCanvasElement} canvas @param {import('../browser/camera.js').Camera2D} camera */
  constructor(canvas, camera) {
    this.renderer = new DebugRenderer(canvas, camera);
    this.flags = new PresentationFlags();
  }

  /** @param {any} snapshot @param {number} alpha @param {any} view */
  render(snapshot, alpha, view) {
    this.renderer.render(snapshot, alpha, view);
  }

  /** @param {string} name @param {unknown} value */
  setPresentationFlag(name, value) {
    return this.flags.set(name, value);
  }

  diagnostics() {
    return {
      requestedRenderer: "2d",
      requestedBackend: "none",
      activeBackend: "canvas2d",
      drawCalls: 0,
      triangles: 0,
      activeLightCount: 0,
      flags: this.flags.snapshot(),
    };
  }
}
