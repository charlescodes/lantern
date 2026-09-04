// @ts-check

import {
  cloneAuthoringMap,
  DEFAULT_LAYER_SPACING_METERS,
  DEFAULT_SURFACE_DEFINITION_ID,
  MAX_AUTHORING_LAYERS,
} from "./authoring_map.js";
import { VERTICAL_PHYSICS } from "../config.js";
import { getPlaceableDefinition } from "./definition_catalog.js";
import { normalizeQuarterTurns } from "./footprint.js";

/** @param {ReturnType<typeof cloneAuthoringMap>} document @param {string|undefined} layerId */
function layerFor(document, layerId) {
  const requestedId = layerId ?? document.playerStart?.layerId;
  const layer = document.layers.find((candidate) => candidate.id === requestedId);
  if (!layer) throw new RangeError(`Unknown authoring layer "${requestedId}"`);
  return layer;
}

/** @param {number} ordinal */
function generatedLayerId(ordinal) {
  return `layer-${String(ordinal).padStart(4, "0")}`;
}

/** @param {number} ordinal */
function generatedConnectorId(ordinal) {
  return `elevator-${String(ordinal).padStart(4, "0")}`;
}

/**
 * Creates one blank shared-space layer relative to an existing stable layer ID.
 * @param {unknown} input
 * @param {string} relativeLayerId
 * @param {"above"|"below"} direction
 * @param {{name?:string,baseY?:number}} [options]
 */
export function createLayer(input, relativeLayerId, direction, options = {}) {
  if (direction !== "above" && direction !== "below") {
    throw new RangeError("Layer direction must be above or below");
  }
  const document = cloneAuthoringMap(input);
  if (document.layers.length >= MAX_AUTHORING_LAYERS) {
    throw new RangeError(`Authoring maps support at most ${MAX_AUTHORING_LAYERS} layers`);
  }
  const relativeIndex = document.layers.findIndex((layer) => layer.id === relativeLayerId);
  if (relativeIndex < 0) throw new RangeError(`Unknown authoring layer "${relativeLayerId}"`);
  const relative = document.layers[relativeIndex];
  let ordinal = document.nextLayerOrdinal;
  const usedIds = new Set(document.layers.map((layer) => layer.id));
  let layerId = generatedLayerId(ordinal);
  while (usedIds.has(layerId)) {
    ordinal += 1;
    layerId = generatedLayerId(ordinal);
  }
  const baseY = options.baseY === undefined
    ? relative.baseY + (direction === "above" ? 1 : -1) * DEFAULT_LAYER_SPACING_METERS
    : Number(options.baseY);
  if (!Number.isFinite(baseY)) throw new RangeError("Layer base Y must be finite");
  const name = options.name ?? `Layer ${ordinal}`;
  if (typeof name !== "string" || name.trim().length === 0) {
    throw new RangeError("Layer name must be non-empty");
  }
  const cellCount = relative.width * relative.height;
  const layer = {
    id: layerId,
    name,
    baseY,
    width: relative.width,
    height: relative.height,
    surface: {
      legend: [relative.surface.legend[0] ?? DEFAULT_SURFACE_DEFINITION_ID],
      cells: new Array(cellCount).fill(0),
    },
    structure: { legend: [null], cells: new Array(cellCount).fill(0) },
    instances: [],
    markers: {},
    nextInstanceOrdinal: 1,
  };
  document.nextLayerOrdinal = ordinal + 1;
  const insertionIndex = direction === "above" ? relativeIndex + 1 : relativeIndex;
  document.layers.splice(insertionIndex, 0, layer);
  return { document: cloneAuthoringMap(document), layerId };
}

/** @param {unknown} input @param {string} layerId */
export function deleteLayer(input, layerId) {
  const document = cloneAuthoringMap(input);
  if (document.layers.length <= 1) throw new RangeError("The final authoring layer cannot be deleted");
  if (document.playerStart.layerId === layerId) {
    throw new RangeError("The player-start layer cannot be deleted until the start is reassigned");
  }
  const index = document.layers.findIndex((layer) => layer.id === layerId);
  if (index < 0) throw new RangeError(`Unknown authoring layer "${layerId}"`);
  if (document.connectors.some((connector) => (
    connector.lowerLayerId === layerId || connector.upperLayerId === layerId
  ))) {
    throw new RangeError("A layer linked by an elevator must have that connector deleted first");
  }
  if (document.navigationNodes.some((node) => node.layerId === layerId)) {
    throw new RangeError("A layer with navigation nodes must have those nodes deleted first");
  }
  document.layers.splice(index, 1);
  return cloneAuthoringMap(document);
}

/** @param {unknown} input @param {string} layerId @param {string} name */
export function renameLayer(input, layerId, name) {
  if (typeof name !== "string" || name.trim().length === 0) {
    throw new RangeError("Layer name must be non-empty");
  }
  const document = cloneAuthoringMap(input);
  layerFor(document, layerId).name = name;
  return cloneAuthoringMap(document);
}

