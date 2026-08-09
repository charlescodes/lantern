// @ts-check

import { SIMULATION } from "../config.js";
import { deriveSampleSeed, mixUint32 } from "../spells/random.js";
import { SCORCH_STYLE, scorchMapHash } from "./scorch_marks.js";

export const KINETIC_FRAGMENT_CAPACITY = 512;
export const KINETIC_FRAGMENT_MINIMUM_COUNT = 8;
export const KINETIC_FRAGMENT_MAXIMUM_COUNT = 24;
export const KINETIC_FRAGMENT_MINIMUM_SIZE_METERS = 0.02;
export const KINETIC_FRAGMENT_MAXIMUM_SIZE_METERS = 0.07;
export const KINETIC_FRAGMENT_STEP_SECONDS = SIMULATION.dt;
export const KINETIC_FRAGMENT_MAXIMUM_BOUNCES = 2;
export const KINETIC_FRAGMENT_SURFACE_OFFSET_METERS = 0.035;
export const KINETIC_FRAGMENT_MINIMUM_VISIBLE_EDGE_PIXELS = 48;
export const KINETIC_FRAGMENT_MAXIMUM_VISUAL_SCALE = 72;
export const KINETIC_FRAGMENT_TRIANGLE_VERTICES = Object.freeze([
  -0.5, -Math.sqrt(3) / 6, 0,
  0.5, -Math.sqrt(3) / 6, 0,
  0, Math.sqrt(3) / 3, 0,
]);

export const KINETIC_FRAGMENT_STYLE = Object.freeze({
  color: SCORCH_STYLE.fleckColor,
  css: "rgb(14 17 16)",
});

export const KINETIC_FRAGMENT_MOTION = Object.freeze({
  gravityMetersPerSecondSquared: -9.81,
  linearDragPerSecond: 1.15,
  angularDragPerSecond: 1.8,
  groundRestitution: 0.38,
  groundFrictionRetention: 0.68,
  minimumBounceSpeed: 0.35,
  shrinkExponent: 0.52,
  maximumLifetimeSeconds: 1.35,
});

export const KINETIC_FRAGMENT_COMPONENT_NAMES = Object.freeze([
  "id",
  "explosionId",
  "effectSeed",
  "sampleOrdinal",
  "sampleSeed",
  "x",
  "y",
  "z",
  "previousX",
  "previousY",
  "previousZ",
  "vx",
  "vy",
  "vz",
  "rotationX",
  "rotationY",
  "rotationZ",
  "previousRotationX",
  "previousRotationY",
  "previousRotationZ",
  "angularX",
  "angularY",
  "angularZ",
  "age",
  "lifetime",
  "size",
  "bounceCount",
  "maximumBounces",
]);

const UINT32_RANGE = 0x1_0000_0000;
const TAU = Math.PI * 2;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const GOLDEN_RATIO_CONJUGATE = (Math.sqrt(5) - 1) / 2;
const VERTICAL_LOW_DISCREPANCY_STEP = 0.754_877_666_246_692_7;
const DEFAULT_RADIUS_METERS = 2.5;
const DEFAULT_PRESSURE_IMPULSE = 800;
const MAXIMUM_STRENGTH = 2;
const MAXIMUM_CATCHUP_TICKS = Math.ceil(
  KINETIC_FRAGMENT_MOTION.maximumLifetimeSeconds / KINETIC_FRAGMENT_STEP_SECONDS,
) + 1;
const DIRECTION_EPSILON = 1e-9;

/** @param {number} value @param {number} minimum @param {number} maximum */
function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

/** @param {number} value */
function fract(value) {
  return value - Math.floor(value);
}

