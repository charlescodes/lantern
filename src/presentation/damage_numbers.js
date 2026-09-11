// @ts-check

import { SIMULATION } from "../config.js";
import { mixUint32 } from "../spells/random.js";
import { scorchMapHash } from "./scorch_marks.js";

export const DAMAGE_NUMBER_CAPACITY = 128;
export const DAMAGE_NUMBER_LIFETIME_SECONDS = 1;
export const DAMAGE_NUMBER_VERTICAL_VELOCITY = 4;
export const DAMAGE_NUMBER_GRAVITY = -4;
export const DAMAGE_NUMBER_DIRECTED_DISTANCE_METERS = 0.35;
export const DAMAGE_NUMBER_MAXIMUM_LATERAL_METERS = 0.15;
export const DAMAGE_NUMBER_MAXIMUM_RADIUS_METERS = 0.5;
export const DAMAGE_NUMBER_SOURCELESS_RADIUS_METERS = 0.25;
export const DAMAGE_NUMBER_FADE_START = 0.2;
export const DAMAGE_NUMBER_FONT = "600 13px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
export const DAMAGE_NUMBER_COLORS = Object.freeze({
  player: "rgb(255 91 98)",
  enemy: "rgb(255 218 91)",
  outline: "rgb(18 12 12 / 0.92)",
});

const UINT32_RANGE = 0x1_0000_0000;
const DIRECTION_EPSILON = 1e-9;

/** @param {number} value @param {number} minimum @param {number} maximum */
function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

