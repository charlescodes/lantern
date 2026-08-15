// @ts-check

import { PLAYER } from "../config.js";
import { circleCellContact, firstSolidContact } from "../sim/collision.js";
import {
  getPlaceableDefinition,
  isDynamicBodyDefinition,
  isDynamicCircleDefinition,
} from "./definition_catalog.js";
import {
  footprintCellKey,
  getOccupiedCells,
  normalizeQuarterTurns,
} from "./footprint.js";

const CONTACT = { nx: 0, nz: 0, penetration: 0, px: 0, pz: 0, cx: 0, cz: 0 };

/** @param {Record<string, any>} document @param {string|undefined} layerId */
export function getAuthoringLayer(document, layerId) {
  const requestedId = layerId ?? document.playerStart?.layerId;
  return document.layers?.find((layer) => layer.id === requestedId) ?? null;
}

/**
 * @param {string} code
 * @param {string} message
 * @param {string} layerId
 * @param {string} definitionId
 * @param {{x:number,z:number,rotation:number}} transform
 * @param {Array<{cx:number,cz:number}>} occupiedCells
 */
function invalid(code, message, layerId, definitionId, transform, occupiedCells) {
  return { valid: false, code, message, layerId, definitionId, transform, occupiedCells };
}

/** @param {number} x @param {number} z @param {number} radius @param {Array<{cx:number,cz:number}>} cells */
export function circleTouchesFootprint(x, z, radius, cells) {
  for (const cell of cells) {
    if (circleCellContact(x, z, radius, cell.cx, cell.cz, CONTACT)) return true;
  }
  return false;
}

/**
 * Lightweight authoring-space validation used by previews and compilation.
 * It never compiles a runtime map and never mutates the document.
 *
 * @param {Record<string, any>} document
 * @param {string} definitionId
 * @param {{x:number,z:number,rotation?:number}} candidate
 * @param {{layerId?:string,ignoreInstanceId?:string}} [options]
 */
