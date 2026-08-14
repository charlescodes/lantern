// @ts-check

/** @param {number} value @param {number} min @param {number} max */
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

const SWEEP_EPSILON = 1e-12;
const POINT_CORRECTION_EPSILON = 1e-5;

/**
 * Sweeps a point through the solid grid and writes the earliest contact into
 * `out`. Map boundaries participate because GridMap#get treats out-of-bounds
 * cells as solid.
 * @param {{get(cx:number,cz:number):number}} map
 * @param {number} startX
 * @param {number} startZ
 * @param {number} endX
 * @param {number} endZ
 * @param {{x:number,z:number,time:number,nx:number,nz:number,cx:number,cz:number}} out
 */
export function sweepPointAgainstGrid(map, startX, startZ, endX, endZ, out) {
  if (
    !Number.isFinite(startX) ||
    !Number.isFinite(startZ) ||
    !Number.isFinite(endX) ||
    !Number.isFinite(endZ)
  ) {
    return false;
  }

  const deltaX = endX - startX;
  const deltaZ = endZ - startZ;
  let cx = Math.floor(startX);
  let cz = Math.floor(startZ);

  if (map.get(cx, cz) === 1) {
    out.x = startX;
    out.z = startZ;
    out.time = 0;
    out.cx = cx;
    out.cz = cz;
    const length = Math.hypot(deltaX, deltaZ);
    if (length > SWEEP_EPSILON) {
      out.nx = -deltaX / length;
      out.nz = -deltaZ / length;
    } else {
      const left = startX - cx;
      const right = cx + 1 - startX;
      const top = startZ - cz;
      const bottom = cz + 1 - startZ;
      const nearest = Math.min(left, right, top, bottom);
      out.nx = nearest === left ? -1 : nearest === right ? 1 : 0;
      out.nz = nearest === top ? -1 : nearest === bottom ? 1 : 0;
    }
    return true;
  }

  const stepX = Math.sign(deltaX);
  const stepZ = Math.sign(deltaZ);
  if (stepX === 0 && stepZ === 0) return false;

  const deltaTimeX = stepX === 0 ? Infinity : Math.abs(1 / deltaX);
  const deltaTimeZ = stepZ === 0 ? Infinity : Math.abs(1 / deltaZ);
  let nextTimeX = stepX > 0
    ? (cx + 1 - startX) * deltaTimeX
    : stepX < 0
      ? (startX - cx) * deltaTimeX
      : Infinity;
  let nextTimeZ = stepZ > 0
    ? (cz + 1 - startZ) * deltaTimeZ
    : stepZ < 0
      ? (startZ - cz) * deltaTimeZ
      : Infinity;

  while (Math.min(nextTimeX, nextTimeZ) <= 1 + SWEEP_EPSILON) {
    if (nextTimeX + SWEEP_EPSILON < nextTimeZ) {
      const hitCx = cx + stepX;
      if (map.get(hitCx, cz) === 1) {
        const time = clamp(nextTimeX, 0, 1);
        out.x = startX + deltaX * time;
        out.z = startZ + deltaZ * time;
        out.time = time;
        out.nx = -stepX;
        out.nz = 0;
        out.cx = hitCx;
        out.cz = cz;
        return true;
      }
      cx = hitCx;
      nextTimeX += deltaTimeX;
      continue;
    }

    if (nextTimeZ + SWEEP_EPSILON < nextTimeX) {
      const hitCz = cz + stepZ;
      if (map.get(cx, hitCz) === 1) {
        const time = clamp(nextTimeZ, 0, 1);
        out.x = startX + deltaX * time;
        out.z = startZ + deltaZ * time;
        out.time = time;
        out.nx = 0;
        out.nz = -stepZ;
        out.cx = cx;
        out.cz = hitCz;
        return true;
      }
      cz = hitCz;
      nextTimeZ += deltaTimeZ;
      continue;
    }

    const hitCx = cx + stepX;
    const hitCz = cz + stepZ;
    const solidX = map.get(hitCx, cz) === 1;
    const solidZ = map.get(cx, hitCz) === 1;
    const solidDiagonal = map.get(hitCx, hitCz) === 1;
    if (solidX || solidZ || solidDiagonal) {
      const time = clamp(Math.min(nextTimeX, nextTimeZ), 0, 1);
      out.x = startX + deltaX * time;
      out.z = startZ + deltaZ * time;
      out.time = time;
      if (solidX && !solidZ) {
        out.nx = -stepX;
        out.nz = 0;
        out.cx = hitCx;
        out.cz = cz;
      } else if (solidZ && !solidX) {
        out.nx = 0;
        out.nz = -stepZ;
        out.cx = cx;
        out.cz = hitCz;
      } else {
        const length = Math.hypot(deltaX, deltaZ);
        out.nx = length > SWEEP_EPSILON ? -deltaX / length : -stepX * Math.SQRT1_2;
        out.nz = length > SWEEP_EPSILON ? -deltaZ / length : -stepZ * Math.SQRT1_2;
        if (solidX) {
          out.cx = hitCx;
          out.cz = cz;
        } else if (solidZ) {
          out.cx = cx;
          out.cz = hitCz;
        } else {
          out.cx = hitCx;
          out.cz = hitCz;
        }
      }
      return true;
    }

    cx = hitCx;
    cz = hitCz;
    nextTimeX += deltaTimeX;
    nextTimeZ += deltaTimeZ;
  }

  return false;
}

