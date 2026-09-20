// @ts-check
import { MECHANISM_LIMITS, isMoverDefinition, wallFace } from "../authoring/mechanism_catalog.js";

export class MechanismMoverPool {
  constructor(nodes, layerIndex, layerY) {
    this.nodes = nodes.filter(n => isMoverDefinition(n.definitionId));
    this.activeCount = this.nodes.length;
    this.capacity = MECHANISM_LIMITS.movers;
    for (const field of ["x", "z", "previousX", "previousZ", "progress"]) this[field] = new Float64Array(this.capacity);
    this.blocked = new Uint8Array(this.capacity);
    this.wasBlocked = new Uint8Array(this.capacity);
    this.target = new Uint8Array(this.capacity);
    this.records = this.nodes.map((node, i) => {
      this.x[i] = this.previousX[i] = node.x; this.z[i] = this.previousZ[i] = node.z;
      const direction = wallFace(node);
      return { ...node, index: i, box: true, halfX: 0.5, halfZ: 0.5, radius: Math.SQRT1_2,
        layerIndex: layerIndex.get(node.layerId), y: layerY[layerIndex.get(node.layerId)], height: 1.9,
        dx: direction.dx, dz: direction.dz };
    });
  }

  beginTick(runtime) {
    for (let i = 0; i < this.activeCount; i++) {
      this.previousX[i] = this.x[i]; this.previousZ[i] = this.z[i];
      this.wasBlocked[i] = this.blocked[i]; this.blocked[i] = 0;
      this.target[i] = Number(runtime.input(this.nodes[i], "positionB"));
    }
  }

  publish(runtime, initialize = false) {
    for (let i = 0; i < this.activeCount; i++) {
      const node = this.nodes[i];
      const atA = this.progress[i] === 0, atB = this.progress[i] === node.properties.distanceCells;
      for (const [port, value, edge] of [["atA", atA, "arrivedA"], ["atB", atB, "arrivedB"], ["blocked", !!this.blocked[i], "blockedEdge"]]) {
        if (!initialize && value && !runtime.values[node.outputs[port]]) runtime.write(node.id, edge);
        runtime.write(node.id, port, value, initialize);
      }
    }
  }
}
