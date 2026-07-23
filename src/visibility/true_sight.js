// @ts-check

import { HISTORY } from "../config.js";
import { CachedTimingSamples } from "../core/performance.js";

export const TRUE_SIGHT_MAX_RAYS = 2_048;
export const TRUE_SIGHT_TEXELS_PER_METER = 8;
export const TRUE_SIGHT_MAX_MASK_DIMENSION = 256;
export const TRUE_SIGHT_REVEAL_MS = 100;
export const TRUE_SIGHT_CONCEAL_MS = 150;

const ANGLE_EPSILON = 1e-7;
const POINT_EPSILON_METERS = 1e-5;
const DDA_TIE_EPSILON = 1e-12;
const TWO_PI = Math.PI * 2;
const CIRCLE_SAMPLE_COUNT = 8;

/** @param {number} value @param {number} minimum @param {number} maximum */
function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

/** @param {number} angle */
function normalizeAngle(angle) {
  const normalized = angle % TWO_PI;
  return normalized < 0 ? normalized + TWO_PI : normalized;
}

/** @param {{width:number,height:number,cells:ArrayLike<number>}} map */
export function hashSightMap(map) {
  let hash = 2_166_136_261;
  hash = Math.imul(hash ^ map.width, 16_777_619);
  hash = Math.imul(hash ^ map.height, 16_777_619);
  for (let index = 0; index < map.cells.length; index += 1) {
    hash = Math.imul(hash ^ Number(map.cells[index]), 16_777_619);
  }
  return hash >>> 0;
}

/** @param {Float64Array} values @param {number} root @param {number} end */
function siftDownNumericPrefix(values, root, end) {
  while (root * 2 + 1 <= end) {
    let child = root * 2 + 1;
    if (child + 1 <= end && values[child] < values[child + 1]) child += 1;
    if (values[root] >= values[child]) return;
    const temporary = values[root];
    values[root] = values[child];
    values[child] = temporary;
    root = child;
  }
}

/** @param {Float64Array} values @param {number} length */
function sortNumericPrefix(values, length) {
  for (let start = Math.floor((length - 2) / 2); start >= 0; start -= 1) {
    siftDownNumericPrefix(values, start, length - 1);
  }
  for (let end = length - 1; end > 0; end -= 1) {
    const temporary = values[end];
    values[end] = values[0];
    values[0] = temporary;
    siftDownNumericPrefix(values, 0, end - 1);
  }
}

/**
 * @typedef {{
 *   orientation:"horizontal"|"vertical",
 *   fixed:number,
 *   start:number,
 *   end:number
 * }} CollinearEdge
 */

/**
 * @typedef {{
 *   x1:number,z1:number,x2:number,z2:number,
 *   floorNx:number,floorNz:number,
 *   wallCx:number,wallCz:number,wallIndex:number
 * }} ExposedCellEdge
 */

/** @param {Map<string,Array<[number,number]>>} groups */
function mergeCollinearEdges(groups) {
  /** @type {CollinearEdge[]} */
  const merged = [];
  const keys = [...groups.keys()].sort((left, right) => {
    const [leftOrientation, leftFixed, leftSide] = left.split(":");
    const [rightOrientation, rightFixed, rightSide] = right.split(":");
    if (leftOrientation !== rightOrientation) {
      return leftOrientation < rightOrientation ? -1 : 1;
    }
    return Number(leftFixed) - Number(rightFixed)
      || Number(leftSide) - Number(rightSide);
  });
  for (const key of keys) {
    const intervals = groups.get(key);
    if (!intervals || intervals.length === 0) continue;
    intervals.sort((left, right) => left[0] - right[0] || left[1] - right[1]);
    let start = intervals[0][0];
    let end = intervals[0][1];
    const [orientationCode, fixedText] = key.split(":");
    for (let index = 1; index <= intervals.length; index += 1) {
      const interval = intervals[index];
      if (interval && interval[0] <= end) {
        end = Math.max(end, interval[1]);
        continue;
      }
      merged.push({
        orientation: orientationCode === "h" ? "horizontal" : "vertical",
        fixed: Number(fixedText),
        start,
        end,
      });
      if (interval) {
        start = interval[0];
        end = interval[1];
      }
    }
  }
  return merged;
}

