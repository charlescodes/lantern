// @ts-check

import {
  DEFAULT_DEBUG_FLAGS,
  HISTORY,
  PARTICLE,
  PLAYER,
  PROJECTILE,
  SCHEMA_VERSION,
  SIMULATION,
} from "../config.js";
import { RingBuffer } from "../core/ring_buffer.js";
import { normalizeSeed, SeededRng } from "../core/rng.js";
import { firstSolidContact, resolveCircleAgainstGrid } from "./collision.js";
import { createDebugArenaMap, GridMap } from "./grid_map.js";
import { ParticlePool, ProjectilePool } from "./pools.js";

const TAU = Math.PI * 2;

/** @param {unknown} value */
function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/** @param {unknown} value */
function pointFrom(value) {
  if (!value || typeof value !== "object") return null;
  const record = /** @type {Record<string, unknown>} */ (value);
  const x = finiteNumber(record.x);
  const z = finiteNumber(record.z);
  return x === null || z === null ? null : { x, z };
}

/** @param {unknown} value */
function canonicalAction(value) {
  if (!value || typeof value !== "object") return null;
  const action = /** @type {Record<string, unknown>} */ (value);
  switch (action.type) {
    case "setTile":
      return {
        type: "setTile",
        cx: Math.trunc(Number(action.cx)),
        cz: Math.trunc(Number(action.cz)),
        tile: Number(action.tile) === 1 ? 1 : 0,
      };
    case "loadMap":
      return {
        type: "loadMap",
        json: typeof action.json === "string" ? action.json : JSON.stringify(action.json),
      };
    case "setDebugFlag":
      return { type: "setDebugFlag", name: String(action.name), value: Boolean(action.value) };
    case "reset":
      return { type: "reset", seed: normalizeSeed(action.seed) };
    default:
      return null;
  }
}

/** @param {{move:{x:number,z:number}|null,cast:{x:number,z:number}|null,actions:Array<Record<string,unknown>>}} command */
function cloneCanonicalCommand(command) {
  return {
    move: command.move ? { ...command.move } : null,
    cast: command.cast ? { ...command.cast } : null,
    actions: command.actions.map((action) => ({ ...action })),
  };
}

/** @param {ReturnType<GridMap['toJSON']>} map */
function cloneMapJson(map) {
  return {
    version: map.version,
    width: map.width,
    height: map.height,
    cells: [...map.cells],
    playerSpawn: { ...map.playerSpawn },
  };
}

/**
 * Converts UI, probe, or replay input into the only command shape consumed by a tick.
 * @param {unknown} input
 */
export function canonicalizeCommand(input) {
  if (!input || typeof input !== "object") {
    return { move: null, cast: null, actions: [] };
  }
  const source = /** @type {Record<string, unknown>} */ (input);
  const move = pointFrom(source.move ?? source.moveTarget);
  const cast = pointFrom(source.cast ?? source.castTarget);
  const actions = [];
  if (Array.isArray(source.actions)) {
    for (const item of source.actions) {
      const action = canonicalAction(item);
      if (action) actions.push(action);
    }
  }
  if (typeof source.type === "string") {
    const action = canonicalAction(source);
    if (action) actions.push(action);
  }
  return { move, cast, actions };
}

/** @param {number} current @param {number} target @param {number} maximumDelta */
function approach(current, target, maximumDelta) {
  const delta = target - current;
  if (Math.abs(delta) <= maximumDelta) return target;
  return current + Math.sign(delta) * maximumDelta;
}