/** @param {unknown} value */
function finiteNumber(value) {
  if (value === null || value === undefined || value === "" || typeof value === "boolean") {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/** @param {unknown} value */
function finiteEventId(value) {
  const id = finiteNumber(value);
  return id !== null && Number.isSafeInteger(id) && id >= 0 ? id : null;
}

/** @param {unknown} value */
function finiteTick(value) {
  const tick = finiteNumber(value);
  return tick !== null && Number.isSafeInteger(tick) && tick >= 0 ? tick : null;
}

/** @param {number} seed @param {number} lane */
function sampleUnit(seed, lane) {
  return mixUint32(
    (Number(seed) >>> 0)
      ^ Math.imul((Number(lane) + 1) >>> 0, 0x85eb_ca6b),
  ) / UINT32_RANGE;
}

/**
 * Default Fireball maps to strength 1. Radius and pressure both use clamped
 * square-root curves, so authored extremes have diminishing visual influence.
 *
 * @param {unknown} radius
 * @param {unknown} pressureImpulse
 */
export function kineticFragmentStrength(radius, pressureImpulse) {
  const radiusRatio = clamp(
    Math.max(0, finiteNumber(radius) ?? 0) / DEFAULT_RADIUS_METERS,
    0,
    4,
  );
  const pressureRatio = clamp(
    Math.max(0, finiteNumber(pressureImpulse) ?? 0) / DEFAULT_PRESSURE_IMPULSE,
    0,
    9,
  );
  return clamp(
    Math.sqrt(radiusRatio) * 0.55 + Math.sqrt(pressureRatio) * 0.45,
    0,
    MAXIMUM_STRENGTH,
  );
}

/** @param {number} strength */
export function kineticFragmentCount(strength) {
  const normalized = clamp(
    (finiteNumber(strength) ?? 0) / MAXIMUM_STRENGTH,
    0,
    1,
  );
  return KINETIC_FRAGMENT_MINIMUM_COUNT + Math.round(
    (KINETIC_FRAGMENT_MAXIMUM_COUNT - KINETIC_FRAGMENT_MINIMUM_COUNT)
      * normalized,
  );
}

/**
 * Converts a generic explosion event into a renderer-independent burst header.
 * No spell identity or Fireball geometry participates in this recipe.
 *
 * @param {Record<string, any>} event
 */
export function createKineticFragmentBurst(event) {
  if (event?.type !== "explosion") return null;
  const eventId = finiteEventId(event.id);
  const effectSeedValue = finiteNumber(event.effectSeed);
  const x = finiteNumber(event.originX ?? event.x);
  const y = finiteNumber(event.originY ?? event.y);
  const z = finiteNumber(event.originZ ?? event.z);
  const radius = finiteNumber(event.radius);
  const pressureImpulse = finiteNumber(event.pressureImpulse);
  if (
    eventId === null
    || effectSeedValue === null
    || x === null
    || y === null
    || z === null
    || radius === null
    || pressureImpulse === null
  ) {
    return null;
  }

  const rawNx = finiteNumber(event.nx ?? event.contactNormal?.x) ?? 0;
  const rawNz = finiteNumber(event.nz ?? event.contactNormal?.z) ?? 0;
  const normalLength = Math.hypot(rawNx, rawNz);
  const surfaceKind = String(event.hit?.kind ?? event.surfaceKind ?? "");
  const wall = surfaceKind === "cell" || surfaceKind === "wall";
  if (wall && normalLength <= DIRECTION_EPSILON) return null;
  const nx = normalLength > DIRECTION_EPSILON ? rawNx / normalLength : 0;
  const nz = normalLength > DIRECTION_EPSILON ? rawNz / normalLength : 0;
  const effectSeed = Number(effectSeedValue) >>> 0;
  const burstSeed = mixUint32(
    effectSeed
      ^ Math.imul(Number(eventId) >>> 0, 0x27d4_eb2d)
      ^ 0x6b66_7267,
  );
  const strength = kineticFragmentStrength(radius, pressureImpulse);
  const surfaceOffset = wall ? KINETIC_FRAGMENT_SURFACE_OFFSET_METERS : 0;
  return {
    eventId: Number(eventId) >>> 0,
    effectSeed,
    burstSeed,
    strength,
    count: kineticFragmentCount(strength),
    radius: Math.max(0, radius),
    pressureImpulse: Math.max(0, pressureImpulse),
    wall,
    nx,
    nz,
    x: x + nx * surfaceOffset,
    y: Math.max(0, y),
    z: z + nz * surfaceOffset,
    directionPhase: sampleUnit(burstSeed, 20),
    verticalPhase: sampleUnit(burstSeed, 21),
  };
}

/**
 * Writes one stable ordinal sample into `target`.
 *
 * @param {NonNullable<ReturnType<typeof createKineticFragmentBurst>>} burst
 * @param {number} ordinal
 * @param {Record<string, number>} [target]
 */
export function sampleKineticFragment(burst, ordinal, target = {}) {
  if (!Number.isInteger(ordinal) || ordinal < 0 || ordinal >= burst.count) {
    throw new RangeError("Kinetic fragment ordinal is outside the burst");
  }
  const sampleSeed = deriveSampleSeed(burst.burstSeed, ordinal);
  let angle;
  if (burst.wall) {
    const hemisphereUnit = fract(
      burst.directionPhase + ordinal * GOLDEN_RATIO_CONJUGATE,
    );
    const halfPlaneOffset = (hemisphereUnit - 0.5) * Math.PI * 0.92;
    const jitter = (sampleUnit(sampleSeed, 0) - 0.5) * 0.06;
    angle = Math.atan2(burst.nz, burst.nx) + clamp(
      halfPlaneOffset + jitter,
      -Math.PI / 2 + 0.025,
      Math.PI / 2 - 0.025,
    );
  } else {
    angle = burst.directionPhase * TAU
      + ordinal * GOLDEN_ANGLE
      + (sampleUnit(sampleSeed, 0) - 0.5) * 0.18;
  }

  const motionScale = 0.65 + burst.strength * 0.45;
  const liftScale = 0.75 + burst.strength * 0.3;
  const angularScale = 0.75 + burst.strength * 0.3;
  const horizontalSpeed = (
    1.5 + sampleUnit(sampleSeed, 1) * 2.4
  ) * motionScale;
  const verticalUnit = fract(
    burst.verticalPhase
      + ordinal * VERTICAL_LOW_DISCREPANCY_STEP
      + (sampleUnit(sampleSeed, 2) - 0.5) * 0.08,
  );
  const verticalSpeed = (1.1 + verticalUnit * 2.2) * liftScale;
  const sizeScale = 0.96 + burst.strength * 0.04;
  const size = clamp(
    (
      KINETIC_FRAGMENT_MINIMUM_SIZE_METERS
        + sampleUnit(sampleSeed, 3)
          * (
            KINETIC_FRAGMENT_MAXIMUM_SIZE_METERS
              - KINETIC_FRAGMENT_MINIMUM_SIZE_METERS
          )
    ) * sizeScale,
    KINETIC_FRAGMENT_MINIMUM_SIZE_METERS,
    KINETIC_FRAGMENT_MAXIMUM_SIZE_METERS,
  );
  const lifetime = clamp(
    (0.72 + sampleUnit(sampleSeed, 4) * 0.48)
      * (0.9 + burst.strength * 0.1),
    0.65,
    KINETIC_FRAGMENT_MOTION.maximumLifetimeSeconds,
  );
  const axisY = sampleUnit(sampleSeed, 8) * 2 - 1;
  const axisRadius = Math.sqrt(Math.max(0, 1 - axisY * axisY));
  const axisAngle = sampleUnit(sampleSeed, 9) * TAU;
  const angularSpeed = (8 + sampleUnit(sampleSeed, 10) * 10) * angularScale;
  const shellOffset = size * 0.5;

  target.explosionId = burst.eventId;
  target.effectSeed = burst.effectSeed;
  target.sampleOrdinal = ordinal;
  target.sampleSeed = sampleSeed;
  target.x = burst.x + Math.cos(angle) * shellOffset;
  target.y = burst.y + size * 0.25;
  target.z = burst.z + Math.sin(angle) * shellOffset;
  target.vx = Math.cos(angle) * horizontalSpeed;
  target.vy = verticalSpeed;
  target.vz = Math.sin(angle) * horizontalSpeed;
  target.rotationX = sampleUnit(sampleSeed, 5) * TAU;
  target.rotationY = sampleUnit(sampleSeed, 6) * TAU;
  target.rotationZ = sampleUnit(sampleSeed, 7) * TAU;
  target.angularX = Math.cos(axisAngle) * axisRadius * angularSpeed;
  target.angularY = axisY * angularSpeed;
  target.angularZ = Math.sin(axisAngle) * axisRadius * angularSpeed;
  target.lifetime = lifetime;
  target.size = size;
  target.maximumBounces = 1 + Number(
    sampleUnit(sampleSeed, 11) >= 0.52 - burst.strength * 0.06,
  );
  return target;
}

/** @param {Record<string, any>} snapshot */
function explosionEvents(snapshot) {
  return Array.isArray(snapshot?.recentEvents)
    ? snapshot.recentEvents.filter((event) => event?.type === "explosion")
    : [];
}

/**
 * Presentation-owned, bounded kinetic triangle state. These columns are never
 * exposed through simulation snapshots or fed back into gameplay.
 */
export class KineticFragmentPool {
  /** @param {{capacity?:number}} [options] */
  constructor({ capacity = KINETIC_FRAGMENT_CAPACITY } = {}) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new RangeError("Kinetic fragment capacity must be a positive integer");
    }
    this.capacity = capacity;
    this.activeCount = 0;
    this.dropped = 0;
    this.spawned = 0;
    this.expired = 0;
    this.groundBounces = 0;
    this.ingestedExplosions = 0;
    this.skippedExplosions = 0;
    this.duplicateEvents = 0;
    this.missedEvents = 0;
    this.resets = 0;
    this.nextId = 1;

    this.id = new Uint32Array(capacity);
    this.explosionId = new Uint32Array(capacity);
    this.effectSeed = new Uint32Array(capacity);
    this.sampleOrdinal = new Uint16Array(capacity);
    this.sampleSeed = new Uint32Array(capacity);
    this.x = new Float32Array(capacity);
    this.y = new Float32Array(capacity);
    this.z = new Float32Array(capacity);
    this.previousX = new Float32Array(capacity);
    this.previousY = new Float32Array(capacity);
    this.previousZ = new Float32Array(capacity);
    this.vx = new Float32Array(capacity);
    this.vy = new Float32Array(capacity);
    this.vz = new Float32Array(capacity);
    this.rotationX = new Float32Array(capacity);
    this.rotationY = new Float32Array(capacity);
    this.rotationZ = new Float32Array(capacity);
    this.previousRotationX = new Float32Array(capacity);
    this.previousRotationY = new Float32Array(capacity);
    this.previousRotationZ = new Float32Array(capacity);
    this.angularX = new Float32Array(capacity);
    this.angularY = new Float32Array(capacity);
    this.angularZ = new Float32Array(capacity);
    this.age = new Float32Array(capacity);
    this.lifetime = new Float32Array(capacity);
    this.size = new Float32Array(capacity);
    this.bounceCount = new Uint8Array(capacity);
    this.maximumBounces = new Uint8Array(capacity);

    this.primed = false;
    this.lastTick = null;
    this.lastSeed = null;
    this.lastMapHash = null;
    this.lastObservedEventId = null;
    this.observedEventIds = new Set();
    this._sample = {};
  }

  /** @param {Record<string, any>} snapshot */
  prime(snapshot) {
    this.#clearActive();
    this.#primeTimeline(snapshot);
  }

  /**
   * Advances by authoritative tick count and consumes each newly retained
   * explosion once. Repeated render frames at one tick do no kinematic work.
   *
   * @param {Record<string, any>} snapshot
   */
  ingest(snapshot) {
    if (!this.primed) {
      this.prime(snapshot);
      return false;
    }
    const tick = finiteTick(snapshot?.tick) ?? 0;
    const seed = finiteNumber(snapshot?.seed) ?? 0;
    const mapHash = scorchMapHash(snapshot?.map, snapshot?.obelisks ?? []);
    const events = explosionEvents(snapshot);
    const timelineCleared = this.observedEventIds.size > 0 && events.length === 0;
    if (
      (this.lastTick !== null && tick < this.lastTick)
      || (this.lastSeed !== null && seed !== this.lastSeed)
      || (this.lastMapHash !== null && mapHash !== this.lastMapHash)
      || timelineCleared
    ) {
      const changed = this.activeCount > 0;
      this.#clearActive();
      this.resets += 1;
      this.#primeTimeline(snapshot);
      return changed;
    }

    const previousTick = this.lastTick ?? tick;
    const currentEventIds = new Set();
    const candidates = [];
    for (const event of events) {
      const id = finiteEventId(event.id);
      if (id === null) {
        this.skippedExplosions += 1;
        continue;
      }
      if (currentEventIds.has(id)) {
        this.duplicateEvents += 1;
        continue;
      }
      currentEventIds.add(id);
      if (!this.observedEventIds.has(id)) candidates.push(event);
    }
    candidates.sort((left, right) => (
      Number(left.tick) - Number(right.tick)
      || Number(left.id) - Number(right.id)
    ));

    const scheduled = [];
    for (const event of candidates) {
      const id = Number(event.id);
      if (this.lastObservedEventId !== null && id <= this.lastObservedEventId) {
        this.skippedExplosions += 1;
        continue;
      }
      if (this.lastObservedEventId !== null && id > this.lastObservedEventId + 1) {
        this.missedEvents += id - this.lastObservedEventId - 1;
      }
      this.lastObservedEventId = id;
      const eventTick = finiteTick(event.tick);
      const burst = createKineticFragmentBurst(event);
      if (eventTick === null || eventTick > tick || !burst) {
        this.skippedExplosions += 1;
        continue;
      }
      scheduled.push({ tick: eventTick, burst });
    }

    let startTick = previousTick;
    if (tick - startTick > MAXIMUM_CATCHUP_TICKS) {
      this.expired += this.activeCount;
      this.#clearActive();
      startTick = tick - MAXIMUM_CATCHUP_TICKS;
    }

    let scheduledIndex = 0;
    while (
      scheduledIndex < scheduled.length
      && scheduled[scheduledIndex].tick < startTick
    ) {
      this.skippedExplosions += 1;
      scheduledIndex += 1;
    }
    while (
      scheduledIndex < scheduled.length
      && scheduled[scheduledIndex].tick <= startTick
    ) {
      this.#spawnBurst(scheduled[scheduledIndex].burst);
      scheduledIndex += 1;
    }
    for (let stepTick = startTick + 1; stepTick <= tick; stepTick += 1) {
      this.#stepOnce();
      while (
        scheduledIndex < scheduled.length
        && scheduled[scheduledIndex].tick <= stepTick
      ) {
        this.#spawnBurst(scheduled[scheduledIndex].burst);
        scheduledIndex += 1;
      }
    }

    this.lastTick = tick;
    this.lastSeed = seed;
    this.lastMapHash = mapHash;
    this.observedEventIds = currentEventIds;
    return tick !== previousTick || scheduled.length > 0;
  }

  /**
   * @param {{
   * explosionId?:number,effectSeed?:number,sampleOrdinal?:number,sampleSeed?:number,
   * x:number,y:number,z:number,vx:number,vy:number,vz:number,
   * rotationX?:number,rotationY?:number,rotationZ?:number,
   * angularX?:number,angularY?:number,angularZ?:number,
   * lifetime:number,size:number,maximumBounces?:number
   * }} value
   */
  spawn(value) {
    if (this.activeCount >= this.capacity) {
      this.dropped += 1;
      return 0;
    }
    const index = this.activeCount;
    const id = this.nextId;
    this.nextId = (this.nextId + 1) >>> 0 || 1;
    this.id[index] = id;
    this.explosionId[index] = value.explosionId ?? 0;
    this.effectSeed[index] = value.effectSeed ?? 0;
    this.sampleOrdinal[index] = value.sampleOrdinal ?? 0;
    this.sampleSeed[index] = value.sampleSeed ?? 0;
    this.x[index] = value.x;
    this.y[index] = value.y;
    this.z[index] = value.z;
    this.previousX[index] = value.x;
    this.previousY[index] = value.y;
    this.previousZ[index] = value.z;
    this.vx[index] = value.vx;
    this.vy[index] = value.vy;
    this.vz[index] = value.vz;
    this.rotationX[index] = value.rotationX ?? 0;
    this.rotationY[index] = value.rotationY ?? 0;
    this.rotationZ[index] = value.rotationZ ?? 0;
    this.previousRotationX[index] = this.rotationX[index];
    this.previousRotationY[index] = this.rotationY[index];
    this.previousRotationZ[index] = this.rotationZ[index];
    this.angularX[index] = value.angularX ?? 0;
    this.angularY[index] = value.angularY ?? 0;
    this.angularZ[index] = value.angularZ ?? 0;
    this.age[index] = 0;
    this.lifetime[index] = value.lifetime;
    this.size[index] = value.size;
    this.bounceCount[index] = 0;
    this.maximumBounces[index] = clamp(
      Math.trunc(value.maximumBounces ?? 1),
      1,
      KINETIC_FRAGMENT_MAXIMUM_BOUNCES,
    );
    this.activeCount += 1;
    this.spawned += 1;
    return id;
  }

  /** @param {number} index */
  removeSwap(index) {
    if (index < 0 || index >= this.activeCount) return false;
    const last = this.activeCount - 1;
    if (index !== last) {
      for (const name of KINETIC_FRAGMENT_COMPONENT_NAMES) {
        this[name][index] = this[name][last];
      }
    }
    this.activeCount = last;
    return true;
  }

  /** @param {number} [ticks] */
  step(ticks = 1) {
    const count = Math.max(0, Math.trunc(Number(ticks)));
    for (let tick = 0; tick < count && this.activeCount > 0; tick += 1) {
      this.#stepOnce();
    }
  }

  clear() {
    const changed = this.activeCount > 0;
    this.#clearActive();
    this.primed = false;
    this.lastTick = null;
    this.lastSeed = null;
    this.lastMapHash = null;
    this.lastObservedEventId = null;
    this.observedEventIds.clear();
    this.resets += 1;
    return changed;
  }

  /** @param {number} index @param {number} [alpha] */
  currentSize(index, alpha = 1) {
    if (index < 0 || index >= this.activeCount) return 0;
    const age = Math.max(
      0,
      this.age[index] - KINETIC_FRAGMENT_STEP_SECONDS * (1 - clamp(alpha, 0, 1)),
    );
    const lifetime = this.lifetime[index];
    if (!(lifetime > 0)) return 0;
    const remaining = 1 - clamp(age / lifetime, 0, 1);
    return this.size[index]
      * remaining ** KINETIC_FRAGMENT_MOTION.shrinkExponent;
  }

  diagnostics() {
    return {
      capacity: this.capacity,
      active: this.activeCount,
      dropped: this.dropped,
      ingestedExplosions: this.ingestedExplosions,
      resets: this.resets,
      spawned: this.spawned,
      expired: this.expired,
      groundBounces: this.groundBounces,
      skippedExplosions: this.skippedExplosions,
      duplicateEvents: this.duplicateEvents,
      missedEvents: this.missedEvents,
    };
  }

  /** @param {Record<string, any>} snapshot */
  #primeTimeline(snapshot) {
    const events = explosionEvents(snapshot);
    let maximumId = null;
    this.observedEventIds = new Set();
    for (const event of events) {
      const id = finiteEventId(event.id);
      if (id === null) continue;
      this.observedEventIds.add(id);
      maximumId = maximumId === null ? id : Math.max(maximumId, id);
    }
    this.lastObservedEventId = maximumId;
    this.lastTick = finiteTick(snapshot?.tick) ?? 0;
    this.lastSeed = finiteNumber(snapshot?.seed) ?? 0;
    this.lastMapHash = scorchMapHash(snapshot?.map, snapshot?.obelisks ?? []);
    this.primed = true;
  }

  #clearActive() {
    this.activeCount = 0;
    this.nextId = 1;
  }

  /** @param {NonNullable<ReturnType<typeof createKineticFragmentBurst>>} burst */
  #spawnBurst(burst) {
    this.ingestedExplosions += 1;
    for (let ordinal = 0; ordinal < burst.count; ordinal += 1) {
      sampleKineticFragment(burst, ordinal, this._sample);
      this.spawn(this._sample);
    }
  }

  #stepOnce() {
    const dt = KINETIC_FRAGMENT_STEP_SECONDS;
    const linearRetention = Math.max(
      0,
      1 - KINETIC_FRAGMENT_MOTION.linearDragPerSecond * dt,
    );
    const angularRetention = Math.max(
      0,
      1 - KINETIC_FRAGMENT_MOTION.angularDragPerSecond * dt,
    );
    let index = 0;
    while (index < this.activeCount) {
      this.previousX[index] = this.x[index];
      this.previousY[index] = this.y[index];
      this.previousZ[index] = this.z[index];
      this.previousRotationX[index] = this.rotationX[index];
      this.previousRotationY[index] = this.rotationY[index];
      this.previousRotationZ[index] = this.rotationZ[index];
      this.age[index] += dt;
      if (this.age[index] >= this.lifetime[index]) {
        this.expired += 1;
        this.removeSwap(index);
        continue;
      }

      this.vx[index] *= linearRetention;
      this.vy[index] = (
        this.vy[index]
          + KINETIC_FRAGMENT_MOTION.gravityMetersPerSecondSquared * dt
      ) * linearRetention;
      this.vz[index] *= linearRetention;
      this.angularX[index] *= angularRetention;
      this.angularY[index] *= angularRetention;
      this.angularZ[index] *= angularRetention;
      this.x[index] += this.vx[index] * dt;
      this.y[index] += this.vy[index] * dt;
      this.z[index] += this.vz[index] * dt;
      this.rotationX[index] += this.angularX[index] * dt;
      this.rotationY[index] += this.angularY[index] * dt;
      this.rotationZ[index] += this.angularZ[index] * dt;

      if (this.y[index] <= 0) {
        const downwardSpeed = Math.max(0, -this.vy[index]);
        if (
          this.bounceCount[index] < this.maximumBounces[index]
          && downwardSpeed >= KINETIC_FRAGMENT_MOTION.minimumBounceSpeed
        ) {
          this.y[index] = 0;
          this.vy[index] = downwardSpeed
            * KINETIC_FRAGMENT_MOTION.groundRestitution;
          this.vx[index] *= KINETIC_FRAGMENT_MOTION.groundFrictionRetention;
          this.vz[index] *= KINETIC_FRAGMENT_MOTION.groundFrictionRetention;
          this.angularX[index] *= KINETIC_FRAGMENT_MOTION.groundFrictionRetention;
          this.angularY[index] *= KINETIC_FRAGMENT_MOTION.groundFrictionRetention;
          this.angularZ[index] *= KINETIC_FRAGMENT_MOTION.groundFrictionRetention;
          this.bounceCount[index] += 1;
          this.groundBounces += 1;
        } else {
          this.expired += 1;
          this.removeSwap(index);
          continue;
        }
      }
      index += 1;
    }
  }
}

