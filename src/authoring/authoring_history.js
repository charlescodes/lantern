// @ts-check

import {
  createLayer,
  deleteLayer,
  eraseSurface,
  eraseSurfaceCells,
  eraseStructure,
  eraseStructureCells,
  paintStructure,
  paintStructureCells,
  paintSurface,
  paintSurfaceCells,
  placeElevatorConnector,
  placeInstance,
  renameLayer,
  removeConnector,
  removeInstance,
  setLayerBaseY,
  setPlayerStartLayer,
  updateInstanceProperties,
  updateInstanceTransform,
  updateConnector,
} from "./authoring_commands.js";
import { validateAuthoringMap } from "./authoring_map.js";
import {
  getPlaceableDefinition,
  rockDefinitionId,
} from "./definition_catalog.js";
import { compileAuthoringMap } from "./map_compiler.js";

export const DEFAULT_AUTHORING_HISTORY_CAPACITY = 256;

/** @param {unknown} value */
function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

/** @param {unknown} left @param {unknown} right */
function jsonEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** @param {Record<string,any>} document @param {string} layerId */
function layerFor(document, layerId) {
  const layer = document.layers.find((candidate) => candidate.id === layerId);
  if (!layer) throw new RangeError(`Unknown authoring layer "${layerId}"`);
  return layer;
}

/**
 * History patches intentionally store stable catalog IDs rather than compact
 * grid codes. Legend patches preserve byte-for-byte authoring source when a
 * stroke introduces a definition that was not previously present.
 * @param {Record<string,any>} layer
 * @param {"surface"|"structure"} channel
 * @param {number} index
 */
function definitionAt(layer, channel, index) {
  const code = layer[channel].cells[index];
  return layer[channel].legend[code] ?? null;
}

/** @param {Record<string,any>} instance */
function cloneInstance(instance) {
  return /** @type {Record<string,any>} */ (cloneJson(instance));
}

