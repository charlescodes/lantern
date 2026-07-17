// @ts-check

import { MAP_VERSION, WORLD } from "../config.js";

/** @param {number} value */
function positiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

export class GridMap {
  /**
   * @param {number} width
   * @param {number} height
   * @param {Uint8Array} [cells]
   * @param {{x:number,z:number}} [playerSpawn]
   */
  constructor(
    width,
    height,
    cells = new Uint8Array(width * height),
    playerSpawn = { x: 2.5, z: 2.5 },
  ) {
    if (!positiveInteger(width) || !positiveInteger(height)) {
      throw new RangeError("Map dimensions must be positive integers");
    }
    if (cells.length !== width * height) {
      throw new RangeError("Map cell count does not match its dimensions");
    }
    this.width = width;
    this.height = height;
    this.cells = new Uint8Array(cells);
    this.playerSpawn = { x: playerSpawn.x, z: playerSpawn.z };
  }

  /** @param {number} cx @param {number} cz */
  inBounds(cx, cz) {
    return cx >= 0 && cz >= 0 && cx < this.width && cz < this.height;
  }

  /** @param {number} cx @param {number} cz */
  index(cx, cz) {
    return cz * this.width + cx;
  }

  /** @param {number} cx @param {number} cz */
  get(cx, cz) {
    if (!this.inBounds(cx, cz)) return 1;
    return this.cells[this.index(cx, cz)];
  }

  /** @param {number} cx @param {number} cz @param {number} type */
  set(cx, cz, type) {
    if (!this.inBounds(cx, cz)) return false;
    this.cells[this.index(cx, cz)] = type === 1 ? 1 : 0;
    return true;
  }

  clone() {
    return new GridMap(this.width, this.height, this.cells, this.playerSpawn);
  }

  toJSON() {
    return {
      version: MAP_VERSION,
      width: this.width,
      height: this.height,
      cells: Array.from(this.cells),
      playerSpawn: { ...this.playerSpawn },
    };
  }

  /** @param {string | Record<string, unknown>} input */
  static fromJSON(input) {
    const data = typeof input === "string" ? JSON.parse(input) : input;
    if (!data || typeof data !== "object") {
      throw new TypeError("Map JSON must be an object");
    }

    const version = Number(data.version);
    const width = Number(data.width);
    const height = Number(data.height);
    if (version !== MAP_VERSION) throw new RangeError(`Unsupported map version: ${version}`);
    if (!positiveInteger(width) || !positiveInteger(height) || width > 256 || height > 256) {
      throw new RangeError("Map dimensions must be between 1 and 256");
    }
    if (!Array.isArray(data.cells) || data.cells.length !== width * height) {
      throw new RangeError("Map JSON has an invalid cell array");
    }

    const cells = new Uint8Array(data.cells.length);
    for (let index = 0; index < cells.length; index += 1) {
      const tile = Number(data.cells[index]);
      if (tile !== 0 && tile !== 1) throw new RangeError(`Invalid tile at index ${index}`);
      cells[index] = tile;
    }

    const spawn = /** @type {Record<string, unknown>} */ (data.playerSpawn);
    const playerSpawn = { x: Number(spawn?.x), z: Number(spawn?.z) };
    if (!Number.isFinite(playerSpawn.x) || !Number.isFinite(playerSpawn.z)) {
      throw new RangeError("Map JSON has an invalid player spawn");
    }
    const map = new GridMap(width, height, cells, playerSpawn);
    if (map.get(Math.floor(playerSpawn.x), Math.floor(playerSpawn.z)) !== 0) {
      throw new RangeError("Player spawn must be on a floor cell");
    }
    return map;
  }
}

/** @param {number} coordinate */
export function worldToCell(coordinate) {
  return Math.floor(coordinate);
}

/** @param {number} cell */
export function cellToWorldCenter(cell) {
  return cell + 0.5;
}

export function createDebugArenaMap() {
  const map = new GridMap(WORLD.width, WORLD.height, undefined, { x: 3.5, z: 18.5 });

  for (let x = 0; x < map.width; x += 1) {
    map.set(x, 0, 1);
    map.set(x, map.height - 1, 1);
  }
  for (let z = 0; z < map.height; z += 1) {
    map.set(0, z, 1);
    map.set(map.width - 1, z, 1);
  }

  // Boxed room with a one-cell doorway on its west wall.
  for (let x = 14; x <= 21; x += 1) {
    map.set(x, 3, 1);
    map.set(x, 10, 1);
  }
  for (let z = 3; z <= 10; z += 1) {
    if (z !== 7) map.set(14, z, 1);
    map.set(21, z, 1);
  }

  // Offset walls form a corridor, concave corners, and another narrow gate.
  for (let z = 4; z <= 15; z += 1) {
    if (z !== 9) map.set(8, z, 1);
  }
  for (let x = 8; x <= 20; x += 1) {
    if (x !== 13) map.set(x, 15, 1);
  }

  map.set(5, 5, 1);
  map.set(5, 10, 1);
  map.set(11, 19, 1);
  map.set(18, 19, 1);
  return map;
}
