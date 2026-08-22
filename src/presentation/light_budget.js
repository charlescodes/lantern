// @ts-check

import { EXPLOSION, PARTICLE, SIMULATION } from "../config.js";
import {
  FIREBALL_COLOR_FLIGHT_LIGHT,
  FIREBALL_COLOR_IMPACT_LIGHT,
  FIREBALL_COLOR_PARTICLE,
  writeFireballPaletteColor,
} from "../spells/palette.js";
import { fireballDefinitionFromSnapshot } from "../spells/snapshot.js";

export const PRESENTATION_LIGHT_GROUP_SIZE = 8;
export const PRESENTATION_SPARK_LIGHTS_PER_GROUP = 7;
export const SUPPORTED_PRESENTATION_LIGHT_CAPACITIES = Object.freeze([
  8,
  16,
  32,
  64,
]);
export const PRESENTATION_LIGHT_CAPACITY = 16;

const ORPHAN_PROJECTILE_ID = "orphan";
const PHASE_PRIORITY = Object.freeze({
  impact: 0,
  flight: 1,
  tail: 2,
});
const FIRE_COLORS = Object.freeze({
  core: Object.freeze({ r: 1, g: 0.94, b: 0.56 }),
  amber: Object.freeze({ r: 1, g: 0.47, b: 0.08 }),
  decay: Object.freeze({ r: 0.94, g: 0.12, b: 0.025 }),
});
const TINT_ANCHORS = Object.freeze([
  Object.freeze({ name: "red", r: 1, g: 0.3, b: 0.16 }),
  Object.freeze({ name: "green", r: 0.72, g: 1, b: 0.3 }),
  Object.freeze({ name: "blue", r: 0.5, g: 0.7, b: 1 }),
]);

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
 * mesh path does not allocate one temporary RGB object per instance.
 * Point-light tinting deliberately happens elsewhere.
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

/** @param {{r:number,g:number,b:number}} color */
export function rec709Luminance(color) {
  return color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722;
}

/** @param {number} seed @param {number|string} projectileId */
export function deriveFireballTint(seed, projectileId) {
  const numericId = projectileId === ORPHAN_PROJECTILE_ID
    ? 0x6f727068
    : Number(projectileId) >>> 0;
  let hash = (Number(seed) >>> 0) ^ numericId ^ 0x9e3779b9;
  hash = Math.imul(hash ^ (hash >>> 16), 0x21f0aaad);
  hash = Math.imul(hash ^ (hash >>> 15), 0x735a2d97);
  hash = (hash ^ (hash >>> 15)) >>> 0;
  const anchor = TINT_ANCHORS[hash % TINT_ANCHORS.length];
  const amount = 0.01 + (((hash >>> 8) & 0xffff) / 0xffff) * 0.02;
  return Object.freeze({
    anchor: anchor.name,
    amount,
    color: anchor,
  });
}

/**
 * Mixes a deterministic bias into a fire color, then restores the original
 * Rec.709 luminance. Values above one are allowed for HDR point-light colors.
 * @param {{r:number,g:number,b:number}} color
 * @param {ReturnType<typeof deriveFireballTint>} tint
 * @param {boolean} [enabled]
 */
export function applyFireballTint(color, tint, enabled = true) {
  if (!enabled) return { ...color };
  const mixed = mixColor(color, tint.color, tint.amount);
  const sourceLuminance = rec709Luminance(color);
  const mixedLuminance = rec709Luminance(mixed);
  const scale = mixedLuminance > 1e-12 ? sourceLuminance / mixedLuminance : 1;
  return {
    r: mixed.r * scale,
    g: mixed.g * scale,
    b: mixed.b * scale,
  };
}

/** @param {Record<string, any>} particle */
function particleLife(particle) {
  if (!(particle.lifetime > 0)) return 0;
  return clamp(1 - particle.age / particle.lifetime, 0, 1);
}

