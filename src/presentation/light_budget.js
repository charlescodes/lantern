// @ts-check

import { EXPLOSION, PARTICLE, SIMULATION } from "../config.js";

export const PRESENTATION_LIGHT_CAPACITY = 8;

const FIRE_COLORS = Object.freeze({
  core: Object.freeze({ r: 1, g: 0.94, b: 0.56 }),
  amber: Object.freeze({ r: 1, g: 0.47, b: 0.08 }),
  decay: Object.freeze({ r: 0.94, g: 0.12, b: 0.025 }),
});

/** @param {number} value @param {number} minimum @param {number} maximum */
function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

/** @param {{r:number,g:number,b:number}} left @param {{r:number,g:number,b:number}} right @param {number} amount */
function mixColor(left, right, amount) {
  const t = clamp(amount, 0, 1);
  return {
    r: left.r + (right.r - left.r) * t,
    g: left.g + (right.g - left.g) * t,
    b: left.b + (right.b - left.b) * t,
  };
}

/** @param {number} life */
export function sparkFireColor(life) {
  const remaining = clamp(life, 0, 1);
  return remaining >= 0.58
    ? mixColor(FIRE_COLORS.amber, FIRE_COLORS.core, (remaining - 0.58) / 0.42)
    : mixColor(FIRE_COLORS.decay, FIRE_COLORS.amber, remaining / 0.58);
}

/**
 * Writes the spark gradient into an existing color-like object so the particle
 * presentation does not allocate one temporary RGB object per instance.
 * @param {{setRGB:(r:number,g:number,b:number)=>unknown}} target
 * @param {number} life
 */
export function writeSparkFireColor(target, life) {
  const remaining = clamp(life, 0, 1);
  const from = remaining >= 0.58 ? FIRE_COLORS.amber : FIRE_COLORS.decay;
  const to = remaining >= 0.58 ? FIRE_COLORS.core : FIRE_COLORS.amber;
  const amount = remaining >= 0.58
    ? (remaining - 0.58) / 0.42
    : remaining / 0.58;
  target.setRGB(
    from.r + (to.r - from.r) * amount,
    from.g + (to.g - from.g) * amount,
    from.b + (to.b - from.b) * amount,
  );
  return target;
}

/** @param {Record<string, any>} particle */
function particleLife(particle) {
  if (!(particle.lifetime > 0)) return 0;
  return clamp(1 - particle.age / particle.lifetime, 0, 1);
}

export class PresentationLightBudget {
  /** @param {{capacity?:number,explosionLifetimeTicks?:number}} [options] */
  constructor(options = {}) {
    this.capacity = Math.max(
      0,
      Math.trunc(options.capacity ?? PRESENTATION_LIGHT_CAPACITY),
    );
    this.explosionLifetimeTicks = Math.max(
      1,
      Math.trunc(options.explosionLifetimeTicks ?? EXPLOSION.debugTicks),
    );
    this.sparkLeases = new Map();
    this.observedSparkIds = new Set();
    this.nextLease = 1;
    this.lastTick = null;
  }

  reset() {
    this.sparkLeases.clear();
    this.observedSparkIds.clear();
    this.nextLease = 1;
    this.lastTick = null;
  }

