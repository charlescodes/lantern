// @ts-check

export const DEAD_BODY_SETTLE_REASON = Object.freeze({
  none: 0,
  quiet: 1,
  timeout: 2,
  capacity: 3,
});

export const DEAD_BODY_SETTLE_REASON_NAMES = Object.freeze([
  null,
  "quiet",
  "timeout",
  "capacity",
]);

export class DynamicDeadBodyPool {
  /** @param {number} capacity */
  constructor(capacity) {
    this.capacity = capacity;
    this.activeCount = 0;
    this.forcedSettles = 0;
    this.quietSettles = 0;
    this.timeoutSettles = 0;
    this.speedClamped = 0;
    this.id = new Uint32Array(capacity);
    this.spawnSequence = new Uint32Array(capacity);
    this.deathTick = new Uint32Array(capacity);
    this.x = new Float32Array(capacity);
    this.z = new Float32Array(capacity);
    this.previousX = new Float32Array(capacity);
    this.previousZ = new Float32Array(capacity);
    this.vx = new Float32Array(capacity);
    this.vz = new Float32Array(capacity);
    this.facingX = new Float32Array(capacity);
    this.facingZ = new Float32Array(capacity);
    this.radius = new Float32Array(capacity);
    this.massKg = new Float32Array(capacity);
    this.inverseMass = new Float32Array(capacity);
    this.quietTickCount = new Uint16Array(capacity);
    this.touched = new Uint8Array(capacity);
  }

  reset() {
    this.activeCount = 0;
    this.forcedSettles = 0;
    this.quietSettles = 0;
    this.timeoutSettles = 0;
    this.speedClamped = 0;
  }

  /** @param {{id:number,spawnSequence:number,deathTick:number,x:number,z:number,vx:number,vz:number,facingX:number,facingZ:number,radius:number,massKg:number}} value */
  spawn(value) {
    if (this.activeCount >= this.capacity) return -1;
    const index = this.activeCount;
    const facingLength = Math.hypot(value.facingX, value.facingZ);
    this.id[index] = value.id;
    this.spawnSequence[index] = value.spawnSequence;
    this.deathTick[index] = value.deathTick;
    this.x[index] = value.x;
    this.z[index] = value.z;
    this.previousX[index] = value.x;
    this.previousZ[index] = value.z;
    this.vx[index] = value.vx;
    this.vz[index] = value.vz;
    this.facingX[index] = facingLength > 1e-9 ? value.facingX / facingLength : 1;
    this.facingZ[index] = facingLength > 1e-9 ? value.facingZ / facingLength : 0;
    this.radius[index] = value.radius;
    this.massKg[index] = value.massKg;
    this.inverseMass[index] = 1 / value.massKg;
    this.quietTickCount[index] = 0;
    this.touched[index] = 0;
    this.activeCount += 1;
    return index;
  }

  /** @param {number} index */
  removeSwap(index) {
    if (index < 0 || index >= this.activeCount) return false;
    const last = this.activeCount - 1;
    if (index !== last) {
      for (const component of [
        this.id,
        this.spawnSequence,
        this.deathTick,
        this.x,
        this.z,
        this.previousX,
        this.previousZ,
        this.vx,
        this.vz,
        this.facingX,
        this.facingZ,
        this.radius,
        this.massKg,
        this.inverseMass,
        this.quietTickCount,
        this.touched,
      ]) {
        component[index] = component[last];
      }
    }
    this.activeCount = last;
    return true;
  }

  oldestIndex() {
    if (this.activeCount === 0) return -1;
    let oldest = 0;
    for (let index = 1; index < this.activeCount; index += 1) {
      if (
        this.deathTick[index] < this.deathTick[oldest]
        || (
          this.deathTick[index] === this.deathTick[oldest]
          && this.id[index] < this.id[oldest]
        )
      ) {
        oldest = index;
      }
    }
    return oldest;
  }
}

export class InertDeadBodyRing {
  /** @param {number} capacity */
  constructor(capacity) {
    this.capacity = capacity;
    this.start = 0;
    this.length = 0;
    this.overwritten = 0;
    this.id = new Uint32Array(capacity);
    this.spawnSequence = new Uint32Array(capacity);
    this.deathTick = new Uint32Array(capacity);
    this.settledTick = new Uint32Array(capacity);
    this.x = new Float32Array(capacity);
    this.z = new Float32Array(capacity);
    this.facingX = new Float32Array(capacity);
    this.facingZ = new Float32Array(capacity);
    this.radius = new Float32Array(capacity);
    this.massKg = new Float32Array(capacity);
    this.settleReason = new Uint8Array(capacity);
  }

  reset() {
    this.start = 0;
    this.length = 0;
    this.overwritten = 0;
  }

  /** @param {{id:number,spawnSequence:number,deathTick:number,settledTick:number,x:number,z:number,facingX:number,facingZ:number,radius:number,massKg:number,settleReason:number}} value */
  push(value) {
    const index = (this.start + this.length) % this.capacity;
    this.id[index] = value.id;
    this.spawnSequence[index] = value.spawnSequence;
    this.deathTick[index] = value.deathTick;
    this.settledTick[index] = value.settledTick;
    this.x[index] = value.x;
    this.z[index] = value.z;
    this.facingX[index] = value.facingX;
    this.facingZ[index] = value.facingZ;
    this.radius[index] = value.radius;
    this.massKg[index] = value.massKg;
    this.settleReason[index] = value.settleReason;
    if (this.length < this.capacity) {
      this.length += 1;
      return false;
    }
    this.start = (this.start + 1) % this.capacity;
    this.overwritten += 1;
    return true;
  }

  /** @param {number} ordinal */
  storageIndex(ordinal) {
    return (this.start + ordinal) % this.capacity;
  }
}
