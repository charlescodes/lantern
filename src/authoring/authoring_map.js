// @ts-check

import { MAP_VERSION, ROCK, SCENARIO_VERSION } from "../config.js";
import {
  getPlaceableDefinition,
  rockDefinitionId,
} from "./definition_catalog.js";
import { validateInstancePlacement } from "./placement_validation.js";

export const AUTHORING_MAP_FORMAT = "lantern-authoring-map";
export const AUTHORING_MAP_VERSION = 2;
export const LEGACY_AUTHORING_MAP_VERSION = 1;
export const MAX_AUTHORING_LAYERS = 16;
export const DEFAULT_LAYER_SPACING_METERS = 3;
export const DEFAULT_LAYER_ID = "ground";
export const DEFAULT_SURFACE_DEFINITION_ID = "surface.stone";
export const DEFAULT_WALL_DEFINITION_ID = "structure.wall";

export class AuthoringMapValidationError extends RangeError {
  /** @param {Array<{severity?:"error"|"warning",path:string,code:string,message:string,layerId?:string}>} issues */
  constructor(issues) {
    const normalized = issues.map((issue) => ({
      severity: issue.severity === "warning" ? "warning" : "error",
      path: String(issue.path),
      code: String(issue.code),
      message: String(issue.message),
      ...(issue.layerId ? { layerId: String(issue.layerId) } : {}),
    }));
    super(`Invalid authoring map: ${normalized.map((issue) => `${issue.path}: ${issue.message}`).join("; ")}`);
    this.name = "AuthoringMapValidationError";
    this.issues = normalized.map((issue) => ({ ...issue }));
  }
}

/** @param {string} path @param {string} code @param {string} message */
function fail(path, code, message) {
  throw new AuthoringMapValidationError([{ severity: "error", path, code, message }]);
}

/** @param {unknown} value */
function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

/**
 * Structural validation is intentionally deterministic and non-mutating. It
 * returns every safe-to-diagnose issue in document order; compilation adds
 * geometry-specific diagnostics such as a blocked player start.
 * @param {unknown} input
 */
