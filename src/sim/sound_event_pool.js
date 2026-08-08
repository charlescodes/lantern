// @ts-check

export const SOUND_EVENT_KIND = Object.freeze({
  none: 0,
  footstep: 1,
  fireballImpact: 2,
});

export const SOUND_EVENT_KIND_NAMES = Object.freeze([
  "none",
  "footstep",
  "fireball-impact",
]);

export const SOUND_EVENT_REASON = Object.freeze({
  none: 0,
  stride: 1,
  turn: 2,
  impact: 3,
});

export const SOUND_EVENT_REASON_NAMES = Object.freeze([
  "none",
  "stride",
  "turn",
  "impact",
]);

/**
 * One-tick, bounded SoA queue for authoritative sound stimuli. Events are
 * delivered in insertion/ID order and the queue is cleared at the start of
 * the next simulation tick. Longer diagnostic retention lives in a separate
 * ring and cannot affect delivery.
 */
export class SoundEventQueue {
  /** @param {number} capacity */
  constructor(capacity) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new RangeError("Sound-event capacity must be a positive integer");
    }
    this.capacity = capacity;
    this.activeCount = 0;
    this.dropped = 0;
    this.maximumEventsPerTick = 0;
    this.nextId = 1;
    this.id = new Uint32Array(capacity);
    this.tick = new Uint32Array(capacity);
    this.kind = new Uint8Array(capacity);
    this.reason = new Uint8Array(capacity);
    this.sourceKind = new Uint8Array(capacity);
    this.sourceId = new Uint32Array(capacity);
    this.sourceTeam = new Uint8Array(capacity);
    this.x = new Float32Array(capacity);
    this.z = new Float32Array(capacity);
    this.radius = new Float32Array(capacity);
    this.effectId = new Uint32Array(capacity);
    this.projectileId = new Uint32Array(capacity);
  }

  reset() {
    this.activeCount = 0;
    this.dropped = 0;
    this.maximumEventsPerTick = 0;
    this.nextId = 1;
  }

  beginTick() {
    this.activeCount = 0;
  }

  /** @param {{tick:number,kind:number,reason:number,sourceKind:number,sourceId:number,sourceTeam:number,x:number,z:number,radius:number,effectId?:number,projectileId?:number}} value */
  push(value) {
    if (this.activeCount >= this.capacity) {
      this.dropped += 1;
      return 0;
    }
    const index = this.activeCount;
    const id = this.nextId;
    this.nextId = (this.nextId + 1) >>> 0 || 1;
    this.id[index] = id;
    this.tick[index] = value.tick;
    this.kind[index] = value.kind;
    this.reason[index] = value.reason;
    this.sourceKind[index] = value.sourceKind;
    this.sourceId[index] = value.sourceId;
    this.sourceTeam[index] = value.sourceTeam;
    this.x[index] = value.x;
    this.z[index] = value.z;
    this.radius[index] = value.radius;
    this.effectId[index] = value.effectId ?? 0;
    this.projectileId[index] = value.projectileId ?? 0;
    this.activeCount += 1;
    this.maximumEventsPerTick = Math.max(this.maximumEventsPerTick, this.activeCount);
    return id;
  }
}