/**
 * Keeps centimeter-scale fragment recipes readable through Lantern's metric
 * camera without allowing zoom level to create unbounded shard geometry. The
 * lifecycle multiplier remains unchanged, so the readability floor shrinks
 * away with the authored fragment instead of pinning a permanent pixel size.
 *
 * @param {KineticFragmentPool} pool
 * @param {number} index
 * @param {number} alpha
 * @param {number} worldToViewportScale
 */
export function kineticFragmentPresentationSize(
  pool,
  index,
  alpha,
  worldToViewportScale,
) {
  if (index < 0 || index >= pool.activeCount) return 0;
  const physicalSize = pool.currentSize(index, alpha);
  const authoredSize = pool.size[index];
  const viewportScale = finiteNumber(worldToViewportScale);
  if (!(physicalSize > 0) || !(authoredSize > 0) || !(viewportScale > 0)) {
    return physicalSize;
  }
  const minimumWorldSize = KINETIC_FRAGMENT_MINIMUM_VISIBLE_EDGE_PIXELS
    / viewportScale;
  const visualScale = clamp(
    minimumWorldSize / authoredSize,
    1,
    KINETIC_FRAGMENT_MAXIMUM_VISUAL_SCALE,
  );
  return physicalSize * visualScale;
}

/**
 * Writes the interpolated, rotated world-space triangle as XYZ triples.
 * Canvas uses this directly; Three.js applies the equivalent resident geometry
 * transform through instance matrices.
 *
 * @param {KineticFragmentPool} pool
 * @param {number} index
 * @param {number} alpha
 * @param {Float32Array|number[]} target
 * @param {number} [worldToViewportScale]
 */