/** @param {unknown} input @param {string} layerId @param {number} baseY */
export function setLayerBaseY(input, layerId, baseY) {
  const value = Number(baseY);
  if (!Number.isFinite(value)) throw new RangeError("Layer base Y must be finite");
  const document = cloneAuthoringMap(input);
  layerFor(document, layerId).baseY = value;
  return cloneAuthoringMap(document);
}

/** @param {unknown} input @param {string} layerId */
export function setPlayerStartLayer(input, layerId) {
  const document = cloneAuthoringMap(input);
  layerFor(document, layerId);
  document.playerStart.layerId = layerId;
  return cloneAuthoringMap(document);
}

/**
 * Places one map-level two-stop connector at one shared aligned X/Z point.
 * @param {unknown} input
 * @param {number} x
 * @param {number} z
 * @param {{lowerLayerId:string,upperLayerId:string,platformWidth?:number,apertureWidth?:number,travelDurationSeconds?:number,dwellSeconds?:number,initialStop?:"lower"|"upper"}} options
 */
export function placeElevatorConnector(input, x, z, options) {
  const document = cloneAuthoringMap(input);
  const lower = layerFor(document, options.lowerLayerId);
  const upper = layerFor(document, options.upperLayerId);
  if (!(lower.baseY < upper.baseY)) {
    throw new RangeError("Elevator lower layer must be below its upper layer");
  }
  let ordinal = document.nextConnectorOrdinal;
  const usedIds = new Set(document.connectors.map((connector) => connector.id));
  let connectorId = generatedConnectorId(ordinal);
  while (usedIds.has(connectorId)) {
    ordinal += 1;
    connectorId = generatedConnectorId(ordinal);
  }
  const connector = {
    id: connectorId,
    definitionId: "connector.elevator.two-stop",
    lowerLayerId: lower.id,
    upperLayerId: upper.id,
    x: Math.floor(Number(x)) + 0.5,
    z: Math.floor(Number(z)) + 0.5,
    platformWidth: Number(
      options.platformWidth ?? VERTICAL_PHYSICS.defaultPlatformWidthMeters,
    ),
    apertureWidth: Number(
      options.apertureWidth ?? VERTICAL_PHYSICS.defaultApertureWidthMeters,
    ),
    travelDurationSeconds: Number(
      options.travelDurationSeconds ?? VERTICAL_PHYSICS.defaultTravelDurationSeconds,
    ),
    dwellSeconds: Number(options.dwellSeconds ?? VERTICAL_PHYSICS.defaultDwellSeconds),
    initialStop: options.initialStop ?? "lower",
  };
  document.connectors.push(connector);
  document.nextConnectorOrdinal = ordinal + 1;
  return { document: cloneAuthoringMap(document), connectorId };
}

/** @param {unknown} input @param {string} connectorId */
export function removeConnector(input, connectorId) {
  const document = cloneAuthoringMap(input);
  const index = document.connectors.findIndex((connector) => connector.id === connectorId);
  if (index < 0) throw new RangeError(`Unknown authoring connector "${connectorId}"`);
  document.connectors.splice(index, 1);
  document.navigationLinks = document.navigationLinks.filter((link) => (
    ![link.a, link.b].some((endpoint) => (
      endpoint.kind === "connector-endpoint" && endpoint.connectorId === connectorId
    ))
  ));
  return cloneAuthoringMap(document);
}

/** @param {unknown} input @param {string} connectorId @param {Record<string,unknown>} changes */
export function updateConnector(input, connectorId, changes) {
  const document = cloneAuthoringMap(input);
  const connector = document.connectors.find((candidate) => candidate.id === connectorId);
  if (!connector) throw new RangeError(`Unknown authoring connector "${connectorId}"`);
  for (const field of [
    "lowerLayerId",
    "upperLayerId",
    "x",
    "z",
    "platformWidth",
    "apertureWidth",
    "travelDurationSeconds",
    "dwellSeconds",
    "initialStop",
  ]) {
    if (changes[field] !== undefined) connector[field] = changes[field];
  }
  if (changes.x !== undefined || changes.z !== undefined) {
    connector.x = Math.floor(Number(changes.x ?? connector.x)) + 0.5;
    connector.z = Math.floor(Number(changes.z ?? connector.z)) + 0.5;
  }
  return cloneAuthoringMap(document);
}

/** @param {number} ordinal */
function generatedNavigationNodeId(ordinal) {
  return `navigation-node-${String(ordinal).padStart(4, "0")}`;
}

/** @param {number} ordinal */
function generatedNavigationLinkId(ordinal) {
  return `navigation-link-${String(ordinal).padStart(4, "0")}`;
}

