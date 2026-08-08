// @ts-check

import { ACTOR_TEAM, PERCEPTIVE_WIZARD, SIMULATION } from "../config.js";
import { mixUint32 } from "../spells/random.js";
import { gridRayBlocked } from "./collision.js";
import { NAVIGATION_NEIGHBORS } from "./navigation_field.js";

export const PERCEPTION_STATE = Object.freeze({
  unaware: 0,
  noticing: 1,
  engaged: 2,
  hunting: 3,
  returning: 4,
  investigating: 5,
});

export const PERCEPTION_STATE_NAMES = Object.freeze([
  "unaware",
  "noticing",
  "engaged",
  "hunting",
  "returning",
  "investigating",
]);

export const KNOWLEDGE_SOURCE = Object.freeze({
  none: 0,
  visual: 1,
  damage: 2,
  projectile: 3,
  sound: 4,
});

export const KNOWLEDGE_SOURCE_NAMES = Object.freeze([
  "none",
  "visual",
  "damage",
  "projectile",
  "sound",
]);

export const INVESTIGATION_PRIORITY = Object.freeze({
  none: 0,
  sound: 1,
  damage: 2,
  lastSeen: 3,
  projectile: 4,
  directSight: 5,
});

export const INVESTIGATION_DECISION = Object.freeze({
  accept: "accept",
  deduplicate: "deduplicate",
  priorityReject: "priority-reject",
  staleReject: "stale-reject",
});

/**
 * Investigation anchors are cell-addressable world points. Keeping them on
 * cell centers at the map edge prevents a reconstructed launch point from
 * producing an out-of-bounds navigation key.
 * @param {{width:number,height:number}} map
 * @param {number} x
 * @param {number} z
 */
export function clampInvestigationAnchor(map, x, z) {
  const minimumX = map.width > 0 ? 0.5 : 0;
  const minimumZ = map.height > 0 ? 0.5 : 0;
  const maximumX = Math.max(minimumX, map.width - 0.5);
  const maximumZ = Math.max(minimumZ, map.height - 0.5);
  return {
    x: Math.max(minimumX, Math.min(maximumX, Number(x))),
    z: Math.max(minimumZ, Math.min(maximumZ, Number(z))),
  };
}

/**
 * Fireball motion is authoritative, so a single pose, velocity, and age
 * sample reconstructs the launch point without consulting ownership.
 * @param {{width:number,height:number}} map
 * @param {{x:number,z:number,vx:number,vz:number,age:number}} projectile
 */
export function inferProjectileOrigin(map, projectile) {
  const age = Math.max(0, Number(projectile.age) || 0);
  const rawX = Number(projectile.x) - Number(projectile.vx) * age;
  const rawZ = Number(projectile.z) - Number(projectile.vz) * age;
  const clamped = clampInvestigationAnchor(map, rawX, rawZ);
  return {
    ...clamped,
    rawX,
    rawZ,
    clamped: clamped.x !== rawX || clamped.z !== rawZ,
  };
}

/** @param {{effectId?:number,projectileId?:number}} left @param {{effectId?:number,projectileId?:number}} right */
function sameEffect(left, right) {
  const leftEffect = Number(left.effectId) >>> 0;
  const rightEffect = Number(right.effectId) >>> 0;
  if (leftEffect > 0 || rightEffect > 0) return leftEffect > 0 && leftEffect === rightEffect;
  const leftProjectile = Number(left.projectileId) >>> 0;
  const rightProjectile = Number(right.projectileId) >>> 0;
  return leftProjectile > 0 && leftProjectile === rightProjectile;
}

/**
 * Pure clue arbitration used by every v9 sensing path. Later observations win
 * within a priority; same-tick freshness is the unsigned effect/projectile ID
 * tuple. A projectile's later samples and explosion are recognized first so
 * they update diagnostics without restarting movement.
 * @param {{priority?:number,observationTick?:number,effectId?:number,projectileId?:number}} current
 * @param {{priority?:number,observationTick?:number,effectId?:number,projectileId?:number}} incoming
 */
