// @ts-check

import { percentile } from "../core/ring_buffer.js";
import { APPLICATION_VERSION } from "../config.js";

export const PERFORMANCE_CAPTURE_DURATION_MS = 10_000;
export const PERFORMANCE_REPORT_VERSION = 4;

/** @param {number[]} values */
export function summarizeGpuSamples(values) {
  const samples = values.filter(
    (value) => Number.isFinite(value) && value >= 0,
  );
  if (samples.length === 0) return null;
  const sorted = [...samples].sort((left, right) => left - right);
  return {
    sampleCount: samples.length,
    samples: [...samples],
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
    max: sorted.at(-1) ?? 0,
  };
}

/** @param {Window} browserWindow @param {Navigator} browserNavigator */
export function collectDeviceBrowserFacts(browserWindow, browserNavigator) {
  const connection = "connection" in browserNavigator
    ? /** @type {Record<string,any>} */ (browserNavigator.connection)
    : null;
  return {
    userAgent: browserNavigator.userAgent ?? "",
    platform: browserNavigator.platform ?? "",
    language: browserNavigator.language ?? "",
    hardwareConcurrency: browserNavigator.hardwareConcurrency ?? null,
    deviceMemoryGb: "deviceMemory" in browserNavigator
      ? Number(browserNavigator.deviceMemory)
      : null,
    connection: connection
      ? {
        effectiveType: connection.effectiveType ?? null,
        downlinkMbps: connection.downlink ?? null,
        saveData: connection.saveData ?? null,
      }
      : null,
    viewportCss: {
      width: browserWindow.innerWidth,
      height: browserWindow.innerHeight,
    },
    screenCss: {
      width: browserWindow.screen?.width ?? null,
      height: browserWindow.screen?.height ?? null,
    },
    devicePixelRatio: browserWindow.devicePixelRatio || 1,
    secureContext: browserWindow.isSecureContext === true,
  };
}

/**
 * Owns the ten-second capture lifecycle without issuing gameplay commands.
 * Call observe() from the ordinary render path while a capture is active.
 */
export class PerformanceCapture {
  /**
   * @param {{
   * applicationVersion?:string,
   * durationMs?:number,
   * now?:()=>number,
   * wait?:(durationMs:number)=>Promise<void>,
   * resetMetrics:()=>void,
   * runtimeMetrics:()=>Record<string,any>,
   * presentationDiagnostics:()=>Record<string,any>,
   * deviceFacts:()=>Record<string,any>,
   * beginGpuCapture?:()=>boolean|Promise<boolean>,
   * endGpuCapture?:()=>null|number[]|Promise<null|number[]>
   * }} options
   */
  constructor(options) {
    this.applicationVersion = options.applicationVersion ?? APPLICATION_VERSION;
    this.durationMs = Math.max(
      1,
      Math.trunc(options.durationMs ?? PERFORMANCE_CAPTURE_DURATION_MS),
    );
    this.now = options.now ?? (() => performance.now());
    this.wait = options.wait ?? ((durationMs) => (
      new Promise((resolve) => window.setTimeout(resolve, durationMs))
    ));
    this.resetMetrics = options.resetMetrics;
    this.runtimeMetrics = options.runtimeMetrics;
    this.presentationDiagnostics = options.presentationDiagnostics;
    this.deviceFacts = options.deviceFacts;
    this.beginGpuCapture = options.beginGpuCapture ?? (() => false);
    this.endGpuCapture = options.endGpuCapture ?? (() => null);
    this.active = false;
    this.capturePromise = null;
    this.latestReport = null;
    this.workload = this.#emptyWorkload();
  }

