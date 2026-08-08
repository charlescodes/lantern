// @ts-check

import { DEAD_BODY } from "../config.js";

export const ENEMY_BODY_HEIGHT_METERS = 1.6;

/** @param {number} value */
function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

/** @param {number} value */
function smoothstep(value) {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
}

/**
 * Shared renderer-independent pose for the deliberately simple visual fall.
 * @param {Record<string,any>} body
 * @param {number} alpha
 * @param {Record<string,any>} [output]
 */
export function enemyDeadBodyPose(body, alpha = 0, output) {
  const pose = output ?? { facing: { x: 1, z: 0 } };
  pose.facing ??= { x: 1, z: 0 };
  const interpolant = clamp01(alpha);
  const facingX = Number(body?.facing?.x);
  const facingZ = Number(body?.facing?.z);
  const facingLength = Math.hypot(facingX, facingZ);
  pose.facing.x = facingLength > 1e-9 ? facingX / facingLength : 1;
  pose.facing.z = facingLength > 1e-9 ? facingZ / facingLength : 0;
  const radius = Math.max(0.05, Number(body.radius) || 0.3);
  const ageTicks = Math.max(0, Number(body.ageTicks) || 0) + interpolant;
  const progress = smoothstep(ageTicks / DEAD_BODY.fallTicks);
  const x = Number(body.x) || 0;
  const z = Number(body.z) || 0;
  const previousX = Number.isFinite(Number(body.previousX))
    ? Number(body.previousX)
    : x;
  const previousZ = Number.isFinite(Number(body.previousZ))
    ? Number(body.previousZ)
    : z;
  pose.x = previousX + (x - previousX) * interpolant;
  pose.z = previousZ + (z - previousZ) * interpolant;
  pose.progress = progress;
  pose.angleRadians = progress * Math.PI / 2;
  pose.centerY = ENEMY_BODY_HEIGHT_METERS / 2
    + (radius - ENEMY_BODY_HEIGHT_METERS / 2) * progress;
  pose.footprintLength = radius * 2
    + (ENEMY_BODY_HEIGHT_METERS - radius * 2) * progress;
  pose.footprintWidth = radius * 2;
  return pose;
}
