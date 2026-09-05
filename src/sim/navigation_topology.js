// @ts-check

import { NAVIGATION_TOPOLOGY } from "../config.js";
import { AuthoringMapValidationError } from "../authoring/authoring_map.js";
import {
  NAVIGATION_NEIGHBORS,
  NAVIGATION_UNREACHABLE,
  navigationCanTraverse,
} from "./navigation_field.js";

export const NAVIGATION_PORT_KIND = Object.freeze({ node: 1, connectorEndpoint: 2 });
export const NAVIGATION_ARC_KIND = Object.freeze({ authoredLink: 1, elevator: 2 });
export const NAVIGATION_STOP = Object.freeze({ none: 0, lower: 1, upper: 2 });

/** @param {string} path @param {string} code @param {string} message @param {string} [layerId] */
function fail(path, code, message, layerId) {
  throw new AuthoringMapValidationError([{
    severity: "error",
    path,
    code,
    message,
    ...(layerId ? { layerId } : {}),
  }]);
}

/** Reusable cold-path weighted grid search with deterministic heap ordering. */
class StaticGridCosts {
  /** @param {number} capacity */
  constructor(capacity) {
    this.capacity = capacity;
    this.costs = new Uint32Array(capacity);
    this.heapCell = new Uint32Array(capacity);
    this.heapCost = new Uint32Array(capacity);
    this.heapPosition = new Int32Array(capacity);
    this.heapSize = 0;
  }

  /** @param {number} left @param {number} right */
  #less(left, right) {
    return this.heapCost[left] < this.heapCost[right]
      || (this.heapCost[left] === this.heapCost[right] && this.heapCell[left] < this.heapCell[right]);
  }

  /** @param {number} left @param {number} right */
  #swap(left, right) {
    [this.heapCell[left], this.heapCell[right]] = [this.heapCell[right], this.heapCell[left]];
    [this.heapCost[left], this.heapCost[right]] = [this.heapCost[right], this.heapCost[left]];
    this.heapPosition[this.heapCell[left]] = left;
    this.heapPosition[this.heapCell[right]] = right;
  }

  /** @param {number} cell @param {number} cost */
  #push(cell, cost) {
    let position = this.heapPosition[cell];
    if (position === -2) return;
    if (position < 0) {
      position = this.heapSize++;
      this.heapCell[position] = cell;
      this.heapPosition[cell] = position;
    }
    this.heapCost[position] = cost;
    while (position > 0) {
      const parent = (position - 1) >> 1;
      if (!this.#less(position, parent)) break;
      this.#swap(position, parent);
      position = parent;
    }
  }

  #pop() {
    const cell = this.heapCell[0];
    const cost = this.heapCost[0];
    this.heapPosition[cell] = -2;
    this.heapSize -= 1;
    if (this.heapSize > 0) {
      this.heapCell[0] = this.heapCell[this.heapSize];
      this.heapCost[0] = this.heapCost[this.heapSize];
      this.heapPosition[this.heapCell[0]] = 0;
      let position = 0;
      while (true) {
        const left = position * 2 + 1;
        if (left >= this.heapSize) break;
        const right = left + 1;
        const child = right < this.heapSize && this.#less(right, left) ? right : left;
        if (!this.#less(child, position)) break;
        this.#swap(position, child);
        position = child;
      }
    }
    return { cell, cost };
  }

  /** @param {{width:number,height:number,get(cx:number,cz:number):number}} map @param {number} sourceCx @param {number} sourceCz */
  run(map, sourceCx, sourceCz) {
    const cellCount = map.width * map.height;
    this.costs.fill(NAVIGATION_UNREACHABLE, 0, cellCount);
    this.heapPosition.fill(-1, 0, cellCount);
    this.heapSize = 0;
    if (map.get(sourceCx, sourceCz) !== 0) return;
    const source = sourceCz * map.width + sourceCx;
    this.costs[source] = 0;
    this.#push(source, 0);
    while (this.heapSize > 0) {
      const current = this.#pop();
      const cx = current.cell % map.width;
      const cz = Math.floor(current.cell / map.width);
      for (const neighbor of NAVIGATION_NEIGHBORS) {
        if (!navigationCanTraverse(map, cx, cz, neighbor)) continue;
        const next = (cz + neighbor.dz) * map.width + cx + neighbor.dx;
        const nextCost = current.cost + neighbor.cost;
        if (nextCost >= this.costs[next]) continue;
        this.costs[next] = nextCost;
        this.#push(next, nextCost);
      }
    }
  }

  /** @param {{width:number}} map @param {number} cx @param {number} cz */
  at(map, cx, cz) {
    return this.costs[cz * map.width + cx];
  }
}

