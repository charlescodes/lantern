// @ts-check

import { cloneAuthoringMap } from "./authoring_map.js";
import { getPlaceableDefinition } from "./definition_catalog.js";
import { normalizeQuarterTurns } from "./footprint.js";

/** @param {ReturnType<typeof cloneAuthoringMap>} document @param {string|undefined} layerId */
function layerFor(document, layerId) {
  const requestedId = layerId ?? document.activeLayerId;
  const layer = document.layers.find((candidate) => candidate.id === requestedId);
  if (!layer) throw new RangeError(`Unknown authoring layer "${requestedId}"`);
  return layer;
}

/** @param {Record<string, any>} layer @param {number} cx @param {number} cz */
function cellIndex(layer, cx, cz) {
  if (!Number.isInteger(cx) || !Number.isInteger(cz)) {
    throw new RangeError("Authoring cell coordinates must be integers");
  }
  if (cx < 0 || cz < 0 || cx >= layer.width || cz >= layer.height) {
    throw new RangeError(`Authoring cell (${cx}, ${cz}) is outside layer "${layer.id}"`);
  }
  return cz * layer.width + cx;
}

/** @param {string} definitionId @param {"surface"|"structure"|"instance"} target */
function definitionFor(definitionId, target) {
  const definition = getPlaceableDefinition(definitionId);
  if (!definition) throw new RangeError(`Unknown placeable definition "${definitionId}"`);
  if (definition.placementTarget !== target) {
    throw new RangeError(`Definition "${definitionId}" cannot be used as a ${target}`);
  }
  return definition;
}

/** @param {Array<string|null>} legend @param {string} definitionId */
function legendIndex(legend, definitionId) {
  const existing = legend.indexOf(definitionId);
  if (existing >= 0) return existing;
  legend.push(definitionId);
  return legend.length - 1;
}

/**
 * @param {unknown} input
 * @param {Array<{cx:number,cz:number}>} cells
 * @param {"surface"|"structure"} target
 * @param {string|null} definitionId
 * @param {string} [layerId]
 */
function mutateCells(input, cells, target, definitionId, layerId) {
  if (!Array.isArray(cells) || cells.length === 0) return cloneAuthoringMap(input);
  if (definitionId !== null) definitionFor(definitionId, target);
  const document = cloneAuthoringMap(input);
  const layer = layerFor(document, layerId);
  const code = definitionId === null ? 0 : legendIndex(layer[target].legend, definitionId);
  const visited = new Set();
  for (const cell of cells) {
    const index = cellIndex(layer, Number(cell.cx), Number(cell.cz));
    if (visited.has(index)) continue;
    visited.add(index);
    layer[target].cells[index] = code;
  }
  return document;
}

/**
 * Atomically paints a surface stroke in one cloned authoring document.
 * @param {unknown} input
 * @param {Array<{cx:number,cz:number}>} cells
 * @param {string} definitionId
 * @param {string} [layerId]
 */
export function paintSurfaceCells(input, cells, definitionId, layerId) {
  return mutateCells(input, cells, "surface", definitionId, layerId);
}

/**
 * Atomically paints a structure stroke in one cloned authoring document.
 * @param {unknown} input
 * @param {Array<{cx:number,cz:number}>} cells
 * @param {string} definitionId
 * @param {string} [layerId]
 */
export function paintStructureCells(input, cells, definitionId, layerId) {
  return mutateCells(input, cells, "structure", definitionId, layerId);
}

/** @param {unknown} input @param {Array<{cx:number,cz:number}>} cells @param {string} [layerId] */
export function eraseSurfaceCells(input, cells, layerId) {
  return mutateCells(input, cells, "surface", null, layerId);
}

/** @param {unknown} input @param {Array<{cx:number,cz:number}>} cells @param {string} [layerId] */
export function eraseStructureCells(input, cells, layerId) {
  return mutateCells(input, cells, "structure", null, layerId);
}

/**
 * @param {unknown} input
 * @param {number} cx
 * @param {number} cz
 * @param {string} definitionId
 * @param {string} [layerId]
 */
export function paintSurface(input, cx, cz, definitionId, layerId) {
  return paintSurfaceCells(input, [{ cx, cz }], definitionId, layerId);
}

/**
 * @param {unknown} input
 * @param {number} cx
 * @param {number} cz
 * @param {string} definitionId
 * @param {string} [layerId]
 */
export function paintStructure(input, cx, cz, definitionId, layerId) {
  return paintStructureCells(input, [{ cx, cz }], definitionId, layerId);
}

/**
 * Resets a surface cell to the active layer's documented default (legend code 0).
 * @param {unknown} input
 * @param {number} cx
 * @param {number} cz
 * @param {string} [layerId]
 */
export function eraseSurface(input, cx, cz, layerId) {
  return eraseSurfaceCells(input, [{ cx, cz }], layerId);
}

/**
 * @param {unknown} input
 * @param {number} cx
 * @param {number} cz
 * @param {string} [layerId]
 */
export function eraseStructure(input, cx, cz, layerId) {
  return eraseStructureCells(input, [{ cx, cz }], layerId);
}