  /**
   * @param {ReturnType<import('../sim/simulation.js').Simulation['snapshot']>} snapshot
   * @param {boolean} [enabled]
   */
  allocate(snapshot, enabled = true) {
    if (!enabled || this.capacity === 0) {
      this.reset();
      return [];
    }
    if (this.lastTick !== null && snapshot.tick < this.lastTick) this.reset();
    this.lastTick = snapshot.tick;

    const assignments = [];
    const explosions = snapshot.recentEvents
      .filter((event) => {
        const age = snapshot.tick - event.tick;
        return event.type === "explosion" && age >= 0 && age < this.explosionLifetimeTicks;
      })
      .sort((left, right) => {
        const ageDifference = (snapshot.tick - left.tick) - (snapshot.tick - right.tick);
        return ageDifference || Number(left.id) - Number(right.id);
      });
    for (const event of explosions) {
      if (assignments.length >= this.capacity) break;
      const age = snapshot.tick - event.tick;
      const life = clamp(1 - age / this.explosionLifetimeTicks, 0, 1);
      const pulse = life * (0.18 + life * 0.82);
      assignments.push({
        key: `explosion:${event.id}`,
        kind: "explosion",
        sourceId: Number(event.id),
        x: Number(event.originX),
        y: 0.55,
        z: Number(event.originZ),
        color: mixColor(FIRE_COLORS.amber, FIRE_COLORS.core, life),
        intensity: 52 * pulse,
        distance: 5,
        decay: 2,
      });
    }

    const projectiles = [...snapshot.projectiles]
      .sort((left, right) => Number(left.id) - Number(right.id));
    for (const projectile of projectiles) {
      if (assignments.length >= this.capacity) break;
      const life = particleLife(projectile);
      assignments.push({
        key: `projectile:${projectile.id}`,
        kind: "projectile",
        sourceId: Number(projectile.id),
        x: Number(projectile.x),
        y: 0.9,
        z: Number(projectile.z),
        color: mixColor(FIRE_COLORS.amber, FIRE_COLORS.core, 0.68 + life * 0.22),
        intensity: 22,
        distance: 3,
        decay: 2,
      });
    }

    const particlesById = new Map();
    const newlyObserved = [];
    for (const particle of snapshot.particles) {
      const id = Number(particle.id);
      particlesById.set(id, particle);
      if (this.observedSparkIds.has(id)) continue;
      this.observedSparkIds.add(id);
      newlyObserved.push({
        particle,
        life: particleLife(particle),
      });
    }
    for (const id of this.sparkLeases.keys()) {
      if (!particlesById.has(id)) this.sparkLeases.delete(id);
    }

    const available = this.capacity - assignments.length;
    const retained = [...this.sparkLeases.entries()]
      .filter(([id]) => particlesById.has(id))
      .sort((left, right) => left[1] - right[1])
      .slice(0, available);
    const selectedIds = new Set(retained.map(([id]) => id));
    const selected = retained.map(([id]) => {
      const particle = particlesById.get(id);
      return {
        particle,
        life: particleLife(particle),
      };
    });
    this.sparkLeases = new Map(retained);

    const candidates = newlyObserved
      .filter(({ particle }) => particle.currentSize > 0)
      .sort((left, right) => {
        const leftScore = left.particle.currentSize * (0.35 + left.life * 0.65);
        const rightScore = right.particle.currentSize * (0.35 + right.life * 0.65);
        return rightScore - leftScore || Number(left.particle.id) - Number(right.particle.id);
      });
    for (const candidate of candidates) {
      if (selected.length >= available) break;
      const id = Number(candidate.particle.id);
      if (selectedIds.has(id)) continue;
      this.sparkLeases.set(id, this.nextLease);
      this.nextLease += 1;
      selectedIds.add(id);
      selected.push(candidate);
    }

    const sizeRange = Math.max(1e-9, PARTICLE.maximumSize - PARTICLE.minimumSize);
    for (const candidate of selected) {
      if (!candidate) continue;
      const particle = candidate.particle;
      const normalizedMaximumSize = clamp(
        (particle.size - PARTICLE.minimumSize) / sizeRange,
        0,
        1,
      );
      const fade = candidate.life * candidate.life * (3 - 2 * candidate.life);
      assignments.push({
        key: `particle:${particle.id}`,
        kind: "particle",
        sourceId: Number(particle.id),
        x: Number(particle.x),
        y: Math.max(0.08, Number(particle.y) + Number(particle.currentSize)),
        z: Number(particle.z),
        color: sparkFireColor(candidate.life),
        intensity: (4 + 9 * normalizedMaximumSize) * fade,
        distance: 1.5,
        decay: 2,
      });
    }

    return assignments;
  }
}

export const EXPLOSION_LIGHT_SECONDS = EXPLOSION.debugTicks / SIMULATION.tickHz;