/** @param {Record<string,any>} endpoint */
export function navigationEndpointKey(endpoint) {
  return endpoint.kind === "node"
    ? `node:${endpoint.nodeId}`
    : `connector:${endpoint.connectorId}:${endpoint.stop}`;
}

export class NavigationTopology {
  /** @param {Record<string,any>} data */
  constructor(data) {
    Object.assign(this, data);
    this._portIndexByKey = new Map(this.portMetadata.map((port, index) => [port.key, index]));
    this._routeCost = new Uint32Array(NAVIGATION_TOPOLOGY.portCapacity);
    this._routeHops = new Uint16Array(NAVIGATION_TOPOLOGY.portCapacity);
    this._routePrevious = new Uint16Array(NAVIGATION_TOPOLOGY.portCapacity);
    this._routePreviousArcOrder = new Uint16Array(NAVIGATION_TOPOLOGY.portCapacity);
    const maximumCells = this.layerMaps.reduce(
      (maximum, map) => Math.max(maximum, map.width * map.height),
      1,
    );
    this._gridScratch = new StaticGridCosts(maximumCells);
  }

  /** @param {string|number} value */
  #portIndex(value) {
    if (typeof value === "number") {
      return Number.isInteger(value) && value >= 0 && value < this.portCount ? value : -1;
    }
    return this._portIndexByKey.get(String(value)) ?? -1;
  }

  /** @param {string|number} source @param {string|number} target */
  route(source, target) {
    const sourceIndex = this.#portIndex(source);
    const targetIndex = this.#portIndex(target);
    if (sourceIndex < 0 || targetIndex < 0) {
      return { ok: false, code: "no-anchor", cost: null, hops: 0, ports: [] };
    }
    this._routeCost.fill(NAVIGATION_UNREACHABLE);
    this._routeHops.fill(NAVIGATION_TOPOLOGY.noPort);
    this._routePrevious.fill(NAVIGATION_TOPOLOGY.noPort);
    this._routePreviousArcOrder.fill(NAVIGATION_TOPOLOGY.noPort);
    const visited = new Uint8Array(this.portCount);
    this._routeCost[sourceIndex] = 0;
    this._routeHops[sourceIndex] = 0;
    for (let iteration = 0; iteration < this.portCount; iteration += 1) {
      let current = -1;
      for (let port = 0; port < this.portCount; port += 1) {
        if (visited[port] || this._routeCost[port] === NAVIGATION_UNREACHABLE) continue;
        if (
          current < 0
          || this._routeCost[port] < this._routeCost[current]
          || (this._routeCost[port] === this._routeCost[current] && this._routeHops[port] < this._routeHops[current])
          || (
            this._routeCost[port] === this._routeCost[current]
            && this._routeHops[port] === this._routeHops[current]
            && this.portStableOrder[port] < this.portStableOrder[current]
          )
        ) current = port;
      }
      if (current < 0) break;
      visited[current] = 1;
      if (current === targetIndex) break;
      for (let arc = this.adjacencyOffset[current]; arc < this.adjacencyOffset[current + 1]; arc += 1) {
        const next = this.arcTo[arc];
        const nextCost = this._routeCost[current] + this.arcCost[arc];
        const nextHops = this._routeHops[current] + 1;
        if (
          nextCost > this._routeCost[next]
          || (nextCost === this._routeCost[next] && nextHops > this._routeHops[next])
          || (
            nextCost === this._routeCost[next]
            && nextHops === this._routeHops[next]
            && this.arcStableOrder[arc] >= this._routePreviousArcOrder[next]
          )
        ) continue;
        this._routeCost[next] = nextCost;
        this._routeHops[next] = nextHops;
        this._routePrevious[next] = current;
        this._routePreviousArcOrder[next] = this.arcStableOrder[arc];
      }
    }
    if (this._routeCost[targetIndex] === NAVIGATION_UNREACHABLE) {
      return { ok: false, code: "disconnected", cost: null, hops: 0, ports: [] };
    }
    const indices = [];
    for (let port = targetIndex; port !== NAVIGATION_TOPOLOGY.noPort; port = this._routePrevious[port]) {
      indices.push(port);
      if (port === sourceIndex) break;
    }
    indices.reverse();
    return {
      ok: true,
      code: "ok",
      cost: this._routeCost[targetIndex],
      hops: this._routeHops[targetIndex],
      ports: indices.map((index) => ({ ...this.portMetadata[index] })),
    };
  }

  /** @param {string} layerId @param {number} cx @param {number} cz */
  nearestNode(layerId, cx, cz) {
    return this.#nearestNode(layerId, cx, cz, false);
  }

  /** @param {string} layerId @param {number} cx @param {number} cz */
  nearestPatrolNode(layerId, cx, cz) {
    return this.#nearestNode(layerId, cx, cz, true);
  }

  /** @param {string} layerId @param {number} cx @param {number} cz @param {boolean} patrolOnly */
  #nearestNode(layerId, cx, cz, patrolOnly) {
    const layerIndex = this.layerIds.indexOf(String(layerId));
    const map = this.layerMaps[layerIndex];
    if (!map || !Number.isInteger(cx) || !Number.isInteger(cz) || map.get(cx, cz) !== 0) {
      return { ok: false, code: "no-anchor", port: null, cost: null };
    }
    let hasCandidate = false;
    for (let port = 0; port < this.portCount; port += 1) {
      if (
        this.portKind[port] === NAVIGATION_PORT_KIND.node
        && this.portLayerIndex[port] === layerIndex
        && (!patrolOnly || this.portMetadata[port].patrol === true)
      ) {
        hasCandidate = true;
        break;
      }
    }
    if (!hasCandidate) return { ok: false, code: "no-anchor", port: null, cost: null };
    this._gridScratch.run(map, cx, cz);
    let best = -1;
    let bestCost = NAVIGATION_UNREACHABLE;
    for (let port = 0; port < this.portCount; port += 1) {
      if (
        this.portKind[port] !== NAVIGATION_PORT_KIND.node
        || this.portLayerIndex[port] !== layerIndex
        || (patrolOnly && this.portMetadata[port].patrol !== true)
      ) continue;
      const cost = this._gridScratch.at(map, this.portCellX[port], this.portCellZ[port]);
      if (
        cost < bestCost
        || (cost === bestCost && best >= 0 && this.portMetadata[port].stableId.localeCompare(this.portMetadata[best].stableId) < 0)
      ) {
        best = port;
        bestCost = cost;
      }
    }
    if (best < 0 || bestCost === NAVIGATION_UNREACHABLE) {
      return { ok: false, code: "no-anchor", port: null, cost: null };
    }
    return { ok: true, code: "ok", portIndex: best, port: { ...this.portMetadata[best] }, cost: bestCost };
  }

  describe() {
    const ports = this.portMetadata.map((port) => ({ ...port }));
    const arcs = [];
    for (let from = 0; from < this.portCount; from += 1) {
      for (let arc = this.adjacencyOffset[from]; arc < this.adjacencyOffset[from + 1]; arc += 1) {
        arcs.push({
          from: this.portMetadata[from].key,
          to: this.portMetadata[this.arcTo[arc]].key,
          cost: this.arcCost[arc],
          kind: this.arcKind[arc] === NAVIGATION_ARC_KIND.elevator ? "elevator" : "authored-link",
          stableOrder: this.arcStableOrder[arc],
        });
      }
    }
    return {
      capacities: { ...NAVIGATION_TOPOLOGY },
      portCount: this.portCount,
      arcCount: this.arcCount,
      nodes: ports.filter((port) => port.kind === "node"),
      endpointPorts: ports.filter((port) => port.kind === "connector-endpoint"),
      ports,
      arcs,
    };
  }
}

