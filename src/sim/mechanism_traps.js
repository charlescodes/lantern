// @ts-check
import { MECHANISM_COMBAT as C } from "../config.js";
import { isTrapDefinition, wallFace } from "../authoring/mechanism_catalog.js";

/** Bounded source/target memory keyed by actor identity, never dense pool index. */
export class MechanismTraps {
  constructor(nodes, actorCapacity) {
    this.nodes = nodes.filter(n => isTrapDefinition(n.definitionId) || n.definitionId === "mechanism.spiked-mover");
    this.actorCapacity = actorCapacity;
    this.phase = new Uint16Array(this.nodes.length);
    this.ordinal = new Uint32Array(this.nodes.length);
    this.refused = new Uint32Array(this.nodes.length);
    this.ignored = new Uint32Array(this.nodes.length);
    this.contacts = new Uint8Array(this.nodes.length * actorCapacity);
    this.seen = new Uint8Array(this.contacts.length);
    this.lastHit = new Float64Array(this.contacts.length).fill(-Infinity);
    this.actorSlots = new Map();
    this.byId = new Map(this.nodes.map((node, index) => [node.id, index]));
  }

  begin(runtime, actors) {
    const live = new Set(actors.map(actor => actor.key));
    for (const [key, slot] of this.actorSlots) if (!live.has(key)) {
      this.actorSlots.delete(key);
      for (let i = 0; i < this.nodes.length; i++) {
        const cell = i * this.actorCapacity + slot;
        this.contacts[cell] = 0; this.lastHit[cell] = -Infinity;
      }
    }
    const used = new Set(this.actorSlots.values());
    for (const actor of actors) if (!this.actorSlots.has(actor.key)) {
      let slot = 0; while (used.has(slot)) slot++;
      if (slot >= this.actorCapacity) throw new RangeError("Trap actor memory capacity exceeded");
      used.add(slot); this.actorSlots.set(actor.key, slot);
    }
    this.seen.fill(0);
    for (let i = 0; i < this.nodes.length; i++) {
      const node = this.nodes[i];
      if (node.definitionId === "mechanism.floor-spikes") {
        this.phase[i] = Math.max(0, Math.min(C.spikeTicks, this.phase[i] + (runtime.input(node, "extended") ? 1 : -1)));
      } else if (node.definitionId === "mechanism.wall-spear") {
        const total = C.spearExtend + C.spearHold + C.spearRetract;
        const busy = this.phase[i] > 0;
        if (runtime.input(node, "thrust") && busy) { this.ignored[i]++; runtime.event("ignoredBusy", node.id); }
        if (busy) this.phase[i] = this.phase[i] >= total ? 0 : this.phase[i] + 1;
        else if (runtime.input(node, "thrust")) {
          this.phase[i] = 1; this.contacts.fill(0, i * this.actorCapacity, (i + 1) * this.actorCapacity);
        } else this.phase[i] = 0;
      }
    }
  }

  volume(index, layerIndex, baseY, mover, clip) {
    const node = this.nodes[index], phase = this.phase[index];
    if (node.definitionId === "mechanism.spiked-mover") return mover ? { x: mover.x, z: mover.z, halfX: 0.505, halfZ: 0.505,
      y: baseY, height: 1.9, layerIndex } : null;
    if (node.definitionId === "mechanism.floor-spikes") return phase >= C.spikeActiveProgress
      ? { x: node.x, z: node.z, halfX: 0.5, halfZ: 0.5, y: baseY, height: C.spikeHeight * phase / C.spikeTicks, layerIndex } : null;
    if (node.definitionId !== "mechanism.wall-spear" || !phase) return null;
    const face = wallFace(node), length = clip(face, this.reach(index), baseY + 0.9, layerIndex);
    return { x: face.x + face.dx * length / 2, z: face.z + face.dz * length / 2,
      halfX: Math.abs(face.dx) * length / 2 + C.spearRadius,
      halfZ: Math.abs(face.dz) * length / 2 + C.spearRadius,
      y: baseY + 0.9 - C.spearRadius, height: 2 * C.spearRadius, layerIndex };
  }

  reach(index) {
    const p = this.phase[index];
    return p <= C.spearExtend ? C.spearReach * p / C.spearExtend
      : p <= C.spearExtend + C.spearHold ? C.spearReach
        : C.spearReach * (C.spearExtend + C.spearHold + C.spearRetract - p) / C.spearRetract;
  }

  sample(index, key) { this.seen[index * this.actorCapacity + this.actorSlots.get(key)] = 1; }

  finish(tick, actors, overlaps, damage) {
    for (let i = 0; i < this.nodes.length; i++) for (const actor of actors) {
      const cell = i * this.actorCapacity + this.actorSlots.get(actor.key), node = this.nodes[i];
      const touching = overlaps(i, actor);
      const entered = (touching || this.seen[cell]) && !this.contacts[cell];
      if (entered && (node.definitionId !== "mechanism.floor-spikes" || tick - this.lastHit[cell] >= C.spikeCooldown)) {
        damage(actor, node); this.lastHit[cell] = tick;
      }
      if (node.definitionId === "mechanism.wall-spear") this.contacts[cell] ||= Number(touching || this.seen[cell]);
      else this.contacts[cell] = Number(touching);
    }
  }
}
