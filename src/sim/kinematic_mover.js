// @ts-check
import { circleBoxContact, circleCircleContact, boxBoxContact } from "./collision.js";

const EPSILON = 0.001;
const contact = { nx: 0, nz: 0, penetration: 0, x: 0, z: 0 };

/** Exact footprint overlap, with a small contact slop shared with body physics. */
export function moverBodyOverlap(a, ax, az, b, bx, bz, slop = EPSILON) {
  if (a.layerIndex !== b.layerIndex || a.y >= b.y + b.height || b.y >= a.y + a.height) return false;
  let hit;
  if (a.box && b.box) hit = boxBoxContact(ax, az, a.halfX, a.halfZ, bx, bz, b.halfX, b.halfZ, contact);
  else if (!a.box && !b.box) hit = circleCircleContact(ax, az, a.radius, bx, bz, b.radius, contact);
  else if (a.box) hit = circleBoxContact(bx, bz, b.radius, ax, az, a.halfX, a.halfZ, contact);
  else hit = circleBoxContact(ax, az, a.radius, bx, bz, b.halfX, b.halfZ, contact);
  return hit && contact.penetration > slop;
}

/** Reusable scratch transaction: only successful callers commit coordinates. */
export class KinematicPush {
  constructor(capacity) {
    this.capacity = capacity;
    this.x = new Float64Array(capacity);
    this.z = new Float64Array(capacity);
    this.touched = new Uint8Array(capacity);
    this.reason = "";
  }

  tryMove(mover, bodies, count, dx, dz, blockedAt, obstacles = []) {
    if (count > this.capacity) throw new RangeError("Mover body scratch capacity exceeded");
    this.reason = "";
    if (Math.abs(dx) + Math.abs(dz) > 0.025001 || (dx !== 0 && dz !== 0)) {
      this.reason = "budget"; return false;
    }
    const mx = mover.x + dx, mz = mover.z + dz;
    if (blockedAt(mover, mx, mz)) { this.reason = "geometry"; return false; }
    for (const other of obstacles) if (other !== mover && moverBodyOverlap(mover, mx, mz, other, other.x, other.z)) {
      this.reason = "mover"; return false;
    }
    this.touched.fill(0, 0, count);
    for (let i = 0; i < count; i++) { this.x[i] = bodies[i].x; this.z[i] = bodies[i].z; }
    const sign = Math.sign(dx || dz), alongX = dx !== 0;
    const push = (i, source, x, z) => {
      const body = bodies[i];
      const extent = alongX ? body.halfX + source.halfX : body.halfZ + source.halfZ;
      if (alongX) this.x[i] = x + sign * (extent + EPSILON);
      else this.z[i] = z + sign * (extent + EPSILON);
      this.touched[i] = 1;
    };
    for (let pass = 0; pass < 4; pass++) {
      for (let i = 0; i < count; i++) {
        if (moverBodyOverlap(mover, mx, mz, bodies[i], this.x[i], this.z[i])) push(i, mover, mx, mz);
      }
      for (let i = 0; i < count; i++) if (this.touched[i]) {
        for (let j = 0; j < count; j++) if (i !== j
          && moverBodyOverlap(bodies[i], this.x[i], this.z[i], bodies[j], this.x[j], this.z[j])) {
          const ahead = alongX ? this.x[j] - this.x[i] : this.z[j] - this.z[i];
          if (ahead * sign >= 0) push(j, bodies[i], this.x[i], this.z[i]);
        }
      }
    }
    for (let i = 0; i < count; i++) if (this.touched[i]) {
      const body = bodies[i], x = this.x[i], z = this.z[i];
      if (blockedAt(body, x, z) || moverBodyOverlap(mover, mx, mz, body, x, z)) {
        this.reason = "geometry"; return false;
      }
      for (const other of obstacles) if (other !== mover && moverBodyOverlap(body, x, z, other, other.x, other.z)) {
        this.reason = "mover"; return false;
      }
      for (let j = 0; j < count; j++) if (i !== j && moverBodyOverlap(body, x, z, bodies[j], this.x[j], this.z[j])) {
        this.reason = "budget"; return false;
      }
    }
    return true;
  }
}
