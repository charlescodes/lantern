// @ts-check

/** @param {number} value @param {number} min @param {number} max */
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/** @param {number} surfaceDistance @param {number} radius */
export function explosionFalloff(surfaceDistance, radius) {
  if (!(radius > 0)) return surfaceDistance <= 0 ? 1 : 0;
  const t = clamp(surfaceDistance / radius, 0, 1);
  const smoothstep = t * t * (3 - 2 * t);
  return 1 - smoothstep;
}

/**
 * @param {{
 * originX:number,
 * originZ:number,
 * bodyX:number,
 * bodyZ:number,
 * bodyRadius:number,
 * massKg:number,
 * blastRadius:number,
 * pressureImpulse:number,
 * fallbackNx:number,
 * fallbackNz:number
 * }} value
 */
export function computeExplosionResponse(value) {
  const dx = value.bodyX - value.originX;
  const dz = value.bodyZ - value.originZ;
  const centerDistance = Math.hypot(dx, dz);
  const surfaceDistance = Math.max(0, centerDistance - value.bodyRadius);
  if (surfaceDistance > value.blastRadius) return null;
  let nx = value.fallbackNx;
  let nz = value.fallbackNz;
  if (centerDistance > 1e-9) {
    nx = dx / centerDistance;
    nz = dz / centerDistance;
  }
  const falloff = explosionFalloff(surfaceDistance, value.blastRadius);
  const projectedArea = Math.PI * value.bodyRadius * value.bodyRadius;
  const impulse = value.pressureImpulse * projectedArea * falloff;
  const deltaSpeed = impulse / value.massKg;
  return {
    centerDistance,
    surfaceDistance,
    falloff,
    projectedArea,
    impulse,
    nx,
    nz,
    deltaVx: nx * deltaSpeed,
    deltaVz: nz * deltaSpeed,
  };
}
