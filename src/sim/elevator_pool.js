// @ts-check

export const ELEVATOR_MOTION = Object.freeze({
  DWELLING: 0,
  ASCENDING: 1,
  DESCENDING: 2,
});

export const ELEVATOR_MOTION_NAMES = Object.freeze([
  "dwelling",
  "ascending",
  "descending",
]);

export const ELEVATOR_STOP = Object.freeze({
  LOWER: 0,
  UPPER: 1,
});

export const ELEVATOR_STOP_NAMES = Object.freeze(["lower", "upper"]);

export class ElevatorPool {
  /** @param {number} capacity */
  constructor(capacity) {
    this.capacity = capacity;
    this.activeCount = 0;
    this.id = new Uint32Array(capacity);
    this.authoringId = new Array(capacity).fill(null);
    this.lowerLayerIndex = new Uint16Array(capacity);
    this.upperLayerIndex = new Uint16Array(capacity);
    this.x = new Float32Array(capacity);
    this.z = new Float32Array(capacity);
    this.platformWidth = new Float32Array(capacity);
    this.apertureWidth = new Float32Array(capacity);
    this.lowerY = new Float32Array(capacity);
    this.upperY = new Float32Array(capacity);
    this.worldY = new Float32Array(capacity);
    this.previousWorldY = new Float32Array(capacity);
    this.velocityY = new Float32Array(capacity);
    this.speed = new Float32Array(capacity);
    this.travelDurationSeconds = new Float32Array(capacity);
    this.dwellTicks = new Uint16Array(capacity);
    this.dwellRemaining = new Uint16Array(capacity);
    this.currentStop = new Uint8Array(capacity);
    this.requestedStop = new Uint8Array(capacity);
    this.debugRequestedStop = new Uint8Array(capacity);
    this.hasDebugRequest = new Uint8Array(capacity);
    this.motion = new Uint8Array(capacity);
    this.supportedBodyCount = new Uint16Array(capacity);
    this.rejectedLoadCount = new Uint32Array(capacity);
    this.failedEjectionCount = new Uint32Array(capacity);
  }

  reset() {
    this.activeCount = 0;
  }

  /** Removes one elevator while retaining dense bounded storage. @param {number} index */
  removeSwap(index) {
    if (index < 0 || index >= this.activeCount) return false;
    const last = this.activeCount - 1;
    if (index !== last) {
      for (const field of [
        "id", "lowerLayerIndex", "upperLayerIndex", "x", "z", "platformWidth",
        "apertureWidth", "lowerY", "upperY", "worldY", "previousWorldY", "velocityY",
        "speed", "travelDurationSeconds", "dwellTicks", "dwellRemaining", "currentStop",
        "requestedStop", "debugRequestedStop", "hasDebugRequest", "motion",
        "supportedBodyCount", "rejectedLoadCount", "failedEjectionCount",
      ]) this[field][index] = this[field][last];
      this.authoringId[index] = this.authoringId[last];
    }
    this.authoringId[last] = null;
    this.activeCount = last;
    return true;
  }

  /** @param {Record<string, any>} value */
  spawn(value) {
    if (this.activeCount >= this.capacity) return 0;
    const index = this.activeCount;
    const id = Number(value.id) >>> 0 || index + 1;
    const initialStop = value.initialStop === "upper"
      ? ELEVATOR_STOP.UPPER
      : ELEVATOR_STOP.LOWER;
    const initialY = initialStop === ELEVATOR_STOP.UPPER
      ? Number(value.upperY)
      : Number(value.lowerY);
    this.id[index] = id;
    this.authoringId[index] = String(value.authoringId);
    this.lowerLayerIndex[index] = Number(value.lowerLayerIndex);
    this.upperLayerIndex[index] = Number(value.upperLayerIndex);
    this.x[index] = Number(value.x);
    this.z[index] = Number(value.z);
    this.platformWidth[index] = Number(value.platformWidth);
    this.apertureWidth[index] = Number(value.apertureWidth);
    this.lowerY[index] = Number(value.lowerY);
    this.upperY[index] = Number(value.upperY);
    this.worldY[index] = initialY;
    this.previousWorldY[index] = initialY;
    this.velocityY[index] = 0;
    this.travelDurationSeconds[index] = Number(value.travelDurationSeconds);
    this.speed[index] = Math.abs(Number(value.upperY) - Number(value.lowerY))
      / this.travelDurationSeconds[index];
    this.dwellTicks[index] = Number(value.dwellTicks);
    this.dwellRemaining[index] = Number(value.dwellTicks);
    this.currentStop[index] = initialStop;
    this.requestedStop[index] = initialStop;
    this.debugRequestedStop[index] = initialStop;
    this.hasDebugRequest[index] = 0;
    this.motion[index] = ELEVATOR_MOTION.DWELLING;
    this.supportedBodyCount[index] = 0;
    this.rejectedLoadCount[index] = 0;
    this.failedEjectionCount[index] = 0;
    this.activeCount += 1;
    return id;
  }