export function arbitrateInvestigationClue(current, incoming) {
  if (sameEffect(current, incoming)) {
    return { decision: INVESTIGATION_DECISION.deduplicate, reason: "same-effect" };
  }
  const currentPriority = Math.max(0, Number(current.priority) || 0);
  const incomingPriority = Math.max(0, Number(incoming.priority) || 0);
  if (incomingPriority > currentPriority) {
    return { decision: INVESTIGATION_DECISION.accept, reason: "higher-priority" };
  }
  if (incomingPriority < currentPriority) {
    return { decision: INVESTIGATION_DECISION.priorityReject, reason: "lower-priority" };
  }
  const currentTick = Number(current.observationTick) >>> 0;
  const incomingTick = Number(incoming.observationTick) >>> 0;
  if (incomingTick > currentTick) {
    return { decision: INVESTIGATION_DECISION.accept, reason: "newer" };
  }
  if (incomingTick < currentTick) {
    return { decision: INVESTIGATION_DECISION.staleReject, reason: "older" };
  }
  const currentEffect = Number(current.effectId) >>> 0;
  const incomingEffect = Number(incoming.effectId) >>> 0;
  if (incomingEffect > currentEffect) {
    return { decision: INVESTIGATION_DECISION.accept, reason: "same-tick-effect" };
  }
  if (incomingEffect < currentEffect) {
    return { decision: INVESTIGATION_DECISION.staleReject, reason: "same-tick-effect" };
  }
  const currentProjectile = Number(current.projectileId) >>> 0;
  const incomingProjectile = Number(incoming.projectileId) >>> 0;
  if (incomingProjectile > currentProjectile) {
    return { decision: INVESTIGATION_DECISION.accept, reason: "same-tick-projectile" };
  }
  return { decision: INVESTIGATION_DECISION.staleReject, reason: "not-newer" };
}

/**
 * Geometry-free Fireball hearing. A zero team is neutral; allied and neutral
 * sources are ineligible before the inclusive distance boundary is applied.
 * @param {number} listenerX
 * @param {number} listenerZ
 * @param {number} listenerTeam
 * @param {number} impactX
 * @param {number} impactZ
 * @param {number} sourceTeam
 * @param {number} [radius]
 */
export function fireballHearingCheck(
  listenerX,
  listenerZ,
  listenerTeam,
  impactX,
  impactZ,
  sourceTeam,
  radius = PERCEPTIVE_WIZARD.fireballHearingMeters,
) {
  const dx = Number(listenerX) - Number(impactX);
  const dz = Number(listenerZ) - Number(impactZ);
  const distanceSquared = dx * dx + dz * dz;
  const maximum = Math.max(0, Number(radius) || 0);
  const hostile = Number(sourceTeam) > 0 && Number(sourceTeam) !== Number(listenerTeam);
  const inRange = distanceSquared <= maximum * maximum + 1e-9;
  return {
    heard: hostile && inRange,
    hostile,
    inRange,
    distance: Math.sqrt(distanceSquared),
  };
}

export const HUNT_PHASE = Object.freeze({
  none: 0,
  travel: 1,
  search: 2,
});

export const HUNT_PHASE_NAMES = Object.freeze(["none", "travel", "search"]);

export const TARGET_KIND = Object.freeze({
  none: 0,
  player: 1,
});

export const TARGET_KIND_NAMES = Object.freeze(["none", "player"]);

const LANE_HASHES = Object.freeze({
  "fallback-heading": 0xd901_43af,
  "guard-sweep-phase": 0x83e2_a65b,
  "search-rotation": 0x3f76_b291,
  "search-reverse": 0x912b_06cd,
  "search-scan-phase": 0x6a58_f1e7,
});

/**
 * Enemy-local named lanes are isolated from global RNG and every other mob.
 * @param {number} simulationSeed
 * @param {number} spawnSequence
 * @param {keyof typeof LANE_HASHES|string} lane
 * @param {number} [ordinal]
 */
