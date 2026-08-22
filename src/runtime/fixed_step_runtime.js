// @ts-check

import { HISTORY, SCHEMA_VERSION, SIMULATION } from "../config.js";
import { CachedTimingSamples } from "../core/performance.js";
import { canonicalizeCommand } from "../sim/simulation.js";

class CommandQueue {
  /** @param {number} capacity */
  constructor(capacity) {
    this.capacity = capacity;
    this.values = new Array(capacity);
    this.head = 0;
    this.length = 0;
    this.dropped = 0;
  }

  /** @param {unknown} command */
  push(command) {
    if (this.length >= this.capacity) {
      this.dropped += 1;
      return false;
    }
    this.values[(this.head + this.length) % this.capacity] = canonicalizeCommand(command);
    this.length += 1;
    return true;
  }

  shift() {
    if (this.length === 0) return null;
    const value = this.values[this.head];
    this.values[this.head] = undefined;
    this.head = (this.head + 1) % this.capacity;
    this.length -= 1;
    return value;
  }
}

export class FixedStepRuntime {
  /**
   * @param {{
   * simulation: import('../sim/simulation.js').Simulation,
   * commandProvider?:()=>unknown,
   * render?:(snapshot:ReturnType<import('../sim/simulation.js').Simulation['snapshot']>,alpha:number,metrics:ReturnType<FixedStepRuntime['metrics']>)=>void,
   * onError?:(error:unknown)=>void
   * }} options
   */
  constructor(options) {
    this.simulation = options.simulation;
    this.commandProvider = options.commandProvider ?? (() => null);
    this.render = options.render ?? (() => {});
    this.onError = options.onError ?? ((error) => console.error(error));
    this.pendingCommands = new CommandQueue(2_048);
    const timingOptions = { capacity: HISTORY.metrics };
    this.simSamples = new CachedTimingSamples(timingOptions);
    this.snapshotSamples = new CachedTimingSamples(timingOptions);
    this.renderSamples = new CachedTimingSamples(timingOptions);
    this.frameSamples = new CachedTimingSamples(timingOptions);
    this.accumulator = 0;
    this.lastFrameTime = null;
    this.paused = false;
    this.running = false;
    this.frameCount = 0;
    this.clampedFrameCount = 0;
    this.droppedWallTimeMs = 0;
    this.lastSnapshot = this.#takeSnapshot();
    this.animationFrame = 0;
    this._frame = (now) => this.#frame(now);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.lastFrameTime = null;
    this.animationFrame = requestAnimationFrame(this._frame);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.animationFrame);
  }

  pause() {
    this.paused = true;
    this.accumulator = 0;
  }

  resume() {
    this.paused = false;
    this.accumulator = 0;
    this.lastFrameTime = null;
  }

  togglePause() {
    if (this.paused) this.resume();
    else this.pause();
    return this.paused;
  }

  /** @param {number} [count] */
  step(count = 1) {
    const steps = Math.max(1, Math.min(10_000, Math.trunc(count)));
    for (let index = 0; index < steps; index += 1) this.#runTick();
    this.accumulator = 0;
    this.#publish(0);
    return this.lastSnapshot;
  }

  /** @param {unknown} command */
  injectCommand(command) {
    return this.pendingCommands.push(command);
  }

  /** @param {unknown} seed */
  reset(seed) {
    this.injectCommand({ type: "reset", seed });
    if (this.paused) this.step(1);
  }

  resetPerformanceMetrics() {
    this.simSamples.clear();
    this.snapshotSamples.clear();
    this.renderSamples.clear();
    this.frameSamples.clear();
    this.clampedFrameCount = 0;
    this.droppedWallTimeMs = 0;
  }

  #consumeCommand() {
    const base = canonicalizeCommand(this.commandProvider());
    for (let drained = 0; drained < 64; drained += 1) {
      const injected = this.pendingCommands.shift();
      if (!injected) break;
      if (injected.move) base.move = injected.move;
      if (injected.cast) base.cast = injected.cast;
      base.jump ||= injected.jump === true;
      base.actions.push(...injected.actions);
    }
    return base;
  }

  #runTick() {
    const started = performance.now();
    try {
      this.simulation.tick(this.#consumeCommand());
    } catch (error) {
      this.pause();
      this.onError(error);
    }
    this.simSamples.push(performance.now() - started);
  }

  /** @param {number} now */
  #frame(now) {
    if (!this.running) return;
    if (this.lastFrameTime === null) this.lastFrameTime = now;
    const rawElapsedMs = Math.max(0, now - this.lastFrameTime);
    this.lastFrameTime = now;
    if (rawElapsedMs > 0) this.frameSamples.push(rawElapsedMs);
    const maximumFrameMs = SIMULATION.maxFrameSeconds * 1_000;
    if (rawElapsedMs > maximumFrameMs) {
      this.clampedFrameCount += 1;
      this.droppedWallTimeMs += rawElapsedMs - maximumFrameMs;
    }
    const elapsed = Math.min(maximumFrameMs, rawElapsedMs) / 1_000;

    if (!this.paused) {
      this.accumulator += elapsed;
      while (this.accumulator >= SIMULATION.dt) {
        this.#runTick();
        this.accumulator -= SIMULATION.dt;
      }
    }

    this.#publish(this.paused ? 0 : this.accumulator / SIMULATION.dt);
    this.frameCount += 1;
    this.animationFrame = requestAnimationFrame(this._frame);
  }

  /** @param {number} alpha */
  #publish(alpha) {
    this.lastSnapshot = this.#takeSnapshot();
    const started = performance.now();
    try {
      this.render(this.lastSnapshot, alpha, this.metrics());
    } catch (error) {
      this.pause();
      this.onError(error);
    }
    this.renderSamples.push(performance.now() - started);
  }

  #takeSnapshot() {
    const started = performance.now();
    const snapshot = this.simulation.snapshot();
    this.snapshotSamples.push(performance.now() - started);
    return snapshot;
  }

  metrics() {
    const frameMs = this.frameSamples.summary();
    const medianFrame = frameMs.p50;
    return {
      schemaVersion: SCHEMA_VERSION,
      paused: this.paused,
      accumulator: this.accumulator,
      alpha: this.paused ? 0 : this.accumulator / SIMULATION.dt,
      fps: medianFrame > 0 ? 1_000 / medianFrame : 0,
      frameCount: this.frameCount,
      frameMs,
      clampedFrameCount: this.clampedFrameCount,
      droppedWallTimeMs: this.droppedWallTimeMs,
      tick: this.simulation.tickCount,
      queuedCommands: this.pendingCommands.length,
      droppedCommands: this.pendingCommands.dropped,
      simMs: this.simSamples.percentiles(),
      snapshotMs: this.snapshotSamples.percentiles(),
      renderMs: this.renderSamples.percentiles(),
    };
  }
}
