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
    this.dwellTicks = new Uint16Array(capacity);
    this.dwellRemaining = new Uint16Array(capacity);
    this.currentStop = new Uint8Array(capacity);
    this.requestedStop = new Uint8Array(capacity);
    this.motion = new Uint8Array(capacity);
    this.activationPolicy = new Uint8Array(capacity);
    this.activatorCount = new Uint16Array(capacity);
    this.supportedBodyCount = new Uint16Array(capacity);
    this.rejectedLoadCount = new Uint32Array(capacity);
    this.failedEjectionCount = new Uint32Array(capacity);
  }

  reset() {
    this.activeCount = 0;
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
    this.speed[index] = Number(value.travelSpeed);
    this.dwellTicks[index] = Number(value.dwellTicks);
    this.dwellRemaining[index] = Number(value.dwellTicks);
    this.currentStop[index] = initialStop;
    this.requestedStop[index] = initialStop;
    this.motion[index] = ELEVATOR_MOTION.DWELLING;
    this.activationPolicy[index] = Number(value.activationPolicy ?? 0);
    this.activatorCount[index] = 0;
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
   * Advances every unstoppable platform exactly once. Occupancy requests are
   * supplied separately by the support system and never alter travel speed.
   * @param {number} dt
   */
  step(dt) {
    for (let index = 0; index < this.activeCount; index += 1) {
      this.previousWorldY[index] = this.worldY[index];
      if (this.motion[index] === ELEVATOR_MOTION.DWELLING) {
        this.velocityY[index] = 0;
        if (this.dwellRemaining[index] > 0) {
          this.dwellRemaining[index] -= 1;
          continue;
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
    this.requestedStop[index] = stop;
    return true;
  }

  /** @param {number} index */
  cycle(index) {
    if (index < 0 || index >= this.activeCount) return false;
    this.requestedStop[index] = this.requestedStop[index] === ELEVATOR_STOP.LOWER
      ? ELEVATOR_STOP.UPPER
      : ELEVATOR_STOP.LOWER;
    this.dwellRemaining[index] = 0;
    return true;
  }
}