export function perceptiveLaneUint32(simulationSeed, spawnSequence, lane, ordinal = 0) {
  const laneHash = LANE_HASHES[/** @type {keyof typeof LANE_HASHES} */ (lane)];
  if (laneHash === undefined) throw new RangeError(`Unknown perceptive lane: ${lane}`);
  let hash = mixUint32((Number(simulationSeed) >>> 0) ^ 0x08a1_7e50);
  hash = mixUint32(hash ^ Math.imul(Number(spawnSequence) >>> 0, 0x9e37_79b1));
  hash = mixUint32(hash ^ laneHash);
  return mixUint32(hash ^ Math.imul((Number(ordinal) + 1) >>> 0, 0x85eb_ca77));
}

/** @param {number} simulationSeed @param {number} spawnSequence */
export function deterministicGuardHeading(simulationSeed, spawnSequence) {
  const ordinal = perceptiveLaneUint32(
    simulationSeed,
    spawnSequence,
    "fallback-heading",
  ) % 8;
  const angle = ordinal * Math.PI / 4;
  return { x: Math.cos(angle), z: Math.sin(angle), ordinal };
}

/** @param {number} simulationSeed @param {number} spawnSequence */
export function deterministicGuardSweepPhase(simulationSeed, spawnSequence) {
  return perceptiveLaneUint32(
    simulationSeed,
    spawnSequence,
    "guard-sweep-phase",
  ) % PERCEPTIVE_WIZARD.guardSweepCycleTicks;
}

/**
 * @param {{get(cx:number,cz:number):number}} map
 * @param {number} originX
 * @param {number} originZ
 * @param {number} facingX
 * @param {number} facingZ
 * @param {number} targetX
 * @param {number} targetZ
 */
export function visualCheck(
  map,
  originX,
  originZ,
  facingX,
  facingZ,
  targetX,
  targetZ,
) {
  const dx = targetX - originX;
  const dz = targetZ - originZ;
  const distanceSquared = dx * dx + dz * dz;
  const maximumSquared = PERCEPTIVE_WIZARD.visualRangeMeters ** 2;
  if (distanceSquared > maximumSquared + 1e-9) {
    return { visible: false, inRange: false, inCone: false, close: false, blocked: false };
  }
  const distance = Math.sqrt(distanceSquared);
  const close = distance <= PERCEPTIVE_WIZARD.closeAwarenessMeters + 1e-9;
  let inCone = true;
  if (!close && distance > 1e-9) {
    const facingLength = Math.hypot(facingX, facingZ);
    const dot = facingLength > 1e-9
      ? (dx * facingX + dz * facingZ) / (distance * facingLength)
      : -1;
    const cosine = Math.cos(PERCEPTIVE_WIZARD.fieldOfViewDegrees * Math.PI / 360);
    inCone = dot >= cosine - 1e-9;
  }
  if (!close && !inCone) {
    return { visible: false, inRange: true, inCone: false, close: false, blocked: false };
  }
  const blocked = gridRayBlocked(map, originX, originZ, targetX, targetZ);
  return {
    visible: !blocked,
    inRange: true,
    inCone,
    close,
    blocked,
  };
}

/**
 * Rotate a normalized direction toward another direction by a bounded angle.
 * @param {number} currentX
 * @param {number} currentZ
 * @param {number} targetX
 * @param {number} targetZ
 * @param {number} [maximumRadians]
 */
export function turnFacing(
  currentX,
  currentZ,
  targetX,
  targetZ,
  maximumRadians = PERCEPTIVE_WIZARD.maximumTurnRadiansPerSecond * SIMULATION.dt,
) {
  const currentLength = Math.hypot(currentX, currentZ);
  const targetLength = Math.hypot(targetX, targetZ);
  if (targetLength <= 1e-9) {
    return currentLength > 1e-9
      ? { x: currentX / currentLength, z: currentZ / currentLength }
      : { x: 1, z: 0 };
  }
  const currentAngle = currentLength > 1e-9 ? Math.atan2(currentZ, currentX) : 0;
  const targetAngle = Math.atan2(targetZ, targetX);
  let delta = targetAngle - currentAngle;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  const bounded = Math.max(-maximumRadians, Math.min(maximumRadians, delta));
  const angle = currentAngle + bounded;
  return { x: Math.cos(angle), z: Math.sin(angle) };
}