/** @param {{width:number,height:number,cells:ArrayLike<number>}} map @param {number} hash */
function buildTopology(map, hash) {
  /** @type {ExposedCellEdge[]} */
  const exposedEdges = [];
  /** @type {Map<string,Array<[number,number]>>} */
  const groups = new Map();
  /** @type {number[]} */
  const wallIndices = [];

  /** @param {string} key @param {number} start @param {number} end */
  function addInterval(key, start, end) {
    let intervals = groups.get(key);
    if (!intervals) {
      intervals = [];
      groups.set(key, intervals);
    }
    intervals.push([start, end]);
  }

  for (let cz = 0; cz < map.height; cz += 1) {
    for (let cx = 0; cx < map.width; cx += 1) {
      const wallIndex = cz * map.width + cx;
      if (Number(map.cells[wallIndex]) !== 1) continue;
      wallIndices.push(wallIndex);
      if (cz > 0 && Number(map.cells[(cz - 1) * map.width + cx]) === 0) {
        exposedEdges.push({
          x1: cx,
          z1: cz,
          x2: cx + 1,
          z2: cz,
          floorNx: 0,
          floorNz: -1,
          wallCx: cx,
          wallCz: cz,
          wallIndex,
        });
        addInterval(`h:${cz}:-1`, cx, cx + 1);
      }
      if (
        cz + 1 < map.height
        && Number(map.cells[(cz + 1) * map.width + cx]) === 0
      ) {
        exposedEdges.push({
          x1: cx,
          z1: cz + 1,
          x2: cx + 1,
          z2: cz + 1,
          floorNx: 0,
          floorNz: 1,
          wallCx: cx,
          wallCz: cz,
          wallIndex,
        });
        addInterval(`h:${cz + 1}:1`, cx, cx + 1);
      }
      if (cx > 0 && Number(map.cells[cz * map.width + cx - 1]) === 0) {
        exposedEdges.push({
          x1: cx,
          z1: cz,
          x2: cx,
          z2: cz + 1,
          floorNx: -1,
          floorNz: 0,
          wallCx: cx,
          wallCz: cz,
          wallIndex,
        });
        addInterval(`v:${cx}:-1`, cz, cz + 1);
      }
      if (
        cx + 1 < map.width
        && Number(map.cells[cz * map.width + cx + 1]) === 0
      ) {
        exposedEdges.push({
          x1: cx + 1,
          z1: cz,
          x2: cx + 1,
          z2: cz + 1,
          floorNx: 1,
          floorNz: 0,
          wallCx: cx,
          wallCz: cz,
          wallIndex,
        });
        addInterval(`v:${cx + 1}:1`, cz, cz + 1);
      }
    }
  }

  const mergedEdges = mergeCollinearEdges(groups);
  /** @type {Map<string,{x:number,z:number}>} */
  const cornerByKey = new Map();
  /** @param {number} x @param {number} z */
  function addCorner(x, z) {
    const key = `${x}:${z}`;
    if (!cornerByKey.has(key)) cornerByKey.set(key, { x, z });
  }
  addCorner(0, 0);
  addCorner(map.width, 0);
  addCorner(map.width, map.height);
  addCorner(0, map.height);
  for (const edge of mergedEdges) {
    if (edge.orientation === "horizontal") {
      addCorner(edge.start, edge.fixed);
      addCorner(edge.end, edge.fixed);
    } else {
      addCorner(edge.fixed, edge.start);
      addCorner(edge.fixed, edge.end);
    }
  }

  const candidateCorners = [...cornerByKey.values()].sort(
    (left, right) => left.z - right.z || left.x - right.x,
  );
  return {
    hash,
    width: map.width,
    height: map.height,
    exposedEdges,
    mergedEdges,
    candidateCorners,
    wallIndices,
  };
}

/**
 * @param {{x:number,z:number,hitCellIndex:number,crossings:number}} output
 * @param {{width:number,height:number}} map
 * @param {number} originX
 * @param {number} originZ
 * @param {number} dx
 * @param {number} dz
 * @param {number} distance
 * @param {number} hitCellIndex
 * @param {number} crossings
 */
function finishGridRay(
  output,
  map,
  originX,
  originZ,
  dx,
  dz,
  distance,
  hitCellIndex,
  crossings,
) {
  output.x = clamp(originX + dx * distance, 0, map.width);
  output.z = clamp(originZ + dz * distance, 0, map.height);
  output.hitCellIndex = hitCellIndex;
  output.crossings = crossings;
  return output;
}

/**
 * @param {{width:number,height:number,cells:ArrayLike<number>}} map
 * @param {number} originX
 * @param {number} originZ
 * @param {number} angle
 * @param {{x:number,z:number,hitCellIndex:number,crossings:number}} output
 */