  /** @param {Record<string,any>} snapshot @param {Record<string,any>} runtime @param {Record<string,any>} presentation */
  observe(snapshot, runtime, presentation) {
    if (!this.active) return;
    this.workload.frames += 1;
    this.workload.maxProjectiles = Math.max(
      this.workload.maxProjectiles,
      Number(snapshot.projectiles?.length ?? 0),
    );
    this.workload.maxParticles = Math.max(
      this.workload.maxParticles,
      Number(snapshot.particles?.length ?? 0),
    );
    this.workload.maxRocks = Math.max(
      this.workload.maxRocks,
      Number(snapshot.rocks?.length ?? 0),
    );
    this.workload.maxDynamicDeadBodies = Math.max(
      this.workload.maxDynamicDeadBodies,
      Number(snapshot.deadBodies?.dynamic?.length ?? 0),
    );
    this.workload.maxInertDeadBodies = Math.max(
      this.workload.maxInertDeadBodies,
      Number(snapshot.deadBodies?.inert?.length ?? 0),
    );
    this.workload.deadBodyForcedSettles = Math.max(
      this.workload.deadBodyForcedSettles,
      Number(snapshot.pools?.dynamicDeadBodies?.forcedSettles ?? 0),
    );
    this.workload.deadBodyOverwrites = Math.max(
      this.workload.deadBodyOverwrites,
      Number(snapshot.pools?.inertDeadBodies?.overwritten ?? 0),
    );
    this.workload.dynamicDeadBodyCapacity = Number(
      snapshot.pools?.dynamicDeadBodies?.capacity ?? 0,
    );
    this.workload.inertDeadBodyCapacity = Number(
      snapshot.pools?.inertDeadBodies?.capacity ?? 0,
    );
    this.workload.soundEventCapacity = Number(
      snapshot.pools?.soundEvents?.capacity ?? 0,
    );
    this.workload.maxSoundEventsPerTick = Math.max(
      this.workload.maxSoundEventsPerTick,
      Number(snapshot.soundEventMetrics?.maximumEventsPerTick ?? 0),
    );
    this.workload.soundEventDrops = Math.max(
      this.workload.soundEventDrops,
      Number(snapshot.soundEventMetrics?.queueDropped ?? 0),
    );
    this.workload.footstepsEmitted = Math.max(
      this.workload.footstepsEmitted,
      Number(snapshot.soundEventMetrics?.emittedFootsteps ?? 0),
    );
    this.workload.footstepsHeard = Math.max(
      this.workload.footstepsHeard,
      Number(snapshot.soundEventMetrics?.heardFootsteps ?? 0),
    );
    this.workload.fireballSoundsEmitted = Math.max(
      this.workload.fireballSoundsEmitted,
      Number(snapshot.soundEventMetrics?.emittedFireballImpacts ?? 0),
    );
    this.workload.fireballSoundsHeard = Math.max(
      this.workload.fireballSoundsHeard,
      Number(snapshot.soundEventMetrics?.heardFireballImpacts ?? 0),
    );
    this.workload.maxContacts = Math.max(
      this.workload.maxContacts,
      Number(snapshot.contacts?.length ?? 0),
    );
    this.workload.maxActiveLights = Math.max(
      this.workload.maxActiveLights,
      Number(presentation.activeLightCount ?? 0),
    );
    this.workload.maxResidentLights = Math.max(
      this.workload.maxResidentLights,
      Number(presentation.residentLightCount ?? 0),
    );
    const trueSight = presentation.trueSight ?? {};
    this.workload.maxTrueSightRays = Math.max(
      this.workload.maxTrueSightRays,
      Number(trueSight.rayCount ?? 0),
    );
    this.workload.maxTrueSightPolygonVertices = Math.max(
      this.workload.maxTrueSightPolygonVertices,
      Number(trueSight.polygonVertexCount ?? 0),
    );
    this.workload.maxTrueSightVisibleWalls = Math.max(
      this.workload.maxTrueSightVisibleWalls,
      Number(trueSight.visibleWallCount ?? 0),
    );
    this.workload.maxTrueSightMaskWidth = Math.max(
      this.workload.maxTrueSightMaskWidth,
      Number(trueSight.maskWidth ?? 0),
    );
    this.workload.maxTrueSightMaskHeight = Math.max(
      this.workload.maxTrueSightMaskHeight,
      Number(trueSight.maskHeight ?? 0),
    );
    this.workload.minimumFps = this.workload.frames === 1
      ? Number(runtime.fps ?? 0)
      : Math.min(this.workload.minimumFps, Number(runtime.fps ?? 0));
  }

