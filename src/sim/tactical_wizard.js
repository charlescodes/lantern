// @ts-check

import { SIMULATION, TACTICAL_WIZARD } from "../config.js";
import { mixUint32 } from "../spells/random.js";
import { firstSolidContact } from "./collision.js";

const TACTICAL_LANE_HASHES = Object.freeze({
  "strafe-direction": 0x4f1b_bcdd,
  "strafe-duration": 0xa7c3_91e5,
  "dodge-tie": 0x6d2b_79f5,
});

/**
 * Enemy-local named hash lanes. The result depends only on the simulation
 * seed, stable spawn sequence, lane, and caller-owned ordinal.
 * @param {number} simulationSeed
 * @param {number} spawnSequence
 * @param {keyof typeof TACTICAL_LANE_HASHES|string} lane
 * @param {number} [ordinal]
 */
export function tacticalLaneUint32(simulationSeed, spawnSequence, lane, ordinal = 0) {
  const laneHash = TACTICAL_LANE_HASHES[
    /** @type {keyof typeof TACTICAL_LANE_HASHES} */ (lane)
  ];
  if (laneHash === undefined) throw new RangeError(`Unknown tactical lane: ${lane}`);
  let hash = mixUint32((Number(simulationSeed) >>> 0) ^ 0x7ac7_1ca1);
  hash = mixUint32(hash ^ Math.imul(Number(spawnSequence) >>> 0, 0x9e37_79b1));
  hash = mixUint32(hash ^ laneHash);
  return mixUint32(hash ^ Math.imul((Number(ordinal) + 1) >>> 0, 0x85eb_ca77));
}

/** @param {number} simulationSeed @param {number} spawnSequence @param {number} decisionSequence */
export function strafeDecision(simulationSeed, spawnSequence, decisionSequence) {
  const directionHash = tacticalLaneUint32(
    simulationSeed,
    spawnSequence,
    "strafe-direction",
    decisionSequence,
  );
  const durationHash = tacticalLaneUint32(
    simulationSeed,
    spawnSequence,
    "strafe-duration",
    decisionSequence,
  );
  const durationRange = TACTICAL_WIZARD.strafeMaximumTicks
    - TACTICAL_WIZARD.strafeMinimumTicks
    + 1;
  return {
    direction: (directionHash & 1) === 0 ? -1 : 1,
    durationTicks: TACTICAL_WIZARD.strafeMinimumTicks + durationHash % durationRange,
  };
}

/**
 * Returns the smallest positive constant-velocity interception time.
 * @param {number} shooterX
 * @param {number} shooterZ
 * @param {number} targetX
 * @param {number} targetZ
 * @param {number} targetVx
 * @param {number} targetVz
 * @param {number} projectileSpeed
 */
export function solveInterceptTime(
  shooterX,
  shooterZ,
  targetX,
  targetZ,
  targetVx,
  targetVz,
  projectileSpeed,
) {
  if (!(projectileSpeed > 0) || !Number.isFinite(projectileSpeed)) return null;
  const rx = targetX - shooterX;
  const rz = targetZ - shooterZ;
  const a = targetVx * targetVx + targetVz * targetVz - projectileSpeed * projectileSpeed;
  const b = 2 * (rx * targetVx + rz * targetVz);
  const c = rx * rx + rz * rz;
  const epsilon = 1e-9;
  if (c <= epsilon) return null;
  if (Math.abs(a) <= epsilon) {
    if (Math.abs(b) <= epsilon) return null;
    const time = -c / b;
    return time > epsilon && Number.isFinite(time) ? time : null;
  }
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0 || !Number.isFinite(discriminant)) return null;
  const root = Math.sqrt(discriminant);
  const first = (-b - root) / (2 * a);
  const second = (-b + root) / (2 * a);
  let time = Infinity;
  if (first > epsilon && Number.isFinite(first)) time = first;
  if (second > epsilon && Number.isFinite(second)) time = Math.min(time, second);
  return Number.isFinite(time) ? time : null;
}

/**
 * @param {{shooterX:number,shooterZ:number,targetX:number,targetZ:number,targetVx:number,targetVz:number,projectileSpeed:number,projectileLifetime:number}} value
 */
export function predictSoftenedIntercept(value) {
  const interceptTime = solveInterceptTime(
    value.shooterX,
    value.shooterZ,
    value.targetX,
    value.targetZ,
    value.targetVx,
    value.targetVz,
    value.projectileSpeed,
  );
  if (interceptTime === null) {
    return {
      valid: false,
      x: value.targetX,
      z: value.targetZ,
      interceptTime: null,
      clampedTime: 0,
      leadTime: 0,
    };
  }
  const maximumTime = Math.max(
    0,
    Math.min(Number(value.projectileLifetime), TACTICAL_WIZARD.maximumLeadSeconds),
  );
  const clampedTime = Math.min(interceptTime, maximumTime);
  const leadTime = clampedTime * TACTICAL_WIZARD.leadScale;
  return {
    valid: true,
    x: value.targetX + value.targetVx * leadTime,
    z: value.targetZ + value.targetVz * leadTime,
    interceptTime,
    clampedTime,
    leadTime,
  };
}