function castGridRay(map, originX, originZ, angle, output) {
  const dx = Math.cos(angle);
  const dz = Math.sin(angle);
  let cx = clamp(Math.floor(originX), 0, map.width - 1);
  let cz = clamp(Math.floor(originZ), 0, map.height - 1);
  const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const stepZ = dz > 0 ? 1 : dz < 0 ? -1 : 0;
  const deltaX = stepX === 0 ? Infinity : Math.abs(1 / dx);
  const deltaZ = stepZ === 0 ? Infinity : Math.abs(1 / dz);
  let nextX = stepX > 0 ? cx + 1 : cx;
  let nextZ = stepZ > 0 ? cz + 1 : cz;
  let maximumX = stepX === 0 ? Infinity : (nextX - originX) / dx;
  let maximumZ = stepZ === 0 ? Infinity : (nextZ - originZ) / dz;
  maximumX = Math.max(0, maximumX);
  maximumZ = Math.max(0, maximumZ);
  const crossingLimit = map.width + map.height + 4;
  let crossings = 0;

  while (crossings <= crossingLimit) {
    const tie = Math.abs(maximumX - maximumZ) <= DDA_TIE_EPSILON;
    if (tie) {
      const distance = Math.min(maximumX, maximumZ);
      const nextCellX = cx + stepX;
      const nextCellZ = cz + stepZ;
      let hitCellIndex = Infinity;
      if (
        nextCellX >= 0
        && nextCellX < map.width
        && cz >= 0
        && cz < map.height
        && Number(map.cells[cz * map.width + nextCellX]) === 1
      ) {
        hitCellIndex = cz * map.width + nextCellX;
      }
      if (
        cx >= 0
        && cx < map.width
        && nextCellZ >= 0
        && nextCellZ < map.height
        && Number(map.cells[nextCellZ * map.width + cx]) === 1
      ) {
        hitCellIndex = Math.min(
          hitCellIndex,
          nextCellZ * map.width + cx,
        );
      }
      if (
        nextCellX >= 0
        && nextCellX < map.width
        && nextCellZ >= 0
        && nextCellZ < map.height
        && Number(map.cells[nextCellZ * map.width + nextCellX]) === 1
      ) {
        hitCellIndex = Math.min(
          hitCellIndex,
          nextCellZ * map.width + nextCellX,
        );
      }
      crossings += 2;
      if (hitCellIndex !== Infinity) {
        return finishGridRay(
          output,
          map,
          originX,
          originZ,
          dx,
          dz,
          distance,
          hitCellIndex,
          crossings,
        );
      }
      cx = nextCellX;
      cz = nextCellZ;
      if (cx < 0 || cz < 0 || cx >= map.width || cz >= map.height) {
        return finishGridRay(
          output,
          map,
          originX,
          originZ,
          dx,
          dz,
          distance,
          -1,
          crossings,
        );
      }
      maximumX += deltaX;
      maximumZ += deltaZ;
      continue;
    }

    if (maximumX < maximumZ) {
      const distance = maximumX;
      cx += stepX;
      crossings += 1;
      if (cx < 0 || cz < 0 || cx >= map.width || cz >= map.height) {
        return finishGridRay(
          output,
          map,
          originX,
          originZ,
          dx,
          dz,
          distance,
          -1,
          crossings,
        );
      }
      if (Number(map.cells[cz * map.width + cx]) === 1) {
        return finishGridRay(
          output,
          map,
          originX,
          originZ,
          dx,
          dz,
          distance,
          cz * map.width + cx,
          crossings,
        );
      }
      maximumX += deltaX;
    } else {
      const distance = maximumZ;
      cz += stepZ;
      crossings += 1;
      if (cx < 0 || cz < 0 || cx >= map.width || cz >= map.height) {
        return finishGridRay(
          output,
          map,
          originX,
          originZ,
          dx,
          dz,
          distance,
          -1,
          crossings,
        );
      }
      if (Number(map.cells[cz * map.width + cx]) === 1) {
        return finishGridRay(
          output,
          map,
          originX,
          originZ,
          dx,
          dz,
          distance,
          cz * map.width + cx,
          crossings,
        );
      }
      maximumZ += deltaZ;
    }
  }

  let distance = Infinity;
  if (dx > 0) distance = Math.min(distance, (map.width - originX) / dx);
  else if (dx < 0) distance = Math.min(distance, -originX / dx);
  if (dz > 0) distance = Math.min(distance, (map.height - originZ) / dz);
  else if (dz < 0) distance = Math.min(distance, -originZ / dz);
  return finishGridRay(
    output,
    map,
    originX,
    originZ,
    dx,
    dz,
    distance,
    -1,
    crossings,
  );
}

export class TrueSightFrame {
  constructor() {
    this.origin = { x: 0, z: 0 };
    /** @type {Array<{x:number,z:number}>} */
    this.polygon = [];
    /** @type {Array<{angle:number,x:number,z:number,hitCell:{cx:number,cz:number,index:number}|null,crossings:number}>} */
    this.rays = [];
    /** @type {Array<{cx:number,cz:number,index:number}>} */
    this.hitWallCells = [];
    /** @type {Array<{cx:number,cz:number,index:number}>} */
    this.visibleWallCells = [];
    this.logicalMask = new Uint8Array(1);
    this.displayMask = new Uint8Array(1);
    this.maskWidth = 1;
    this.maskHeight = 1;
    this.mapWidth = 1;
    this.mapHeight = 1;
    this.texelsPerMeter = 1;
    this.rayCount = 0;
    this.polygonVertexCount = 0;
    this.visibleWallCount = 0;
    this.fallbackUsed = false;
    this.topologyHash = 0;
    this.topologyBuildCount = 0;
    this.snapReason = "initial";
    this.flags = {
      trueSight: true,
      sightFade: true,
      sightDebug: false,
    };
    this.timing = {};
  }

