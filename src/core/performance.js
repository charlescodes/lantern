// @ts-check

import { NumericRingBuffer, percentile } from "./ring_buffer.js";

export const PERFORMANCE_SAMPLE_CAPACITY = 1_024;
const DEFAULT_SUMMARY_REFRESH_INTERVAL = 16;

function emptySummary() {
  return { last: 0, p50: 0, p95: 0, p99: 0, max: 0 };
}

/**
 * A bounded numeric history whose sorted percentile summary is refreshed in
 * batches. Reading the cached summary never sorts the backing history.
 */
export class CachedTimingSamples {
  /**
   * @param {{capacity?:number,summaryRefreshInterval?:number}} [options]
   */
  constructor(options = {}) {
    this.samples = new NumericRingBuffer(
      options.capacity ?? PERFORMANCE_SAMPLE_CAPACITY,
    );
    this.summaryRefreshInterval = Math.max(
      1,
      Math.trunc(
        options.summaryRefreshInterval ?? DEFAULT_SUMMARY_REFRESH_INTERVAL,
      ),
    );
    this.last = 0;
    this.samplesSinceSummary = 0;
    this.cached = emptySummary();
  }

  /** @param {number} value */
  push(value) {
    const sample = Number.isFinite(value) ? Math.max(0, value) : 0;
    this.samples.push(sample);
    this.last = sample;
    this.samplesSinceSummary += 1;
    if (
      this.samples.length === 1
      || this.samplesSinceSummary >= this.summaryRefreshInterval
    ) {
      this.#refresh();
      return;
    }
    this.cached.last = sample;
    this.cached.max = Math.max(this.cached.max, sample);
  }

  clear() {
    this.samples.clear();
    this.last = 0;
    this.samplesSinceSummary = 0;
    this.cached = emptySummary();
  }

  summary() {
    return { ...this.cached, last: this.last };
  }

  percentiles() {
    return {
      p50: this.cached.p50,
      p95: this.cached.p95,
      p99: this.cached.p99,
    };
  }

  #refresh() {
    const sorted = this.samples.toSortedArray();
    this.cached = {
      last: this.last,
      p50: percentile(sorted, 0.5),
      p95: percentile(sorted, 0.95),
      p99: percentile(sorted, 0.99),
      max: sorted.at(-1) ?? 0,
    };
    this.samplesSinceSummary = 0;
  }
}
