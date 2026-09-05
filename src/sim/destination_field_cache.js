// @ts-check

import { PERCEPTIVE_WIZARD } from "../config.js";
import {
  NAVIGATION_NEIGHBORS,
  NAVIGATION_UNREACHABLE,
  navigationCanTraverse,
} from "./navigation_field.js";

const SLOT_EMPTY = 0;
const SLOT_ACTOR = 1;
const SLOT_GOAL = 2;

/** @param {any} value */
function mapList(value) {
  return Array.isArray(value) ? value : [value];
}

/**
 * Bounded destination-field cache. Every slot owns one completed cost array;
 * all builds take turns through one preallocated Dijkstra workspace.
 */
export class DestinationFieldCache {
  /** @param {{width:number,height:number,get(cx:number,cz:number):number}|Array<{width:number,height:number,get(cx:number,cz:number):number}>} maps */
  constructor(maps) {
    this.actorSlotCount = PERCEPTIVE_WIZARD.actorTargetSlots;
    this.goalSlotCount = PERCEPTIVE_WIZARD.destinationGoalSlots;
    this.slotCount = this.actorSlotCount + this.goalSlotCount;
    this.width = 0;
    this.height = 0;
    this.cellCount = 0;
    this.layerCount = 0;
    this.layerWidths = new Uint16Array(0);
    this.layerHeights = new Uint16Array(0);
    this.slotKind = new Uint8Array(this.slotCount);
    this.targetKind = new Uint8Array(this.slotCount);
    this.targetId = new Uint32Array(this.slotCount);
    this.targetTeam = new Uint8Array(this.slotCount);
    this.keyGoalCx = new Int16Array(this.slotCount);
    this.keyGoalCz = new Int16Array(this.slotCount);
    this.requestedGoalCx = new Int16Array(this.slotCount);
    this.requestedGoalCz = new Int16Array(this.slotCount);
    this.requestedMapRevision = new Uint32Array(this.slotCount);
    this.requestedLayerIndex = new Uint16Array(this.slotCount);
    this.completedGoalCx = new Int16Array(this.slotCount);
    this.completedGoalCz = new Int16Array(this.slotCount);
    this.completedMapRevision = new Uint32Array(this.slotCount);
    this.completedLayerIndex = new Uint16Array(this.slotCount);
    this.completedWidth = new Uint16Array(this.slotCount);
    this.completedHeight = new Uint16Array(this.slotCount);
    this.completed = new Uint8Array(this.slotCount);
    this.versions = new Uint32Array(this.slotCount);
    this.references = new Uint16Array(this.slotCount);
    this.previousReferences = new Uint16Array(this.slotCount);
    /** @type {Array<Uint32Array>} */
    this.completedCosts = [];
    this.buildingCosts = new Uint32Array(0);
    this.heapCells = new Int32Array(0);
    this.heapCosts = new Uint32Array(0);
    this.heapSequences = new Uint32Array(0);
    this.heapPositions = new Int32Array(0);
    this.heapSize = 0;
    this.insertionSequence = 0;
    this.buildingSlot = -1;
    this.buildMapRevision = 0;
    this.buildLayerIndex = 0xffff;
    this.buildWidth = 0;
    this.buildHeight = 0;
    this.buildGoalCx = -1;
    this.buildGoalCz = -1;
    this.buildExpansions = 0;
    this.expansionsThisTick = 0;
    this.totalExpansions = 0;
    this.version = 0;
    this._poppedCell = -1;
    this._poppedCost = NAVIGATION_UNREACHABLE;
    this.reset(maps);
  }