/** @param {unknown} input @param {string} path */
function finiteInteger(input, path) {
  const value = Number(input);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${path} must be a non-negative integer`);
  }
  return value;
}

/** @param {unknown} input @param {string} path */
function finiteNumber(input, path) {
  if (typeof input !== "number" || !Number.isFinite(input)) {
    throw new TypeError(`${path} must be a finite number`);
  }
  return input;
}

/** @param {unknown} input @param {string} path */
function nonEmptyString(input, path) {
  if (typeof input !== "string" || input.trim().length === 0) {
    throw new TypeError(`${path} must be a non-empty string`);
  }
  if (input.length > 128) throw new RangeError(`${path} must be at most 128 characters`);
  return input;
}

/** @param {unknown} input @param {string} instanceId @param {string} path */
function instanceSnapshot(input, instanceId, path) {
  if (input === null) return null;
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError(`${path} must be an instance snapshot or null`);
  }
  const snapshot = /** @type {Record<string,any>} */ (cloneJson(input));
  if (snapshot.id !== instanceId) {
    throw new TypeError(`${path}.id must equal patch instanceId "${instanceId}"`);
  }
  nonEmptyString(snapshot.definitionId, `${path}.definitionId`);
  if (!Number.isFinite(snapshot.x) || !Number.isFinite(snapshot.z)) {
    throw new TypeError(`${path} X/Z must be finite`);
  }
  if (!Number.isInteger(snapshot.rotation) || snapshot.rotation < 0 || snapshot.rotation > 3) {
    throw new TypeError(`${path}.rotation must be a quarter turn from 0 to 3`);
  }
  return snapshot;
}

/** @param {unknown} input @param {string} layerId @param {string} path */
function layerSnapshot(input, layerId, path) {
  if (input === null) return null;
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError(`${path} must be a layer snapshot or null`);
  }
  const snapshot = /** @type {Record<string,any>} */ (cloneJson(input));
  if (snapshot.id !== layerId) {
    throw new TypeError(`${path}.id must equal patch layerId "${layerId}"`);
  }
  return snapshot;
}

/** @param {unknown} input @param {string} connectorId @param {string} path */
function connectorSnapshot(input, connectorId, path) {
  if (input === null) return null;
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError(`${path} must be a connector snapshot or null`);
  }
  const snapshot = /** @type {Record<string,any>} */ (cloneJson(input));
  if (snapshot.id !== connectorId) {
    throw new TypeError(`${path}.id must equal patch connectorId "${connectorId}"`);
  }
  nonEmptyString(snapshot.definitionId, `${path}.definitionId`);
  return snapshot;
}

/** @param {unknown} input @param {string} path */
function playerStartSnapshot(input, path) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError(`${path} must be a player-start snapshot`);
  }
  const source = /** @type {Record<string,any>} */ (input);
  return {
    layerId: nonEmptyString(source.layerId, `${path}.layerId`),
    x: finiteNumber(source.x, `${path}.x`),
    z: finiteNumber(source.z, `${path}.z`),
  };
}

/**
 * Validates and detaches a command record. This is also the command-log
 * canonicalization boundary: functions, DOM objects, and runtime references
 * cannot survive the JSON clone and shape checks.
 * @param {unknown} input
 */
export function cloneAuthoringCommand(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("Authoring command must be an object");
  }
  const source = /** @type {Record<string,any>} */ (input);
  const id = finiteInteger(source.id ?? 0, "command.id");
  const label = nonEmptyString(source.label, "command.label");
  if (!Array.isArray(source.patches)) throw new TypeError("command.patches must be an array");
  if (source.patches.length > 262_144) throw new RangeError("Authoring command has too many patches");
  const targets = new Set();
  const patches = source.patches.map((value, patchIndex) => {
    const path = `command.patches[${patchIndex}]`;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new TypeError(`${path} must be an object`);
    }
    const patch = /** @type {Record<string,any>} */ (value);
    const kind = String(patch.kind);
    let normalized;
    let key;
    if (kind === "map") {
      const field = String(patch.field);
      if (field === "nextLayerOrdinal" || field === "nextConnectorOrdinal") {
        const before = finiteInteger(patch.before, `${path}.before`);
        const after = finiteInteger(patch.after, `${path}.after`);
        if (before < 1 || after < 1) throw new TypeError(`${path} ordinals must be positive integers`);
        normalized = { kind, field, before, after };
      } else if (field === "playerStart") {
        normalized = {
          kind,
          field,
          before: playerStartSnapshot(patch.before, `${path}.before`),
          after: playerStartSnapshot(patch.after, `${path}.after`),
        };
      } else {
        throw new TypeError(`${path}.field must be an ordinal or playerStart`);
      }
      key = `${kind}:${field}`;
    } else if (kind === "layer-record") {
      const layerId = nonEmptyString(patch.layerId, `${path}.layerId`);
      const before = layerSnapshot(patch.before, layerId, `${path}.before`);
      const after = layerSnapshot(patch.after, layerId, `${path}.after`);
      const beforeIndex = patch.beforeIndex === null
        ? null
        : finiteInteger(patch.beforeIndex, `${path}.beforeIndex`);
      const afterIndex = patch.afterIndex === null
        ? null
        : finiteInteger(patch.afterIndex, `${path}.afterIndex`);
      if ((before === null) !== (beforeIndex === null) || (after === null) !== (afterIndex === null)) {
        throw new TypeError(`${path} snapshot and ordering index must both be null or both be present`);
      }
      normalized = { kind, layerId, before, after, beforeIndex, afterIndex };
      key = `${kind}:${layerId}`;
    } else if (kind === "connector") {
      const connectorId = nonEmptyString(patch.connectorId, `${path}.connectorId`);
      const before = connectorSnapshot(patch.before, connectorId, `${path}.before`);
      const after = connectorSnapshot(patch.after, connectorId, `${path}.after`);
      const beforeIndex = patch.beforeIndex === null
        ? null
        : finiteInteger(patch.beforeIndex, `${path}.beforeIndex`);
      const afterIndex = patch.afterIndex === null
        ? null
        : finiteInteger(patch.afterIndex, `${path}.afterIndex`);
      if ((before === null) !== (beforeIndex === null) || (after === null) !== (afterIndex === null)) {
        throw new TypeError(`${path} snapshot and ordering index must both be null or both be present`);
      }
      normalized = { kind, connectorId, before, after, beforeIndex, afterIndex };
      key = `${kind}:${connectorId}`;
    } else if (kind === "cell") {
      const layerId = nonEmptyString(patch.layerId, `${path}.layerId`);
      const channel = patch.channel;
      if (channel !== "surface" && channel !== "structure") {
        throw new TypeError(`${path}.channel must be surface or structure`);
      }
      const cellIndex = finiteInteger(patch.cellIndex, `${path}.cellIndex`);
      const normalizeDefinition = (definitionId, side) => {
        if (definitionId === null) return null;
        return nonEmptyString(definitionId, `${path}.${side}`);
      };
      normalized = {
        kind,
        layerId,
        channel,
        cellIndex,
        before: normalizeDefinition(patch.before, "before"),
        after: normalizeDefinition(patch.after, "after"),
      };
      key = `${kind}:${layerId}:${channel}:${cellIndex}`;
    } else if (kind === "legend") {
      const layerId = nonEmptyString(patch.layerId, `${path}.layerId`);
      const channel = patch.channel;
      if (channel !== "surface" && channel !== "structure") {
        throw new TypeError(`${path}.channel must be surface or structure`);
      }
      if (!Array.isArray(patch.before) || !Array.isArray(patch.after)) {
        throw new TypeError(`${path} legend snapshots must be arrays`);
      }
      normalized = {
        kind,
        layerId,
        channel,
        before: /** @type {Array<string|null>} */ (cloneJson(patch.before)),
        after: /** @type {Array<string|null>} */ (cloneJson(patch.after)),
      };
      key = `${kind}:${layerId}:${channel}`;
    } else if (kind === "instance") {
      const layerId = nonEmptyString(patch.layerId, `${path}.layerId`);
      const instanceId = nonEmptyString(patch.instanceId, `${path}.instanceId`);
      const before = instanceSnapshot(patch.before, instanceId, `${path}.before`);
      const after = instanceSnapshot(patch.after, instanceId, `${path}.after`);
      const beforeIndex = patch.beforeIndex === null
        ? null
        : finiteInteger(patch.beforeIndex, `${path}.beforeIndex`);
      const afterIndex = patch.afterIndex === null
        ? null
        : finiteInteger(patch.afterIndex, `${path}.afterIndex`);
      if ((before === null) !== (beforeIndex === null) || (after === null) !== (afterIndex === null)) {
        throw new TypeError(`${path} snapshot and ordering index must both be null or both be present`);
      }
      normalized = {
        kind,
        layerId,
        instanceId,
        before,
        after,
        beforeIndex,
        afterIndex,
      };
      key = `${kind}:${layerId}:${instanceId}`;
    } else if (kind === "layer") {
      const layerId = nonEmptyString(patch.layerId, `${path}.layerId`);
      const field = String(patch.field);
      if (field === "nextInstanceOrdinal") {
        const before = finiteInteger(patch.before, `${path}.before`);
        const after = finiteInteger(patch.after, `${path}.after`);
        if (before < 1 || after < 1) throw new TypeError(`${path} ordinals must be positive integers`);
        normalized = { kind, layerId, field, before, after };
      } else if (field === "name") {
        normalized = {
          kind,
          layerId,
          field,
          before: nonEmptyString(patch.before, `${path}.before`),
          after: nonEmptyString(patch.after, `${path}.after`),
        };
      } else if (field === "baseY") {
        normalized = {
          kind,
          layerId,
          field,
          before: finiteNumber(patch.before, `${path}.before`),
          after: finiteNumber(patch.after, `${path}.after`),
        };
      } else {
        throw new TypeError(`${path}.field must be name, baseY, or nextInstanceOrdinal`);
      }
      key = `${kind}:${layerId}:${normalized.field}`;
    } else {
      throw new TypeError(`${path}.kind is unsupported: ${kind}`);
    }
    if (targets.has(key)) throw new TypeError(`Authoring command repeats patch target ${key}`);
    targets.add(key);
    return normalized;
  });
  return { id, label, patches };
}

/**
 * Produces a compact exact delta between two compatible authoring documents.
 * Map replacement is deliberately not represented as a history command.
 * @param {unknown} beforeInput
 * @param {unknown} afterInput
 * @param {string} label
 * @param {{id?:number}} [options]
 */
export function createAuthoringCommand(beforeInput, afterInput, label, options = {}) {
  const before = validateAuthoringMap(beforeInput);
  const after = validateAuthoringMap(afterInput);
  const beforeEnvelope = {
    format: before.format,
    version: before.version,
    metadata: before.metadata,
  };
  const afterEnvelope = {
    format: after.format,
    version: after.version,
    metadata: after.metadata,
  };
  if (!jsonEqual(beforeEnvelope, afterEnvelope)) {
    throw new RangeError("Authoring history cannot replace map format or metadata");
  }
  const patches = [];
  if (before.nextLayerOrdinal !== after.nextLayerOrdinal) {
    patches.push({
      kind: "map",
      field: "nextLayerOrdinal",
      before: before.nextLayerOrdinal,
      after: after.nextLayerOrdinal,
    });
  }
  if (before.nextConnectorOrdinal !== after.nextConnectorOrdinal) {
    patches.push({
      kind: "map",
      field: "nextConnectorOrdinal",
      before: before.nextConnectorOrdinal,
      after: after.nextConnectorOrdinal,
    });
  }
  if (!jsonEqual(before.playerStart, after.playerStart)) {
    patches.push({
      kind: "map",
      field: "playerStart",
      before: { ...before.playerStart },
      after: { ...after.playerStart },
    });
  }

  const beforeLayers = new Map(
    before.layers.map((layer, index) => [layer.id, { layer, index }]),
  );
  const afterLayers = new Map(
    after.layers.map((layer, index) => [layer.id, { layer, index }]),
  );
  const commonBefore = before.layers.filter((layer) => afterLayers.has(layer.id)).map((layer) => layer.id);
  const commonAfter = after.layers.filter((layer) => beforeLayers.has(layer.id)).map((layer) => layer.id);
  if (!jsonEqual(commonBefore, commonAfter)) {
    throw new RangeError("Authoring history does not support layer reordering in this slice");
  }
  const layerIds = [...new Set([...beforeLayers.keys(), ...afterLayers.keys()])].sort();
  for (const layerId of layerIds) {
    const beforeEntry = beforeLayers.get(layerId) ?? null;
    const afterEntry = afterLayers.get(layerId) ?? null;
    if (!beforeEntry || !afterEntry) {
      patches.push({
        kind: "layer-record",
        layerId,
        before: beforeEntry ? cloneJson(beforeEntry.layer) : null,
        after: afterEntry ? cloneJson(afterEntry.layer) : null,
        beforeIndex: beforeEntry?.index ?? null,
        afterIndex: afterEntry?.index ?? null,
      });
      continue;
    }
    const beforeLayer = beforeEntry.layer;
    const afterLayer = afterEntry.layer;
    const immutableBefore = {
      id: beforeLayer.id,
      width: beforeLayer.width,
      height: beforeLayer.height,
      markers: beforeLayer.markers,
    };
    const immutableAfter = {
      id: afterLayer.id,
      width: afterLayer.width,
      height: afterLayer.height,
      markers: afterLayer.markers,
    };
    if (!jsonEqual(immutableBefore, immutableAfter)) {
      throw new RangeError("Authoring history cannot resize layers or replace layer markers in this slice");
    }
    for (const field of ["name", "baseY"]) {
      if (beforeLayer[field] !== afterLayer[field]) {
        patches.push({
          kind: "layer",
          layerId,
          field,
          before: beforeLayer[field],
          after: afterLayer[field],
        });
      }
    }
    for (const channel of ["surface", "structure"]) {
      if (!jsonEqual(beforeLayer[channel].legend, afterLayer[channel].legend)) {
        patches.push({
          kind: "legend",
          layerId,
          channel,
          before: [...beforeLayer[channel].legend],
          after: [...afterLayer[channel].legend],
        });
      }
      for (let cellIndex = 0; cellIndex < beforeLayer[channel].cells.length; cellIndex += 1) {
        const beforeDefinition = definitionAt(beforeLayer, channel, cellIndex);
        const afterDefinition = definitionAt(afterLayer, channel, cellIndex);
        if (beforeDefinition === afterDefinition) continue;
        patches.push({
          kind: "cell",
          layerId,
          channel,
          cellIndex,
          before: beforeDefinition,
          after: afterDefinition,
        });
      }
    }
    const beforeInstances = new Map(
      beforeLayer.instances.map((instance, index) => [instance.id, { instance, index }]),
    );
    const afterInstances = new Map(
      afterLayer.instances.map((instance, index) => [instance.id, { instance, index }]),
    );
    const instanceIds = [...new Set([...beforeInstances.keys(), ...afterInstances.keys()])].sort();
    for (const instanceId of instanceIds) {
      const beforeEntry = beforeInstances.get(instanceId) ?? null;
      const afterEntry = afterInstances.get(instanceId) ?? null;
      if (
        beforeEntry
        && afterEntry
        && beforeEntry.index === afterEntry.index
        && jsonEqual(beforeEntry.instance, afterEntry.instance)
      ) continue;
      patches.push({
        kind: "instance",
        layerId,
        instanceId,
        before: beforeEntry ? cloneInstance(beforeEntry.instance) : null,
        after: afterEntry ? cloneInstance(afterEntry.instance) : null,
        beforeIndex: beforeEntry?.index ?? null,
        afterIndex: afterEntry?.index ?? null,
      });
    }
    if (beforeLayer.nextInstanceOrdinal !== afterLayer.nextInstanceOrdinal) {
      patches.push({
        kind: "layer",
        layerId,
        field: "nextInstanceOrdinal",
        before: beforeLayer.nextInstanceOrdinal,
        after: afterLayer.nextInstanceOrdinal,
      });
    }
  }
  const beforeConnectors = new Map(
    before.connectors.map((connector, index) => [connector.id, { connector, index }]),
  );
  const afterConnectors = new Map(
    after.connectors.map((connector, index) => [connector.id, { connector, index }]),
  );
  const connectorIds = [...new Set([
    ...beforeConnectors.keys(),
    ...afterConnectors.keys(),
  ])].sort();
  for (const connectorId of connectorIds) {
    const beforeEntry = beforeConnectors.get(connectorId) ?? null;
    const afterEntry = afterConnectors.get(connectorId) ?? null;
    if (
      beforeEntry
      && afterEntry
      && beforeEntry.index === afterEntry.index
      && jsonEqual(beforeEntry.connector, afterEntry.connector)
    ) continue;
    patches.push({
      kind: "connector",
      connectorId,
      before: beforeEntry ? cloneJson(beforeEntry.connector) : null,
      after: afterEntry ? cloneJson(afterEntry.connector) : null,
      beforeIndex: beforeEntry?.index ?? null,
      afterIndex: afterEntry?.index ?? null,
    });
  }
  if (patches.length === 0) return null;
  return cloneAuthoringCommand({ id: options.id ?? 0, label, patches });
}

/**
 * Applies or reverses a command on a detached clone. Preconditions are checked
 * before any mutation, and final schema validation makes the operation atomic.
 * Historical reversal intentionally restores known state without re-running
 * placement policy against transient runtime bodies.
 * @param {unknown} documentInput
 * @param {unknown} commandInput
 * @param {"forward"|"reverse"} [direction]
 */
export function applyAuthoringCommand(documentInput, commandInput, direction = "forward") {
  if (direction !== "forward" && direction !== "reverse") {
    throw new TypeError("Authoring command direction must be forward or reverse");
  }
  const document = validateAuthoringMap(documentInput);
  const command = cloneAuthoringCommand(commandInput);
  const sourceSide = direction === "forward" ? "before" : "after";
  const targetSide = direction === "forward" ? "after" : "before";
  const sourceIndexSide = direction === "forward" ? "beforeIndex" : "afterIndex";
  const targetIndexSide = direction === "forward" ? "afterIndex" : "beforeIndex";

  // Check every precondition before touching the detached document.
  for (const patch of command.patches) {
    if (patch.kind === "map") {
      if (!jsonEqual(document[patch.field], patch[sourceSide])) {
        throw new RangeError(`Map patch precondition failed for "${patch.field}"`);
      }
      continue;
    }
    if (patch.kind === "layer-record") {
      const index = document.layers.findIndex((layer) => layer.id === patch.layerId);
      const expectedIndex = patch[sourceIndexSide];
      const current = index < 0 ? null : document.layers[index];
      if (index !== (expectedIndex ?? -1) || !jsonEqual(current, patch[sourceSide])) {
        throw new RangeError(`Layer patch precondition failed for "${patch.layerId}"`);
      }
      continue;
    }
    if (patch.kind === "connector") {
      const index = document.connectors.findIndex((connector) => connector.id === patch.connectorId);
      const expectedIndex = patch[sourceIndexSide];
      const current = index < 0 ? null : document.connectors[index];
      if (index !== (expectedIndex ?? -1) || !jsonEqual(current, patch[sourceSide])) {
        throw new RangeError(`Connector patch precondition failed for "${patch.connectorId}"`);
      }
      continue;
    }
    const layer = layerFor(document, patch.layerId);
    if (patch.kind === "cell") {
      if (patch.cellIndex >= layer[patch.channel].cells.length) {
        throw new RangeError(`Cell patch index ${patch.cellIndex} is outside layer "${layer.id}"`);
      }
      if (definitionAt(layer, patch.channel, patch.cellIndex) !== patch[sourceSide]) {
        throw new RangeError(`Cell patch precondition failed at ${layer.id}:${patch.channel}:${patch.cellIndex}`);
      }
    } else if (patch.kind === "legend") {
      if (!jsonEqual(layer[patch.channel].legend, patch[sourceSide])) {
        throw new RangeError(`Legend patch precondition failed at ${layer.id}:${patch.channel}`);
      }
    } else if (patch.kind === "instance") {
      const index = layer.instances.findIndex((instance) => instance.id === patch.instanceId);
      const expectedIndex = patch[sourceIndexSide];
      const current = index < 0 ? null : layer.instances[index];
      if (index !== (expectedIndex ?? -1) || !jsonEqual(current, patch[sourceSide])) {
        throw new RangeError(`Instance patch precondition failed for "${patch.instanceId}"`);
      }
    } else if (!jsonEqual(layer[patch.field], patch[sourceSide])) {
      throw new RangeError(`Layer field patch precondition failed for "${layer.id}.${patch.field}"`);
    }
  }

  const layerRecordPatches = command.patches.filter((patch) => patch.kind === "layer-record");
  if (layerRecordPatches.length > 0) {
    const touchedIds = new Set(layerRecordPatches.map((patch) => patch.layerId));
    document.layers = document.layers.filter((layer) => !touchedIds.has(layer.id));
    const insertions = layerRecordPatches
      .filter((patch) => patch[targetSide] !== null)
      .sort((left, right) => (
        left[targetIndexSide] - right[targetIndexSide]
        || left.layerId.localeCompare(right.layerId)
      ));
    for (const patch of insertions) {
      const targetIndex = patch[targetIndexSide];
      if (targetIndex > document.layers.length) {
        throw new RangeError(`Layer ordering for "${patch.layerId}" is outside the document`);
      }
      document.layers.splice(targetIndex, 0, cloneJson(patch[targetSide]));
    }
  }
  for (const patch of command.patches) {
    if (patch.kind !== "map") continue;
    document[patch.field] = cloneJson(patch[targetSide]);
  }

  const connectorPatches = command.patches.filter((patch) => patch.kind === "connector");
  if (connectorPatches.length > 0) {
    const touchedIds = new Set(connectorPatches.map((patch) => patch.connectorId));
    document.connectors = document.connectors.filter((connector) => !touchedIds.has(connector.id));
    const insertions = connectorPatches
      .filter((patch) => patch[targetSide] !== null)
      .sort((left, right) => (
        left[targetIndexSide] - right[targetIndexSide]
        || left.connectorId.localeCompare(right.connectorId)
      ));
    for (const patch of insertions) {
      const targetIndex = patch[targetIndexSide];
      if (targetIndex > document.connectors.length) {
        throw new RangeError(`Connector ordering for "${patch.connectorId}" is outside the document`);
      }
      document.connectors.splice(targetIndex, 0, cloneJson(patch[targetSide]));
    }
  }

  // Legends first so stable definition IDs can be resolved into target codes.
  for (const patch of command.patches) {
    if (patch.kind !== "legend") continue;
    const layer = layerFor(document, patch.layerId);
    const definitions = layer[patch.channel].cells.map((code) => (
      layer[patch.channel].legend[code] ?? null
    ));
    for (const cellPatch of command.patches) {
      if (
        cellPatch.kind === "cell"
        && cellPatch.layerId === patch.layerId
        && cellPatch.channel === patch.channel
      ) {
        definitions[cellPatch.cellIndex] = cellPatch[targetSide];
      }
    }
    const targetLegend = /** @type {Array<string|null>} */ (cloneJson(patch[targetSide]));
    layer[patch.channel].legend = targetLegend;
    layer[patch.channel].cells = definitions.map((definitionId) => {
      const code = targetLegend.indexOf(definitionId);
      if (code < 0) {
        throw new RangeError(
          `Definition "${String(definitionId)}" is absent from the target legend`,
        );
      }
      return code;
    });
  }
  for (const patch of command.patches) {
    if (patch.kind !== "cell") continue;
    const layer = layerFor(document, patch.layerId);
    const definitionId = patch[targetSide];
    const code = layer[patch.channel].legend.indexOf(definitionId);
    if (code < 0) {
      throw new RangeError(`Definition "${String(definitionId)}" is absent from the target legend`);
    }
    layer[patch.channel].cells[patch.cellIndex] = code;
  }

  const instancePatchesByLayer = new Map();
  for (const patch of command.patches) {
    if (patch.kind !== "instance") continue;
    const list = instancePatchesByLayer.get(patch.layerId) ?? [];
    list.push(patch);
    instancePatchesByLayer.set(patch.layerId, list);
  }
  for (const [layerId, patches] of instancePatchesByLayer) {
    const layer = layerFor(document, layerId);
    const touchedIds = new Set(patches.map((patch) => patch.instanceId));
    layer.instances = layer.instances.filter((instance) => !touchedIds.has(instance.id));
    const insertions = patches
      .filter((patch) => patch[targetSide] !== null)
      .sort((left, right) => (
        left[targetIndexSide] - right[targetIndexSide]
        || left.instanceId.localeCompare(right.instanceId)
      ));
    for (const patch of insertions) {
      const targetIndex = patch[targetIndexSide];
      if (targetIndex > layer.instances.length) {
        throw new RangeError(`Instance ordering for "${patch.instanceId}" is outside layer "${layer.id}"`);
      }
      layer.instances.splice(targetIndex, 0, cloneInstance(patch[targetSide]));
    }
  }
  for (const patch of command.patches) {
    if (patch.kind !== "layer") continue;
    layerFor(document, patch.layerId)[patch.field] = patch[targetSide];
  }
  return validateAuthoringMap(document);
}

/** @param {Record<string,any>} definition @param {string} verb */
function definitionLabel(definition, verb) {
  return `${verb} ${definition?.label ?? definition?.id ?? "definition"}`;
}

/**
 * Runs an existing semantic editor action against a detached source document,
 * validates the proposed compiled result, and returns its exact command delta.
 * @param {unknown} documentInput
 * @param {Record<string,any>} action
 */
export function commandFromAuthoringAction(documentInput, action) {
  const before = validateAuthoringMap(documentInput);
  let after;
  let label;
  const layerId = String(action.layerId ?? before.playerStart.layerId);
  const activeLayer = before.layers.find((layer) => layer.id === layerId);
  if (!activeLayer) throw new RangeError(`Unknown authoring layer "${layerId}"`);
  switch (action.type) {
    case "setTile":
      after = Number(action.tile) === 1
        ? paintStructure(before, Math.trunc(Number(action.cx)), Math.trunc(Number(action.cz)), "structure.wall", layerId)
        : eraseStructure(before, Math.trunc(Number(action.cx)), Math.trunc(Number(action.cz)), layerId);
      label = Number(action.tile) === 1 ? "Paint Wall" : "Erase Structure";
      break;
    case "paintSurface":
    case "paintSurfaceStroke": {
      const definition = getPlaceableDefinition(action.definitionId);
      const cells = action.type === "paintSurface"
        ? [{ cx: Math.trunc(Number(action.cx)), cz: Math.trunc(Number(action.cz)) }]
        : action.cells;
      after = paintSurfaceCells(before, cells, String(action.definitionId), layerId);
      label = definitionLabel(definition, "Paint");
      break;
    }
    case "eraseSurface":
    case "eraseSurfaceStroke": {
      const cells = action.type === "eraseSurface"
        ? [{ cx: Math.trunc(Number(action.cx)), cz: Math.trunc(Number(action.cz)) }]
        : action.cells;
      after = eraseSurfaceCells(before, cells, layerId);
      label = "Erase Surface";
      break;
    }
    case "paintStructure":
    case "paintStructureStroke": {
      const definition = getPlaceableDefinition(action.definitionId);
      const cells = action.type === "paintStructure"
        ? [{ cx: Math.trunc(Number(action.cx)), cz: Math.trunc(Number(action.cz)) }]
        : action.cells;
      after = paintStructureCells(before, cells, String(action.definitionId), layerId);
      label = definitionLabel(definition, "Paint");
      break;
    }
    case "eraseStructure":
    case "eraseStructureStroke": {
      const cells = action.type === "eraseStructure"
        ? [{ cx: Math.trunc(Number(action.cx)), cz: Math.trunc(Number(action.cz)) }]
        : action.cells;
      after = eraseStructureCells(before, cells, layerId);
      label = "Erase Structure";
      break;
    }
    case "placeRock": {
      const definitionId = rockDefinitionId(String(action.archetype));
      if (!definitionId) throw new RangeError(`Unknown rock archetype "${String(action.archetype)}"`);
      const definition = getPlaceableDefinition(definitionId);
      after = placeInstance(before, definitionId, Number(action.x), Number(action.z), { layerId }).document;
      label = definitionLabel(definition, "Place");
      break;
    }
    case "placeInstance": {
      const definition = getPlaceableDefinition(action.definitionId);
      const result = placeInstance(
        before,
        String(action.definitionId),
        Number(action.x),
        Number(action.z),
        {
          rotation: action.rotation ?? 0,
          layerId,
          ...(action.properties === undefined ? {} : { properties: action.properties }),
        },
      );
      after = result.document;
      label = definitionLabel(definition, "Place");
      break;
    }
    case "removeInstance": {
      const instance = activeLayer.instances.find((candidate) => candidate.id === String(action.authoringId));
      if (!instance) throw new RangeError(`Unknown authoring instance "${String(action.authoringId)}"`);
      after = removeInstance(before, instance.id, layerId);
      label = definitionLabel(getPlaceableDefinition(instance.definitionId), "Delete");
      break;
    }
    case "updateInstanceTransform": {
      const instance = activeLayer.instances.find((candidate) => candidate.id === String(action.authoringId));
      if (!instance) throw new RangeError(`Unknown authoring instance "${String(action.authoringId)}"`);
      const transform = {
        x: Number(action.x),
        z: Number(action.z),
        rotation: Number(action.rotation),
      };
      after = updateInstanceTransform(before, instance.id, transform, layerId);
      const moved = transform.x !== instance.x || transform.z !== instance.z;
      const rotated = transform.rotation !== instance.rotation;
      const verb = moved && rotated ? "Transform" : moved ? "Move" : rotated ? "Rotate" : "Transform";
      label = definitionLabel(getPlaceableDefinition(instance.definitionId), verb);
      break;
    }
    case "updateInstanceProperties": {
      const instance = activeLayer.instances.find((candidate) => candidate.id === String(action.authoringId));
      if (!instance) throw new RangeError(`Unknown authoring instance "${String(action.authoringId)}"`);
      after = updateInstanceProperties(before, instance.id, action.properties, layerId);
      label = definitionLabel(getPlaceableDefinition(instance.definitionId), "Edit");
      break;
    }
    case "createLayer": {
      const result = createLayer(
        before,
        String(action.relativeLayerId ?? layerId),
        action.direction === "below" ? "below" : "above",
        {
          ...(action.name === undefined ? {} : { name: String(action.name) }),
          ...(action.baseY === undefined ? {} : { baseY: Number(action.baseY) }),
        },
      );
      after = result.document;
      label = `Create ${after.layers.find((layer) => layer.id === result.layerId)?.name ?? "Layer"}`;
      break;
    }
    case "deleteLayer": {
      const target = before.layers.find((layer) => layer.id === String(action.layerId));
      if (!target) throw new RangeError(`Unknown authoring layer "${String(action.layerId)}"`);
      after = deleteLayer(before, target.id);
      label = `Delete ${target.name}`;
      break;
    }
    case "renameLayer": {
      const target = before.layers.find((layer) => layer.id === String(action.layerId));
      if (!target) throw new RangeError(`Unknown authoring layer "${String(action.layerId)}"`);
      after = renameLayer(before, target.id, String(action.name));
      label = `Rename ${target.name}`;
      break;
    }
    case "setLayerBaseY": {
      const target = before.layers.find((layer) => layer.id === String(action.layerId));
      if (!target) throw new RangeError(`Unknown authoring layer "${String(action.layerId)}"`);
      after = setLayerBaseY(before, target.id, Number(action.baseY));
      label = `Change ${target.name} Height`;
      break;
    }
    case "setPlayerStartLayer": {
      const target = before.layers.find((layer) => layer.id === String(action.layerId));
      if (!target) throw new RangeError(`Unknown authoring layer "${String(action.layerId)}"`);
      after = setPlayerStartLayer(before, target.id);
      label = `Set Start Layer ${target.name}`;
      break;
    }
    case "placeConnector": {
      const result = placeElevatorConnector(before, Number(action.x), Number(action.z), {
        lowerLayerId: String(action.lowerLayerId),
        upperLayerId: String(action.upperLayerId),
        ...(action.platformWidth === undefined ? {} : { platformWidth: Number(action.platformWidth) }),
        ...(action.apertureWidth === undefined ? {} : { apertureWidth: Number(action.apertureWidth) }),
        ...(action.travelDurationSeconds === undefined
          ? {}
          : { travelDurationSeconds: Number(action.travelDurationSeconds) }),
        ...(action.dwellSeconds === undefined ? {} : { dwellSeconds: Number(action.dwellSeconds) }),
        ...(action.initialStop === undefined ? {} : { initialStop: action.initialStop }),
      });
      after = result.document;
      label = "Place Two-stop Elevator";
      break;
    }
    case "removeConnector": {
      const connectorId = String(action.connectorId);
      const connector = before.connectors.find((candidate) => candidate.id === connectorId);
      if (!connector) throw new RangeError(`Unknown authoring connector "${connectorId}"`);
      after = removeConnector(before, connectorId);
      label = "Delete Two-stop Elevator";
      break;
    }
    case "updateConnector": {
      const connectorId = String(action.connectorId);
      const connector = before.connectors.find((candidate) => candidate.id === connectorId);
      if (!connector) throw new RangeError(`Unknown authoring connector "${connectorId}"`);
      after = updateConnector(before, connectorId, action.changes ?? {});
      label = "Edit Two-stop Elevator";
      break;
    }
    default:
      throw new RangeError(`Unsupported authoring action "${String(action.type)}"`);
  }
  // Compilation resolves definitions and validates placements before a command
  // can invalidate a redo branch or enter history.
  compileAuthoringMap(after);
  return createAuthoringCommand(before, after, label);
}

/** @param {unknown} result */
function normalizedApplyResult(result) {
  if (result === true) return { ok: true, error: null };
  if (result === false) return { ok: false, error: "Authoring command was rejected" };
  if (result && typeof result === "object") {
    const source = /** @type {Record<string,any>} */ (result);
    return {
      ok: Boolean(source.ok),
      error: source.error === undefined || source.error === null ? null : String(source.error),
      ...(source.snapshot === undefined ? {} : { snapshot: source.snapshot }),
    };
  }
  return { ok: false, error: "Authoring command returned no result" };
}

/** @param {Function} apply @param {Record<string,any>} command @param {"forward"|"reverse"} direction */
function invokeApply(apply, command, direction) {
  try {
    return normalizedApplyResult(apply(cloneAuthoringCommand(command), direction));
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Editor-session-only bounded history. Revision identities are monotonic tokens,
 * not cursor indexes, so dirty tracking survives branch truncation and pruning.
 */
export class AuthoringHistory {
  /**
   * @param {{
   * capacity?:number,
   * apply:(command:Record<string,any>,direction:"forward"|"reverse")=>unknown,
   * }} options
   */
  constructor(options) {
    const capacity = options.capacity ?? DEFAULT_AUTHORING_HISTORY_CAPACITY;
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new RangeError("Authoring history capacity must be a positive integer");
    }
    if (typeof options.apply !== "function") throw new TypeError("Authoring history requires an apply callback");
    this.capacity = capacity;
    this.apply = options.apply;
    this.entries = [];
    this.cursor = 0;
    this.nextCommandId = 1;
    this.nextRevisionId = 1;
    this.currentRevisionId = this.#revision();
    this.savedRevisionId = this.currentRevisionId;
  }

  #revision() {
    const id = `authoring-revision-${this.nextRevisionId}`;
    this.nextRevisionId += 1;
    return id;
  }

  /** @param {unknown} commandInput */
  execute(commandInput) {
    if (commandInput === null) {
      return { ok: true, recorded: false, error: null, snapshot: undefined };
    }
    let command;
    try {
      const detached = cloneAuthoringCommand(commandInput);
      command = cloneAuthoringCommand({
        ...detached,
        id: detached.id > 0 ? detached.id : this.nextCommandId,
      });
    } catch (error) {
      return {
        ok: false,
        recorded: false,
        error: error instanceof Error ? error.message : String(error),
        snapshot: undefined,
      };
    }
    if (command.patches.length === 0) {
      return { ok: true, recorded: false, error: null, snapshot: undefined };
    }
    const applied = invokeApply(this.apply, command, "forward");
    if (!applied.ok) return { ...applied, recorded: false };
    this.nextCommandId = Math.max(this.nextCommandId, command.id + 1);
    if (this.cursor < this.entries.length) this.entries.length = this.cursor;
    const beforeRevisionId = this.currentRevisionId;
    const afterRevisionId = this.#revision();
    this.entries.push({ command, beforeRevisionId, afterRevisionId });
    this.cursor = this.entries.length;
    this.currentRevisionId = afterRevisionId;
    while (this.entries.length > this.capacity) {
      this.entries.shift();
      this.cursor -= 1;
    }
    return { ...applied, recorded: true, command: cloneAuthoringCommand(command) };
  }

  undo() {
    if (this.cursor <= 0) return { ok: false, traversed: false, error: "Nothing to undo" };
    const entry = this.entries[this.cursor - 1];
    const applied = invokeApply(this.apply, entry.command, "reverse");
    if (!applied.ok) return { ...applied, traversed: false };
    this.cursor -= 1;
    this.currentRevisionId = entry.beforeRevisionId;
    return { ...applied, traversed: true, label: entry.command.label };
  }

  redo() {
    if (this.cursor >= this.entries.length) {
      return { ok: false, traversed: false, error: "Nothing to redo" };
    }
    const entry = this.entries[this.cursor];
    const applied = invokeApply(this.apply, entry.command, "forward");
    if (!applied.ok) return { ...applied, traversed: false };
    this.cursor += 1;
    this.currentRevisionId = entry.afterRevisionId;
    return { ...applied, traversed: true, label: entry.command.label };
  }

  markSaved() {
    this.savedRevisionId = this.currentRevisionId;
    return this.snapshot();
  }

  /** Establishes a clean baseline after map creation, migration, load, or replacement. */
  clear() {
    this.entries.length = 0;
    this.cursor = 0;
    this.currentRevisionId = this.#revision();
    this.savedRevisionId = this.currentRevisionId;
    return this.snapshot();
  }

  snapshot() {
    const undoEntry = this.cursor > 0 ? this.entries[this.cursor - 1] : null;
    const redoEntry = this.cursor < this.entries.length ? this.entries[this.cursor] : null;
    return {
      canUndo: Boolean(undoEntry),
      canRedo: Boolean(redoEntry),
      undoDepth: this.cursor,
      redoDepth: this.entries.length - this.cursor,
      capacity: this.capacity,
      currentCommandLabel: undoEntry?.command.label ?? null,
      nextUndoLabel: undoEntry?.command.label ?? null,
      nextRedoLabel: redoEntry?.command.label ?? null,
      dirty: this.currentRevisionId !== this.savedRevisionId,
      currentRevisionId: this.currentRevisionId,
      savedRevisionId: this.savedRevisionId,
    };
  }
}
