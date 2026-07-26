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
  cloneFireballDefinition,
  DEFAULT_FIREBALL_DEFINITION,
  FIREBALL_SPELL_CODE,
  FIREBALL_SPELL_ID,
} from "../spells/fireball_definition.js";
import {
  fireballColorToHex,
  FIREBALL_COLOR_PARTICLE,
  writeFireballPaletteColor,
} from "../spells/palette.js";
import {
  deriveCastSeed,
  deriveSampleSeed,
  laneUnit,
} from "../spells/random.js";
import { SpellRegistry } from "../spells/spell_registry.js";
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
function castFrom(value) {
  const point = pointFrom(value);
  if (!point || !value || typeof value !== "object") return null;
  const record = /** @type {Record<string, unknown>} */ (value);
  /** @type {{x:number,z:number,spellId?:string,variationSeed?:number}} */
  const cast = { ...point };
  if (record.spellId !== undefined) cast.spellId = String(record.spellId);
  if (record.variationSeed !== undefined) {
    if (
      typeof record.variationSeed !== "number"
      || !Number.isInteger(record.variationSeed)
      || record.variationSeed < 0
      || record.variationSeed > 0xffff_ffff
    ) {
      return null;
    }
    cast.variationSeed = record.variationSeed >>> 0;
  }
  return cast;
}

