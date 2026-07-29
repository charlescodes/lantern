// @ts-check

/** @param {Record<string,any>} enemy */
export function normalizedEnemyFacing(enemy) {
  const x = Number(enemy?.facing?.x);
  const z = Number(enemy?.facing?.z);
  const length = Math.hypot(x, z);
  if (Number.isFinite(length) && length > 1e-9) {
    return { x: x / length, z: z / length };
  }
  return { x: 0, z: -1 };
}

/**
 * Shared procedural footprint for the Canvas2D hood/nose marker.
 * @param {Record<string,any>} enemy
 * @param {number} x
 * @param {number} z
 */
export function enemyFacingTriangle(enemy, x, z) {
  const facing = normalizedEnemyFacing(enemy);
  const radius = Math.max(0.05, Number(enemy.radius) || 0.3);
  const perpendicularX = -facing.z;
  const perpendicularZ = facing.x;
  const baseDistance = radius * 0.34;
  const halfWidth = radius * 0.22;
  return {
    facing,
    tip: {
      x: x + facing.x * radius * 1.12,
      z: z + facing.z * radius * 1.12,
    },
    left: {
      x: x + facing.x * baseDistance + perpendicularX * halfWidth,
      z: z + facing.z * baseDistance + perpendicularZ * halfWidth,
    },
    right: {
      x: x + facing.x * baseDistance - perpendicularX * halfWidth,
      z: z + facing.z * baseDistance - perpendicularZ * halfWidth,
    },
  };
}
