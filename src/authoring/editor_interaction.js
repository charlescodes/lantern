// @ts-check

import {
  getPlaceableDefinition,
  listPlaceableDefinitions,
} from "./definition_catalog.js";
import {
  getOccupiedCells,
  normalizeQuarterTurns,
  pointHitsInstanceExtent,
} from "./footprint.js";

export const EDITOR_TOOLS = Object.freeze(["select", "paint", "erase", "eyedropper", "link"]);
export const AUTHORING_CHANNELS = Object.freeze(["surface", "structure", "instance", "connector", "navigation"]);

/** @param {Record<string, any>} definition */
export function authoringChannelForDefinition(definition) {
  if (definition?.placementTarget === "surface") return "surface";
  if (definition?.placementTarget === "structure") return "structure";
  if (definition?.placementTarget === "instance") return "instance";
  if (definition?.placementTarget === "connector") return "connector";
  return null;
}

/** @param {Record<string, any>} authoring @param {number} worldX @param {number} worldZ */
export function authoringCellAt(authoring, worldX, worldZ) {
  const layer = authoring?.activeLayer;
  if (!layer || !Number.isFinite(worldX) || !Number.isFinite(worldZ)) return null;
  const x = Math.floor(worldX);
  const z = Math.floor(worldZ);
  if (x < 0 || z < 0 || x >= layer.width || z >= layer.height) return null;
  return { x, z };
}

/**
 * Picking is authoring-only and deterministic. Later document placement wins;
 * the stable authoring ID is the final tie-breaker. Runtime pool order and
 * runtime movement are deliberately ignored.
 * @param {Record<string, any>} authoring
 * @param {number} worldX
 * @param {number} worldZ
 */
export function pickAuthoredInstance(authoring, worldX, worldZ) {
  if (!authoringCellAt(authoring, worldX, worldZ)) return null;
  const matches = [];
  for (let index = 0; index < authoring.instances.length; index += 1) {
    const instance = authoring.instances[index];
    const definition = getPlaceableDefinition(instance.definitionId);
    if (definition && pointHitsInstanceExtent(definition, instance, worldX, worldZ)) {
      matches.push({ instance, placementIndex: index });
    }
  }
  matches.sort((left, right) => (
    right.placementIndex - left.placementIndex
    || String(right.instance.id).localeCompare(String(left.instance.id))
  ));
  const winner = matches[0]?.instance;
  return winner
    ? {
      kind: /** @type {const} */ ("instance"),
      layerId: authoring.activeLayer.id,
      instanceId: winner.id,
    }
    : null;
}

/** Map-level connectors are selectable from either endpoint layer. */
export function pickAuthoredConnector(authoring, worldX, worldZ) {
  if (!authoringCellAt(authoring, worldX, worldZ)) return null;
  const activeLayerId = authoring.activeLayer.id;
  const matches = [];
  for (let index = 0; index < (authoring.connectors ?? []).length; index += 1) {
    const connector = authoring.connectors[index];
    if (connector.lowerLayerId !== activeLayerId && connector.upperLayerId !== activeLayerId) continue;
    const half = Number(connector.platformWidth) / 2;
    if (
      Math.abs(worldX - Number(connector.x)) <= half
      && Math.abs(worldZ - Number(connector.z)) <= half
    ) matches.push({ connector, placementIndex: index });
  }
  matches.sort((left, right) => (
    right.placementIndex - left.placementIndex
    || String(right.connector.id).localeCompare(String(left.connector.id))
  ));
  const winner = matches[0]?.connector;
  return winner
    ? { kind: "connector", layerId: activeLayerId, connectorId: winner.id }
    : null;
}

/**
 * Picks an authored navigation node on the active editor layer. Nodes are
 * intentionally cell anchored: pointer and inspector edits share that same
 * integer cell coordinate contract.
 */