function normalizeVersionTwo(input) {
  /** @type {Array<{severity:"error"|"warning",path:string,code:string,message:string,layerId?:string}>} */
  const diagnostics = [];
  const issue = (severity, path, code, message, layerId) => {
    diagnostics.push({ severity, path, code, message, ...(layerId ? { layerId } : {}) });
  };
  if (!isRecord(input)) {
    issue("error", "map", "object", "Map must be an object.");
    return { document: null, diagnostics };
  }
  const source = /** @type {Record<string,any>} */ (input);
  const rejectUnknownFields = (value, allowed, path, layerId) => {
    for (const key of Object.keys(value)) {
      if (allowed.has(key)) continue;
      issue(
        "error",
        path ? `${path}.${key}` : key,
        "unknown-field",
        `Field "${key}" is not part of authoring-map v${AUTHORING_MAP_VERSION}.`,
        layerId,
      );
    }
  };
  rejectUnknownFields(
    source,
    new Set(["format", "version", "metadata", "nextLayerOrdinal", "playerStart", "layers"]),
    "",
  );
  if (source.format !== AUTHORING_MAP_FORMAT) {
    issue("error", "format", "invalid-format", `Format must equal "${AUTHORING_MAP_FORMAT}".`);
  }
  if (source.version !== AUTHORING_MAP_VERSION) {
    const future = Number.isInteger(source.version) && source.version > AUTHORING_MAP_VERSION;
    issue(
      "error",
      "version",
      future ? "unknown-future-schema" : "unsupported-schema-version",
      `Unsupported authoring-map version ${String(source.version)}.`,
    );
  }

  const stringValue = (value, path, layerId) => {
    if (typeof value !== "string" || value.trim().length === 0) {
      issue("error", path, "non-empty-string", "Value must be a non-empty string.", layerId);
      return "";
    }
    if (value.length > 128) {
      issue("error", path, "maximum-length", "Value must be at most 128 characters.", layerId);
    }
    return value;
  };
  const finiteValue = (value, path, layerId) => {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      issue("error", path, "finite-number", "Value must be a finite number.", layerId);
      return 0;
    }
    return value;
  };
  const dimensionValue = (value, path, layerId) => {
    if (!Number.isInteger(value) || value < 1 || value > 256) {
      issue("error", path, "dimension", "Dimension must be an integer from 1 to 256.", layerId);
      return 1;
    }
    return Number(value);
  };
  const positiveInteger = (value, path, layerId) => {
    if (!Number.isSafeInteger(value) || value < 1) {
      issue("error", path, "positive-integer", "Value must be a positive safe integer.", layerId);
      return 1;
    }
    return Number(value);
  };
  const cloneJson = (value, path, seen = new WeakSet()) => {
    if (value === null || typeof value === "string" || typeof value === "boolean") return value;
    if (typeof value === "number") {
      if (!Number.isFinite(value)) {
        issue("error", path, "finite-number", "JSON numbers must be finite.");
        return 0;
      }
      return value;
    }
    if (Array.isArray(value)) {
      if (seen.has(value)) {
        issue("error", path, "json-cycle", "Value must not contain circular references.");
        return [];
      }
      seen.add(value);
      const result = value.map((item, index) => cloneJson(item, `${path}[${index}]`, seen));
      seen.delete(value);
      return result;
    }
    if (isRecord(value)) {
      if (seen.has(value)) {
        issue("error", path, "json-cycle", "Value must not contain circular references.");
        return {};
      }
      seen.add(value);
      const result = {};
      for (const [key, item] of Object.entries(value)) {
        if (item === undefined || typeof item === "function" || typeof item === "symbol" || typeof item === "bigint") {
          issue("error", `${path}.${key}`, "json-value", "Value must be JSON-serializable.");
          continue;
        }
        Object.defineProperty(result, key, {
          value: cloneJson(item, `${path}.${key}`, seen),
          enumerable: true,
          configurable: true,
          writable: true,
        });
      }
      seen.delete(value);
      return result;
    }
    issue("error", path, "json-value", "Value must be JSON-serializable.");
    return null;
  };
  const pointValue = (value, path, layerId) => {
    if (!isRecord(value)) {
      issue("error", path, "object", "Point must be an object.", layerId);
      return { x: 0, z: 0 };
    }
    const point = /** @type {Record<string,any>} */ (value);
    return {
      x: finiteValue(point.x, `${path}.x`, layerId),
      z: finiteValue(point.z, `${path}.z`, layerId),
    };
  };

  let metadata = { id: "", name: "" };
  if (!isRecord(source.metadata)) {
    issue("error", "metadata", "object", "Metadata must be an object.");
  } else {
    metadata = /** @type {Record<string,any>} */ (cloneJson(source.metadata, "metadata"));
    metadata.id = stringValue(source.metadata.id, "metadata.id");
    metadata.name = stringValue(source.metadata.name, "metadata.name");
  }
  const nextLayerOrdinal = positiveInteger(source.nextLayerOrdinal, "nextLayerOrdinal");
  let playerStart = { layerId: "", x: 0, z: 0 };
  if (!isRecord(source.playerStart)) {
    issue("error", "playerStart", "object", "Player start must be an object.");
  } else {
    rejectUnknownFields(source.playerStart, new Set(["layerId", "x", "z"]), "playerStart");
    playerStart = {
      layerId: stringValue(source.playerStart.layerId, "playerStart.layerId"),
      ...pointValue(source.playerStart, "playerStart"),
    };
  }

  if (!Array.isArray(source.layers) || source.layers.length === 0) {
    issue("error", "layers", "non-empty-array", "Map must contain at least one named simulation layer.");
  } else if (source.layers.length > MAX_AUTHORING_LAYERS) {
    issue(
      "error",
      "layers",
      "layer-capacity",
      `Map contains ${source.layers.length} layers; the configured limit is ${MAX_AUTHORING_LAYERS}.`,
    );
  }
  const layerValues = Array.isArray(source.layers) ? source.layers.slice(0, MAX_AUTHORING_LAYERS + 1) : [];
  const layerIds = new Set();
  const instanceIds = new Set();
  const baseHeights = new Map();
  let sharedWidth = null;
  let sharedHeight = null;
  const layers = layerValues.map((layerValue, layerIndex) => {
    const path = `layers[${layerIndex}]`;
    if (!isRecord(layerValue)) {
      issue("error", path, "object", "Layer must be an object.");
    }
    const layerSource = isRecord(layerValue) ? /** @type {Record<string,any>} */ (layerValue) : {};
    const id = stringValue(layerSource.id, `${path}.id`);
    rejectUnknownFields(
      layerSource,
      new Set([
        "id",
        "name",
        "baseY",
        "width",
        "height",
        "surface",
        "structure",
        "instances",
        "markers",
        "nextInstanceOrdinal",
      ]),
      path,
      id,
    );
    if (id && layerIds.has(id)) {
      issue("error", `${path}.id`, "duplicate-layer-id", `Layer ID "${id}" is already in use.`, id);
    }
    if (id) layerIds.add(id);
    const name = stringValue(layerSource.name, `${path}.name`, id);
    const baseY = finiteValue(layerSource.baseY, `${path}.baseY`, id);
    if (Number.isFinite(layerSource.baseY)) {
      const prior = baseHeights.get(baseY);
      if (prior !== undefined) {
        issue(
          "warning",
          `${path}.baseY`,
          "duplicate-base-y",
          `Layer shares base Y ${baseY} with layers[${prior}].`,
          id,
        );
      } else {
        baseHeights.set(baseY, layerIndex);
      }
    }
    const width = dimensionValue(layerSource.width, `${path}.width`, id);
    const height = dimensionValue(layerSource.height, `${path}.height`, id);
    if (sharedWidth === null) {
      sharedWidth = width;
      sharedHeight = height;
    } else if (width !== sharedWidth || height !== sharedHeight) {
      issue(
        "error",
        path,
        "incompatible-layer-dimensions",
        `Layer dimensions ${width}x${height} do not match shared dimensions ${sharedWidth}x${sharedHeight}.`,
        id,
      );
    }
    const cellCount = width * height;

    const surfaceSource = isRecord(layerSource.surface) ? layerSource.surface : {};
    if (!isRecord(layerSource.surface)) {
      issue("error", `${path}.surface`, "object", "Surface grid must be an object.", id);
    }
    rejectUnknownFields(surfaceSource, new Set(["legend", "cells"]), `${path}.surface`, id);
    const surfaceLegendValues = Array.isArray(surfaceSource.legend) ? surfaceSource.legend : [];
    if (surfaceLegendValues.length === 0) {
      issue("error", `${path}.surface.legend`, "non-empty-array", "Surface legend must not be empty.", id);
    }
    const surfaceLegend = surfaceLegendValues.map((value, index) => {
      const definitionId = stringValue(value, `${path}.surface.legend[${index}]`, id);
      const definition = getPlaceableDefinition(definitionId);
      if (!definition) {
        issue("error", `${path}.surface.legend[${index}]`, "unknown-definition", `Unknown definition "${definitionId}".`, id);
      } else if (definition.placementTarget !== "surface") {
        issue("error", `${path}.surface.legend[${index}]`, "definition-target", `Definition "${definitionId}" is not a surface.`, id);
      }
      return definitionId;
    });
    if (new Set(surfaceLegend).size !== surfaceLegend.length) {
      issue("error", `${path}.surface.legend`, "duplicate-definition", "Surface legend contains duplicate definition IDs.", id);
    }
    const surfaceCellValues = Array.isArray(surfaceSource.cells) ? surfaceSource.cells : [];
    if (surfaceCellValues.length !== cellCount) {
      issue("error", `${path}.surface.cells`, "grid-length", `Surface grid must contain exactly ${cellCount} entries.`, id);
    }
    const surfaceCells = surfaceCellValues.map((value, index) => {
      if (!Number.isInteger(value) || value < 0 || value >= surfaceLegend.length) {
        issue("error", `${path}.surface.cells[${index}]`, "legend-index", "Cell must reference a surface legend entry.", id);
        return 0;
      }
      return Number(value);
    });

    const structureSource = isRecord(layerSource.structure) ? layerSource.structure : {};
    if (!isRecord(layerSource.structure)) {
      issue("error", `${path}.structure`, "object", "Structure grid must be an object.", id);
    }
    rejectUnknownFields(structureSource, new Set(["legend", "cells"]), `${path}.structure`, id);
    const structureLegendValues = Array.isArray(structureSource.legend) ? structureSource.legend : [];
    if (structureLegendValues.length === 0 || structureLegendValues[0] !== null) {
      issue("error", `${path}.structure.legend`, "empty-structure-slot", "Structure legend must begin with null.", id);
    }
    const structureLegend = structureLegendValues.map((value, index) => {
      if (index === 0) return null;
      const definitionId = stringValue(value, `${path}.structure.legend[${index}]`, id);
      const definition = getPlaceableDefinition(definitionId);
      if (!definition) {
        issue("error", `${path}.structure.legend[${index}]`, "unknown-definition", `Unknown definition "${definitionId}".`, id);
      } else if (definition.placementTarget !== "structure") {
        issue("error", `${path}.structure.legend[${index}]`, "definition-target", `Definition "${definitionId}" is not a structure.`, id);
      }
      return definitionId;
    });
    const populatedStructures = structureLegend.slice(1);
    if (new Set(populatedStructures).size !== populatedStructures.length) {
      issue("error", `${path}.structure.legend`, "duplicate-definition", "Structure legend contains duplicate definition IDs.", id);
    }
    const structureCellValues = Array.isArray(structureSource.cells) ? structureSource.cells : [];
    if (structureCellValues.length !== cellCount) {
      issue("error", `${path}.structure.cells`, "grid-length", `Structure grid must contain exactly ${cellCount} entries.`, id);
    }
    const structureCells = structureCellValues.map((value, index) => {
      if (!Number.isInteger(value) || value < 0 || value >= structureLegend.length) {
        issue("error", `${path}.structure.cells[${index}]`, "legend-index", "Cell must reference a structure legend entry.", id);
        return 0;
      }
      return Number(value);
    });

    if (!Array.isArray(layerSource.instances)) {
      issue("error", `${path}.instances`, "array", "Instances must be an array.", id);
    }
    const instanceValues = Array.isArray(layerSource.instances) ? layerSource.instances : [];
    const instances = instanceValues.map((instanceValue, instanceIndex) => {
      const instancePath = `${path}.instances[${instanceIndex}]`;
      if (!isRecord(instanceValue)) {
        issue("error", instancePath, "object", "Instance must be an object.", id);
      }
      const instanceSource = isRecord(instanceValue) ? /** @type {Record<string,any>} */ (instanceValue) : {};
      const instanceId = stringValue(instanceSource.id, `${instancePath}.id`, id);
      rejectUnknownFields(
        instanceSource,
        new Set(["id", "definitionId", "x", "z", "rotation", "properties"]),
        instancePath,
        id,
      );
      if (instanceId && instanceIds.has(instanceId)) {
        issue("error", `${instancePath}.id`, "duplicate-instance-id", `Instance ID "${instanceId}" is already in use.`, id);
      }
      if (instanceId) instanceIds.add(instanceId);
      const definitionId = stringValue(instanceSource.definitionId, `${instancePath}.definitionId`, id);
      const definition = getPlaceableDefinition(definitionId);
      if (!definition) {
        issue("error", `${instancePath}.definitionId`, "unknown-definition", `Unknown definition "${definitionId}".`, id);
      } else if (definition.placementTarget !== "instance") {
        issue("error", `${instancePath}.definitionId`, "definition-target", `Definition "${definitionId}" is not a sparse instance.`, id);
      }
      const x = finiteValue(instanceSource.x, `${instancePath}.x`, id);
      const z = finiteValue(instanceSource.z, `${instancePath}.z`, id);
      let rotation = Number(instanceSource.rotation);
      if (!Number.isInteger(rotation) || rotation < 0 || rotation > 3) {
        issue("error", `${instancePath}.rotation`, "canonical-rotation", "Rotation must be a quarter turn from 0 to 3.", id);
        rotation = 0;
      }
      let properties;
      if (instanceSource.properties !== undefined) {
        if (!isRecord(instanceSource.properties)) {
          issue("error", `${instancePath}.properties`, "object", "Properties must be a JSON object.", id);
          properties = {};
        } else {
          properties = cloneJson(instanceSource.properties, `${instancePath}.properties`);
        }
      }
      return {
        id: instanceId,
        definitionId,
        x,
        z,
        rotation,
        ...(properties === undefined ? {} : { properties }),
      };
    });
    const dynamicCount = instances.reduce((count, instance) => {
      const definition = getPlaceableDefinition(instance.definitionId);
      return count + (definition?.traits?.dynamic === true ? 1 : 0);
    }, 0);
    if (dynamicCount > ROCK.capacity) {
      issue(
        "error",
        `${path}.instances`,
        "dynamic-body-capacity",
        `Layer contains more than the ${ROCK.capacity}-rock limit shared with dynamic authored props.`,
        id,
      );
    }

    let markers = {};
    if (!isRecord(layerSource.markers)) {
      issue("error", `${path}.markers`, "object", "Markers must be an object.", id);
    } else if (layerSource.markers.obelisk !== undefined) {
      rejectUnknownFields(layerSource.markers, new Set(["obelisk"]), `${path}.markers`, id);
      if (isRecord(layerSource.markers.obelisk)) {
        rejectUnknownFields(
          layerSource.markers.obelisk,
          new Set(["x", "z"]),
          `${path}.markers.obelisk`,
          id,
        );
      }
      markers = { obelisk: pointValue(layerSource.markers.obelisk, `${path}.markers.obelisk`, id) };
    } else {
      rejectUnknownFields(layerSource.markers, new Set(["obelisk"]), `${path}.markers`, id);
    }
    const nextInstanceOrdinal = positiveInteger(
      layerSource.nextInstanceOrdinal,
      `${path}.nextInstanceOrdinal`,
      id,
    );
    return {
      id,
      name,
      baseY,
      width,
      height,
      surface: { legend: surfaceLegend, cells: surfaceCells },
      structure: { legend: structureLegend, cells: structureCells },
      instances,
      markers,
      nextInstanceOrdinal,
    };
  });

  if (playerStart.layerId && !layerIds.has(playerStart.layerId)) {
    issue("error", "playerStart.layerId", "invalid-player-start-layer", `Player start references missing layer "${playerStart.layerId}".`);
  }
  const startLayer = layers.find((layer) => layer.id === playerStart.layerId);
  if (startLayer && (
    playerStart.x < 0
    || playerStart.z < 0
    || playerStart.x >= startLayer.width
    || playerStart.z >= startLayer.height
  )) {
    issue(
      "error",
      "playerStart",
      "player-start-out-of-bounds",
      `Player start (${playerStart.x}, ${playerStart.z}) is outside layer "${startLayer.id}".`,
      startLayer.id,
    );
  }

  const document = {
    format: AUTHORING_MAP_FORMAT,
    version: AUTHORING_MAP_VERSION,
    metadata,
    nextLayerOrdinal,
    playerStart,
    layers,
  };
  if (!diagnostics.some((entry) => entry.severity === "error")) {
    for (let layerIndex = 0; layerIndex < layers.length; layerIndex += 1) {
      const layer = layers[layerIndex];
      for (let instanceIndex = 0; instanceIndex < layer.instances.length; instanceIndex += 1) {
        const instance = layer.instances[instanceIndex];
        const placement = validateInstancePlacement(document, instance.definitionId, instance, {
          layerId: layer.id,
          ignoreInstanceId: instance.id,
        });
        if (!placement.valid) {
          issue(
            "error",
            `layers[${layerIndex}].instances[${instanceIndex}]`,
            placement.code,
            placement.message,
            layer.id,
          );
        }
      }
    }
  }
  return { document, diagnostics };
}