export function writeKineticFragmentTriangle(
  pool,
  index,
  alpha,
  target,
  worldToViewportScale = Number.POSITIVE_INFINITY,
) {
  const t = clamp(Number(alpha), 0, 1);
  const centerX = pool.previousX[index] + (pool.x[index] - pool.previousX[index]) * t;
  const centerY = pool.previousY[index] + (pool.y[index] - pool.previousY[index]) * t;
  const centerZ = pool.previousZ[index] + (pool.z[index] - pool.previousZ[index]) * t;
  const rotationX = pool.previousRotationX[index]
    + (pool.rotationX[index] - pool.previousRotationX[index]) * t;
  const rotationY = pool.previousRotationY[index]
    + (pool.rotationY[index] - pool.previousRotationY[index]) * t;
  const rotationZ = pool.previousRotationZ[index]
    + (pool.rotationZ[index] - pool.previousRotationZ[index]) * t;
  const size = kineticFragmentPresentationSize(
    pool,
    index,
    t,
    worldToViewportScale,
  );
  const cosX = Math.cos(rotationX);
  const sinX = Math.sin(rotationX);
  const cosY = Math.cos(rotationY);
  const sinY = Math.sin(rotationY);
  const cosZ = Math.cos(rotationZ);
  const sinZ = Math.sin(rotationZ);
  const cosXCosZ = cosX * cosZ;
  const cosXSinZ = cosX * sinZ;
  const sinXCosZ = sinX * cosZ;
  const sinXSinZ = sinX * sinZ;

  for (let vertex = 0; vertex < 3; vertex += 1) {
    const source = vertex * 3;
    const localX = KINETIC_FRAGMENT_TRIANGLE_VERTICES[source] * size;
    const localY = KINETIC_FRAGMENT_TRIANGLE_VERTICES[source + 1] * size;
    const localZ = KINETIC_FRAGMENT_TRIANGLE_VERTICES[source + 2] * size;
    target[source] = centerX
      + cosY * cosZ * localX
      - cosY * sinZ * localY
      + sinY * localZ;
    target[source + 1] = centerY
      + (cosXSinZ + sinXCosZ * sinY) * localX
      + (cosXCosZ - sinXSinZ * sinY) * localY
      - sinX * cosY * localZ;
    target[source + 2] = centerZ
      + (sinXSinZ - cosXCosZ * sinY) * localX
      + (sinXCosZ + cosXSinZ * sinY) * localY
      + cosX * cosY * localZ;
  }
  return target;
}
