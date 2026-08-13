// @ts-check

import {
  ROCK_ARCHETYPES,
  SCENARIO_VERSION,
} from "../config.js";
import {
  eraseStructure as eraseAuthoringStructure,
  paintStructure as paintAuthoringStructure,
  paintSurface as paintAuthoringSurface,
  placeInstance as placeAuthoringInstance,
  removeInstance as removeAuthoringInstance,
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
import { createDebugArenaMap, GridMap } from "./grid_map.js";

/** @param {string} archetype */
export function getRockArchetype(archetype) {
  return Object.hasOwn(ROCK_ARCHETYPES, archetype) ? ROCK_ARCHETYPES[archetype] : null;
}

export class ArenaScenario {
  /**
   * @param {GridMap | Record<string, unknown>} map
   * @param {Array<{kind:"rock"|"obelisk",archetype?:string,x:number,z:number,spawnId?:number,authoringId?:string}>} [entities]
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
      entities: this.entities.map((entity) => ({
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

  /** @param {number} cx @param {number} cz */
  eraseStructure(cx, cz) {
    try {
      return this.#commit(eraseAuthoringStructure(this.authoringMap, cx, cz));
    } catch (error) {
      this.lastMutationError = error instanceof Error ? error.message : String(error);
      return false;
    }
  }

  /** @param {string} definitionId @param {number} x @param {number} z @param {number} [rotation] */
  canPlaceDefinition(definitionId, x, z, rotation = 0) {
    try {
      const result = placeAuthoringInstance(
        this.authoringMap,
        definitionId,
        x,
        z,
        { rotation },
      );
      compileAuthoringMap(result.document);
      return true;
    } catch {
      return false;
    }
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
      if (definition.traits.runtimeKind === "rock") {
        if (Math.hypot(x - instance.x, z - instance.z) <= Number(definition.traits.radius)) {
          return { ...instance };
        }
        continue;
      }
      if (Math.floor(x) === Math.floor(instance.x) && Math.floor(z) === Math.floor(instance.z)) {
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
