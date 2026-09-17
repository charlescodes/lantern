// @ts-check

import { NAVIGATION_TOPOLOGY } from "../config.js";
import {
  NAVIGATION_NEIGHBORS,
  NAVIGATION_UNREACHABLE,
  navigationCanTraverse,
} from "../sim/navigation_field.js";
import { StaticGridCosts } from "../sim/navigation_topology.js";
import {
  placeNavigationLink,
  placeNavigationNode,
} from "./authoring_commands.js";
import { getPlaceableDefinition } from "./definition_catalog.js";
import { getOccupiedCells } from "./footprint.js";
import { compileAuthoringMap } from "./map_compiler.js";

const CARDINAL_NEIGHBORS = Object.freeze(NAVIGATION_NEIGHBORS.slice(0, 4));

/** @param {Record<string,any>} endpoint */
function endpointKey(endpoint) {
  return endpoint.kind === "node"
    ? `node:${endpoint.nodeId}`
    : `connector:${endpoint.connectorId}:${endpoint.stop}`;
}

/** @param {Record<string,any>} document @param {Record<string,any>} endpoint */
function endpointLayerId(document, endpoint) {
  if (endpoint.kind === "node") {
    return document.navigationNodes.find((node) => node.id === endpoint.nodeId)?.layerId ?? null;
  }
  const connector = document.connectors.find((candidate) => candidate.id === endpoint.connectorId);
  if (!connector) return null;
  return endpoint.stop === "lower" ? connector.lowerLayerId : connector.upperLayerId;
}

class DisjointSet {
  /** @param {string[]} keys */
  constructor(keys) {
    this.parent = new Map(keys.map((key) => [key, key]));
  }

  /** @param {string} key */
  find(key) {
    const parent = this.parent.get(key);
    if (parent === undefined) return null;
    if (parent === key) return key;
    const root = this.find(parent);
    if (root !== null) this.parent.set(key, root);
    return root;
  }

  /** @param {string} left @param {string} right */
  union(left, right) {
    const leftRoot = this.find(left);
    const rightRoot = this.find(right);
    if (leftRoot === null || rightRoot === null || leftRoot === rightRoot) return false;
    const [first, second] = leftRoot.localeCompare(rightRoot) <= 0
      ? [leftRoot, rightRoot]
      : [rightRoot, leftRoot];
    this.parent.set(second, first);
    return true;
  }
}

/** @param {Record<string,any>} document @param {string} layerId */
function layerGraph(document, layerId) {
  const nodes = document.navigationNodes.filter((node) => node.layerId === layerId);
  const connectorEndpoints = document.connectors.flatMap((connector) => {
    const endpoints = [];
    if (connector.lowerLayerId === layerId) {
      endpoints.push({ kind: "connector-endpoint", connectorId: connector.id, stop: "lower" });
    }
    if (connector.upperLayerId === layerId) {
      endpoints.push({ kind: "connector-endpoint", connectorId: connector.id, stop: "upper" });
    }
    return endpoints;
  });
  const keys = [
    ...nodes.map((node) => `node:${node.id}`),
    ...connectorEndpoints.map(endpointKey),
  ];
  const set = new DisjointSet(keys);
  for (const link of document.navigationLinks) {
    if (endpointLayerId(document, link.a) !== layerId || endpointLayerId(document, link.b) !== layerId) continue;
    set.union(endpointKey(link.a), endpointKey(link.b));
  }
  return { nodes, connectorEndpoints, set };
}

/** @param {ReturnType<typeof layerGraph>} graph @param {string} key */
function componentHasNode(graph, key) {
  const root = graph.set.find(key);
  return root !== null && graph.nodes.some((node) => graph.set.find(`node:${node.id}`) === root);
}

/** @param {Record<string,any>} document @param {string} layerId */
function blockingInstanceCells(document, layerId) {
  const layer = document.layers.find((candidate) => candidate.id === layerId);
  const cells = new Set();
  for (const instance of layer?.instances ?? []) {
    const definition = getPlaceableDefinition(instance.definitionId);
    if (definition?.traits.blocksMovement !== true) continue;
    for (const cell of getOccupiedCells(definition, instance)) cells.add(`${cell.cx}:${cell.cz}`);
  }
  return cells;
}

/**
 * Adds a sparse, deterministic authored graph around elevator endpoints.
 * Existing authoring records are never removed or rewritten.
 * @param {unknown} input
 */
