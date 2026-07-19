// @ts-check

import {
  MAP_VERSION,
  PLAYER,
  ROCK,
  ROCK_ARCHETYPES,
  SCENARIO_VERSION,
} from "../config.js";
import { firstSolidContact } from "./collision.js";
import { createDebugArenaMap, GridMap } from "./grid_map.js";

/** @param {unknown} value */
function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/** @param {string} archetype */
export function getRockArchetype(archetype) {
  return Object.hasOwn(ROCK_ARCHETYPES, archetype) ? ROCK_ARCHETYPES[archetype] : null;
}

/** @param {{kind:"rock",archetype:string,x:number,z:number,spawnId:number}} entity */
function cloneEntity(entity) {
  return { ...entity };
}

export class ArenaScenario {
  /**
   * @param {GridMap} map
   * @param {Array<{kind:"rock",archetype:string,x:number,z:number,spawnId?:number}>} [entities]
   */
  constructor(map, entities = []) {
    if (entities.length > ROCK.capacity) {
      throw new RangeError(`Scenario entity count exceeds the ${ROCK.capacity}-rock limit`);
    }
    this.map = map.clone();
    this.entities = [];
    this.nextSpawnId = 1;
    for (const entity of entities) {
      const spawnId = Number.isInteger(entity.spawnId) && entity.spawnId > 0
        ? entity.spawnId
        : this.nextSpawnId;
      this.entities.push({
        kind: "rock",
        archetype: entity.archetype,
        x: entity.x,
        z: entity.z,
        spawnId,
      });
      this.nextSpawnId = Math.max(this.nextSpawnId, spawnId + 1);
    }
    this.#validateAll();
  }

  clone() {
    return new ArenaScenario(this.map, this.entities.map(cloneEntity));
  }

  toJSON() {
    return {
      version: SCENARIO_VERSION,
      width: this.map.width,
      height: this.map.height,
      cells: Array.from(this.map.cells),
      playerSpawn: { ...this.map.playerSpawn },
      entities: this.entities.map((entity) => ({
        kind: entity.kind,
        archetype: entity.archetype,
        x: entity.x,
        z: entity.z,
      })),
    };
  }

  /** @param {number} cx @param {number} cz @param {number} tile */
  setTile(cx, cz, tile) {
    if (!this.map.inBounds(cx, cz)) return false;
    const previous = this.map.get(cx, cz);
    this.map.set(cx, cz, tile);
    if (tile === 1 && !this.#placementsAreValid()) {
      this.map.set(cx, cz, previous);
      return false;
    }
    return true;
  }

  /** @param {string} archetype @param {number} x @param {number} z */
  canPlaceRock(archetype, x, z) {
    const definition = getRockArchetype(archetype);
    if (!definition || !Number.isFinite(x) || !Number.isFinite(z)) return false;
    if (this.#circleTouchesSolid(x, z, definition.radius)) return false;
    if (Math.hypot(x - this.map.playerSpawn.x, z - this.map.playerSpawn.z) < definition.radius + PLAYER.radius) {
      return false;
    }
    for (const entity of this.entities) {
      const other = getRockArchetype(entity.archetype);
      if (other && Math.hypot(x - entity.x, z - entity.z) < definition.radius + other.radius) {
        return false;
      }
    }
    return true;
  }

  /** @param {string} archetype @param {number} x @param {number} z */
  placeRock(archetype, x, z) {
    if (!this.canPlaceRock(archetype, x, z)) return 0;
    const spawnId = this.nextSpawnId;
    this.nextSpawnId += 1;
    this.entities.push({ kind: "rock", archetype, x, z, spawnId });
    return spawnId;
  }

  /** @param {number} spawnId */
  removeRock(spawnId) {
    const index = this.entities.findIndex((entity) => entity.spawnId === spawnId);
    if (index < 0) return false;
    this.entities.splice(index, 1);
    return true;
  }

  #placementsAreValid() {
    if (this.#circleTouchesSolid(this.map.playerSpawn.x, this.map.playerSpawn.z, PLAYER.radius)) {
      return false;
    }
    for (const entity of this.entities) {
      const definition = getRockArchetype(entity.archetype);
      if (!definition || this.#circleTouchesSolid(entity.x, entity.z, definition.radius)) return false;
    }
    return true;
  }

  /** @param {number} x @param {number} z @param {number} radius */
  #circleTouchesSolid(x, z, radius) {
    const contact = { nx: 0, nz: 0, penetration: 0, px: 0, pz: 0, cx: 0, cz: 0 };
    return firstSolidContact(this.map, x, z, radius, contact);
  }

  #validateAll() {
    if (!this.#placementsAreValid()) throw new RangeError("Scenario contains a body inside solid geometry");
    for (let left = 0; left < this.entities.length; left += 1) {
      const a = this.entities[left];
      const aDefinition = getRockArchetype(a.archetype);
      if (!aDefinition) throw new RangeError(`Unknown rock archetype: ${a.archetype}`);
      for (let right = left + 1; right < this.entities.length; right += 1) {
        const b = this.entities[right];
        const bDefinition = getRockArchetype(b.archetype);
        if (
          bDefinition &&
          Math.hypot(a.x - b.x, a.z - b.z) < aDefinition.radius + bDefinition.radius
        ) {
          throw new RangeError("Scenario contains overlapping rocks");
        }
      }
      if (
        Math.hypot(a.x - this.map.playerSpawn.x, a.z - this.map.playerSpawn.z) <
        aDefinition.radius + PLAYER.radius
      ) {
        throw new RangeError("Scenario contains a rock overlapping the player spawn");
      }
    }
  }

  /** @param {string | Record<string, unknown>} input */
  static fromJSON(input) {
    const data = typeof input === "string" ? JSON.parse(input) : input;
    if (!data || typeof data !== "object") throw new TypeError("Scenario JSON must be an object");
    const version = Number(data.version);
    if (version === MAP_VERSION) {
      return new ArenaScenario(GridMap.fromJSON(data));
    }
    if (version !== SCENARIO_VERSION) {
      throw new RangeError(`Unsupported scenario version: ${version}`);
    }

    const map = GridMap.fromJSON({
      version: MAP_VERSION,
      width: data.width,
      height: data.height,
      cells: data.cells,
      playerSpawn: data.playerSpawn,
    });
    if (!Array.isArray(data.entities)) throw new RangeError("Scenario JSON has an invalid entity array");
    const entities = data.entities.map((value, index) => {
      if (!value || typeof value !== "object") {
        throw new RangeError(`Invalid scenario entity at index ${index}`);
      }
      const entity = /** @type {Record<string, unknown>} */ (value);
      const archetype = String(entity.archetype);
      const x = finite(entity.x);
      const z = finite(entity.z);
      if (entity.kind !== "rock" || !getRockArchetype(archetype) || x === null || z === null) {
        throw new RangeError(`Invalid scenario entity at index ${index}`);
      }
      return { kind: /** @type {"rock"} */ ("rock"), archetype, x, z };
    });
    return new ArenaScenario(map, entities);
  }
}

export function createDebugArenaScenario() {
  return new ArenaScenario(createDebugArenaMap(), [
    { kind: "rock", archetype: "small", x: 5, z: 18.5 },
    { kind: "rock", archetype: "medium", x: 6.5, z: 18.5 },
    { kind: "rock", archetype: "large", x: 4.5, z: 21 },
    { kind: "rock", archetype: "small", x: 9.5, z: 12.5 },
  ]);
}