/** @param {unknown} value */
function finiteNumber(value) {
  if (value === null || value === undefined || value === "" || typeof value === "boolean") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/** @param {unknown} value */
function finiteId(value) {
  const number = finiteNumber(value);
  return number !== null && Number.isSafeInteger(number) && number > 0 ? number : null;
}

/** @param {number} seed @param {number} lane */
function sampleUnit(seed, lane) {
  return mixUint32(seed ^ Math.imul((lane + 1) >>> 0, 0x85eb_ca6b)) / UINT32_RANGE;
}

/** @param {unknown} amount */
export function formatDamageNumber(amount) {
  const value = finiteNumber(amount);
  return String(Math.max(1, Math.round(Math.max(0, value ?? 0))));
}

/** @param {number} normalizedAge */
export function damageNumberOpacity(normalizedAge) {
  const age = clamp(Number(normalizedAge) || 0, 0, 1);
  if (age <= DAMAGE_NUMBER_FADE_START) return 1;
  const progress = (age - DAMAGE_NUMBER_FADE_START) / (1 - DAMAGE_NUMBER_FADE_START);
  const smooth = progress * progress * (3 - 2 * progress);
  return 1 - smooth;
}

/**
 * @param {{x:number,y:number,z:number}} origin
 * @param {{x:number,z:number}} horizontalVelocity
 * @param {number} ageSeconds
 */
export function damageNumberPositionAt(origin, horizontalVelocity, ageSeconds) {
  const age = clamp(Number(ageSeconds) || 0, 0, DAMAGE_NUMBER_LIFETIME_SECONDS);
  return {
    x: origin.x + horizontalVelocity.x * age,
    y: origin.y
      + DAMAGE_NUMBER_VERTICAL_VELOCITY * age
      + 0.5 * DAMAGE_NUMBER_GRAVITY * age * age,
    z: origin.z + horizontalVelocity.z * age,
  };
}

/** @param {{worldToViewport:(x:number,z:number)=>{x:number,y:number},worldToViewportScale:number}} camera @param {{x:number,y:number,z:number}} point @param {number} baseY */
export function projectDamageNumberCanvas(camera, point, baseY = 0) {
  const projected = camera.worldToViewport(point.x, point.z);
  return {
    x: projected.x,
    y: projected.y - (point.y - baseY) * camera.worldToViewportScale,
  };
}

/** @param {{x:number,y:number,z?:number}} ndc @param {number} width @param {number} height */
export function damageNumberViewportFromNdc(ndc, width, height) {
  if (Number(ndc.z) < -1 || Number(ndc.z) > 1) return null;
  return {
    x: (ndc.x + 1) * width / 2,
    y: (1 - ndc.y) * height / 2,
  };
}

/** @param {Record<string, any>} event @param {number} simulationSeed */
export function createDamageNumber(event, simulationSeed) {
  if (event?.type !== "damage") return null;
  const eventId = finiteId(event.id);
  const targetId = finiteId(event.target?.id);
  const amount = finiteNumber(event.amount);
  const x = finiteNumber(event.position?.x);
  const y = finiteNumber(event.visualCenterY);
  const z = finiteNumber(event.position?.z);
  const layerIndex = finiteNumber(event.layerIndex);
  if (
    eventId === null
    || targetId === null
    || !(amount !== null && amount > 0)
    || x === null
    || y === null
    || z === null
    || layerIndex === null
  ) return null;

  const variationSeed = mixUint32(
    (Number(simulationSeed) >>> 0)
      ^ Math.imul(eventId >>> 0, 0x9e37_79b1)
      ^ Math.imul(targetId >>> 0, 0x85eb_ca6b)
      ^ 0x646d_676e,
  );
  const rawDirectionX = finiteNumber(event.launchDirection?.x) ?? 0;
  const rawDirectionZ = finiteNumber(event.launchDirection?.z) ?? 0;
  const directionLength = Math.hypot(rawDirectionX, rawDirectionZ);
  let velocityX;
  let velocityZ;
  if (directionLength > DIRECTION_EPSILON) {
    const nx = rawDirectionX / directionLength;
    const nz = rawDirectionZ / directionLength;
    const lateral = (sampleUnit(variationSeed, 0) * 2 - 1)
      * DAMAGE_NUMBER_MAXIMUM_LATERAL_METERS;
    velocityX = nx * DAMAGE_NUMBER_DIRECTED_DISTANCE_METERS - nz * lateral;
    velocityZ = nz * DAMAGE_NUMBER_DIRECTED_DISTANCE_METERS + nx * lateral;
    const radius = Math.hypot(velocityX, velocityZ);
    if (radius > DAMAGE_NUMBER_MAXIMUM_RADIUS_METERS) {
      velocityX *= DAMAGE_NUMBER_MAXIMUM_RADIUS_METERS / radius;
      velocityZ *= DAMAGE_NUMBER_MAXIMUM_RADIUS_METERS / radius;
    }
  } else {
    const angle = sampleUnit(variationSeed, 1) * Math.PI * 2;
    const radius = Math.sqrt(sampleUnit(variationSeed, 2))
      * DAMAGE_NUMBER_SOURCELESS_RADIUS_METERS;
    velocityX = Math.cos(angle) * radius;
    velocityZ = Math.sin(angle) * radius;
  }
  return {
    eventId,
    targetId,
    targetTeam: event.target?.team === "player" ? "player" : "enemy",
    layerIndex: Math.trunc(layerIndex),
    layerId: event.layerId ?? null,
    amount,
    text: formatDamageNumber(amount),
    x,
    y,
    z,
    vx: velocityX,
    vz: velocityZ,
  };
}

const COMPONENT_NAMES = Object.freeze([
  "eventId", "targetId", "targetTeam", "layerIndex", "amount",
  "x", "y", "z", "vx", "vz", "age",
]);

export class DamageNumberPool {
  /** @param {{capacity?:number}} [options] */
  constructor({ capacity = DAMAGE_NUMBER_CAPACITY } = {}) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new RangeError("Damage-number capacity must be a positive integer");
    }
    this.capacity = capacity;
    this.activeCount = 0;
    this.dropped = 0;
    this.ingestedEvents = 0;
    this.resets = 0;
    this.expired = 0;
    this.primed = false;
    this.lastTick = null;
    this.lastSeed = null;
    this.lastMapHash = null;
    this.lastObservedEventId = null;
    this.observedEventIds = new Set();

    this.eventId = new Uint32Array(capacity);
    this.targetId = new Uint32Array(capacity);
    this.targetTeam = new Uint8Array(capacity);
    this.layerIndex = new Int16Array(capacity);
    this.amount = new Float32Array(capacity);
    this.x = new Float32Array(capacity);
    this.y = new Float32Array(capacity);
    this.z = new Float32Array(capacity);
    this.vx = new Float32Array(capacity);
    this.vz = new Float32Array(capacity);
    this.age = new Float32Array(capacity);
  }

  /** @param {Record<string, any>} snapshot */
  prime(snapshot) {
    this.activeCount = 0;
    this.#primeTimeline(snapshot);
  }

  /** @param {Record<string, any>} snapshot */
  ingest(snapshot) {
    if (!this.primed) {
      this.prime(snapshot);
      return false;
    }
    const tick = Math.max(0, Math.trunc(finiteNumber(snapshot?.tick) ?? 0));
    const seed = finiteNumber(snapshot?.seed) ?? 0;
    const mapHash = scorchMapHash(snapshot?.map, snapshot?.obelisks ?? []);
    const events = this.#damageEvents(snapshot);
    const timelineCleared = this.observedEventIds.size > 0 && events.length === 0;
    if (
      (this.lastTick !== null && tick < this.lastTick)
      || (this.lastSeed !== null && seed !== this.lastSeed)
      || (this.lastMapHash !== null && mapHash !== this.lastMapHash)
      || timelineCleared
    ) {
      const changed = this.activeCount > 0;
      this.activeCount = 0;
      this.resets += 1;
      this.#primeTimeline(snapshot);
      return changed;
    }

    const previousTick = this.lastTick ?? tick;
    const currentIds = new Set();
    const candidates = [];
    for (const event of events) {
      const id = finiteId(event.id);
      if (id === null || currentIds.has(id)) continue;
      currentIds.add(id);
      if (!this.observedEventIds.has(id)) candidates.push(event);
    }
    candidates.sort((left, right) => (
      Number(left.tick) - Number(right.tick)
      || Number(left.id) - Number(right.id)
    ));
    let advancedTick = previousTick;
    for (const event of candidates) {
      const id = Number(event.id);
      if (this.lastObservedEventId !== null && id <= this.lastObservedEventId) continue;
      this.lastObservedEventId = id;
      const eventTick = Math.max(0, Math.trunc(finiteNumber(event.tick) ?? tick));
      if (eventTick > tick) continue;
      if (eventTick > advancedTick) {
        this.step(eventTick - advancedTick);
        advancedTick = eventTick;
      }
      const number = createDamageNumber(event, seed);
      if (!number) continue;
      this.ingestedEvents += 1;
      this.spawn(number);
    }
    this.step(tick - advancedTick);
    this.lastTick = tick;
    this.lastSeed = seed;
    this.lastMapHash = mapHash;
    this.observedEventIds = currentIds;
    return tick !== previousTick || candidates.length > 0;
  }

  /** @param {NonNullable<ReturnType<typeof createDamageNumber>>} value */
  spawn(value) {
    if (this.activeCount >= this.capacity) {
      this.dropped += 1;
      return false;
    }
    const index = this.activeCount;
    this.eventId[index] = value.eventId;
    this.targetId[index] = value.targetId;
    this.targetTeam[index] = value.targetTeam === "player" ? 1 : 2;
    this.layerIndex[index] = value.layerIndex;
    this.amount[index] = value.amount;
    this.x[index] = value.x;
    this.y[index] = value.y;
    this.z[index] = value.z;
    this.vx[index] = value.vx;
    this.vz[index] = value.vz;
    this.age[index] = 0;
    this.activeCount += 1;
    return true;
  }

  /** @param {number} index */
  removeSwap(index) {
    if (index < 0 || index >= this.activeCount) return false;
    const last = this.activeCount - 1;
    if (index !== last) {
      for (const name of COMPONENT_NAMES) this[name][index] = this[name][last];
    }
    this.activeCount = last;
    return true;
  }

  /** @param {number} [ticks] */
  step(ticks = 1) {
    const count = Math.max(0, Math.trunc(Number(ticks)));
    if (count === 0) return;
    const elapsed = count * SIMULATION.dt;
    let index = 0;
    while (index < this.activeCount) {
      this.age[index] += elapsed;
      if (this.age[index] >= DAMAGE_NUMBER_LIFETIME_SECONDS - 1e-7) {
        this.expired += 1;
        this.removeSwap(index);
        continue;
      }
      index += 1;
    }
  }

  clearForToggle() {
    const changed = this.activeCount > 0 || this.primed;
    this.activeCount = 0;
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
  sample(index, alpha = 1) {
    if (index < 0 || index >= this.activeCount) return null;
    const age = Math.max(0, this.age[index] - SIMULATION.dt * (1 - clamp(alpha, 0, 1)));
    const position = damageNumberPositionAt(
      { x: this.x[index], y: this.y[index], z: this.z[index] },
      { x: this.vx[index], z: this.vz[index] },
      age,
    );
    return {
      ...position,
      eventId: this.eventId[index],
      targetId: this.targetId[index],
      targetTeam: this.targetTeam[index] === 1 ? "player" : "enemy",
      layerIndex: this.layerIndex[index],
      originX: this.x[index],
      originZ: this.z[index],
      text: formatDamageNumber(this.amount[index]),
      opacity: damageNumberOpacity(age / DAMAGE_NUMBER_LIFETIME_SECONDS),
    };
  }

  diagnostics() {
    return {
      capacity: this.capacity,
      active: this.activeCount,
      dropped: this.dropped,
      ingestedEvents: this.ingestedEvents,
      resets: this.resets,
    };
  }

  /** @param {Record<string, any>} snapshot */
  #damageEvents(snapshot) {
    return Array.isArray(snapshot?.recentCombatEvents)
      ? snapshot.recentCombatEvents.filter((event) => event?.type === "damage")
      : [];
  }

  /** @param {Record<string, any>} snapshot */
  #primeTimeline(snapshot) {
    const events = this.#damageEvents(snapshot);
    this.observedEventIds = new Set();
    this.lastObservedEventId = null;
    for (const event of events) {
      const id = finiteId(event.id);
      if (id === null) continue;
      this.observedEventIds.add(id);
      this.lastObservedEventId = Math.max(this.lastObservedEventId ?? 0, id);
    }
    this.lastTick = Math.max(0, Math.trunc(finiteNumber(snapshot?.tick) ?? 0));
    this.lastSeed = finiteNumber(snapshot?.seed) ?? 0;
    this.lastMapHash = scorchMapHash(snapshot?.map, snapshot?.obelisks ?? []);
    this.primed = true;
  }
}

