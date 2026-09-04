// @ts-check

/** @param {Record<string, any>|null|undefined} target */
function endpointKey(target) {
  if (target?.kind === "navigation-node") return `node:${target.nodeId}`;
  if (target?.kind === "connector-endpoint") return `connector:${target.connectorId}:${target.stop}`;
  return null;
}

/** @param {Record<string, any>} port */
function clonePort(port) {
  return {
    key: String(port.key),
    stableId: String(port.stableId),
    kind: String(port.kind),
    layerId: String(port.layerId),
    x: Number(port.x),
    z: Number(port.z),
    cx: Number(port.cx),
    cz: Number(port.cz),
    ...(port.patrol === true ? { patrol: true } : {}),
    ...(port.connectorId ? { connectorId: String(port.connectorId), stop: String(port.stop) } : {}),
  };
}

/**
 * Renderer-neutral, detached topology diagnostics. It intentionally contains
 * only bounded authored graph data; presentation never queries runtime bodies
 * or decides a route.
 *
 * @param {{topology?:Record<string,any>|null,editor?:Record<string,any>|null,developerToolsOpen?:boolean}} input
 */
export function createNavigationTopologyView(input = {}) {
  const topology = input.topology;
  const editor = input.editor;
  const layerId = editor?.activeLayerId ?? editor?.layers?.[0]?.id ?? null;
  if (!input.developerToolsOpen || !topology || !layerId) {
    return {
      visible: false,
      revision: topology?.revision ?? null,
      layerId,
      nodes: [],
      ports: [],
      links: [],
      verticalArcs: [],
      selectedRoute: [],
      localGoal: null,
      selectedPortKey: null,
      pendingLinkStartKey: null,
      diagnostics: [],
    };
  }
  const byKey = new Map((topology.ports ?? []).map((port) => [String(port.key), port]));
  const visiblePorts = (topology.ports ?? [])
    .filter((port) => port.layerId === layerId)
    .map(clonePort);
  const portKeys = new Set(visiblePorts.map((port) => port.key));
  const links = [];
  const verticalArcs = [];
  const seen = new Set();
  for (const arc of topology.arcs ?? []) {
    const from = byKey.get(String(arc.from));
    const to = byKey.get(String(arc.to));
    if (!from || !to) continue;
    const pair = [String(arc.from), String(arc.to)].sort().join("|");
    if (seen.has(pair)) continue;
    seen.add(pair);
    const edge = {
      kind: String(arc.kind),
      cost: Number(arc.cost),
      from: clonePort(from),
      to: clonePort(to),
    };
    if (arc.kind === "elevator") {
      if (from.layerId === layerId || to.layerId === layerId) verticalArcs.push(edge);
    } else if (portKeys.has(String(arc.from)) && portKeys.has(String(arc.to))) {
      links.push(edge);
    }
  }
  const route = Array.isArray(topology.selectedRoute) ? topology.selectedRoute : [];
  return {
    visible: true,
    revision: topology.revision ?? null,
    layerId,
    nodes: visiblePorts.filter((port) => port.kind === "node"),
    ports: visiblePorts.filter((port) => port.kind === "connector-endpoint"),
    links,
    verticalArcs,
    selectedRoute: route.map(clonePort),
    localGoal: topology.localGoal ? clonePort(topology.localGoal) : null,
    selectedPortKey: endpointKey(editor?.selectedTarget),
    pendingLinkStartKey: endpointKey(editor?.pendingLinkStart),
    diagnostics: (topology.diagnostics ?? []).map((entry) => ({ ...entry })),
  };
}