export class Simulation {
  /**
   * @param {{seed?:unknown,map?:GridMap,projectileCapacity?:number,particleCapacity?:number,particleBurstCount?:number}} [options]
   */
  constructor(options = {}) {
    this.map = options.map?.clone() ?? createDebugArenaMap();
    this.seed = normalizeSeed(options.seed ?? 0x1a2b3c4d);
    this.rng = new SeededRng(this.seed);
    this.projectiles = new ProjectilePool(options.projectileCapacity ?? PROJECTILE.capacity);
    this.particles = new ParticlePool(options.particleCapacity ?? PARTICLE.capacity);
    this.particleBurstCount = options.particleBurstCount ?? PARTICLE.burstCount;
    this.impactEvents = new RingBuffer(HISTORY.events);
    this.commandLog = new RingBuffer(HISTORY.commands);
    this.commandLogDropped = 0;
    this.commandLogMap = this.map.toJSON();
    this.debugFlags = { ...DEFAULT_DEBUG_FLAGS };
    this.tickCount = 0;
    this.player = {
      id: 1,
      x: this.map.playerSpawn.x,
      z: this.map.playerSpawn.z,
      previousX: this.map.playerSpawn.x,
      previousZ: this.map.playerSpawn.z,
      vx: 0,
      vz: 0,
      desiredVx: 0,
      desiredVz: 0,
      radius: PLAYER.radius,
      cooldown: 0,
    };
    this.contacts = {
      count: 0,
      dropped: 0,
      x: new Float32Array(32),
      z: new Float32Array(32),
      nx: new Float32Array(32),
      nz: new Float32Array(32),
      penetration: new Float32Array(32),
      cx: new Int16Array(32),
      cz: new Int16Array(32),
    };
    this._collisionScratch = {
      nx: 0,
      nz: 0,
      penetration: 0,
      px: 0,
      pz: 0,
      cx: 0,
      cz: 0,
    };
    this._recordContact = (contact) => this.#recordContact(contact);
    this.lastError = null;
    this.reset(this.seed);
  }

  /** @param {unknown} seed @param {{clearLog?:boolean}} [options] */
  reset(seed = this.seed, options = {}) {
    this.seed = normalizeSeed(seed);
    this.rng.reset(this.seed);
    this.tickCount = 0;
    this.projectiles.reset();
    this.particles.reset();
    this.impactEvents.clear();
    this.contacts.count = 0;
    this.contacts.dropped = 0;
    Object.assign(this.player, {
      x: this.map.playerSpawn.x,
      z: this.map.playerSpawn.z,
      previousX: this.map.playerSpawn.x,
      previousZ: this.map.playerSpawn.z,
      vx: 0,
      vz: 0,
      desiredVx: 0,
      desiredVz: 0,
      cooldown: 0,
    });
    if (options.clearLog !== false) {
      this.commandLog.clear();
      this.commandLogDropped = 0;
      this.commandLogMap = this.map.toJSON();
    }
    this.lastError = null;
  }

  /** @param {unknown} input */
  tick(input) {
    const command = canonicalizeCommand(input);
    this.contacts.count = 0;
    this.#applyActions(command.actions);
    this.#movementSystem(command.move, SIMULATION.dt);
    this.#castSystem(command.cast);
    this.#projectileSystem(SIMULATION.dt);
    this.#particleSystem(SIMULATION.dt);
    this.tickCount += 1;
    if (this.commandLog.length === this.commandLog.capacity) this.commandLogDropped += 1;
    this.commandLog.push({ tick: this.tickCount, command });
    return this.tickCount;
  }