/** @param {Record<string, any>} left @param {Record<string, any>} right */
function compareCarrierCandidates(left, right) {
  const maximumSize = Number(right.size) - Number(left.size);
  if (Math.abs(maximumSize) > 1e-12) return maximumSize;
  const leftLife = particleLife(left);
  const rightLife = particleLife(right);
  const leftScore = Number(left.currentSize) * (0.35 + leftLife * 0.65);
  const rightScore = Number(right.currentSize) * (0.35 + rightLife * 0.65);
  return rightScore - leftScore || Number(left.id) - Number(right.id);
}

/** @param {Record<string, any>} left @param {Record<string, any>} right */
function compareRecentEffect(left, right) {
  return Number(right.effectTick) - Number(left.effectTick)
    || PHASE_PRIORITY[left.phase] - PHASE_PRIORITY[right.phase]
    || sortableId(left.projectileId) - sortableId(right.projectileId);
}

/** @param {number|string} value */
function sortableId(value) {
  return value === ORPHAN_PROJECTILE_ID
    ? Number.MAX_SAFE_INTEGER
    : Number(value);
}

/** @param {Record<string, any>} particle @param {Array<Record<string, any>>} events */
function nearestEvent(particle, events) {
  let selected = null;
  let selectedDistance = Number.POSITIVE_INFINITY;
  for (const event of events) {
    const dx = Number(particle.x) - Number(event.originX);
    const dz = Number(particle.z) - Number(event.originZ);
    const distance = dx * dx + dz * dz;
    if (
      distance < selectedDistance - 1e-12
      || (
        Math.abs(distance - selectedDistance) <= 1e-12
        && Number(event.id) < Number(selected?.id ?? Number.MAX_SAFE_INTEGER)
      )
    ) {
      selected = event;
      selectedDistance = distance;
    }
  }
  return selected;
}

export class PresentationLightBudget {
  /** @param {{capacity?:number,explosionLifetimeTicks?:number}} [options] */
  constructor(options = {}) {
    const capacity = Math.trunc(
      options.capacity ?? PRESENTATION_LIGHT_CAPACITY,
    );
    if (!SUPPORTED_PRESENTATION_LIGHT_CAPACITIES.includes(capacity)) {
      throw new RangeError(
        `Light capacity must be one of ${SUPPORTED_PRESENTATION_LIGHT_CAPACITIES.join(", ")}`,
      );
    }
    this.capacity = capacity;
    this.groupCapacity = capacity / PRESENTATION_LIGHT_GROUP_SIZE;
    this.explosionLifetimeTicks = Math.max(
      1,
      Math.trunc(options.explosionLifetimeTicks ?? EXPLOSION.debugTicks),
    );
    this.groups = new Map();
    this.observedParticleIds = new Set();
    this.observedEventIds = new Set();
    this.retiredTailProjectileIds = new Set();
    this.currentOrphanKey = null;
    this.orphanGeneration = 0;
    this.lastTick = null;
    this.lastSeed = null;
    this.lastLayerId = null;
  }

  reset() {
    this.groups.clear();
    this.observedParticleIds.clear();
    this.observedEventIds.clear();
    this.retiredTailProjectileIds.clear();
    this.currentOrphanKey = null;
    this.orphanGeneration = 0;
    this.lastTick = null;
    this.lastSeed = null;
    this.lastLayerId = null;
  }

