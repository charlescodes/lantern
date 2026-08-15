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
import { compileAuthoringMap, getCompiledLayer } from "../authoring/map_compiler.js";
import { pointHitsInstanceExtent } from "../authoring/footprint.js";
import { validateInstancePlacement } from "../authoring/placement_validation.js";
import { createDebugArenaMap, GridMap } from "./grid_map.js";

/** @param {string} archetype */
export function getRockArchetype(archetype) {
  return Object.hasOwn(ROCK_ARCHETYPES, archetype) ? ROCK_ARCHETYPES[archetype] : null;
}

/** @param {Record<string,any>} instance */
function cloneInstance(instance) {
  return {
    ...instance,
    ...(instance.properties
      ? { properties: JSON.parse(JSON.stringify(instance.properties)) }
      : {}),
  };
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
    this.#applyCompiled(compileAuthoringMap(authoringMap), true, authoringMap.playerStart.layerId);
  }

  /** @param {ReturnType<typeof compileAuthoringMap>} compiled @param {boolean} initial @param {string} requestedLayerId */
  #applyCompiled(compiled, initial = false, requestedLayerId = compiled.startLayerId) {
    this.authoringMap = compiled.document;
    this.playerStart = { ...compiled.playerStart };
    this.startLayerId = compiled.startLayerId;
    this.compiledLayerIds = [...compiled.layerIds];
    this.validationDiagnostics = compiled.diagnostics.map((entry) => ({ ...entry }));
    this._compiledLayers = compiled.layers;
    const selected = getCompiledLayer(compiled, requestedLayerId)
      ?? getCompiledLayer(compiled, compiled.startLayerId);
    if (!selected) throw new RangeError("Compiled authoring map has no playable layer");
    this.#activateCompiledLayer(selected, initial);
  }

  /** @param {ReturnType<typeof compileAuthoringMap>["layers"][number]} compiledLayer @param {boolean} initial */
  #activateCompiledLayer(compiledLayer, initial = false) {
    const sameLayer = this.activeLayer?.id === compiledLayer.id;
    if (
      !initial
      && sameLayer
      && this.map
      && this.map.width === compiledLayer.map.width
      && this.map.height === compiledLayer.map.height
    ) {
      this.map.cells.set(compiledLayer.map.cells);
      this.map.playerSpawn = { ...compiledLayer.map.playerSpawn };
    } else {
      this.map = compiledLayer.map.clone();
    }
    this.activeLayer = {
      id: compiledLayer.id,
      name: compiledLayer.name,
      baseY: compiledLayer.baseY,
      width: compiledLayer.width,
      height: compiledLayer.height,
    };
    this.surface = {
      legend: [...compiledLayer.surface.legend],
      cells: new Uint16Array(compiledLayer.surface.cells),
    };
    this.structure = {
      legend: [...compiledLayer.structure.legend],
      cells: new Uint16Array(compiledLayer.structure.cells),
    };
    this.occluderMask = new Uint8Array(compiledLayer.occluderMask);
    this.instances = compiledLayer.instances.map(cloneInstance);
    this.runtimeMappings = compiledLayer.runtimeMappings.map((mapping) => ({
      ...mapping,
      collisionCells: mapping.collisionCells.map((cell) => ({ ...cell })),
    }));
    this.entities = compiledLayer.entities.map((entity) => ({ ...entity }));
    this.nextSpawnId = this.entities.reduce(
      (maximum, entity) => Math.max(maximum, Number(entity.spawnId) + 1),
      1,
    );
  }

  /** @param {unknown} nextDocument */
  #commit(nextDocument) {
    try {
      const requestedLayerId = this.activeLayer.id;
      this.#applyCompiled(compileAuthoringMap(nextDocument), false, requestedLayerId);
      this.lastMutationError = null;
      return true;
    } catch (error) {
      this.lastMutationError = error instanceof Error ? error.message : String(error);
      return false;
    }
  }

  /** Activates a precompiled layer recipe without changing saved source data. @param {string} layerId */
  activateLayer(layerId) {
    const compiledLayer = this._compiledLayers.find((layer) => layer.id === layerId);
    if (!compiledLayer) {
      this.lastMutationError = `Unknown authoring layer "${layerId}"`;
      return false;
    }
    this.#activateCompiledLayer(compiledLayer, false);
    this.lastMutationError = null;
    return true;
  }

  /** @param {string} layerId */
  hasLayer(layerId) {
    return this.compiledLayerIds.includes(layerId);
  }

  clone() {
    const clone = new ArenaScenario(this.toAuthoringJSON());
    clone.activateLayer(this.activeLayer.id);
    return clone;
  }

  /** Legacy recording projection always uses the authored player-start layer. */
  toJSON() {
    const start = this._compiledLayers.find((layer) => layer.id === this.startLayerId);
    if (!start) throw new RangeError("Player-start layer is unavailable");
    return {
      version: SCENARIO_VERSION,
      authoringMetadata: { ...this.authoringMap.metadata },
      width: start.map.width,
      height: start.map.height,
      cells: Array.from(start.map.cells),
      playerSpawn: { ...start.map.playerSpawn },
      entities: start.entities
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

  /** @param {string} layerId */
  compiledLayer(layerId) {
    return this._compiledLayers.find((layer) => layer.id === layerId) ?? null;
  }

  layerSummaries() {
    return this.authoringMap.layers.map((layer, index) => ({
      id: layer.id,
      name: layer.name,
      baseY: layer.baseY,
      width: layer.width,
      height: layer.height,
      order: index,
      instanceCount: layer.instances.length,
      playerStart: layer.id === this.startLayerId,
    }));
  }

  /** @param {number} cx @param {number} cz @param {number} tile @param {string} [layerId] */
  setTile(cx, cz, tile, layerId = this.activeLayer.id) {
    return tile === 1
      ? this.paintStructure(cx, cz, "structure.wall", layerId)
      : this.eraseStructure(cx, cz, layerId);
  }

  /** @param {number} cx @param {number} cz @param {string} definitionId @param {string} [layerId] */
  paintSurface(cx, cz, definitionId, layerId = this.activeLayer.id) {
    try {
      return this.#commit(paintAuthoringSurface(this.authoringMap, cx, cz, definitionId, layerId));
    } catch (error) {
      this.lastMutationError = error instanceof Error ? error.message : String(error);
      return false;
    }
  }

  /** @param {Array<{cx:number,cz:number}>} cells @param {string} definitionId @param {string} [layerId] */
  paintSurfaceCells(cells, definitionId, layerId = this.activeLayer.id) {
    try {
      return this.#commit(paintAuthoringSurfaceCells(this.authoringMap, cells, definitionId, layerId));
    } catch (error) {
      this.lastMutationError = error instanceof Error ? error.message : String(error);
      return false;
    }
  }

  /** @param {number} cx @param {number} cz @param {string} [layerId] */
  eraseSurface(cx, cz, layerId = this.activeLayer.id) {
    try {
      return this.#commit(eraseAuthoringSurface(this.authoringMap, cx, cz, layerId));
    } catch (error) {
      this.lastMutationError = error instanceof Error ? error.message : String(error);
      return false;
    }
  }

  /** @param {Array<{cx:number,cz:number}>} cells @param {string} [layerId] */
  eraseSurfaceCells(cells, layerId = this.activeLayer.id) {
    try {
      return this.#commit(eraseAuthoringSurfaceCells(this.authoringMap, cells, layerId));
    } catch (error) {
      this.lastMutationError = error instanceof Error ? error.message : String(error);
      return false;
    }
  }

  /** @param {number} cx @param {number} cz @param {string} definitionId @param {string} [layerId] */
  paintStructure(cx, cz, definitionId, layerId = this.activeLayer.id) {
    try {
      return this.#commit(paintAuthoringStructure(this.authoringMap, cx, cz, definitionId, layerId));
    } catch (error) {
      this.lastMutationError = error instanceof Error ? error.message : String(error);
      return false;
    }
  }

  /** @param {Array<{cx:number,cz:number}>} cells @param {string} definitionId @param {string} [layerId] */
  paintStructureCells(cells, definitionId, layerId = this.activeLayer.id) {
    try {
      return this.#commit(paintAuthoringStructureCells(this.authoringMap, cells, definitionId, layerId));
    } catch (error) {
      this.lastMutationError = error instanceof Error ? error.message : String(error);
      return false;
    }
  }

  /** @param {number} cx @param {number} cz @param {string} [layerId] */
  eraseStructure(cx, cz, layerId = this.activeLayer.id) {
    try {
      return this.#commit(eraseAuthoringStructure(this.authoringMap, cx, cz, layerId));
    } catch (error) {
      this.lastMutationError = error instanceof Error ? error.message : String(error);
      return false;
    }
  }

  /** @param {Array<{cx:number,cz:number}>} cells @param {string} [layerId] */
  eraseStructureCells(cells, layerId = this.activeLayer.id) {
    try {
      return this.#commit(eraseAuthoringStructureCells(this.authoringMap, cells, layerId));
    } catch (error) {
      this.lastMutationError = error instanceof Error ? error.message : String(error);
      return false;
    }
  }

  /** @param {string} definitionId @param {number} x @param {number} z @param {number} [rotation] @param {string} [layerId] */
  canPlaceDefinition(definitionId, x, z, rotation = 0, layerId = this.activeLayer.id) {
    return this.validateInstanceTransform(definitionId, { x, z, rotation }, undefined, layerId).valid;
  }

  /**
   * @param {string} definitionId
   * @param {{x:number,z:number,rotation?:number}} transform
   * @param {string} [ignoreInstanceId]
   * @param {string} [layerId]
   */
  validateInstanceTransform(definitionId, transform, ignoreInstanceId, layerId = this.activeLayer.id) {
    return validateInstancePlacement(this.authoringMap, definitionId, transform, {
      layerId,
      ...(ignoreInstanceId ? { ignoreInstanceId } : {}),
    });
  }

  /**
   * @param {string} definitionId @param {number} x @param {number} z
   * @param {{rotation?:number,properties?:Record<string,unknown>,layerId?:string}} [options]
   */
  placeInstance(definitionId, x, z, options = {}) {
    try {
      const result = placeAuthoringInstance(this.authoringMap, definitionId, x, z, {
        ...options,
        layerId: options.layerId ?? this.activeLayer.id,
      });
      return this.#commit(result.document) ? result.instanceId : null;
    } catch (error) {
      this.lastMutationError = error instanceof Error ? error.message : String(error);
      return null;
    }
  }

  /** @param {string} authoringId @param {string} [layerId] */
  removeInstance(authoringId, layerId = this.activeLayer.id) {
    try {
      return this.#commit(removeAuthoringInstance(this.authoringMap, authoringId, layerId));
    } catch (error) {
      this.lastMutationError = error instanceof Error ? error.message : String(error);
      return false;
    }
  }

  /** @param {string} authoringId @param {{x?:number,z?:number,rotation?:number}} transform @param {string} [layerId] */
  updateInstanceTransform(authoringId, transform, layerId = this.activeLayer.id) {
    try {
      return this.#commit(updateAuthoringInstanceTransform(this.authoringMap, authoringId, transform, layerId));
    } catch (error) {
      this.lastMutationError = error instanceof Error ? error.message : String(error);
      return false;
    }
  }

  /** @param {string} authoringId @param {string} [layerId] */
  instanceById(authoringId, layerId = this.activeLayer.id) {
    const layer = this.authoringMap.layers.find((candidate) => candidate.id === layerId);
    const instance = layer?.instances.find((candidate) => candidate.id === authoringId);
    return instance ? cloneInstance(instance) : null;
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
    const entity = this.entities.find((candidate) => candidate.kind === "rock" && candidate.spawnId === spawnId);
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
      if (definition && pointHitsInstanceExtent(definition, instance, x, z)) return { ...instance };
    }
    return null;
  }

  /** @param {number} cx @param {number} cz */
  obeliskAtCell(cx, cz) {
    return this.entities.find(
      (entity) => entity.kind === "obelisk" && Math.floor(entity.x) === cx && Math.floor(entity.z) === cz,
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
