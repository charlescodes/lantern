// @ts-check

import { RingBuffer } from "../core/ring_buffer.js";
import {
  CachedTimingSamples,
  PERFORMANCE_SAMPLE_CAPACITY,
} from "../core/performance.js";

export const PRESENTATION_SPIKE_CAPACITY = 16;
export const PRESENTATION_SPIKE_THRESHOLD_MS = 32;

const PHASE_NAMES = Object.freeze([
  "updateMs",
  "lightsMs",
  "submitMs",
  "totalMs",
]);

/** @param {{updateMs:number,lightsMs:number,submitMs:number}} sample */
function dominantPhase(sample) {
  let dominant = "updateMs";
  for (const phase of ["lightsMs", "submitMs"]) {
    if (sample[phase] > sample[dominant]) dominant = phase;
  }
  return dominant;
}

export class PresentationProfiler {
  /**
   * @param {{sampleCapacity?:number,spikeCapacity?:number,spikeThresholdMs?:number,summaryRefreshInterval?:number}} [options]
   */
  constructor(options = {}) {
    const timingOptions = {
      capacity: options.sampleCapacity ?? PERFORMANCE_SAMPLE_CAPACITY,
      summaryRefreshInterval: options.summaryRefreshInterval,
    };
    this.phases = Object.fromEntries(
      PHASE_NAMES.map((name) => [name, new CachedTimingSamples(timingOptions)]),
    );
    this.spikes = new RingBuffer(
      options.spikeCapacity ?? PRESENTATION_SPIKE_CAPACITY,
    );
    this.spikeThresholdMs = Math.max(
      0,
      options.spikeThresholdMs ?? PRESENTATION_SPIKE_THRESHOLD_MS,
    );
    this.previousCounts = null;
  }

  /**
   * Establishes the transition baseline without adding a timing sample.
   * @param {{projectileCount:number,particleCount:number,activeLightCount:number}} counts
   */
  prime(counts) {
    this.previousCounts = {
      projectileCount: Math.max(0, Math.trunc(counts.projectileCount)),
      particleCount: Math.max(0, Math.trunc(counts.particleCount)),
      activeLightCount: Math.max(0, Math.trunc(counts.activeLightCount)),
    };
  }

  /**
   * @param {{tick:number,projectileCount:number,particleCount:number,activeLightCount:number,updateMs:number,lightsMs:number,submitMs:number,totalMs:number}} sample
   */
  record(sample) {
    for (const phase of PHASE_NAMES) this.phases[phase].push(sample[phase]);

    const currentCounts = {
      projectileCount: Math.max(0, Math.trunc(sample.projectileCount)),
      particleCount: Math.max(0, Math.trunc(sample.particleCount)),
      activeLightCount: Math.max(0, Math.trunc(sample.activeLightCount)),
    };
    const previousCounts = this.previousCounts ?? currentCounts;
    if (sample.totalMs >= this.spikeThresholdMs) {
      this.spikes.push(Object.freeze({
        tick: Math.max(0, Math.trunc(sample.tick)),
        projectileCountTransition: Object.freeze({
          from: previousCounts.projectileCount,
          to: currentCounts.projectileCount,
        }),
        particleCountTransition: Object.freeze({
          from: previousCounts.particleCount,
          to: currentCounts.particleCount,
        }),
        activeLightCountTransition: Object.freeze({
          from: previousCounts.activeLightCount,
          to: currentCounts.activeLightCount,
        }),
        updateMs: sample.updateMs,
        lightsMs: sample.lightsMs,
        submitMs: sample.submitMs,
        totalMs: sample.totalMs,
        dominantPhase: dominantPhase(sample),
      }));
    }
    this.previousCounts = currentCounts;
  }

  summary() {
    return Object.fromEntries(
      PHASE_NAMES.map((name) => [name, this.phases[name].summary()]),
    );
  }

  recentSpikes() {
    return this.spikes.toArray();
  }

  reset() {
    for (const phase of PHASE_NAMES) this.phases[phase].clear();
    this.spikes.clear();
  }
}
