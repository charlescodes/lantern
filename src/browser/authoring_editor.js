// @ts-check

import { snapDefinitionPlacement } from "../authoring/authoring_commands.js";
import {
  AUTHORING_CHANNELS,
  authoringCellAt,
  authoringChannelForDefinition,
  EditorInteractionState,
  occupiedCellsForTarget,
  pickAuthoredConnector,
  pickAuthoredInstance,
  pickNavigationEndpoint,
  pickNavigationNode,
  pickAuthoringTarget,
  sampleAuthoredDefinition,
} from "../authoring/editor_interaction.js";
import {
  getPlaceableDefinition,
  listPlaceableDefinitions,
} from "../authoring/definition_catalog.js";
import { getOccupiedCells, normalizeQuarterTurns } from "../authoring/footprint.js";

/** @param {Record<string, any>|null} target */
function cloneTarget(target) {
  return target ? { ...target } : null;
}

/** @param {{cx:number,cz:number}} cell */
function cellKey(cell) {
  return `${cell.cx}:${cell.cz}`;
}

/** @param {Record<string, any>} instance */
function cloneTransform(instance) {
  return { x: instance.x, z: instance.z, rotation: instance.rotation };
}

/** @param {Record<string, any>|null} layer */
function cloneLayerSnapshot(layer) {
  if (!layer) return null;
  return {
    ...layer,
    surface: layer.surface
      ? { legend: [...layer.surface.legend], cells: [...layer.surface.cells] }
      : null,
    structure: layer.structure
      ? { legend: [...layer.structure.legend], cells: [...layer.structure.cells] }
      : null,
    solidCells: [...(layer.solidCells ?? [])],
    occluderCells: [...(layer.occluderCells ?? [])],
    markers: layer.markers ? structuredClone(layer.markers) : {},
    instances: (layer.instances ?? []).map((instance) => ({
      ...structuredClone(instance),
      occupiedCells: (instance.occupiedCells ?? []).map((cell) => ({ ...cell })),
    })),
  };
}

const LAYER_SCOPED_ACTIONS = new Set([
  "setTile",
  "paintSurface",
  "paintSurfaceStroke",
  "eraseSurface",
  "eraseSurfaceStroke",
  "paintStructure",
  "paintStructureStroke",
  "eraseStructure",
  "eraseStructureStroke",
  "placeRock",
  "placeInstance",
  "removeInstance",
  "updateInstanceTransform",
  "updateInstanceProperties",
  "placeNavigationNode",
  "moveNavigationNode",
  "removeNavigationNode",
  "updateNavigationNode",
]);

export class AuthoringEditorController {
  /**
   * @param {{
   * snapshot:Record<string,any>,
   * validatePlacement:(definitionId:string,x:number,z:number,rotation:number,ignoreId?:string|null,layerId?:string)=>Record<string,any>,
   * commit:(action:Record<string,unknown>)=>{ok:boolean,error?:string|null,snapshot?:Record<string,any>},
   * activateLayer?:(layerId:string)=>{ok:boolean,error?:string|null,snapshot?:Record<string,any>},
   * layerSnapshot?:(layerId:string)=>Record<string,any>|null,
   * validateMap?:()=>Record<string,any>,
   * historySnapshot?:()=>Record<string,any>,
   * undo?:()=>{ok:boolean,error?:string|null,snapshot?:Record<string,any>,label?:string},
   * redo?:()=>{ok:boolean,error?:string|null,snapshot?:Record<string,any>,label?:string},
   * announce?:(message:string)=>void,
   * }} options
   */
  constructor(options) {
    this.currentSnapshot = options.snapshot;
    this.validatePlacement = options.validatePlacement;
    this.commitAction = options.commit;
    this.activateLayerRuntime = options.activateLayer ?? (() => ({ ok: false, error: "Layer activation is unavailable" }));
    this.getLayerSnapshot = options.layerSnapshot ?? (() => null);
    this.validateMapDocument = options.validateMap ?? (() => ({ diagnostics: [], errorCount: 0, warningCount: 0 }));
    this.getHistorySnapshot = options.historySnapshot ?? (() => ({}));
    this.undoHistory = options.undo ?? (() => ({ ok: false, error: "Undo is unavailable" }));
    this.redoHistory = options.redo ?? (() => ({ ok: false, error: "Redo is unavailable" }));
    this.announce = options.announce ?? (() => {});
    this.state = new EditorInteractionState({ selectedDefinitionId: "structure.wall" });
    this.pointer = { x: 0, z: 0, inside: false };
    this.gesture = null;
    this.lastMessage = "";
    this.lastMessageValid = true;
    this.activeLayerId = this.currentSnapshot.authoring.activeLayer.id;
    this.referenceLayerId = null;
    this.referenceLayer = null;
    this.referenceRevision = null;
    this.state.reconcile(this.currentSnapshot.authoring);
  }

  /** @param {Record<string,any>} snapshot @param {{x:number,z:number,inside:boolean}} [pointer] */
  sync(snapshot, pointer) {
    this.currentSnapshot = snapshot;
    if (pointer) this.pointer = { ...pointer };
    this.#reconcileLayers();
    this.state.reconcile(snapshot.authoring);
    this.#refreshHoverAndPreview();
    return this.snapshot();
  }