  capture() {
    if (this.capturePromise) return this.capturePromise;
    this.capturePromise = this.#runCapture().finally(() => {
      this.active = false;
      this.capturePromise = null;
    });
    return this.capturePromise;
  }

  #emptyWorkload() {
    return {
      frames: 0,
      maxProjectiles: 0,
      maxParticles: 0,
      maxRocks: 0,
      maxDynamicDeadBodies: 0,
      maxInertDeadBodies: 0,
      deadBodyForcedSettles: 0,
      deadBodyOverwrites: 0,
      dynamicDeadBodyCapacity: 0,
      inertDeadBodyCapacity: 0,
      soundEventCapacity: 0,
      maxSoundEventsPerTick: 0,
      soundEventDrops: 0,
      footstepsEmitted: 0,
      footstepsHeard: 0,
      fireballSoundsEmitted: 0,
      fireballSoundsHeard: 0,
      maxContacts: 0,
      maxActiveLights: 0,
      maxResidentLights: 0,
      maxTrueSightRays: 0,
      maxTrueSightPolygonVertices: 0,
      maxTrueSightVisibleWalls: 0,
      maxTrueSightMaskWidth: 0,
      maxTrueSightMaskHeight: 0,
      minimumFps: 0,
    };
  }

  async #runCapture() {
    this.workload = this.#emptyWorkload();
    this.resetMetrics();
    const startedAt = this.now();
    this.active = true;
    let gpuTimingEnabled = false;
    let gpuTimingStopped = true;
    try {
      gpuTimingEnabled = await this.beginGpuCapture();
      gpuTimingStopped = !gpuTimingEnabled;
      await this.wait(this.durationMs);
      let gpuSamples = null;
      if (gpuTimingEnabled) {
        try {
          gpuSamples = await this.endGpuCapture();
        } finally {
          gpuTimingStopped = true;
        }
      }
      const finishedAt = this.now();
      const runtime = this.runtimeMetrics();
      const presentation = this.presentationDiagnostics();
      const report = Object.freeze({
        reportVersion: PERFORMANCE_REPORT_VERSION,
        applicationVersion: this.applicationVersion,
        capturedAt: new Date().toISOString(),
        requestedDurationMs: this.durationMs,
        actualDurationMs: Math.max(0, finishedAt - startedAt),
        deviceBrowser: this.deviceFacts(),
        settings: {
          requestedRenderer: presentation.requestedRenderer,
          requestedBackend: presentation.requestedBackend,
          activeBackend: presentation.activeBackend,
          ...presentation.settings,
          ...presentation.flags,
        },
        workloadMaxima: { ...this.workload },
        timings: {
          frameMs: runtime.frameMs,
          simulationMs: runtime.simMs,
          snapshotMs: runtime.snapshotMs,
          rendererCpuMs: runtime.renderMs,
          presentationPhasesMs: presentation.presentationCpuMs,
          trueSightCpuMs: presentation.trueSightCpuMs,
        },
        presentation: {
          warmup: presentation.warmup,
          drawCalls: presentation.drawCalls,
          triangles: presentation.triangles,
          lightGroups: presentation.lightGroups ?? null,
        },
        lights: {
          activeAtEnd: presentation.activeLightCount,
          residentAtEnd: presentation.residentLightCount,
          maximumActive: this.workload.maxActiveLights,
          maximumResident: this.workload.maxResidentLights,
        },
        deadBodies: {
          dynamicCapacity: this.workload.dynamicDeadBodyCapacity,
          inertCapacity: this.workload.inertDeadBodyCapacity,
          maximumDynamic: this.workload.maxDynamicDeadBodies,
          maximumInert: this.workload.maxInertDeadBodies,
          forcedSettles: this.workload.deadBodyForcedSettles,
          overwrites: this.workload.deadBodyOverwrites,
        },
        soundEvents: {
          capacity: this.workload.soundEventCapacity,
          maximumPerTick: this.workload.maxSoundEventsPerTick,
          dropped: this.workload.soundEventDrops,
          emitted: {
            footsteps: this.workload.footstepsEmitted,
            fireballImpacts: this.workload.fireballSoundsEmitted,
          },
          heard: {
            footsteps: this.workload.footstepsHeard,
            fireballImpacts: this.workload.fireballSoundsHeard,
          },
        },
        trueSight: {
          atEnd: presentation.trueSight ?? null,
          maxima: {
            rays: this.workload.maxTrueSightRays,
            polygonVertices: this.workload.maxTrueSightPolygonVertices,
            visibleWalls: this.workload.maxTrueSightVisibleWalls,
            maskWidth: this.workload.maxTrueSightMaskWidth,
            maskHeight: this.workload.maxTrueSightMaskHeight,
          },
        },
        spikes: presentation.recentSpikes ?? [],
        gpuRenderMs: summarizeGpuSamples(gpuSamples ?? []),
      });
      this.latestReport = report;
      return report;
    } finally {
      if (gpuTimingEnabled && !gpuTimingStopped) {
        try {
          await this.endGpuCapture();
        } catch {
          // Capture failure still must leave timestamp queries disabled.
        }
      }
    }
  }
}