/**
 * @param {Record<string,any>} document
 * @param {Array<Record<string,any>>} layers
 * @param {Array<Record<string,any>>} connectors
 */
export function compileNavigationTopology(document, layers, connectors) {
  const portCount = document.navigationNodes.length + connectors.length * 2;
  if (portCount > NAVIGATION_TOPOLOGY.portCapacity) {
    fail("navigationNodes", "navigation-port-capacity", `Compiled topology exceeds ${NAVIGATION_TOPOLOGY.portCapacity} ports.`);
  }
  const portKind = new Uint8Array(NAVIGATION_TOPOLOGY.portCapacity);
  const portStableOrder = new Uint16Array(NAVIGATION_TOPOLOGY.portCapacity);
  const portLayerIndex = new Uint16Array(NAVIGATION_TOPOLOGY.portCapacity);
  const portCellX = new Uint16Array(NAVIGATION_TOPOLOGY.portCapacity);
  const portCellZ = new Uint16Array(NAVIGATION_TOPOLOGY.portCapacity);
  const portWorldX = new Float32Array(NAVIGATION_TOPOLOGY.portCapacity);
  const portWorldZ = new Float32Array(NAVIGATION_TOPOLOGY.portCapacity);
  const portConnectorIndex = new Uint16Array(NAVIGATION_TOPOLOGY.portCapacity);
  const portConnectorRuntimeId = new Uint32Array(NAVIGATION_TOPOLOGY.portCapacity);
  const portStop = new Uint8Array(NAVIGATION_TOPOLOGY.portCapacity);
  portLayerIndex.fill(NAVIGATION_TOPOLOGY.noLayer);
  portConnectorIndex.fill(NAVIGATION_TOPOLOGY.noConnectorIndex);
  const layerIndexById = new Map(layers.map((layer, index) => [layer.id, index]));
  const portMetadata = [];
  const portIndexByKey = new Map();
  const addPort = (metadata, kind, layerIndex, cx, cz, worldX, worldZ, connectorIndex, runtimeId, stop) => {
    const index = portMetadata.length;
    portKind[index] = kind;
    portStableOrder[index] = index;
    portLayerIndex[index] = layerIndex;
    portCellX[index] = cx;
    portCellZ[index] = cz;
    portWorldX[index] = worldX;
    portWorldZ[index] = worldZ;
    portConnectorIndex[index] = connectorIndex;
    portConnectorRuntimeId[index] = runtimeId;
    portStop[index] = stop;
    portMetadata.push(Object.freeze({ ...metadata, cx, cz, x: worldX, z: worldZ }));
    portIndexByKey.set(metadata.key, index);
  };
  for (const node of document.navigationNodes) {
    const layerIndex = layerIndexById.get(node.layerId);
    addPort(
      { key: `node:${node.id}`, stableId: node.id, kind: "node", layerId: node.layerId, patrol: node.patrol },
      NAVIGATION_PORT_KIND.node,
      layerIndex,
      node.cx,
      node.cz,
      node.cx + 0.5,
      node.cz + 0.5,
      NAVIGATION_TOPOLOGY.noConnectorIndex,
      0,
      NAVIGATION_STOP.none,
    );
  }
  connectors.forEach((connector, connectorIndex) => {
    for (const stop of ["lower", "upper"]) {
      const layerIndex = stop === "lower" ? connector.lowerLayerIndex : connector.upperLayerIndex;
      const layerId = stop === "lower" ? connector.lowerLayerId : connector.upperLayerId;
      addPort(
        {
          key: `connector:${connector.id}:${stop}`,
          stableId: connector.id,
          kind: "connector-endpoint",
          layerId,
          connectorId: connector.id,
          stop,
        },
        NAVIGATION_PORT_KIND.connectorEndpoint,
        layerIndex,
        Math.floor(connector.x),
        Math.floor(connector.z),
        connector.x,
        connector.z,
        connectorIndex,
        connector.runtimeId,
        stop === "lower" ? NAVIGATION_STOP.lower : NAVIGATION_STOP.upper,
      );
    }
  });

  for (let port = 0; port < document.navigationNodes.length; port += 1) {
    const layer = layers[portLayerIndex[port]];
    if (layer.map.get(portCellX[port], portCellZ[port]) !== 0) {
      fail(
        `navigationNodes[${port}]`,
        "navigation-node-solid",
        "Navigation nodes cannot occupy solid cells.",
        layer.id,
      );
    }
  }

  const maximumCells = layers.reduce((maximum, layer) => Math.max(maximum, layer.map.width * layer.map.height), 1);
  const scratch = new StaticGridCosts(maximumCells);
  const rawArcs = [];
  const addArc = (from, to, cost, kind, stableOrder) => rawArcs.push({ from, to, cost, kind, stableOrder });
  document.navigationLinks.forEach((link, linkIndex) => {
    const from = portIndexByKey.get(navigationEndpointKey(link.a));
    const to = portIndexByKey.get(navigationEndpointKey(link.b));
    if (from === undefined || to === undefined) {
      fail(`navigationLinks[${linkIndex}]`, "navigation-link-endpoint", "Navigation link endpoint could not be compiled.");
    }
    const layerIndex = portLayerIndex[from];
    if (layerIndex !== portLayerIndex[to]) {
      fail(`navigationLinks[${linkIndex}]`, "navigation-link-layer", "Authored navigation links must remain on one layer.");
    }
    const layer = layers[layerIndex];
    if (layer.map.get(portCellX[from], portCellZ[from]) !== 0 || layer.map.get(portCellX[to], portCellZ[to]) !== 0) {
      fail(`navigationLinks[${linkIndex}]`, "navigation-anchor-solid", "Navigation link endpoint occupies a solid cell.", layer.id);
    }
    scratch.run(layer.map, portCellX[from], portCellZ[from]);
    const cost = scratch.at(layer.map, portCellX[to], portCellZ[to]);
    if (cost === NAVIGATION_UNREACHABLE) {
      fail(`navigationLinks[${linkIndex}]`, "navigation-link-unreachable", "Navigation link endpoints are not statically reachable.", layer.id);
    }
    addArc(from, to, cost, NAVIGATION_ARC_KIND.authoredLink, linkIndex * 2);
    addArc(to, from, cost, NAVIGATION_ARC_KIND.authoredLink, linkIndex * 2 + 1);
  });
  connectors.forEach((connector, connectorIndex) => {
    const lower = portIndexByKey.get(`connector:${connector.id}:lower`);
    const upper = portIndexByKey.get(`connector:${connector.id}:upper`);
    const cost = connector.travelTicks + connector.dwellTicks;
    const stableOrder = document.navigationLinks.length * 2 + connectorIndex * 2;
    addArc(lower, upper, cost, NAVIGATION_ARC_KIND.elevator, stableOrder);
    addArc(upper, lower, cost, NAVIGATION_ARC_KIND.elevator, stableOrder + 1);
  });
  if (rawArcs.length > NAVIGATION_TOPOLOGY.arcCapacity) {
    fail("navigationLinks", "navigation-arc-capacity", `Compiled topology exceeds ${NAVIGATION_TOPOLOGY.arcCapacity} arcs.`);
  }
  const adjacencyOffset = new Uint16Array(NAVIGATION_TOPOLOGY.portCapacity + 1);
  for (const arc of rawArcs) adjacencyOffset[arc.from + 1] += 1;
  for (let index = 1; index <= portCount; index += 1) adjacencyOffset[index] += adjacencyOffset[index - 1];
  for (let index = portCount + 1; index < adjacencyOffset.length; index += 1) adjacencyOffset[index] = rawArcs.length;
  const arcTo = new Uint16Array(NAVIGATION_TOPOLOGY.arcCapacity);
  const arcCost = new Uint32Array(NAVIGATION_TOPOLOGY.arcCapacity);
  const arcKind = new Uint8Array(NAVIGATION_TOPOLOGY.arcCapacity);
  const arcStableOrder = new Uint16Array(NAVIGATION_TOPOLOGY.arcCapacity);
  const cursors = new Uint16Array(adjacencyOffset);
  for (const arc of rawArcs) {
    const target = cursors[arc.from]++;
    arcTo[target] = arc.to;
    arcCost[target] = arc.cost;
    arcKind[target] = arc.kind;
    arcStableOrder[target] = arc.stableOrder;
  }
  return new NavigationTopology({
    portCount,
    arcCount: rawArcs.length,
    portKind,
    portStableOrder,
    portLayerIndex,
    portCellX,
    portCellZ,
    portWorldX,
    portWorldZ,
    portConnectorIndex,
    portConnectorRuntimeId,
    portStop,
    adjacencyOffset,
    arcTo,
    arcCost,
    arcKind,
    arcStableOrder,
    portMetadata: Object.freeze(portMetadata),
    layerIds: layers.map((layer) => layer.id),
    layerMaps: layers.map((layer) => layer.map),
  });
}