  /** @param {number} x @param {number} z @param {Uint8Array} mask */
  #maskValue(x, z, mask) {
    if (
      !Number.isFinite(x)
      || !Number.isFinite(z)
      || x < 0
      || z < 0
      || x >= this.mapWidth
      || z >= this.mapHeight
    ) return 0;
    const px = Math.min(
      this.maskWidth - 1,
      Math.floor((x / this.mapWidth) * this.maskWidth),
    );
    const pz = Math.min(
      this.maskHeight - 1,
      Math.floor((z / this.mapHeight) * this.maskHeight),
    );
    return mask[pz * this.maskWidth + px];
  }

  /** @param {number} x @param {number} z */
  isPointVisible(x, z) {
    return this.#maskValue(Number(x), Number(z), this.logicalMask) > 0;
  }

  /** @param {number} x @param {number} z @param {number} [radius] */
  isCircleVisible(x, z, radius = 0) {
    const centerX = Number(x);
    const centerZ = Number(z);
    const sampleRadius = Math.max(0, Number(radius) || 0);
    if (this.isPointVisible(centerX, centerZ)) return true;
    if (sampleRadius === 0) return false;
    for (let index = 0; index < CIRCLE_SAMPLE_COUNT; index += 1) {
      const angle = (index / CIRCLE_SAMPLE_COUNT) * TWO_PI;
      if (
        this.isPointVisible(
          centerX + Math.cos(angle) * sampleRadius,
          centerZ + Math.sin(angle) * sampleRadius,
        )
      ) return true;
    }
    return false;
  }

  /** @param {number} x @param {number} z */
  displayVisibilityAt(x, z) {
    const worldX = Number(x);
    const worldZ = Number(z);
    if (
      !Number.isFinite(worldX)
      || !Number.isFinite(worldZ)
      || worldX < 0
      || worldZ < 0
      || worldX >= this.mapWidth
      || worldZ >= this.mapHeight
    ) return 0;
    const textureX = (worldX / this.mapWidth) * this.maskWidth - 0.5;
    const textureZ = (worldZ / this.mapHeight) * this.maskHeight - 0.5;
    const x0 = clamp(Math.floor(textureX), 0, this.maskWidth - 1);
    const z0 = clamp(Math.floor(textureZ), 0, this.maskHeight - 1);
    const x1 = Math.min(this.maskWidth - 1, x0 + 1);
    const z1 = Math.min(this.maskHeight - 1, z0 + 1);
    const fx = clamp(textureX - Math.floor(textureX), 0, 1);
    const fz = clamp(textureZ - Math.floor(textureZ), 0, 1);
    const upperLeft = this.displayMask[z0 * this.maskWidth + x0];
    const upperRight = this.displayMask[z0 * this.maskWidth + x1];
    const lowerLeft = this.displayMask[z1 * this.maskWidth + x0];
    const lowerRight = this.displayMask[z1 * this.maskWidth + x1];
    const upper = upperLeft + (upperRight - upperLeft) * fx;
    const lower = lowerLeft + (lowerRight - lowerLeft) * fx;
    return (upper + (lower - upper) * fz) / 255;
  }

  diagnostics() {
    return {
      origin: { ...this.origin },
      polygon: this.polygon.map((point) => ({ x: point.x, z: point.z })),
      maskDimensions: {
        width: this.maskWidth,
        height: this.maskHeight,
        texelsPerMeter: this.texelsPerMeter,
      },
      rayCount: this.rayCount,
      polygonVertexCount: this.polygonVertexCount,
      visibleWallCount: this.visibleWallCount,
      hitWallCount: this.hitWallCells.length,
      fallbackUsed: this.fallbackUsed,
      topologyHash: this.topologyHash,
      topologyBuildCount: this.topologyBuildCount,
      flags: { ...this.flags },
      snapReason: this.snapReason,
      timings: structuredClone(this.timing),
      trueSightCpuMs: structuredClone(this.timing.totalMs ?? {}),
    };
  }
}