export function pickNavigationNode(authoring, worldX, worldZ) {
  const cell = authoringCellAt(authoring, worldX, worldZ);
  if (!cell) return null;
  const node = (authoring.navigationNodes ?? []).find((candidate) => (
    candidate.layerId === authoring.activeLayer.id
    && candidate.cx === cell.x
    && candidate.cz === cell.z
  ));
  return node
    ? { kind: "navigation-node", layerId: node.layerId, nodeId: node.id }
    : null;
}

/**
 * Picks the visible stop port for a two-stop connector. This exposes authored
 * graph endpoints without coupling the editor to a body's runtime layer.
 */
export function pickConnectorEndpoint(authoring, worldX, worldZ) {
  const connector = pickAuthoredConnector(authoring, worldX, worldZ);
  if (!connector) return null;
  const source = (authoring.connectors ?? []).find((candidate) => candidate.id === connector.connectorId);
  if (!source) return null;
  const stop = source.lowerLayerId === authoring.activeLayer.id ? "lower" : "upper";
  return {
    kind: "connector-endpoint",
    layerId: authoring.activeLayer.id,
    connectorId: source.id,
    stop,
  };
}

/** @param {Record<string, any>} authoring @param {number} worldX @param {number} worldZ */
export function pickNavigationEndpoint(authoring, worldX, worldZ) {
  return pickNavigationNode(authoring, worldX, worldZ)
    ?? pickConnectorEndpoint(authoring, worldX, worldZ);
}

/**
 * @param {Record<string, any>} authoring
 * @param {number} worldX
 * @param {number} worldZ
 */
export function pickAuthoringTarget(authoring, worldX, worldZ) {
  const cell = authoringCellAt(authoring, worldX, worldZ);
  if (!cell) return null;
  return pickAuthoredConnector(authoring, worldX, worldZ)
    ?? pickAuthoredInstance(authoring, worldX, worldZ)
    ?? {
    kind: /** @type {const} */ ("cell"),
    layerId: authoring.activeLayer.id,
    x: cell.x,
    z: cell.z,
  };
}

/** @param {Record<string, any>} authoring @param {Record<string, any>|null} target */
export function reconcileAuthoringTarget(authoring, target) {
  if (!target || target.layerId !== authoring?.activeLayer?.id) return null;
  if (target.kind === "instance") {
    return authoring.instances.some((instance) => instance.id === target.instanceId)
      ? { kind: "instance", layerId: target.layerId, instanceId: target.instanceId }
      : null;
  }
  if (target.kind === "connector") {
    const connector = (authoring.connectors ?? []).find(
      (candidate) => candidate.id === target.connectorId,
    );
    return connector
      && (connector.lowerLayerId === target.layerId || connector.upperLayerId === target.layerId)
      ? { kind: "connector", layerId: target.layerId, connectorId: target.connectorId }
      : null;
  }
  if (target.kind === "navigation-node") {
    const node = (authoring.navigationNodes ?? []).find((candidate) => candidate.id === target.nodeId);
    return node && node.layerId === target.layerId
      ? { kind: "navigation-node", layerId: target.layerId, nodeId: node.id }
      : null;
  }
  if (target.kind === "connector-endpoint") {
    const connector = (authoring.connectors ?? []).find((candidate) => candidate.id === target.connectorId);
    const visible = connector && (
      (target.stop === "lower" && connector.lowerLayerId === target.layerId)
      || (target.stop === "upper" && connector.upperLayerId === target.layerId)
    );
    return visible
      ? {
        kind: "connector-endpoint",
        layerId: target.layerId,
        connectorId: target.connectorId,
        stop: target.stop,
      }
      : null;
  }
  if (target.kind === "cell") {
    const layer = authoring.activeLayer;
    return Number.isInteger(target.x)
      && Number.isInteger(target.z)
      && target.x >= 0
      && target.z >= 0
      && target.x < layer.width
      && target.z < layer.height
      ? { kind: "cell", layerId: target.layerId, x: target.x, z: target.z }
      : null;
  }
  return null;
}

