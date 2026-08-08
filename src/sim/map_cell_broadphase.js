// @ts-check

const EMPTY_POOL = Object.freeze({
  activeCount: 0,
  x: new Float32Array(0),
  z: new Float32Array(0),
});

/**
 * Preallocated center-cell broadphase. Candidate lists are deduplicated and
 * sorted by pool index so narrow-phase resolution keeps historical ordering.
 */
export class MapCellBroadphase {
  /**
   * @param {{width:number,height:number}} map
   * @param {{enemyCapacity:number,rockCapacity:number,projectileCapacity:number,deadBodyCapacity?:number,enabled?:boolean}} capacities
   */
  constructor(map, capacities) {
    this.width = map.width;
    this.height = map.height;
    this.cellCount = map.width * map.height;
    this.enabled = capacities.enabled !== false;
    this.activeEnemies = 0;
    this.activeRocks = 0;
    this.activeProjectiles = 0;
    this.activeDeadBodies = 0;
    this.enemyHeads = new Int16Array(this.cellCount);
    this.rockHeads = new Int16Array(this.cellCount);
    this.projectileHeads = new Int16Array(this.cellCount);
    this.deadBodyHeads = new Int16Array(this.cellCount);
    this.enemyNext = new Int16Array(capacities.enemyCapacity);
    this.rockNext = new Int16Array(capacities.rockCapacity);
    this.projectileNext = new Int16Array(capacities.projectileCapacity);
    this.deadBodyNext = new Int16Array(capacities.deadBodyCapacity ?? 1);
    this.enemyMarks = new Uint32Array(capacities.enemyCapacity);
    this.rockMarks = new Uint32Array(capacities.rockCapacity);
    this.projectileMarks = new Uint32Array(capacities.projectileCapacity);
    this.deadBodyMarks = new Uint32Array(capacities.deadBodyCapacity ?? 1);
    this.enemyCandidates = new Int16Array(capacities.enemyCapacity);
    this.rockCandidates = new Int16Array(capacities.rockCapacity);
    this.projectileCandidates = new Int16Array(capacities.projectileCapacity);
    this.deadBodyCandidates = new Int16Array(capacities.deadBodyCapacity ?? 1);
    this.enemyCount = 0;
    this.rockCount = 0;
    this.projectileCount = 0;
    this.deadBodyCount = 0;
    this.generation = 0;
    this.builds = 0;
    this.queries = 0;
    this.candidates = 0;
    this.reset(map);
  }

  /** @param {{width:number,height:number}} map */
  reset(map) {
    if (map.width !== this.width || map.height !== this.height) {
      this.width = map.width;
      this.height = map.height;
      this.cellCount = map.width * map.height;
      this.enemyHeads = new Int16Array(this.cellCount);
      this.rockHeads = new Int16Array(this.cellCount);
      this.projectileHeads = new Int16Array(this.cellCount);
      this.deadBodyHeads = new Int16Array(this.cellCount);
    }
    this.enemyHeads.fill(-1);
    this.rockHeads.fill(-1);
    this.projectileHeads.fill(-1);
    this.deadBodyHeads.fill(-1);
    this.enemyNext.fill(-1);
    this.rockNext.fill(-1);
    this.projectileNext.fill(-1);
    this.deadBodyNext.fill(-1);
    this.enemyMarks.fill(0);
    this.rockMarks.fill(0);
    this.projectileMarks.fill(0);
    this.deadBodyMarks.fill(0);
    this.enemyCount = 0;
    this.rockCount = 0;
    this.projectileCount = 0;
    this.deadBodyCount = 0;
    this.generation = 0;
    this.builds = 0;
    this.queries = 0;
    this.candidates = 0;
  }