/**
 * Six-second triangle wave constrained to +/-45 degrees around guard heading.
 * @param {number} baseX
 * @param {number} baseZ
 * @param {number} simulationTick
 * @param {number} localPhaseTicks
 */
export function guardSweepFacing(baseX, baseZ, simulationTick, localPhaseTicks) {
  const cycle = PERCEPTIVE_WIZARD.guardSweepCycleTicks;
  const phase = ((simulationTick + localPhaseTicks) % cycle + cycle) % cycle / cycle;
  const triangle = 1 - 4 * Math.abs(phase - 0.5);
  const baseAngle = Math.atan2(baseZ, baseX);
  const angle = baseAngle + triangle * PERCEPTIVE_WIZARD.guardSweepRadians;
  return { x: Math.cos(angle), z: Math.sin(angle), offsetRadians: angle - baseAngle };
}

/**
 * Returns one candidate from radii 1-3 in the canonical N/E/S/W/NE/SE/SW/NW
 * order after one enemy-local rotation/reversal.
 * @param {number} simulationSeed
 * @param {number} spawnSequence
 * @param {number} anchorCx
 * @param {number} anchorCz
 * @param {number} sequence
 */
export function searchCandidate(
  simulationSeed,
  spawnSequence,
  anchorCx,
  anchorCz,
  sequence,
) {
  const directionCount = NAVIGATION_NEIGHBORS.length;
  const rotation = perceptiveLaneUint32(
    simulationSeed,
    spawnSequence,
    "search-rotation",
  ) % directionCount;
  const reversed = (perceptiveLaneUint32(
    simulationSeed,
    spawnSequence,
    "search-reverse",
  ) & 1) === 1;
  const candidatesPerCycle = directionCount * (
    PERCEPTIVE_WIZARD.searchMaximumRadiusCells
    - PERCEPTIVE_WIZARD.searchMinimumRadiusCells
    + 1
  );
  const ordinal = ((Math.trunc(sequence) % candidatesPerCycle) + candidatesPerCycle)
    % candidatesPerCycle;
  const radius = PERCEPTIVE_WIZARD.searchMinimumRadiusCells
    + Math.floor(ordinal / directionCount);
  const directionOrdinal = ordinal % directionCount;
  const transformed = reversed
    ? (rotation - directionOrdinal + directionCount) % directionCount
    : (rotation + directionOrdinal) % directionCount;
  const direction = NAVIGATION_NEIGHBORS[transformed];
  return {
    cx: anchorCx + direction.dx * radius,
    cz: anchorCz + direction.dz * radius,
    x: anchorCx + direction.dx * radius + 0.5,
    z: anchorCz + direction.dz * radius + 0.5,
    radius,
    direction: direction.name,
    canonicalOrdinal: ordinal,
    transformedOrdinal: transformed,
    reversed,
    rotation,
    candidatesPerCycle,
  };
}

/** @param {number} simulationSeed @param {number} spawnSequence @param {number} tick */
export function searchScanFacing(simulationSeed, spawnSequence, tick) {
  const phase = perceptiveLaneUint32(
    simulationSeed,
    spawnSequence,
    "search-scan-phase",
  ) / 0x1_0000_0000;
  const angle = (phase + tick / PERCEPTIVE_WIZARD.searchTicks) * Math.PI * 2;
  return { x: Math.cos(angle), z: Math.sin(angle) };
}

export const PLAYER_TARGET = Object.freeze({
  kind: TARGET_KIND.player,
  id: 1,
  team: ACTOR_TEAM.player,
});
