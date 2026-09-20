// @ts-check

export const MECHANISM_LIMITS = Object.freeze({ logicNodes: 256, nodes: 512, links: 1024,
  controls: 128, gates: 128, movers: 64, traps: 128, events: 256 });
export const MECHANISM_PROFILE = "authored-mechanisms-v1";
export const MECHANISM_PROFILE_V2 = "authored-mechanisms-v2";
const level = "level", pulse = "pulse";
const integer = (value, min, max) => ({ type: "integer", default: value, min, max });
const boolean = (value) => ({ type: "boolean", default: value });
export const isMoverDefinition = (id) => id === "mechanism.mover" || id === "mechanism.spiked-mover";
export const isTrapDefinition = (id) => ["mechanism.bolt-emitter", "mechanism.spell-emitter", "mechanism.floor-spikes", "mechanism.wall-spear"].includes(id);
const moverProperties = { distanceCells: integer(1, 1, 16), speed: { type: "number", default: 2, min: 0.25, max: 8 } };
const def = (inputs, outputs, properties = {}, stateful = false) =>
  Object.freeze({ inputs, outputs, properties, stateful });
export const MECHANISM_DEFINITIONS = Object.freeze({
  "mechanism.mover": def({ positionB: level }, { atA: level, atB: level, blocked: level, arrivedA: pulse, arrivedB: pulse, blockedEdge: pulse }, moverProperties, true),
  "mechanism.spiked-mover": def({ positionB: level }, { atA: level, atB: level, blocked: level, arrivedA: pulse, arrivedB: pulse, blockedEdge: pulse }, moverProperties, true),
  "mechanism.bolt-emitter": def({ fire: pulse }, {}),
  "mechanism.spell-emitter": def({ fire: pulse }, {}, { spellId: { type: "enum", default: "fireball", values: ["fireball"] }, mode: { type: "enum", default: "projectile", values: ["projectile", "instant-impact"] } }),
  "mechanism.floor-spikes": def({ extended: level }, {}),
  "mechanism.wall-spear": def({ thrust: pulse }, {}),
  "connector.elevator.two-stop": def({ callLower: pulse, callUpper: pulse, cycle: pulse },
    { atLower: level, atUpper: level, arrivedLower: pulse, arrivedUpper: pulse }, {}, true),
  "object.pressure-plate": def({}, { pressed: level, pressedEdge: pulse, releasedEdge: pulse }, {
    player: boolean(true), enemy: boolean(true), prop: boolean(true), corpse: boolean(false),
  }),
  "mechanism.gate": def({ open: level }, { isOpen: level, opened: pulse, closed: pulse, blocked: pulse }, {}, true),
  "mechanism.lever": def({}, { on: level, changed: pulse }, { initialOn: boolean(false) }),
  "mechanism.chain": def({}, { pulled: pulse }),
  "mechanism.button": def({}, { pressed: pulse }),
  "logic.not": def({ value: level }, { value: level }),
  "logic.all": def({ a: level, b: level }, { value: level }),
  "logic.any": def({ a: level, b: level }, { value: level }),
  "logic.toggle": def({ toggle: pulse, reset: pulse }, { on: level }, { initialOn: boolean(false) }, true),
  "logic.latch": def({ set: pulse, reset: pulse }, { on: level }, { initialOn: boolean(false) }, true),
  "logic.delay": def({ pulse }, { pulse }, { delayTicks: integer(60, 1, 216000),
    retrigger: { type: "enum", default: "restart", values: ["restart", "ignore"] } }, true),
  "logic.timer": def({ start: pulse, cancel: pulse }, { active: level, elapsed: pulse },
    { durationTicks: integer(60, 1, 216000) }, true),
  "logic.repeater": def({ enabled: level }, { pulse }, { intervalTicks: integer(60, 1, 216000) }, true),
  "logic.counter": def({ pulse, reset: pulse }, { reached: level, reachedEdge: pulse },
    { threshold: integer(1, 1, 65535) }, true),
});

