// @ts-check

import { mixUint32 } from "../spells/random.js";
import { FIREBALL_PRESENTATION_HEIGHT_METERS } from "./combat_visuals.js";

export const SCORCH_MARK_CAPACITY = 200;
export const SCORCH_CORE_TRIANGLE_COUNT = 8;
export const SCORCH_FLECK_TRIANGLE_COUNT = 16;
export const SCORCH_GROUND_Y_METERS = 0.012;
export const SCORCH_WALL_OFFSET_METERS = 0.006;
export const SCORCH_WALL_HEIGHT_METERS = 2.5;

export const SCORCH_STYLE = Object.freeze({
  coreColor: 0x161918,
  coreCss: "rgb(22 25 24 / 0.46)",
  coreOpacity: 0.46,
  fleckColor: 0x0e1110,
  fleckCss: "rgb(14 17 16 / 0.7)",
  fleckOpacity: 0.7,
});

const UINT32_RANGE = 0x1_0000_0000;
const WALL_FACE_MARGIN_METERS = 0.01;
const TRIANGLE_AREA_EPSILON = 1e-8;

/** @param {number} value @param {number} minimum @param {number} maximum */
function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

/** @param {unknown} value */
function finiteNumber(value) {
  if (value === null || value === undefined || value === "" || typeof value === "boolean") {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/** @param {unknown} value */
function finiteEventId(value) {
  const id = finiteNumber(value);
  return id !== null && Number.isSafeInteger(id) && id >= 0 ? id : null;
}

/** @param {number} seed @param {number} lane */
function sampleUnit(seed, lane) {
  return mixUint32(seed ^ Math.imul((lane + 1) >>> 0, 0x85eb_ca6b))
    / UINT32_RANGE;
}

/**
 * Blast radius remains the spatial source of truth. Pressure only adds a
 * bounded, diminishing presentation modifier.
 *
 * @param {unknown} blastRadius
 * @param {unknown} pressureImpulse
 */
export function scorchMarkRadius(blastRadius, pressureImpulse) {
  const radius = Math.max(0, finiteNumber(blastRadius) ?? 0);
  const pressure = Math.max(0, finiteNumber(pressureImpulse) ?? 0);
  const pressureScale = 0.75 + 0.25 * clamp(
    Math.sqrt(pressure / 800),
    0,
    3,
  );
  return clamp(0.4 * radius * pressureScale, 0.15, 4);
}

/**
 * Shared topology fingerprint for presentation-local effect reset behavior.
 * Obelisk cells are included because they replace ordinary wall rendering.
 *
 * @param {{width?:number,height?:number,cells?:ArrayLike<number>}|undefined} map
 * @param {Array<{cell?:{cx?:number,cz?:number}}>} [obelisks]
 */
export function scorchMapHash(map, obelisks = []) {
  if (!map) return 0;
  let hash = 2_166_136_261;
  hash = Math.imul(hash ^ (Number(map.width) >>> 0), 16_777_619);
  hash = Math.imul(hash ^ (Number(map.height) >>> 0), 16_777_619);
  const cells = map.cells ?? [];
  for (let index = 0; index < cells.length; index += 1) {
    hash = Math.imul(hash ^ (Number(cells[index]) >>> 0), 16_777_619);
  }
  const obeliskCells = obelisks
    .map((obelisk) => {
      const cx = Number(obelisk.cell?.cx);
      const cz = Number(obelisk.cell?.cz);
      return Number.isInteger(cx) && Number.isInteger(cz)
        ? ((cz & 0xffff) << 16) ^ (cx & 0xffff)
        : null;
    })
    .filter((value) => value !== null)
    .sort((left, right) => Number(left) - Number(right));
  for (const cell of obeliskCells) {
    hash = Math.imul(hash ^ Number(cell), 16_777_619);
  }
  return hash >>> 0;
}

/** @param {number} centerU @param {number} centerV @param {number} edge @param {number} angle */
function equilateralTriangle(centerU, centerV, edge, angle) {
  const circumradius = edge / Math.sqrt(3);
  return {
    u0: centerU + Math.cos(angle) * circumradius,
    v0: centerV + Math.sin(angle) * circumradius,
    u1: centerU + Math.cos(angle + Math.PI * 2 / 3) * circumradius,
    v1: centerV + Math.sin(angle + Math.PI * 2 / 3) * circumradius,
    u2: centerU + Math.cos(angle + Math.PI * 4 / 3) * circumradius,
    v2: centerV + Math.sin(angle + Math.PI * 4 / 3) * circumradius,
  };
}

/** @param {{u0:number,v0:number,u1:number,v1:number,u2:number,v2:number}} triangle */
function triangleAreaTwice(triangle) {
  return Math.abs(
    (triangle.u1 - triangle.u0) * (triangle.v2 - triangle.v0)
    - (triangle.v1 - triangle.v0) * (triangle.u2 - triangle.u0),
  );
}

/**
 * @param {number} markSeed
 * @param {number} ordinal
 * @param {number} count
 * @param {number} radius
 * @param {"core"|"fleck"} layer
 */
function sampleTriangle(markSeed, ordinal, count, radius, layer) {
  const seed = mixUint32(
    markSeed ^ Math.imul((ordinal + 1) >>> 0, 0x9e37_79b1),
  );
  const edgeMinimum = layer === "core" ? 0.15 : 0.02;
  const edgeRange = layer === "core" ? 0.15 : 0.08;
  const edge = radius * (edgeMinimum + sampleUnit(seed, 0) * edgeRange);
  const direction = (
    ordinal + 0.18 + sampleUnit(seed, 1) * 0.64
  ) / count * Math.PI * 2;
  const radialMinimum = layer === "core" ? 0.08 : 0.35;
  const radialRange = layer === "core" ? 0.54 : 0.6;
  const maximumCenterRadius = Math.max(0, radius - edge / Math.sqrt(3));
  const radialDistance = Math.min(
    maximumCenterRadius,
    radius * (
      radialMinimum + Math.sqrt(sampleUnit(seed, 2)) * radialRange
    ),
  );
  const orientation = layer === "core"
    ? direction + (sampleUnit(seed, 3) - 0.5) * 0.7
    : sampleUnit(seed, 3) * Math.PI * 2;
  return equilateralTriangle(
    Math.cos(direction) * radialDistance,
    Math.sin(direction) * radialDistance,
    edge,
    orientation,
  );
}

/**
 * @param {{u0:number,v0:number,u1:number,v1:number,u2:number,v2:number}} triangle
 * @param {{uMinimum:number,uMaximum:number,vMinimum:number,vMaximum:number}} bounds
 */
function constrainTriangleToBounds(triangle, bounds) {
  const sourceWidth = Math.max(triangle.u0, triangle.u1, triangle.u2)
    - Math.min(triangle.u0, triangle.u1, triangle.u2);
  const sourceHeight = Math.max(triangle.v0, triangle.v1, triangle.v2)
    - Math.min(triangle.v0, triangle.v1, triangle.v2);
  const boundsWidth = bounds.uMaximum - bounds.uMinimum;
  const boundsHeight = bounds.vMaximum - bounds.vMinimum;
  const scale = Math.min(
    1,
    sourceWidth > 0 ? boundsWidth / sourceWidth : 1,
    sourceHeight > 0 ? boundsHeight / sourceHeight : 1,
  );
  const centerU = (triangle.u0 + triangle.u1 + triangle.u2) / 3;
  const centerV = (triangle.v0 + triangle.v1 + triangle.v2) / 3;
  const constrained = {
    u0: centerU + (triangle.u0 - centerU) * scale,
    v0: centerV + (triangle.v0 - centerV) * scale,
    u1: centerU + (triangle.u1 - centerU) * scale,
    v1: centerV + (triangle.v1 - centerV) * scale,
    u2: centerU + (triangle.u2 - centerU) * scale,
    v2: centerV + (triangle.v2 - centerV) * scale,
  };
  const minimumU = Math.min(constrained.u0, constrained.u1, constrained.u2);
  const maximumU = Math.max(constrained.u0, constrained.u1, constrained.u2);
  const minimumV = Math.min(constrained.v0, constrained.v1, constrained.v2);
  const maximumV = Math.max(constrained.v0, constrained.v1, constrained.v2);
  const shiftU = minimumU < bounds.uMinimum
    ? bounds.uMinimum - minimumU
    : maximumU > bounds.uMaximum
      ? bounds.uMaximum - maximumU
      : 0;
  const shiftV = minimumV < bounds.vMinimum
    ? bounds.vMinimum - minimumV
    : maximumV > bounds.vMaximum
      ? bounds.vMaximum - maximumV
      : 0;
  constrained.u0 += shiftU;
  constrained.u1 += shiftU;
  constrained.u2 += shiftU;
  constrained.v0 += shiftV;
  constrained.v1 += shiftV;
  constrained.v2 += shiftV;
  return triangleAreaTwice(constrained) > TRIANGLE_AREA_EPSILON
    ? constrained
    : null;
}

/**
 * @param {{width:number,height:number,cells:ArrayLike<number>}} map
 * @param {Set<string>} obeliskCells
 * @param {number} x
 * @param {number} z
 */
function isGroundPoint(map, obeliskCells, x, z) {
  if (!(x >= 0 && z >= 0 && x < map.width && z < map.height)) return false;
  const cx = Math.floor(x);
  const cz = Math.floor(z);
  return Number(map.cells[cz * map.width + cx]) === 0
    || obeliskCells.has(`${cx}:${cz}`);
}

/**
 * @param {{u0:number,v0:number,u1:number,v1:number,u2:number,v2:number}} triangle
 * @param {{width:number,height:number,cells:ArrayLike<number>}} map
 * @param {Set<string>} obeliskCells
 * @param {number} x
 * @param {number} z
 */
function triangleFitsGround(triangle, map, obeliskCells, x, z) {
  return isGroundPoint(map, obeliskCells, x + triangle.u0, z + triangle.v0)
    && isGroundPoint(map, obeliskCells, x + triangle.u1, z + triangle.v1)
    && isGroundPoint(map, obeliskCells, x + triangle.u2, z + triangle.v2);
}

/**
 * @param {Record<string, any>} event
 * @param {{width:number,height:number,cells:ArrayLike<number>}|undefined} map
 * @param {Array<{cell?:{cx?:number,cz?:number}}>} [obelisks]
 */
export function createScorchMark(event, map, obelisks = []) {
  if (!map || event?.type !== "explosion") return null;
  const eventId = finiteEventId(event.id);
  const x = finiteNumber(event.originX ?? event.x);
  const z = finiteNumber(event.originZ ?? event.z);
  if (eventId === null || x === null || z === null) return null;

  const radius = scorchMarkRadius(event.radius, event.pressureImpulse);
  const effectSeed = Number(event.effectSeed) >>> 0;
  const markSeed = mixUint32(
    effectSeed
    ^ Math.imul(Number(eventId) >>> 0, 0x27d4_eb2d)
    ^ 0x7363_6f72,
  );
  const hitKind = String(event.hit?.kind ?? "");
  const cellCx = Number(event.cell?.cx ?? event.hit?.cx);
  const cellCz = Number(event.cell?.cz ?? event.hit?.cz);
  const rawNx = finiteNumber(event.nx) ?? 0;
  const rawNz = finiteNumber(event.nz) ?? 0;
  const wall = hitKind === "cell"
    && Number.isInteger(cellCx)
    && Number.isInteger(cellCz)
    && cellCx >= 0
    && cellCz >= 0
    && cellCx < map.width
    && cellCz < map.height
    && (Math.abs(rawNx) > 0.5 || Math.abs(rawNz) > 0.5);

  let surface;
  if (wall) {
    const normalAlongX = Math.abs(rawNx) >= Math.abs(rawNz);
    const nx = normalAlongX ? Math.sign(rawNx) || 1 : 0;
    const nz = normalAlongX ? 0 : Math.sign(rawNz) || 1;
    const tx = normalAlongX ? 0 : 1;
    const tz = normalAlongX ? 1 : 0;
    const anchorX = normalAlongX
      ? cellCx + (nx > 0 ? 1 : 0)
      : clamp(x, cellCx + WALL_FACE_MARGIN_METERS, cellCx + 1 - WALL_FACE_MARGIN_METERS);
    const anchorZ = normalAlongX
      ? clamp(z, cellCz + WALL_FACE_MARGIN_METERS, cellCz + 1 - WALL_FACE_MARGIN_METERS)
      : cellCz + (nz > 0 ? 1 : 0);
    const y = clamp(
      FIREBALL_PRESENTATION_HEIGHT_METERS,
      WALL_FACE_MARGIN_METERS,
      SCORCH_WALL_HEIGHT_METERS - WALL_FACE_MARGIN_METERS,
    );
    const tangentAnchor = normalAlongX ? anchorZ : anchorX;
    const tangentMinimum = normalAlongX ? cellCz : cellCx;
    const tangentMaximum = tangentMinimum + 1;
    surface = {
      kind: "wall",
      x: anchorX,
      y,
      z: anchorZ,
      nx,
      nz,
      tx,
      tz,
      cell: { cx: cellCx, cz: cellCz },
      bounds: {
        uMinimum: tangentMinimum + WALL_FACE_MARGIN_METERS - tangentAnchor,
        uMaximum: tangentMaximum - WALL_FACE_MARGIN_METERS - tangentAnchor,
        vMinimum: WALL_FACE_MARGIN_METERS - y,
        vMaximum: SCORCH_WALL_HEIGHT_METERS - WALL_FACE_MARGIN_METERS - y,
      },
    };
  } else {
    surface = {
      kind: "ground",
      x,
      y: SCORCH_GROUND_Y_METERS,
      z,
      nx: 0,
      nz: 0,
      tx: 1,
      tz: 0,
      cell: null,
      bounds: null,
    };
  }

  const obeliskCells = new Set(
    obelisks.map((obelisk) => `${obelisk.cell?.cx}:${obelisk.cell?.cz}`),
  );
  const coreTriangles = [];
  const fleckTriangles = [];
  for (let ordinal = 0; ordinal < SCORCH_CORE_TRIANGLE_COUNT; ordinal += 1) {
    let triangle = sampleTriangle(
      markSeed,
      ordinal,
      SCORCH_CORE_TRIANGLE_COUNT,
      radius,
      "core",
    );
    if (surface.kind === "wall") {
      triangle = constrainTriangleToBounds(triangle, surface.bounds);
    } else if (!triangleFitsGround(triangle, map, obeliskCells, x, z)) {
      triangle = null;
    }
    if (triangle) coreTriangles.push(triangle);
  }
  for (let ordinal = 0; ordinal < SCORCH_FLECK_TRIANGLE_COUNT; ordinal += 1) {
    let triangle = sampleTriangle(
      markSeed,
      SCORCH_CORE_TRIANGLE_COUNT + ordinal,
      SCORCH_FLECK_TRIANGLE_COUNT,
      radius,
      "fleck",
    );
    if (surface.kind === "wall") {
      triangle = constrainTriangleToBounds(triangle, surface.bounds);
    } else if (!triangleFitsGround(triangle, map, obeliskCells, x, z)) {
      triangle = null;
    }
    if (triangle) fleckTriangles.push(triangle);
  }

  if (coreTriangles.length === 0 && fleckTriangles.length === 0) return null;
  return {
    eventId: Number(eventId),
    tick: Number(event.tick) || 0,
    effectSeed,
    markSeed,
    radius,
    surface,
    coreTriangles,
    fleckTriangles,
  };
}

/** @param {Record<string, any>} snapshot */
function explosionEvents(snapshot) {
  return Array.isArray(snapshot?.recentEvents)
    ? snapshot.recentEvents.filter((event) => event?.type === "explosion")
    : [];
}

export class ScorchMarkPool {
  /** @param {{capacity?:number}} [options] */
  constructor({ capacity = SCORCH_MARK_CAPACITY } = {}) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new RangeError("Scorch mark capacity must be a positive integer");
    }
    this.capacity = capacity;
    this.values = new Array(capacity);
    this.start = 0;
    this.length = 0;
    this.revision = 0;
    this.primed = false;
    this.lastTick = null;
    this.lastSeed = null;
    this.lastMapHash = null;
    this.lastObservedEventId = null;
    this.observedEventIds = new Set();
    this.overwrites = 0;
    this.ingested = 0;
    this.missedEvents = 0;
    this.duplicateEvents = 0;
    this.skippedEvents = 0;
    this.resets = 0;
    this.coreTriangleCount = 0;
    this.fleckTriangleCount = 0;
  }

  /** @param {Record<string, any>} snapshot */
  prime(snapshot) {
    if (this.length > 0) this.revision += 1;
    this.#clearEntries();
    this.#primeTimeline(snapshot);
  }

  /**
   * Consumes newly observed impact events. Returns true only when resident mark
   * geometry must be republished.
   *
   * @param {Record<string, any>} snapshot
   */
  ingest(snapshot) {
    if (!this.primed) {
      this.prime(snapshot);
      return false;
    }
    const tick = Number(snapshot?.tick ?? 0);
    const seed = Number(snapshot?.seed ?? 0);
    const mapHash = scorchMapHash(snapshot?.map, snapshot?.obelisks ?? []);
    const events = explosionEvents(snapshot);
    const timelineCleared = this.observedEventIds.size > 0 && events.length === 0;
    if (
      (this.lastTick !== null && tick < this.lastTick)
      || (this.lastSeed !== null && seed !== this.lastSeed)
      || (this.lastMapHash !== null && mapHash !== this.lastMapHash)
      || timelineCleared
    ) {
      const changed = this.length > 0;
      this.#clearEntries();
      this.resets += 1;
      if (changed) this.revision += 1;
      this.#primeTimeline(snapshot);
      return changed;
    }

    this.lastTick = tick;
    this.lastSeed = seed;
    this.lastMapHash = mapHash;
    const currentEventIds = new Set();
    const candidates = [];
    for (const event of events) {
      const id = finiteEventId(event.id);
      if (id === null) {
        this.skippedEvents += 1;
        continue;
      }
      if (currentEventIds.has(id)) {
        this.duplicateEvents += 1;
        continue;
      }
      currentEventIds.add(id);
      if (!this.observedEventIds.has(id)) candidates.push(event);
    }
    candidates.sort((left, right) => (
      Number(left.tick) - Number(right.tick)
      || Number(left.id) - Number(right.id)
    ));

    let changed = false;
    for (const event of candidates) {
      const id = Number(event.id);
      if (this.lastObservedEventId !== null && id <= this.lastObservedEventId) {
        this.skippedEvents += 1;
        continue;
      }
      if (this.lastObservedEventId !== null && id > this.lastObservedEventId + 1) {
        this.missedEvents += id - this.lastObservedEventId - 1;
      }
      this.lastObservedEventId = id;
      const mark = createScorchMark(event, snapshot.map, snapshot.obelisks ?? []);
      if (!mark) {
        this.skippedEvents += 1;
        continue;
      }
      this.#push(mark);
      this.ingested += 1;
      changed = true;
    }
    this.observedEventIds = currentEventIds;
    return changed;
  }

  clear() {
    const changed = this.length > 0;
    this.#clearEntries();
    this.primed = false;
    this.lastTick = null;
    this.lastSeed = null;
    this.lastMapHash = null;
    this.lastObservedEventId = null;
    this.observedEventIds.clear();
    this.resets += 1;
    if (changed) this.revision += 1;
    return changed;
  }

  /** @param {number} index */
  at(index) {
    if (!Number.isInteger(index) || index < 0 || index >= this.length) {
      return undefined;
    }
    return this.values[(this.start + index) % this.capacity];
  }

  toArray() {
    return Array.from({ length: this.length }, (_, index) => this.at(index));
  }

  diagnostics() {
    return {
      capacity: this.capacity,
      active: this.length,
      overwrites: this.overwrites,
      ingested: this.ingested,
      missedEvents: this.missedEvents,
      duplicateEvents: this.duplicateEvents,
      skippedEvents: this.skippedEvents,
      resets: this.resets,
      coreTriangles: this.coreTriangleCount,
      fleckTriangles: this.fleckTriangleCount,
    };
  }

  /** @param {Record<string, any>} snapshot */
  #primeTimeline(snapshot) {
    const events = explosionEvents(snapshot);
    const ids = events
      .map((event) => finiteEventId(event.id))
      .filter((id) => id !== null);
    this.observedEventIds = new Set(ids);
    this.lastObservedEventId = ids.length > 0 ? Math.max(...ids) : null;
    this.lastTick = Number(snapshot?.tick ?? 0);
    this.lastSeed = Number(snapshot?.seed ?? 0);
    this.lastMapHash = scorchMapHash(snapshot?.map, snapshot?.obelisks ?? []);
    this.primed = true;
  }

  #clearEntries() {
    this.values.fill(undefined);
    this.start = 0;
    this.length = 0;
    this.coreTriangleCount = 0;
    this.fleckTriangleCount = 0;
  }

  /** @param {NonNullable<ReturnType<typeof createScorchMark>>} mark */
  #push(mark) {
    const index = (this.start + this.length) % this.capacity;
    if (this.length < this.capacity) {
      this.length += 1;
    } else {
      const overwritten = this.values[index];
      if (overwritten) {
        this.coreTriangleCount -= overwritten.coreTriangles.length;
        this.fleckTriangleCount -= overwritten.fleckTriangles.length;
      }
      this.start = (this.start + 1) % this.capacity;
      this.overwrites += 1;
    }
    this.values[index] = mark;
    this.coreTriangleCount += mark.coreTriangles.length;
    this.fleckTriangleCount += mark.fleckTriangles.length;
    this.revision += 1;
  }
}
