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
