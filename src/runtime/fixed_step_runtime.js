// @ts-check

import { HISTORY, SIMULATION } from "../config.js";
import { NumericRingBuffer, percentile } from "../core/ring_buffer.js";
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
    this.simSamples = new NumericRingBuffer(HISTORY.metrics);
    this.renderSamples = new NumericRingBuffer(HISTORY.metrics);
    this.frameSamples = new NumericRingBuffer(HISTORY.metrics);
    this.accumulator = 0;
    this.lastFrameTime = null;
    this.paused = false;
    this.running = false;
    this.frameCount = 0;
    this.lastSnapshot = this.simulation.snapshot();
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

  #consumeCommand() {
    const base = canonicalizeCommand(this.commandProvider());
    for (let drained = 0; drained < 64; drained += 1) {
      const injected = this.pendingCommands.shift();
      if (!injected) break;
      if (injected.move) base.move = injected.move;
      if (injected.cast) base.cast = injected.cast;
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
    const elapsed = Math.max(0, Math.min(SIMULATION.maxFrameSeconds, (now - this.lastFrameTime) / 1_000));
    this.lastFrameTime = now;
    if (elapsed > 0) this.frameSamples.push(elapsed * 1_000);

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
    this.lastSnapshot = this.simulation.snapshot();
    const started = performance.now();
    try {
      this.render(this.lastSnapshot, alpha, this.metrics());
    } catch (error) {
      this.pause();
      this.onError(error);
    }
    this.renderSamples.push(performance.now() - started);
  }

  metrics() {
    const sim = this.simSamples.toSortedArray();
    const render = this.renderSamples.toSortedArray();
    const frames = this.frameSamples.toSortedArray();
    const medianFrame = percentile(frames, 0.5);
    return {
      schemaVersion: 1,
      paused: this.paused,
      accumulator: this.accumulator,
      alpha: this.paused ? 0 : this.accumulator / SIMULATION.dt,
      fps: medianFrame > 0 ? 1_000 / medianFrame : 0,
      frameCount: this.frameCount,
      tick: this.simulation.tickCount,
      queuedCommands: this.pendingCommands.length,
      droppedCommands: this.pendingCommands.dropped,
      simMs: {
        p50: percentile(sim, 0.5),
        p95: percentile(sim, 0.95),
        p99: percentile(sim, 0.99),
      },
      renderMs: {
        p50: percentile(render, 0.5),
        p95: percentile(render, 0.95),
        p99: percentile(render, 0.99),
      },
    };
  }
}