  /** Clears document-relative UI identity after an atomic load/import replacement. */
  replaceDocument(snapshot) {
    this.currentSnapshot = snapshot;
    this.cancel();
    this.referenceLayerId = null;
    this.referenceLayer = null;
    this.referenceRevision = null;
    this.state.setHoveredTarget(null);
    this.state.setSelectedTarget(null);
    this.pointer.inside = false;
    this.activeLayerId = snapshot.authoring.playerStartLayerId
      ?? snapshot.authoring.activeLayer.id;
    this.#reconcileLayers();
    this.state.reconcile(snapshot.authoring);
    this.#refreshHoverAndPreview();
    return this.snapshot();
  }

  /** @param {string} definitionId */
  setDefinition(definitionId) {
    this.cancel();
    this.state.setDefinition(definitionId);
    this.#refreshHoverAndPreview();
    return true;
  }

  /** @param {string} tool */
  setTool(tool) {
    this.cancel();
    this.state.setTool(tool);
    this.#refreshHoverAndPreview();
    return true;
  }

  /** @param {string} channel */
  setChannel(channel) {
    if (!AUTHORING_CHANNELS.includes(channel)) return false;
    this.cancel();
    this.state.setChannel(channel);
    if (channel !== "navigation" && this.state.activeTool === "paint") {
      const selected = getPlaceableDefinition(this.state.selectedDefinitionId);
      if (authoringChannelForDefinition(selected) !== channel) {
        const fallback = listPlaceableDefinitions().find(
          (definition) => authoringChannelForDefinition(definition) === channel,
        );
        if (fallback) this.state.setDefinition(fallback.id);
      }
    }
    this.#refreshHoverAndPreview();
    return true;
  }

  /** @param {boolean} value */
  setShowAuthoringExtents(value) {
    this.state.setShowAuthoringExtents(value);
    return this.state.showAuthoringExtents;
  }

  /** @param {string} layerId */
  activateLayer(layerId) {
    const target = this.currentSnapshot.authoring.layers?.find((layer) => layer.id === layerId);
    if (!target) return false;
    this.cancel();
    const result = this.activateLayerRuntime(layerId);
    if (result.snapshot) this.currentSnapshot = result.snapshot;
    if (!result.ok) {
      this.#message(result.error ?? `Could not activate ${target.name}`, false);
      return false;
    }
    this.activeLayerId = layerId;
    if (this.referenceLayerId === layerId) this.setReferenceLayer(null);
    this.state.setHoveredTarget(null);
    this.state.setSelectedTarget(null);
    this.pointer.inside = false;
    this.#reconcileLayers();
    this.#refreshHoverAndPreview();
    this.#message(`Editing ${target.name}`, true);
    return true;
  }

  /** @param {string|null} layerId */
  setReferenceLayer(layerId) {
    if (layerId === null || layerId === "") {
      this.referenceLayerId = null;
      this.referenceLayer = null;
      this.referenceRevision = null;
      return true;
    }
    if (layerId === this.activeLayerId) return false;
    if (!this.currentSnapshot.authoring.layers?.some((layer) => layer.id === layerId)) return false;
    const snapshot = this.getLayerSnapshot(layerId);
    if (!snapshot) return false;
    this.referenceLayerId = layerId;
    this.referenceLayer = snapshot;
    this.referenceRevision = this.currentSnapshot.authoring.revision;
    return true;
  }