/**
 * @param {{x:number,z:number,vx:number,vz:number,radius:number}} enemy
 * @param {{x:number,z:number,vx:number,vz:number,radius:number,age?:number,lifetime?:number}} projectile
 */
export function hostileThreatMetrics(enemy, projectile) {
  const rx = projectile.x - enemy.x;
  const rz = projectile.z - enemy.z;
  const currentDistance = Math.hypot(rx, rz);
  if (currentDistance < TACTICAL_WIZARD.threatMinimumDistance) return null;
  const relativeVx = projectile.vx - enemy.vx;
  const relativeVz = projectile.vz - enemy.vz;
  const relativeSpeedSquared = relativeVx * relativeVx + relativeVz * relativeVz;
  if (relativeSpeedSquared <= 1e-9) return null;
  const time = -(rx * relativeVx + rz * relativeVz) / relativeSpeedSquared;
  if (
    time < TACTICAL_WIZARD.threatMinimumSeconds
    || time > TACTICAL_WIZARD.threatMaximumSeconds
  ) {
    return null;
  }
  const remainingLifetime = Number(projectile.lifetime ?? Infinity)
    - Number(projectile.age ?? 0);
  if (time > remainingLifetime) return null;
  const missX = rx + relativeVx * time;
  const missZ = rz + relativeVz * time;
  const missDistance = Math.hypot(missX, missZ);
  const threshold = enemy.radius + projectile.radius + TACTICAL_WIZARD.threatPadding;
  if (missDistance > threshold) return null;
  return { time, currentDistance, missDistance, threshold };
}

/**
 * @param {{get(cx:number,cz:number):number}} map
 * @param {{x:number,z:number,radius:number}} enemy
 * @param {number} directionX
 * @param {number} directionZ
 */
function dodgePathIsLegal(map, enemy, directionX, directionZ) {
  const contact = { nx: 0, nz: 0, penetration: 0, px: 0, pz: 0, cx: 0, cz: 0 };
  const distancePerTick = TACTICAL_WIZARD.dodgeSpeed * SIMULATION.dt;
  for (let tick = 1; tick <= TACTICAL_WIZARD.dodgeTicks; tick += 1) {
    if (firstSolidContact(
      map,
      enemy.x + directionX * distancePerTick * tick,
      enemy.z + directionZ * distancePerTick * tick,
      enemy.radius,
      contact,
    )) {
      return false;
    }
  }
  return true;
}

/**
 * @param {{x:number,z:number}} direction
 * @param {{x:number,z:number}} enemy
 * @param {{x:number,z:number,vx:number,vz:number,radius:number}} projectile
 * @param {{time:number}} threat
 */
function dodgeClearance(direction, enemy, projectile, threat) {
  const dodgeDuration = TACTICAL_WIZARD.dodgeTicks * SIMULATION.dt;
  const movementTime = Math.min(threat.time, dodgeDuration);
  const enemyX = enemy.x + direction.x * TACTICAL_WIZARD.dodgeSpeed * movementTime;
  const enemyZ = enemy.z + direction.z * TACTICAL_WIZARD.dodgeSpeed * movementTime;
  const projectileX = projectile.x + projectile.vx * threat.time;
  const projectileZ = projectile.z + projectile.vz * threat.time;
  return Math.hypot(projectileX - enemyX, projectileZ - enemyZ);
}

/**
 * @param {{get(cx:number,cz:number):number}} map
 * @param {{x:number,z:number,radius:number}} enemy
 * @param {{x:number,z:number,vx:number,vz:number,radius:number,effectId?:number,id?:number}} projectile
 * @param {{time:number}} threat
 * @param {number} simulationSeed
 * @param {number} spawnSequence
 */
export function chooseDodgeDirection(
  map,
  enemy,
  projectile,
  threat,
  simulationSeed,
  spawnSequence,
) {
  const velocityLength = Math.hypot(projectile.vx, projectile.vz);
  if (velocityLength <= 1e-9) return null;
  const nx = projectile.vx / velocityLength;
  const nz = projectile.vz / velocityLength;
  const left = { x: -nz, z: nx, side: /** @type {const} */ ("left"), code: 1 };
  const right = { x: nz, z: -nx, side: /** @type {const} */ ("right"), code: -1 };
  const leftLegal = dodgePathIsLegal(map, enemy, left.x, left.z);
  const rightLegal = dodgePathIsLegal(map, enemy, right.x, right.z);
  if (!leftLegal && !rightLegal) return null;
  const leftClearance = leftLegal
    ? dodgeClearance(left, enemy, projectile, threat)
    : -Infinity;
  const rightClearance = rightLegal
    ? dodgeClearance(right, enemy, projectile, threat)
    : -Infinity;
  let selected = left;
  if (rightClearance > leftClearance + 1e-9) {
    selected = right;
  } else if (Math.abs(leftClearance - rightClearance) <= 1e-9) {
    const ordinal = Number(projectile.effectId ?? projectile.id ?? 0);
    selected = (tacticalLaneUint32(
      simulationSeed,
      spawnSequence,
      "dodge-tie",
      ordinal,
    ) & 1) === 0 ? left : right;
  }
  return {
    x: selected.x,
    z: selected.z,
    side: selected.side,
    code: selected.code,
    leftLegal,
    rightLegal,
    leftClearance,
    rightClearance,
  };
}
