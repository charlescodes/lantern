// @ts-check

import { MAP_VERSION, SCENARIO_VERSION } from "../config.js";
import {
  getPlaceableDefinition,
  rockDefinitionId,
} from "./definition_catalog.js";

export const AUTHORING_MAP_FORMAT = "lantern-authoring-map";
export const AUTHORING_MAP_VERSION = 1;
export const DEFAULT_LAYER_ID = "ground";
export const DEFAULT_SURFACE_DEFINITION_ID = "surface.stone";
export const DEFAULT_WALL_DEFINITION_ID = "structure.wall";

export class AuthoringMapValidationError extends RangeError {
  /** @param {Array<{path:string,code:string,message:string}>} issues */
  constructor(issues) {
    super(`Invalid authoring map: ${issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ")}`);
    this.name = "AuthoringMapValidationError";
    this.issues = issues.map((issue) => ({ ...issue }));
  }
}

/** @param {string} path @param {string} code @param {string} message */
function fail(path, code, message) {
  throw new AuthoringMapValidationError([{ path, code, message }]);
}

/** @param {unknown} value @param {string} path */
function recordAt(value, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(path, "object", "must be an object");
  }
  return /** @type {Record<string, any>} */ (value);
}

/** @param {unknown} value @param {string} path */
function nonEmptyString(value, path) {
  if (typeof value !== "string" || value.trim().length === 0) {
    fail(path, "non_empty_string", "must be a non-empty string");
  }
  if (value.length > 128) fail(path, "maximum_length", "must be at most 128 characters");
  return value;
}

/** @param {unknown} value @param {string} path */
function finiteNumber(value, path) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail(path, "finite_number", "must be a finite number");
  }
  return value;
}

/** @param {unknown} value @param {string} path */
function dimension(value, path) {
  if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > 256) {
    fail(path, "dimension", "must be an integer from 1 to 256");
  }
  return Number(value);
}

/** @param {unknown} value @param {string} path */
function cloneJsonValue(value, path = "value") {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail(path, "finite_number", "must contain only finite numbers");
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => cloneJsonValue(item, `${path}[${index}]`));
  }
  if (value && typeof value === "object") {
    const clone = {};
    for (const [key, item] of Object.entries(value)) {
      if (item === undefined || typeof item === "function" || typeof item === "symbol") {
        fail(`${path}.${key}`, "json_value", "must be JSON-serializable");
      }
      clone[key] = cloneJsonValue(item, `${path}.${key}`);
    }
    return clone;
  }
  fail(path, "json_value", "must be JSON-serializable");
}

/** @param {unknown} value @param {string} path */
function point(value, path) {
  const source = recordAt(value, path);
  return {
    x: finiteNumber(source.x, `${path}.x`),
    z: finiteNumber(source.z, `${path}.z`),
  };
}

/**
 * Validates and returns a detached, normalized authoring document.
 * @param {unknown} input
 */