  /** @param {Array<{width:number,height:number}>} maps */
  #allocate(maps) {
    this.cellCount = maps.reduce((maximum, map) => Math.max(maximum, map.width * map.height), 0);
    this.completedCosts = Array.from(
      { length: this.slotCount },
      () => new Uint32Array(this.cellCount),
    );
    this.buildingCosts = new Uint32Array(this.cellCount);
    this.heapCells = new Int32Array(this.cellCount);
    this.heapCosts = new Uint32Array(this.cellCount);
    this.heapSequences = new Uint32Array(this.cellCount);
    this.heapPositions = new Int32Array(this.cellCount);
  }

  /** @param {{width:number,height:number}|Array<{width:number,height:number}>} input */
  reset(input) {
    const maps = mapList(input);
    const maximumCells = maps.reduce((maximum, map) => Math.max(maximum, map.width * map.height), 0);
    if (maximumCells !== this.cellCount) this.#allocate(maps);
    this.layerCount = maps.length;
    this.width = maps.reduce((maximum, map) => Math.max(maximum, map.width), 0);
    this.height = maps.reduce((maximum, map) => Math.max(maximum, map.height), 0);
    this.layerWidths = Uint16Array.from(maps, (map) => map.width);
    this.layerHeights = Uint16Array.from(maps, (map) => map.height);
    this.slotKind.fill(SLOT_EMPTY);
    this.targetKind.fill(0);
    this.targetId.fill(0);
    this.targetTeam.fill(0);
    this.keyGoalCx.fill(-1);
    this.keyGoalCz.fill(-1);
    this.requestedGoalCx.fill(-1);
    this.requestedGoalCz.fill(-1);
    this.requestedMapRevision.fill(0);
    this.requestedLayerIndex.fill(0xffff);
    this.completedGoalCx.fill(-1);
    this.completedGoalCz.fill(-1);
    this.completedMapRevision.fill(0);
    this.completedLayerIndex.fill(0xffff);
    this.completedWidth.fill(0);
    this.completedHeight.fill(0);
    this.completed.fill(0);
    this.versions.fill(0);
    this.references.fill(0);
    this.previousReferences.fill(0);
    for (const costs of this.completedCosts) costs.fill(NAVIGATION_UNREACHABLE);
    this.buildingCosts.fill(NAVIGATION_UNREACHABLE);
    this.heapPositions.fill(-1);
    this.heapSize = 0;
    this.insertionSequence = 0;
    this.buildingSlot = -1;
    this.buildMapRevision = 0;
    this.buildLayerIndex = 0xffff;
    this.buildWidth = 0;
    this.buildHeight = 0;
    this.buildGoalCx = -1;
    this.buildGoalCz = -1;
    this.buildExpansions = 0;
    this.expansionsThisTick = 0;
    this.totalExpansions = 0;
    this.version = 0;
  }

  beginTick() {
    this.previousReferences.set(this.references);
    this.references.fill(0);
    this.expansionsThisTick = 0;
  }

  /** @param {number} slot @param {number} layerIndex @param {number} mapRevision @param {number} cx @param {number} cz */
  #request(slot, layerIndex, mapRevision, cx, cz) {
    this.references[slot] += 1;
    this.requestedLayerIndex[slot] = layerIndex;
    this.requestedMapRevision[slot] = mapRevision;
    this.requestedGoalCx[slot] = cx;
    this.requestedGoalCz[slot] = cz;
    return slot;
  }

  /**
   * @param {number} kind
   * @param {number} id
   * @param {number} team
   * @param {number} mapRevision
   * @param {number} cx
   * @param {number} cz
   */
  requestActor(kind, id, team, layerOrRevision, revisionOrCx, cxOrCz, maybeCz) {
    const layered = maybeCz !== undefined;
    const layerIndex = layered ? Number(layerOrRevision) : 0;
    const mapRevision = layered ? Number(revisionOrCx) : Number(layerOrRevision);
    const cx = layered ? Number(cxOrCz) : Number(revisionOrCx);
    const cz = layered ? Number(maybeCz) : Number(cxOrCz);
    let slot = -1;
    for (let index = 0; index < this.actorSlotCount; index += 1) {
      if (
        this.slotKind[index] === SLOT_ACTOR
        && this.targetKind[index] === kind
        && this.targetId[index] === id
        && this.targetTeam[index] === team
        && this.requestedLayerIndex[index] === layerIndex
      ) {
        slot = index;
        break;
      }
    }
    if (slot < 0) {
      for (let index = 0; index < this.actorSlotCount; index += 1) {
        if (this.slotKind[index] === SLOT_EMPTY) {
          slot = index;
          break;
        }
      }
    }
    if (slot < 0) return -1;
    if (this.slotKind[slot] === SLOT_EMPTY) {
      this.slotKind[slot] = SLOT_ACTOR;
      this.targetKind[slot] = kind;
      this.targetId[slot] = id;
      this.targetTeam[slot] = team;
    }
    return this.#request(slot, layerIndex, mapRevision, cx, cz);
  }

  /** Supports `(revision,cx,cz)` and `(layerIndex,revision,cx,cz)`. */
  requestGoal(layerOrRevision, revisionOrCx, cxOrCz, maybeCz) {
    const layered = maybeCz !== undefined;
    const layerIndex = layered ? Number(layerOrRevision) : 0;
    const mapRevision = layered ? Number(revisionOrCx) : Number(layerOrRevision);
    const cx = layered ? Number(cxOrCz) : Number(revisionOrCx);
    const cz = layered ? Number(maybeCz) : Number(cxOrCz);
    let slot = -1;
    for (let index = this.actorSlotCount; index < this.slotCount; index += 1) {
      if (
        this.slotKind[index] === SLOT_GOAL
        && this.keyGoalCx[index] === cx
        && this.keyGoalCz[index] === cz
        && this.requestedLayerIndex[index] === layerIndex
      ) {
        slot = index;
        break;
      }
    }
    if (slot < 0) {
      for (let index = this.actorSlotCount; index < this.slotCount; index += 1) {
        if (this.slotKind[index] === SLOT_EMPTY) {
          slot = index;
          break;
        }
      }
    }
    if (slot < 0) {
      for (let index = this.actorSlotCount; index < this.slotCount; index += 1) {
        if (
          this.references[index] === 0
          && this.previousReferences[index] === 0
          && this.buildingSlot !== index
        ) {
          slot = index;
          break;
        }
      }
    }
    if (slot < 0) return -1;
    if (
      this.slotKind[slot] !== SLOT_GOAL
      || this.keyGoalCx[slot] !== cx
      || this.keyGoalCz[slot] !== cz
      || this.requestedLayerIndex[slot] !== layerIndex
    ) {
      this.slotKind[slot] = SLOT_GOAL;
      this.targetKind[slot] = 0;
      this.targetId[slot] = 0;
      this.targetTeam[slot] = 0;
      this.keyGoalCx[slot] = cx;
      this.keyGoalCz[slot] = cz;
      this.completed[slot] = 0;
      this.completedMapRevision[slot] = 0;
      this.completedLayerIndex[slot] = 0xffff;
      this.completedGoalCx[slot] = -1;
      this.completedGoalCz[slot] = -1;
      this.completedCosts[slot].fill(NAVIGATION_UNREACHABLE);
      this.versions[slot] = 0;
    }
    return this.#request(slot, layerIndex, mapRevision, cx, cz);
  }

  /** @param {number} slot */
  #isCurrent(slot) {
    return Boolean(this.completed[slot])
      && this.completedLayerIndex[slot] === this.requestedLayerIndex[slot]
      && this.completedMapRevision[slot] === this.requestedMapRevision[slot]
      && this.completedGoalCx[slot] === this.requestedGoalCx[slot]
      && this.completedGoalCz[slot] === this.requestedGoalCz[slot];
  }

  /** @param {number} cx @param {number} cz */
  #index(cx, cz, width) {
    return cz * width + cx;
  }

  /** @param {number} left @param {number} right */
  #heapLess(left, right) {
    const costDelta = this.heapCosts[left] - this.heapCosts[right];
    return costDelta < 0
      || (costDelta === 0 && this.heapSequences[left] < this.heapSequences[right]);
  }

  /** @param {number} left @param {number} right */
  #swapHeap(left, right) {
    const cell = this.heapCells[left];
    const cost = this.heapCosts[left];
    const sequence = this.heapSequences[left];
    this.heapCells[left] = this.heapCells[right];
    this.heapCosts[left] = this.heapCosts[right];
    this.heapSequences[left] = this.heapSequences[right];
    this.heapCells[right] = cell;
    this.heapCosts[right] = cost;
    this.heapSequences[right] = sequence;
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

  /** @param {{get(cx:number,cz:number):number}} map @param {number} slot */
  #startBuild(map, slot) {
    this.buildingCosts.fill(NAVIGATION_UNREACHABLE);
    this.heapPositions.fill(-1);
    this.heapSize = 0;
    this.insertionSequence = 0;
    this.buildingSlot = slot;
    this.buildMapRevision = this.requestedMapRevision[slot];
    this.buildLayerIndex = this.requestedLayerIndex[slot];
    this.buildWidth = map.width;
    this.buildHeight = map.height;
    this.buildGoalCx = this.requestedGoalCx[slot];
    this.buildGoalCz = this.requestedGoalCz[slot];
    this.buildExpansions = 0;
    if (map.get(this.buildGoalCx, this.buildGoalCz) !== 0) return;
    const target = this.#index(this.buildGoalCx, this.buildGoalCz, this.buildWidth);
    this.buildingCosts[target] = 0;
    this.#pushOrDecrease(target, 0);
  }

  #finishBuild() {
    const slot = this.buildingSlot;
    const old = this.completedCosts[slot];
    this.completedCosts[slot] = this.buildingCosts;
    this.buildingCosts = old;
    this.completed[slot] = 1;
    this.completedMapRevision[slot] = this.buildMapRevision;
    this.completedLayerIndex[slot] = this.buildLayerIndex;
    this.completedWidth[slot] = this.buildWidth;
    this.completedHeight[slot] = this.buildHeight;
    this.completedGoalCx[slot] = this.buildGoalCx;
    this.completedGoalCz[slot] = this.buildGoalCz;
    this.versions[slot] += 1;
    this.version += 1;
    this.buildingSlot = -1;
    this.heapSize = 0;
  }

  /** @param {{width:number,height:number,get(cx:number,cz:number):number}} map @param {number} [maximumExpansions] */
  update(input, maximumExpansions = PERCEPTIVE_WIZARD.navigationExpansionsPerTick) {
    const maps = mapList(input);
    let maximumCells = 0;
    let dimensionsChanged = maps.length !== this.layerCount;
    for (let index = 0; index < maps.length; index += 1) {
      const map = maps[index];
      maximumCells = Math.max(maximumCells, map.width * map.height);
      dimensionsChanged ||= map.width !== this.layerWidths[index]
        || map.height !== this.layerHeights[index];
    }
    if (maximumCells !== this.cellCount || dimensionsChanged) this.reset(maps);
    const limit = Math.max(0, Math.trunc(maximumExpansions));
    this.expansionsThisTick = 0;
    while (this.expansionsThisTick < limit) {
      if (this.buildingSlot >= 0) {
        const slot = this.buildingSlot;
        if (
          this.references[slot] === 0
          || this.buildMapRevision !== this.requestedMapRevision[slot]
          || this.buildLayerIndex !== this.requestedLayerIndex[slot]
          || this.buildGoalCx !== this.requestedGoalCx[slot]
          || this.buildGoalCz !== this.requestedGoalCz[slot]
        ) {
          this.buildingSlot = -1;
          this.heapSize = 0;
        }
      }
      if (this.buildingSlot < 0) {
        let next = -1;
        for (let slot = 0; slot < this.slotCount; slot += 1) {
          if (this.references[slot] > 0 && !this.#isCurrent(slot)) {
            next = slot;
            break;
          }
        }
        if (next < 0) break;
        const map = maps[this.requestedLayerIndex[next]];
        if (!map) {
          this.references[next] = 0;
          continue;
        }
        this.#startBuild(map, next);
        if (this.heapSize === 0) {
          this.#finishBuild();
          continue;
        }
      }
      if (!this.#popHeap()) {
        this.#finishBuild();
        continue;
      }
      const cell = this._poppedCell;
      const cost = this._poppedCost;
      const map = maps[this.buildLayerIndex];
      if (!map) {
        this.buildingSlot = -1;
        this.heapSize = 0;
        continue;
      }
      const cx = cell % this.buildWidth;
      const cz = Math.floor(cell / this.buildWidth);
      this.expansionsThisTick += 1;
      this.buildExpansions += 1;
      this.totalExpansions += 1;
      for (const neighbor of NAVIGATION_NEIGHBORS) {
        if (!navigationCanTraverse(map, cx, cz, neighbor)) continue;
        const nextCx = cx + neighbor.dx;
        const nextCz = cz + neighbor.dz;
        const next = this.#index(nextCx, nextCz, this.buildWidth);
        const nextCost = cost + neighbor.cost;
        if (nextCost >= this.buildingCosts[next]) continue;
        this.buildingCosts[next] = nextCost;
        this.#pushOrDecrease(next, nextCost);
      }
      if (this.heapSize === 0) this.#finishBuild();
    }
    return this.expansionsThisTick;
  }

  /** @param {number} slot @param {number} cx @param {number} cz */
  rawCostAt(slot, cx, cz) {
    if (
      slot < 0
      || slot >= this.slotCount
      || !this.completed[slot]
      || cx < 0
      || cz < 0
      || cx >= this.completedWidth[slot]
      || cz >= this.completedHeight[slot]
    ) {
      return NAVIGATION_UNREACHABLE;
    }
    return this.completedCosts[slot][this.#index(cx, cz, this.completedWidth[slot])];
  }

  /**
   * @param {{get(cx:number,cz:number):number}} map
   * @param {number} slot
   * @param {number} cx
   * @param {number} cz
   * @param {"approach"|"retreat"} mode
   */
  gradientStep(map, slot, cx, cz, mode) {
    const currentCost = this.rawCostAt(slot, cx, cz);
    if (currentCost === NAVIGATION_UNREACHABLE) return null;
    let bestCost = currentCost;
    let best = null;
    for (const neighbor of NAVIGATION_NEIGHBORS) {
      if (!navigationCanTraverse(map, cx, cz, neighbor)) continue;
      const nextCx = cx + neighbor.dx;
      const nextCz = cz + neighbor.dz;
      const cost = this.rawCostAt(slot, nextCx, nextCz);
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
        slot,
        version: this.versions[slot],
      };
    }
    return best;
  }

  /** @param {number} slot */
  keyFor(slot) {
    if (slot < 0 || slot >= this.slotCount || this.slotKind[slot] === SLOT_EMPTY) return null;
    const layer = this.layerCount > 1 ? `layer:${this.requestedLayerIndex[slot]}:` : "";
    if (this.slotKind[slot] === SLOT_ACTOR) {
      return `${layer}actor:${this.targetKind[slot]}:${this.targetId[slot]}:${this.targetTeam[slot]}`;
    }
    return `${layer}goal:${this.keyGoalCx[slot]}:${this.keyGoalCz[slot]}`;
  }

  /** @param {number} slot @param {boolean} [layerAware] */
  slotDiagnostics(slot, layerAware = true) {
    if (slot < 0 || slot >= this.slotCount || this.slotKind[slot] === SLOT_EMPTY) return null;
    const current = this.#isCurrent(slot);
    return {
      slot,
      kind: this.slotKind[slot] === SLOT_ACTOR ? "actor-target" : "goal-cell",
      key: this.keyFor(slot),
      ...(layerAware
        ? {
          requestedLayerIndex: this.references[slot] > 0 ? this.requestedLayerIndex[slot] : null,
          completedLayerIndex: this.completed[slot] ? this.completedLayerIndex[slot] : null,
          completedDimensions: this.completed[slot]
            ? { width: this.completedWidth[slot], height: this.completedHeight[slot] }
            : null,
        }
        : {}),
      references: this.references[slot],
      completed: Boolean(this.completed[slot]),
      stale: Boolean(this.completed[slot]) && !current,
      building: this.buildingSlot === slot,
      version: this.versions[slot],
      completedMapRevision: this.completed[slot] ? this.completedMapRevision[slot] : null,
      completedGoalCell: this.completed[slot]
        ? { cx: this.completedGoalCx[slot], cz: this.completedGoalCz[slot] }
        : null,
      requestedMapRevision: this.references[slot] > 0 ? this.requestedMapRevision[slot] : null,
      requestedGoalCell: this.references[slot] > 0
        ? { cx: this.requestedGoalCx[slot], cz: this.requestedGoalCz[slot] }
        : null,
    };
  }

  /** @param {number} slot @param {number} [mapRevision] */
  isCurrent(slot, mapRevision, layerIndex) {
    return slot >= 0
      && slot < this.slotCount
      && this.#isCurrent(slot)
      && (
        mapRevision === undefined
        || this.completedMapRevision[slot] === mapRevision
      )
      && (
        layerIndex === undefined
        || this.completedLayerIndex[slot] === layerIndex
      );
  }

  diagnostics(mapRevision, layerAware = true) {
    const slots = [];
    let referencedSlots = 0;
    let referencedCompletedSlots = 0;
    let completedSlots = 0;
    let staleSlots = 0;
    for (let slot = 0; slot < this.slotCount; slot += 1) {
      if (this.slotKind[slot] === SLOT_EMPTY) continue;
      const value = this.slotDiagnostics(slot, layerAware);
      if (!value) continue;
      slots.push(value);
      if (value.references > 0) {
        referencedSlots += 1;
        if (value.completed && !value.stale) referencedCompletedSlots += 1;
      }
      if (value.completed) completedSlots += 1;
      if (value.stale && value.references > 0) staleSlots += 1;
    }
    return {
      type: "destination-field-cache",
      mapRevision,
      version: this.version,
      actorTargetSlots: this.actorSlotCount,
      goalCellSlots: this.goalSlotCount,
      capacity: this.slotCount,
      activeSlots: slots.length,
      referencedSlots,
      completedSlots,
      staleSlots,
      completed: referencedSlots === referencedCompletedSlots,
      stale: staleSlots > 0,
      building: this.buildingSlot >= 0,
      buildingSlot: this.buildingSlot >= 0 ? this.buildingSlot : null,
      buildingKey: this.buildingSlot >= 0 ? this.keyFor(this.buildingSlot) : null,
      buildExpansions: this.buildingSlot >= 0 ? this.buildExpansions : 0,
      frontierSize: this.heapSize,
      expansionsThisTick: this.expansionsThisTick,
      totalExpansions: this.totalExpansions,
      maximumExpansionsPerTick: PERCEPTIVE_WIZARD.navigationExpansionsPerTick,
      width: this.width,
      height: this.height,
      ...(layerAware ? { maximumCellCount: this.cellCount, layerCount: this.layerCount } : {}),
      slots,
    };
  }
}
