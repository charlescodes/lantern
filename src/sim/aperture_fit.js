// @ts-check

/**
 * Returns projected half extents for the supported authoritative footprint
 * types. A null result is the conservative unsupported-shape fallback.
 * @param {Record<string, any>} footprint
 * @param {{halfX:number,halfZ:number}} [out]
 */
export function projectedFootprintHalfExtents(footprint, out) {
  const result = out ?? { halfX: 0, halfZ: 0 };
  if (footprint?.type === "circle") {
    const radius = Number(footprint.radius);
    if (!Number.isFinite(radius) || radius <= 0) return null;
    result.halfX = radius;
    result.halfZ = radius;
    return result;
  }
  if (footprint?.type === "rectangle") {
    const halfWidth = Number(footprint.halfWidth);
    const halfDepth = Number(footprint.halfDepth);
    const rotation = Number(footprint.rotation ?? 0);
    if (
      !Number.isFinite(halfWidth)
      || !Number.isFinite(halfDepth)
      || halfWidth <= 0
      || halfDepth <= 0
      || !Number.isInteger(rotation)
    ) return null;
    result.halfX = (rotation & 1) === 1 ? halfDepth : halfWidth;
    result.halfZ = (rotation & 1) === 1 ? halfWidth : halfDepth;
    return result;
  }
  return null;
}

/**
 * Returns true when an authoritative footprint has positive-area overlap with
 * an axis-aligned rectangle.  This is intentionally a contact query rather
 * than containment: a wide table may press more than one pressure plate.
 * Supported rectangles retain Lantern's quarter-turn orientation rule.
 * Unsupported shapes are rejected conservatively.
 * @param {Record<string, any>} footprint
 * @param {{x:number,z:number,halfWidth:number,halfDepth:number}} rectangle
 * @param {{halfX:number,halfZ:number}} [scratchExtents]
 */
export function footprintOverlapsAxisAlignedRectangle(footprint, rectangle, scratchExtents) {
  const centerX = Number(footprint?.x);
  const centerZ = Number(footprint?.z);
  const rectangleX = Number(rectangle?.x);
  const rectangleZ = Number(rectangle?.z);
  const halfWidth = Number(rectangle?.halfWidth);
  const halfDepth = Number(rectangle?.halfDepth);
  if (
    !Number.isFinite(centerX)
    || !Number.isFinite(centerZ)
    || !Number.isFinite(rectangleX)
    || !Number.isFinite(rectangleZ)
    || !(halfWidth > 0)
    || !(halfDepth > 0)
  ) return false;
  if (footprint?.type === "circle") {
    const radius = Number(footprint.radius);
    if (!(radius > 0) || !Number.isFinite(radius)) return false;
    const nearestX = Math.max(rectangleX - halfWidth, Math.min(centerX, rectangleX + halfWidth));
    const nearestZ = Math.max(rectangleZ - halfDepth, Math.min(centerZ, rectangleZ + halfDepth));
    const dx = centerX - nearestX;
    const dz = centerZ - nearestZ;
    // Strictly less than means a tangent edge does not chatter a plate.
    return dx * dx + dz * dz < radius * radius - 1e-12;
  }
  const extents = projectedFootprintHalfExtents(footprint, scratchExtents);
  return Boolean(
    extents
    && Math.abs(centerX - rectangleX) < extents.halfX + halfWidth
    && Math.abs(centerZ - rectangleZ) < extents.halfZ + halfDepth
  );
}

/**
 * Pure full-footprint containment test for a square aperture. The footprint
 * center may be off-center, but every projected edge must retain positive
 * configured clearance. Unsupported shapes are rejected conservatively.
 * @param {Record<string, any>} footprint
 * @param {{x:number,z:number,width:number}} aperture
 * @param {number} [clearance]
 * @param {{halfX:number,halfZ:number}} [scratchExtents]
 */