  /**
   * @param {ReturnType<import('../sim/simulation.js').Simulation['snapshot']>} snapshot
   * @param {boolean} [enabled]
   * @param {boolean} [colorVariation]
   * @param {string|null} [activeLayerId]
   */
  allocate(snapshot, enabled = true, colorVariation = true, activeLayerId = null) {
    if (!enabled) {
      this.reset();
      return [];
    }
    const layerId = activeLayerId === null ? null : String(activeLayerId);
    const layerChanged = this.lastLayerId !== null && layerId !== this.lastLayerId;
    if (layerChanged) this.reset();
    this.lastLayerId = layerId;
    const onActiveLayer = (value) => (
      layerId === null
      || value.layerId === undefined
      || value.layerId === null
      || value.layerId === layerId
    );
    const visibleParticles = snapshot.particles.filter(onActiveLayer);
    const visibleProjectiles = snapshot.projectiles.filter(onActiveLayer);
    const visibleRecentEvents = snapshot.recentEvents.filter(onActiveLayer);
    const transientTimelineCleared = this.lastTick !== null
      && visibleRecentEvents.length === 0
      && (
        this.observedEventIds.size > 0
        || (
          visibleProjectiles.length === 0
          && visibleParticles.length === 0
          && (this.groups.size > 0 || this.observedParticleIds.size > 0)
        )
      );
    if (
      (this.lastTick !== null && Number(snapshot.tick) < this.lastTick)
      || (
        this.lastSeed !== null
        && Number(snapshot.seed ?? 0) !== this.lastSeed
      )
      || transientTimelineCleared
    ) {
      this.reset();
    }
    this.lastTick = Number(snapshot.tick);
    this.lastSeed = Number(snapshot.seed ?? 0);

    const particlesById = new Map(
      visibleParticles.map((particle) => [Number(particle.id), particle]),
    );
    const projectilesById = new Map(
      visibleProjectiles.map((projectile) => [Number(projectile.id), projectile]),
    );
    const currentEventIds = new Set(
      visibleRecentEvents
        .filter((event) => event.type === "explosion")
        .map((event) => Number(event.id)),
    );
    const newEvents = visibleRecentEvents
      .filter((event) => (
        event.type === "explosion"
        && !this.observedEventIds.has(Number(event.id))
      ))
      .sort((left, right) => (
        Number(left.tick) - Number(right.tick)
        || Number(left.id) - Number(right.id)
      ));
    this.observedEventIds = currentEventIds;

    const newParticles = [];
    for (const particle of visibleParticles) {
      const id = Number(particle.id);
      if (this.observedParticleIds.has(id)) continue;
      this.observedParticleIds.add(id);
      newParticles.push(particle);
    }
    this.observedParticleIds = new Set(particlesById.keys());
    const relevantProjectileIds = new Set(
      visibleRecentEvents
        .filter((event) => event.type === "explosion")
        .map((event) => Number(event.projectileId ?? event.id)),
    );
    for (const projectileId of this.retiredTailProjectileIds) {
      if (!relevantProjectileIds.has(projectileId)) {
        this.retiredTailProjectileIds.delete(projectileId);
      }
    }

    const admissionRequests = new Set();
    for (const projectile of [...visibleProjectiles].sort(
      (left, right) => Number(left.id) - Number(right.id),
    )) {
      const projectileId = Number(projectile.id);
      const key = this.#projectileKey(projectileId);
      let group = this.groups.get(key);
      if (!group) {
        group = this.#createGroup(
          key,
          projectileId,
          "flight",
          Number(snapshot.tick),
          Number(snapshot.seed ?? 0),
        );
        this.groups.set(key, group);
        admissionRequests.add(key);
      }
      if (group.phase === "flight") {
        group.projectile = projectile;
        group.effectSeed = Number(projectile.effectSeed ?? 0);
        group.spellCode = Number(projectile.spellCode ?? 0);
        group.definitionRevision = Number(projectile.definitionRevision ?? 0);
      }
    }

    const associatedParticles = new Map();
    const orphanParticles = [];
    for (const particle of newParticles) {
      const effectId = Number(particle.effectId ?? 0);
      const event = effectId > 0
        ? newEvents.find((candidate) => (
          Number(candidate.effectId ?? 0) === effectId
          && Number(candidate.spellCode ?? 0) === Number(particle.spellCode ?? 0)
        )) ?? nearestEvent(particle, newEvents)
        : nearestEvent(particle, newEvents);
      if (!event) {
        orphanParticles.push(particle);
        continue;
      }
      const projectileId = Number(event.projectileId ?? event.id);
      const list = associatedParticles.get(projectileId) ?? [];
      list.push(particle);
      associatedParticles.set(projectileId, list);
    }

