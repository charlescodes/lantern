// @ts-check

import {
  DEFAULT_DEBUG_FLAGS,
  DEFAULT_PARTICLE_PROFILE,
  DYNAMIC_PHYSICS,
  EXPLOSION,
  HISTORY,
  MAP_VERSION,
  normalizeParticleProfile,
  PARTICLE,
  PARTICLE_PROFILES,
  PARTICLE_PROFILE_M02,
  PLAYER,
  PROJECTILE,
  ROCK,
  ROCK_ARCHETYPES,
  SCHEMA_VERSION,
  SCENARIO_VERSION,
  SIMULATION,
} from "../config.js";
import { RingBuffer } from "../core/ring_buffer.js";
import { normalizeSeed, SeededRng } from "../core/rng.js";
import {
  circleCircleContact,
  firstSolidContact,
  gridRayBlocked,
  sanitizePointAgainstGrid,
  sweepPointAgainstGrid,
} from "./collision.js";
import { resolvePlayerDynamicBodyVelocity } from "./dynamic_body_velocity.js";
import { computeExplosionResponse } from "./explosion.js";
import { GridMap } from "./grid_map.js";
import { ParticlePool, ProjectilePool, RockPool } from "./pools.js";
import {
  ArenaScenario,
  createDebugArenaScenario,
  getRockArchetype,
} from "./scenario.js";

const TAU = Math.PI * 2;
const CONTACT_CAPACITY = 256;
const BODY_PLAYER = 1;
const BODY_ROCK = 2;
const BODY_CELL = 3;
const CONTACT_GRID = 1;
const CONTACT_BODY = 2;

const ROCK_NAME_BY_CODE = new Map(
  Object.entries(ROCK_ARCHETYPES).map(([name, definition]) => [definition.code, name]),
);

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
    case "loadScenario":
      return {
        type: "loadScenario",
        json: typeof action.json === "string" ? action.json : JSON.stringify(action.json),
      };
    case "placeRock":
      return {
        type: "placeRock",
        archetype: String(action.archetype),
        x: Number(action.x),
        z: Number(action.z),
      };
    case "removeEntity":
      return {
        type: "removeEntity",
        kind: String(action.kind),
        id: Number(action.id),
      };
    case "restoreScenario":
      return { type: "restoreScenario" };
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

