// @ts-check
import { RingBuffer } from "../core/ring_buffer.js";
import { MECHANISM_DEFINITIONS, MECHANISM_LIMITS, compileMechanisms } from "../authoring/mechanism_catalog.js";

/** Bounded synchronous signal machine. Sources are written only for the next tick. */
export class MechanismRuntime {
  constructor(document, profile) {
    this.compiled = compileMechanisms(document, profile);
    const { nodes, inputCount, outputCount } = this.compiled;
    this.byId = new Map(nodes.map((node) => [node.id, node]));
    this.values = new Uint8Array(outputCount);
    this.pending = new Uint8Array(outputCount);
    this.inputs = new Uint8Array(inputCount);
    this.sources = new Int32Array(inputCount).fill(-1);
    for (const link of this.compiled.links) this.sources[link.input] = link.output;
    this.state = new Uint32Array(nodes.length);
    this.remaining = new Uint32Array(nodes.length);
    this.enabled = new Uint8Array(nodes.length);
    this.events = new RingBuffer(MECHANISM_LIMITS.events);
    this.overwrittenEvents = 0;
    this.coalescedPulses = 0;
    this.ignoredPulses = 0;
    this.restartedDelays = 0;
    this.tick = 0;
    for (const node of nodes) {
      if (node.properties.initialOn) {
        this.state[node.index] = 1;
        this.pending[node.outputs.on] = 1;
      }
    }
  }

  event(kind, nodeId, details = {}) {
    if (this.events.length === this.events.capacity) this.overwrittenEvents += 1;
    this.events.push({ tick: this.tick, kind, nodeId, ...details });
  }

  write(id, port, value = true, quiet = false) {
    const node = this.byId.get(id);
    if (!node || node.outputs[port] === undefined) return;
    const slot = node.outputs[port];
    const isPulse = MECHANISM_DEFINITIONS[node.definitionId].outputs[port] === "pulse";
    if (isPulse && value && this.pending[slot]) this.coalescedPulses += 1;
    if (!quiet && value && (isPulse || !this.pending[slot])) this.event(port, id);
    this.pending[slot] = isPulse ? Number(Boolean(this.pending[slot] || value)) : Number(Boolean(value));
  }

  input(node, port) { return Boolean(this.inputs[node.inputs[port]]); }

  evaluate(tick, initialize = false) {
    this.tick = tick;
    this.values.set(this.pending);
    for (const node of this.compiled.nodes) {
      for (const [port, type] of Object.entries(MECHANISM_DEFINITIONS[node.definitionId].outputs)) {
        if (type === "pulse") this.pending[node.outputs[port]] = 0;
      }
    }
    const readInputs = (node) => {
      for (const slot of Object.values(node.inputs)) {
        const source = this.sources[slot];
        this.inputs[slot] = source < 0 ? 0 : this.values[source];
      }
    };
    for (const index of this.compiled.order) {
      const node = this.compiled.nodes[index];
      readInputs(node);
      const a = this.input(node, "a"), b = this.input(node, "b");
      this.values[node.outputs.value] = Number(node.definitionId === "logic.not"
        ? !this.input(node, "value") : node.definitionId === "logic.all" ? a && b : a || b);
    }
    // Capture all inputs before advancing state. Stateful results become visible
    // on the next tick, including through feedback links, independent of ID order.
    for (const node of this.compiled.nodes) readInputs(node);
    if (initialize) return;
    for (const node of this.compiled.nodes) {
      if (!MECHANISM_DEFINITIONS[node.definitionId].stateful) continue;
      const i = node.index, p = node.properties;
      const input = (port) => this.input(node, port);
      const out = (port, value) => this.write(node.id, port, value);
      switch (node.definitionId) {
        case "logic.toggle":
        case "logic.latch":
          if (input("reset")) this.state[i] = 0;
          else if (node.definitionId === "logic.toggle" && input("toggle")) this.state[i] ^= 1;
          else if (input("set")) this.state[i] = 1;
          out("on", this.state[i] !== 0);
          break;
        case "logic.counter":
          if (input("reset")) this.state[i] = 0;
          else if (input("pulse") && this.state[i] < p.threshold) {
            this.state[i] += 1;
            if (this.state[i] === p.threshold) out("reachedEdge", true);
          }
          out("reached", this.state[i] === p.threshold);
          break;
        case "logic.delay": {
          if (input("pulse") && (!this.remaining[i] || p.retrigger === "restart")) {
            if (this.remaining[i]) {
              this.restartedDelays += 1;
              this.event("delayRestarted", node.id);
            }
            this.remaining[i] = p.delayTicks - 1;
            if (!this.remaining[i]) out("pulse", true);
          } else {
            if (input("pulse")) {
              this.ignoredPulses += 1;
              this.event("delayIgnored", node.id);
            }
            if (this.remaining[i]) {
              this.remaining[i] -= 1;
              if (!this.remaining[i]) out("pulse", true);
            }
          }
          break;
        }
        case "logic.timer":
          if (input("cancel")) this.remaining[i] = 0;
          else if (input("start")) this.remaining[i] = p.durationTicks;
          else if (this.remaining[i]) {
            this.remaining[i] -= 1;
            if (!this.remaining[i]) out("elapsed", true);
          }
          out("active", this.remaining[i] > 0);
          break;
        case "logic.repeater":
          if (!input("enabled")) { this.enabled[i] = 0; this.remaining[i] = 0; }
          else {
            if (this.remaining[i]) this.remaining[i] -= 1;
            if (!this.enabled[i] || !this.remaining[i]) {
              out("pulse", true); this.remaining[i] = p.intervalTicks;
            }
            this.enabled[i] = 1;
          }
          break;
      }
    }
  }

  snapshot() {
    return {
      counts: { nodes: this.compiled.nodes.length, links: this.compiled.links.length,
        logic: this.compiled.nodes.filter((n) => n.definitionId.startsWith("logic.")).length },
      overwrittenEvents: this.overwrittenEvents, coalescedPulses: this.coalescedPulses,
      ignoredPulses: this.ignoredPulses, restartedDelays: this.restartedDelays,
      nodes: this.compiled.nodes.map((node) => ({ id: node.id, definitionId: node.definitionId,
        layerId: node.layerId ?? null, state: this.state[node.index], remainingTicks: this.remaining[node.index],
        enabled: Boolean(this.enabled[node.index]),
        outputs: Object.fromEntries(Object.entries(node.outputs).map(([p, s]) => [p, Boolean(this.values[s])])),
        pending: Object.fromEntries(Object.entries(node.outputs).map(([p, s]) => [p, Boolean(this.pending[s])])) })),
      recentEvents: this.events.toArray(64).map((event) => ({ ...event })),
    };
  }
}