/**
 * Moves a point out of solid cells along a preferred direction. The bounded
 * pass count makes malformed or deeply out-of-bounds spawn points fail
 * predictably instead of searching the whole map.
 * @param {{get(cx:number,cz:number):number}} map
 * @param {number} x
 * @param {number} z
 * @param {number} preferredNx
 * @param {number} preferredNz
 * @param {{x:number,z:number,cx:number,cz:number,passes:number}} out
 * @param {number} [maximumPasses]
 */
export function sanitizePointAgainstGrid(
  map,
  x,
  z,
  preferredNx,
  preferredNz,
  out,
  maximumPasses = 8,
) {
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(z) ||
    !Number.isFinite(preferredNx) ||
    !Number.isFinite(preferredNz)
  ) {
    return false;
  }

  const preferredLength = Math.hypot(preferredNx, preferredNz);
  const nx = preferredLength > SWEEP_EPSILON ? preferredNx / preferredLength : 0;
  const nz = preferredLength > SWEEP_EPSILON ? preferredNz / preferredLength : 0;
  const passes = Math.max(0, Math.min(8, Math.trunc(maximumPasses)));
  let usedPasses = 0;

  while (usedPasses < passes) {
    const cx = Math.floor(x);
    const cz = Math.floor(z);
    if (map.get(cx, cz) !== 1) {
      out.x = x;
      out.z = z;
      out.cx = cx;
      out.cz = cz;
      out.passes = usedPasses;
      return true;
    }

    if (preferredLength > SWEEP_EPSILON) {
      let exitTimeX = Infinity;
      let exitTimeZ = Infinity;
      if (nx > SWEEP_EPSILON) {
        exitTimeX = (cx + 1 + POINT_CORRECTION_EPSILON - x) / nx;
      } else if (nx < -SWEEP_EPSILON) {
        exitTimeX = (cx - POINT_CORRECTION_EPSILON - x) / nx;
      }
      if (nz > SWEEP_EPSILON) {
        exitTimeZ = (cz + 1 + POINT_CORRECTION_EPSILON - z) / nz;
      } else if (nz < -SWEEP_EPSILON) {
        exitTimeZ = (cz - POINT_CORRECTION_EPSILON - z) / nz;
      }
      const exitTime = Math.min(exitTimeX, exitTimeZ);
      if (!Number.isFinite(exitTime) || exitTime < 0) break;
      x += nx * exitTime;
      z += nz * exitTime;
    } else {
      const left = x - cx;
      const right = cx + 1 - x;
      const top = z - cz;
      const bottom = cz + 1 - z;
      const nearest = Math.min(left, right, top, bottom);
      if (nearest === left) x = cx - POINT_CORRECTION_EPSILON;
      else if (nearest === right) x = cx + 1 + POINT_CORRECTION_EPSILON;
      else if (nearest === top) z = cz - POINT_CORRECTION_EPSILON;
      else z = cz + 1 + POINT_CORRECTION_EPSILON;
    }
    usedPasses += 1;
  }

  const cx = Math.floor(x);
  const cz = Math.floor(z);
  out.x = x;
  out.z = z;
  out.cx = cx;
  out.cz = cz;
  out.passes = usedPasses;
  return map.get(cx, cz) !== 1;
}

