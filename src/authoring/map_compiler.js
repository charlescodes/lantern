// @ts-check

import { PLAYER, ROCK } from "../config.js";
import { firstSolidContact } from "../sim/collision.js";
import { GridMap } from "../sim/grid_map.js";
import {
  AuthoringMapValidationError,
  validateAuthoringMap,
} from "./authoring_map.js";
import { getPlaceableDefinition } from "./definition_catalog.js";

/** @param {string} path @param {string} code @param {string} message */
function fail(path, code, message) {
  throw new AuthoringMapValidationError([{ path, code, message }]);
}

/** @param {number} value */
function cellCentered(value) {
  return Number.isFinite(value) && value === Math.floor(value) + 0.5;
}

/** @param {number} dx @param {number} dz @param {number} rotation */
function rotateOffset(dx, dz, rotation) {
  if (rotation === 1) return { x: -dz, z: dx };
  if (rotation === 2) return { x: -dx, z: -dz };
  if (rotation === 3) return { x: dz, z: -dx };
  return { x: dx, z: dz };
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
  const authoredRockCount = layer.instances.reduce((count, instance) => {
    const definition = getPlaceableDefinition(instance.definitionId);
    return count + (definition?.traits.runtimeKind === "rock" ? 1 : 0);
  }, 0);
  if (authoredRockCount > ROCK.capacity) {
    fail(`${layerPath}.instances`, "rock_capacity", `contains more than the ${ROCK.capacity}-rock limit`);
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

  const occupiedInstanceCells = new Map();
  const collisionCellsByInstance = new Map();
  const anchors = [];
  for (let index = 0; index < layer.instances.length; index += 1) {
    const instance = layer.instances[index];
    const instancePath = `${layerPath}.instances[${index}]`;
    const definition = getPlaceableDefinition(instance.definitionId);
    if (!definition) {
      fail(`${instancePath}.definitionId`, "unknown_definition", `Unknown definition "${instance.definitionId}"`);
    }
    if (definition.traits.runtimeKind === "rock") continue;
    if (definition.traits.snap === "cell-center" && (!cellCentered(instance.x) || !cellCentered(instance.z))) {
      fail(instancePath, "cell_center", `definition "${instance.definitionId}" must be placed at a cell center`);
    }
    const anchorX = Math.floor(instance.x);
    const anchorZ = Math.floor(instance.z);
    const footprintCells = [];
    for (const offset of definition.footprint.cells) {
      const rotated = rotateOffset(offset.x, offset.z, instance.rotation);
      const cx = anchorX + rotated.x;
      const cz = anchorZ + rotated.z;
      if (cx < 0 || cz < 0 || cx >= layer.width || cz >= layer.height) {
        fail(instancePath, "out_of_bounds", `footprint cell (${cx}, ${cz}) is outside the active layer`);
      }
      const cellIndex = cz * layer.width + cx;
      if (structureCodes[cellIndex] !== 0) {
        fail(instancePath, "structure_overlap", `footprint overlaps structure at (${cx}, ${cz})`);
      }
      const occupiedBy = occupiedInstanceCells.get(cellIndex);
      if (occupiedBy) {
        fail(instancePath, "instance_overlap", `footprint overlaps authoring instance "${occupiedBy}"`);
      }
      occupiedInstanceCells.set(cellIndex, instance.id);
      footprintCells.push({ cx, cz });
    }
    anchors.push({ id: instance.id, x: instance.x, z: instance.z });
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
    if (!cellCentered(obelisk.x) || !cellCentered(obelisk.z)) {
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

  const rockInstances = [];
  for (let index = 0; index < layer.instances.length; index += 1) {
    const instance = layer.instances[index];
    const definition = getPlaceableDefinition(instance.definitionId);
    if (definition?.traits.runtimeKind !== "rock") continue;
    const instancePath = `${layerPath}.instances[${index}]`;
    const radius = Number(definition.traits.radius);
    if (firstSolidContact(map, instance.x, instance.z, radius, contact)) {
      fail(instancePath, "solid_overlap", "Rock is inside solid geometry");
    }
    if (Math.hypot(instance.x - playerSpawn.x, instance.z - playerSpawn.z) < radius + PLAYER.radius) {
      fail(instancePath, "player_overlap", "Rock overlaps the player spawn");
    }
    for (const other of rockInstances) {
      if (Math.hypot(instance.x - other.x, instance.z - other.z) < radius + other.radius) {
        fail(instancePath, "rock_overlap", `Rock overlaps authoring instance "${other.id}"`);
      }
    }
    for (const anchor of anchors) {
      if (Math.hypot(instance.x - anchor.x, instance.z - anchor.z) < radius + 0.1) {
        fail(instancePath, "instance_overlap", `Rock overlaps authoring instance "${anchor.id}"`);
      }
    }
    rockInstances.push({
      id: instance.id,
      definitionId: instance.definitionId,
      archetype: String(definition.traits.rockArchetype),
      x: instance.x,
      z: instance.z,
      radius,
      massKg: Number(definition.traits.massKg),
    });
  }
  const spawnIds = stableSpawnIds([
    ...layer.instances.map((instance) => instance.id),
    ...(layer.markers.obelisk ? ["marker.obelisk"] : []),
  ]);
  const entities = rockInstances.map((rock) => ({
    kind: /** @type {const} */ ("rock"),
    archetype: rock.archetype,
    x: rock.x,
    z: rock.z,
    spawnId: spawnIds.get(rock.id),
    authoringId: rock.id,
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
      runtimeSpawnId: definition?.traits.runtimeKind === "rock"
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