/** @param {ReturnType<ArenaScenario['toJSON']>} scenario */
function cloneScenarioJson(scenario) {
  return {
    version: scenario.version,
    width: scenario.width,
    height: scenario.height,
    cells: [...scenario.cells],
    playerSpawn: { ...scenario.playerSpawn },
    entities: scenario.entities.map((entity) => ({ ...entity })),
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

/** @param {Record<string, any>} event */
function cloneEvent(event) {
  return {
    ...event,
    owner: event.owner ? { ...event.owner } : null,
    hit: event.hit ? { ...event.hit } : null,
    cell: event.cell ? { ...event.cell } : null,
    responses: Array.isArray(event.responses)
      ? event.responses.map((response) => ({
        ...response,
        position: response.position ? { ...response.position } : null,
        deltaVelocity: response.deltaVelocity ? { ...response.deltaVelocity } : null,
      }))
      : [],
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

/** @param {number} value @param {number} maximum */
function clampMagnitude(value, maximum) {
  return Math.max(-maximum, Math.min(maximum, value));
}

/** @param {number} value @param {number} minimum @param {number} maximum */
function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

/**
 * @param {Record<string, number | boolean>} tuning
 * @param {number} maximumSize
 * @param {number} age
 * @param {number} lifetime
 */
function currentParticleSize(tuning, maximumSize, age, lifetime) {
  if (tuning.shrinkExponent === 0) return maximumSize;
  const remainingLife = 1 - clamp(age / lifetime, 0, 1);
  return maximumSize * remainingLife ** Number(tuning.shrinkExponent);
}

/** @param {number} code */
function bodyKindName(code) {
  if (code === BODY_PLAYER) return "player";
  if (code === BODY_ROCK) return "rock";
  return "cell";
}

export class Simulation {
  /**
   * @param {{
   * seed?:unknown,
   * scenario?:ArenaScenario,
   * map?:GridMap,
   * rockCapacity?:number,
   * projectileCapacity?:number,
   * particleCapacity?:number,
   * particleBurstCount?:number,
   * particleProfile?:string,
   * particleBounce?:boolean,
   * particleWallCollision?:boolean
   * }} [options]
   */
  constructor(options = {}) {
    this.scenario = options.scenario?.clone()
      ?? (options.map ? new ArenaScenario(options.map) : createDebugArenaScenario());
    this.map = this.scenario.map;
    this.seed = normalizeSeed(options.seed ?? 0x1a2b3c4d);
    this.rng = new SeededRng(this.seed);
    const rockCapacity = options.rockCapacity ?? ROCK.capacity;
    if (!Number.isInteger(rockCapacity) || rockCapacity <= 0) {
      throw new RangeError("Rock capacity must be a positive integer");
    }
    if (this.scenario.entities.length > rockCapacity) {
      throw new RangeError("Scenario has more rocks than the configured rock pool");
    }
    this.rocks = new RockPool(rockCapacity);
    this.projectiles = new ProjectilePool(options.projectileCapacity ?? PROJECTILE.capacity);
    this.particles = new ParticlePool(options.particleCapacity ?? PARTICLE.capacity);
    this.particleBurstCount = options.particleBurstCount ?? PARTICLE.burstCount;
    this.particleProfile = normalizeParticleProfile(
      options.particleProfile ?? DEFAULT_PARTICLE_PROFILE,
    );
    if (!Object.hasOwn(PARTICLE_PROFILES, this.particleProfile)) {
      throw new RangeError(`Unsupported particle profile: ${this.particleProfile}`);
    }
    this.particleTuning = PARTICLE_PROFILES[this.particleProfile];
    this.impactEvents = new RingBuffer(HISTORY.events);
    this.commandLog = new RingBuffer(HISTORY.commands);
    this.commandLogDropped = 0;
    this.commandLogScenario = this.scenario.toJSON();
    this.commandLogMap = this.map.toJSON();
    this.debugFlags = {
      ...DEFAULT_DEBUG_FLAGS,
      particleBounce:
        options.particleBounce ?? this.particleTuning.defaultGroundBounce,
      particleWallCollision:
        options.particleWallCollision ?? DEFAULT_DEBUG_FLAGS.particleWallCollision,
    };
    this.commandLogParticleProfile = this.particleProfile;
    this.commandLogParticleBounce = this.debugFlags.particleBounce;
    this.commandLogParticleWallCollision = this.debugFlags.particleWallCollision;
    this.tickCount = 0;
    this.nextExplosionId = 1;
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
      locomotionVx: 0,
      locomotionVz: 0,
      externalVx: 0,
      externalVz: 0,
      radius: PLAYER.radius,
      massKg: PLAYER.massKg,
      inverseMass: 1 / PLAYER.massKg,
      cooldown: 0,
    };
    this.contacts = {
      count: 0,
      dropped: 0,
      type: new Uint8Array(CONTACT_CAPACITY),
      aKind: new Uint8Array(CONTACT_CAPACITY),
      bKind: new Uint8Array(CONTACT_CAPACITY),
      aId: new Uint32Array(CONTACT_CAPACITY),
      bId: new Uint32Array(CONTACT_CAPACITY),
      x: new Float32Array(CONTACT_CAPACITY),
      z: new Float32Array(CONTACT_CAPACITY),
      nx: new Float32Array(CONTACT_CAPACITY),
      nz: new Float32Array(CONTACT_CAPACITY),
      penetration: new Float32Array(CONTACT_CAPACITY),
      cx: new Int16Array(CONTACT_CAPACITY),
      cz: new Int16Array(CONTACT_CAPACITY),
    };
    this._gridContact = {
      nx: 0,
      nz: 0,
      penetration: 0,
      px: 0,
      pz: 0,
      cx: 0,
      cz: 0,
    };
    this._bodyContact = { nx: 0, nz: 0, penetration: 0, x: 0, z: 0 };
    this._dynamicBodyVelocity = { vx: 0, vz: 0, inverseMass: 0 };
    this._particleSweepHit = { x: 0, z: 0, time: 0, nx: 0, nz: 0, cx: 0, cz: 0 };
    this._particleSpawnPoint = { x: 0, z: 0, cx: 0, cz: 0, passes: 0 };
    this.lastError = null;
    this.reset(this.seed);
  }

  /** @param {unknown} seed @param {{clearLog?:boolean}} [options] */
  reset(seed = this.seed, options = {}) {
    this.seed = normalizeSeed(seed);
    this.rng.reset(this.seed);
    this.tickCount = 0;
    this.nextExplosionId = 1;
    this.#restoreAuthoredState();
    this.impactEvents.clear();
    this.contacts.count = 0;
    this.contacts.dropped = 0;
    if (options.clearLog !== false) {
      this.commandLog.clear();
      this.commandLogDropped = 0;
      this.commandLogScenario = this.scenario.toJSON();
      this.commandLogMap = this.map.toJSON();
      this.commandLogParticleProfile = this.particleProfile;
      this.commandLogParticleBounce = this.debugFlags.particleBounce;
      this.commandLogParticleWallCollision = this.debugFlags.particleWallCollision;
    }
    this.lastError = null;
  }

  #restoreAuthoredState() {
    this.projectiles.reset();
    this.particles.reset();
    this.rocks.reset();
    Object.assign(this.player, {
      x: this.map.playerSpawn.x,
      z: this.map.playerSpawn.z,
      previousX: this.map.playerSpawn.x,
      previousZ: this.map.playerSpawn.z,
      vx: 0,
      vz: 0,
      desiredVx: 0,
      desiredVz: 0,
      locomotionVx: 0,
      locomotionVz: 0,
      externalVx: 0,
      externalVz: 0,
      cooldown: 0,
    });
    for (const entity of this.scenario.entities) {
      const definition = getRockArchetype(entity.archetype);
      if (!definition) continue;
      this.rocks.spawn({
        spawnId: entity.spawnId,
        archetype: definition.code,
        x: entity.x,
        z: entity.z,
        radius: definition.radius,
        massKg: definition.massKg,
      });
    }
  }

  /** @param {unknown} input */
  tick(input) {
    const command = canonicalizeCommand(input);
    this.contacts.count = 0;
    this.#applyActions(command.actions);
    this.#prepareMovement(command.move, SIMULATION.dt);
    this.#bodyPhysicsSystem(SIMULATION.dt);
    this.player.cooldown = approach(this.player.cooldown, 0, SIMULATION.dt);
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
        } else if (action.type === "restoreScenario") {
          this.#restoreAuthoredState();
          this.impactEvents.clear();
        } else if (action.type === "setTile") {
          if (!this.#setTile(action.cx, action.cz, action.tile)) {
            throw new RangeError("Tile would overlap an authored or active body");
          }
        } else if (action.type === "loadScenario") {
          const loadedScenario = ArenaScenario.fromJSON(action.json);
          if (loadedScenario.entities.length > this.rocks.capacity) {
            throw new RangeError("Scenario has more rocks than the configured rock pool");
          }
          this.scenario = loadedScenario;
          this.map = loadedScenario.map;
          this.#restoreAuthoredState();
          this.impactEvents.clear();
        } else if (action.type === "placeRock") {
          if (!this.canPlaceRock(action.archetype, action.x, action.z)) {
            throw new RangeError("Rock placement is invalid or overlaps another body");
          }
          const spawnId = this.scenario.placeRock(action.archetype, action.x, action.z);
          if (spawnId === 0) throw new RangeError("Rock placement could not be authored");
          const definition = getRockArchetype(action.archetype);
          const id = definition
            ? this.rocks.spawn({
              spawnId,
              archetype: definition.code,
              x: action.x,
              z: action.z,
              radius: definition.radius,
              massKg: definition.massKg,
            })
            : 0;
          if (id === 0) {
            this.scenario.removeRock(spawnId);
            throw new RangeError("Rock pool capacity reached");
          }
        } else if (action.type === "removeEntity") {
          if (action.kind !== "rock") throw new RangeError("Only authored rocks can be removed");
          const index = this.rocks.findIndexById(action.id);
          if (index < 0) throw new RangeError("Rock no longer exists");
          const spawnId = this.rocks.spawnId[index];
          if (!this.scenario.removeRock(spawnId)) throw new RangeError("Rock is not authored");
          this.rocks.removeSwap(index);
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

  /** @param {number} cx @param {number} cz @param {number} tile */
  #setTile(cx, cz, tile) {
    if (!this.map.inBounds(cx, cz)) return false;
    const previous = this.map.get(cx, cz);
    if (!this.scenario.setTile(cx, cz, tile)) return false;
    if (tile !== 1) return true;
    if (
      firstSolidContact(
        this.map,
        this.player.x,
        this.player.z,
        this.player.radius,
        this._gridContact,
      )
    ) {
      this.map.set(cx, cz, previous);
      return false;
    }
    for (let index = 0; index < this.rocks.activeCount; index += 1) {
      if (
        firstSolidContact(
          this.map,
          this.rocks.x[index],
          this.rocks.z[index],
          this.rocks.radius[index],
          this._gridContact,
        )
      ) {
        this.map.set(cx, cz, previous);
        return false;
      }
    }
    return true;
  }

  /** @param {{x:number,z:number}|null} target @param {number} dt */
  #prepareMovement(target, dt) {
    const player = this.player;
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

    const deltaVx = desiredVx - player.locomotionVx;
    const deltaVz = desiredVz - player.locomotionVz;
    const deltaLength = Math.hypot(deltaVx, deltaVz);
    const rate = target ? PLAYER.acceleration : PLAYER.braking;
    const maximumDelta = rate * dt;
    if (deltaLength <= maximumDelta || deltaLength <= 1e-9) {
      player.locomotionVx = desiredVx;
      player.locomotionVz = desiredVz;
    } else {
      player.locomotionVx += (deltaVx / deltaLength) * maximumDelta;
      player.locomotionVz += (deltaVz / deltaLength) * maximumDelta;
    }
  }

  /** @param {number} dt */
  #bodyPhysicsSystem(dt) {
    const player = this.player;
    player.previousX = player.x;
    player.previousZ = player.z;
    for (let index = 0; index < this.rocks.activeCount; index += 1) {
      this.rocks.previousX[index] = this.rocks.x[index];
      this.rocks.previousZ[index] = this.rocks.z[index];
    }

    const playerDamping = Math.exp(-PLAYER.externalDamping * dt);
    player.externalVx *= playerDamping;
    player.externalVz *= playerDamping;
    const rockDamping = Math.exp(-ROCK.damping * dt);
    let maximumSpeed = Math.hypot(
      player.locomotionVx + player.externalVx,
      player.locomotionVz + player.externalVz,
    );
    let minimumRadius = player.radius;
    for (let index = 0; index < this.rocks.activeCount; index += 1) {
      this.rocks.vx[index] *= rockDamping;
      this.rocks.vz[index] *= rockDamping;
      const speed = Math.hypot(this.rocks.vx[index], this.rocks.vz[index]);
      if (speed > ROCK.maxSpeed) {
        const scale = ROCK.maxSpeed / speed;
        this.rocks.vx[index] *= scale;
        this.rocks.vz[index] *= scale;
        this.rocks.speedClamped += 1;
        maximumSpeed = Math.max(maximumSpeed, ROCK.maxSpeed);
      } else {
        maximumSpeed = Math.max(maximumSpeed, speed);
      }
      minimumRadius = Math.min(minimumRadius, this.rocks.radius[index]);
    }

    const maximumTravel = Math.max(0.001, minimumRadius * DYNAMIC_PHYSICS.travelRadiusFraction);
    const substeps = Math.min(
      DYNAMIC_PHYSICS.maximumSubsteps,
      Math.max(1, Math.ceil((maximumSpeed * dt) / maximumTravel)),
    );
    const stepDt = dt / substeps;
    for (let substep = 0; substep < substeps; substep += 1) {
      this.#syncPlayerVelocity();
      player.x += player.vx * stepDt;
      player.z += player.vz * stepDt;
      for (let index = 0; index < this.rocks.activeCount; index += 1) {
        this.rocks.x[index] += this.rocks.vx[index] * stepDt;
        this.rocks.z[index] += this.rocks.vz[index] * stepDt;
      }

      this.#resolvePlayerGrid(substep === 0);
      for (let index = 0; index < this.rocks.activeCount; index += 1) {
        this.#resolveRockGrid(index, substep === 0);
      }
      for (let pass = 0; pass < DYNAMIC_PHYSICS.solverIterations; pass += 1) {
        const record = substep === 0 && pass === 0;
        for (let index = 0; index < this.rocks.activeCount; index += 1) {
          this.#resolvePlayerRock(index, record);
        }
        for (let left = 0; left < this.rocks.activeCount; left += 1) {
          for (let right = left + 1; right < this.rocks.activeCount; right += 1) {
            this.#resolveRockRock(left, right, record);
          }
        }
        this.#resolvePlayerGrid(false);
        for (let index = 0; index < this.rocks.activeCount; index += 1) {
          this.#resolveRockGrid(index, false);
        }
      }
    }

    for (let index = 0; index < this.rocks.activeCount; index += 1) {
      if (Math.hypot(this.rocks.vx[index], this.rocks.vz[index]) < ROCK.settleSpeed) {
        this.rocks.vx[index] = 0;
        this.rocks.vz[index] = 0;
      }
    }
    this.#syncPlayerVelocity();
  }

  #syncPlayerVelocity() {
    this.player.vx = this.player.locomotionVx + this.player.externalVx;
    this.player.vz = this.player.locomotionVz + this.player.externalVz;
  }

  /** @param {boolean} record */
  #resolvePlayerGrid(record) {
    const player = this.player;
    for (let pass = 0; pass < 8; pass += 1) {
      if (
        !firstSolidContact(
          this.map,
          player.x,
          player.z,
          player.radius,
          this._gridContact,
        )
      ) {
        break;
      }
      const contact = this._gridContact;
      const correction = contact.penetration + 1e-6;
      player.x += contact.nx * correction;
      player.z += contact.nz * correction;
      this.#removeInwardPlayerVelocity(contact.nx, contact.nz);
      if (record) this.#recordGridContact(BODY_PLAYER, player.id, contact);
    }
  }

  /** @param {number} nx @param {number} nz */
  #removeInwardPlayerVelocity(nx, nz) {
    const locomotionInward = this.player.locomotionVx * nx + this.player.locomotionVz * nz;
    if (locomotionInward < 0) {
      this.player.locomotionVx -= nx * locomotionInward;
      this.player.locomotionVz -= nz * locomotionInward;
    }
    const externalInward = this.player.externalVx * nx + this.player.externalVz * nz;
    if (externalInward < 0) {
      this.player.externalVx -= nx * externalInward;
      this.player.externalVz -= nz * externalInward;
    }
    this.#syncPlayerVelocity();
  }

  /** @param {number} index @param {boolean} record */
  #resolveRockGrid(index, record) {
    const pool = this.rocks;
    for (let pass = 0; pass < 8; pass += 1) {
      if (
        !firstSolidContact(
          this.map,
          pool.x[index],
          pool.z[index],
          pool.radius[index],
          this._gridContact,
        )
      ) {
        break;
      }
      const contact = this._gridContact;
      const correction = contact.penetration + 1e-6;
      pool.x[index] += contact.nx * correction;
      pool.z[index] += contact.nz * correction;
      const normalSpeed = pool.vx[index] * contact.nx + pool.vz[index] * contact.nz;
      if (normalSpeed < 0) {
        const tangentX = pool.vx[index] - normalSpeed * contact.nx;
        const tangentZ = pool.vz[index] - normalSpeed * contact.nz;
        pool.vx[index] =
          tangentX * (1 - ROCK.wallFriction) - normalSpeed * ROCK.wallRestitution * contact.nx;
        pool.vz[index] =
          tangentZ * (1 - ROCK.wallFriction) - normalSpeed * ROCK.wallRestitution * contact.nz;
      }
      if (record) this.#recordGridContact(BODY_ROCK, pool.id[index], contact);
    }
  }

  /** @param {number} index @param {boolean} record */
  #resolvePlayerRock(index, record) {
    const player = this.player;
    const pool = this.rocks;
    if (
      !circleCircleContact(
        player.x,
        player.z,
        player.radius,
        pool.x[index],
        pool.z[index],
        pool.radius[index],
        this._bodyContact,
      )
    ) {
      return;
    }
    const contact = this._bodyContact;
    const inverseMassSum = player.inverseMass + pool.inverseMass[index];
    const correction =
      (Math.max(contact.penetration - DYNAMIC_PHYSICS.penetrationSlop, 0)
        * DYNAMIC_PHYSICS.positionCorrection) / inverseMassSum;
    player.x -= contact.nx * correction * player.inverseMass;
    player.z -= contact.nz * correction * player.inverseMass;
    pool.x[index] += contact.nx * correction * pool.inverseMass[index];
    pool.z[index] += contact.nz * correction * pool.inverseMass[index];

    const bodyVelocity = this._dynamicBodyVelocity;
    bodyVelocity.vx = pool.vx[index];
    bodyVelocity.vz = pool.vz[index];
    bodyVelocity.inverseMass = pool.inverseMass[index];
    resolvePlayerDynamicBodyVelocity(
      player,
      bodyVelocity,
      contact.nx,
      contact.nz,
      DYNAMIC_PHYSICS.bodyRestitution,
      DYNAMIC_PHYSICS.bodyFriction,
    );
    pool.vx[index] = bodyVelocity.vx;
    pool.vz[index] = bodyVelocity.vz;
    if (record) {
      this.#recordBodyContact(
        BODY_PLAYER,
        player.id,
        BODY_ROCK,
        pool.id[index],
        contact,
      );
    }
  }

  /** @param {number} left @param {number} right @param {boolean} record */
  #resolveRockRock(left, right, record) {
    const pool = this.rocks;
    if (
      !circleCircleContact(
        pool.x[left],
        pool.z[left],
        pool.radius[left],
        pool.x[right],
        pool.z[right],
        pool.radius[right],
        this._bodyContact,
      )
    ) {
      return;
    }
    const contact = this._bodyContact;
    const inverseMassSum = pool.inverseMass[left] + pool.inverseMass[right];
    const correction =
      (Math.max(contact.penetration - DYNAMIC_PHYSICS.penetrationSlop, 0)
        * DYNAMIC_PHYSICS.positionCorrection) / inverseMassSum;
    pool.x[left] -= contact.nx * correction * pool.inverseMass[left];
    pool.z[left] -= contact.nz * correction * pool.inverseMass[left];
    pool.x[right] += contact.nx * correction * pool.inverseMass[right];
    pool.z[right] += contact.nz * correction * pool.inverseMass[right];

    let relativeVx = pool.vx[right] - pool.vx[left];
    let relativeVz = pool.vz[right] - pool.vz[left];
    const normalSpeed = relativeVx * contact.nx + relativeVz * contact.nz;
    if (normalSpeed < 0) {
      const impulse =
        (-(1 + DYNAMIC_PHYSICS.bodyRestitution) * normalSpeed) / inverseMassSum;
      const impulseX = impulse * contact.nx;
      const impulseZ = impulse * contact.nz;
      pool.vx[left] -= impulseX * pool.inverseMass[left];
      pool.vz[left] -= impulseZ * pool.inverseMass[left];
      pool.vx[right] += impulseX * pool.inverseMass[right];
      pool.vz[right] += impulseZ * pool.inverseMass[right];

      relativeVx = pool.vx[right] - pool.vx[left];
      relativeVz = pool.vz[right] - pool.vz[left];
      const tangentSpeed = relativeVx * -contact.nz + relativeVz * contact.nx;
      const tangentImpulse = clampMagnitude(
        -tangentSpeed / inverseMassSum,
        impulse * DYNAMIC_PHYSICS.bodyFriction,
      );
      const frictionX = -contact.nz * tangentImpulse;
      const frictionZ = contact.nx * tangentImpulse;
      pool.vx[left] -= frictionX * pool.inverseMass[left];
      pool.vz[left] -= frictionZ * pool.inverseMass[left];
      pool.vx[right] += frictionX * pool.inverseMass[right];
      pool.vz[right] += frictionZ * pool.inverseMass[right];
    }
    if (record) {
      this.#recordBodyContact(
        BODY_ROCK,
        pool.id[left],
        BODY_ROCK,
        pool.id[right],
        contact,
      );
    }
  }

  /**
   * @param {number} kind
   * @param {number} id
   * @param {{nx:number,nz:number,penetration:number,px:number,pz:number,cx:number,cz:number}} contact
   */
  #recordGridContact(kind, id, contact) {
    const index = this.contacts.count;
    if (index >= CONTACT_CAPACITY) {
      this.contacts.dropped += 1;
      return;
    }
    this.contacts.type[index] = CONTACT_GRID;
    this.contacts.aKind[index] = kind;
    this.contacts.bKind[index] = BODY_CELL;
    this.contacts.aId[index] = id;
    this.contacts.bId[index] = 0;
    this.contacts.x[index] = contact.px;
    this.contacts.z[index] = contact.pz;
    this.contacts.nx[index] = contact.nx;
    this.contacts.nz[index] = contact.nz;
    this.contacts.penetration[index] = contact.penetration;
    this.contacts.cx[index] = contact.cx;
    this.contacts.cz[index] = contact.cz;
    this.contacts.count += 1;
  }

  /**
   * @param {number} aKind
   * @param {number} aId
   * @param {number} bKind
   * @param {number} bId
   * @param {{nx:number,nz:number,penetration:number,x:number,z:number}} contact
   */
  #recordBodyContact(aKind, aId, bKind, bId, contact) {
    const index = this.contacts.count;
    if (index >= CONTACT_CAPACITY) {
      this.contacts.dropped += 1;
      return;
    }
    this.contacts.type[index] = CONTACT_BODY;
    this.contacts.aKind[index] = aKind;
    this.contacts.bKind[index] = bKind;
    this.contacts.aId[index] = aId;
    this.contacts.bId[index] = bId;
    this.contacts.x[index] = contact.x;
    this.contacts.z[index] = contact.z;
    this.contacts.nx[index] = contact.nx;
    this.contacts.nz[index] = contact.nz;
    this.contacts.penetration[index] = contact.penetration;
    this.contacts.cx[index] = 0;
    this.contacts.cz[index] = 0;
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
      ownerId: player.id,
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
      let hitKind = "";
      let hitRockIndex = -1;
      let hitX = startX;
      let hitZ = startZ;
      for (let step = 0; step <= steps; step += 1) {
        const alpha = step / steps;
        const testX = startX + deltaX * alpha;
        const testZ = startZ + deltaZ * alpha;
        if (firstSolidContact(this.map, testX, testZ, pool.radius[index], this._gridContact)) {
          hitKind = "cell";
          hitX = testX;
          hitZ = testZ;
          break;
        }
        for (let rockIndex = 0; rockIndex < this.rocks.activeCount; rockIndex += 1) {
          const combinedRadius = pool.radius[index] + this.rocks.radius[rockIndex];
          if (
            Math.hypot(
              testX - this.rocks.x[rockIndex],
              testZ - this.rocks.z[rockIndex],
            ) <= combinedRadius
          ) {
            hitKind = "rock";
            hitRockIndex = rockIndex;
            hitX = testX;
            hitZ = testZ;
            break;
          }
        }
        if (hitKind) break;
      }

      if (hitKind) {
        const event = this.#createExplosionEvent(index, hitKind, hitRockIndex, hitX, hitZ);
        this.#applyExplosion(event);
        this.impactEvents.push(event);
        this.#emitParticles(event.originX, event.originZ, event.nx, event.nz);
        pool.removeSwap(index);
        continue;
      }

      pool.x[index] = startX + deltaX;
      pool.z[index] = startZ + deltaZ;
      index += 1;
    }
  }

  /**
   * @param {number} projectileIndex
   * @param {string} hitKind
   * @param {number} rockIndex
   * @param {number} hitX
   * @param {number} hitZ
   */
  #createExplosionEvent(projectileIndex, hitKind, rockIndex, hitX, hitZ) {
    const pool = this.projectiles;
    let nx = this._gridContact.nx;
    let nz = this._gridContact.nz;
    let contactX = this._gridContact.px;
    let contactZ = this._gridContact.pz;
    let hit;
    let cell = null;
    if (hitKind === "rock") {
      const dx = hitX - this.rocks.x[rockIndex];
      const dz = hitZ - this.rocks.z[rockIndex];
      const distance = Math.hypot(dx, dz);
      if (distance > 1e-9) {
        nx = dx / distance;
        nz = dz / distance;
      } else {
        const velocityLength = Math.hypot(pool.vx[projectileIndex], pool.vz[projectileIndex]);
        nx = velocityLength > 0 ? -pool.vx[projectileIndex] / velocityLength : 1;
        nz = velocityLength > 0 ? -pool.vz[projectileIndex] / velocityLength : 0;
      }
      contactX = this.rocks.x[rockIndex] + nx * this.rocks.radius[rockIndex];
      contactZ = this.rocks.z[rockIndex] + nz * this.rocks.radius[rockIndex];
      hit = { kind: "rock", id: this.rocks.id[rockIndex] };
    } else {
      cell = { cx: this._gridContact.cx, cz: this._gridContact.cz };
      hit = { kind: "cell", cx: cell.cx, cz: cell.cz };
    }
    const originX = contactX + nx * EXPLOSION.originEpsilon;
    const originZ = contactZ + nz * EXPLOSION.originEpsilon;
    const event = {
      type: "explosion",
      id: this.nextExplosionId,
      tick: this.tickCount + 1,
      projectileId: pool.id[projectileIndex],
      owner: { kind: "player", id: pool.ownerId[projectileIndex] },
      hit,
      x: originX,
      y: PARTICLE.initialY,
      z: originZ,
      originX,
      originZ,
      nx,
      nz,
      radius: EXPLOSION.radius,
      pressureImpulse: EXPLOSION.pressureImpulse,
      cell,
      responses: [],
    };
    this.nextExplosionId += 1;
    return event;
  }

  /** @param {Record<string, any>} event */
  #applyExplosion(event) {
    this.#applyExplosionToPlayer(event);
    for (let index = 0; index < this.rocks.activeCount; index += 1) {
      this.#applyExplosionToRock(event, index);
    }
    this.#syncPlayerVelocity();
  }

  /** @param {Record<string, any>} event */
  #applyExplosionToPlayer(event) {
    const response = computeExplosionResponse({
      originX: event.originX,
      originZ: event.originZ,
      bodyX: this.player.x,
      bodyZ: this.player.z,
      bodyRadius: this.player.radius,
      massKg: this.player.massKg,
      blastRadius: event.radius,
      pressureImpulse: event.pressureImpulse,
      fallbackNx: -event.nx,
      fallbackNz: -event.nz,
    });
    if (!response) return;
    const blocked = gridRayBlocked(
      this.map,
      event.originX,
      event.originZ,
      this.player.x,
      this.player.z,
    );
    if (!blocked) {
      this.player.externalVx += response.deltaVx;
      this.player.externalVz += response.deltaVz;
    }
    event.responses.push(
      this.#describeExplosionResponse(
        "player",
        this.player.id,
        this.player.x,
        this.player.z,
        blocked,
        response,
      ),
    );
  }

  /** @param {Record<string, any>} event @param {number} index */
  #applyExplosionToRock(event, index) {
    const response = computeExplosionResponse({
      originX: event.originX,
      originZ: event.originZ,
      bodyX: this.rocks.x[index],
      bodyZ: this.rocks.z[index],
      bodyRadius: this.rocks.radius[index],
      massKg: this.rocks.massKg[index],
      blastRadius: event.radius,
      pressureImpulse: event.pressureImpulse,
      fallbackNx: -event.nx,
      fallbackNz: -event.nz,
    });
    if (!response) return;
    const blocked = gridRayBlocked(
      this.map,
      event.originX,
      event.originZ,
      this.rocks.x[index],
      this.rocks.z[index],
    );
    if (!blocked) {
      this.rocks.vx[index] += response.deltaVx;
      this.rocks.vz[index] += response.deltaVz;
      const speed = Math.hypot(this.rocks.vx[index], this.rocks.vz[index]);
      if (speed > ROCK.maxSpeed) {
        const scale = ROCK.maxSpeed / speed;
        this.rocks.vx[index] *= scale;
        this.rocks.vz[index] *= scale;
        this.rocks.speedClamped += 1;
      }
    }
    event.responses.push(
      this.#describeExplosionResponse(
        "rock",
        this.rocks.id[index],
        this.rocks.x[index],
        this.rocks.z[index],
        blocked,
        response,
      ),
    );
  }

  /**
   * @param {string} kind
   * @param {number} id
   * @param {number} x
   * @param {number} z
   * @param {boolean} blocked
   * @param {ReturnType<typeof computeExplosionResponse>} response
   */
  #describeExplosionResponse(kind, id, x, z, blocked, response) {
    if (!response) return null;
    return {
      kind,
      id,
      position: { x, z },
      blocked,
      centerDistance: response.centerDistance,
      surfaceDistance: response.surfaceDistance,
      falloff: response.falloff,
      projectedArea: response.projectedArea,
      potentialImpulse: response.impulse,
      impulse: blocked ? 0 : response.impulse,
      deltaVelocity: {
        x: blocked ? 0 : response.deltaVx,
        y: 0,
        z: blocked ? 0 : response.deltaVz,
      },
    };
  }

  /** @param {number} x @param {number} z @param {number} normalX @param {number} normalZ */
  #emitParticles(x, z, normalX, normalZ) {
    const normalLength = Math.hypot(normalX, normalZ);
    const outwardX = normalLength > 1e-9 ? normalX / normalLength : 1;
    const outwardZ = normalLength > 1e-9 ? normalZ / normalLength : 0;
    for (let count = 0; count < this.particleBurstCount; count += 1) {
      const angle = this.rng.range(0, TAU);
      const horizontalSpeed = this.rng.range(1.4, 5.8);
      const outwardBias = this.rng.range(0.2, 1.1);
      let vx = Math.cos(angle) * horizontalSpeed + outwardX * outwardBias;
      let vz = Math.sin(angle) * horizontalSpeed + outwardZ * outwardBias;
      const horizontalLength = Math.hypot(vx, vz);
      if (horizontalLength > PARTICLE.maximumHorizontalSpeed) {
        vx = (vx / horizontalLength) * PARTICLE.maximumHorizontalSpeed;
        vz = (vz / horizontalLength) * PARTICLE.maximumHorizontalSpeed;
      }
      const inwardSpeed = vx * outwardX + vz * outwardZ;
      if (inwardSpeed < 0) {
        vx -= 2 * inwardSpeed * outwardX;
        vz -= 2 * inwardSpeed * outwardZ;
      }
      const verticalRoll = this.rng.nextFloat();
      const lifetimeRoll = this.rng.nextFloat();
      const sizeRoll = this.rng.nextFloat();
      const size =
        PARTICLE.minimumSize
        + (PARTICLE.maximumSize - PARTICLE.minimumSize) * sizeRoll;
      const normalizedSize =
        (size - PARTICLE.minimumSize)
        / (PARTICLE.maximumSize - PARTICLE.minimumSize);
      const vy =
        Number(this.particleTuning.verticalMinimum)
        + Number(this.particleTuning.verticalRange)
          * verticalRoll ** Number(this.particleTuning.verticalPower);
      const lifetime = clamp(
        Number(this.particleTuning.lifetimeBase)
          + Number(this.particleTuning.lifetimeSizeScale) * normalizedSize
          + (lifetimeRoll - 0.5) * Number(this.particleTuning.lifetimeJitter),
        Number(this.particleTuning.lifetimeMinimum),
        Number(this.particleTuning.lifetimeMaximum),
      );
      if (
        !sanitizePointAgainstGrid(
          this.map,
          x,
          z,
          outwardX,
          outwardZ,
          this._particleSpawnPoint,
          PARTICLE.spawnCorrectionPasses,
        )
      ) {
        this.particles.collisionDiscards += 1;
        continue;
      }
      this.particles.spawn({
        x: this._particleSpawnPoint.x,
        y: PARTICLE.initialY,
        z: this._particleSpawnPoint.z,
        vx,
        vy,
        vz,
        lifetime,
        size,
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
      if (this.debugFlags.particleWallCollision) {
        if (this.map.get(Math.floor(pool.x[index]), Math.floor(pool.z[index])) === 1) {
          if (
            !sanitizePointAgainstGrid(
              this.map,
              pool.x[index],
              pool.z[index],
              -pool.vx[index],
              -pool.vz[index],
              this._particleSpawnPoint,
              PARTICLE.spawnCorrectionPasses,
            )
          ) {
            pool.collisionDiscards += 1;
            pool.removeSwap(index);
            continue;
          }
          pool.x[index] = this._particleSpawnPoint.x;
          pool.z[index] = this._particleSpawnPoint.z;
        }
        this.#advanceParticleAgainstWalls(index, dt);
      } else {
        pool.x[index] += pool.vx[index] * dt;
        pool.z[index] += pool.vz[index] * dt;
      }
      pool.y[index] += pool.vy[index] * dt;
      if (pool.y[index] <= 0) {
        if (this.debugFlags.particleBounce && pool.bounced[index] === 0) {
          pool.y[index] = 0;
          pool.vy[index] =
            Math.abs(pool.vy[index]) * Number(this.particleTuning.groundVerticalRetention);
          pool.vx[index] *= Number(this.particleTuning.groundHorizontalRetention);
          pool.vz[index] *= Number(this.particleTuning.groundHorizontalRetention);
          pool.bounced[index] = 1;
          pool.groundBounces += 1;
        } else if (
          this.debugFlags.particleBounce
          && this.particleTuning.groundSettlesAfterBounce
        ) {
          pool.y[index] = 0;
          pool.vy[index] = 0;
          pool.vx[index] *= Number(this.particleTuning.groundHorizontalRetention);
          pool.vz[index] *= Number(this.particleTuning.groundHorizontalRetention);
        } else {
          pool.removeSwap(index);
          continue;
        }
      }
      index += 1;
    }
  }

  /** @param {number} index @param {number} dt */
  #advanceParticleAgainstWalls(index, dt) {
    const pool = this.particles;
    let remaining = dt;
    for (
      let contact = 0;
      contact < PARTICLE.maximumWallContactsPerTick && remaining > 1e-9;
      contact += 1
    ) {
      const startX = pool.x[index];
      const startZ = pool.z[index];
      const endX = Math.fround(startX + pool.vx[index] * remaining);
      const endZ = Math.fround(startZ + pool.vz[index] * remaining);
      if (
        !sweepPointAgainstGrid(
          this.map,
          startX,
          startZ,
          endX,
          endZ,
          this._particleSweepHit,
        )
      ) {
        pool.x[index] = endX;
        pool.z[index] = endZ;
        return;
      }

      const hit = this._particleSweepHit;
      pool.x[index] = hit.x + hit.nx * PARTICLE.wallSeparationEpsilon;
      pool.z[index] = hit.z + hit.nz * PARTICLE.wallSeparationEpsilon;
      const normalSpeed = pool.vx[index] * hit.nx + pool.vz[index] * hit.nz;
      if (normalSpeed < 0) {
        const tangentX = pool.vx[index] - normalSpeed * hit.nx;
        const tangentZ = pool.vz[index] - normalSpeed * hit.nz;
        pool.vx[index] =
          tangentX * PARTICLE.wallTangentialRetention
          - normalSpeed * PARTICLE.wallNormalRetention * hit.nx;
        pool.vz[index] =
          tangentZ * PARTICLE.wallTangentialRetention
          - normalSpeed * PARTICLE.wallNormalRetention * hit.nz;
        pool.wallBounceCount[index] += 1;
        pool.wallBounces += 1;
      }
      remaining *= 1 - hit.time;
    }
  }

  /** @param {number} index */
  #currentParticleSize(index) {
    return currentParticleSize(
      this.particleTuning,
      this.particles.size[index],
      this.particles.age[index],
      this.particles.lifetime[index],
    );
  }

  snapshot() {
    const rocks = new Array(this.rocks.activeCount);
    for (let index = 0; index < rocks.length; index += 1) {
      rocks[index] = {
        kind: "rock",
        id: this.rocks.id[index],
        spawnId: this.rocks.spawnId[index],
        archetype: ROCK_NAME_BY_CODE.get(this.rocks.archetype[index]) ?? "unknown",
        index,
        x: this.rocks.x[index],
        z: this.rocks.z[index],
        previousX: this.rocks.previousX[index],
        previousZ: this.rocks.previousZ[index],
        vx: this.rocks.vx[index],
        vz: this.rocks.vz[index],
        radius: this.rocks.radius[index],
        massKg: this.rocks.massKg[index],
      };
    }

    const projectiles = new Array(this.projectiles.activeCount);
    for (let index = 0; index < projectiles.length; index += 1) {
      projectiles[index] = {
        kind: "projectile",
        id: this.projectiles.id[index],
        ownerId: this.projectiles.ownerId[index],
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
        currentSize: this.#currentParticleSize(index),
        age: this.particles.age[index],
        lifetime: this.particles.lifetime[index],
        wallBounceCount: this.particles.wallBounceCount[index],
        flags: {
          bounced: Boolean(this.particles.bounced[index]),
          wallBounces: this.particles.wallBounceCount[index],
        },
      };
    }

    const contacts = new Array(this.contacts.count);
    for (let index = 0; index < contacts.length; index += 1) {
      contacts[index] = {
        type: this.contacts.type[index] === CONTACT_BODY ? "body" : "grid",
        a: {
          kind: bodyKindName(this.contacts.aKind[index]),
          id: this.contacts.aId[index],
        },
        b: this.contacts.bKind[index] === BODY_CELL
          ? {
            kind: "cell",
            id: `${this.contacts.cx[index]}:${this.contacts.cz[index]}`,
          }
          : {
            kind: bodyKindName(this.contacts.bKind[index]),
            id: this.contacts.bId[index],
          },
        x: this.contacts.x[index],
        z: this.contacts.z[index],
        nx: this.contacts.nx[index],
        nz: this.contacts.nz[index],
        penetration: this.contacts.penetration[index],
        cell: this.contacts.type[index] === CONTACT_GRID
          ? { cx: this.contacts.cx[index], cz: this.contacts.cz[index] }
          : null,
      };
    }

    return {
      schemaVersion: SCHEMA_VERSION,
      seed: this.seed,
      rngState: this.rng.state,
      tick: this.tickCount,
      particleProfile: this.particleProfile,
      scenarioVersion: SCENARIO_VERSION,
      map: {
        version: MAP_VERSION,
        width: this.map.width,
        height: this.map.height,
        cells: Array.from(this.map.cells),
        playerSpawn: { ...this.map.playerSpawn },
      },
      player: { kind: "player", index: 0, ...this.player },
      rocks,
      projectiles,
      particles,
      contacts,
      contactMetrics: {
        dropped: this.contacts.dropped,
      },
      recentEvents: this.impactEvents.toArray(32).map(cloneEvent),
      pools: {
        rocks: {
          active: this.rocks.activeCount,
          capacity: this.rocks.capacity,
          dropped: this.rocks.dropped,
          speedClamped: this.rocks.speedClamped,
        },
        projectiles: {
          active: this.projectiles.activeCount,
          capacity: this.projectiles.capacity,
          dropped: this.projectiles.dropped,
        },
        particles: {
          active: this.particles.activeCount,
          capacity: this.particles.capacity,
          dropped: this.particles.dropped,
          wallBounces: this.particles.wallBounces,
          groundBounces: this.particles.groundBounces,
          collisionDiscards: this.particles.collisionDiscards,
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
    for (let index = 0; index < this.rocks.activeCount; index += 1) {
      const distance = Math.hypot(x - this.rocks.x[index], z - this.rocks.z[index]);
      if (distance <= this.rocks.radius[index] + 0.08 && distance < bestDistance) {
        best = this.#describeRock(index);
        bestDistance = distance;
      }
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
      if (distance <= this.#currentParticleSize(index) + 0.08 && distance < bestDistance) {
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
      massKg: null,
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
    if (selection.kind === "rock") {
      const index = this.rocks.findIndexById(Number(selection.id));
      return index < 0 ? null : this.#describeRock(index);
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
      locomotionVelocity: {
        x: this.player.locomotionVx,
        y: 0,
        z: this.player.locomotionVz,
      },
      externalVelocity: {
        x: this.player.externalVx,
        y: 0,
        z: this.player.externalVz,
      },
      radius: this.player.radius,
      massKg: this.player.massKg,
      cell: null,
      age: null,
      lifetime: null,
      flags: { coolingDown: this.player.cooldown > 0 },
      raw: { ...this.player },
    };
  }

  /** @param {number} index */
  #describeRock(index) {
    return {
      kind: "rock",
      id: this.rocks.id[index],
      index,
      spawnId: this.rocks.spawnId[index],
      archetype: ROCK_NAME_BY_CODE.get(this.rocks.archetype[index]) ?? "unknown",
      position: { x: this.rocks.x[index], y: 0, z: this.rocks.z[index] },
      velocity: { x: this.rocks.vx[index], y: 0, z: this.rocks.vz[index] },
      radius: this.rocks.radius[index],
      massKg: this.rocks.massKg[index],
      cell: null,
      age: null,
      lifetime: null,
      flags: { authored: true },
    };
  }

  /** @param {number} index */
  #describeProjectile(index) {
    return {
      kind: "projectile",
      id: this.projectiles.id[index],
      ownerId: this.projectiles.ownerId[index],
      index,
      position: {
        x: this.projectiles.x[index],
        y: PROJECTILE.radius,
        z: this.projectiles.z[index],
      },
      velocity: { x: this.projectiles.vx[index], y: 0, z: this.projectiles.vz[index] },
      radius: this.projectiles.radius[index],
      massKg: null,
      cell: null,
      age: this.projectiles.age[index],
      lifetime: this.projectiles.lifetime[index],
      flags: {},
    };
  }

  /** @param {number} index */
  #describeParticle(index) {
    const currentSize = this.#currentParticleSize(index);
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
      radius: currentSize,
      maxRadius: this.particles.size[index],
      massKg: null,
      cell: null,
      age: this.particles.age[index],
      lifetime: this.particles.lifetime[index],
      wallBounceCount: this.particles.wallBounceCount[index],
      flags: {
        bounced: Boolean(this.particles.bounced[index]),
        wallBounces: this.particles.wallBounceCount[index],
      },
    };
  }

  listRockArchetypes() {
    return Object.entries(ROCK_ARCHETYPES).map(([name, definition]) => ({
      name,
      radius: definition.radius,
      massKg: definition.massKg,
    }));
  }

  /** @param {string} archetype @param {number} x @param {number} z */
  canPlaceRock(archetype, x, z) {
    const definition = getRockArchetype(archetype);
    if (
      !definition ||
      this.rocks.activeCount >= this.rocks.capacity ||
      !this.scenario.canPlaceRock(archetype, x, z)
    ) {
      return false;
    }
    if (
      Math.hypot(x - this.player.x, z - this.player.z) <
      definition.radius + this.player.radius
    ) {
      return false;
    }
    for (let index = 0; index < this.rocks.activeCount; index += 1) {
      if (
        Math.hypot(x - this.rocks.x[index], z - this.rocks.z[index]) <
        definition.radius + this.rocks.radius[index]
      ) {
        return false;
      }
    }
    return true;
  }

  saveScenario() {
    return JSON.stringify(this.scenario.toJSON(), null, 2);
  }

  saveMap() {
    return this.saveScenario();
  }

  exportCommandLog() {
    const initialScenario = cloneScenarioJson(this.commandLogScenario);
    return {
      schemaVersion: SCHEMA_VERSION,
      seed: this.seed,
      initialScenario,
      initialMap: cloneMapJson(
        GridMap.fromJSON({
          version: 1,
          width: initialScenario.width,
          height: initialScenario.height,
          cells: initialScenario.cells,
          playerSpawn: initialScenario.playerSpawn,
        }).toJSON(),
      ),
      configuration: {
        rockCapacity: this.rocks.capacity,
        projectileCapacity: this.projectiles.capacity,
        particleCapacity: this.particles.capacity,
        particleBurstCount: this.particleBurstCount,
        particleProfile: this.commandLogParticleProfile,
        particleBounce: this.commandLogParticleBounce,
        particleWallCollision: this.commandLogParticleWallCollision,
      },
      truncated: this.commandLogDropped > 0,
      commands: this.commandLog.toArray().map((entry) => ({
        tick: entry.tick,
        command: cloneCanonicalCommand(entry.command),
      })),
    };
  }

  /** @param {Record<string, any>} recording */
  static replay(recording) {
    const scenario = ArenaScenario.fromJSON(recording.initialScenario ?? recording.initialMap);
    const recordingSchema = Number(recording.schemaVersion);
    const particleProfile = recordingSchema >= 4
      ? recording.configuration?.particleProfile ?? DEFAULT_PARTICLE_PROFILE
      : PARTICLE_PROFILE_M02;
    const particleBounce = recordingSchema >= 4
      ? recording.configuration?.particleBounce ?? true
      : false;
    const particleWallCollision = recordingSchema >= 3
      ? recording.configuration?.particleWallCollision ?? true
      : false;
    const simulation = new Simulation({
      seed: recording.seed,
      scenario,
      rockCapacity: recording.configuration?.rockCapacity,
      projectileCapacity: recording.configuration?.projectileCapacity,
      particleCapacity: recording.configuration?.particleCapacity,
      particleBurstCount: recording.configuration?.particleBurstCount,
      particleProfile,
      particleBounce,
      particleWallCollision,
    });
    for (const entry of recording.commands) simulation.tick(entry.command);
    return simulation;
  }
}