  /** @param {"above"|"below"} direction */
  createLayer(direction) {
    const before = new Set(this.currentSnapshot.authoring.layers.map((layer) => layer.id));
    if (!this.#commit({
      type: "createLayer",
      layerId: this.activeLayerId,
      relativeLayerId: this.activeLayerId,
      direction,
    })) return null;
    const created = this.currentSnapshot.authoring.layers.find((layer) => !before.has(layer.id));
    if (!created) return null;
    this.activateLayer(created.id);
    return created.id;
  }

  /** @param {string} layerId @param {string} name */
  renameLayer(layerId, name) {
    const ok = this.#commit({ type: "renameLayer", layerId, name });
    if (ok) this.#message(`Renamed layer to ${name}`, true);
    return ok;
  }

  /** @param {string} layerId @param {number} baseY */
  setLayerBaseY(layerId, baseY) {
    const ok = this.#commit({ type: "setLayerBaseY", layerId, baseY });
    if (ok) this.#message(`Set layer height to ${baseY} m`, true);
    return ok;
  }

  /** @param {string} layerId */
  deleteLayer(layerId) {
    const ok = this.#commit({ type: "deleteLayer", layerId });
    if (ok) this.#message(`Deleted layer ${layerId}`, true);
    return ok;
  }

  /** @param {string} layerId */
  setPlayerStartLayer(layerId) {
    const ok = this.#commit({ type: "setPlayerStartLayer", layerId });
    if (ok) this.#message(`Player now starts on ${layerId}`, true);
    return ok;
  }

  validateMap() {
    const result = this.validateMapDocument();
    this.#message(
      `${result.errorCount ?? 0} map errors · ${result.warningCount ?? 0} warnings`,
      Number(result.errorCount ?? 0) === 0,
    );
    return result;
  }

  /** @param {number} x @param {number} z @param {boolean} [inside] */
  pointerMove(x, z, inside = true) {
    this.pointer = { x: Number(x), z: Number(z), inside: Boolean(inside) };
    if (this.gesture?.kind === "stroke") this.#addStrokeCell(x, z);
    if (this.gesture?.kind === "move") this.#updateMoveCandidate(x, z);
    if (this.gesture?.kind === "moveNavigationNode") this.#updateNavigationMoveCandidate(x, z);
    this.#refreshHoverAndPreview();
  }

  pointerLeave() {
    this.pointer.inside = false;
    this.state.setHoveredTarget(null);
    if (!this.gesture) this.state.setPlacementPreview(null);
  }

  /** @param {number} button @param {number} x @param {number} z */
  pointerDown(button, x, z) {
    if (button !== 0 && button !== 2) return false;
    this.pointerMove(x, z, true);
    const authoring = this.currentSnapshot.authoring;
    const effectiveTool = button === 2 ? "erase" : this.state.activeTool;
    const navigationTarget = pickNavigationEndpoint(authoring, x, z);
    const target = this.state.activeChannel === "navigation"
      ? navigationTarget ?? pickAuthoringTarget(authoring, x, z)
      : pickAuthoringTarget(authoring, x, z);
    if (effectiveTool === "link") {
      if (!navigationTarget) {
        this.#message("Choose a navigation node or visible connector endpoint", false);
        return false;
      }
      return this.#linkEndpoint(navigationTarget);
    }
    if (effectiveTool === "select") {
      this.state.setSelectedTarget(target);
      if (button === 0 && target?.kind === "instance") {
        const instance = this.#instance(target.instanceId);
        if (instance) {
          this.gesture = {
            kind: "move",
            button,
            instanceId: instance.id,
            definitionId: instance.definitionId,
            original: cloneTransform(instance),
            offsetX: instance.x - x,
            offsetZ: instance.z - z,
            candidate: cloneTransform(instance),
            validation: {
              valid: true,
              code: "unchanged",
              message: "Instance has not moved",
              occupiedCells: this.#instanceCells(instance),
              transform: cloneTransform(instance),
            },
            moved: false,
          };
        }
      }
      if (button === 0 && target?.kind === "navigation-node") {
        const node = this.#navigationNode(target.nodeId);
        if (node) {
          this.gesture = {
            kind: "moveNavigationNode",
            button,
            nodeId: node.id,
            original: { cx: node.cx, cz: node.cz },
            candidate: { cx: node.cx, cz: node.cz },
            moved: false,
          };
        }
      }
      this.#refreshHoverAndPreview();
      return true;
    }

    if (effectiveTool === "eyedropper") {
      this.gesture = { kind: "eyedropper", button };
      return true;
    }

    if (effectiveTool === "erase") {
      if (this.state.activeChannel === "navigation") {
        const picked = pickNavigationNode(authoring, x, z);
        this.gesture = picked
          ? { kind: "removeNavigationNode", button, nodeId: picked.nodeId }
          : null;
        this.state.setPlacementPreview(null);
        return Boolean(picked);
      }
      if (this.state.activeChannel === "connector") {
        const picked = pickAuthoredConnector(authoring, x, z);
        this.gesture = picked
          ? { kind: "removeConnector", button, connectorId: picked.connectorId }
          : null;
        this.state.setPlacementPreview(null);
        return Boolean(picked);
      }
      if (this.state.activeChannel === "instance") {
        const picked = pickAuthoredInstance(authoring, x, z);
        this.gesture = picked
          ? { kind: "remove", button, instanceId: picked.instanceId }
          : null;
        this.state.setPlacementPreview(null);
        return Boolean(picked);
      }
      const cell = authoringCellAt(authoring, x, z);
      if (!cell) return false;
      this.gesture = {
        kind: "stroke",
        button,
        operation: "erase",
        channel: this.state.activeChannel,
        definitionId: null,
        cells: new Map(),
      };
      this.#addStrokeCell(x, z);
      this.#refreshHoverAndPreview();
      return true;
    }

    if (this.state.activeChannel === "navigation") {
      const cell = authoringCellAt(authoring, x, z);
      if (!cell) return false;
      this.gesture = { kind: "placeNavigationNode", button, cell: { cx: cell.x, cz: cell.z } };
      this.#refreshHoverAndPreview();
      return true;
    }
    const definition = getPlaceableDefinition(this.state.selectedDefinitionId);
    if (!definition) return false;
    const channel = authoringChannelForDefinition(definition);
    if (channel !== this.state.activeChannel) return false;
    if (channel === "instance" || channel === "connector") {
      this.gesture = { kind: "stamp", button };
      this.#refreshHoverAndPreview();
      return true;
    }
    const cell = authoringCellAt(authoring, x, z);
    if (!cell) return false;
    this.gesture = {
      kind: "stroke",
      button,
      operation: "paint",
      channel,
      definitionId: definition.id,
      cells: new Map(),
    };
    this.#addStrokeCell(x, z);
    this.#refreshHoverAndPreview();
    return true;
  }

  /**
   * @param {number} button
   * @param {number} x
   * @param {number} z
   * @param {{moved?:boolean}} [options]
   */
  pointerUp(button, x, z, options = {}) {
    this.pointerMove(x, z, true);
    const gesture = this.gesture;
    if (!gesture || gesture.button !== button) return false;
    this.gesture = null;
    let result = false;
    if (gesture.kind === "stroke") result = this.#commitStroke(gesture);
    if (gesture.kind === "stamp") result = this.#commitStamp();
    if (gesture.kind === "remove") result = this.removeInstance(gesture.instanceId);
    if (gesture.kind === "removeConnector") result = this.removeConnector(gesture.connectorId);
    if (gesture.kind === "eyedropper") result = this.#sample(x, z);
    if (gesture.kind === "move") {
      const moved = Boolean(options.moved) || gesture.moved;
      if (!moved) {
        result = true;
      } else if (!gesture.validation.valid) {
        this.#message(gesture.validation.message, false);
      } else {
        result = this.updateInstanceTransform(
          gesture.instanceId,
          gesture.validation.transform,
        );
      }
    }
    if (gesture.kind === "placeNavigationNode") {
      result = this.placeNavigationNode(gesture.cell.cx, gesture.cell.cz);
    }
    if (gesture.kind === "removeNavigationNode") result = this.removeNavigationNode(gesture.nodeId);
    if (gesture.kind === "moveNavigationNode") {
      const moved = Boolean(options.moved) || gesture.moved;
      result = !moved || this.moveNavigationNode(
        gesture.nodeId,
        gesture.candidate.cx,
        gesture.candidate.cz,
      );
    }
    this.#refreshHoverAndPreview();
    return result;
  }

  cancel() {
    const hadGesture = Boolean(this.gesture) || this.state.cancelPendingLink();
    this.gesture = null;
    this.state.setPlacementPreview(null);
    return hadGesture;
  }

  rotate() {
    if (this.gesture?.kind === "move") {
      this.gesture.candidate.rotation = normalizeQuarterTurns(
        this.gesture.candidate.rotation + 1,
      );
      this.gesture.moved = true;
      this.#validateMoveCandidate();
      this.#refreshHoverAndPreview();
      return this.gesture.validation.valid;
    }
    const definition = getPlaceableDefinition(this.state.selectedDefinitionId);
    if (
      this.state.activeTool === "paint"
      && (definition?.placementTarget === "instance" || definition?.placementTarget === "connector")
    ) {
      this.state.rotatePreview();
      this.#refreshHoverAndPreview();
      return true;
    }
    if (this.state.selectedTarget?.kind === "instance") {
      const instance = this.#instance(this.state.selectedTarget.instanceId);
      return instance
        ? this.updateInstanceTransform(instance.id, {
          x: instance.x,
          z: instance.z,
          rotation: normalizeQuarterTurns(instance.rotation + 1),
        })
        : false;
    }
    return false;
  }

  /** @param {string} instanceId @param {{x:number,z:number,rotation:number}} transform */
  updateInstanceTransform(instanceId, transform) {
    const instance = this.#instance(instanceId);
    if (!instance) {
      this.state.setSelectedTarget(null);
      return false;
    }
    const validation = this.validatePlacement(
      instance.definitionId,
      Number(transform.x),
      Number(transform.z),
      Number(transform.rotation),
      instanceId,
      this.activeLayerId,
    );
    if (!validation.valid) {
      this.#message(validation.message, false);
      return false;
    }
    const result = this.#commit({
      type: "updateInstanceTransform",
      authoringId: instanceId,
      ...validation.transform,
    });
    if (result) {
      this.state.setSelectedTarget({
        kind: "instance",
        layerId: this.currentSnapshot.authoring.activeLayer.id,
        instanceId,
      });
      this.#message(`Updated ${instanceId}`, true);
    }
    return result;
  }

  /** @param {string} instanceId */
  removeInstance(instanceId) {
    if (!this.#instance(instanceId)) return false;
    const result = this.#commit({ type: "removeInstance", authoringId: instanceId });
    if (result && this.state.selectedTarget?.kind === "instance"
      && this.state.selectedTarget.instanceId === instanceId) {
      this.state.setSelectedTarget(null);
    }
    if (result) this.#message(`Removed ${instanceId}`, true);
    return result;
  }

  /** @param {number} cx @param {number} cz @param {boolean} [patrol] */
  placeNavigationNode(cx, cz, patrol = false) {
    const before = new Set((this.currentSnapshot.authoring.navigationNodes ?? []).map((node) => node.id));
    const result = this.#commit({
      type: "placeNavigationNode", cx: Math.floor(cx), cz: Math.floor(cz), patrol,
    });
    if (!result) return false;
    const node = (this.currentSnapshot.authoring.navigationNodes ?? []).find((candidate) => !before.has(candidate.id));
    if (node) this.state.setSelectedTarget({ kind: "navigation-node", layerId: node.layerId, nodeId: node.id });
    this.#message("Placed navigation node", true);
    return true;
  }

  /** @param {string} nodeId @param {number} cx @param {number} cz */
  moveNavigationNode(nodeId, cx, cz) {
    const node = this.#navigationNode(nodeId);
    if (!node) return false;
    const result = this.#commit({ type: "moveNavigationNode", nodeId, cx: Math.floor(cx), cz: Math.floor(cz) });
    if (result) {
      this.state.setSelectedTarget({ kind: "navigation-node", layerId: node.layerId, nodeId });
      this.#message(`Moved ${nodeId}`, true);
    }
    return result;
  }

  /** @param {string} nodeId @param {Record<string, unknown>} changes */
  updateNavigationNode(nodeId, changes) {
    if (!this.#navigationNode(nodeId)) return false;
    const result = this.#commit({ type: "updateNavigationNode", nodeId, changes });
    if (result) this.#message(`Updated ${nodeId}`, true);
    return result;
  }

  /** @param {string} nodeId */
  removeNavigationNode(nodeId) {
    if (!this.#navigationNode(nodeId)) return false;
    const result = this.#commit({ type: "removeNavigationNode", nodeId });
    if (result && this.state.selectedTarget?.kind === "navigation-node"
      && this.state.selectedTarget.nodeId === nodeId) this.state.setSelectedTarget(null);
    if (result) this.#message(`Removed ${nodeId}`, true);
    return result;
  }

  /** @param {string} connectorId */
  removeConnector(connectorId) {
    if (!this.#connector(connectorId)) return false;
    const result = this.#commit({ type: "removeConnector", connectorId });
    if (
      result
      && this.state.selectedTarget?.kind === "connector"
      && this.state.selectedTarget.connectorId === connectorId
    ) this.state.setSelectedTarget(null);
    if (result) this.#message(`Removed ${connectorId}`, true);
    return result;
  }

  /** @param {string} connectorId @param {Record<string,unknown>} changes */
  updateConnector(connectorId, changes) {
    if (!this.#connector(connectorId)) return false;
    const result = this.#commit({ type: "updateConnector", connectorId, changes });
    if (result) {
      const connector = this.#connector(connectorId);
      const layerId = connector?.lowerLayerId === this.activeLayerId
        || connector?.upperLayerId === this.activeLayerId
        ? this.activeLayerId
        : connector?.lowerLayerId;
      this.state.setSelectedTarget(layerId
        ? { kind: "connector", layerId, connectorId }
        : null);
      this.#message(`Updated ${connectorId}`, true);
    }
    return result;
  }

  /** @param {string} instanceId @param {Record<string,unknown>|undefined} properties */
  updateInstanceProperties(instanceId, properties) {
    if (!this.#instance(instanceId)) return false;
    const result = this.#commit({
      type: "updateInstanceProperties",
      authoringId: instanceId,
      properties,
    });
    if (result) this.#message(`Updated properties for ${instanceId}`, true);
    return result;
  }

  undo() {
    return this.#traverseHistory("undo");
  }

  redo() {
    return this.#traverseHistory("redo");
  }

  /** @param {string} instanceId */
  selectInstance(instanceId) {
    const instance = this.#instance(instanceId);
    if (!instance) return false;
    this.state.setSelectedTarget({
      kind: "instance",
      layerId: this.currentSnapshot.authoring.activeLayer.id,
      instanceId,
    });
    return true;
  }

  /** @param {string} connectorId */
  selectConnector(connectorId) {
    const connector = this.#connector(connectorId);
    if (!connector) return false;
    this.state.setSelectedTarget({
      kind: "connector",
      layerId: this.activeLayerId,
      connectorId,
    });
    return true;
  }

  /** @param {number} x @param {number} z */
  selectAt(x, z) {
    const target = this.state.activeChannel === "navigation"
      ? pickNavigationEndpoint(this.currentSnapshot.authoring, x, z)
        ?? pickAuthoringTarget(this.currentSnapshot.authoring, x, z)
      : pickAuthoringTarget(this.currentSnapshot.authoring, x, z);
    this.state.setSelectedTarget(target);
    return cloneTarget(target);
  }

  snapshot() {
    const hoveredInstance = this.state.hoveredTarget?.kind === "instance"
      ? this.#instance(this.state.hoveredTarget.instanceId)
      : null;
    const hoveredDefinition = hoveredInstance
      ? getPlaceableDefinition(hoveredInstance.definitionId)
      : null;
    const hoveredConnector = this.state.hoveredTarget?.kind === "connector"
      ? this.#connector(this.state.hoveredTarget.connectorId)
      : null;
    const hoveredConnectorDefinition = hoveredConnector
      ? getPlaceableDefinition(hoveredConnector.definitionId)
      : null;
    const history = {
      ...this.getHistorySnapshot(),
      transactionActive: Boolean(this.gesture),
    };
    return {
      ...this.state.snapshot(),
      activeLayerId: this.activeLayerId,
      referenceLayerId: this.referenceLayerId,
      referenceLayer: cloneLayerSnapshot(this.referenceLayer),
      layers: this.currentSnapshot.authoring.layers.map((layer) => ({ ...layer })),
      playerStartLayerId: this.currentSnapshot.authoring.playerStartLayerId,
      runtimeLayerId: this.currentSnapshot.authoring.runtimeLayerId,
      layerCapacity: this.currentSnapshot.authoring.layerCapacity,
      validation: {
        diagnostics: (this.currentSnapshot.authoring.validation?.diagnostics ?? [])
          .map((entry) => ({ ...entry })),
        errorCount: this.currentSnapshot.authoring.validation?.errorCount ?? 0,
        warningCount: this.currentSnapshot.authoring.validation?.warningCount ?? 0,
      },
      hoveredIdentity: hoveredInstance
        ? {
          authoringId: hoveredInstance.id,
          definitionId: hoveredInstance.definitionId,
          label: hoveredDefinition?.label ?? hoveredInstance.definitionId,
        }
        : hoveredConnector
          ? {
            authoringId: hoveredConnector.id,
            definitionId: hoveredConnector.definitionId,
            label: hoveredConnectorDefinition?.label ?? hoveredConnector.definitionId,
          }
          : null,
      dragging: this.gesture?.kind === "move" || this.gesture?.kind === "moveNavigationNode",
      pendingAction: this.gesture?.kind ?? (this.state.pendingLinkStart ? "link" : null),
      history,
      status: {
        message: this.lastMessage,
        valid: this.lastMessageValid,
      },
    };
  }

  #refreshHoverAndPreview() {
    const authoring = this.currentSnapshot.authoring;
    this.state.setHoveredTarget(
      this.pointer.inside
        ? pickAuthoringTarget(authoring, this.pointer.x, this.pointer.z)
        : null,
    );
    if (this.gesture?.kind === "move") {
      this.state.setPlacementPreview({
        kind: "move",
        instanceId: this.gesture.instanceId,
        definitionId: this.gesture.definitionId,
        ...this.gesture.validation,
      });
      return;
    }
    if (this.gesture?.kind === "moveNavigationNode") {
      this.state.setPlacementPreview({
        kind: "move-navigation-node",
        valid: true,
        occupiedCells: [{ ...this.gesture.candidate }],
      });
      return;
    }
    if (this.gesture?.kind === "placeNavigationNode") {
      this.state.setPlacementPreview({
        kind: "place-navigation-node",
        valid: true,
        occupiedCells: [{ ...this.gesture.cell }],
      });
      return;
    }
    if (this.gesture?.kind === "stroke") {
      this.state.setPlacementPreview({
        kind: this.gesture.operation,
        channel: this.gesture.channel,
        definitionId: this.gesture.definitionId,
        valid: true,
        code: "stroke",
        message: "Pending authoring stroke",
        occupiedCells: [...this.gesture.cells.values()].map((cell) => ({ ...cell })),
      });
      return;
    }
    const definition = getPlaceableDefinition(this.state.selectedDefinitionId);
    if (this.state.activeTool === "paint" && this.state.activeChannel === "navigation" && this.pointer.inside) {
      const cell = authoringCellAt(authoring, this.pointer.x, this.pointer.z);
      this.state.setPlacementPreview(cell ? {
        kind: "place-navigation-node",
        valid: true,
        occupiedCells: [{ cx: cell.x, cz: cell.z }],
      } : null);
      return;
    }
    if (
      this.state.activeTool !== "paint"
      || (definition?.placementTarget !== "instance" && definition?.placementTarget !== "connector")
      || !this.pointer.inside
    ) {
      this.state.setPlacementPreview(null);
      return;
    }
    try {
      const snapped = snapDefinitionPlacement(definition.id, this.pointer.x, this.pointer.z);
      if (definition.placementTarget === "connector") {
        const pair = this.#connectorLayerPair();
        const layer = this.currentSnapshot.authoring.activeLayer;
        const inside = pair
          && snapped.x >= 0
          && snapped.z >= 0
          && snapped.x < layer.width
          && snapped.z < layer.height;
        this.state.setPlacementPreview({
          kind: "place",
          definitionId: definition.id,
          valid: Boolean(inside),
          code: inside ? "valid" : pair ? "bounds" : "layers",
          message: inside
            ? `Links ${pair.lowerLayerId} to ${pair.upperLayerId}`
            : pair
              ? "Elevator endpoint is outside the shared map bounds"
              : "Select a floor with a higher floor above it before placing an elevator",
          transform: { x: snapped.x, z: snapped.z, rotation: 0 },
          occupiedCells: inside
            ? [{ cx: Math.min(layer.width - 1, Math.floor(snapped.x)), cz: Math.min(layer.height - 1, Math.floor(snapped.z)) }]
            : [],
          ...(pair ?? {}),
        });
        return;
      }
      const validation = this.validatePlacement(
        definition.id,
        snapped.x,
        snapped.z,
        this.state.previewRotation,
        null,
        this.activeLayerId,
      );
      this.state.setPlacementPreview({
        kind: "place",
        definitionId: definition.id,
        ...validation,
      });
    } catch (error) {
      this.state.setPlacementPreview({
        kind: "place",
        definitionId: definition.id,
        valid: false,
        code: "position",
        message: error instanceof Error ? error.message : String(error),
        transform: {
          x: this.pointer.x,
          z: this.pointer.z,
          rotation: this.state.previewRotation,
        },
        occupiedCells: [],
      });
    }
  }

  /** @param {number} x @param {number} z */
  #addStrokeCell(x, z) {
    const cell = authoringCellAt(this.currentSnapshot.authoring, x, z);
    if (!cell || this.gesture?.kind !== "stroke") return;
    const normalized = { cx: cell.x, cz: cell.z };
    this.gesture.cells.set(cellKey(normalized), normalized);
  }

  /** @param {number} x @param {number} z */
  #updateMoveCandidate(x, z) {
    if (this.gesture?.kind !== "move") return;
    const definition = getPlaceableDefinition(this.gesture.definitionId);
    if (!definition) return;
    const rawX = x + this.gesture.offsetX;
    const rawZ = z + this.gesture.offsetZ;
    const snapped = snapDefinitionPlacement(definition.id, rawX, rawZ);
    this.gesture.moved = this.gesture.moved
      || Math.hypot(
        snapped.x - this.gesture.original.x,
        snapped.z - this.gesture.original.z,
      ) > 0.001;
    this.gesture.candidate.x = snapped.x;
    this.gesture.candidate.z = snapped.z;
    this.#validateMoveCandidate();
  }

  /** @param {number} x @param {number} z */
  #updateNavigationMoveCandidate(x, z) {
    if (this.gesture?.kind !== "moveNavigationNode") return;
    const cell = authoringCellAt(this.currentSnapshot.authoring, x, z);
    if (!cell) return;
    this.gesture.candidate = { cx: cell.x, cz: cell.z };
    this.gesture.moved = this.gesture.moved
      || cell.x !== this.gesture.original.cx
      || cell.z !== this.gesture.original.cz;
  }

  #validateMoveCandidate() {
    if (this.gesture?.kind !== "move") return;
    this.gesture.validation = this.validatePlacement(
      this.gesture.definitionId,
      this.gesture.candidate.x,
      this.gesture.candidate.z,
      this.gesture.candidate.rotation,
      this.gesture.instanceId,
      this.activeLayerId,
    );
  }

  /** @param {Record<string,any>} gesture */
  #commitStroke(gesture) {
    const cells = [...gesture.cells.values()].map((cell) => ({ ...cell }));
    if (cells.length === 0) return false;
    let type;
    if (gesture.operation === "erase") {
      type = gesture.channel === "surface" ? "eraseSurfaceStroke" : "eraseStructureStroke";
    } else {
      type = gesture.channel === "surface" ? "paintSurfaceStroke" : "paintStructureStroke";
    }
    const result = this.#commit({
      type,
      cells,
      ...(gesture.definitionId ? { definitionId: gesture.definitionId } : {}),
    });
    if (result) {
      const last = cells[cells.length - 1];
      this.state.setSelectedTarget({
        kind: "cell",
        layerId: this.currentSnapshot.authoring.activeLayer.id,
        x: last.cx,
        z: last.cz,
      });
      this.#message(
        `${gesture.operation === "erase" ? "Erased" : "Painted"} ${cells.length} cell${cells.length === 1 ? "" : "s"}`,
        true,
      );
    }
    return result;
  }

  #commitStamp() {
    const preview = this.state.placementPreview;
    if (!preview?.valid) {
      this.#message(preview?.message ?? "Placement is invalid", false);
      return false;
    }
    if (preview.definitionId === "connector.elevator.two-stop") {
      const before = new Set((this.currentSnapshot.authoring.connectors ?? []).map((item) => item.id));
      const result = this.#commit({
        type: "placeConnector",
        definitionId: preview.definitionId,
        lowerLayerId: preview.lowerLayerId,
        upperLayerId: preview.upperLayerId,
        x: preview.transform.x,
        z: preview.transform.z,
      });
      if (!result) return false;
      const placed = this.currentSnapshot.authoring.connectors.find((item) => !before.has(item.id));
      if (placed) this.selectConnector(placed.id);
      this.#message(`Placed ${preview.definitionId}`, true);
      return true;
    }
    const before = new Set(this.currentSnapshot.authoring.instances.map((instance) => instance.id));
    const result = this.#commit({
      type: "placeInstance",
      definitionId: preview.definitionId,
      ...preview.transform,
    });
    if (!result) return false;
    const placed = this.currentSnapshot.authoring.instances.find((instance) => !before.has(instance.id));
    if (placed) this.selectInstance(placed.id);
    this.#message(`Placed ${preview.definitionId}`, true);
    return true;
  }

  /** @param {number} x @param {number} z */
  #sample(x, z) {
    const sampled = sampleAuthoredDefinition(
      this.currentSnapshot,
      x,
      z,
      this.state.activeChannel,
    );
    if (!sampled) {
      this.#message("Nothing authored here to sample", false);
      return false;
    }
    this.state.setDefinition(sampled.definitionId);
    this.state.setSelectedTarget(sampled.target);
    this.#message(`Sampled ${sampled.definitionId}`, true);
    return true;
  }

  /** @param {Record<string, any>} endpoint */
  #linkEndpoint(endpoint) {
    const start = this.state.pendingLinkStart;
    if (!start) {
      this.state.setPendingLinkStart(endpoint);
      this.state.setSelectedTarget(endpoint);
      this.#message("Link start selected; choose a second endpoint", true);
      return true;
    }
    this.state.cancelPendingLink();
    if (start.layerId !== endpoint.layerId) {
      this.#message("Authored navigation links must remain on one layer", false);
      return false;
    }
    const a = this.#linkEndpointPayload(start);
    const b = this.#linkEndpointPayload(endpoint);
    if (JSON.stringify(a) === JSON.stringify(b)) {
      this.#message("Choose a different navigation endpoint", false);
      return false;
    }
    const result = this.#commit({ type: "placeNavigationLink", a, b });
    if (result) {
      this.state.setSelectedTarget(endpoint);
      this.#message("Placed navigation link", true);
    }
    return result;
  }

  /** @param {Record<string, any>} endpoint */
  #linkEndpointPayload(endpoint) {
    return endpoint.kind === "navigation-node"
      ? { kind: "node", nodeId: endpoint.nodeId }
      : { kind: "connector-endpoint", connectorId: endpoint.connectorId, stop: endpoint.stop };
  }

  /** @param {Record<string,unknown>} action */
  #commit(action) {
    const scopedAction = LAYER_SCOPED_ACTIONS.has(String(action.type))
      && typeof action.layerId !== "string"
      ? { ...action, layerId: this.activeLayerId }
      : action;
    const result = this.commitAction(scopedAction);
    if (result.snapshot) this.currentSnapshot = result.snapshot;
    this.#reconcileLayers();
    this.state.reconcile(this.currentSnapshot.authoring);
    if (!result.ok) this.#message(result.error ?? "Authoring action was rejected", false);
    return result.ok;
  }

  /** @param {"undo"|"redo"} operation */
  #traverseHistory(operation) {
    if (this.gesture) {
      this.cancel();
      this.#refreshHoverAndPreview();
      this.#message(`Canceled pending edit; ${operation} was not run`, true);
      return false;
    }
    const result = operation === "undo" ? this.undoHistory() : this.redoHistory();
    if (result.snapshot) this.currentSnapshot = result.snapshot;
    this.#reconcileLayers();
    this.state.reconcile(this.currentSnapshot.authoring);
    this.#refreshHoverAndPreview();
    if (!result.ok) {
      this.#message(result.error ?? `Nothing to ${operation}`, false);
      return false;
    }
    this.#message(
      `${operation === "undo" ? "Undid" : "Redid"} ${result.label ?? "authoring action"}`,
      true,
    );
    return true;
  }

  /** @param {string} instanceId */
  #instance(instanceId) {
    return this.currentSnapshot.authoring.instances.find(
      (instance) => instance.id === instanceId,
    ) ?? null;
  }

  /** @param {string} nodeId */
  #navigationNode(nodeId) {
    return (this.currentSnapshot.authoring.navigationNodes ?? []).find(
      (node) => node.id === nodeId,
    ) ?? null;
  }

  /** @param {string} connectorId */
  #connector(connectorId) {
    return (this.currentSnapshot.authoring.connectors ?? []).find(
      (connector) => connector.id === connectorId,
    ) ?? null;
  }

  #connectorLayerPair() {
    const layers = [...(this.currentSnapshot.authoring.layers ?? [])];
    const active = layers.find((layer) => layer.id === this.activeLayerId);
    if (!active || layers.length < 2) return null;
    const other = layers
      .filter((layer) => layer.baseY > active.baseY)
      .sort((left, right) => (
        left.baseY - right.baseY
        || left.id.localeCompare(right.id)
      ))[0];
    if (!other) return null;
    return { lowerLayerId: active.id, upperLayerId: other.id };
  }

  #reconcileLayers() {
    const authoring = this.currentSnapshot.authoring;
    const layerIds = new Set((authoring.layers ?? []).map((layer) => layer.id));
    const activeLayerId = authoring.activeEditorLayerId ?? authoring.activeLayer?.id;
    if (typeof activeLayerId === "string" && layerIds.has(activeLayerId)) {
      this.activeLayerId = activeLayerId;
    }
    if (
      !this.referenceLayerId
      || this.referenceLayerId === this.activeLayerId
      || !layerIds.has(this.referenceLayerId)
    ) {
      this.referenceLayerId = null;
      this.referenceLayer = null;
      this.referenceRevision = null;
      return;
    }
    if (this.referenceRevision !== authoring.revision) {
      const referenceLayer = this.getLayerSnapshot(this.referenceLayerId);
      if (!referenceLayer) {
        this.referenceLayerId = null;
        this.referenceLayer = null;
        this.referenceRevision = null;
        return;
      }
      this.referenceLayer = referenceLayer;
      this.referenceRevision = authoring.revision;
    }
  }

  /** @param {Record<string,any>} instance */
  #instanceCells(instance) {
    if (Array.isArray(instance.occupiedCells)) {
      return instance.occupiedCells.map((cell) => ({ ...cell }));
    }
    const definition = getPlaceableDefinition(instance.definitionId);
    return definition ? getOccupiedCells(definition, instance) : [];
  }

  /** @param {string} message @param {boolean} valid */
  #message(message, valid) {
    this.lastMessage = String(message);
    this.lastMessageValid = Boolean(valid);
    this.announce(this.lastMessage);
  }
}

/**
 * Renderer helper kept here so Canvas and Three observe the same selection
 * footprint without depending on DOM panels.
 * @param {Record<string,any>} snapshot
 * @param {Record<string,any>|null} target
 */
export function editorTargetCells(snapshot, target) {
  return occupiedCellsForTarget(snapshot.authoring, target);
}