    for (const event of newEvents) {
      const projectileId = Number(event.projectileId ?? event.id);
      if (this.retiredTailProjectileIds.has(projectileId)) continue;
      const key = this.#projectileKey(projectileId);
      let group = this.groups.get(key);
      if (!group) {
        group = this.#createGroup(
          key,
          projectileId,
          "impact",
          Number(event.tick),
          Number(snapshot.seed ?? 0),
        );
        this.groups.set(key, group);
      }
      const wasAdmitted = group.admitted;
      group.phase = "impact";
      group.effectTick = Number(event.tick);
      group.effectId = Number(event.id);
      group.effectSeed = Number(event.effectSeed ?? 0);
      group.spellCode = Number(event.spellCode ?? 0);
      group.definitionRevision = Number(event.definitionRevision ?? 0);
      group.event = event;
      group.projectile = null;
      group.carriers = this.#selectCarriers(
        associatedParticles.get(projectileId) ?? [],
      );
      if (!wasAdmitted) {
        group.retired = false;
        admissionRequests.add(key);
      }
    }

    for (const group of this.groups.values()) {
      if (group.phase !== "impact" || !group.event) continue;
      const age = Number(snapshot.tick) - Number(group.event.tick);
      const lifetimeTicks = Number(group.event.visualLifetime) > 0
        ? Math.max(1, Math.round(Number(group.event.visualLifetime) * SIMULATION.tickHz))
        : this.explosionLifetimeTicks;
      if (age >= lifetimeTicks) group.phase = "tail";
    }

    this.#retireCompletedGroups(particlesById, projectilesById);

    if (orphanParticles.length > 0 && !this.#activeOrphanGroup()) {
      this.orphanGeneration += 1;
      const key = `orphan:${this.orphanGeneration}`;
      const group = this.#createGroup(
        key,
        ORPHAN_PROJECTILE_ID,
        "tail",
        Number(snapshot.tick),
        Number(snapshot.seed ?? 0),
      );
      group.effectId = this.orphanGeneration;
      group.carriers = this.#selectCarriers(orphanParticles);
      this.groups.set(key, group);
      this.currentOrphanKey = key;
      admissionRequests.add(key);
    }

    this.#reconcileAdmissions(admissionRequests);
    for (const projectileId of this.retiredTailProjectileIds) {
      if (!relevantProjectileIds.has(projectileId)) {
        this.retiredTailProjectileIds.delete(projectileId);
      }
    }

    const assignments = [];
    for (const group of [...this.groups.values()]
      .filter((candidate) => candidate.admitted)
      .sort((left, right) => left.block - right.block)) {
      this.#appendGroupAssignments(
        assignments,
        group,
        snapshot,
        particlesById,
        projectilesById,
        colorVariation,
      );
    }
    return assignments;
  }

  diagnostics() {
    const admitted = [...this.groups.values()].filter((group) => group.admitted);
    return {
      capacity: this.capacity,
      groupCapacity: this.groupCapacity,
      admittedGroupCount: admitted.length,
      groups: admitted
        .sort((left, right) => left.block - right.block)
        .map((group) => ({
          projectileId: group.projectileId,
          phase: group.phase,
          block: group.block,
          carrierIds: group.carriers.map((carrier) => carrier.id),
        })),
    };
  }

  /** @param {number} projectileId */
  #projectileKey(projectileId) {
    return `projectile:${projectileId}`;
  }

  /**
   * @param {string} key
   * @param {number|string} projectileId
   * @param {"flight"|"impact"|"tail"} phase
   * @param {number} effectTick
   * @param {number} seed
   */
  #createGroup(key, projectileId, phase, effectTick, seed) {
    return {
      key,
      projectileId,
      phase,
      effectTick,
      effectId: 0,
      admitted: false,
      retired: false,
      block: -1,
      projectile: null,
      event: null,
      carriers: [],
      tint: deriveFireballTint(seed, projectileId),
      effectSeed: 0,
      spellCode: 0,
      definitionRevision: 0,
    };
  }

  /** @param {Array<Record<string, any>>} particles */
  #selectCarriers(particles) {
    return [...particles]
      .filter((particle) => Number(particle.currentSize) > 0)
      .sort(compareCarrierCandidates)
      .slice(0, PRESENTATION_SPARK_LIGHTS_PER_GROUP)
      .map((particle, index) => ({
        id: Number(particle.id),
        slot: index + 1,
      }));
  }

  #activeOrphanGroup() {
    if (!this.currentOrphanKey) return null;
    return this.groups.get(this.currentOrphanKey) ?? null;
  }

  /** @param {Map<number,Record<string,any>>} particlesById @param {Map<number,Record<string,any>>} projectilesById */
  #retireCompletedGroups(particlesById, projectilesById) {
    for (const [key, group] of this.groups) {
      if (
        group.phase === "flight"
        && !projectilesById.has(Number(group.projectileId))
        && !group.event
      ) {
        this.groups.delete(key);
        continue;
      }
      const liveCarrierCount = group.carriers.reduce(
        (count, carrier) => count + Number(particlesById.has(carrier.id)),
        0,
      );
      if (group.phase === "tail" && liveCarrierCount === 0) {
        if (group.projectileId !== ORPHAN_PROJECTILE_ID) {
          this.retiredTailProjectileIds.add(Number(group.projectileId));
        }
        if (key === this.currentOrphanKey) this.currentOrphanKey = null;
        this.groups.delete(key);
      }
    }
  }

  /** @param {Set<string>} admissionRequests */
  #reconcileAdmissions(admissionRequests) {
    const candidates = [...this.groups.values()].filter(
      (group) => group.admitted || admissionRequests.has(group.key),
    );
    candidates.sort(compareRecentEffect);
    const winnerKeys = new Set(
      candidates.slice(0, this.groupCapacity).map((group) => group.key),
    );

    for (const group of candidates) {
      if (winnerKeys.has(group.key)) continue;
      group.admitted = false;
      group.block = -1;
      group.retired = true;
      if (group.phase !== "flight" && group.projectileId !== ORPHAN_PROJECTILE_ID) {
        this.retiredTailProjectileIds.add(Number(group.projectileId));
      }
    }

    const occupiedBlocks = new Set(
      candidates
        .filter((group) => winnerKeys.has(group.key) && group.admitted)
        .map((group) => group.block),
    );
    const freeBlocks = [];
    for (let block = 0; block < this.groupCapacity; block += 1) {
      if (!occupiedBlocks.has(block)) freeBlocks.push(block);
    }
    for (const group of candidates.filter(
      (candidate) => winnerKeys.has(candidate.key) && !candidate.admitted,
    )) {
      group.admitted = true;
      group.retired = false;
      group.block = freeBlocks.shift();
    }
  }

  /**
   * @param {Array<Record<string,any>>} assignments
   * @param {Record<string,any>} group
   * @param {ReturnType<import('../sim/simulation.js').Simulation['snapshot']>} snapshot
   * @param {Map<number,Record<string,any>>} particlesById
   * @param {Map<number,Record<string,any>>} projectilesById
   * @param {boolean} colorVariation
   */
  #appendGroupAssignments(
    assignments,
    group,
    snapshot,
    particlesById,
    projectilesById,
    colorVariation,
  ) {
    const residentBase = group.block * PRESENTATION_LIGHT_GROUP_SIZE;
    const useRevisionPalette = Array.isArray(snapshot.spells);
    if (group.phase === "flight") {
      const projectile = projectilesById.get(Number(group.projectileId));
      if (projectile) {
        const life = particleLife(projectile);
        const definition = fireballDefinitionFromSnapshot(snapshot, projectile);
        const color = { r: 0, g: 0, b: 0 };
        if (useRevisionPalette) {
          writeFireballPaletteColor(color, definition, {
            kind: FIREBALL_COLOR_FLIGHT_LIGHT,
            life,
            effectSeed: projectile.effectSeed,
            variationEnabled: colorVariation,
          });
        }
        assignments.push(this.#assignment(group, 0, {
          kind: "projectile",
          sourceId: Number(projectile.id),
          x: Number(projectile.x),
          y: 0.9,
          z: Number(projectile.z),
          color: useRevisionPalette
            ? color
            : mixColor(FIRE_COLORS.amber, FIRE_COLORS.core, 0.68 + life * 0.22),
          paletteSampled: useRevisionPalette,
          intensity: Number(definition.presentation.flightLightIntensity),
          distance: Number(definition.presentation.flightLightRange),
          decay: Number(definition.presentation.flightLightDecay),
        }, residentBase, colorVariation));
      }
    } else if (group.event) {
      const age = Number(snapshot.tick) - Number(group.event.tick);
      const lifetimeTicks = Number(group.event.visualLifetime) > 0
        ? Math.max(1, Math.round(Number(group.event.visualLifetime) * SIMULATION.tickHz))
        : this.explosionLifetimeTicks;
      if (age >= 0 && age < lifetimeTicks) {
        const life = clamp(1 - age / lifetimeTicks, 0, 1);
        const pulse = life * (0.18 + life * 0.82);
        const definition = fireballDefinitionFromSnapshot(snapshot, group.event);
        const color = { r: 0, g: 0, b: 0 };
        if (useRevisionPalette) {
          writeFireballPaletteColor(color, definition, {
            kind: FIREBALL_COLOR_IMPACT_LIGHT,
            life,
            effectSeed: group.event.effectSeed,
            variationEnabled: colorVariation,
          });
        }
        assignments.push(this.#assignment(group, 0, {
          kind: "explosion",
          sourceId: Number(group.event.id),
          x: Number(group.event.originX),
          y: 0.55,
          z: Number(group.event.originZ),
          color: useRevisionPalette
            ? color
            : mixColor(FIRE_COLORS.amber, FIRE_COLORS.core, life),
          paletteSampled: useRevisionPalette,
          intensity: Number(definition.presentation.impactLightIntensity) * pulse,
          distance: Number(definition.presentation.impactLightRange),
          decay: Number(definition.presentation.impactLightDecay),
        }, residentBase, colorVariation));
      }
    }

    for (const carrier of group.carriers) {
      const particle = particlesById.get(carrier.id);
      if (!particle) continue;
      const life = particleLife(particle);
      const definition = fireballDefinitionFromSnapshot(snapshot, particle);
      const minimumSize = Number(
        definition.particleLifecycle.sizeMinimum ?? PARTICLE.minimumSize,
      );
      const maximumSize = Number(
        definition.particleLifecycle.sizeMaximum ?? PARTICLE.maximumSize,
      );
      const sizeRange = Math.max(1e-9, maximumSize - minimumSize);
      const normalizedMaximumSize = clamp(
        (Number(particle.size) - minimumSize) / sizeRange,
        0,
        1,
      );
      const fade = life * life * (3 - 2 * life);
      const color = { r: 0, g: 0, b: 0 };
      if (useRevisionPalette) {
        writeFireballPaletteColor(color, definition, {
          kind: FIREBALL_COLOR_PARTICLE,
          life,
          effectSeed: particle.effectSeed,
          sampleOrdinal: particle.sampleOrdinal,
          sampleSeed: particle.sampleSeed,
          variationEnabled: colorVariation,
        });
      }
      assignments.push(this.#assignment(group, carrier.slot, {
        kind: "particle",
        sourceId: Number(particle.id),
        x: Number(particle.x),
        y: Math.max(0.08, Number(particle.y) + Number(particle.currentSize)),
        z: Number(particle.z),
        color: useRevisionPalette ? color : sparkFireColor(life),
        paletteSampled: useRevisionPalette,
        intensity: Number(definition.presentation.sparkLightIntensity)
          * ((4 + 9 * normalizedMaximumSize) / 13)
          * fade,
        distance: Number(definition.presentation.sparkLightRange),
        decay: Number(definition.presentation.sparkLightDecay),
      }, residentBase, colorVariation));
    }
  }

  /**
   * @param {Record<string,any>} group
   * @param {number} groupSlot
   * @param {Record<string,any>} value
   * @param {number} residentBase
   * @param {boolean} colorVariation
   */
  #assignment(group, groupSlot, value, residentBase, colorVariation) {
    return {
      key: `effect:${group.key}:${groupSlot}`,
      groupKey: group.key,
      projectileId: group.projectileId,
      groupSlot,
      residentSlot: residentBase + groupSlot,
      tint: {
        anchor: group.tint.anchor,
        amount: group.tint.amount,
      },
      spellCode: group.spellCode,
      definitionRevision: group.definitionRevision,
      effectSeed: group.effectSeed,
      ...value,
      color: value.paletteSampled
        ? value.color
        : applyFireballTint(value.color, group.tint, colorVariation),
    };
  }
}

export const EXPLOSION_LIGHT_SECONDS = EXPLOSION.debugTicks / SIMULATION.tickHz;