/** @param {Record<string,any>} endpoint */
function navigationEndpointKey(endpoint) {
  return endpoint.kind === "node"
    ? `node:${String(endpoint.nodeId)}`
    : `connector:${String(endpoint.connectorId)}:${String(endpoint.stop)}`;
}

/** @param {unknown} input @param {number} cx @param {number} cz @param {{layerId?:string,patrol?:boolean}} [options] */
export function placeNavigationNode(input, cx, cz, options = {}) {
  const document = cloneAuthoringMap(input);
  const layer = layerFor(document, options.layerId);
  const cellX = Number(cx);
  const cellZ = Number(cz);
  cellIndex(layer, cellX, cellZ);
  let ordinal = document.nextNavigationNodeOrdinal;
  const usedIds = new Set(document.navigationNodes.map((node) => node.id));
  let nodeId = generatedNavigationNodeId(ordinal);
  while (usedIds.has(nodeId)) {
    ordinal += 1;
    nodeId = generatedNavigationNodeId(ordinal);
  }
  document.nextNavigationNodeOrdinal = ordinal + 1;
  document.navigationNodes.push({
    id: nodeId,
    layerId: layer.id,
    cx: cellX,
    cz: cellZ,
    patrol: options.patrol === true,
  });
  return { document: cloneAuthoringMap(document), nodeId };
}

/** @param {unknown} input @param {string} nodeId @param {{cx?:number,cz?:number,patrol?:boolean}} changes */
export function updateNavigationNode(input, nodeId, changes) {
  const document = cloneAuthoringMap(input);
  const node = document.navigationNodes.find((candidate) => candidate.id === nodeId);
  if (!node) throw new RangeError(`Unknown navigation node "${nodeId}"`);
  const layer = layerFor(document, node.layerId);
  const cx = changes.cx === undefined ? node.cx : Number(changes.cx);
  const cz = changes.cz === undefined ? node.cz : Number(changes.cz);
  cellIndex(layer, cx, cz);
  node.cx = cx;
  node.cz = cz;
  if (changes.patrol !== undefined) node.patrol = changes.patrol === true;
  return cloneAuthoringMap(document);
}

/** @param {unknown} input @param {string} nodeId @param {number} cx @param {number} cz */
export function moveNavigationNode(input, nodeId, cx, cz) {
  return updateNavigationNode(input, nodeId, { cx, cz });
}

/** @param {unknown} input @param {string} nodeId */
export function removeNavigationNode(input, nodeId) {
  const document = cloneAuthoringMap(input);
  const index = document.navigationNodes.findIndex((node) => node.id === nodeId);
  if (index < 0) throw new RangeError(`Unknown navigation node "${nodeId}"`);
  document.navigationNodes.splice(index, 1);
  document.navigationLinks = document.navigationLinks.filter((link) => (
    ![link.a, link.b].some((endpoint) => endpoint.kind === "node" && endpoint.nodeId === nodeId)
  ));
  return cloneAuthoringMap(document);
}

/**
 * @param {unknown} input
 * @param {{kind:"node",nodeId:string}|{kind:"connector-endpoint",connectorId:string,stop:"lower"|"upper"}} aInput
 * @param {{kind:"node",nodeId:string}|{kind:"connector-endpoint",connectorId:string,stop:"lower"|"upper"}} bInput
 */
export function placeNavigationLink(input, aInput, bInput) {
  const document = cloneAuthoringMap(input);
  const a = JSON.parse(JSON.stringify(aInput));
  const b = JSON.parse(JSON.stringify(bInput));
  const [first, second] = navigationEndpointKey(a) <= navigationEndpointKey(b) ? [a, b] : [b, a];
  let ordinal = document.nextNavigationLinkOrdinal;
  const usedIds = new Set(document.navigationLinks.map((link) => link.id));
  let linkId = generatedNavigationLinkId(ordinal);
  while (usedIds.has(linkId)) {
    ordinal += 1;
    linkId = generatedNavigationLinkId(ordinal);
  }
  document.nextNavigationLinkOrdinal = ordinal + 1;
  document.navigationLinks.push({ id: linkId, a: first, b: second });
  return { document: cloneAuthoringMap(document), linkId };
}

/** @param {unknown} input @param {string} linkId */
export function removeNavigationLink(input, linkId) {
  const document = cloneAuthoringMap(input);
  const index = document.navigationLinks.findIndex((link) => link.id === linkId);
  if (index < 0) throw new RangeError(`Unknown navigation link "${linkId}"`);
  document.navigationLinks.splice(index, 1);
  return cloneAuthoringMap(document);
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

/** @param {string} definitionId @param {"surface"|"structure"|"instance"|"connector"} target */
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
  const definition = getPlaceableDefinition(definitionId);
  if (!definition) throw new RangeError(`Unknown placeable definition "${definitionId}"`);
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