/** @param {unknown} input */
export function authoringMapDiagnostics(input) {
  return normalizeVersionTwo(input).diagnostics.map((entry) => ({ ...entry }));
}

/**
 * Validates and returns a detached, normalized current-version document.
 * @param {unknown} input
 */
export function validateAuthoringMap(input) {
  const result = normalizeVersionTwo(input);
  const errors = result.diagnostics.filter((entry) => entry.severity === "error");
  if (errors.length > 0 || !result.document) throw new AuthoringMapValidationError(errors);
  return result.document;
}

/** @param {unknown} input */
export function validateAuthoringMapWithDiagnostics(input) {
  const result = normalizeVersionTwo(input);
  const errors = result.diagnostics.filter((entry) => entry.severity === "error");
  if (errors.length > 0 || !result.document) throw new AuthoringMapValidationError(errors);
  return {
    document: result.document,
    diagnostics: result.diagnostics.map((entry) => ({ ...entry })),
  };
}

/** @param {unknown} input */
export function isAuthoringMapDocument(input) {
  return Boolean(
    isRecord(input)
    && /** @type {Record<string, unknown>} */ (input).format === AUTHORING_MAP_FORMAT,
  );
}

/** Explicitly migrates the M1A.1-M1A.3 v1 envelope into v2. @param {unknown} input */
export function migrateAuthoringMapV1(input) {
  if (!isRecord(input)) fail("map", "object", "Map must be an object.");
  const source = /** @type {Record<string,any>} */ (input);
  if (source.format !== AUTHORING_MAP_FORMAT || source.version !== LEGACY_AUTHORING_MAP_VERSION) {
    fail("version", "unsupported-schema-version", `Expected authoring-map version ${LEGACY_AUTHORING_MAP_VERSION}.`);
  }
  if (!Array.isArray(source.layers) || source.layers.length === 0) {
    fail("layers", "non-empty-array", "Version 1 map must contain at least one layer.");
  }
  const startLayerId = typeof source.activeLayerId === "string" ? source.activeLayerId : "";
  const startLayer = source.layers.find((layer) => isRecord(layer) && layer.id === startLayerId);
  if (!isRecord(startLayer) || !isRecord(startLayer.markers) || !isRecord(startLayer.markers.playerSpawn)) {
    fail("activeLayerId", "invalid-player-start-layer", "Version 1 active layer must own a player spawn.");
  }
  const layers = source.layers.map((layerValue) => {
    if (!isRecord(layerValue)) return layerValue;
    const markers = isRecord(layerValue.markers) ? layerValue.markers : {};
    return {
      ...layerValue,
      markers: {
        ...(markers.obelisk === undefined ? {} : { obelisk: markers.obelisk }),
      },
    };
  });
  return validateAuthoringMap({
    format: AUTHORING_MAP_FORMAT,
    version: AUTHORING_MAP_VERSION,
    metadata: source.metadata,
    nextLayerOrdinal: source.layers.length + 1,
    playerStart: {
      layerId: startLayerId,
      x: startLayer.markers.playerSpawn.x,
      z: startLayer.markers.playerSpawn.z,
    },
    layers,
  });
}