/** @param {Record<string, any>} authoring @param {Record<string, any>|null} target */
export function occupiedCellsForTarget(authoring, target) {
  const reconciled = reconcileAuthoringTarget(authoring, target);
  if (!reconciled) return [];
  if (reconciled.kind === "cell") return [{ cx: reconciled.x, cz: reconciled.z }];
  if (reconciled.kind === "connector") {
    const connector = (authoring.connectors ?? []).find(
      (candidate) => candidate.id === reconciled.connectorId,
    );
    return connector ? [{ cx: Math.floor(connector.x), cz: Math.floor(connector.z) }] : [];
  }
  if (reconciled.kind === "navigation-node") {
    const node = (authoring.navigationNodes ?? []).find((candidate) => candidate.id === reconciled.nodeId);
    return node ? [{ cx: node.cx, cz: node.cz }] : [];
  }
  if (reconciled.kind === "connector-endpoint") {
    const connector = (authoring.connectors ?? []).find(
      (candidate) => candidate.id === reconciled.connectorId,
    );
    return connector ? [{ cx: Math.floor(connector.x), cz: Math.floor(connector.z) }] : [];
  }
  const instance = authoring.instances.find(
    (candidate) => candidate.id === reconciled.instanceId,
  );
  const definition = instance && getPlaceableDefinition(instance.definitionId);
  return instance && definition ? getOccupiedCells(definition, instance) : [];
}

/** @param {Record<string, any>} snapshot @param {number} cx @param {number} cz */
function definitionAtCell(snapshot, cx, cz, channel) {
  const layer = snapshot.authoring?.activeLayer;
  const grid = snapshot.map?.[channel];
  if (!layer || !grid || cx < 0 || cz < 0 || cx >= layer.width || cz >= layer.height) {
    return null;
  }
  return grid.legend[grid.cells[cz * layer.width + cx]] ?? null;
}

/**
 * Samples source definitions, preferring the explicit channel. Missing-channel
 * fallback is deterministic: instance, structure, then surface.
 * @param {Record<string, any>} snapshot
 * @param {number} worldX
 * @param {number} worldZ
 * @param {"surface"|"structure"|"instance"|"connector"} activeChannel
 */
export function sampleAuthoredDefinition(snapshot, worldX, worldZ, activeChannel) {
  const authoring = snapshot.authoring;
  const cell = authoringCellAt(authoring, worldX, worldZ);
  if (!cell) return null;
  const sampleChannel = (channel) => {
    if (channel === "connector") {
      const target = pickAuthoredConnector(authoring, worldX, worldZ);
      if (!target) return null;
      const connector = authoring.connectors.find(
        (candidate) => candidate.id === target.connectorId,
      );
      return connector
        ? { definitionId: connector.definitionId, channel, target }
        : null;
    }
    if (channel === "instance") {
      const target = pickAuthoredInstance(authoring, worldX, worldZ);
      if (!target) return null;
      const instance = authoring.instances.find(
        (candidate) => candidate.id === target.instanceId,
      );
      return instance
        ? { definitionId: instance.definitionId, channel, target }
        : null;
    }
    const definitionId = definitionAtCell(snapshot, cell.x, cell.z, channel);
    return definitionId
      ? {
        definitionId,
        channel,
        target: {
          kind: "cell",
          layerId: authoring.activeLayer.id,
          x: cell.x,
          z: cell.z,
        },
      }
      : null;
  };
  const order = [activeChannel, "connector", "instance", "structure", "surface"];
  const visited = new Set();
  for (const channel of order) {
    if (visited.has(channel)) continue;
    visited.add(channel);
    const sampled = sampleChannel(channel);
    if (sampled) return sampled;
  }
  return null;
}