export class DamageNumberOverlay {
  /** @param {HTMLCanvasElement|null} canvas */
  constructor(canvas) {
    this.canvas = canvas;
    this.context = canvas?.getContext("2d") ?? null;
    this.width = 0;
    this.height = 0;
    this.backingScale = 0;
  }

  clear() {
    if (!this.context || !this.canvas) return;
    this.context.setTransform(1, 0, 0, 1, 0, 0);
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  /**
   * @param {DamageNumberPool} pool
   * @param {number} alpha
   * @param {{project:(point:{x:number,y:number,z:number})=>{x:number,y:number}|null,layerIndex:number,sightFrame?:import('../visibility/true_sight.js').TrueSightFrame|null,dprCap?:number}} view
   */
  render(pool, alpha, view) {
    if (!this.context || !this.canvas) return;
    this.#resize(view.dprCap ?? 2);
    this.clear();
    const context = this.context;
    context.setTransform(this.backingScale, 0, 0, this.backingScale, 0, 0);
    context.font = DAMAGE_NUMBER_FONT;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.lineJoin = "round";
    context.lineWidth = 3;
    for (let index = 0; index < pool.activeCount; index += 1) {
      const number = pool.sample(index, alpha);
      if (!number || number.layerIndex !== view.layerIndex) continue;
      let opacity = number.opacity;
      if (number.targetTeam === "enemy" && view.sightFrame) {
        opacity *= view.sightFrame.displayVisibilityAt(number.originX, number.originZ);
      }
      if (!(opacity > 0)) continue;
      const point = view.project(number);
      if (!point) continue;
      context.globalAlpha = opacity;
      context.strokeStyle = DAMAGE_NUMBER_COLORS.outline;
      context.fillStyle = DAMAGE_NUMBER_COLORS[number.targetTeam];
      context.strokeText(number.text, point.x, point.y);
      context.fillText(number.text, point.x, point.y);
    }
    context.globalAlpha = 1;
  }

  /** @param {number} dprCap */
  #resize(dprCap) {
    if (!this.canvas) return;
    const bounds = this.canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(bounds.width));
    const height = Math.max(1, Math.round(bounds.height));
    const scale = Math.min(Math.max(1, Number(dprCap) || 1), window.devicePixelRatio || 1);
    if (width === this.width && height === this.height && scale === this.backingScale) return;
    this.width = width;
    this.height = height;
    this.backingScale = scale;
    this.canvas.width = Math.round(width * scale);
    this.canvas.height = Math.round(height * scale);
  }
}