export function mechanismProperties(definitionId, input = {}) {
  const definition = MECHANISM_DEFINITIONS[definitionId];
  if (!definition) throw new RangeError(`Unknown mechanism definition ${definitionId}`);
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new RangeError("Mechanism properties must be an object");
  for (const key of Object.keys(input)) {
    if (!Object.hasOwn(definition.properties, key)) throw new RangeError(`Unknown ${definitionId} property ${key}`);
  }
  const result = {};
  for (const [key, descriptor] of Object.entries(definition.properties)) {
    const value = input[key] === undefined ? descriptor.default : input[key];
    if (descriptor.type === "boolean" && typeof value !== "boolean"
      || descriptor.type === "number" && (typeof value !== "number" || !Number.isFinite(value) || value < descriptor.min || value > descriptor.max)
      || descriptor.type === "integer" && (!Number.isInteger(value) || value < descriptor.min || value > descriptor.max)
      || descriptor.type === "enum" && !descriptor.values.includes(value)) {
      throw new RangeError(`Invalid ${definitionId}.${key}`);
    }
    result[key] = value;
  }
  return result;
}

export function emptyMechanisms() {
  return { nextNodeOrdinal: 1, nextLinkOrdinal: 1, nodes: [], links: [] };
}

// Rotation zero faces +Z; quarter turns follow the existing footprint convention.
export function wallFace(instance) {
  const [dx, dz] = [[0, 1], [-1, 0], [0, -1], [1, 0]][instance.rotation ?? 0];
  return { dx, dz, x: instance.x + dx * 0.501, z: instance.z + dz * 0.501 };
}