/** @param {unknown} value */
function cloneUnknown(value) {
  if (Array.isArray(value)) return value.map(cloneUnknown);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, cloneUnknown(item)]),
    );
  }
  return value;
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
    case "applySpellDefinition":
      return {
        type: "applySpellDefinition",
        spellId: String(action.spellId),
        expectedRevision: action.expectedRevision === undefined
          ? undefined
          : Number(action.expectedRevision),
        definition: cloneUnknown(action.definition),
      };
    case "clearSpellEffects":
      return {
        type: "clearSpellEffects",
        spellId: String(action.spellId),
      };
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
    actions: command.actions.map((action) => cloneUnknown(action)),
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
  const cast = castFrom(source.cast ?? source.castTarget);
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
   * particleWallCollision?:boolean,
   * initialFireballDefinition?:unknown,
   * spellBaseline?:Array<Record<string,any>>,
   * legacyFireballMode?:boolean
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
    this.legacyFireballMode = options.legacyFireballMode
      ?? this.particleProfile === PARTICLE_PROFILE_M02;
    let initialFireballDefinition = options.initialFireballDefinition;
    if (
      initialFireballDefinition === undefined
      && options.particleBurstCount !== undefined
      && !options.spellBaseline
      && Number.isInteger(options.particleBurstCount)
      && options.particleBurstCount >= 0
      && options.particleBurstCount <= 1_024
    ) {
      initialFireballDefinition = cloneFireballDefinition(DEFAULT_FIREBALL_DEFINITION);
      if (initialFireballDefinition) {
        initialFireballDefinition.emission.burstCount = options.particleBurstCount;
      }
    }
    this.spells = new SpellRegistry({
      initialFireballDefinition,
      recordingBaseline: options.spellBaseline,
    });
    this.spellCooldowns = new Float32Array(256);
    this.castSequences = new Uint32Array(256);
    this.nextEffectId = 1;
    this.latestSpellSamples = new Map();
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
    this.commandLogSpellBaseline = this.spells.cloneBaseline();
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
    this._sampleColor = { r: 0, g: 0, b: 0 };
    this.lastError = null;
    this.lastSpellResult = null;
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
    this.spells.prune(new Map());
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
      this.commandLogSpellBaseline = this.spells.cloneBaseline();
    }
    this.lastError = null;
    this.lastSpellResult = null;
  }

  #restoreAuthoredState() {
    this.projectiles.reset();
    this.particles.reset();
    this.rocks.reset();
    this.spellCooldowns.fill(0);
    this.castSequences.fill(0);
    this.nextEffectId = 1;
    this.latestSpellSamples.clear();
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
    for (const spell of this.spells.entriesById.values()) {
      this.spellCooldowns[spell.code] = approach(
        this.spellCooldowns[spell.code],
        0,
        SIMULATION.dt,
      );
    }
    this.player.cooldown = this.legacyFireballMode
      ? approach(this.player.cooldown, 0, SIMULATION.dt)
      : this.spellCooldowns[FIREBALL_SPELL_CODE];
    this.#castSystem(command.cast);
    this.#projectileSystem(SIMULATION.dt);
    this.#particleSystem(SIMULATION.dt);
    this.#pruneSpellRevisions();
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
        } else if (action.type === "applySpellDefinition") {
          this.#pruneSpellRevisions();
          const result = this.spells.apply(
            String(action.spellId),
            action.definition,
            action.expectedRevision === undefined
              ? undefined
              : Number(action.expectedRevision),
          );
          this.lastSpellResult = cloneUnknown(result);
          if (!result.ok) {
            throw new TypeError(result.errors.map((error) => error.message).join("; "));
          }
        } else if (action.type === "clearSpellEffects") {
          const result = this.clearSpellEffects(String(action.spellId));
          this.lastSpellResult = cloneUnknown(result);
          if (!result.ok) {
            throw new RangeError(result.errors.map((error) => error.message).join("; "));
          }
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

  /** @param {{x:number,z:number,spellId?:string,variationSeed?:number}|null} target */
  #castSystem(target) {
    if (this.legacyFireballMode) {
      this.#legacyCastSystem(target);
      return;
    }
    if (!target) return;
    const spellId = target.spellId ?? FIREBALL_SPELL_ID;
    const spell = this.spells.get(spellId);
    if (!spell || spell.handler !== "fireball") return;
    const player = this.player;
    if (this.spellCooldowns[spell.code] > 0) return;
    const dx = target.x - player.x;
    const dz = target.z - player.z;
    const distance = Math.hypot(dx, dz);
    if (distance <= 1e-5) return;
    const definition = spell.definitions.get(spell.currentRevision);
    if (!definition) throw new Error("Current Fireball definition is unavailable");
    const nx = dx / distance;
    const nz = dz / distance;
    const offset = player.radius
      + Number(definition.projectile.radius)
      + Number(definition.projectile.spawnGap);
    const effectSeed = target.variationSeed === undefined
      ? deriveCastSeed(this.seed, spell.code, this.castSequences[spell.code])
      : target.variationSeed >>> 0;
    const effectId = this.nextEffectId;
    const id = this.projectiles.spawn({
      x: player.x + nx * offset,
      z: player.z + nz * offset,
      vx: nx * Number(definition.projectile.speed),
      vz: nz * Number(definition.projectile.speed),
      lifetime: Number(definition.projectile.lifetime),
      radius: Number(definition.projectile.radius),
      ownerId: player.id,
      spellCode: spell.code,
      definitionRevision: spell.currentRevision,
      effectId,
      effectSeed,
    });
    if (id !== 0) {
      this.spellCooldowns[spell.code] = Number(definition.cast.cooldown);
      this.player.cooldown = this.spellCooldowns[FIREBALL_SPELL_CODE];
      this.castSequences[spell.code] = (this.castSequences[spell.code] + 1) >>> 0;
      this.nextEffectId = (this.nextEffectId + 1) >>> 0 || 1;
      // Successful automatic casts are made explicit in schema-v5 command
      // history. Rejected casts never advance or record the preview seed.
      target.variationSeed = effectSeed;
    }
  }

  /** @param {{x:number,z:number}|null} target */
  #legacyCastSystem(target) {
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

  /** @param {number} spellCode @param {number} definitionRevision */
  #capturedSpellDefinition(spellCode, definitionRevision) {
    if (!(spellCode > 0)) return null;
    const definition = this.spells.getDefinition(spellCode, definitionRevision);
    if (!definition) {
      throw new Error(
        `Missing captured spell definition ${spellCode}@${definitionRevision}`,
      );
    }
    return definition;
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
        this.#emitParticles(event);
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
    const spellCode = pool.spellCode[projectileIndex];
    const definitionRevision = pool.definitionRevision[projectileIndex];
    const spell = this.spells.getByCode(spellCode);
    const definition = this.#capturedSpellDefinition(
      spellCode,
      definitionRevision,
    );
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
    const spawnHeight = Number(
      definition?.emission.spawnHeight ?? PARTICLE.initialY,
    );
    const event = {
      type: "explosion",
      id: this.nextExplosionId,
      tick: this.tickCount + 1,
      projectileId: pool.id[projectileIndex],
      spellId: spell?.id ?? FIREBALL_SPELL_ID,
      spellCode,
      definitionRevision,
      effectId: pool.effectId[projectileIndex],
      effectSeed: pool.effectSeed[projectileIndex],
      owner: { kind: "player", id: pool.ownerId[projectileIndex] },
      hit,
      x: originX,
      y: spawnHeight,
      z: originZ,
      originX,
      originZ,
      nx,
      nz,
      radius: Number(definition?.impact.blastRadius ?? EXPLOSION.radius),
      pressureImpulse: Number(
        definition?.impact.pressureImpulse ?? EXPLOSION.pressureImpulse,
      ),
      visualLifetime: Number(
        definition?.impact.visualLifetime
        ?? EXPLOSION.debugTicks / SIMULATION.tickHz,
      ),
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

  /** @param {Record<string, any>} event */
  #emitParticles(event) {
    const definition = this.#capturedSpellDefinition(
      Number(event.spellCode),
      Number(event.definitionRevision),
    );
    if (!definition) {
      this.#emitLegacyParticles(
        event.originX,
        event.originZ,
        event.nx,
        event.nz,
      );
      return;
    }
    const x = Number(event.originX);
    const z = Number(event.originZ);
    const normalX = Number(event.nx);
    const normalZ = Number(event.nz);
    const emission = definition.emission;
    const lifecycle = definition.particleLifecycle;
    const normalLength = Math.hypot(normalX, normalZ);
    const outwardX = normalLength > 1e-9 ? normalX / normalLength : 1;
    const outwardZ = normalLength > 1e-9 ? normalZ / normalLength : 0;
    const statistics = {
      spellId: event.spellId,
      spellCode: event.spellCode,
      definitionRevision: event.definitionRevision,
      effectId: event.effectId,
      effectSeed: event.effectSeed,
      impactId: event.id,
      tick: event.tick,
      requested: Number(emission.burstCount),
      spawned: 0,
      horizontalSpeed: { minimum: Infinity, maximum: -Infinity },
      lifetime: { minimum: Infinity, maximum: -Infinity },
      size: { minimum: Infinity, maximum: -Infinity },
      color: {
        red: { minimum: Infinity, maximum: -Infinity },
        green: { minimum: Infinity, maximum: -Infinity },
        blue: { minimum: Infinity, maximum: -Infinity },
        first: null,
        last: null,
      },
    };
    for (let ordinal = 0; ordinal < Number(emission.burstCount); ordinal += 1) {
      const sampleSeed = deriveSampleSeed(event.effectSeed, ordinal);
      const angle = laneUnit(sampleSeed, "angle") * TAU;
      const horizontalSpeed = Number(emission.horizontalSpeedMinimum)
        + (
          Number(emission.horizontalSpeedMaximum)
          - Number(emission.horizontalSpeedMinimum)
        ) * laneUnit(sampleSeed, "speed");
      const outwardBias = Number(emission.outwardBiasMinimum)
        + (
          Number(emission.outwardBiasMaximum)
          - Number(emission.outwardBiasMinimum)
        ) * laneUnit(sampleSeed, "bias");
      let vx = Math.cos(angle) * horizontalSpeed + outwardX * outwardBias;
      let vz = Math.sin(angle) * horizontalSpeed + outwardZ * outwardBias;
      const horizontalLength = Math.hypot(vx, vz);
      const speedCap = Number(emission.horizontalSpeedCap);
      if (horizontalLength > speedCap && horizontalLength > 1e-12) {
        vx = (vx / horizontalLength) * speedCap;
        vz = (vz / horizontalLength) * speedCap;
      }
      const inwardSpeed = vx * outwardX + vz * outwardZ;
      if (inwardSpeed < 0) {
        vx -= 2 * inwardSpeed * outwardX;
        vz -= 2 * inwardSpeed * outwardZ;
      }
      const size = Number(lifecycle.sizeMinimum)
        + (
          Number(lifecycle.sizeMaximum)
          - Number(lifecycle.sizeMinimum)
        ) * laneUnit(sampleSeed, "size");
      const sizeRange = Number(lifecycle.sizeMaximum)
        - Number(lifecycle.sizeMinimum);
      const normalizedSize = sizeRange > 1e-12
        ? (size - Number(lifecycle.sizeMinimum)) / sizeRange
        : 0;
      const vy = Number(emission.verticalMinimum)
        + Number(emission.verticalRange)
          * laneUnit(sampleSeed, "vertical") ** Number(emission.verticalPower);
      const lifetime = clamp(
        Number(lifecycle.lifetimeBase)
          + Number(lifecycle.lifetimeSizeScale) * normalizedSize
          + (
            laneUnit(sampleSeed, "lifetime") - 0.5
          ) * Number(lifecycle.lifetimeJitter),
        Number(lifecycle.lifetimeMinimum),
        Number(lifecycle.lifetimeMaximum),
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
      const id = this.particles.spawn({
        x: this._particleSpawnPoint.x,
        y: Number(emission.spawnHeight),
        z: this._particleSpawnPoint.z,
        vx,
        vy,
        vz,
        lifetime,
        size,
        spellCode: event.spellCode,
        definitionRevision: event.definitionRevision,
        effectId: event.effectId,
        effectSeed: event.effectSeed,
        sampleOrdinal: ordinal,
        sampleSeed,
      });
      if (id === 0) continue;
      const sampledHorizontalSpeed = Math.hypot(vx, vz);
      statistics.spawned += 1;
      statistics.horizontalSpeed.minimum = Math.min(
        statistics.horizontalSpeed.minimum,
        sampledHorizontalSpeed,
      );
      statistics.horizontalSpeed.maximum = Math.max(
        statistics.horizontalSpeed.maximum,
        sampledHorizontalSpeed,
      );
      statistics.lifetime.minimum = Math.min(statistics.lifetime.minimum, lifetime);
      statistics.lifetime.maximum = Math.max(statistics.lifetime.maximum, lifetime);
      statistics.size.minimum = Math.min(statistics.size.minimum, size);
      statistics.size.maximum = Math.max(statistics.size.maximum, size);
      writeFireballPaletteColor(this._sampleColor, definition, {
        kind: FIREBALL_COLOR_PARTICLE,
        life: 1,
        effectSeed: event.effectSeed,
        sampleOrdinal: ordinal,
        sampleSeed,
      });
      statistics.color.red.minimum = Math.min(
        statistics.color.red.minimum,
        this._sampleColor.r,
      );
      statistics.color.red.maximum = Math.max(
        statistics.color.red.maximum,
        this._sampleColor.r,
      );
      statistics.color.green.minimum = Math.min(
        statistics.color.green.minimum,
        this._sampleColor.g,
      );
      statistics.color.green.maximum = Math.max(
        statistics.color.green.maximum,
        this._sampleColor.g,
      );
      statistics.color.blue.minimum = Math.min(
        statistics.color.blue.minimum,
        this._sampleColor.b,
      );
      statistics.color.blue.maximum = Math.max(
        statistics.color.blue.maximum,
        this._sampleColor.b,
      );
      const color = fireballColorToHex(this._sampleColor);
      statistics.color.first ??= color;
      statistics.color.last = color;
    }
    if (statistics.spawned === 0) {
      for (const range of [
        statistics.horizontalSpeed,
        statistics.lifetime,
        statistics.size,
        statistics.color.red,
        statistics.color.green,
        statistics.color.blue,
      ]) {
        range.minimum = null;
        range.maximum = null;
      }
    }
    this.latestSpellSamples.set(Number(event.spellCode), statistics);
  }

  /** @param {number} x @param {number} z @param {number} normalX @param {number} normalZ */
  #emitLegacyParticles(x, z, normalX, normalZ) {
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
      const definition = this.#capturedSpellDefinition(
        pool.spellCode[index],
        pool.definitionRevision[index],
      );
      const collision = definition?.collision ?? null;
      const gravity = Number(definition?.emission.gravity ?? PARTICLE.gravity);
      pool.age[index] += dt;
      if (pool.age[index] >= pool.lifetime[index]) {
        pool.removeSwap(index);
        continue;
      }
      pool.vy[index] += gravity * dt;
      const wallCollisionEnabled = this.debugFlags.particleWallCollision
        && (collision?.wallCollision ?? true);
      if (wallCollisionEnabled) {
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
        this.#advanceParticleAgainstWalls(index, dt, collision);
      } else {
        pool.x[index] += pool.vx[index] * dt;
        pool.z[index] += pool.vz[index] * dt;
      }
      pool.y[index] += pool.vy[index] * dt;
      if (pool.y[index] <= 0) {
        const groundBounceEnabled = this.debugFlags.particleBounce
          && (collision ? collision.groundMode === "bounce-settle" : true);
        const groundVerticalRetention = Number(
          collision?.groundVerticalRetention
          ?? this.particleTuning.groundVerticalRetention,
        );
        const groundHorizontalRetention = Number(
          collision?.groundHorizontalRetention
          ?? this.particleTuning.groundHorizontalRetention,
        );
        if (groundBounceEnabled && pool.bounced[index] === 0) {
          pool.y[index] = 0;
          pool.vy[index] =
            Math.abs(pool.vy[index]) * groundVerticalRetention;
          pool.vx[index] *= groundHorizontalRetention;
          pool.vz[index] *= groundHorizontalRetention;
          pool.bounced[index] = 1;
          pool.groundBounces += 1;
        } else if (
          groundBounceEnabled
          && (
            collision
              ? collision.groundMode === "bounce-settle"
              : this.particleTuning.groundSettlesAfterBounce
          )
        ) {
          pool.y[index] = 0;
          pool.vy[index] = 0;
          pool.vx[index] *= groundHorizontalRetention;
          pool.vz[index] *= groundHorizontalRetention;
        } else {
          pool.removeSwap(index);
          continue;
        }
      }
      index += 1;
    }
  }

  /** @param {number} index @param {number} dt @param {Record<string,any>|null} collision */
  #advanceParticleAgainstWalls(index, dt, collision) {
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
        const tangentialRetention = Number(
          collision?.wallTangentialRetention ?? PARTICLE.wallTangentialRetention,
        );
        const normalRetention = Number(
          collision?.wallNormalRetention ?? PARTICLE.wallNormalRetention,
        );
        pool.vx[index] =
          tangentX * tangentialRetention
          - normalSpeed * normalRetention * hit.nx;
        pool.vz[index] =
          tangentZ * tangentialRetention
          - normalSpeed * normalRetention * hit.nz;
        pool.wallBounceCount[index] += 1;
        pool.wallBounces += 1;
      }
      remaining *= 1 - hit.time;
    }
  }

  /** @param {number} index */
  #currentParticleSize(index) {
    const definition = this.#capturedSpellDefinition(
      this.particles.spellCode[index],
      this.particles.definitionRevision[index],
    );
    return currentParticleSize(
      definition?.particleLifecycle ?? this.particleTuning,
      this.particles.size[index],
      this.particles.age[index],
      this.particles.lifetime[index],
    );
  }

  /** @param {Array<Record<string,any>>} [events] */
  #spellRevisionReferences(events = this.impactEvents.toArray()) {
    /** @type {Map<number,Set<number>>} */
    const references = new Map();
    const add = (code, revision) => {
      if (!(code > 0) || !(revision > 0)) return;
      const revisions = references.get(code) ?? new Set();
      revisions.add(revision);
      references.set(code, revisions);
    };
    for (let index = 0; index < this.projectiles.activeCount; index += 1) {
      add(
        this.projectiles.spellCode[index],
        this.projectiles.definitionRevision[index],
      );
    }
    for (let index = 0; index < this.particles.activeCount; index += 1) {
      add(
        this.particles.spellCode[index],
        this.particles.definitionRevision[index],
      );
    }
    for (const event of events) {
      add(Number(event.spellCode), Number(event.definitionRevision));
    }
    return references;
  }

  #pruneSpellRevisions() {
    return this.spells.prune(this.#spellRevisionReferences());
  }

  listSpells() {
    return this.spells.list();
  }

  /** @param {string} id */
  getSpellDefinition(id) {
    return this.spells.describe(String(id));
  }

  /**
   * Direct simulation helper used by tick-action handling and unit tests.
   * Browser probes still enqueue the matching command at a fixed-tick boundary.
   *
   * @param {string} id
   * @param {unknown} definition
   * @param {number|undefined} expectedRevision
   */
  applySpellDefinition(id, definition, expectedRevision) {
    this.#pruneSpellRevisions();
    return this.spells.apply(String(id), definition, expectedRevision);
  }

  /** @param {string} id @param {unknown} definition @param {number|undefined} expectedRevision */
  validateSpellDefinition(id, definition, expectedRevision) {
    this.#pruneSpellRevisions();
    return this.spells.validateApply(String(id), definition, expectedRevision);
  }

  /** @param {string} id */
  clearSpellEffects(id) {
    const spell = this.spells.get(String(id));
    if (!spell) {
      return {
        ok: false,
        spellId: String(id),
        errors: [{
          path: "spellId",
          code: "unknown_spell",
          message: `Unknown spell "${id}"`,
        }],
      };
    }
    const matches = (code) => code === spell.code
      || (spell.code === FIREBALL_SPELL_CODE && code === 0);
    let projectiles = 0;
    let particles = 0;
    let events = 0;
    let index = 0;
    while (index < this.projectiles.activeCount) {
      if (!matches(this.projectiles.spellCode[index])) {
        index += 1;
        continue;
      }
      this.projectiles.removeSwap(index);
      projectiles += 1;
    }
    index = 0;
    while (index < this.particles.activeCount) {
      if (!matches(this.particles.spellCode[index])) {
        index += 1;
        continue;
      }
      this.particles.removeSwap(index);
      particles += 1;
    }
    const retainedEvents = [];
    for (const event of this.impactEvents.toArray()) {
      if (matches(Number(event.spellCode ?? 0))) events += 1;
      else retainedEvents.push(event);
    }
    this.impactEvents.clear();
    for (const event of retainedEvents) this.impactEvents.push(event);
    this.latestSpellSamples.delete(spell.code);
    this.#pruneSpellRevisions();
    return {
      ok: true,
      spellId: spell.id,
      code: spell.code,
      removed: { projectiles, particles, events },
      impulsesReversed: false,
      errors: [],
    };
  }

  /** @param {string} id */
  spellDiagnostics(id) {
    const spell = this.spells.get(String(id));
    if (!spell) {
      return {
        ok: false,
        spellId: String(id),
        errors: [{
          path: "spellId",
          code: "unknown_spell",
          message: `Unknown spell "${id}"`,
        }],
      };
    }
    let activeProjectiles = 0;
    let activeParticles = 0;
    for (let index = 0; index < this.projectiles.activeCount; index += 1) {
      if (this.projectiles.spellCode[index] === spell.code) activeProjectiles += 1;
    }
    for (let index = 0; index < this.particles.activeCount; index += 1) {
      if (this.particles.spellCode[index] === spell.code) activeParticles += 1;
    }
    const latestImpact = this.impactEvents.toArray()
      .toReversed()
      .find((event) => Number(event.spellCode) === spell.code) ?? null;
    const registry = this.spells.diagnostics()
      .find((entry) => entry.code === spell.code);
    return {
      ok: true,
      spellId: spell.id,
      spellCode: spell.code,
      appliedRevision: spell.currentRevision,
      revisionCounter: spell.revisionCounter,
      retainedRevisions: registry?.retainedRevisions ?? 0,
      revisions: registry?.revisions ?? [],
      castSequence: this.castSequences[spell.code],
      currentSeed: deriveCastSeed(
        this.seed,
        spell.code,
        this.castSequences[spell.code],
      ),
      cooldownRemaining: this.spellCooldowns[spell.code],
      active: {
        projectiles: activeProjectiles,
        particles: activeParticles,
        impacts: this.impactEvents.toArray().filter((event) => (
          Number(event.spellCode) === spell.code
          && this.tickCount - Number(event.tick)
            <= Math.max(
              1,
              Math.round(
                Number(event.visualLifetime ?? 0.2) * SIMULATION.tickHz,
              ),
            )
        )).length,
      },
      poolDrops: {
        projectiles: this.projectiles.dropped,
        particles: this.particles.dropped,
        collisionDiscards: this.particles.collisionDiscards,
      },
      latestImpact: latestImpact ? cloneEvent(latestImpact) : null,
      sampledRanges: cloneUnknown(this.latestSpellSamples.get(spell.code) ?? null),
      lastResult: cloneUnknown(this.lastSpellResult),
      errors: [],
    };
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
        spellId: this.spells.getByCode(this.projectiles.spellCode[index])?.id
          ?? FIREBALL_SPELL_ID,
        spellCode: this.projectiles.spellCode[index],
        definitionRevision: this.projectiles.definitionRevision[index],
        effectId: this.projectiles.effectId[index],
        effectSeed: this.projectiles.effectSeed[index],
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
        spellId: this.spells.getByCode(this.particles.spellCode[index])?.id
          ?? FIREBALL_SPELL_ID,
        spellCode: this.particles.spellCode[index],
        definitionRevision: this.particles.definitionRevision[index],
        effectId: this.particles.effectId[index],
        effectSeed: this.particles.effectSeed[index],
        sampleOrdinal: this.particles.sampleOrdinal[index],
        sampleSeed: this.particles.sampleSeed[index],
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

    const recentEvents = this.impactEvents.toArray(32).map(cloneEvent);
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
      player: {
        kind: "player",
        index: 0,
        ...this.player,
        cooldowns: Object.fromEntries(
          this.spells.list().map((spell) => [
            spell.id,
            this.spellCooldowns[spell.code],
          ]),
        ),
      },
      spells: this.spells.snapshotTable(
        this.#spellRevisionReferences(recentEvents),
      ),
      rocks,
      projectiles,
      particles,
      contacts,
      contactMetrics: {
        dropped: this.contacts.dropped,
      },
      recentEvents,
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
      lastSpellResult: cloneUnknown(this.lastSpellResult),
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
    const spellCode = this.projectiles.spellCode[index];
    return {
      kind: "projectile",
      id: this.projectiles.id[index],
      ownerId: this.projectiles.ownerId[index],
      spell: this.spells.getByCode(spellCode)?.id ?? FIREBALL_SPELL_ID,
      spellCode,
      definitionRevision: this.projectiles.definitionRevision[index],
      effectId: this.projectiles.effectId[index],
      effectSeed: this.projectiles.effectSeed[index],
      index,
      position: {
        x: this.projectiles.x[index],
        y: this.projectiles.radius[index],
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
    const spellCode = this.particles.spellCode[index];
    return {
      kind: "particle",
      id: this.particles.id[index],
      spell: this.spells.getByCode(spellCode)?.id ?? FIREBALL_SPELL_ID,
      spellCode,
      definitionRevision: this.particles.definitionRevision[index],
      effectId: this.particles.effectId[index],
      effectSeed: this.particles.effectSeed[index],
      sampleOrdinal: this.particles.sampleOrdinal[index],
      sampleSeed: this.particles.sampleSeed[index],
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
        spells: cloneUnknown(this.commandLogSpellBaseline),
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
    const spellBaseline = recordingSchema >= 5
      ? recording.configuration?.spells
      : undefined;
    if (recordingSchema >= 5 && !Array.isArray(spellBaseline)) {
      throw new TypeError("Schema-v5 recording is missing its spell baseline");
    }
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
      spellBaseline,
      legacyFireballMode: recordingSchema < 5,
    });
    for (const entry of recording.commands) simulation.tick(entry.command);
    return simulation;
  }
}