export class TrueSightSystem {
  /**
   * @param {{
   *   flags?:import('../presentation/options.js').PresentationFlags,
   *   now?:()=>number
   * }} [options]
   */
  constructor(options = {}) {
    this.flags = options.flags ?? null;
    this.now = options.now ?? (() => performance.now());
    this.frame = new TrueSightFrame();
    this.topology = null;
    this.topologyBuildCount = 0;
    this.lastUpdateTime = null;
    this.lastTick = null;
    this.lastSeed = null;
    this.lastMode = null;
    this.lastOriginX = null;
    this.lastOriginZ = null;
    this.pendingSnapReason = "initial";
    this.angleBuffer = new Float64Array(TRUE_SIGHT_MAX_RAYS);
    this.hitX = new Float64Array(TRUE_SIGHT_MAX_RAYS);
    this.hitZ = new Float64Array(TRUE_SIGHT_MAX_RAYS);
    this.hitCell = new Int32Array(TRUE_SIGHT_MAX_RAYS);
    this.hitCrossings = new Uint16Array(TRUE_SIGHT_MAX_RAYS);
    this.polygonX = new Float64Array(TRUE_SIGHT_MAX_RAYS);
    this.polygonZ = new Float64Array(TRUE_SIGHT_MAX_RAYS);
    this.scanIntersections = new Float64Array(TRUE_SIGHT_MAX_RAYS);
    this.displayLevels = new Float32Array(1);
    this.wallVisible = new Uint8Array(1);
    this.hitWallVisible = new Uint8Array(1);
    this._rayOutput = { x: 0, z: 0, hitCellIndex: -1, crossings: 0 };
    this._pointPool = Array.from(
      { length: TRUE_SIGHT_MAX_RAYS },
      () => ({ x: 0, z: 0 }),
    );
    this._rayPool = Array.from(
      { length: TRUE_SIGHT_MAX_RAYS },
      () => ({
        angle: 0,
        x: 0,
        z: 0,
        hitCell: /** @type {{cx:number,cz:number,index:number}|null} */ (null),
        crossings: 0,
        _hitCell: { cx: 0, cz: 0, index: 0 },
      }),
    );
    this._cellPool = [];
    const timingOptions = { capacity: HISTORY.metrics };
    this.timings = {
      topologyMs: new CachedTimingSamples(timingOptions),
      raysMs: new CachedTimingSamples(timingOptions),
      rasterMs: new CachedTimingSamples(timingOptions),
      fadeMs: new CachedTimingSamples(timingOptions),
      totalMs: new CachedTimingSamples(timingOptions),
    };
  }

  /** @param {string} [reason] */
  requestSnap(reason = "requested") {
    this.pendingSnapReason = reason;
  }

  resetPerformanceMetrics() {
    for (const samples of Object.values(this.timings)) samples.clear();
    this.#publishTimingSummaries();
  }

  /**
   * @param {ReturnType<import('../sim/simulation.js').Simulation['snapshot']>} snapshot
   * @param {number} alpha
   * @param {{mode?:"play"|"edit",deltaMs?:number,forceSnap?:boolean,snapReason?:string}} [options]
   */
  update(snapshot, alpha, options = {}) {
    const totalStarted = this.now();
    const map = snapshot.map;
    const mapHash = hashSightMap(map);
    const topologyStarted = this.now();
    const mapChanged = (
      !this.topology
      || this.topology.hash !== mapHash
      || this.topology.width !== map.width
      || this.topology.height !== map.height
    );
    if (mapChanged) {
      this.topology = buildTopology(map, mapHash);
      this.topologyBuildCount += 1;
      this.#ensureMaskStorage(map.width, map.height);
      this.#ensureCellPool(map.width * map.height);
    }
    const topologyFinished = this.now();

    const interpolation = clamp(Number(alpha) || 0, 0, 1);
    const originX = snapshot.player.previousX
      + (snapshot.player.x - snapshot.player.previousX) * interpolation;
    const originZ = snapshot.player.previousZ
      + (snapshot.player.z - snapshot.player.previousZ) * interpolation;
    this.frame.origin.x = originX;
    this.frame.origin.z = originZ;
    this.frame.mapWidth = map.width;
    this.frame.mapHeight = map.height;
    this.frame.topologyHash = mapHash;
    this.frame.topologyBuildCount = this.topologyBuildCount;
    this.#readFlags();

    const raysStarted = this.now();
    this.#buildPolygon(map, originX, originZ);
    const raysFinished = this.now();

    const rasterStarted = this.now();
    this.#rasterizePolygon();
    this.#markVisibleWalls();
    const mode = options.mode ?? "play";
    if (!this.frame.flags.trueSight || mode === "edit") {
      this.frame.logicalMask.fill(255);
      this.#publishAllWalls();
    }
    const rasterFinished = this.now();

    let snapReason = "";
    if (this.pendingSnapReason) snapReason = this.pendingSnapReason;
    if (mapChanged) snapReason = "map-change";
    if (this.lastTick !== null && snapshot.tick < this.lastTick) {
      snapReason = "tick-rollback";
    }
    if (this.lastSeed !== null && snapshot.seed !== this.lastSeed) {
      snapReason = "reset";
    }
    if (
      this.lastOriginX !== null
      && Math.hypot(originX - this.lastOriginX, originZ - this.lastOriginZ) > 2
    ) {
      snapReason = "movement-jump";
    }
    if (this.lastMode !== null && mode !== this.lastMode) {
      snapReason = "edit-mode-transition";
    }
    if (options.forceSnap) snapReason = options.snapReason ?? "renderer-recovery";

    const fadeStarted = this.now();
    const updateTime = this.now();
    const deltaMs = Number.isFinite(options.deltaMs)
      ? Math.max(0, Number(options.deltaMs))
      : this.lastUpdateTime === null
        ? 0
        : clamp(updateTime - this.lastUpdateTime, 0, 250);
    if (snapReason || !this.frame.flags.sightFade) {
      this.#snapDisplayMask();
      this.frame.snapReason = snapReason || "fade-disabled";
    } else {
      this.#fadeDisplayMask(deltaMs);
      this.frame.snapReason = "";
    }
    const fadeFinished = this.now();

    this.pendingSnapReason = "";
    this.lastUpdateTime = updateTime;
    this.lastTick = snapshot.tick;
    this.lastSeed = snapshot.seed;
    this.lastMode = mode;
    this.lastOriginX = originX;
    this.lastOriginZ = originZ;

    const totalFinished = this.now();
    this.timings.topologyMs.push(topologyFinished - topologyStarted);
    this.timings.raysMs.push(raysFinished - raysStarted);
    this.timings.rasterMs.push(rasterFinished - rasterStarted);
    this.timings.fadeMs.push(fadeFinished - fadeStarted);
    this.timings.totalMs.push(totalFinished - totalStarted);
    this.#publishTimingSummaries();
    return this.frame;
  }

