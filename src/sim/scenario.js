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
  createLayer as createAuthoringLayer,
  placeElevatorConnector,
  placeInstance as placeAuthoringInstance,
  placeNavigationLink,
  placeNavigationNode,
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
    this.connectors = compiled.connectors.map((connector) => ({ ...connector }));
    this.navigationTopology = compiled.navigationTopology;
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

  compiledLayers() {
    return this._compiledLayers.slice();
  }

  navigationTopologySnapshot() {
    return this.navigationTopology.describe();
  }

  allRuntimeEntities() {
    return this._compiledLayers.flatMap((layer) => (
      layer.entities.map((entity) => ({ ...entity, layerId: layer.id }))
    ));
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
    for (const layer of this._compiledLayers) {
      const entity = layer.entities.find((candidate) => candidate.authoringId === authoringId);
      if (entity) return entity.spawnId ?? null;
    }
    return null;
  }

  /** @param {number} spawnId */
  authoringIdForSpawnId(spawnId) {
    for (const layer of this._compiledLayers) {
      const entity = layer.entities.find((candidate) => candidate.spawnId === spawnId);
      if (entity) return entity.authoringId ?? null;
    }
    return null;
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

  /**
   * The arena encounter is map-owned, not a property of whichever layer the
   * editor or camera is currently viewing.  Authoring validation keeps this
   * singleton marker unambiguous.
   */
  get encounterObelisk() {
    return this.allRuntimeEntities().find((entity) => entity.kind === "obelisk") ?? null;
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

/**
 * Focused two-floor M1B acceptance arena. Open with `?arena=elevator`; the
 * normal debug arena remains unchanged for frozen replay and combat fixtures.
 */
export function createVerticalDebugArenaScenario() {
  let document = createDebugArenaScenario().toAuthoringJSON();
  const lowerLayerId = document.playerStart.layerId;
  const created = createAuthoringLayer(document, lowerLayerId, "above", {
    name: "Elevator upper",
    baseY: 3,
  });
  document = created.document;
  const upperLayerId = created.layerId;
  document = placeElevatorConnector(document, 8, 18.5, {
    lowerLayerId,
    upperLayerId,
    initialStop: "lower",
    travelDurationSeconds: 2,
    dwellSeconds: 1,
  }).document;
  document = placeAuthoringInstance(document, "object.rock.small", 9.2, 18.5, {
    layerId: lowerLayerId,
  }).document;
  document = placeAuthoringInstance(document, "object.torch", 7.2, 18.5, {
    layerId: lowerLayerId,
  }).document;
  document = placeAuthoringInstance(document, "object.table", 10.5, 18.5, {
    layerId: lowerLayerId,
  }).document;
  return new ArenaScenario(document);
}

/**
 * Four-floor M1B.2 acceptance arena. Open with `?arena=holes`.  The holes
 * are ordinary authored surface cells, so this fixture also exercises the
 * palette/undo/save path used by temple maps.
 */
export function createHoleDebugArenaScenario() {
  let document = createDebugArenaScenario().toAuthoringJSON();
  const ground = document.playerStart.layerId;
  let created = createAuthoringLayer(document, ground, "above", { name: "Hole deck", baseY: 3 });
  document = created.document;
  const deck = created.layerId;
  created = createAuthoringLayer(document, deck, "above", { name: "Hole gallery", baseY: 6 });
  document = created.document;
  const gallery = created.layerId;
  created = createAuthoringLayer(document, gallery, "above", { name: "Hole crown", baseY: 9 });
  document = created.document;
  const crown = created.layerId;
  // A centered vertical column; ground intentionally has no matching hole.
  for (const layerId of [deck, gallery, crown]) {
    document = paintAuthoringSurface(document, 8, 18, "surface.hole", layerId);
  }
  // Adjacent holes keep their seam, and this wall makes corrective movement
  // toward one opening visibly harder without changing its geometry.
  document = paintAuthoringSurface(document, 12, 12, "surface.hole", deck);
  document = paintAuthoringSurface(document, 13, 12, "surface.hole", deck);
  document = paintAuthoringStructure(document, 14, 12, "structure.wall", deck);
  // Start beside—not over—the shaft so the arena can be inspected before the
  // player deliberately steps into the first aperture.
  // The floor route deliberately staggers three autonomous lifts.  The player
  // begins on the catching ground floor, so the hole column is opt-in.
  document.playerStart = { layerId: ground, x: 2.5, z: 18.5 };
  for (const [lowerLayerId, upperLayerId, x, z] of [
    [ground, deck, 4.5, 18.5],
    [deck, gallery, 18.5, 12.5],
    [gallery, crown, 4.5, 5.5],
  ]) {
    document = placeElevatorConnector(document, x, z, {
      lowerLayerId,
      upperLayerId,
      travelDurationSeconds: 2,
      dwellSeconds: 1,
      initialStop: "lower",
    }).document;
  }
  // Leave a clear route at each upper aperture while making the shafts easy
  // to see during human testing.
  for (const [layerId, x, z, openX, openZ] of [
    [deck, 4, 18, 5, 18],
    [gallery, 18, 12, 17, 12],
    [crown, 4, 5, 5, 5],
  ]) {
    for (const [wallX, wallZ] of [[x - 1, z], [x, z - 1], [x, z + 1]]) {
      if (wallX === openX && wallZ === openZ) continue;
      document = paintAuthoringStructure(document, wallX, wallZ, "structure.wall", layerId);
    }
  }
  document = placeAuthoringInstance(document, "object.torch", 4.5, 18.5, { layerId: ground }).document;
  document = placeAuthoringInstance(document, "object.rock.small", 5.2, 18.5, { layerId: ground }).document;
  document = placeAuthoringInstance(document, "object.table", 7.5, 18.5, { layerId: ground }).document;
  document = placeAuthoringInstance(document, "object.rock.large", 2.5, 2.5, { layerId: ground }).document;
  document = placeAuthoringInstance(document, "object.rock.small", 8.5, 17.5, { layerId: crown }).document;
  document = placeAuthoringInstance(document, "object.torch", 7.5, 18.5, { layerId: crown }).document;
  document = placeAuthoringInstance(document, "object.table", 14.5, 18.5, { layerId: crown }).document;
  document = placeAuthoringInstance(document, "object.rock.large", 17.5, 18.5, { layerId: crown }).document;
  return new ArenaScenario(document);
}

/**
 * Three-floor authored M1C acceptance arena. The lower patrol is autonomous;
 * the two timer-driven connectors and their staging chain exercise route
 * execution without adding pursuit knowledge or elevator requests.
 */
export function createNavigationDebugArenaScenario() {
  const map = createDebugArenaMap();
  // Keep the encounter inside the lower-floor player's initial sight range;
  // the solid authored cell remains the ordinary obelisk spawn authority.
  map.set(14, 18, 1);
  let document = new ArenaScenario(map, [
    { kind: "obelisk", x: 14.5, z: 18.5 },
  ]).toAuthoringJSON();
  const lower = document.playerStart.layerId;
  let created = createAuthoringLayer(document, lower, "above", {
    name: "Navigation middle",
    baseY: 3,
  });
  document = created.document;
  const middle = created.layerId;
  created = createAuthoringLayer(document, middle, "above", {
    name: "Navigation upper",
    baseY: 6,
  });
  document = created.document;
  const upper = created.layerId;
  const connectorA = placeElevatorConnector(document, 6, 18, {
    lowerLayerId: lower,
    upperLayerId: middle,
    initialStop: "lower",
    travelDurationSeconds: 2,
    dwellSeconds: 1,
  });
  document = connectorA.document;
  const connectorB = placeElevatorConnector(document, 17, 10, {
    lowerLayerId: middle,
    upperLayerId: upper,
    initialStop: "lower",
    travelDurationSeconds: 2,
    dwellSeconds: 1,
  });
  document = connectorB.document;

  const nodes = {};
  const addNode = (key, layerId, cx, cz, patrol = false) => {
    const placed = placeNavigationNode(document, cx, cz, { layerId, patrol });
    document = placed.document;
    nodes[key] = placed.nodeId;
  };
  addNode("lowerStart", lower, 3, 18, true);
  addNode("lowerAStage", lower, 7, 18, true);
  addNode("lowerLoop", lower, 7, 14, true);
  addNode("middleAStage", middle, 7, 18);
  addNode("middleEast", middle, 11, 18);
  addNode("middleNorth", middle, 11, 10);
  addNode("middleBStage", middle, 16, 10);
  addNode("upperBStage", upper, 16, 10);
  addNode("upperNorth", upper, 16, 6);
  addNode("upperGoal", upper, 20, 6);

  const node = (key) => ({ kind: "node", nodeId: nodes[key] });
  const endpoint = (connectorId, stop) => ({
    kind: "connector-endpoint",
    connectorId,
    stop,
  });
  const addLink = (from, to) => {
    document = placeNavigationLink(document, from, to).document;
  };
  addLink(node("lowerStart"), node("lowerAStage"));
  addLink(node("lowerAStage"), node("lowerLoop"));
  addLink(node("lowerLoop"), node("lowerStart"));
  addLink(node("lowerAStage"), endpoint(connectorA.connectorId, "lower"));
  addLink(endpoint(connectorA.connectorId, "upper"), node("middleAStage"));
  addLink(node("middleAStage"), node("middleEast"));
  addLink(node("middleEast"), node("middleNorth"));
  addLink(node("middleNorth"), node("middleBStage"));
  addLink(node("middleBStage"), endpoint(connectorB.connectorId, "lower"));
  addLink(endpoint(connectorB.connectorId, "upper"), node("upperBStage"));
  addLink(node("upperBStage"), node("upperNorth"));
  addLink(node("upperNorth"), node("upperGoal"));

  for (let cx = 2; cx <= 21; cx += 1) {
    document = paintAuthoringSurface(document, cx, 3, "surface.moss", middle);
    document = paintAuthoringSurface(document, cx, 20, "surface.moss", upper);
  }
  document = placeAuthoringInstance(document, "object.torch", 4.5, 20.5, { layerId: lower }).document;
  document = placeAuthoringInstance(document, "object.rock.small", 2.5, 2.5, { layerId: lower }).document;
  document = placeAuthoringInstance(document, "object.torch", 10.5, 16.5, { layerId: middle }).document;
  document = placeAuthoringInstance(document, "object.table", 14.5, 14.5, { layerId: middle }).document;
  document = placeAuthoringInstance(document, "object.torch", 19.5, 8.5, { layerId: upper }).document;
  document = placeAuthoringInstance(document, "object.rock.large", 20.5, 3.5, { layerId: upper }).document;
  return new ArenaScenario(document);
}
