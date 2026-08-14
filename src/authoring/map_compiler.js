// @ts-check

import { PLAYER, ROCK } from "../config.js";
import { firstSolidContact } from "../sim/collision.js";
import { GridMap } from "../sim/grid_map.js";
import {
  AuthoringMapValidationError,
  validateAuthoringMap,
} from "./authoring_map.js";
import {
  getPlaceableDefinition,
  isDynamicBodyDefinition,
  isDynamicBoxDefinition,
} from "./definition_catalog.js";
import { getOccupiedCells, getRuntimeBodyTransform } from "./footprint.js";
import { validateInstancePlacement } from "./placement_validation.js";

/** @param {string} path @param {string} code @param {string} message */
function fail(path, code, message) {
  throw new AuthoringMapValidationError([{ path, code, message }]);
}

/** @param {string} value */
function stableUint32(value) {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0 || 1;
}

/** @param {string[]} ids */
function stableSpawnIds(ids) {
  const result = new Map();
  const used = new Set();
  for (const id of [...ids].sort((left, right) => (
    left < right ? -1 : left > right ? 1 : 0
  ))) {
    let candidate = stableUint32(id);
    while (used.has(candidate)) candidate = (candidate + 1) >>> 0 || 1;
    used.add(candidate);
    result.set(id, candidate);
  }
  return result;
}

/** @param {Record<string, unknown>} value */
function cloneProperties(value) {
  return JSON.parse(JSON.stringify(value));
}

/**
 * Deterministically derives the runtime grid and spawn descriptors from
 * friendly authoring source. The returned typed arrays never alias the source.
 * @param {unknown} input
 */