export class EditorInteractionState {
  /** @param {{selectedDefinitionId?:string}} [options] */
  constructor(options = {}) {
    this.activeTool = "paint";
    this.activeChannel = "structure";
    this.selectedDefinitionId = null;
    this.hoveredTarget = null;
    this.selectedTarget = null;
    this.previewRotation = 0;
    this.placementPreview = null;
    this.showAuthoringExtents = false;
    this.pendingLinkStart = null;
    this.setDefinition(options.selectedDefinitionId ?? "structure.wall");
  }

  /** @param {string} tool */
  setTool(tool) {
    if (!EDITOR_TOOLS.includes(tool)) throw new RangeError(`Unknown editor tool "${tool}"`);
    this.activeTool = tool;
    this.placementPreview = null;
    if (tool !== "link") this.pendingLinkStart = null;
  }

  /** @param {string} channel */
  setChannel(channel) {
    if (!AUTHORING_CHANNELS.includes(channel)) {
      throw new RangeError(`Unknown authoring channel "${channel}"`);
    }
    this.activeChannel = channel;
    this.placementPreview = null;
    if (channel !== "navigation") this.pendingLinkStart = null;
  }

  /** @param {string} definitionId */
  setDefinition(definitionId) {
    const definition = getPlaceableDefinition(definitionId);
    const channel = definition && authoringChannelForDefinition(definition);
    if (!definition || !channel) {
      throw new RangeError(`Unknown placeable definition "${definitionId}"`);
    }
    this.selectedDefinitionId = definition.id;
    this.activeChannel = channel;
    this.activeTool = "paint";
    this.previewRotation = 0;
    this.placementPreview = null;
  }

  /** @param {number} delta */
  rotatePreview(delta = 1) {
    this.previewRotation = normalizeQuarterTurns(this.previewRotation + delta);
    return this.previewRotation;
  }

  /** @param {Record<string, any>|null} target */
  setHoveredTarget(target) {
    this.hoveredTarget = target ? { ...target } : null;
  }

  /** @param {Record<string, any>|null} target */
  setSelectedTarget(target) {
    this.selectedTarget = target ? { ...target } : null;
  }

  /** @param {Record<string, any>|null} endpoint */
  setPendingLinkStart(endpoint) {
    this.pendingLinkStart = endpoint ? { ...endpoint } : null;
  }

  cancelPendingLink() {
    const pending = Boolean(this.pendingLinkStart);
    this.pendingLinkStart = null;
    return pending;
  }

  /** @param {Record<string, any>|null} preview */
  setPlacementPreview(preview) {
    this.placementPreview = preview ? JSON.parse(JSON.stringify(preview)) : null;
  }

  /** @param {Record<string, any>} authoring */
  reconcile(authoring) {
    this.hoveredTarget = reconcileAuthoringTarget(authoring, this.hoveredTarget);
    this.selectedTarget = reconcileAuthoringTarget(authoring, this.selectedTarget);
    this.pendingLinkStart = reconcileAuthoringTarget(authoring, this.pendingLinkStart);
  }

  /** @param {boolean} value */
  setShowAuthoringExtents(value) {
    this.showAuthoringExtents = Boolean(value);
  }

  snapshot() {
    return {
      activeTool: this.activeTool,
      activeChannel: this.activeChannel,
      selectedDefinitionId: this.selectedDefinitionId,
      hoveredTarget: this.hoveredTarget ? { ...this.hoveredTarget } : null,
      selectedTarget: this.selectedTarget ? { ...this.selectedTarget } : null,
      pendingLinkStart: this.pendingLinkStart ? { ...this.pendingLinkStart } : null,
      previewRotation: this.previewRotation,
      placementPreview: this.placementPreview
        ? JSON.parse(JSON.stringify(this.placementPreview))
        : null,
      showAuthoringExtents: this.showAuthoringExtents,
      availableDefinitionIds: listPlaceableDefinitions().map((definition) => definition.id),
    };
  }
}
