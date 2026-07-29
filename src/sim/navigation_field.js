// @ts-check

import { TACTICAL_WIZARD } from "../config.js";

export const NAVIGATION_UNREACHABLE = 0xffff_ffff;

export const NAVIGATION_NEIGHBORS = Object.freeze([
  Object.freeze({ dx: 0, dz: -1, cost: TACTICAL_WIZARD.navigationCardinalCost, name: "north" }),
  Object.freeze({ dx: 1, dz: 0, cost: TACTICAL_WIZARD.navigationCardinalCost, name: "east" }),
  Object.freeze({ dx: 0, dz: 1, cost: TACTICAL_WIZARD.navigationCardinalCost, name: "south" }),
  Object.freeze({ dx: -1, dz: 0, cost: TACTICAL_WIZARD.navigationCardinalCost, name: "west" }),
  Object.freeze({ dx: 1, dz: -1, cost: TACTICAL_WIZARD.navigationDiagonalCost, name: "northeast" }),
  Object.freeze({ dx: 1, dz: 1, cost: TACTICAL_WIZARD.navigationDiagonalCost, name: "southeast" }),
  Object.freeze({ dx: -1, dz: 1, cost: TACTICAL_WIZARD.navigationDiagonalCost, name: "southwest" }),
  Object.freeze({ dx: -1, dz: -1, cost: TACTICAL_WIZARD.navigationDiagonalCost, name: "northwest" }),
]);

/** @param {{get(cx:number,cz:number):number}} map @param {number} cx @param {number} cz @param {{dx:number,dz:number}} neighbor */
export function navigationCanTraverse(map, cx, cz, neighbor) {
  const nextCx = cx + neighbor.dx;
  const nextCz = cz + neighbor.dz;
  if (map.get(nextCx, nextCz) !== 0) return false;
  if (neighbor.dx !== 0 && neighbor.dz !== 0) {
    if (map.get(cx + neighbor.dx, cz) !== 0) return false;
    if (map.get(cx, cz + neighbor.dz) !== 0) return false;
  }
  return true;
}

export class SharedNavigationField {
  /** @param {{width:number,height:number,get(cx:number,cz:number):number}} map */
  constructor(map) {
    this.width = 0;
    this.height = 0;
    this.cellCount = 0;
    this.completedCosts = new Uint32Array(0);
    this.buildingCosts = new Uint32Array(0);
    this.heapCells = new Int32Array(0);
    this.heapCosts = new Uint32Array(0);
    this.heapSequences = new Uint32Array(0);
    this.heapPositions = new Int32Array(0);
    this.heapSize = 0;
    this.insertionSequence = 0;
    this.completed = false;
    this.building = false;
    this.version = 0;
    this.completedMapRevision = 0;
    this.completedTargetCx = -1;
    this.completedTargetCz = -1;
    this.requestedMapRevision = 0;
    this.requestedTargetCx = -1;
    this.requestedTargetCz = -1;
    this.expansionsThisTick = 0;
    this.buildExpansions = 0;
    this.totalExpansions = 0;
    this._poppedCell = -1;
    this._poppedCost = NAVIGATION_UNREACHABLE;
    this.reset(map);
  }

