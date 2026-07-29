// @ts-check

import {
  NAVIGATION_NEIGHBORS,
  navigationCanTraverse,
} from "./navigation_field.js";

/** Preallocated flood-fill scratch used only to validate sparse AI goals. */
export class GridReachability {
  /** @param {{width:number,height:number}} map */
  constructor(map) {
    this.width = 0;
    this.height = 0;
    this.marks = new Uint32Array(0);
    this.queue = new Int32Array(0);
    this.generation = 0;
    this.reached = 0;
    this.reset(map);
  }

  /** @param {{width:number,height:number}} map */
  reset(map) {
    if (map.width !== this.width || map.height !== this.height) {
      this.width = map.width;
      this.height = map.height;
      this.marks = new Uint32Array(map.width * map.height);
      this.queue = new Int32Array(map.width * map.height);
    } else {
      this.marks.fill(0);
    }
    this.generation = 0;
    this.reached = 0;
  }

  /** @param {number} cx @param {number} cz */
  #index(cx, cz) {
    return cz * this.width + cx;
  }

  /**
   * @param {{width:number,height:number,get(cx:number,cz:number):number}} map
   * @param {number} startCx
   * @param {number} startCz
   */
  fill(map, startCx, startCz) {
    if (map.width !== this.width || map.height !== this.height) this.reset(map);
    this.generation = (this.generation + 1) >>> 0;
    if (this.generation === 0) {
      this.marks.fill(0);
      this.generation = 1;
    }
    this.reached = 0;
    if (map.get(startCx, startCz) !== 0) return 0;
    let head = 0;
    let tail = 0;
    const start = this.#index(startCx, startCz);
    this.queue[tail] = start;
    tail += 1;
    this.marks[start] = this.generation;
    while (head < tail) {
      const cell = this.queue[head];
      head += 1;
      const cx = cell % this.width;
      const cz = Math.floor(cell / this.width);
      for (const neighbor of NAVIGATION_NEIGHBORS) {
        if (!navigationCanTraverse(map, cx, cz, neighbor)) continue;
        const nextCx = cx + neighbor.dx;
        const nextCz = cz + neighbor.dz;
        const next = this.#index(nextCx, nextCz);
        if (this.marks[next] === this.generation) continue;
        this.marks[next] = this.generation;
        this.queue[tail] = next;
        tail += 1;
      }
    }
    this.reached = tail;
    return tail;
  }

  /** @param {number} cx @param {number} cz */
  has(cx, cz) {
    return cx >= 0
      && cz >= 0
      && cx < this.width
      && cz < this.height
      && this.marks[this.#index(cx, cz)] === this.generation;
  }
}
