// @ts-check

import { snapDefinitionPlacement } from "../authoring/authoring_commands.js";
import {
  AUTHORING_CHANNELS,
  authoringCellAt,
  authoringChannelForDefinition,
  EditorInteractionState,
  occupiedCellsForTarget,
  pickAuthoredInstance,
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

export class AuthoringEditorController {
  /**
   * @param {{
   * snapshot:Record<string,any>,
   * validatePlacement:(definitionId:string,x:number,z:number,rotation:number,ignoreId?:string|null)=>Record<string,any>,
   * commit:(action:Record<string,unknown>)=>{ok:boolean,error?:string|null,snapshot?:Record<string,any>},
   * announce?:(message:string)=>void,
   * }} options
   */
  constructor(options) {
    this.currentSnapshot = options.snapshot;
    this.validatePlacement = options.validatePlacement;
    this.commitAction = options.commit;
    this.announce = options.announce ?? (() => {});
    this.state = new EditorInteractionState({ selectedDefinitionId: "structure.wall" });
    this.pointer = { x: 0, z: 0, inside: false };
    this.gesture = null;
    this.lastMessage = "";
    this.lastMessageValid = true;
    this.state.reconcile(this.currentSnapshot.authoring);
  }

  /** @param {Record<string,any>} snapshot @param {{x:number,z:number,inside:boolean}} [pointer] */
  sync(snapshot, pointer) {
    this.currentSnapshot = snapshot;
    if (pointer) this.pointer = { ...pointer };
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
    if (this.state.activeTool === "paint") {
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

  /** @param {number} x @param {number} z @param {boolean} [inside] */
  pointerMove(x, z, inside = true) {
    this.pointer = { x: Number(x), z: Number(z), inside: Boolean(inside) };
    if (this.gesture?.kind === "stroke") this.#addStrokeCell(x, z);
    if (this.gesture?.kind === "move") this.#updateMoveCandidate(x, z);
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
    const target = pickAuthoringTarget(authoring, x, z);
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
      this.#refreshHoverAndPreview();
      return true;
    }

    if (effectiveTool === "eyedropper") {
      this.gesture = { kind: "eyedropper", button };
      return true;
    }

    if (effectiveTool === "erase") {
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

    const definition = getPlaceableDefinition(this.state.selectedDefinitionId);
    if (!definition) return false;
    const channel = authoringChannelForDefinition(definition);
    if (channel !== this.state.activeChannel) return false;
    if (channel === "instance") {
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
    this.#refreshHoverAndPreview();
    return result;
  }

  cancel() {
    const hadGesture = Boolean(this.gesture);
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
    if (this.state.activeTool === "paint" && definition?.placementTarget === "instance") {
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

  /** @param {number} x @param {number} z */
  selectAt(x, z) {
    const target = pickAuthoringTarget(this.currentSnapshot.authoring, x, z);
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
    return {
      ...this.state.snapshot(),
      hoveredIdentity: hoveredInstance
        ? {
          authoringId: hoveredInstance.id,
          definitionId: hoveredInstance.definitionId,
          label: hoveredDefinition?.label ?? hoveredInstance.definitionId,
        }
        : null,
      dragging: this.gesture?.kind === "move",
      pendingAction: this.gesture?.kind ?? null,
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
    if (
      this.state.activeTool !== "paint"
      || definition?.placementTarget !== "instance"
      || !this.pointer.inside
    ) {
      this.state.setPlacementPreview(null);
      return;
    }
    try {
      const snapped = snapDefinitionPlacement(definition.id, this.pointer.x, this.pointer.z);
      const validation = this.validatePlacement(
        definition.id,
        snapped.x,
        snapped.z,
        this.state.previewRotation,
        null,
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

  #validateMoveCandidate() {
    if (this.gesture?.kind !== "move") return;
    this.gesture.validation = this.validatePlacement(
      this.gesture.definitionId,
      this.gesture.candidate.x,
      this.gesture.candidate.z,
      this.gesture.candidate.rotation,
      this.gesture.instanceId,
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

  /** @param {Record<string,unknown>} action */
  #commit(action) {
    const result = this.commitAction(action);
    if (result.snapshot) this.currentSnapshot = result.snapshot;
    this.state.reconcile(this.currentSnapshot.authoring);
    if (!result.ok) this.#message(result.error ?? "Authoring action was rejected", false);
    return result.ok;
  }

  /** @param {string} instanceId */
  #instance(instanceId) {
    return this.currentSnapshot.authoring.instances.find(
      (instance) => instance.id === instanceId,
    ) ?? null;
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
