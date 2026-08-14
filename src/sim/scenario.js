// @ts-check

import {
  ROCK_ARCHETYPES,
  SCENARIO_VERSION,
} from "../config.js";
import {
  eraseSurface as eraseAuthoringSurface,
  eraseSurfaceCells as eraseAuthoringSurfaceCells,
  eraseStructure as eraseAuthoringStructure,
  eraseStructureCells as eraseAuthoringStructureCells,
  paintStructureCells as paintAuthoringStructureCells,
  paintStructure as paintAuthoringStructure,
  paintSurfaceCells as paintAuthoringSurfaceCells,
  paintSurface as paintAuthoringSurface,
  placeInstance as placeAuthoringInstance,
  removeInstance as removeAuthoringInstance,
  updateInstanceTransform as updateAuthoringInstanceTransform,
} from "../authoring/authoring_commands.js";
import {
  authoringMapFromRuntime,
  cloneAuthoringMap,
  isAuthoringMapDocument,
  loadAuthoringMap,
} from "../authoring/authoring_map.js";
import {
  getPlaceableDefinition,
  rockDefinitionId,
} from "../authoring/definition_catalog.js";
import { compileAuthoringMap } from "../authoring/map_compiler.js";
import { pointHitsInstanceExtent } from "../authoring/footprint.js";
import { validateInstancePlacement } from "../authoring/placement_validation.js";
import { createDebugArenaMap, GridMap } from "./grid_map.js";

/** @param {string} archetype */
export function getRockArchetype(archetype) {
  return Object.hasOwn(ROCK_ARCHETYPES, archetype) ? ROCK_ARCHETYPES[archetype] : null;
}

export class ArenaScenario {
  /**
   * @param {GridMap | Record<string, unknown>} map
   * @param {Array<{kind:"rock"|"dynamicInstance"|"obelisk",definitionId?:string,archetype?:string,x:number,z:number,spawnId?:number,authoringId?:string,radius?:number,massKg?:number}>} [entities]
   */
  constructor(map, entities = []) {
    const authoringMap = isAuthoringMapDocument(map)
      ? loadAuthoringMap(map)
      : authoringMapFromRuntime(
        /** @type {GridMap} */ (map),
        entities,
        { id: "arena", name: "Lantern arena" },
      );
    this.lastMutationError = null;
    this.#applyCompiled(compileAuthoringMap(authoringMap), true);
  }