export function footprintFitsSquareAperture(
  footprint,
  aperture,
  clearance = 0.01,
  scratchExtents,
) {
  const extents = projectedFootprintHalfExtents(footprint, scratchExtents);
  const width = Number(aperture.width);
  const margin = Number(clearance);
  if (
    !extents
    || !Number.isFinite(width)
    || width <= 0
    || !Number.isFinite(margin)
    || margin <= 0
  ) return false;
  const usableHalf = width / 2 - margin;
  if (!(usableHalf > 0)) return false;
  const dx = Math.abs(Number(footprint.x) - Number(aperture.x));
  const dz = Math.abs(Number(footprint.z) - Number(aperture.z));
  if (!Number.isFinite(dx) || !Number.isFinite(dz)) return false;
  return dx + extents.halfX <= usableHalf
    && dz + extents.halfZ <= usableHalf;
}

/**
 * Answers whether a footprint type can fit in a square aperture at all,
 * independent of its current center.  Hole rim attraction uses this so a
 * fitting body can be gently drawn toward an opening before it is contained.
 * @param {Record<string, any>} footprint
 * @param {{width:number}} aperture
 * @param {number} [clearance]
 * @param {{halfX:number,halfZ:number}} [scratchExtents]
 */
export function footprintCanFitSquareAperture(
  footprint,
  aperture,
  clearance = 0.01,
  scratchExtents,
) {
  const extents = projectedFootprintHalfExtents(footprint, scratchExtents);
  const width = Number(aperture.width);
  const margin = Number(clearance);
  if (!extents || !Number.isFinite(width) || width <= 0 || !Number.isFinite(margin) || margin <= 0) {
    return false;
  }
  const usableHalf = width / 2 - margin;
  return usableHalf > 0 && extents.halfX <= usableHalf && extents.halfZ <= usableHalf;
}

/**
 * Finds the first segment entry into the clearance-eroded square that can
 * contain this footprint.  A false result is deliberately conservative for
 * unsupported footprints.  `out` is reused by fixed-step callers.
 * @param {Record<string, any>} footprint
 * @param {number} fromX
 * @param {number} fromZ
 * @param {number} toX
 * @param {number} toZ
 * @param {{x:number,z:number,width:number}} aperture
 * @param {number} [clearance]
 * @param {{halfX:number,halfZ:number}} [scratchExtents]
 * @param {{t:number,x:number,z:number}} [out]
 */
export function sweptFootprintEntrySquareAperture(
  footprint,
  fromX,
  fromZ,
  toX,
  toZ,
  aperture,
  clearance = 0.01,
  scratchExtents,
  out,
) {
  const extents = projectedFootprintHalfExtents(footprint, scratchExtents);
  const width = Number(aperture.width);
  const margin = Number(clearance);
  if (!extents || !Number.isFinite(width) || width <= 0 || !Number.isFinite(margin) || margin <= 0) return null;
  const half = width / 2 - margin;
  const halfX = half - extents.halfX;
  const halfZ = half - extents.halfZ;
  if (!(halfX >= 0) || !(halfZ >= 0)) return null;
  const minX = Number(aperture.x) - halfX;
  const maxX = Number(aperture.x) + halfX;
  const minZ = Number(aperture.z) - halfZ;
  const maxZ = Number(aperture.z) + halfZ;
  const dx = toX - fromX;
  const dz = toZ - fromZ;
  let enter = 0;
  let exit = 1;
  const clip = (start, delta, minimum, maximum) => {
    if (Math.abs(delta) <= 1e-12) return start >= minimum && start <= maximum;
    let a = (minimum - start) / delta;
    let b = (maximum - start) / delta;
    if (a > b) [a, b] = [b, a];
    enter = Math.max(enter, a);
    exit = Math.min(exit, b);
    return enter <= exit;
  };
  if (!clip(fromX, dx, minX, maxX) || !clip(fromZ, dz, minZ, maxZ) || exit < 0 || enter > 1) return null;
  const t = Math.max(0, enter);
  const result = out ?? { t: 0, x: 0, z: 0 };
  result.t = t;
  result.x = fromX + dx * t;
  result.z = fromZ + dz * t;
  return result;
}