export function validateInstancePlacement(document, definitionId, candidate, options = {}) {
  const definition = getPlaceableDefinition(definitionId);
  const numericX = Number(candidate.x);
  const numericZ = Number(candidate.z);
  let rotation = 0;
  try {
    rotation = normalizeQuarterTurns(candidate.rotation ?? 0);
  } catch (error) {
    const transform = { x: numericX, z: numericZ, rotation: Number(candidate.rotation) };
    return invalid(
      "rotation",
      error instanceof Error ? error.message : String(error),
      options.layerId ?? document.playerStart?.layerId ?? "",
      definitionId,
      transform,
      [],
    );
  }
  const transform = { x: numericX, z: numericZ, rotation };
  const layer = getAuthoringLayer(document, options.layerId);
  const layerId = layer?.id ?? options.layerId ?? document.playerStart?.layerId ?? "";
  if (!definition || definition.placementTarget !== "instance") {
    return invalid(
      "unknown_definition",
      `Unknown sparse-instance definition "${definitionId}"`,
      layerId,
      definitionId,
      transform,
      [],
    );
  }
  if (!layer) {
    return invalid("unknown_layer", `Unknown authoring layer "${layerId}"`, layerId, definitionId, transform, []);
  }
  if (!Number.isFinite(numericX) || !Number.isFinite(numericZ)) {
    return invalid("position", "Instance X/Z must be finite numbers", layerId, definitionId, transform, []);
  }
  if (
    definition.traits.snap === "cell-center"
    && (
      numericX !== Math.floor(numericX) + 0.5
      || numericZ !== Math.floor(numericZ) + 0.5
    )
  ) {
    return invalid(
      "cell_center",
      `Definition "${definitionId}" must be placed at a cell center`,
      layerId,
      definitionId,
      transform,
      [],
    );
  }

  const occupiedCells = getOccupiedCells(definition, transform);
  for (const cell of occupiedCells) {
    if (cell.cx < 0 || cell.cz < 0 || cell.cx >= layer.width || cell.cz >= layer.height) {
      return invalid(
        "out_of_bounds",
        `Footprint cell (${cell.cx}, ${cell.cz}) is outside layer "${layer.id}"`,
        layerId,
        definitionId,
        transform,
        occupiedCells,
      );
    }
  }

  const structureCells = new Set();
  const blockingCells = new Set();
  for (let index = 0; index < layer.structure.cells.length; index += 1) {
    const code = layer.structure.cells[index];
    if (code === 0) continue;
    const cell = { cx: index % layer.width, cz: Math.floor(index / layer.width) };
    structureCells.add(footprintCellKey(cell));
    const structureDefinition = getPlaceableDefinition(layer.structure.legend[code]);
    if (structureDefinition?.traits.blocksMovement) blockingCells.add(footprintCellKey(cell));
  }

  const candidateIsDynamicCircle = isDynamicCircleDefinition(definition);
  const candidateRadius = Number(definition.traits.radius ?? 0);
  for (const instance of layer.instances) {
    if (instance.id === options.ignoreInstanceId) continue;
    const otherDefinition = getPlaceableDefinition(instance.definitionId);
    if (!otherDefinition) continue;
    const otherCells = getOccupiedCells(otherDefinition, instance);
    const otherIsDynamicCircle = isDynamicCircleDefinition(otherDefinition);
    if (!isDynamicBodyDefinition(otherDefinition) && otherDefinition.traits.blocksMovement) {
      for (const cell of otherCells) blockingCells.add(footprintCellKey(cell));
    }
    if (candidateIsDynamicCircle && otherIsDynamicCircle) {
      const otherRadius = Number(otherDefinition.traits.radius);
      if (Math.hypot(numericX - instance.x, numericZ - instance.z) < candidateRadius + otherRadius) {
        return invalid(
          "instance_overlap",
          `Placement overlaps authoring instance "${instance.id}"`,
          layerId,
          definitionId,
          transform,
          occupiedCells,
        );
      }
    } else if (candidateIsDynamicCircle) {
      if (circleTouchesFootprint(numericX, numericZ, candidateRadius, otherCells)) {
        return invalid(
          "instance_overlap",
          `Placement overlaps authoring instance "${instance.id}"`,
          layerId,
          definitionId,
          transform,
          occupiedCells,
        );
      }
    } else if (otherIsDynamicCircle) {
      if (circleTouchesFootprint(instance.x, instance.z, Number(otherDefinition.traits.radius), occupiedCells)) {
        return invalid(
          "instance_overlap",
          `Placement overlaps authoring instance "${instance.id}"`,
          layerId,
          definitionId,
          transform,
          occupiedCells,
        );
      }
    } else {
      const otherKeys = new Set(otherCells.map(footprintCellKey));
      if (occupiedCells.some((cell) => otherKeys.has(footprintCellKey(cell)))) {
        return invalid(
          "instance_overlap",
          `Placement overlaps authoring instance "${instance.id}"`,
          layerId,
          definitionId,
          transform,
          occupiedCells,
        );
      }
    }
  }

  if (candidateIsDynamicCircle) {
    const sourceMap = {
      get(cx, cz) {
        if (cx < 0 || cz < 0 || cx >= layer.width || cz >= layer.height) return 1;
        return blockingCells.has(`${cx}:${cz}`) ? 1 : 0;
      },
    };
    if (firstSolidContact(sourceMap, numericX, numericZ, candidateRadius, CONTACT)) {
      return invalid(
        "solid_overlap",
        "Dynamic instance is inside solid geometry",
        layerId,
        definitionId,
        transform,
        occupiedCells,
      );
    }
  } else if (occupiedCells.some((cell) => structureCells.has(footprintCellKey(cell)))) {
    return invalid(
      "structure_overlap",
      "Placement overlaps a structure cell",
      layerId,
      definitionId,
      transform,
      occupiedCells,
    );
  }

  if (definition.traits.blocksMovement && document.playerStart?.layerId === layer.id) {
    const spawn = document.playerStart;
    const overlapsSpawn = candidateIsDynamicCircle
      ? Math.hypot(numericX - spawn.x, numericZ - spawn.z) < candidateRadius + PLAYER.radius
      : circleTouchesFootprint(spawn.x, spawn.z, PLAYER.radius, occupiedCells);
    if (overlapsSpawn) {
      return invalid(
        "player_overlap",
        "Placement overlaps the player spawn",
        layerId,
        definitionId,
        transform,
        occupiedCells,
      );
    }
  }

  return {
    valid: true,
    code: "ok",
    message: "Placement is valid",
    layerId,
    definitionId,
    transform,
    occupiedCells,
  };
}