/**
 * Explicitly migrates map-v1 and scenario-v2/v3 data into the authoring format.
 * @param {unknown} input
 * @param {{id?:string,name?:string}} [metadata]
 */
export function migrateLegacyMap(input, metadata = {}) {
  if (!isRecord(input)) fail("legacyMap", "object", "Legacy map must be an object.");
  const source = /** @type {Record<string,any>} */ (input);
  const embeddedMetadata = isRecord(source.authoringMetadata) ? source.authoringMetadata : null;
  const version = source.version;
  if (version !== MAP_VERSION && version !== 2 && version !== SCENARIO_VERSION) {
    fail("legacyMap.version", "unsupported-version", `unsupported legacy map/scenario version ${String(source.version)}.`);
  }
  const legacyDimension = (value, path) => {
    if (!Number.isInteger(value) || value < 1 || value > 256) fail(path, "dimension", "Must be an integer from 1 to 256.");
    return Number(value);
  };
  const legacyPoint = (value, path) => {
    if (!isRecord(value) || !Number.isFinite(value.x) || !Number.isFinite(value.z)) {
      fail(path, "finite-point", "Must contain finite X/Z coordinates.");
    }
    return { x: Number(value.x), z: Number(value.z) };
  };
  const width = legacyDimension(source.width, "legacyMap.width");
  const height = legacyDimension(source.height, "legacyMap.height");
  const cellCount = width * height;
  if (!Array.isArray(source.cells) || source.cells.length !== cellCount) {
    fail("legacyMap.cells", "grid-length", `Must contain exactly ${cellCount} entries.`);
  }
  const structureCells = source.cells.map((value, index) => {
    if (value !== 0 && value !== 1) {
      fail(`legacyMap.cells[${index}]`, "legacy-tile", "Must be 0 (floor) or 1 (wall).");
    }
    return value;
  });
  const playerSpawn = legacyPoint(source.playerSpawn, "legacyMap.playerSpawn");
  if (version === MAP_VERSION && source.entities !== undefined) {
    fail("legacyMap.entities", "unexpected", "Map-v1 data cannot contain scenario entities.");
  }
  if (version !== MAP_VERSION && !Array.isArray(source.entities)) {
    fail("legacyMap.entities", "array", "Scenario data must contain an entity array.");
  }

  const entities = version === MAP_VERSION ? [] : source.entities;
  const instances = [];
  let obelisk;
  let rockOrdinal = 1;
  for (let index = 0; index < entities.length; index += 1) {
    const path = `legacyMap.entities[${index}]`;
    const entity = entities[index];
    if (!isRecord(entity)) fail(path, "object", "Entity must be an object.");
    const x = Number(entity.x);
    const z = Number(entity.z);
    if (!Number.isFinite(x) || !Number.isFinite(z)) fail(path, "finite-point", "Entity X/Z must be finite.");
    if (entity.kind === "rock") {
      const definitionId = rockDefinitionId(String(entity.archetype));
      if (!definitionId) fail(`${path}.archetype`, "unknown-rock", `Unknown rock archetype "${String(entity.archetype)}".`);
      const authoringId = entity.authoringId === undefined
        ? `legacy-rock-${String(rockOrdinal).padStart(4, "0")}`
        : String(entity.authoringId);
      if (!authoringId) fail(`${path}.authoringId`, "non-empty-string", "Authoring ID must be non-empty.");
      rockOrdinal += 1;
      instances.push({ id: authoringId, definitionId, x, z, rotation: 0 });
    } else if (version === SCENARIO_VERSION && entity.kind === "obelisk") {
      if (obelisk) fail(path, "multiple-obelisks", "Scenario may contain at most one obelisk.");
      obelisk = { x, z };
    } else {
      fail(`${path}.kind`, "unknown-entity", `Unknown legacy scenario entity kind "${String(entity.kind)}".`);
    }
  }

  return validateAuthoringMap({
    format: AUTHORING_MAP_FORMAT,
    version: AUTHORING_MAP_VERSION,
    metadata: {
      id: metadata.id ?? embeddedMetadata?.id ?? "legacy-map",
      name: metadata.name ?? embeddedMetadata?.name ?? "Migrated legacy map",
    },
    nextLayerOrdinal: 2,
    playerStart: { layerId: DEFAULT_LAYER_ID, ...playerSpawn },
    layers: [{
      id: DEFAULT_LAYER_ID,
      name: "Ground",
      baseY: 0,
      width,
      height,
      surface: {
        legend: [DEFAULT_SURFACE_DEFINITION_ID],
        cells: new Array(cellCount).fill(0),
      },
      structure: {
        legend: [null, DEFAULT_WALL_DEFINITION_ID],
        cells: structureCells,
      },
      instances,
      markers: { ...(obelisk ? { obelisk } : {}) },
      nextInstanceOrdinal: instances.length + 1,
    }],
  });
}