  /** @param {{width:number,height:number}} map */
  #allocate(map) {
    this.width = map.width;
    this.height = map.height;
    this.cellCount = map.width * map.height;
    this.completedCosts = new Uint32Array(this.cellCount);
    this.buildingCosts = new Uint32Array(this.cellCount);
    this.heapCells = new Int32Array(this.cellCount);
    this.heapCosts = new Uint32Array(this.cellCount);
    this.heapSequences = new Uint32Array(this.cellCount);
    this.heapPositions = new Int32Array(this.cellCount);
  }

  /** @param {{width:number,height:number}} map */
  reset(map) {
    if (map.width !== this.width || map.height !== this.height) this.#allocate(map);
    this.completedCosts.fill(NAVIGATION_UNREACHABLE);
    this.buildingCosts.fill(NAVIGATION_UNREACHABLE);
    this.heapPositions.fill(-1);
    this.heapSize = 0;
    this.insertionSequence = 0;
    this.completed = false;
    this.building = false;
    this.version = 0;
    this.completedMapRevision = 0;
    this.completedTargetCx = -1;
    this.completedTargetCz = -1;
    this.requestedMapRevision = 0;
    this.requestedTargetCx = -1;
    this.requestedTargetCz = -1;
    this.expansionsThisTick = 0;
    this.buildExpansions = 0;
    this.totalExpansions = 0;
  }

  /** @param {number} cx @param {number} cz */
  #index(cx, cz) {
    return cz * this.width + cx;
  }

  /** @param {number} left @param {number} right */
  #heapLess(left, right) {
    const costDelta = this.heapCosts[left] - this.heapCosts[right];
    return costDelta < 0
      || (costDelta === 0 && this.heapSequences[left] < this.heapSequences[right]);
  }

  /** @param {number} left @param {number} right */
  #swapHeap(left, right) {
    const leftCell = this.heapCells[left];
    const leftCost = this.heapCosts[left];
    const leftSequence = this.heapSequences[left];
    this.heapCells[left] = this.heapCells[right];
    this.heapCosts[left] = this.heapCosts[right];
    this.heapSequences[left] = this.heapSequences[right];
    this.heapCells[right] = leftCell;
    this.heapCosts[right] = leftCost;
    this.heapSequences[right] = leftSequence;
    this.heapPositions[this.heapCells[left]] = left;
    this.heapPositions[this.heapCells[right]] = right;
  }

  /** @param {number} cell @param {number} cost */
  #pushOrDecrease(cell, cost) {
    let position = this.heapPositions[cell];
    if (position === -2) return;
    if (position < 0) {
      position = this.heapSize;
      this.heapSize += 1;
      this.heapCells[position] = cell;
      this.heapCosts[position] = cost;
      this.heapSequences[position] = this.insertionSequence;
      this.insertionSequence += 1;
      this.heapPositions[cell] = position;
    } else {
      this.heapCosts[position] = cost;
    }
    while (position > 0) {
      const parent = (position - 1) >> 1;
      if (!this.#heapLess(position, parent)) break;
      this.#swapHeap(position, parent);
      position = parent;
    }
  }

  #popHeap() {
    if (this.heapSize === 0) return false;
    this._poppedCell = this.heapCells[0];
    this._poppedCost = this.heapCosts[0];
    this.heapPositions[this._poppedCell] = -2;
    this.heapSize -= 1;
    if (this.heapSize === 0) return true;
    this.heapCells[0] = this.heapCells[this.heapSize];
    this.heapCosts[0] = this.heapCosts[this.heapSize];
    this.heapSequences[0] = this.heapSequences[this.heapSize];
    this.heapPositions[this.heapCells[0]] = 0;
    let position = 0;
    while (true) {
      const left = position * 2 + 1;
      if (left >= this.heapSize) break;
      const right = left + 1;
      let child = left;
      if (right < this.heapSize && this.#heapLess(right, left)) child = right;
      if (!this.#heapLess(child, position)) break;
      this.#swapHeap(position, child);
      position = child;
    }
    return true;
  }

  /** @param {{get(cx:number,cz:number):number}} map @param {number} mapRevision @param {number} targetCx @param {number} targetCz */
  #startBuild(map, mapRevision, targetCx, targetCz) {
    this.buildingCosts.fill(NAVIGATION_UNREACHABLE);
    this.heapPositions.fill(-1);
    this.heapSize = 0;
    this.insertionSequence = 0;
    this.buildExpansions = 0;
    this.building = true;
    this.requestedMapRevision = mapRevision;
    this.requestedTargetCx = targetCx;
    this.requestedTargetCz = targetCz;
    if (map.get(targetCx, targetCz) !== 0) return;
    const targetIndex = this.#index(targetCx, targetCz);
    this.buildingCosts[targetIndex] = 0;
    this.#pushOrDecrease(targetIndex, 0);
  }

  #finishBuild() {
    const previous = this.completedCosts;
    this.completedCosts = this.buildingCosts;
    this.buildingCosts = previous;
    this.completed = true;
    this.building = false;
    this.version += 1;
    this.completedMapRevision = this.requestedMapRevision;
    this.completedTargetCx = this.requestedTargetCx;
    this.completedTargetCz = this.requestedTargetCz;
  }

  /**
   * @param {{width:number,height:number,get(cx:number,cz:number):number}} map
   * @param {number} mapRevision
   * @param {number} targetCx
   * @param {number} targetCz
   * @param {number} [maximumExpansions]
   */
  update(
    map,
    mapRevision,
    targetCx,
    targetCz,
    maximumExpansions = TACTICAL_WIZARD.navigationExpansionsPerTick,
  ) {
    if (map.width !== this.width || map.height !== this.height) this.reset(map);
    const targetMatchesCompleted = this.completed
      && this.completedMapRevision === mapRevision
      && this.completedTargetCx === targetCx
      && this.completedTargetCz === targetCz;
    const targetMatchesBuild = this.building
      && this.requestedMapRevision === mapRevision
      && this.requestedTargetCx === targetCx
      && this.requestedTargetCz === targetCz;
    if (!targetMatchesCompleted && !targetMatchesBuild) {
      this.#startBuild(map, mapRevision, targetCx, targetCz);
    }
    this.expansionsThisTick = 0;
    if (!this.building) return 0;
    const expansionLimit = Math.max(0, Math.trunc(maximumExpansions));
    while (this.heapSize > 0 && this.expansionsThisTick < expansionLimit) {
      this.#popHeap();
      const cell = this._poppedCell;
      const cost = this._poppedCost;
      const cx = cell % this.width;
      const cz = Math.floor(cell / this.width);
      this.expansionsThisTick += 1;
      this.buildExpansions += 1;
      this.totalExpansions += 1;
      for (const neighbor of NAVIGATION_NEIGHBORS) {
        if (!navigationCanTraverse(map, cx, cz, neighbor)) continue;
        const nextCx = cx + neighbor.dx;
        const nextCz = cz + neighbor.dz;
        const nextIndex = this.#index(nextCx, nextCz);
        const nextCost = cost + neighbor.cost;
        if (nextCost >= this.buildingCosts[nextIndex]) continue;
        this.buildingCosts[nextIndex] = nextCost;
        this.#pushOrDecrease(nextIndex, nextCost);
      }
    }
    if (this.heapSize === 0) this.#finishBuild();
    return this.expansionsThisTick;
  }

  /** @param {number} cx @param {number} cz */
  rawCostAt(cx, cz) {
    if (!this.completed || cx < 0 || cz < 0 || cx >= this.width || cz >= this.height) {
      return NAVIGATION_UNREACHABLE;
    }
    return this.completedCosts[this.#index(cx, cz)];
  }

  /** @param {number} cx @param {number} cz */
  costAt(cx, cz) {
    const cost = this.rawCostAt(cx, cz);
    return cost === NAVIGATION_UNREACHABLE ? null : cost;
  }

  /**
   * @param {{get(cx:number,cz:number):number}} map
   * @param {number} cx
   * @param {number} cz
   * @param {"approach"|"retreat"} mode
   */
  gradientStep(map, cx, cz, mode) {
    const currentCost = this.rawCostAt(cx, cz);
    if (currentCost === NAVIGATION_UNREACHABLE) return null;
    let bestCost = currentCost;
    let best = null;
    for (const neighbor of NAVIGATION_NEIGHBORS) {
      if (!navigationCanTraverse(map, cx, cz, neighbor)) continue;
      const nextCx = cx + neighbor.dx;
      const nextCz = cz + neighbor.dz;
      const cost = this.rawCostAt(nextCx, nextCz);
      if (cost === NAVIGATION_UNREACHABLE) continue;
      const improves = mode === "approach" ? cost < bestCost : cost > bestCost;
      if (!improves) continue;
      bestCost = cost;
      best = {
        cx: nextCx,
        cz: nextCz,
        x: nextCx + 0.5,
        z: nextCz + 0.5,
        cost,
        direction: neighbor.name,
        version: this.version,
      };
    }
    return best;
  }

  /** @param {number} currentMapRevision @param {number} currentTargetCx @param {number} currentTargetCz */
  diagnostics(currentMapRevision, currentTargetCx, currentTargetCz) {
    return {
      version: this.version,
      completed: this.completed,
      building: this.building,
      stale: this.completed && (
        this.completedMapRevision !== currentMapRevision
        || this.completedTargetCx !== currentTargetCx
        || this.completedTargetCz !== currentTargetCz
      ),
      completedMapRevision: this.completed ? this.completedMapRevision : null,
      completedTargetCell: this.completed
        ? { cx: this.completedTargetCx, cz: this.completedTargetCz }
        : null,
      requestedMapRevision: this.building ? this.requestedMapRevision : null,
      requestedTargetCell: this.building
        ? { cx: this.requestedTargetCx, cz: this.requestedTargetCz }
        : null,
      expansionsThisTick: this.expansionsThisTick,
      buildExpansions: this.building ? this.buildExpansions : 0,
      totalExpansions: this.totalExpansions,
      frontierSize: this.heapSize,
      maximumExpansionsPerTick: TACTICAL_WIZARD.navigationExpansionsPerTick,
      width: this.width,
      height: this.height,
    };
  }
}