  /** @param {ReturnType<typeof compileAuthoringMap>} compiled @param {boolean} initial */
  #applyCompiled(compiled, initial = false) {
    this.authoringMap = compiled.document;
    if (
      !initial
      && this.map
      && this.map.width === compiled.map.width
      && this.map.height === compiled.map.height
    ) {
      this.map.cells.set(compiled.map.cells);
      this.map.playerSpawn = { ...compiled.map.playerSpawn };
    } else {
      this.map = compiled.map;
    }
    this.activeLayer = { ...compiled.activeLayer };
    this.surface = {
      legend: [...compiled.surface.legend],
      cells: new Uint16Array(compiled.surface.cells),
    };
    this.structure = {
      legend: [...compiled.structure.legend],
      cells: new Uint16Array(compiled.structure.cells),
    };
    this.occluderMask = new Uint8Array(compiled.occluderMask);
    this.instances = compiled.instances.map((instance) => ({
      ...instance,
      ...(instance.properties ? { properties: { ...instance.properties } } : {}),
    }));
    this.runtimeMappings = compiled.runtimeMappings.map((mapping) => ({
      ...mapping,
      collisionCells: mapping.collisionCells.map((cell) => ({ ...cell })),
    }));
    this.entities = compiled.entities.map((entity) => ({ ...entity }));
    this.nextSpawnId = this.entities.reduce(
      (maximum, entity) => Math.max(maximum, Number(entity.spawnId) + 1),
      1,
    );
  }

  /** @param {unknown} nextDocument */
  #commit(nextDocument) {
    try {
      this.#applyCompiled(compileAuthoringMap(nextDocument));
      this.lastMutationError = null;
      return true;
    } catch (error) {
      this.lastMutationError = error instanceof Error ? error.message : String(error);
      return false;
    }
  }

  clone() {
    return new ArenaScenario(this.toAuthoringJSON());
  }

  /**
   * Legacy compiled scenario JSON remains the recording-schema-v11 boundary.
   * User saves use toAuthoringJSON() through Simulation.saveScenario().
   */
  toJSON() {
    return {
      version: SCENARIO_VERSION,
      authoringMetadata: { ...this.authoringMap.metadata },
      width: this.map.width,
      height: this.map.height,
      cells: Array.from(this.map.cells),
      playerSpawn: { ...this.map.playerSpawn },
      entities: this.entities
        .filter((entity) => entity.kind === "rock" || entity.kind === "obelisk")
        .map((entity) => ({
          kind: entity.kind,
          ...(entity.kind === "rock" ? { archetype: entity.archetype } : {}),
          x: entity.x,
          z: entity.z,
        })),
    };
  }

  toAuthoringJSON() {
    return cloneAuthoringMap(this.authoringMap);
  }

  /** @param {number} cx @param {number} cz @param {number} tile */
  setTile(cx, cz, tile) {
    return tile === 1
      ? this.paintStructure(cx, cz, "structure.wall")
      : this.eraseStructure(cx, cz);
  }

  /** @param {number} cx @param {number} cz @param {string} definitionId */
  paintSurface(cx, cz, definitionId) {
    try {
      return this.#commit(
        paintAuthoringSurface(this.authoringMap, cx, cz, definitionId),
      );
    } catch (error) {
      this.lastMutationError = error instanceof Error ? error.message : String(error);
      return false;
    }
  }

  /** @param {Array<{cx:number,cz:number}>} cells @param {string} definitionId */
  paintSurfaceCells(cells, definitionId) {
    try {
      return this.#commit(
        paintAuthoringSurfaceCells(this.authoringMap, cells, definitionId),
      );
    } catch (error) {
      this.lastMutationError = error instanceof Error ? error.message : String(error);
      return false;
    }
  }

  /** @param {number} cx @param {number} cz */
  eraseSurface(cx, cz) {
    try {
      return this.#commit(eraseAuthoringSurface(this.authoringMap, cx, cz));
    } catch (error) {
      this.lastMutationError = error instanceof Error ? error.message : String(error);
      return false;
    }
  }

  /** @param {Array<{cx:number,cz:number}>} cells */
  eraseSurfaceCells(cells) {
    try {
      return this.#commit(eraseAuthoringSurfaceCells(this.authoringMap, cells));
    } catch (error) {
      this.lastMutationError = error instanceof Error ? error.message : String(error);
      return false;
    }
  }

  /** @param {number} cx @param {number} cz @param {string} definitionId */
  paintStructure(cx, cz, definitionId) {
    try {
      return this.#commit(
        paintAuthoringStructure(this.authoringMap, cx, cz, definitionId),
      );
    } catch (error) {
      this.lastMutationError = error instanceof Error ? error.message : String(error);
      return false;
    }
  }

  /** @param {Array<{cx:number,cz:number}>} cells @param {string} definitionId */
  paintStructureCells(cells, definitionId) {
    try {
      return this.#commit(
        paintAuthoringStructureCells(this.authoringMap, cells, definitionId),
      );
    } catch (error) {
      this.lastMutationError = error instanceof Error ? error.message : String(error);
      return false;
    }
  }

  /** @param {number} cx @param {number} cz */
  eraseStructure(cx, cz) {
    try {
      return this.#commit(eraseAuthoringStructure(this.authoringMap, cx, cz));
    } catch (error) {
      this.lastMutationError = error instanceof Error ? error.message : String(error);
      return false;
    }
  }

  /** @param {Array<{cx:number,cz:number}>} cells */
  eraseStructureCells(cells) {
    try {
      return this.#commit(eraseAuthoringStructureCells(this.authoringMap, cells));
    } catch (error) {
      this.lastMutationError = error instanceof Error ? error.message : String(error);
      return false;
    }
  }

  /** @param {string} definitionId @param {number} x @param {number} z @param {number} [rotation] */
  canPlaceDefinition(definitionId, x, z, rotation = 0) {
    return this.validateInstanceTransform(definitionId, { x, z, rotation }).valid;
  }

  /**
   * @param {string} definitionId
   * @param {{x:number,z:number,rotation?:number}} transform
   * @param {string} [ignoreInstanceId]
   */
  validateInstanceTransform(definitionId, transform, ignoreInstanceId) {
    return validateInstancePlacement(this.authoringMap, definitionId, transform, {
      ...(ignoreInstanceId ? { ignoreInstanceId } : {}),
    });
  }

  /**
   * @param {string} definitionId
   * @param {number} x
   * @param {number} z
   * @param {{rotation?:number,properties?:Record<string,unknown>}} [options]
   */
  placeInstance(definitionId, x, z, options = {}) {
    try {
      const result = placeAuthoringInstance(
        this.authoringMap,
        definitionId,
        x,
        z,
        options,
      );
      return this.#commit(result.document) ? result.instanceId : null;
    } catch (error) {
      this.lastMutationError = error instanceof Error ? error.message : String(error);
      return null;
    }
  }

  /** @param {string} authoringId */
  removeInstance(authoringId) {
    try {
      return this.#commit(removeAuthoringInstance(this.authoringMap, authoringId));
    } catch (error) {
      this.lastMutationError = error instanceof Error ? error.message : String(error);
      return false;
    }
  }

  /**
   * @param {string} authoringId
   * @param {{x?:number,z?:number,rotation?:number}} transform
   */
  updateInstanceTransform(authoringId, transform) {
    try {
      return this.#commit(
        updateAuthoringInstanceTransform(this.authoringMap, authoringId, transform),
      );
    } catch (error) {
      this.lastMutationError = error instanceof Error ? error.message : String(error);
      return false;
    }
  }

  /** @param {string} authoringId */
  instanceById(authoringId) {
    const instance = this.instances.find((candidate) => candidate.id === authoringId);
    return instance
      ? {
        ...instance,
        ...(instance.properties
          ? { properties: JSON.parse(JSON.stringify(instance.properties)) }
          : {}),
      }
      : null;
  }

  /** @param {string} archetype @param {number} x @param {number} z */
  canPlaceRock(archetype, x, z) {
    const definitionId = rockDefinitionId(archetype);
    return Boolean(definitionId && this.canPlaceDefinition(definitionId, x, z));
  }

  /** @param {string} archetype @param {number} x @param {number} z */
  placeRock(archetype, x, z) {
    const definitionId = rockDefinitionId(archetype);
    if (!definitionId) return 0;
    const authoringId = this.placeInstance(definitionId, x, z);
    if (!authoringId) return 0;
    return this.spawnIdForAuthoringId(authoringId) ?? 0;
  }

  /** @param {number} spawnId */
  removeRock(spawnId) {
    const entity = this.entities.find(
      (candidate) => candidate.kind === "rock" && candidate.spawnId === spawnId,
    );
    return Boolean(entity?.authoringId && this.removeInstance(entity.authoringId));
  }

  /** @param {string} authoringId */
  spawnIdForAuthoringId(authoringId) {
    return this.entities.find((entity) => entity.authoringId === authoringId)?.spawnId ?? null;
  }

  /** @param {number} spawnId */
  authoringIdForSpawnId(spawnId) {
    return this.entities.find((entity) => entity.spawnId === spawnId)?.authoringId ?? null;
  }

  /** @param {number} x @param {number} z */
  instanceAt(x, z) {
    for (let index = this.instances.length - 1; index >= 0; index -= 1) {
      const instance = this.instances[index];
      const definition = getPlaceableDefinition(instance.definitionId);
      if (!definition) continue;
      if (pointHitsInstanceExtent(definition, instance, x, z)) {
        return { ...instance };
      }
    }
    return null;
  }

  /** @param {number} cx @param {number} cz */
  obeliskAtCell(cx, cz) {
    return this.entities.find(
      (entity) => entity.kind === "obelisk"
        && Math.floor(entity.x) === cx
        && Math.floor(entity.z) === cz,
    ) ?? null;
  }

  get obelisk() {
    return this.entities.find((entity) => entity.kind === "obelisk") ?? null;
  }

  /** @param {string | Record<string, unknown>} input */
  static fromJSON(input) {
    return new ArenaScenario(loadAuthoringMap(input));
  }
}

export function createDebugArenaScenario() {
  const map = createDebugArenaMap();
  map.set(20, 18, 1);
  return new ArenaScenario(map, [
    { kind: "rock", archetype: "small", x: 5, z: 18.5 },
    { kind: "rock", archetype: "medium", x: 6.5, z: 18.5 },
    { kind: "rock", archetype: "large", x: 4.5, z: 21 },
    { kind: "rock", archetype: "small", x: 9.5, z: 12.5 },
    { kind: "obelisk", x: 20.5, z: 18.5 },
  ]);
}