  #publishTimingSummaries() {
    this.frame.timing = {
      topologyMs: this.timings.topologyMs.summary(),
      raysMs: this.timings.raysMs.summary(),
      rasterMs: this.timings.rasterMs.summary(),
      fadeMs: this.timings.fadeMs.summary(),
      totalMs: this.timings.totalMs.summary(),
    };
  }

  #readFlags() {
    const values = this.flags?.values ?? {};
    this.frame.flags.trueSight = values.trueSight ?? true;
    this.frame.flags.sightFade = values.sightFade ?? true;
    this.frame.flags.sightDebug = values.sightDebug ?? false;
  }

  /** @param {number} width @param {number} height */
  #ensureMaskStorage(width, height) {
    const texelsPerMeter = Math.min(
      TRUE_SIGHT_TEXELS_PER_METER,
      TRUE_SIGHT_MAX_MASK_DIMENSION / width,
      TRUE_SIGHT_MAX_MASK_DIMENSION / height,
    );
    const maskWidth = clamp(
      Math.round(width * texelsPerMeter),
      1,
      TRUE_SIGHT_MAX_MASK_DIMENSION,
    );
    const maskHeight = clamp(
      Math.round(height * texelsPerMeter),
      1,
      TRUE_SIGHT_MAX_MASK_DIMENSION,
    );
    const length = maskWidth * maskHeight;
    this.frame.maskWidth = maskWidth;
    this.frame.maskHeight = maskHeight;
    this.frame.texelsPerMeter = texelsPerMeter;
    if (this.frame.logicalMask.length !== length) {
      this.frame.logicalMask = new Uint8Array(length);
      this.frame.displayMask = new Uint8Array(length);
      this.displayLevels = new Float32Array(length);
    }
    const cellCount = width * height;
    if (this.wallVisible.length !== cellCount) {
      this.wallVisible = new Uint8Array(cellCount);
      this.hitWallVisible = new Uint8Array(cellCount);
    }
  }

  /** @param {number} count */
  #ensureCellPool(count) {
    while (this._cellPool.length < count) {
      this._cellPool.push({ cx: 0, cz: 0, index: 0 });
    }
  }

  /** @param {{width:number,height:number,cells:ArrayLike<number>}} map @param {number} originX @param {number} originZ */
  #buildPolygon(map, originX, originZ) {
    const topology = this.topology;
    if (!topology) return;
    let rayCount = 0;
    const derivedRayCount = topology.candidateCorners.length * 3;
    const fallbackUsed = derivedRayCount > TRUE_SIGHT_MAX_RAYS;
    if (fallbackUsed) {
      rayCount = TRUE_SIGHT_MAX_RAYS;
      for (let index = 0; index < rayCount; index += 1) {
        this.angleBuffer[index] = (index / rayCount) * TWO_PI;
      }
    } else {
      for (const corner of topology.candidateCorners) {
        const angle = Math.atan2(corner.z - originZ, corner.x - originX);
        this.angleBuffer[rayCount] = normalizeAngle(angle - ANGLE_EPSILON);
        this.angleBuffer[rayCount + 1] = normalizeAngle(angle);
        this.angleBuffer[rayCount + 2] = normalizeAngle(angle + ANGLE_EPSILON);
        rayCount += 3;
      }
      sortNumericPrefix(this.angleBuffer, rayCount);
    }

    this.hitWallVisible.fill(0);
    this.frame.hitWallCells.length = 0;
    for (let index = 0; index < rayCount; index += 1) {
      const angle = this.angleBuffer[index];
      const hit = castGridRay(map, originX, originZ, angle, this._rayOutput);
      this.hitX[index] = hit.x;
      this.hitZ[index] = hit.z;
      this.hitCell[index] = hit.hitCellIndex;
      this.hitCrossings[index] = hit.crossings;
      const ray = this._rayPool[index];
      ray.angle = angle;
      ray.x = hit.x;
      ray.z = hit.z;
      ray.crossings = hit.crossings;
      if (hit.hitCellIndex >= 0) {
        const cx = hit.hitCellIndex % map.width;
        const cz = Math.floor(hit.hitCellIndex / map.width);
        ray._hitCell.cx = cx;
        ray._hitCell.cz = cz;
        ray._hitCell.index = hit.hitCellIndex;
        ray.hitCell = ray._hitCell;
        if (!this.hitWallVisible[hit.hitCellIndex]) {
          this.hitWallVisible[hit.hitCellIndex] = 1;
          const cell = this._cellPool[hit.hitCellIndex];
          cell.cx = cx;
          cell.cz = cz;
          cell.index = hit.hitCellIndex;
          this.frame.hitWallCells.push(cell);
        }
      } else {
        ray.hitCell = null;
      }
      this.frame.rays[index] = ray;
    }
    this.frame.rays.length = rayCount;

    let polygonCount = 0;
    for (let index = 0; index < rayCount; index += 1) {
      const x = this.hitX[index];
      const z = this.hitZ[index];
      if (
        polygonCount > 0
        && Math.hypot(
          x - this.polygonX[polygonCount - 1],
          z - this.polygonZ[polygonCount - 1],
        ) <= POINT_EPSILON_METERS
      ) continue;
      this.polygonX[polygonCount] = x;
      this.polygonZ[polygonCount] = z;
      polygonCount += 1;
    }
    if (
      polygonCount > 1
      && Math.hypot(
        this.polygonX[0] - this.polygonX[polygonCount - 1],
        this.polygonZ[0] - this.polygonZ[polygonCount - 1],
      ) <= POINT_EPSILON_METERS
    ) polygonCount -= 1;
    polygonCount = this.#removeCollinearPoints(polygonCount);

    for (let index = 0; index < polygonCount; index += 1) {
      const point = this._pointPool[index];
      point.x = this.polygonX[index];
      point.z = this.polygonZ[index];
      this.frame.polygon[index] = point;
    }
    this.frame.polygon.length = polygonCount;
    this.frame.rayCount = rayCount;
    this.frame.polygonVertexCount = polygonCount;
    this.frame.fallbackUsed = fallbackUsed;
  }

  /** @param {number} count */
  #removeCollinearPoints(count) {
    if (count < 3) return count;
    let changed = true;
    while (changed && count >= 3) {
      changed = false;
      for (let index = 0; index < count; index += 1) {
        const previous = (index + count - 1) % count;
        const next = (index + 1) % count;
        const ax = this.polygonX[index] - this.polygonX[previous];
        const az = this.polygonZ[index] - this.polygonZ[previous];
        const bx = this.polygonX[next] - this.polygonX[index];
        const bz = this.polygonZ[next] - this.polygonZ[index];
        const cross = ax * bz - az * bx;
        const scale = Math.max(1, Math.hypot(ax, az) + Math.hypot(bx, bz));
        if (Math.abs(cross) > POINT_EPSILON_METERS * scale) continue;
        if (ax * bx + az * bz < 0) continue;
        for (let cursor = index; cursor + 1 < count; cursor += 1) {
          this.polygonX[cursor] = this.polygonX[cursor + 1];
          this.polygonZ[cursor] = this.polygonZ[cursor + 1];
        }
        count -= 1;
        changed = true;
        break;
      }
    }
    return count;
  }

  #rasterizePolygon() {
    const target = this.frame.logicalMask;
    target.fill(0);
    const count = this.frame.polygonVertexCount;
    if (count < 3) return;
    const maskWidth = this.frame.maskWidth;
    const maskHeight = this.frame.maskHeight;
    const mapWidth = this.frame.mapWidth;
    const mapHeight = this.frame.mapHeight;
    for (let pz = 0; pz < maskHeight; pz += 1) {
      const z = ((pz + 0.5) / maskHeight) * mapHeight;
      let intersectionCount = 0;
      for (let index = 0; index < count; index += 1) {
        const next = (index + 1) % count;
        const z1 = this.polygonZ[index];
        const z2 = this.polygonZ[next];
        if (!((z1 <= z && z2 > z) || (z2 <= z && z1 > z))) continue;
        const x1 = this.polygonX[index];
        const x2 = this.polygonX[next];
        this.scanIntersections[intersectionCount] = (
          x1 + ((z - z1) / (z2 - z1)) * (x2 - x1)
        );
        intersectionCount += 1;
      }
      sortNumericPrefix(this.scanIntersections, intersectionCount);
      for (let index = 0; index + 1 < intersectionCount; index += 2) {
        const left = Math.min(
          this.scanIntersections[index],
          this.scanIntersections[index + 1],
        );
        const right = Math.max(
          this.scanIntersections[index],
          this.scanIntersections[index + 1],
        );
        const start = clamp(
          Math.ceil((left / mapWidth) * maskWidth - 0.5),
          0,
          maskWidth - 1,
        );
        const end = clamp(
          Math.floor((right / mapWidth) * maskWidth - 0.5),
          0,
          maskWidth - 1,
        );
        const row = pz * maskWidth;
        for (let px = start; px <= end; px += 1) target[row + px] = 255;
      }
    }
  }

  /** @param {number} x @param {number} z */
  #logicalMaskVisible(x, z) {
    if (
      x < 0
      || z < 0
      || x >= this.frame.mapWidth
      || z >= this.frame.mapHeight
    ) return false;
    const px = Math.min(
      this.frame.maskWidth - 1,
      Math.floor((x / this.frame.mapWidth) * this.frame.maskWidth),
    );
    const pz = Math.min(
      this.frame.maskHeight - 1,
      Math.floor((z / this.frame.mapHeight) * this.frame.maskHeight),
    );
    return this.frame.logicalMask[pz * this.frame.maskWidth + px] > 0;
  }

  #markVisibleWalls() {
    const topology = this.topology;
    if (!topology) return;
    this.wallVisible.fill(0);
    this.frame.visibleWallCells.length = 0;
    const sampleInset = Math.max(
      1e-6,
      0.5 / Math.max(1, this.frame.texelsPerMeter),
    );
    const edgeSampleCount = Math.max(
      1,
      Math.ceil(this.frame.texelsPerMeter),
    );
    for (const edge of topology.exposedEdges) {
      let visible = false;
      for (let sample = 0; sample < edgeSampleCount; sample += 1) {
        const progress = (sample + 0.5) / edgeSampleCount;
        const x = edge.x1 + (edge.x2 - edge.x1) * progress
          + edge.floorNx * sampleInset;
        const z = edge.z1 + (edge.z2 - edge.z1) * progress
          + edge.floorNz * sampleInset;
        if (this.#logicalMaskVisible(x, z)) {
          visible = true;
          break;
        }
      }
      if (!visible || this.wallVisible[edge.wallIndex]) continue;
      this.wallVisible[edge.wallIndex] = 1;
      this.#publishVisibleWall(edge.wallIndex);
      this.#fillCell(edge.wallCx, edge.wallCz, 255);
    }
    this.frame.visibleWallCount = this.frame.visibleWallCells.length;
  }

  /** @param {number} wallIndex */
  #publishVisibleWall(wallIndex) {
    const topology = this.topology;
    if (!topology) return;
    const cell = this._cellPool[wallIndex];
    cell.cx = wallIndex % topology.width;
    cell.cz = Math.floor(wallIndex / topology.width);
    cell.index = wallIndex;
    this.frame.visibleWallCells.push(cell);
  }

  #publishAllWalls() {
    const topology = this.topology;
    if (!topology) return;
    this.frame.visibleWallCells.length = 0;
    for (const wallIndex of topology.wallIndices) this.#publishVisibleWall(wallIndex);
    this.frame.visibleWallCount = this.frame.visibleWallCells.length;
  }

  /** @param {number} cx @param {number} cz @param {number} value */
  #fillCell(cx, cz, value) {
    const startX = clamp(
      Math.ceil(
        (cx / this.frame.mapWidth) * this.frame.maskWidth - 0.5,
      ),
      0,
      this.frame.maskWidth - 1,
    );
    const endX = clamp(
      Math.ceil(
        ((cx + 1) / this.frame.mapWidth) * this.frame.maskWidth - 0.5,
      ) - 1,
      0,
      this.frame.maskWidth - 1,
    );
    const startZ = clamp(
      Math.ceil(
        (cz / this.frame.mapHeight) * this.frame.maskHeight - 0.5,
      ),
      0,
      this.frame.maskHeight - 1,
    );
    const endZ = clamp(
      Math.ceil(
        ((cz + 1) / this.frame.mapHeight) * this.frame.maskHeight - 0.5,
      ) - 1,
      0,
      this.frame.maskHeight - 1,
    );
    for (let pz = startZ; pz <= endZ; pz += 1) {
      const row = pz * this.frame.maskWidth;
      this.frame.logicalMask.fill(value, row + startX, row + endX + 1);
    }
  }

  #snapDisplayMask() {
    this.frame.displayMask.set(this.frame.logicalMask);
    for (let index = 0; index < this.displayLevels.length; index += 1) {
      this.displayLevels[index] = this.frame.logicalMask[index];
    }
  }

  /** @param {number} deltaMs */
  #fadeDisplayMask(deltaMs) {
    const revealStep = (255 * deltaMs) / TRUE_SIGHT_REVEAL_MS;
    const concealStep = (255 * deltaMs) / TRUE_SIGHT_CONCEAL_MS;
    for (let index = 0; index < this.frame.logicalMask.length; index += 1) {
      const target = this.frame.logicalMask[index];
      let level = this.displayLevels[index];
      if (target > level) level = Math.min(target, level + revealStep);
      else if (target < level) level = Math.max(target, level - concealStep);
      this.displayLevels[index] = level;
      this.frame.displayMask[index] = Math.round(level);
    }
  }
}