  /** @param {number} x @param {number} z */
  #cellIndex(x, z) {
    const cx = Math.max(0, Math.min(this.width - 1, Math.floor(x)));
    const cz = Math.max(0, Math.min(this.height - 1, Math.floor(z)));
    return cz * this.width + cx;
  }

  /**
   * @param {{activeCount:number,x:Float32Array,z:Float32Array}} enemies
   * @param {{activeCount:number,x:Float32Array,z:Float32Array}} rocks
   * @param {{activeCount:number,x:Float32Array,z:Float32Array}} projectiles
   * @param {{activeCount:number,x:Float32Array,z:Float32Array}} [deadBodies]
   */
  rebuild(enemies, rocks, projectiles, deadBodies = EMPTY_POOL) {
    this.activeEnemies = enemies.activeCount;
    this.activeRocks = rocks.activeCount;
    this.activeProjectiles = projectiles.activeCount;
    this.activeDeadBodies = deadBodies.activeCount;
    if (!this.enabled) {
      this.builds += 1;
      return;
    }
    this.enemyHeads.fill(-1);
    this.rockHeads.fill(-1);
    this.projectileHeads.fill(-1);
    this.deadBodyHeads.fill(-1);
    for (let index = enemies.activeCount - 1; index >= 0; index -= 1) {
      const cell = this.#cellIndex(enemies.x[index], enemies.z[index]);
      this.enemyNext[index] = this.enemyHeads[cell];
      this.enemyHeads[cell] = index;
    }
    for (let index = rocks.activeCount - 1; index >= 0; index -= 1) {
      const cell = this.#cellIndex(rocks.x[index], rocks.z[index]);
      this.rockNext[index] = this.rockHeads[cell];
      this.rockHeads[cell] = index;
    }
    for (let index = projectiles.activeCount - 1; index >= 0; index -= 1) {
      const cell = this.#cellIndex(projectiles.x[index], projectiles.z[index]);
      this.projectileNext[index] = this.projectileHeads[cell];
      this.projectileHeads[cell] = index;
    }
    for (let index = deadBodies.activeCount - 1; index >= 0; index -= 1) {
      const cell = this.#cellIndex(deadBodies.x[index], deadBodies.z[index]);
      this.deadBodyNext[index] = this.deadBodyHeads[cell];
      this.deadBodyHeads[cell] = index;
    }
    this.builds += 1;
  }

  #nextGeneration() {
    this.generation = (this.generation + 1) >>> 0;
    if (this.generation === 0) {
      this.enemyMarks.fill(0);
      this.rockMarks.fill(0);
      this.projectileMarks.fill(0);
      this.deadBodyMarks.fill(0);
      this.generation = 1;
    }
    return this.generation;
  }

  /**
   * @param {Int16Array} heads
   * @param {Int16Array} next
   * @param {Uint32Array} marks
   * @param {Int16Array} output
   * @param {number} minimumX
   * @param {number} minimumZ
   * @param {number} maximumX
   * @param {number} maximumZ
   * @param {number} minimumIndex
   */
  #query(heads, next, marks, output, minimumX, minimumZ, maximumX, maximumZ, minimumIndex) {
    const generation = this.#nextGeneration();
    const minimumCx = Math.max(0, Math.floor(Math.min(minimumX, maximumX)));
    const maximumCx = Math.min(this.width - 1, Math.floor(Math.max(minimumX, maximumX)));
    const minimumCz = Math.max(0, Math.floor(Math.min(minimumZ, maximumZ)));
    const maximumCz = Math.min(this.height - 1, Math.floor(Math.max(minimumZ, maximumZ)));
    let count = 0;
    if (minimumCx <= maximumCx && minimumCz <= maximumCz) {
      for (let cz = minimumCz; cz <= maximumCz; cz += 1) {
        for (let cx = minimumCx; cx <= maximumCx; cx += 1) {
          let index = heads[cz * this.width + cx];
          while (index >= 0) {
            if (index >= minimumIndex && marks[index] !== generation) {
              marks[index] = generation;
              output[count] = index;
              count += 1;
            }
            index = next[index];
          }
        }
      }
    }
    for (let index = 1; index < count; index += 1) {
      const value = output[index];
      let position = index - 1;
      while (position >= 0 && output[position] > value) {
        output[position + 1] = output[position];
        position -= 1;
      }
      output[position + 1] = value;
    }
    this.queries += 1;
    this.candidates += count;
    return count;
  }

  /** @param {number} minX @param {number} minZ @param {number} maxX @param {number} maxZ @param {number} [minimumIndex] */
  queryEnemies(minX, minZ, maxX, maxZ, minimumIndex = 0) {
    if (!this.enabled) {
      this.enemyCount = 0;
      for (let index = minimumIndex; index < this.activeEnemies; index += 1) {
        this.enemyCandidates[this.enemyCount] = index;
        this.enemyCount += 1;
      }
      return this.enemyCount;
    }
    this.enemyCount = this.#query(
      this.enemyHeads,
      this.enemyNext,
      this.enemyMarks,
      this.enemyCandidates,
      minX,
      minZ,
      maxX,
      maxZ,
      minimumIndex,
    );
    return this.enemyCount;
  }

  /** @param {number} minX @param {number} minZ @param {number} maxX @param {number} maxZ @param {number} [minimumIndex] */
  queryRocks(minX, minZ, maxX, maxZ, minimumIndex = 0) {
    if (!this.enabled) {
      this.rockCount = 0;
      for (let index = minimumIndex; index < this.activeRocks; index += 1) {
        this.rockCandidates[this.rockCount] = index;
        this.rockCount += 1;
      }
      return this.rockCount;
    }
    this.rockCount = this.#query(
      this.rockHeads,
      this.rockNext,
      this.rockMarks,
      this.rockCandidates,
      minX,
      minZ,
      maxX,
      maxZ,
      minimumIndex,
    );
    return this.rockCount;
  }

  /** @param {number} minX @param {number} minZ @param {number} maxX @param {number} maxZ @param {number} [minimumIndex] */
  queryProjectiles(minX, minZ, maxX, maxZ, minimumIndex = 0) {
    if (!this.enabled) {
      this.projectileCount = 0;
      for (let index = minimumIndex; index < this.activeProjectiles; index += 1) {
        this.projectileCandidates[this.projectileCount] = index;
        this.projectileCount += 1;
      }
      return this.projectileCount;
    }
    this.projectileCount = this.#query(
      this.projectileHeads,
      this.projectileNext,
      this.projectileMarks,
      this.projectileCandidates,
      minX,
      minZ,
      maxX,
      maxZ,
      minimumIndex,
    );
    return this.projectileCount;
  }

  /** @param {number} minX @param {number} minZ @param {number} maxX @param {number} maxZ @param {number} [minimumIndex] */
  queryDeadBodies(minX, minZ, maxX, maxZ, minimumIndex = 0) {
    if (!this.enabled) {
      this.deadBodyCount = 0;
      for (let index = minimumIndex; index < this.activeDeadBodies; index += 1) {
        this.deadBodyCandidates[this.deadBodyCount] = index;
        this.deadBodyCount += 1;
      }
      return this.deadBodyCount;
    }
    this.deadBodyCount = this.#query(
      this.deadBodyHeads,
      this.deadBodyNext,
      this.deadBodyMarks,
      this.deadBodyCandidates,
      minX,
      minZ,
      maxX,
      maxZ,
      minimumIndex,
    );
    return this.deadBodyCount;
  }

  diagnostics() {
    return {
      type: "map-cell-broadphase",
      enabled: this.enabled,
      width: this.width,
      height: this.height,
      cells: this.cellCount,
      builds: this.builds,
      queries: this.queries,
      candidates: this.candidates,
    };
  }
}