export function validateAuthoringMap(input) {
  const source = recordAt(input, "map");
  if (source.format !== AUTHORING_MAP_FORMAT) {
    fail("format", "format", `must equal "${AUTHORING_MAP_FORMAT}"`);
  }
  if (source.version !== AUTHORING_MAP_VERSION) {
    fail("version", "unsupported_version", `unsupported authoring-map version ${String(source.version)}`);
  }
  const metadataSource = recordAt(source.metadata, "metadata");
  const metadata = /** @type {Record<string, any>} */ (
    cloneJsonValue(metadataSource, "metadata")
  );
  metadata.id = nonEmptyString(metadataSource.id, "metadata.id");
  metadata.name = nonEmptyString(metadataSource.name, "metadata.name");
  const activeLayerId = nonEmptyString(source.activeLayerId, "activeLayerId");
  if (!Array.isArray(source.layers) || source.layers.length === 0) {
    fail("layers", "non_empty_array", "must contain at least one named simulation layer");
  }

  const layerIds = new Set();
  const instanceIds = new Set();
  const layers = source.layers.map((layerValue, layerIndex) => {
    const path = `layers[${layerIndex}]`;
    const layerSource = recordAt(layerValue, path);
    const id = nonEmptyString(layerSource.id, `${path}.id`);
    if (layerIds.has(id)) fail(`${path}.id`, "duplicate", `duplicates layer ID "${id}"`);
    layerIds.add(id);
    const name = nonEmptyString(layerSource.name, `${path}.name`);
    const baseY = finiteNumber(layerSource.baseY, `${path}.baseY`);
    const width = dimension(layerSource.width, `${path}.width`);
    const height = dimension(layerSource.height, `${path}.height`);
    const cellCount = width * height;

    const surfaceSource = recordAt(layerSource.surface, `${path}.surface`);
    if (!Array.isArray(surfaceSource.legend) || surfaceSource.legend.length === 0) {
      fail(`${path}.surface.legend`, "non_empty_array", "must contain at least one surface definition ID");
    }
    const surfaceLegend = surfaceSource.legend.map((value, index) => {
      const definitionId = nonEmptyString(value, `${path}.surface.legend[${index}]`);
      const definition = getPlaceableDefinition(definitionId);
      if (!definition) {
        fail(`${path}.surface.legend[${index}]`, "unknown_definition", `Unknown definition "${definitionId}"`);
      }
      if (definition.placementTarget !== "surface") {
        fail(`${path}.surface.legend[${index}]`, "definition_target", `definition "${definitionId}" is not a surface`);
      }
      return definitionId;
    });
    if (new Set(surfaceLegend).size !== surfaceLegend.length) {
      fail(`${path}.surface.legend`, "duplicate", "must not contain duplicate definition IDs");
    }
    if (!Array.isArray(surfaceSource.cells) || surfaceSource.cells.length !== cellCount) {
      fail(`${path}.surface.cells`, "cell_count", `must contain exactly ${cellCount} entries`);
    }
    const surfaceCells = surfaceSource.cells.map((value, index) => {
      if (!Number.isInteger(value) || value < 0 || value >= surfaceLegend.length) {
        fail(`${path}.surface.cells[${index}]`, "legend_index", "must reference a surface legend entry");
      }
      return Number(value);
    });

    const structureSource = recordAt(layerSource.structure, `${path}.structure`);
    if (
      !Array.isArray(structureSource.legend)
      || structureSource.legend.length === 0
      || structureSource.legend[0] !== null
    ) {
      fail(`${path}.structure.legend`, "empty_slot", "must begin with null for an empty structure cell");
    }
    const structureLegend = structureSource.legend.map((value, index) => {
      if (index === 0) return null;
      const definitionId = nonEmptyString(value, `${path}.structure.legend[${index}]`);
      const definition = getPlaceableDefinition(definitionId);
      if (!definition) {
        fail(`${path}.structure.legend[${index}]`, "unknown_definition", `Unknown definition "${definitionId}"`);
      }
      if (definition.placementTarget !== "structure") {
        fail(`${path}.structure.legend[${index}]`, "definition_target", `definition "${definitionId}" is not a structure`);
      }
      return definitionId;
    });
    const populatedStructureIds = structureLegend.slice(1);
    if (new Set(populatedStructureIds).size !== populatedStructureIds.length) {
      fail(`${path}.structure.legend`, "duplicate", "must not contain duplicate definition IDs");
    }
    if (!Array.isArray(structureSource.cells) || structureSource.cells.length !== cellCount) {
      fail(`${path}.structure.cells`, "cell_count", `must contain exactly ${cellCount} entries`);
    }
    const structureCells = structureSource.cells.map((value, index) => {
      if (!Number.isInteger(value) || value < 0 || value >= structureLegend.length) {
        fail(`${path}.structure.cells[${index}]`, "legend_index", "must reference a structure legend entry");
      }
      return Number(value);
    });

    if (!Array.isArray(layerSource.instances)) {
      fail(`${path}.instances`, "array", "must be an array");
    }
    const instances = layerSource.instances.map((instanceValue, instanceIndex) => {
      const instancePath = `${path}.instances[${instanceIndex}]`;
      const instanceSource = recordAt(instanceValue, instancePath);
      const instanceId = nonEmptyString(instanceSource.id, `${instancePath}.id`);
      if (instanceIds.has(instanceId)) {
        fail(`${instancePath}.id`, "duplicate", `duplicates authoring instance ID "${instanceId}"`);
      }
      instanceIds.add(instanceId);
      const definitionId = nonEmptyString(instanceSource.definitionId, `${instancePath}.definitionId`);
      const definition = getPlaceableDefinition(definitionId);
      if (!definition) {
        fail(`${instancePath}.definitionId`, "unknown_definition", `Unknown definition "${definitionId}"`);
      }
      if (definition.placementTarget !== "instance") {
        fail(`${instancePath}.definitionId`, "definition_target", `definition "${definitionId}" is not a sparse instance`);
      }
      if (!Number.isInteger(instanceSource.rotation) || instanceSource.rotation < 0 || instanceSource.rotation > 3) {
        fail(`${instancePath}.rotation`, "quarter_turn", "must be a quarter turn from 0 to 3");
      }
      const properties = instanceSource.properties === undefined
        ? undefined
        : cloneJsonValue(recordAt(instanceSource.properties, `${instancePath}.properties`), `${instancePath}.properties`);
      return {
        id: instanceId,
        definitionId,
        x: finiteNumber(instanceSource.x, `${instancePath}.x`),
        z: finiteNumber(instanceSource.z, `${instancePath}.z`),
        rotation: Number(instanceSource.rotation),
        ...(properties === undefined ? {} : { properties }),
      };
    });

    const markersSource = recordAt(layerSource.markers, `${path}.markers`);
    const markers = {
      playerSpawn: point(markersSource.playerSpawn, `${path}.markers.playerSpawn`),
      ...(markersSource.obelisk === undefined
        ? {}
        : { obelisk: point(markersSource.obelisk, `${path}.markers.obelisk`) }),
    };
    if (!Number.isInteger(layerSource.nextInstanceOrdinal) || layerSource.nextInstanceOrdinal < 1) {
      fail(`${path}.nextInstanceOrdinal`, "positive_integer", "must be a positive integer");
    }

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
      nextInstanceOrdinal: Number(layerSource.nextInstanceOrdinal),
    };
  });
  if (!layerIds.has(activeLayerId)) {
    fail("activeLayerId", "unknown_layer", `does not match a layer ID: "${activeLayerId}"`);
  }
  return {
    format: AUTHORING_MAP_FORMAT,
    version: AUTHORING_MAP_VERSION,
    metadata,
    activeLayerId,
    layers,
  };
}

