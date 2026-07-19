// @ts-check

/** @param {number} value @param {number} min @param {number} max */
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
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