/** @param {string | unknown} input */
export function loadAuthoringMap(input) {
  let value = input;
  if (typeof input === "string") {
    try {
      value = JSON.parse(input);
    } catch (error) {
      throw new AuthoringMapValidationError([{
        severity: "error",
        path: "json",
        code: "parse-error",
        message: `Map JSON could not be parsed: ${error instanceof Error ? error.message : String(error)}`,
      }]);
    }
  }
  if (!isAuthoringMapDocument(value)) return migrateLegacyMap(value);
  const version = /** @type {Record<string,any>} */ (value).version;
  if (version === AUTHORING_MAP_VERSION) return validateAuthoringMap(value);
  if (version === LEGACY_AUTHORING_MAP_VERSION) return migrateAuthoringMapV1(value);
  const future = Number.isInteger(version) && version > AUTHORING_MAP_VERSION;
  throw new AuthoringMapValidationError([{
    severity: "error",
    path: "version",
    code: future ? "unknown-future-schema" : "unsupported-schema-version",
    message: `Unsupported authoring-map version ${String(version)}.`,
  }]);
}

/** @param {unknown} document */
export function cloneAuthoringMap(document) {
  return validateAuthoringMap(document);
}

/**
 * Creates authoring source data for callers that still construct scenarios
 * from the compact runtime map and legacy entity descriptors.
 * @param {{width:number,height:number,cells:Uint8Array|number[],playerSpawn:{x:number,z:number}}} map
 * @param {Array<Record<string, any>>} entities
 * @param {{id?:string,name?:string}} [metadata]
 */
export function authoringMapFromRuntime(map, entities = [], metadata = {}) {
  return migrateLegacyMap({
    version: SCENARIO_VERSION,
    width: map.width,
    height: map.height,
    cells: Array.from(map.cells),
    playerSpawn: { ...map.playerSpawn },
    entities: entities.map((entity) => ({ ...entity })),
  }, metadata);
}
