// @ts-check

import { isDynamicCircleDefinition } from "./definition_catalog.js";

/** @param {unknown} value */
export function normalizeQuarterTurns(value) {
  const turns = Number(value);
  if (!Number.isInteger(turns)) {
    throw new RangeError("Rotation must be an integer number of quarter turns");
  }
  return ((turns % 4) + 4) % 4;
}

/** @param {number} x @param {number} z @param {number} rotation */
export function rotateFootprintOffset(x, z, rotation) {
  const turns = normalizeQuarterTurns(rotation);
  if (turns === 1) return { x: -z, z: x };
  if (turns === 2) return { x: -x, z: -z };
  if (turns === 3) return { x: z, z: -x };
  return { x, z };
}

/**
 * Sparse-instance X/Z is the center of its anchor cell. Footprint offsets are
 * integer cells rotated around that anchor, which remains fixed for all four
 * quarter turns.
 *
 * @param {Record<string, any>} definition
 * @param {{x:number,z:number,rotation?:number}} transform
 */
export function getOccupiedCells(definition, transform) {
  if (!definition?.footprint || !Array.isArray(definition.footprint.cells)) {
    throw new TypeError("Definition must provide footprint cells");
  }
  const x = Number(transform.x);
  const z = Number(transform.z);
  if (!Number.isFinite(x) || !Number.isFinite(z)) {
    throw new RangeError("Instance X/Z must be finite numbers");
  }
  const rotation = normalizeQuarterTurns(transform.rotation ?? 0);
  const anchorX = Math.floor(x);
  const anchorZ = Math.floor(z);
  return definition.footprint.cells.map((offset) => {
    const rotated = rotateFootprintOffset(Number(offset.x), Number(offset.z), rotation);
    return { cx: anchorX + rotated.x, cz: anchorZ + rotated.z };
  });
}

/** @param {Array<{cx:number,cz:number}>} cells */
export function getFootprintBounds(cells) {
  if (cells.length === 0) return null;
  let minimumX = cells[0].cx;
  let maximumX = cells[0].cx;
  let minimumZ = cells[0].cz;
  let maximumZ = cells[0].cz;
  for (let index = 1; index < cells.length; index += 1) {
    minimumX = Math.min(minimumX, cells[index].cx);
    maximumX = Math.max(maximumX, cells[index].cx);
    minimumZ = Math.min(minimumZ, cells[index].cz);
    maximumZ = Math.max(maximumZ, cells[index].cz);
  }
  return {
    minimumX,
    maximumX,
    minimumZ,
    maximumZ,
    width: maximumX - minimumX + 1,
    height: maximumZ - minimumZ + 1,
    centerX: (minimumX + maximumX + 1) / 2,
    centerZ: (minimumZ + maximumZ + 1) / 2,
  };
}

/**
 * Runtime bodies normally use the authored X/Z anchor directly. Definitions
 * with a multi-cell fixed body can instead opt into the center of their
 * rotated footprint. This keeps the authoring anchor stable while matching the
 * physical and rendered box to the exact occupied-cell preview.
 *
 * @param {Record<string, any>} definition
 * @param {{x:number,z:number,rotation?:number}} transform
 */
export function getRuntimeBodyTransform(definition, transform) {
  const rotation = normalizeQuarterTurns(transform.rotation ?? 0);
  if (definition?.traits?.runtimeAnchor !== "footprint-center") {
    return { x: Number(transform.x), z: Number(transform.z), rotation };
  }
  const bounds = getFootprintBounds(getOccupiedCells(definition, transform));
  if (!bounds) {
    throw new RangeError(`Definition "${definition?.id ?? "unknown"}" has an empty footprint`);
  }
  return { x: bounds.centerX, z: bounds.centerZ, rotation };
}

/** @param {{cx:number,cz:number}} cell */
export function footprintCellKey(cell) {
  return `${cell.cx}:${cell.cz}`;
}

/**
 * @param {Record<string, any>} definition
 * @param {{x:number,z:number,rotation?:number}} transform
 * @param {number} worldX
 * @param {number} worldZ
 */
export function pointHitsInstanceExtent(definition, transform, worldX, worldZ) {
  if (!Number.isFinite(worldX) || !Number.isFinite(worldZ)) return false;
  if (isDynamicCircleDefinition(definition)) {
    const radius = Number(definition.traits.radius);
    return Number.isFinite(radius)
      && Math.hypot(worldX - transform.x, worldZ - transform.z) <= radius;
  }
  const cx = Math.floor(worldX);
  const cz = Math.floor(worldZ);
  return getOccupiedCells(definition, transform).some(
    (cell) => cell.cx === cx && cell.cz === cz,
  );
}