/** @param {unknown} input */
export function isAuthoringMapDocument(input) {
  return Boolean(
    input
    && typeof input === "object"
    && !Array.isArray(input)
    && /** @type {Record<string, unknown>} */ (input).format === AUTHORING_MAP_FORMAT,
  );
}

/**
 * Explicitly migrates map-v1 and scenario-v2/v3 data into the authoring format.
 * @param {unknown} input
 * @param {{id?:string,name?:string}} [metadata]
 */
export function migrateLegacyMap(input, metadata = {}) {
  const source = recordAt(input, "legacyMap");
  const embeddedMetadata = source.authoringMetadata === undefined
    ? null
    : recordAt(source.authoringMetadata, "legacyMap.authoringMetadata");
  const version = source.version;
  if (version !== MAP_VERSION && version !== 2 && version !== SCENARIO_VERSION) {
    fail("legacyMap.version", "unsupported_version", `unsupported legacy map/scenario version ${String(source.version)}`);
  }
  const width = dimension(source.width, "legacyMap.width");
  const height = dimension(source.height, "legacyMap.height");
  const cellCount = width * height;
  if (!Array.isArray(source.cells) || source.cells.length !== cellCount) {
    fail("legacyMap.cells", "cell_count", `must contain exactly ${cellCount} entries`);
  }
  const structureCells = source.cells.map((value, index) => {
    if (value !== 0 && value !== 1) {
      fail(`legacyMap.cells[${index}]`, "legacy_tile", "must be 0 (floor) or 1 (wall)");
    }
    return value;
  });
  const playerSpawn = point(source.playerSpawn, "legacyMap.playerSpawn");
  if (version === MAP_VERSION && source.entities !== undefined) {
    fail("legacyMap.entities", "unexpected", "map-v1 data cannot contain scenario entities");
  }
  if (version !== MAP_VERSION && !Array.isArray(source.entities)) {
    fail("legacyMap.entities", "array", "scenario data must contain an entity array");
  }

  const entities = version === MAP_VERSION ? [] : source.entities;
  const instances = [];
  let obelisk;
  let rockOrdinal = 1;
  for (let index = 0; index < entities.length; index += 1) {
    const entityPath = `legacyMap.entities[${index}]`;
    const entity = recordAt(entities[index], entityPath);
    const x = finiteNumber(entity.x, `${entityPath}.x`);
    const z = finiteNumber(entity.z, `${entityPath}.z`);
    if (entity.kind === "rock") {
      const definitionId = rockDefinitionId(String(entity.archetype));
      if (!definitionId) fail(`${entityPath}.archetype`, "unknown_rock", `unknown rock archetype "${String(entity.archetype)}"`);
      const authoringId = entity.authoringId === undefined
        ? `legacy-rock-${String(rockOrdinal).padStart(4, "0")}`
        : nonEmptyString(entity.authoringId, `${entityPath}.authoringId`);
      rockOrdinal += 1;
      instances.push({
        id: authoringId,
        definitionId,
        x,
        z,
        rotation: 0,
      });
      continue;
    }
    if (version === SCENARIO_VERSION && entity.kind === "obelisk") {
      if (obelisk) fail(entityPath, "multiple_obelisks", "scenario may contain at most one obelisk");
      obelisk = { x, z };
      continue;
    }
    fail(`${entityPath}.kind`, "unknown_entity", `unknown legacy scenario entity kind "${String(entity.kind)}"`);
  }

  return validateAuthoringMap({
    format: AUTHORING_MAP_FORMAT,
    version: AUTHORING_MAP_VERSION,
    metadata: {
      id: metadata.id
        ?? embeddedMetadata?.id
        ?? "legacy-map",
      name: metadata.name
        ?? embeddedMetadata?.name
        ?? "Migrated legacy map",
    },
    activeLayerId: DEFAULT_LAYER_ID,
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
      markers: {
        playerSpawn,
        ...(obelisk ? { obelisk } : {}),
      },
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
      throw new TypeError(
        `Map JSON could not be parsed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return isAuthoringMapDocument(value)
    ? validateAuthoringMap(value)
    : migrateLegacyMap(value);
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