export function generateConnectorNavigationSkeleton(input) {
  const compiled = compileAuthoringMap(input);
  let document = compiled.document;
  const addedNodeIds = [];
  const addedLinkIds = [];
  const unresolvedEndpoints = [];
  const compiledLayers = new Map(compiled.layers.map((layer) => [layer.id, layer]));
  const blockedByLayer = new Map(document.layers.map((layer) => [
    layer.id,
    blockingInstanceCells(document, layer.id),
  ]));

  const addNode = (layerId, cx, cz) => {
    if (document.navigationNodes.length >= NAVIGATION_TOPOLOGY.authoredNodeCapacity) {
      throw new RangeError(`Connector navigation exceeds the ${NAVIGATION_TOPOLOGY.authoredNodeCapacity}-node limit`);
    }
    const result = placeNavigationNode(document, cx, cz, { layerId, patrol: false });
    document = result.document;
    addedNodeIds.push(result.nodeId);
    return result.nodeId;
  };
  const addLink = (a, b) => {
    if (document.navigationLinks.length >= NAVIGATION_TOPOLOGY.authoredLinkCapacity) {
      throw new RangeError(`Connector navigation exceeds the ${NAVIGATION_TOPOLOGY.authoredLinkCapacity}-link limit`);
    }
    const result = placeNavigationLink(document, a, b);
    document = result.document;
    addedLinkIds.push(result.linkId);
  };

  for (const connector of document.connectors) {
    for (const stop of ["lower", "upper"]) {
      const layerId = stop === "lower" ? connector.lowerLayerId : connector.upperLayerId;
      const connectorEndpoint = { kind: "connector-endpoint", connectorId: connector.id, stop };
      const key = endpointKey(connectorEndpoint);
      const graph = layerGraph(document, layerId);
      if (componentHasNode(graph, key)) continue;
      const layer = document.layers.find((candidate) => candidate.id === layerId);
      const runtimeLayer = compiledLayers.get(layerId);
      const originCx = Math.floor(connector.x);
      const originCz = Math.floor(connector.z);
      const blocked = blockedByLayer.get(layerId) ?? new Set();
      let stagingNode = null;
      for (const neighbor of CARDINAL_NEIGHBORS) {
        const cx = originCx + neighbor.dx;
        const cz = originCz + neighbor.dz;
        if (!layer || !runtimeLayer || cx < 0 || cz < 0 || cx >= layer.width || cz >= layer.height) continue;
        if (!navigationCanTraverse(runtimeLayer.map, originCx, originCz, neighbor)) continue;
        const cellIndex = cz * layer.width + cx;
        const surfaceId = layer.surface.legend[layer.surface.cells[cellIndex]];
        const surfaceKind = getPlaceableDefinition(surfaceId)?.traits.runtimeKind;
        if (surfaceKind === "floor-hole" || surfaceKind === "breakaway-floor") continue;
        if (blocked.has(`${cx}:${cz}`)) continue;
        const occupiedByConnector = document.connectors.some((candidate) => (
          (candidate.lowerLayerId === layerId || candidate.upperLayerId === layerId)
          && Math.floor(candidate.x) === cx
          && Math.floor(candidate.z) === cz
        ));
        if (occupiedByConnector) continue;
        const existing = document.navigationNodes.find((node) => (
          node.layerId === layerId && node.cx === cx && node.cz === cz
        ));
        stagingNode = existing?.id ?? addNode(layerId, cx, cz);
        break;
      }
      if (stagingNode === null) {
        unresolvedEndpoints.push(key);
        continue;
      }
      addLink(connectorEndpoint, { kind: "node", nodeId: stagingNode });
    }
  }

  for (const layer of document.layers) {
    const graph = layerGraph(document, layer.id);
    if (graph.connectorEndpoints.length === 0 || graph.nodes.length < 2) continue;
    const componentConnector = new Map();
    for (const endpoint of graph.connectorEndpoints) {
      const root = graph.set.find(endpointKey(endpoint));
      if (root !== null) componentConnector.set(root, true);
    }
    const runtimeLayer = compiledLayers.get(layer.id);
    if (!runtimeLayer) continue;
    const scratch = new StaticGridCosts(runtimeLayer.map.width * runtimeLayer.map.height);
    const edges = [];
    for (let leftIndex = 0; leftIndex < graph.nodes.length; leftIndex += 1) {
      const left = graph.nodes[leftIndex];
      scratch.run(runtimeLayer.map, left.cx, left.cz);
      for (let rightIndex = leftIndex + 1; rightIndex < graph.nodes.length; rightIndex += 1) {
        const right = graph.nodes[rightIndex];
        const leftRoot = graph.set.find(`node:${left.id}`);
        const rightRoot = graph.set.find(`node:${right.id}`);
        if (leftRoot === null || rightRoot === null || leftRoot === rightRoot) continue;
        const cost = scratch.at(runtimeLayer.map, right.cx, right.cz);
        if (cost === NAVIGATION_UNREACHABLE) continue;
        const pair = [left.id, right.id].sort((a, b) => a.localeCompare(b));
        edges.push({ left, right, leftRoot, rightRoot, cost, key: `${pair[0]}:${pair[1]}` });
      }
    }
    const eligible = new Set(componentConnector.keys());
    for (const edge of edges) {
      if (componentConnector.has(edge.leftRoot) || componentConnector.has(edge.rightRoot)) {
        eligible.add(edge.leftRoot);
        eligible.add(edge.rightRoot);
      }
    }
    edges.sort((left, right) => left.cost - right.cost || left.key.localeCompare(right.key));
    for (const edge of edges) {
      if (!eligible.has(edge.leftRoot) || !eligible.has(edge.rightRoot)) continue;
      const leftKey = `node:${edge.left.id}`;
      const rightKey = `node:${edge.right.id}`;
      if (graph.set.find(leftKey) === graph.set.find(rightKey)) continue;
      addLink(
        { kind: "node", nodeId: edge.left.id },
        { kind: "node", nodeId: edge.right.id },
      );
      graph.set.union(leftKey, rightKey);
    }
  }

  compileAuthoringMap(document);
  return { document, addedNodeIds, addedLinkIds, unresolvedEndpoints };
}