export function compileAuthoringMap(input) {
  const document = validateAuthoringMap(input);
  const layerIndex = document.layers.findIndex((layer) => layer.id === document.activeLayerId);
  const layer = document.layers[layerIndex];
  const layerPath = `layers[${layerIndex}]`;
  const cellCount = layer.width * layer.height;
  const solidCells = new Uint8Array(cellCount);
  const occluderCells = new Uint8Array(cellCount);
  const structureSolidCells = new Uint8Array(cellCount);
  const surfaceCodes = Uint16Array.from(layer.surface.cells);
  const structureCodes = Uint16Array.from(layer.structure.cells);
  const authoredDynamicBodyCount = layer.instances.reduce((count, instance) => {
    const definition = getPlaceableDefinition(instance.definitionId);
    return count + (isDynamicBodyDefinition(definition) ? 1 : 0);
  }, 0);
  if (authoredDynamicBodyCount > ROCK.capacity) {
    fail(
      `${layerPath}.instances`,
      "rock_capacity",
      `contains more than the ${ROCK.capacity}-rock limit shared with dynamic authored props`,
    );
  }

  for (let index = 0; index < cellCount; index += 1) {
    const definitionId = layer.structure.legend[structureCodes[index]];
    if (!definitionId) continue;
    const definition = getPlaceableDefinition(definitionId);
    if (!definition) {
      fail(`${layerPath}.structure.cells[${index}]`, "unknown_definition", `Unknown definition "${definitionId}"`);
    }
    if (definition.traits.blocksMovement) {
      solidCells[index] = 1;
      structureSolidCells[index] = 1;
    }
    if (definition.traits.blocksSight) occluderCells[index] = 1;
  }

  const collisionCellsByInstance = new Map();
  for (let index = 0; index < layer.instances.length; index += 1) {
    const instance = layer.instances[index];
    const instancePath = `${layerPath}.instances[${index}]`;
    const definition = getPlaceableDefinition(instance.definitionId);
    if (!definition) {
      fail(`${instancePath}.definitionId`, "unknown_definition", `Unknown definition "${instance.definitionId}"`);
    }
    const placement = validateInstancePlacement(document, instance.definitionId, instance, {
      layerId: layer.id,
      ignoreInstanceId: instance.id,
    });
    if (!placement.valid) {
      fail(instancePath, placement.code, placement.message);
    }
    const footprintCells = getOccupiedCells(definition, instance);
    if (isDynamicBodyDefinition(definition)) continue;
    collisionCellsByInstance.set(instance.id, footprintCells);
    if (definition.traits.blocksMovement || definition.traits.blocksSight) {
      for (const cell of footprintCells) {
        const cellIndex = cell.cz * layer.width + cell.cx;
        if (definition.traits.blocksMovement) solidCells[cellIndex] = 1;
        if (definition.traits.blocksSight) occluderCells[cellIndex] = 1;
      }
    }
  }

  const playerSpawn = layer.markers.playerSpawn;
  const map = new GridMap(layer.width, layer.height, solidCells, playerSpawn);
  const contact = { nx: 0, nz: 0, penetration: 0, px: 0, pz: 0, cx: 0, cz: 0 };
  if (firstSolidContact(map, playerSpawn.x, playerSpawn.z, PLAYER.radius, contact)) {
    fail(`${layerPath}.markers.playerSpawn`, "solid_overlap", "Player spawn is inside solid geometry");
  }

  if (layer.markers.obelisk) {
    const obelisk = layer.markers.obelisk;
    if (
      !Number.isFinite(obelisk.x)
      || !Number.isFinite(obelisk.z)
      || obelisk.x !== Math.floor(obelisk.x) + 0.5
      || obelisk.z !== Math.floor(obelisk.z) + 0.5
    ) {
      fail(`${layerPath}.markers.obelisk`, "cell_center", "Obelisk position must be cell-centered");
    }
    const cx = Math.floor(obelisk.x);
    const cz = Math.floor(obelisk.z);
    if (
      cx < 0
      || cz < 0
      || cx >= layer.width
      || cz >= layer.height
      || structureSolidCells[cz * layer.width + cx] !== 1
    ) {
      fail(`${layerPath}.markers.obelisk`, "solid_cell", "Obelisk must occupy a solid structure cell");
    }
  }

  const dynamicInstances = [];
  for (let index = 0; index < layer.instances.length; index += 1) {
    const instance = layer.instances[index];
    const definition = getPlaceableDefinition(instance.definitionId);
    if (!isDynamicBodyDefinition(definition)) continue;
    const runtimeTransform = getRuntimeBodyTransform(definition, instance);
    const isBox = isDynamicBoxDefinition(definition);
    dynamicInstances.push({
      id: instance.id,
      definitionId: instance.definitionId,
      runtimeKind: String(definition.traits.runtimeKind),
      ...(definition.traits.runtimeKind === "rock"
        ? { archetype: String(definition.traits.rockArchetype) }
        : {}),
      x: runtimeTransform.x,
      z: runtimeTransform.z,
      rotation: runtimeTransform.rotation,
      collider: isBox ? "box" : "circle",
      radius: isBox ? 0 : Number(definition.traits.radius),
      halfWidth: isBox ? Number(definition.traits.halfWidth) : 0,
      halfDepth: isBox ? Number(definition.traits.halfDepth) : 0,
      fixedRotation: isBox && definition.traits.fixedRotation === true,
      massKg: Number(definition.traits.massKg),
    });
  }
  const spawnIds = stableSpawnIds([
    ...layer.instances.map((instance) => instance.id),
    ...(layer.markers.obelisk ? ["marker.obelisk"] : []),
  ]);
  const entities = dynamicInstances.map((instance) => ({
    kind: instance.runtimeKind === "rock"
      ? /** @type {const} */ ("rock")
      : /** @type {const} */ ("dynamicInstance"),
    definitionId: instance.definitionId,
    ...(instance.runtimeKind === "rock" ? { archetype: instance.archetype } : {}),
    x: instance.x,
    z: instance.z,
    rotation: instance.rotation,
    collider: instance.collider,
    radius: instance.radius,
    halfWidth: instance.halfWidth,
    halfDepth: instance.halfDepth,
    fixedRotation: instance.fixedRotation,
    massKg: instance.massKg,
    spawnId: spawnIds.get(instance.id),
    authoringId: instance.id,
  }));
  if (layer.markers.obelisk) {
    entities.push({
      kind: /** @type {const} */ ("obelisk"),
      x: layer.markers.obelisk.x,
      z: layer.markers.obelisk.z,
      spawnId: spawnIds.get("marker.obelisk"),
      authoringId: "marker.obelisk",
    });
  }

  const runtimeMappings = layer.instances.map((instance) => {
    const definition = getPlaceableDefinition(instance.definitionId);
    return {
      authoringId: instance.id,
      definitionId: instance.definitionId,
      runtimeKind: definition?.traits.runtimeKind ?? "unknown",
      runtimeSpawnId: isDynamicBodyDefinition(definition)
        ? spawnIds.get(instance.id)
        : null,
      collisionCells: (collisionCellsByInstance.get(instance.id) ?? []).map((cell) => ({ ...cell })),
    };
  });

  return {
    document,
    activeLayer: {
      id: layer.id,
      name: layer.name,
      baseY: layer.baseY,
      width: layer.width,
      height: layer.height,
    },
    map,
    surface: {
      legend: [...layer.surface.legend],
      cells: surfaceCodes,
    },
    structure: {
      legend: [...layer.structure.legend],
      cells: structureCodes,
    },
    solidMask: new Uint8Array(solidCells),
    occluderMask: new Uint8Array(occluderCells),
    instances: layer.instances.map((instance) => ({
      ...instance,
      ...(instance.properties ? { properties: cloneProperties(instance.properties) } : {}),
    })),
    entities,
    runtimeMappings,
  };
}