/**
 * Writes circle-vs-cell contact data into a reusable object.
 * @param {number} x
 * @param {number} z
 * @param {number} radius
 * @param {number} cx
 * @param {number} cz
 * @param {{nx:number,nz:number,penetration:number,px:number,pz:number,cx:number,cz:number}} out
 */
export function circleCellContact(x, z, radius, cx, cz, out) {
  const closestX = clamp(x, cx, cx + 1);
  const closestZ = clamp(z, cz, cz + 1);
  const dx = x - closestX;
  const dz = z - closestZ;
  const distanceSquared = dx * dx + dz * dz;
  if (distanceSquared > radius * radius) return false;

  out.cx = cx;
  out.cz = cz;
  out.px = closestX;
  out.pz = closestZ;

  if (distanceSquared > 1e-12) {
    const distance = Math.sqrt(distanceSquared);
    out.nx = dx / distance;
    out.nz = dz / distance;
    out.penetration = radius - distance;
    return out.penetration >= 0;
  }

  const toLeft = x - cx;
  const toRight = cx + 1 - x;
  const toTop = z - cz;
  const toBottom = cz + 1 - z;
  const minimum = Math.min(toLeft, toRight, toTop, toBottom);
  out.nx = 0;
  out.nz = 0;
  if (minimum === toLeft) {
    out.nx = -1;
    out.px = cx;
  } else if (minimum === toRight) {
    out.nx = 1;
    out.px = cx + 1;
  } else if (minimum === toTop) {
    out.nz = -1;
    out.pz = cz;
  } else {
    out.nz = 1;
    out.pz = cz + 1;
  }
  out.penetration = radius + minimum;
  return true;
}

/**
 * @param {{get(cx:number,cz:number):number}} map
 * @param {number} x
 * @param {number} z
 * @param {number} radius
 * @param {{nx:number,nz:number,penetration:number,px:number,pz:number,cx:number,cz:number}} out
 */