/** @param {string} definitionId @param {number} ordinal */
function generatedInstanceId(definitionId, ordinal) {
  const slug = definitionId.split(".").slice(-2).join("-").replace(/[^a-z0-9-]/gi, "-");
  return `${slug}-${String(ordinal).padStart(4, "0")}`;
}

/**
 * Catalog-driven placement snapping used by the editor and probe adapters.
 * @param {string} definitionId
 * @param {number} x
 * @param {number} z
 */
export function snapDefinitionPlacement(definitionId, x, z) {
  const definition = definitionFor(definitionId, "instance");
  const numericX = Number(x);
  const numericZ = Number(z);
  if (!Number.isFinite(numericX) || !Number.isFinite(numericZ)) {
    throw new RangeError("Instance x and z must be finite numbers");
  }
  if (definition.traits.snap === "cell-center") {
    return { x: Math.floor(numericX) + 0.5, z: Math.floor(numericZ) + 0.5 };
  }
  if (definition.traits.snap === "tenth") {
    return { x: Math.round(numericX * 10) / 10, z: Math.round(numericZ * 10) / 10 };
  }
  return { x: numericX, z: numericZ };
}

/**
 * @param {unknown} input
 * @param {string} definitionId
 * @param {number} x
 * @param {number} z
 * @param {{rotation?:number,properties?:Record<string,unknown>,layerId?:string}} [options]
 */
export function placeInstance(input, definitionId, x, z, options = {}) {
  definitionFor(definitionId, "instance");
  const document = cloneAuthoringMap(input);
  const layer = layerFor(document, options.layerId);
  let ordinal = layer.nextInstanceOrdinal;
  let instanceId = generatedInstanceId(definitionId, ordinal);
  const usedIds = new Set(document.layers.flatMap((candidate) => candidate.instances.map((instance) => instance.id)));
  while (usedIds.has(instanceId)) {
    ordinal += 1;
    instanceId = generatedInstanceId(definitionId, ordinal);
  }
  layer.nextInstanceOrdinal = ordinal + 1;
  layer.instances.push({
    id: instanceId,
    definitionId,
    x: Number(x),
    z: Number(z),
    rotation: normalizeQuarterTurns(options.rotation ?? 0),
    ...(options.properties === undefined ? {} : { properties: options.properties }),
  });
  return { document: cloneAuthoringMap(document), instanceId };
}

/**
 * Updates common sparse-instance transform fields as one semantic mutation.
 * Stable authoring identity, definition, placement order, and properties remain
 * unchanged.
 * @param {unknown} input
 * @param {string} instanceId
 * @param {{x?:number,z?:number,rotation?:number}} transform
 * @param {string} [layerId]
 */
export function updateInstanceTransform(input, instanceId, transform, layerId) {
  const document = cloneAuthoringMap(input);
  const layer = layerFor(document, layerId);
  const instance = layer.instances.find((candidate) => candidate.id === instanceId);
  if (!instance) throw new RangeError(`Unknown authoring instance "${instanceId}"`);
  if (transform.x !== undefined) instance.x = Number(transform.x);
  if (transform.z !== undefined) instance.z = Number(transform.z);
  if (transform.rotation !== undefined) {
    instance.rotation = normalizeQuarterTurns(transform.rotation);
  }
  return cloneAuthoringMap(document);
}

/**
 * Replaces the JSON-serializable, definition-specific property bag while
 * preserving stable identity, transform, and placement order.
 * @param {unknown} input
 * @param {string} instanceId
 * @param {Record<string,unknown>|undefined} properties
 * @param {string} [layerId]
 */
export function updateInstanceProperties(input, instanceId, properties, layerId) {
  const document = cloneAuthoringMap(input);
  const layer = layerFor(document, layerId);
  const instance = layer.instances.find((candidate) => candidate.id === instanceId);
  if (!instance) throw new RangeError(`Unknown authoring instance "${instanceId}"`);
  if (properties === undefined) {
    delete instance.properties;
  } else {
    instance.properties = properties;
  }
  return cloneAuthoringMap(document);
}

/** @param {unknown} input @param {string} instanceId @param {number} x @param {number} z @param {string} [layerId] */
export function moveInstance(input, instanceId, x, z, layerId) {
  return updateInstanceTransform(input, instanceId, { x, z }, layerId);
}

/** @param {unknown} input @param {string} instanceId @param {number} rotation @param {string} [layerId] */
export function rotateInstance(input, instanceId, rotation, layerId) {
  return updateInstanceTransform(input, instanceId, { rotation }, layerId);
}

/**
 * @param {unknown} input
 * @param {string} instanceId
 * @param {string} [layerId]
 */
export function removeInstance(input, instanceId, layerId) {
  const document = cloneAuthoringMap(input);
  const layer = layerFor(document, layerId);
  const index = layer.instances.findIndex((instance) => instance.id === instanceId);
  if (index < 0) throw new RangeError(`Unknown authoring instance "${instanceId}"`);
  layer.instances.splice(index, 1);
  return document;
}
