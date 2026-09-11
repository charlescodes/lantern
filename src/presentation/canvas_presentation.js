// @ts-check

import { DebugRenderer } from "../browser/renderer.js";
import {
  DamageNumberOverlay,
  DamageNumberPool,
  projectDamageNumberCanvas,
} from "./damage_numbers.js";
import { KineticFragmentPool } from "./kinetic_fragments.js";
import { parsePresentationOptions, PresentationFlags } from "./options.js";
import { PresentationProfiler } from "./profiler.js";
import { ScorchMarkPool } from "./scorch_marks.js";
import { PresentationWarmupStatus } from "./warmup.js";

export class CanvasPresentation {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {import('../browser/camera.js').Camera2D} camera
   * @param {ReturnType<import('../sim/simulation.js').Simulation['snapshot']>} initialSnapshot
   * @param {ReturnType<import('./options.js').parsePresentationOptions>} [options]
   * @param {PresentationFlags} [flags]
   * @param {HTMLCanvasElement|null} [damageNumberCanvas]
   */
  constructor(
    canvas,
    camera,
    initialSnapshot,
    options = parsePresentationOptions(),
    flags = new PresentationFlags(options),
    damageNumberCanvas = null,
  ) {
    this.renderer = new DebugRenderer(canvas, camera, options.dpr);
    this.flags = flags;
    this.options = options;
    this.profiler = new PresentationProfiler();
    this.scorchMarks = new ScorchMarkPool();
    this.scorchMarks.prime(initialSnapshot);
    this.kineticFragments = new KineticFragmentPool();
    this.kineticFragments.prime(initialSnapshot);
    this.damageNumbers = new DamageNumberPool();
    this.damageNumbers.prime(initialSnapshot);
    this.damageNumberOverlay = new DamageNumberOverlay(damageNumberCanvas);
    this.warmup = new PresentationWarmupStatus(false);
    this.profiler.prime({
      projectileCount: initialSnapshot.projectiles.length,
      particleCount: initialSnapshot.particles.length,
      activeLightCount: 0,
    });
  }

  /** @param {any} snapshot @param {number} alpha @param {any} view */
  render(snapshot, alpha, view) {
    const started = performance.now();
    this.scorchMarks.ingest(snapshot);
    this.kineticFragments.ingest(snapshot);
    if (this.flags.values.damageNumbers) this.damageNumbers.ingest(snapshot);
    this.renderer.render(
      snapshot,
      alpha,
      view,
      this.flags.values.lightColorVariation,
      this.scorchMarks,
      this.kineticFragments,
    );
    if (this.flags.values.damageNumbers) {
      const baseY = Number(snapshot.map?.baseY) || 0;
      this.damageNumberOverlay.render(this.damageNumbers, alpha, {
        layerIndex: Number(snapshot.player?.layerIndex) || 0,
        sightFrame: view.sightFrame ?? null,
        dprCap: this.renderer.pixelDensityCap,
        project: (point) => projectDamageNumberCanvas(this.camera, point, baseY),
      });
    } else {
      this.damageNumberOverlay.clear();
    }
    const finished = performance.now();
    const submitMs = finished - started;
    this.profiler.record({
      tick: snapshot.tick,
      projectileCount: snapshot.projectiles.length,
      particleCount: snapshot.particles.length,
      activeLightCount: 0,
      updateMs: 0,
      lightsMs: 0,
      submitMs,
      totalMs: submitMs,
    });
  }

  /** @param {string} name @param {unknown} value */
  setPresentationFlag(name, value) {
    if (!this.flags.set(name, value)) return false;
    if (name === "damageNumbers" && !this.flags.values.damageNumbers) {
      this.damageNumbers.clearForToggle();
      this.damageNumberOverlay.clear();
    }
    return true;
  }

  /** @param {unknown} value */
  setPixelDensityCap(value) {
    return this.renderer.setPixelDensityCap(Number(value));
  }

  beginGpuTimingCapture() {
    return false;
  }

  async endGpuTimingCapture() {
    return null;
  }

  diagnostics() {
    return {
      requestedRenderer: "2d",
      requestedBackend: "none",
      activeBackend: "canvas2d",
      drawCalls: 0,
      triangles: 0,
      activeLightCount: 0,
      residentLightCount: 0,
      cssResolution: {
        width: this.renderer.width,
        height: this.renderer.height,
      },
      backingResolution: {
        width: this.renderer.canvas.width,
        height: this.renderer.canvas.height,
      },
      effectiveDpr: this.renderer.backingScale,
      gpuTimingAvailable: false,
      gpuRenderMs: null,
      trueSightTransport: null,
      warmup: this.warmup.snapshot(),
      presentationCpuMs: this.profiler.summary(),
      recentSpikes: this.profiler.recentSpikes(),
      flags: this.flags.snapshot(),
      settings: {
        lights: this.options.lights,
        dpr: this.renderer.pixelDensityCap,
        aa: this.options.aa,
      },
      scorchMarks: this.scorchMarks.diagnostics(),
      kineticFragments: this.kineticFragments.diagnostics(),
      damageNumbers: this.damageNumbers.diagnostics(),
    };
  }

  resetPerformanceMetrics() {
    this.profiler.reset();
  }
}