  /** @param {Array<Record<string, unknown>>} actions */
  #applyActions(actions) {
    for (const action of actions) {
      try {
        if (action.type === "reset") {
          this.reset(action.seed);
        } else if (action.type === "setTile") {
          this.map.set(action.cx, action.cz, action.tile);
        } else if (action.type === "loadMap") {
          this.map = GridMap.fromJSON(action.json);
          this.projectiles.reset();
          this.particles.reset();
          Object.assign(this.player, {
            x: this.map.playerSpawn.x,
            z: this.map.playerSpawn.z,
            previousX: this.map.playerSpawn.x,
            previousZ: this.map.playerSpawn.z,
            vx: 0,
            vz: 0,
            desiredVx: 0,
            desiredVz: 0,
          });
        } else if (
          action.type === "setDebugFlag" &&
          Object.hasOwn(this.debugFlags, action.name)
        ) {
          this.debugFlags[action.name] = action.value;
        }
        this.lastError = null;
      } catch (error) {
        this.lastError = error instanceof Error ? error.message : String(error);
      }
    }
  }

  /** @param {{x:number,z:number}|null} target @param {number} dt */
  #movementSystem(target, dt) {
    const player = this.player;
    player.previousX = player.x;
    player.previousZ = player.z;
    let desiredVx = 0;
    let desiredVz = 0;
    if (target) {
      const dx = target.x - player.x;
      const dz = target.z - player.z;
      const length = Math.hypot(dx, dz);
      if (length > 1e-5) {
        desiredVx = (dx / length) * PLAYER.desiredSpeed;
        desiredVz = (dz / length) * PLAYER.desiredSpeed;
      }
    }
    player.desiredVx = desiredVx;
    player.desiredVz = desiredVz;

    const deltaVx = desiredVx - player.vx;
    const deltaVz = desiredVz - player.vz;
    const deltaLength = Math.hypot(deltaVx, deltaVz);
    const rate = target ? PLAYER.acceleration : PLAYER.braking;
    const maximumDelta = rate * dt;
    if (deltaLength <= maximumDelta || deltaLength <= 1e-9) {
      player.vx = desiredVx;
      player.vz = desiredVz;
    } else {
      player.vx += (deltaVx / deltaLength) * maximumDelta;
      player.vz += (deltaVz / deltaLength) * maximumDelta;
    }

    player.x += player.vx * dt;
    player.z += player.vz * dt;
    resolveCircleAgainstGrid(this.map, player, player.radius, this._recordContact);
    player.cooldown = approach(player.cooldown, 0, dt);
  }

  /** @param {{nx:number,nz:number,penetration:number,px:number,pz:number,cx:number,cz:number}} contact */
  #recordContact(contact) {
    const index = this.contacts.count;
    if (index >= this.contacts.x.length) {
      this.contacts.dropped += 1;
      return;
    }
    this.contacts.x[index] = contact.px;
    this.contacts.z[index] = contact.pz;
    this.contacts.nx[index] = contact.nx;
    this.contacts.nz[index] = contact.nz;
    this.contacts.penetration[index] = contact.penetration;
    this.contacts.cx[index] = contact.cx;
    this.contacts.cz[index] = contact.cz;
    this.contacts.count += 1;
  }

  /** @param {{x:number,z:number}|null} target */
  #castSystem(target) {
    const player = this.player;
    if (!target || player.cooldown > 0) return;
    const dx = target.x - player.x;
    const dz = target.z - player.z;
    const distance = Math.hypot(dx, dz);
    if (distance <= 1e-5) return;
    const nx = dx / distance;
    const nz = dz / distance;
    const offset = player.radius + PROJECTILE.radius + PROJECTILE.spawnGap;
    const id = this.projectiles.spawn({
      x: player.x + nx * offset,
      z: player.z + nz * offset,
      vx: nx * PROJECTILE.speed,
      vz: nz * PROJECTILE.speed,
      lifetime: PROJECTILE.lifetime,
      radius: PROJECTILE.radius,
    });
    if (id !== 0) player.cooldown = PROJECTILE.cooldown;
  }

  /** @param {number} dt */
  #projectileSystem(dt) {
    const pool = this.projectiles;
    let index = 0;
    while (index < pool.activeCount) {
      pool.previousX[index] = pool.x[index];
      pool.previousZ[index] = pool.z[index];
      pool.age[index] += dt;
      if (pool.age[index] >= pool.lifetime[index]) {
        pool.removeSwap(index);
        continue;
      }

      const startX = pool.x[index];
      const startZ = pool.z[index];
      const deltaX = pool.vx[index] * dt;
      const deltaZ = pool.vz[index] * dt;
      const distance = Math.hypot(deltaX, deltaZ);
      const stepLength = Math.max(0.025, pool.radius[index] * 0.5);
      const steps = Math.max(1, Math.ceil(distance / stepLength));
      let hit = false;
      let hitX = startX;
      let hitZ = startZ;
      for (let step = 0; step <= steps; step += 1) {
        const alpha = step / steps;
        const testX = startX + deltaX * alpha;
        const testZ = startZ + deltaZ * alpha;
        if (firstSolidContact(this.map, testX, testZ, pool.radius[index], this._collisionScratch)) {
          hit = true;
          hitX = testX;
          hitZ = testZ;
          break;
        }
      }

      if (hit) {
        const event = {
          type: "projectileImpact",
          tick: this.tickCount + 1,
          projectileId: pool.id[index],
          x: hitX,
          y: PARTICLE.initialY,
          z: hitZ,
          nx: this._collisionScratch.nx,
          nz: this._collisionScratch.nz,
          cell: { cx: this._collisionScratch.cx, cz: this._collisionScratch.cz },
        };
        this.impactEvents.push(event);
        this.#emitExplosion(event.x, event.z, event.nx, event.nz);
        pool.removeSwap(index);
        continue;
      }

      pool.x[index] = startX + deltaX;
      pool.z[index] = startZ + deltaZ;
      index += 1;
    }
  }

  /** @param {number} x @param {number} z @param {number} normalX @param {number} normalZ */
  #emitExplosion(x, z, normalX, normalZ) {
    for (let count = 0; count < this.particleBurstCount; count += 1) {
      const angle = this.rng.range(0, TAU);
      const horizontalSpeed = this.rng.range(1.4, 5.8);
      const outwardBias = this.rng.range(0.2, 1.1);
      let vx = Math.cos(angle) * horizontalSpeed + normalX * outwardBias;
      let vz = Math.sin(angle) * horizontalSpeed + normalZ * outwardBias;
      const maximumHorizontal = 7;
      const horizontalLength = Math.hypot(vx, vz);
      if (horizontalLength > maximumHorizontal) {
        vx = (vx / horizontalLength) * maximumHorizontal;
        vz = (vz / horizontalLength) * maximumHorizontal;
      }
      this.particles.spawn({
        x,
        y: PARTICLE.initialY,
        z,
        vx,
        vy: this.rng.range(2.2, 7.5),
        vz,
        lifetime: this.rng.range(0.25, 0.8),
        size: this.rng.range(0.025, 0.085),
      });
    }
  }

  /** @param {number} dt */
  #particleSystem(dt) {
    const pool = this.particles;
    let index = 0;
    while (index < pool.activeCount) {
      pool.age[index] += dt;
      if (pool.age[index] >= pool.lifetime[index]) {
        pool.removeSwap(index);
        continue;
      }
      pool.vy[index] += PARTICLE.gravity * dt;
      pool.x[index] += pool.vx[index] * dt;
      pool.y[index] += pool.vy[index] * dt;
      pool.z[index] += pool.vz[index] * dt;
      if (pool.y[index] <= 0) {
        if (this.debugFlags.particleBounce && pool.bounced[index] === 0) {
          pool.y[index] = 0;
          pool.vy[index] = Math.abs(pool.vy[index]) * 0.35;
          pool.vx[index] *= 0.75;
          pool.vz[index] *= 0.75;
          pool.bounced[index] = 1;
        } else {
          pool.removeSwap(index);
          continue;
        }
      }
      index += 1;
    }
  }

  snapshot() {
    const projectiles = new Array(this.projectiles.activeCount);
    for (let index = 0; index < projectiles.length; index += 1) {
      projectiles[index] = {
        kind: "projectile",
        id: this.projectiles.id[index],
        index,
        x: this.projectiles.x[index],
        z: this.projectiles.z[index],
        previousX: this.projectiles.previousX[index],
        previousZ: this.projectiles.previousZ[index],
        vx: this.projectiles.vx[index],
        vz: this.projectiles.vz[index],
        radius: this.projectiles.radius[index],
        age: this.projectiles.age[index],
        lifetime: this.projectiles.lifetime[index],
      };
    }

    const particles = new Array(this.particles.activeCount);
    for (let index = 0; index < particles.length; index += 1) {
      particles[index] = {
        kind: "particle",
        id: this.particles.id[index],
        index,
        x: this.particles.x[index],
        y: this.particles.y[index],
        z: this.particles.z[index],
        vx: this.particles.vx[index],
        vy: this.particles.vy[index],
        vz: this.particles.vz[index],
        size: this.particles.size[index],
        age: this.particles.age[index],
        lifetime: this.particles.lifetime[index],
        flags: { bounced: Boolean(this.particles.bounced[index]) },
      };
    }

    const contacts = new Array(this.contacts.count);
    for (let index = 0; index < contacts.length; index += 1) {
      contacts[index] = {
        x: this.contacts.x[index],
        z: this.contacts.z[index],
        nx: this.contacts.nx[index],
        nz: this.contacts.nz[index],
        penetration: this.contacts.penetration[index],
        cell: { cx: this.contacts.cx[index], cz: this.contacts.cz[index] },
      };
    }

    return {
      schemaVersion: SCHEMA_VERSION,
      seed: this.seed,
      rngState: this.rng.state,
      tick: this.tickCount,
      map: {
        version: this.map.toJSON().version,
        width: this.map.width,
        height: this.map.height,
        cells: Array.from(this.map.cells),
        playerSpawn: { ...this.map.playerSpawn },
      },
      player: { kind: "player", index: 0, ...this.player },
      projectiles,
      particles,
      contacts,
      recentEvents: this.impactEvents.toArray(32).map((event) => ({
        ...event,
        cell: event.cell ? { ...event.cell } : null,
      })),
      pools: {
        projectiles: {
          active: this.projectiles.activeCount,
          capacity: this.projectiles.capacity,
          dropped: this.projectiles.dropped,
        },
        particles: {
          active: this.particles.activeCount,
          capacity: this.particles.capacity,
          dropped: this.particles.dropped,
        },
      },
      debugFlags: { ...this.debugFlags },
      commandLog: {
        retained: this.commandLog.length,
        capacity: this.commandLog.capacity,
        dropped: this.commandLogDropped,
      },
      lastError: this.lastError,
    };
  }

  /** @param {number} x @param {number} z */
  queryAt(x, z) {
    let best = null;
    let bestDistance = Infinity;
    const playerDistance = Math.hypot(x - this.player.x, z - this.player.z);
    if (playerDistance <= this.player.radius) {
      best = this.#describePlayer();
      bestDistance = playerDistance;
    }
    for (let index = 0; index < this.projectiles.activeCount; index += 1) {
      const distance = Math.hypot(x - this.projectiles.x[index], z - this.projectiles.z[index]);
      if (distance <= this.projectiles.radius[index] + 0.08 && distance < bestDistance) {
        best = this.#describeProjectile(index);
        bestDistance = distance;
      }
    }
    for (let index = 0; index < this.particles.activeCount; index += 1) {
      const distance = Math.hypot(x - this.particles.x[index], z - this.particles.z[index]);
      if (distance <= this.particles.size[index] + 0.08 && distance < bestDistance) {
        best = this.#describeParticle(index);
        bestDistance = distance;
      }
    }
    if (best) return best;
    const cx = Math.floor(x);
    const cz = Math.floor(z);
    return {
      kind: "cell",
      id: `${cx}:${cz}`,
      index: this.map.inBounds(cx, cz) ? this.map.index(cx, cz) : -1,
      position: { x: cx + 0.5, y: 0, z: cz + 0.5 },
      velocity: null,
      radius: null,
      cell: { cx, cz, tile: this.map.get(cx, cz), inBounds: this.map.inBounds(cx, cz) },
      age: null,
      lifetime: null,
      flags: { solid: this.map.get(cx, cz) === 1 },
    };
  }

  /** @param {{kind:string,id:number|string}|null} selection */
  resolveSelection(selection) {
    if (!selection) return null;
    if (selection.kind === "player" && Number(selection.id) === this.player.id) {
      return this.#describePlayer();
    }
    if (selection.kind === "projectile") {
      const index = this.projectiles.findIndexById(Number(selection.id));
      return index < 0 ? null : this.#describeProjectile(index);
    }
    if (selection.kind === "particle") {
      const index = this.particles.findIndexById(Number(selection.id));
      return index < 0 ? null : this.#describeParticle(index);
    }
    if (selection.kind === "cell") {
      const [cx, cz] = String(selection.id).split(":").map(Number);
      return this.queryAt(cx + 0.5, cz + 0.5);
    }
    return null;
  }

  #describePlayer() {
    return {
      kind: "player",
      id: this.player.id,
      index: 0,
      position: { x: this.player.x, y: 0, z: this.player.z },
      velocity: { x: this.player.vx, y: 0, z: this.player.vz },
      desiredVelocity: { x: this.player.desiredVx, y: 0, z: this.player.desiredVz },
      radius: this.player.radius,
      cell: null,
      age: null,
      lifetime: null,
      flags: { coolingDown: this.player.cooldown > 0 },
      raw: { ...this.player },
    };
  }

  /** @param {number} index */
  #describeProjectile(index) {
    return {
      kind: "projectile",
      id: this.projectiles.id[index],
      index,
      position: { x: this.projectiles.x[index], y: PROJECTILE.radius, z: this.projectiles.z[index] },
      velocity: { x: this.projectiles.vx[index], y: 0, z: this.projectiles.vz[index] },
      radius: this.projectiles.radius[index],
      cell: null,
      age: this.projectiles.age[index],
      lifetime: this.projectiles.lifetime[index],
      flags: {},
    };
  }

  /** @param {number} index */
  #describeParticle(index) {
    return {
      kind: "particle",
      id: this.particles.id[index],
      index,
      position: {
        x: this.particles.x[index],
        y: this.particles.y[index],
        z: this.particles.z[index],
      },
      velocity: {
        x: this.particles.vx[index],
        y: this.particles.vy[index],
        z: this.particles.vz[index],
      },
      radius: this.particles.size[index],
      cell: null,
      age: this.particles.age[index],
      lifetime: this.particles.lifetime[index],
      flags: { bounced: Boolean(this.particles.bounced[index]) },
    };
  }

  saveMap() {
    return JSON.stringify(this.map.toJSON(), null, 2);
  }

  exportCommandLog() {
    return {
      schemaVersion: SCHEMA_VERSION,
      seed: this.seed,
      initialMap: cloneMapJson(this.commandLogMap),
      configuration: {
        projectileCapacity: this.projectiles.capacity,
        particleCapacity: this.particles.capacity,
        particleBurstCount: this.particleBurstCount,
      },
      truncated: this.commandLogDropped > 0,
      commands: this.commandLog.toArray().map((entry) => ({
        tick: entry.tick,
        command: cloneCanonicalCommand(entry.command),
      })),
    };
  }

  /** @param {{seed:unknown,initialMap:Record<string,unknown>,configuration?:{projectileCapacity?:number,particleCapacity?:number,particleBurstCount?:number},commands:Array<{command:unknown}>}} recording */
  static replay(recording) {
    const simulation = new Simulation({
      seed: recording.seed,
      map: GridMap.fromJSON(recording.initialMap),
      projectileCapacity: recording.configuration?.projectileCapacity,
      particleCapacity: recording.configuration?.particleCapacity,
      particleBurstCount: recording.configuration?.particleBurstCount,
    });
    for (const entry of recording.commands) simulation.tick(entry.command);
    return simulation;
  }
}