export function firstSolidContact(map, x, z, radius, out) {
  const minX = Math.floor(x - radius);
  const maxX = Math.floor(x + radius);
  const minZ = Math.floor(z - radius);
  const maxZ = Math.floor(z + radius);
  for (let cz = minZ; cz <= maxZ; cz += 1) {
    for (let cx = minX; cx <= maxX; cx += 1) {
      if (map.get(cx, cz) === 1 && circleCellContact(x, z, radius, cx, cz, out)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Writes fixed axis-aligned box-vs-cell contact data. The normal points from
 * the solid cell toward the dynamic box so callers can apply the same positive
 * correction used for circular bodies.
 * @param {number} x
 * @param {number} z
 * @param {number} halfX
 * @param {number} halfZ
 * @param {number} cx
 * @param {number} cz
 * @param {{nx:number,nz:number,penetration:number,px:number,pz:number,cx:number,cz:number}} out
 */
export function boxCellContact(x, z, halfX, halfZ, cx, cz, out) {
  const overlapX = Math.min(x + halfX, cx + 1) - Math.max(x - halfX, cx);
  const overlapZ = Math.min(z + halfZ, cz + 1) - Math.max(z - halfZ, cz);
  if (overlapX < 0 || overlapZ < 0) return false;
  out.cx = cx;
  out.cz = cz;
  out.px = clamp(x, cx, cx + 1);
  out.pz = clamp(z, cz, cz + 1);
  if (overlapX <= overlapZ) {
    out.nx = x < cx + 0.5 ? -1 : 1;
    out.nz = 0;
    out.penetration = overlapX;
  } else {
    out.nx = 0;
    out.nz = z < cz + 0.5 ? -1 : 1;
    out.penetration = overlapZ;
  }
  return true;
}

/**
 * @param {{get(cx:number,cz:number):number}} map
 * @param {number} x
 * @param {number} z
 * @param {number} halfX
 * @param {number} halfZ
 * @param {{nx:number,nz:number,penetration:number,px:number,pz:number,cx:number,cz:number}} out
 */
export function firstSolidBoxContact(map, x, z, halfX, halfZ, out) {
  const minX = Math.floor(x - halfX);
  const maxX = Math.floor(x + halfX);
  const minZ = Math.floor(z - halfZ);
  const maxZ = Math.floor(z + halfZ);
  for (let cz = minZ; cz <= maxZ; cz += 1) {
    for (let cx = minX; cx <= maxX; cx += 1) {
      if (map.get(cx, cz) === 1 && boxCellContact(x, z, halfX, halfZ, cx, cz, out)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Iteratively moves a circle out of solid cells and removes inward velocity.
 * @param {{get(cx:number,cz:number):number}} map
 * @param {{x:number,z:number,vx:number,vz:number}} body
 * @param {number} radius
 * @param {(contact:{nx:number,nz:number,penetration:number,px:number,pz:number,cx:number,cz:number})=>void} [onContact]
 */
export function resolveCircleAgainstGrid(map, body, radius, onContact) {
  const contact = { nx: 0, nz: 0, penetration: 0, px: 0, pz: 0, cx: 0, cz: 0 };
  let resolved = 0;
  for (let pass = 0; pass < 8; pass += 1) {
    if (!firstSolidContact(map, body.x, body.z, radius, contact)) break;
    const correction = contact.penetration + 1e-6;
    body.x += contact.nx * correction;
    body.z += contact.nz * correction;
    const inwardSpeed = body.vx * contact.nx + body.vz * contact.nz;
    if (inwardSpeed < 0) {
      body.vx -= contact.nx * inwardSpeed;
      body.vz -= contact.nz * inwardSpeed;
    }
    onContact?.(contact);
    resolved += 1;
  }
  return resolved;
}

/**
 * @param {number} ax
 * @param {number} az
 * @param {number} aRadius
 * @param {number} bx
 * @param {number} bz
 * @param {number} bRadius
 * @param {{nx:number,nz:number,penetration:number,x:number,z:number}} out
 */
export function circleCircleContact(ax, az, aRadius, bx, bz, bRadius, out) {
  const dx = bx - ax;
  const dz = bz - az;
  const radius = aRadius + bRadius;
  const distanceSquared = dx * dx + dz * dz;
  if (distanceSquared >= radius * radius) return false;
  if (distanceSquared <= 1e-12) {
    out.nx = 1;
    out.nz = 0;
    out.penetration = radius;
  } else {
    const distance = Math.sqrt(distanceSquared);
    out.nx = dx / distance;
    out.nz = dz / distance;
    out.penetration = radius - distance;
  }
  out.x = ax + out.nx * aRadius;
  out.z = az + out.nz * aRadius;
  return true;
}

/**
 * Contact normal points from circle A toward fixed-orientation box B, matching
 * circleCircleContact's A-to-B convention.
 * @param {number} ax
 * @param {number} az
 * @param {number} aRadius
 * @param {number} bx
 * @param {number} bz
 * @param {number} bHalfX
 * @param {number} bHalfZ
 * @param {{nx:number,nz:number,penetration:number,x:number,z:number}} out
 */
export function circleBoxContact(ax, az, aRadius, bx, bz, bHalfX, bHalfZ, out) {
  const minimumX = bx - bHalfX;
  const maximumX = bx + bHalfX;
  const minimumZ = bz - bHalfZ;
  const maximumZ = bz + bHalfZ;
  const closestX = clamp(ax, minimumX, maximumX);
  const closestZ = clamp(az, minimumZ, maximumZ);
  const dx = closestX - ax;
  const dz = closestZ - az;
  const distanceSquared = dx * dx + dz * dz;
  if (distanceSquared > aRadius * aRadius) return false;
  if (distanceSquared > 1e-12) {
    const distance = Math.sqrt(distanceSquared);
    out.nx = dx / distance;
    out.nz = dz / distance;
    out.penetration = aRadius - distance;
  } else {
    const toLeft = ax - minimumX;
    const toRight = maximumX - ax;
    const toTop = az - minimumZ;
    const toBottom = maximumZ - az;
    const nearest = Math.min(toLeft, toRight, toTop, toBottom);
    out.nx = 0;
    out.nz = 0;
    if (nearest === toLeft) out.nx = 1;
    else if (nearest === toRight) out.nx = -1;
    else if (nearest === toTop) out.nz = 1;
    else out.nz = -1;
    out.penetration = aRadius + nearest;
  }
  out.x = ax + out.nx * aRadius;
  out.z = az + out.nz * aRadius;
  return out.penetration >= 0;
}

/**
 * Contact normal points from fixed-orientation box A toward box B.
 * @param {number} ax
 * @param {number} az
 * @param {number} aHalfX
 * @param {number} aHalfZ
 * @param {number} bx
 * @param {number} bz
 * @param {number} bHalfX
 * @param {number} bHalfZ
 * @param {{nx:number,nz:number,penetration:number,x:number,z:number}} out
 */
export function boxBoxContact(ax, az, aHalfX, aHalfZ, bx, bz, bHalfX, bHalfZ, out) {
  const deltaX = bx - ax;
  const deltaZ = bz - az;
  const overlapX = aHalfX + bHalfX - Math.abs(deltaX);
  const overlapZ = aHalfZ + bHalfZ - Math.abs(deltaZ);
  if (overlapX <= 0 || overlapZ <= 0) return false;
  if (overlapX <= overlapZ) {
    out.nx = deltaX < 0 ? -1 : 1;
    out.nz = 0;
    out.penetration = overlapX;
  } else {
    out.nx = 0;
    out.nz = deltaZ < 0 ? -1 : 1;
    out.penetration = overlapZ;
  }
  out.x = ax + out.nx * aHalfX;
  out.z = az + out.nz * aHalfZ;
  return true;
}

/**
 * Returns true when a solid cell crosses the segment. The start point is
 * expected to be offset into floor space when it lies on a wall surface.
 * @param {{get(cx:number,cz:number):number}} map
 * @param {number} startX
 * @param {number} startZ
 * @param {number} endX
 * @param {number} endZ
 */
export function gridRayBlocked(map, startX, startZ, endX, endZ) {
  let cx = Math.floor(startX);
  let cz = Math.floor(startZ);
  const endCx = Math.floor(endX);
  const endCz = Math.floor(endZ);
  if (map.get(cx, cz) === 1) return true;

  const dx = endX - startX;
  const dz = endZ - startZ;
  const stepX = Math.sign(dx);
  const stepZ = Math.sign(dz);
  const deltaX = stepX === 0 ? Infinity : Math.abs(1 / dx);
  const deltaZ = stepZ === 0 ? Infinity : Math.abs(1 / dz);
  let maxX = stepX > 0
    ? (cx + 1 - startX) * deltaX
    : stepX < 0
      ? (startX - cx) * deltaX
      : Infinity;
  let maxZ = stepZ > 0
    ? (cz + 1 - startZ) * deltaZ
    : stepZ < 0
      ? (startZ - cz) * deltaZ
      : Infinity;

  while (cx !== endCx || cz !== endCz) {
    if (maxX < maxZ) {
      cx += stepX;
      maxX += deltaX;
    } else if (maxZ < maxX) {
      cz += stepZ;
      maxZ += deltaZ;
    } else {
      const sideX = cx + stepX;
      const sideZ = cz + stepZ;
      if (map.get(sideX, cz) === 1 || map.get(cx, sideZ) === 1) return true;
      cx = sideX;
      cz = sideZ;
      maxX += deltaX;
      maxZ += deltaZ;
    }
    if (map.get(cx, cz) === 1) return true;
  }
  return false;
}