  /** @param {number} id */
  findIndexById(id) {
    for (let index = 0; index < this.activeCount; index += 1) {
      if (this.id[index] === id) return index;
    }
    return -1;
  }

  /** @param {string} authoringId */
  findIndexByAuthoringId(authoringId) {
    for (let index = 0; index < this.activeCount; index += 1) {
      if (this.authoringId[index] === authoringId) return index;
    }
    return -1;
  }

  /**
   * Advances every unstoppable platform exactly once. Every elevator follows
   * its own authored clock; supported bodies never influence this schedule.
   * @param {number} dt
   */
  step(dt) {
    for (let index = 0; index < this.activeCount; index += 1) {
      this.previousWorldY[index] = this.worldY[index];
      if (this.motion[index] === ELEVATOR_MOTION.DWELLING) {
        this.velocityY[index] = 0;
        if (this.dwellRemaining[index] > 0) {
          this.dwellRemaining[index] -= 1;
          if (this.dwellRemaining[index] > 0) continue;
        }
        if (this.hasDebugRequest[index]) {
          this.requestedStop[index] = this.debugRequestedStop[index];
          this.hasDebugRequest[index] = 0;
        } else {
          this.requestedStop[index] = this.currentStop[index] === ELEVATOR_STOP.LOWER
            ? ELEVATOR_STOP.UPPER
            : ELEVATOR_STOP.LOWER;
        }
        if (this.requestedStop[index] === this.currentStop[index]) continue;
        this.motion[index] = this.requestedStop[index] === ELEVATOR_STOP.UPPER
          ? ELEVATOR_MOTION.ASCENDING
          : ELEVATOR_MOTION.DESCENDING;
      }
      const target = this.requestedStop[index] === ELEVATOR_STOP.UPPER
        ? this.upperY[index]
        : this.lowerY[index];
      const direction = target >= this.worldY[index] ? 1 : -1;
      const delta = direction * this.speed[index] * dt;
      const next = direction > 0
        ? Math.min(target, this.worldY[index] + delta)
        : Math.max(target, this.worldY[index] + delta);
      this.worldY[index] = next;
      this.velocityY[index] = (next - this.previousWorldY[index]) / dt;
      if (next !== target) continue;
      this.currentStop[index] = this.requestedStop[index];
      this.motion[index] = ELEVATOR_MOTION.DWELLING;
      this.dwellRemaining[index] = this.dwellTicks[index];
    }
  }

  /** @param {number} index @param {number} stop */
  request(index, stop) {
    if (index < 0 || index >= this.activeCount) return false;
    if (stop !== ELEVATOR_STOP.LOWER && stop !== ELEVATOR_STOP.UPPER) return false;
    if (this.motion[index] === ELEVATOR_MOTION.DWELLING) {
      this.debugRequestedStop[index] = stop;
      this.hasDebugRequest[index] = 1;
      this.dwellRemaining[index] = 0;
    } else if (stop !== this.requestedStop[index]) {
      // Diagnostic requests never reverse an in-flight unstoppable platform.
      this.debugRequestedStop[index] = stop;
      this.hasDebugRequest[index] = 1;
    }
    return true;
  }

  /** @param {number} index */
  cycle(index) {
    if (index < 0 || index >= this.activeCount) return false;
    if (this.motion[index] === ELEVATOR_MOTION.DWELLING) this.dwellRemaining[index] = 0;
    else this.request(index, this.requestedStop[index] === ELEVATOR_STOP.LOWER
      ? ELEVATOR_STOP.UPPER
      : ELEVATOR_STOP.LOWER);
    return true;
  }
}