export function mechanismNodes(document, profile = MECHANISM_PROFILE_V2) {
  return [...document.layers.flatMap((layer) => layer.instances
    .filter((instance) => MECHANISM_DEFINITIONS[instance.definitionId]
      && (profile === MECHANISM_PROFILE_V2 || (!isMoverDefinition(instance.definitionId) && !isTrapDefinition(instance.definitionId))))
    .map((instance) => ({ ...instance, layerId: layer.id }))),
    ...(profile === MECHANISM_PROFILE_V2 ? (document.connectors ?? [])
      .filter((connector) => connector.controlMode === "triggered")
      .map((connector) => ({ ...connector, properties: {}, nodeKind: "connector" })) : []),
    ...(document.mechanisms?.nodes ?? []).map((node) => ({ ...node }))]
    .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** Compile once at the authoring boundary. Runtime delivery uses resolved slots. */
export function compileMechanisms(document, profile = MECHANISM_PROFILE_V2) {
  const graph = document.mechanisms;
  const fail = (message) => { throw new RangeError(message); };
  const record = (value, fields, label) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
    for (const key of Object.keys(value)) if (!fields.includes(key)) fail(`Unknown ${label} field ${key}`);
  };
  record(graph, ["nextNodeOrdinal", "nextLinkOrdinal", "nodes", "links"], "mechanisms");
  if (!Array.isArray(graph.nodes) || !Array.isArray(graph.links)) fail("Mechanism nodes and links must be arrays");
  if (graph.nodes.length > MECHANISM_LIMITS.logicNodes || graph.links.length > MECHANISM_LIMITS.links) fail("Mechanism capacity exceeded");
  const ordinal = (key, list, prefix) => {
    if (!Number.isSafeInteger(graph[key]) || graph[key] < 1) fail(`Invalid ${key}`);
    for (const entry of list) {
      const match = new RegExp(`^${prefix}-(\\d+)$`).exec(entry.id);
      if (match && Number(match[1]) >= graph[key]) fail(`${key} must exceed generated IDs`);
    }
  };
  ordinal("nextNodeOrdinal", graph.nodes, "logic"); ordinal("nextLinkOrdinal", graph.links, "wire");
  for (const node of graph.nodes) {
    record(node, ["id", "definitionId", "properties"], "logic node");
    if (!node.definitionId?.startsWith("logic.")) fail("Non-spatial nodes must use logic definitions");
  }
  const nodes = mechanismNodes(document, profile);
  if (nodes.length > MECHANISM_LIMITS.nodes) fail("Mechanism node capacity exceeded");
  if (nodes.filter(n => isMoverDefinition(n.definitionId)).length > MECHANISM_LIMITS.movers
    || nodes.filter(n => isTrapDefinition(n.definitionId)).length > MECHANISM_LIMITS.traps) fail("Mechanism device capacity exceeded");
  const count = (ids) => nodes.filter((n) => ids.includes(n.definitionId)).length;
  if (count(["mechanism.gate"]) > MECHANISM_LIMITS.gates
    || count(["mechanism.lever", "mechanism.chain", "mechanism.button"]) > MECHANISM_LIMITS.controls) fail("Mechanism device capacity exceeded");
  const byId = new Map(), warnings = [];
  let outputCount = 0, inputCount = 0;
  for (const [index, node] of nodes.entries()) {
    if (typeof node.id !== "string" || !node.id.trim() || byId.has(node.id)) fail(`Invalid or duplicate mechanism ID ${node.id}`);
    const definition = MECHANISM_DEFINITIONS[node.definitionId];
    if (!definition) fail(`Unknown mechanism ${node.definitionId}`);
    node.properties = mechanismProperties(node.definitionId, node.properties);
    node.index = index; node.inputs = {}; node.outputs = {};
    for (const port of Object.keys(definition.inputs)) node.inputs[port] = inputCount++;
    for (const port of Object.keys(definition.outputs)) node.outputs[port] = outputCount++;
    byId.set(node.id, node);
  }
  const links = [], usedIds = new Set(), usedInputs = new Set();
  for (const link of [...graph.links].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) {
    record(link, ["id", "from", "to"], "link");
    record(link.from, ["nodeId", "port"], "source"); record(link.to, ["nodeId", "port"], "target");
    if (typeof link.id !== "string" || !link.id.trim() || usedIds.has(link.id)) fail("Duplicate or invalid wire ID");
    usedIds.add(link.id);
    const from = byId.get(link.from.nodeId), to = byId.get(link.to.nodeId);
    if (!from || !to) fail(`Missing endpoint on ${link.id}`);
    const output = MECHANISM_DEFINITIONS[from.definitionId].outputs[link.from.port];
    const input = MECHANISM_DEFINITIONS[to.definitionId].inputs[link.to.port];
    if (!output || !input || output !== input) fail(`Unknown or incompatible ports on ${link.id}`);
    const target = to.inputs[link.to.port];
    if (usedInputs.has(target)) fail(`Input already wired on ${link.id}; use any/all for fan-in`);
    usedInputs.add(target);
    links.push({ id: link.id, from: from.index, to: to.index, output: from.outputs[link.from.port], input: target });
  }
  // Stateful outputs are clock boundaries. Physical devices also sample their
  // outputs between ticks, so actuator feedback never creates recursive delivery.
  const combinational = nodes.filter((n) => n.definitionId.startsWith("logic.") && !MECHANISM_DEFINITIONS[n.definitionId].stateful);
  const remaining = new Set(combinational.map((n) => n.index)), order = [];
  while (remaining.size) {
    const ready = [...remaining].filter((index) => !links.some((l) => l.to === index && remaining.has(l.from)));
    if (!ready.length) fail("Combinational mechanism cycle");
    for (const index of ready) { remaining.delete(index); order.push(index); }
  }
  for (const node of nodes) for (const [port, slot] of Object.entries(node.inputs)) {
    if (!usedInputs.has(slot)) warnings.push({ severity: "warning", path: "mechanisms.links", code: "unwired-port", message: `${node.id}.${port} is unwired` });
  }
  return { nodes, links, order, inputCount, outputCount, warnings };
}
