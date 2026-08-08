// @ts-check

import {
  ACTOR_TEAM,
  COMBAT,
  DEAD_BODY,
  DEAD_BODY_PROFILE_NONE,
  DEAD_BODY_PROFILE_V1,
  DEFAULT_DEBUG_FLAGS,
  DEFAULT_PARTICLE_PROFILE,
  DYNAMIC_PHYSICS,
  ENEMY_AI_PROFILE_BASIC,
  ENEMY_AI_PROFILE_INVESTIGATIVE,
  ENEMY_AI_PROFILE_NONE,
  ENEMY_AI_PROFILE_PERCEPTIVE,
  ENEMY_AI_PROFILE_TACTICAL,
  ENEMY_WIZARD,
  EXPLOSION,
  GAMEPLAY_PROFILE_OBELISK_DUEL,
  GAMEPLAY_PROFILE_PRE_COMBAT,
  HISTORY,
  MAP_VERSION,
  MOVEMENT_SOUND,
  MOVEMENT_SOUND_PROFILE_NONE,
  MOVEMENT_SOUND_PROFILE_V1,
  normalizeParticleProfile,
  PARTICLE,
  PARTICLE_PROFILES,
  PARTICLE_PROFILE_M02,
  PERCEPTIVE_WIZARD,
  PLAYER,
  PROJECTILE_OWNER_KIND,
  PROJECTILE,
  ROCK,
  ROCK_ARCHETYPES,
  SCHEMA_VERSION,
  SCENARIO_VERSION,
  SIMULATION,
  TACTICAL_WIZARD,
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
  deriveEnemyCastSeed,
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
import {
  resolveDynamicBodyPairVelocity,
  resolvePlayerDynamicBodyVelocity,
} from "./dynamic_body_velocity.js";
import {
  DEAD_BODY_SETTLE_REASON,
  DEAD_BODY_SETTLE_REASON_NAMES,
  DynamicDeadBodyPool,
  InertDeadBodyRing,
} from "./dead_body_pool.js";
import { computeExplosionResponse } from "./explosion.js";
import { DestinationFieldCache } from "./destination_field_cache.js";
import { GridMap } from "./grid_map.js";
import { GridReachability } from "./grid_reachability.js";
import { MapCellBroadphase } from "./map_cell_broadphase.js";
import {
  NAVIGATION_UNREACHABLE,
  SharedNavigationField,
} from "./navigation_field.js";
import {
  EnemyWizardPool,
  ParticlePool,
  ProjectilePool,
  RockPool,
} from "./pools.js";
import {
  arbitrateInvestigationClue,
  deterministicGuardHeading,
  deterministicGuardSweepPhase,
  fireballHearingCheck,
  guardSweepFacing,
  HUNT_PHASE,
  HUNT_PHASE_NAMES,
  inferProjectileOrigin,
  INVESTIGATION_DECISION,
  INVESTIGATION_PRIORITY,
  KNOWLEDGE_SOURCE,
  KNOWLEDGE_SOURCE_NAMES,
  PERCEPTION_STATE,
  PERCEPTION_STATE_NAMES,
  searchCandidate,
  searchScanFacing,
  soundHearingCheck,
  TARGET_KIND,
  TARGET_KIND_NAMES,
  turnFacing,
  visualCheck,
} from "./perceptive_wizard.js";
import {
  SOUND_EVENT_KIND,
  SOUND_EVENT_KIND_NAMES,
  SOUND_EVENT_REASON,
  SOUND_EVENT_REASON_NAMES,
  SoundEventQueue,
} from "./sound_event_pool.js";
import {
  ArenaScenario,
  createDebugArenaScenario,
  getRockArchetype,
} from "./scenario.js";
import {
  chooseDodgeDirection,
  hostileThreatMetrics,
  predictSoftenedIntercept,
  strafeDecision,
} from "./tactical_wizard.js";

const TAU = Math.PI * 2;
const CONTACT_CAPACITY = 256;
const BROADPHASE_CORRECTION_MARGIN = 2;
const MAX_ROCK_RADIUS = Math.max(
  ...Object.values(ROCK_ARCHETYPES).map((definition) => definition.radius),
);
const BODY_PLAYER = 1;
const BODY_ROCK = 2;
const BODY_CELL = 3;
const BODY_ENEMY_WIZARD = 4;
const BODY_ENEMY_WIZARD_BODY = 5;
const CONTACT_GRID = 1;
const CONTACT_BODY = 2;
const ENEMY_AI_HOLD = 0;
const ENEMY_AI_APPROACH = 1;
const ENEMY_AI_WITHDRAW = 2;
const ENEMY_AI_RETREAT = 3;
const PLAYER_MOVEMENT_IDLE = 0;
const PLAYER_MOVEMENT_WALKING = 1;
const PLAYER_MOVEMENT_RUNNING = 2;
const PLAYER_MOVEMENT_MODE_NAMES = Object.freeze(["idle", "walking", "running"]);
const ENEMY_AI_DODGE = 4;
const ENEMY_AI_STATE_NAMES_BASIC = Object.freeze(["hold", "approach", "withdraw"]);
const ENEMY_AI_STATE_NAMES_TACTICAL = Object.freeze([
  "engage",
  "approach",
  "withdraw",
  "retreat",
  "dodge",
]);
const ENEMY_GOAL_NONE = 0;
const ENEMY_GOAL_DIRECT = 1;
const ENEMY_GOAL_NAVIGATION = 2;
const ENEMY_GOAL_STRAFE = 3;
const ENEMY_GOAL_DODGE = 4;
const ENEMY_GOAL_MEMORY = 5;
const ENEMY_GOAL_SEARCH = 6;
const ENEMY_GOAL_GUARD = 7;
const ENEMY_GOAL_NAMES = Object.freeze([
  "none",
  "direct",
  "navigation",
  "strafe",
  "dodge",
  "memory",
  "search",
  "guard",
]);
const SPAWN_OFFSETS = Object.freeze([
  Object.freeze({ x: 0, z: -1, name: "north" }),
  Object.freeze({ x: 1, z: 0, name: "east" }),
  Object.freeze({ x: 0, z: 1, name: "south" }),
  Object.freeze({ x: -1, z: 0, name: "west" }),
  Object.freeze({ x: 1, z: -1, name: "northeast" }),
  Object.freeze({ x: 1, z: 1, name: "southeast" }),
  Object.freeze({ x: -1, z: 1, name: "southwest" }),
  Object.freeze({ x: -1, z: -1, name: "northwest" }),
]);

const ROCK_NAME_BY_CODE = new Map(
  Object.entries(ROCK_ARCHETYPES).map(([name, definition]) => [definition.code, name]),
);

/** @param {string} profile */
function usesPerceptionProfile(profile) {
  return profile === ENEMY_AI_PROFILE_PERCEPTIVE
    || profile === ENEMY_AI_PROFILE_INVESTIGATIVE;
}

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
 * Direct health damage is independent of the authored blast radius. This
 * finite zero-impulse record keeps the actor hit inspectable when a valid
 * zero-radius definition has no physical blast response at its contact point.
 * @param {Record<string, any>} event
 * @param {number} bodyX
 * @param {number} bodyZ
 * @param {number} bodyRadius
 */
function zeroImpulseResponse(event, bodyX, bodyZ, bodyRadius) {
  const dx = bodyX - event.originX;
  const dz = bodyZ - event.originZ;
  const centerDistance = Math.hypot(dx, dz);
  return {
    centerDistance,
    surfaceDistance: Math.max(0, centerDistance - bodyRadius),
    falloff: 0,
    projectedArea: Math.PI * bodyRadius * bodyRadius,
    impulse: 0,
    nx: centerDistance > 1e-9 ? dx / centerDistance : -event.nx,
    nz: centerDistance > 1e-9 ? dz / centerDistance : -event.nz,
    deltaVx: 0,
    deltaVz: 0,
  };
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
  if (code === BODY_ENEMY_WIZARD) return "enemyWizard";
  if (code === BODY_ENEMY_WIZARD_BODY) return "enemyWizardBody";
  return "cell";
}

/** @param {number} code */
function ownerKindName(code) {
  return code === PROJECTILE_OWNER_KIND.enemyWizard ? "enemyWizard" : "player";
}

/** @param {number} code */
function teamName(code) {
  if (code === ACTOR_TEAM.enemy) return "enemy";
  if (code === ACTOR_TEAM.player) return "player";
  return "neutral";
}

export class Simulation {
  /**
   * @param {{
   * seed?:unknown,
   * scenario?:ArenaScenario,
   * map?:GridMap,
   * rockCapacity?:number,
   * enemyCapacity?:number,
   * encounterMaximumAlive?:number,
   * useBroadphase?:boolean,
   * projectileCapacity?:number,
   * particleCapacity?:number,
   * particleBurstCount?:number,
   * particleProfile?:string,
   * particleBounce?:boolean,
   * particleWallCollision?:boolean,
   * initialFireballDefinition?:unknown,
   * spellBaseline?:Array<Record<string,any>>,
   * legacyFireballMode?:boolean,
   * gameplayProfile?:string,
   * enemyAiProfile?:string,
   * deadBodyProfile?:string,
   * movementSoundProfile?:string,
   * soundEventCapacity?:number,
   * dynamicDeadBodyCapacity?:number,
   * inertDeadBodyCapacity?:number
   * }} [options]
   */
  constructor(options = {}) {
    this.scenario = options.scenario?.clone()
      ?? (options.map ? new ArenaScenario(options.map) : createDebugArenaScenario());
    this.map = this.scenario.map;
    this.seed = normalizeSeed(options.seed ?? 0x1a2b3c4d);
    this.rng = new SeededRng(this.seed);
    this.gameplayProfile = options.gameplayProfile ?? GAMEPLAY_PROFILE_OBELISK_DUEL;
    if (
      this.gameplayProfile !== GAMEPLAY_PROFILE_OBELISK_DUEL
      && this.gameplayProfile !== GAMEPLAY_PROFILE_PRE_COMBAT
    ) {
      throw new RangeError(`Unsupported gameplay profile: ${this.gameplayProfile}`);
    }
    this.enemyAiProfile = options.enemyAiProfile
      ?? (this.gameplayProfile === GAMEPLAY_PROFILE_OBELISK_DUEL
        ? ENEMY_AI_PROFILE_INVESTIGATIVE
        : ENEMY_AI_PROFILE_NONE);
    if (
      this.enemyAiProfile !== ENEMY_AI_PROFILE_BASIC
      && this.enemyAiProfile !== ENEMY_AI_PROFILE_TACTICAL
      && this.enemyAiProfile !== ENEMY_AI_PROFILE_PERCEPTIVE
      && this.enemyAiProfile !== ENEMY_AI_PROFILE_INVESTIGATIVE
      && this.enemyAiProfile !== ENEMY_AI_PROFILE_NONE
    ) {
      throw new RangeError(`Unsupported enemy AI profile: ${this.enemyAiProfile}`);
    }
    if (!(
      (
        this.gameplayProfile === GAMEPLAY_PROFILE_OBELISK_DUEL
        && (
          this.enemyAiProfile === ENEMY_AI_PROFILE_BASIC
          || this.enemyAiProfile === ENEMY_AI_PROFILE_TACTICAL
          || this.enemyAiProfile === ENEMY_AI_PROFILE_PERCEPTIVE
          || this.enemyAiProfile === ENEMY_AI_PROFILE_INVESTIGATIVE
        )
      ) || (
        this.gameplayProfile === GAMEPLAY_PROFILE_PRE_COMBAT
        && this.enemyAiProfile === ENEMY_AI_PROFILE_NONE
      )
    )) {
      throw new RangeError("Gameplay and enemy AI profiles are incompatible");
    }
    this.deadBodyProfile = options.deadBodyProfile ?? DEAD_BODY_PROFILE_V1;
    if (
      this.deadBodyProfile !== DEAD_BODY_PROFILE_V1
      && this.deadBodyProfile !== DEAD_BODY_PROFILE_NONE
    ) {
      throw new RangeError(`Unsupported dead-body profile: ${this.deadBodyProfile}`);
    }
    this.movementSoundProfile = options.movementSoundProfile
      ?? MOVEMENT_SOUND_PROFILE_V1;
    if (
      this.movementSoundProfile !== MOVEMENT_SOUND_PROFILE_V1
      && this.movementSoundProfile !== MOVEMENT_SOUND_PROFILE_NONE
    ) {
      throw new RangeError(
        `Unsupported movement-sound profile: ${this.movementSoundProfile}`,
      );
    }
    const rockCapacity = options.rockCapacity ?? ROCK.capacity;
    if (!Number.isInteger(rockCapacity) || rockCapacity <= 0) {
      throw new RangeError("Rock capacity must be a positive integer");
    }
    if (this.scenario.entities.filter((entity) => entity.kind === "rock").length > rockCapacity) {
      throw new RangeError("Scenario has more rocks than the configured rock pool");
    }
    const defaultEnemyCapacity = usesPerceptionProfile(this.enemyAiProfile)
      ? ENEMY_WIZARD.capacity
      : ENEMY_WIZARD.legacyCapacity;
    const enemyCapacity = options.enemyCapacity ?? defaultEnemyCapacity;
    if (
      !Number.isInteger(enemyCapacity)
      || enemyCapacity <= 0
      || enemyCapacity > ENEMY_WIZARD.capacity
    ) {
      throw new RangeError(`Enemy capacity must be between 1 and ${ENEMY_WIZARD.capacity}`);
    }
    const encounterMaximumAlive = options.encounterMaximumAlive
      ?? Math.min(ENEMY_WIZARD.encounterMaximumAlive, enemyCapacity);
    if (
      !Number.isInteger(encounterMaximumAlive)
      || encounterMaximumAlive <= 0
      || encounterMaximumAlive > enemyCapacity
    ) {
      throw new RangeError("Encounter maximum alive must fit the enemy pool");
    }
    this.encounterMaximumAlive = encounterMaximumAlive;
    const dynamicDeadBodyCapacity = options.dynamicDeadBodyCapacity
      ?? DEAD_BODY.dynamicCapacity;
    if (
      !Number.isInteger(dynamicDeadBodyCapacity)
      || dynamicDeadBodyCapacity <= 0
      || dynamicDeadBodyCapacity > DEAD_BODY.maximumDynamicCapacity
    ) {
      throw new RangeError(
        `Dynamic dead-body capacity must be between 1 and ${DEAD_BODY.maximumDynamicCapacity}`,
      );
    }
    const inertDeadBodyCapacity = options.inertDeadBodyCapacity
      ?? DEAD_BODY.inertCapacity;
    if (
      !Number.isInteger(inertDeadBodyCapacity)
      || inertDeadBodyCapacity <= 0
      || inertDeadBodyCapacity > DEAD_BODY.maximumInertCapacity
    ) {
      throw new RangeError(
        `Inert dead-body capacity must be between 1 and ${DEAD_BODY.maximumInertCapacity}`,
      );
    }
    this.rocks = new RockPool(rockCapacity);
    this.enemies = new EnemyWizardPool(enemyCapacity);
    this.dynamicDeadBodies = new DynamicDeadBodyPool(dynamicDeadBodyCapacity);
    this.inertDeadBodies = new InertDeadBodyRing(inertDeadBodyCapacity);
    this.mapRevision = 1;
    this.navigationField = new SharedNavigationField(this.map);
    this.destinationFields = new DestinationFieldCache(this.map);
    this.reachability = new GridReachability(this.map);
    this.projectiles = new ProjectilePool(options.projectileCapacity ?? PROJECTILE.capacity);
    const soundEventCapacity = options.soundEventCapacity
      ?? (this.movementSoundProfile === MOVEMENT_SOUND_PROFILE_V1
        ? this.projectiles.capacity + 1
        : 1);
    if (
      !Number.isInteger(soundEventCapacity)
      || soundEventCapacity <= 0
    ) {
      throw new RangeError("Sound-event capacity must be a positive integer");
    }
    this.soundEvents = new SoundEventQueue(soundEventCapacity);
    this.broadphase = new MapCellBroadphase(this.map, {
      enemyCapacity,
      rockCapacity,
      projectileCapacity: this.projectiles.capacity,
      deadBodyCapacity: dynamicDeadBodyCapacity,
      enabled: options.useBroadphase,
    });
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
    this.combatEvents = new RingBuffer(COMBAT.eventCapacity);
    this.combatEventDropped = 0;
    this.perceptionEvents = new RingBuffer(PERCEPTIVE_WIZARD.perceptionEventCapacity);
    this.perceptionEventDropped = 0;
    this.soundEventHistory = new RingBuffer(MOVEMENT_SOUND.historyCapacity);
    this.soundEventHistoryDropped = 0;
    this.soundEventMetrics = {
      emittedFootsteps: 0,
      emittedFireballImpacts: 0,
      heardFootsteps: 0,
      heardFireballImpacts: 0,
      listenerChecks: 0,
    };
    this.investigationEventMetrics = {
      projectileObservations: 0,
      heardExplosions: 0,
      heardFootsteps: 0,
      acceptedRedirects: 0,
      deduplicated: 0,
      priorityRejected: 0,
    };
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
    this.commandLogGameplayProfile = this.gameplayProfile;
    this.commandLogEnemyAiProfile = this.enemyAiProfile;
    this.commandLogDeadBodyProfile = this.deadBodyProfile;
    this.commandLogMovementSoundProfile = this.movementSoundProfile;
    this.commandLogSoundEventCapacity = this.soundEvents.capacity;
    this.commandLogEnemyCapacity = this.enemies.capacity;
    this.commandLogEncounterMaximumAlive = this.encounterMaximumAlive;
    this.commandLogDynamicDeadBodyCapacity = this.dynamicDeadBodies.capacity;
    this.commandLogInertDeadBodyCapacity = this.inertDeadBodies.capacity;
    this.tickCount = 0;
    this.nextExplosionId = 1;
    this.levelState = "running";
    this.defeatedTicksRemaining = 0;
    this.encounter = {
      enabled: false,
      nextSpawnTick: 1,
      spawnCursor: 0,
      attempts: 0,
      successfulSpawns: 0,
      skippedBlocked: 0,
      skippedCapped: 0,
      nextSpawnSequence: 1,
    };
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
      team: "player",
      health: COMBAT.maximumHealth,
      maximumHealth: COMBAT.maximumHealth,
      damageFreeTicks: 0,
      lastDamageTick: 0,
      movementMode: PLAYER_MOVEMENT_IDLE,
      movementTargetDistance: 0,
      movementDirectionX: 1,
      movementDirectionZ: 0,
      runningStrideProgress: 0,
      runningNextFootstepDistance: MOVEMENT_SOUND.firstFootstepMeters,
      lastFootstepHeadingX: 1,
      lastFootstepHeadingZ: 0,
      lastFootstepTick: 0,
      runningStartTick: 0,
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
    this._secondDynamicBodyVelocity = { vx: 0, vz: 0, inverseMass: 0 };
    this._enemyBodyVelocity = {
      vx: 0,
      vz: 0,
      desiredVx: 0,
      desiredVz: 0,
      locomotionVx: 0,
      locomotionVz: 0,
      externalVx: 0,
      externalVz: 0,
      inverseMass: 0,
    };
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
    this.mapRevision = 1;
    this.#restoreAuthoredState();
    this.impactEvents.clear();
    this.combatEvents.clear();
    this.combatEventDropped = 0;
    this.perceptionEvents.clear();
    this.perceptionEventDropped = 0;
    this.#clearSoundEventHistory();
    this.investigationEventMetrics.projectileObservations = 0;
    this.investigationEventMetrics.heardExplosions = 0;
    this.investigationEventMetrics.heardFootsteps = 0;
    this.investigationEventMetrics.acceptedRedirects = 0;
    this.investigationEventMetrics.deduplicated = 0;
    this.investigationEventMetrics.priorityRejected = 0;
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
      this.commandLogGameplayProfile = this.gameplayProfile;
      this.commandLogEnemyAiProfile = this.enemyAiProfile;
      this.commandLogDeadBodyProfile = this.deadBodyProfile;
      this.commandLogMovementSoundProfile = this.movementSoundProfile;
      this.commandLogSoundEventCapacity = this.soundEvents.capacity;
      this.commandLogEnemyCapacity = this.enemies.capacity;
      this.commandLogEncounterMaximumAlive = this.encounterMaximumAlive;
      this.commandLogDynamicDeadBodyCapacity = this.dynamicDeadBodies.capacity;
      this.commandLogInertDeadBodyCapacity = this.inertDeadBodies.capacity;
    }
    this.lastError = null;
    this.lastSpellResult = null;
  }

  #restoreAuthoredState() {
    this.projectiles.reset();
    this.particles.reset();
    this.rocks.reset();
    this.enemies.reset();
    this.dynamicDeadBodies.reset();
    this.inertDeadBodies.reset();
    this.soundEvents.reset();
    this.navigationField.reset(this.map);
    this.destinationFields.reset(this.map);
    this.reachability.reset(this.map);
    this.broadphase.reset(this.map);
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
      health: COMBAT.maximumHealth,
      maximumHealth: COMBAT.maximumHealth,
      damageFreeTicks: 0,
      lastDamageTick: 0,
      movementMode: PLAYER_MOVEMENT_IDLE,
      movementTargetDistance: 0,
      movementDirectionX: 1,
      movementDirectionZ: 0,
      runningStrideProgress: 0,
      runningNextFootstepDistance: MOVEMENT_SOUND.firstFootstepMeters,
      lastFootstepHeadingX: 1,
      lastFootstepHeadingZ: 0,
      lastFootstepTick: 0,
      runningStartTick: 0,
    });
    this.levelState = "running";
    this.defeatedTicksRemaining = 0;
    Object.assign(this.encounter, {
      enabled: this.gameplayProfile === GAMEPLAY_PROFILE_OBELISK_DUEL
        && (
          this.enemyAiProfile === ENEMY_AI_PROFILE_BASIC
          || this.enemyAiProfile === ENEMY_AI_PROFILE_TACTICAL
          || this.enemyAiProfile === ENEMY_AI_PROFILE_PERCEPTIVE
          || this.enemyAiProfile === ENEMY_AI_PROFILE_INVESTIGATIVE
        )
        && Boolean(this.scenario.obelisk),
      nextSpawnTick: this.tickCount + 1,
      spawnCursor: 0,
      attempts: 0,
      successfulSpawns: 0,
      skippedBlocked: 0,
      skippedCapped: 0,
      nextSpawnSequence: 1,
    });
    for (const entity of this.scenario.entities) {
      if (entity.kind !== "rock") continue;
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
    this.soundEvents.beginTick();
    this.contacts.count = 0;
    const startedDefeated = this.levelState === "defeated";
    this.#applyActions(command.actions, startedDefeated);
    if (startedDefeated && this.levelState !== "defeated") {
      return this.tickCount;
    }
    if (startedDefeated) {
      if (this.#advanceDefeat()) return this.tickCount;
      this.tickCount += 1;
      this.#recordCommand(command);
      return this.tickCount;
    }
    const simulationTick = this.tickCount + 1;
    this.#encounterSystem(simulationTick);
    if (this.enemyAiProfile === ENEMY_AI_PROFILE_INVESTIGATIVE) {
      this.broadphase.rebuild(
        this.enemies,
        this.rocks,
        this.projectiles,
        this.dynamicDeadBodies,
      );
      this.#investigativePerceptionSystem(simulationTick);
    } else if (this.enemyAiProfile === ENEMY_AI_PROFILE_PERCEPTIVE) {
      this.#perceptionSystem(simulationTick);
    }
    this.#navigationSystem();
    this.#prepareMovement(command.move, SIMULATION.dt, simulationTick);
    this.#prepareEnemyMovement(SIMULATION.dt, simulationTick);
    if (usesPerceptionProfile(this.enemyAiProfile)) {
      this.#facingSystem(simulationTick);
    }
    this.#bodyPhysicsSystem(SIMULATION.dt);
    this.#movementSoundSystem(simulationTick);
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
    for (let index = 0; index < this.enemies.activeCount; index += 1) {
      this.enemies.cooldown[index] = approach(
        this.enemies.cooldown[index],
        0,
        SIMULATION.dt,
      );
    }
    this.#castSystem(command.cast);
    this.#enemyCastSystem(simulationTick);
    this.#projectileSystem(SIMULATION.dt);
    if (this.movementSoundProfile === MOVEMENT_SOUND_PROFILE_V1) {
      this.#deliverQueuedSoundEvents();
    }
    this.#advanceDeadBodyLifecycle(simulationTick);
    this.#transferDeadEnemies(simulationTick);
    this.#particleSystem(SIMULATION.dt);
    this.#healthRegenerationSystem(simulationTick);
    this.#pruneSpellRevisions();
    this.tickCount += 1;
    this.#recordCommand(command);
    return this.tickCount;
  }

  /** @param {ReturnType<typeof canonicalizeCommand>} command */
  #recordCommand(command) {
    if (this.commandLog.length === this.commandLog.capacity) this.commandLogDropped += 1;
    this.commandLog.push({ tick: this.tickCount, command });
  }

  /** @param {Array<Record<string, unknown>>} actions @param {boolean} [defeatedOnly] */
  #applyActions(actions, defeatedOnly = false) {
    for (const action of actions) {
      if (
        defeatedOnly
        && action.type !== "reset"
        && action.type !== "applySpellDefinition"
        && action.type !== "clearSpellEffects"
      ) {
        continue;
      }
      try {
        if (action.type === "reset") {
          this.reset(action.seed);
        } else if (action.type === "restoreScenario") {
          this.#restoreAuthoredState();
          this.impactEvents.clear();
          this.combatEvents.clear();
          this.combatEventDropped = 0;
          this.perceptionEvents.clear();
          this.perceptionEventDropped = 0;
          this.#clearSoundEventHistory();
        } else if (action.type === "setTile") {
          if (!this.#setTile(action.cx, action.cz, action.tile)) {
            throw new RangeError("Tile would overlap an authored or active body");
          }
        } else if (action.type === "loadScenario") {
          const loadedScenario = ArenaScenario.fromJSON(action.json);
          if (
            loadedScenario.entities.filter((entity) => entity.kind === "rock").length
            > this.rocks.capacity
          ) {
            throw new RangeError("Scenario has more rocks than the configured rock pool");
          }
          this.scenario = loadedScenario;
          this.map = loadedScenario.map;
          this.mapRevision += 1;
          this.#restoreAuthoredState();
          this.impactEvents.clear();
          this.combatEvents.clear();
          this.combatEventDropped = 0;
          this.perceptionEvents.clear();
          this.perceptionEventDropped = 0;
          this.#clearSoundEventHistory();
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
    if (tile !== 1) {
      if (previous !== tile) this.mapRevision += 1;
      return true;
    }
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
    for (let index = 0; index < this.enemies.activeCount; index += 1) {
      if (
        firstSolidContact(
          this.map,
          this.enemies.x[index],
          this.enemies.z[index],
          this.enemies.radius[index],
          this._gridContact,
        )
      ) {
        this.map.set(cx, cz, previous);
        return false;
      }
    }
    for (let index = 0; index < this.dynamicDeadBodies.activeCount; index += 1) {
      if (
        firstSolidContact(
          this.map,
          this.dynamicDeadBodies.x[index],
          this.dynamicDeadBodies.z[index],
          this.dynamicDeadBodies.radius[index],
          this._gridContact,
        )
      ) {
        this.map.set(cx, cz, previous);
        return false;
      }
    }
    if (previous !== tile) this.mapRevision += 1;
    return true;
  }

  #advanceDefeat() {
    this.defeatedTicksRemaining = Math.max(0, this.defeatedTicksRemaining - 1);
    if (this.defeatedTicksRemaining > 0) return false;
    const seed = this.seed;
    this.reset(seed);
    return true;
  }

  /** @param {Record<string, any>} event */
  #recordCombatEvent(event) {
    if (this.combatEvents.length === this.combatEvents.capacity) {
      this.combatEventDropped += 1;
    }
    this.combatEvents.push(event);
  }

  #clearSoundEventHistory() {
    this.soundEventHistory.clear();
    this.soundEventHistoryDropped = 0;
    this.soundEventMetrics.emittedFootsteps = 0;
    this.soundEventMetrics.emittedFireballImpacts = 0;
    this.soundEventMetrics.heardFootsteps = 0;
    this.soundEventMetrics.heardFireballImpacts = 0;
    this.soundEventMetrics.listenerChecks = 0;
  }

  /** @param {string} type @param {number} index @param {number} tick @param {Record<string,any>} [details] */
  #recordPerceptionEvent(type, index, tick, details = {}) {
    if (this.perceptionEvents.length === this.perceptionEvents.capacity) {
      this.perceptionEventDropped += 1;
    }
    this.perceptionEvents.push({
      type,
      tick,
      enemy: {
        kind: "enemyWizard",
        id: this.enemies.id[index],
        spawnSequence: this.enemies.spawnSequence[index],
      },
      ...details,
    });
  }

  /** @param {number} index */
  #clearCandidate(index) {
    const pool = this.enemies;
    pool.candidateTargetKind[index] = TARGET_KIND.none;
    pool.candidateTargetId[index] = 0;
    pool.candidateTargetTeam[index] = 0;
    pool.exposureStartTick[index] = 0;
    pool.exposureProgress[index] = 0;
  }

  /** @param {number} index */
  #clearSearchGoal(index) {
    const pool = this.enemies;
    pool.hasSearchGoal[index] = 0;
    pool.searchGoalX[index] = Number.NaN;
    pool.searchGoalZ[index] = Number.NaN;
    pool.searchGoalCx[index] = -1;
    pool.searchGoalCz[index] = -1;
    pool.searchGoalStartTick[index] = 0;
  }

  /** @param {number} index */
  #clearInvestigation(index) {
    const pool = this.enemies;
    pool.investigationSource[index] = KNOWLEDGE_SOURCE.none;
    pool.investigationPriority[index] = INVESTIGATION_PRIORITY.none;
    pool.investigationAnchorX[index] = Number.NaN;
    pool.investigationAnchorZ[index] = Number.NaN;
    pool.investigationObservationTick[index] = 0;
    pool.investigationAcceptedTick[index] = 0;
    pool.investigationEffectId[index] = 0;
    pool.investigationProjectileId[index] = 0;
    pool.investigationSoundEventId[index] = 0;
    pool.investigationSoundKind[index] = SOUND_EVENT_KIND.none;
    pool.investigationSoundRadius[index] = 0;
    pool.investigationProjectileX[index] = Number.NaN;
    pool.investigationProjectileZ[index] = Number.NaN;
    pool.investigationProjectileVx[index] = 0;
    pool.investigationProjectileVz[index] = 0;
    pool.investigationProjectileAge[index] = 0;
    pool.investigationOriginX[index] = Number.NaN;
    pool.investigationOriginZ[index] = Number.NaN;
  }

  /** @param {number} index @param {Record<string,any>} clue */
  #updateProjectileInvestigationDiagnostic(index, clue) {
    if (clue.source !== KNOWLEDGE_SOURCE.projectile || !clue.projectile) return;
    const pool = this.enemies;
    pool.investigationObservationTick[index] = Number(clue.observationTick) >>> 0;
    pool.investigationProjectileX[index] = Number(clue.projectile.x);
    pool.investigationProjectileZ[index] = Number(clue.projectile.z);
    pool.investigationProjectileVx[index] = Number(clue.projectile.vx);
    pool.investigationProjectileVz[index] = Number(clue.projectile.vz);
    pool.investigationProjectileAge[index] = Number(clue.projectile.age);
    pool.investigationOriginX[index] = Number(clue.inferredOrigin?.x);
    pool.investigationOriginZ[index] = Number(clue.inferredOrigin?.z);
  }

  /**
   * The only v9 entry point that may redirect a wizard to an indirect clue.
   * @param {number} index
   * @param {number} tick
   * @param {Record<string,any>} clue
   * @param {{state?:number,immediateSearch?:boolean}} [options]
   */
  #acceptInvestigationClue(index, tick, clue, options = {}) {
    const pool = this.enemies;
    const current = {
      priority: pool.investigationPriority[index],
      observationTick: pool.investigationObservationTick[index],
      effectId: pool.investigationEffectId[index],
      projectileId: pool.investigationProjectileId[index],
      soundEventId: pool.investigationSoundEventId[index],
    };
    let arbitration = arbitrateInvestigationClue(current, clue);
    if (
      arbitration.decision !== INVESTIGATION_DECISION.deduplicate
      && pool.currentVisibility[index]
    ) {
      arbitration = arbitrateInvestigationClue({
        priority: INVESTIGATION_PRIORITY.directSight,
        observationTick: tick,
        effectId: 0,
        projectileId: 0,
      }, clue);
    }
    if (arbitration.decision === INVESTIGATION_DECISION.deduplicate) {
      this.investigationEventMetrics.deduplicated += 1;
      this.#updateProjectileInvestigationDiagnostic(index, clue);
      this.#recordPerceptionEvent("investigation-deduplicated", index, tick, {
        reason: arbitration.reason,
        source: KNOWLEDGE_SOURCE_NAMES[clue.source] ?? "none",
        effectId: Number(clue.effectId) >>> 0 || null,
        projectileId: Number(clue.projectileId) >>> 0 || null,
        soundEventId: Number(clue.soundEventId) >>> 0 || null,
      });
      return arbitration;
    }
    if (arbitration.decision !== INVESTIGATION_DECISION.accept) {
      this.investigationEventMetrics.priorityRejected += 1;
      this.#recordPerceptionEvent("investigation-rejected", index, tick, {
        reason: arbitration.reason,
        decision: arbitration.decision,
        source: KNOWLEDGE_SOURCE_NAMES[clue.source] ?? "none",
        priority: Number(clue.priority) || 0,
        activePriority: pool.currentVisibility[index]
          ? INVESTIGATION_PRIORITY.directSight
          : pool.investigationPriority[index],
        effectId: Number(clue.effectId) >>> 0 || null,
        projectileId: Number(clue.projectileId) >>> 0 || null,
        soundEventId: Number(clue.soundEventId) >>> 0 || null,
      });
      return arbitration;
    }

    const previous = {
      source: KNOWLEDGE_SOURCE_NAMES[pool.investigationSource[index]] ?? "none",
      priority: pool.investigationPriority[index],
      anchor: Number.isFinite(pool.investigationAnchorX[index])
        && Number.isFinite(pool.investigationAnchorZ[index])
        ? {
          x: pool.investigationAnchorX[index],
          z: pool.investigationAnchorZ[index],
        }
        : null,
    };
    const anchorX = Number(clue.anchor?.x);
    const anchorZ = Number(clue.anchor?.z);
    pool.investigationSource[index] = Number(clue.source) || KNOWLEDGE_SOURCE.none;
    pool.investigationPriority[index] = Number(clue.priority) || 0;
    pool.investigationAnchorX[index] = anchorX;
    pool.investigationAnchorZ[index] = anchorZ;
    pool.investigationObservationTick[index] = Number(clue.observationTick) >>> 0;
    pool.investigationAcceptedTick[index] = tick;
    pool.investigationEffectId[index] = Number(clue.effectId) >>> 0;
    pool.investigationProjectileId[index] = Number(clue.projectileId) >>> 0;
    pool.investigationSoundEventId[index] = Number(clue.soundEventId) >>> 0;
    pool.investigationSoundKind[index] = Number(clue.soundKind) || SOUND_EVENT_KIND.none;
    pool.investigationSoundRadius[index] = Math.max(0, Number(clue.soundRadius) || 0);
    pool.investigationProjectileX[index] = Number.NaN;
    pool.investigationProjectileZ[index] = Number.NaN;
    pool.investigationProjectileVx[index] = 0;
    pool.investigationProjectileVz[index] = 0;
    pool.investigationProjectileAge[index] = 0;
    pool.investigationOriginX[index] = Number.NaN;
    pool.investigationOriginZ[index] = Number.NaN;
    this.#updateProjectileInvestigationDiagnostic(index, clue);
    pool.knowledgeSource[index] = pool.investigationSource[index];
    pool.hasStimulus[index] = 1;
    pool.stimulusX[index] = anchorX;
    pool.stimulusZ[index] = anchorZ;
    pool.stimulusTick[index] = Number(clue.observationTick) >>> 0;
    pool.guardReturnStartTick[index] = 0;
    pool.guardUnreachableStartTick[index] = 0;
    this.#clearCandidate(index);
    const state = options.state ?? PERCEPTION_STATE.investigating;
    if (options.immediateSearch) {
      this.#beginSearch(
        index,
        tick,
        anchorX,
        anchorZ,
        KNOWLEDGE_SOURCE_NAMES[clue.source] ?? "investigation",
        state,
      );
    } else {
      pool.perceptionState[index] = state;
      pool.huntPhase[index] = HUNT_PHASE.travel;
      pool.huntAnchorX[index] = anchorX;
      pool.huntAnchorZ[index] = anchorZ;
      pool.huntTravelStartTick[index] = tick;
      pool.searchStartTick[index] = 0;
      pool.searchEndTick[index] = 0;
      pool.searchSequence[index] = 0;
      this.#clearSearchGoal(index);
    }
    this.investigationEventMetrics.acceptedRedirects += 1;
    this.#recordPerceptionEvent("investigation-redirect", index, tick, {
      reason: arbitration.reason,
      previous,
      source: KNOWLEDGE_SOURCE_NAMES[clue.source] ?? "none",
      priority: Number(clue.priority) || 0,
      anchor: { x: anchorX, z: anchorZ },
      observationTick: Number(clue.observationTick) >>> 0,
      effectId: Number(clue.effectId) >>> 0 || null,
      projectileId: Number(clue.projectileId) >>> 0 || null,
      soundEventId: Number(clue.soundEventId) >>> 0 || null,
    });
    return arbitration;
  }

  /** @param {number} index @param {number} tick */
  #updateLastSeen(index, tick) {
    const pool = this.enemies;
    pool.hasLastSeen[index] = 1;
    pool.lastSeenX[index] = this.player.x;
    pool.lastSeenZ[index] = this.player.z;
    pool.lastSeenVx[index] = this.player.vx;
    pool.lastSeenVz[index] = this.player.vz;
    pool.lastSeenTick[index] = tick;
    pool.knowledgeSource[index] = KNOWLEDGE_SOURCE.visual;
    if (
      this.enemyAiProfile !== ENEMY_AI_PROFILE_INVESTIGATIVE
      || pool.investigationPriority[index] === INVESTIGATION_PRIORITY.none
    ) {
      pool.hasStimulus[index] = 0;
      pool.stimulusX[index] = Number.NaN;
      pool.stimulusZ[index] = Number.NaN;
      pool.stimulusTick[index] = 0;
    }
  }

  /** @param {number} index @param {number} tick @param {string} reason */
  #clearAwareness(index, tick, reason) {
    const pool = this.enemies;
    pool.perceptionState[index] = PERCEPTION_STATE.unaware;
    pool.knowledgeSource[index] = KNOWLEDGE_SOURCE.none;
    pool.currentVisibility[index] = 0;
    pool.confirmedTargetKind[index] = TARGET_KIND.none;
    pool.confirmedTargetId[index] = 0;
    pool.confirmedTargetTeam[index] = 0;
    this.#clearCandidate(index);
    pool.hasLastSeen[index] = 0;
    pool.lastSeenX[index] = Number.NaN;
    pool.lastSeenZ[index] = Number.NaN;
    pool.lastSeenVx[index] = 0;
    pool.lastSeenVz[index] = 0;
    pool.lastSeenTick[index] = 0;
    pool.huntPhase[index] = HUNT_PHASE.none;
    pool.huntAnchorX[index] = Number.NaN;
    pool.huntAnchorZ[index] = Number.NaN;
    pool.huntTravelStartTick[index] = 0;
    pool.searchStartTick[index] = 0;
    pool.searchEndTick[index] = 0;
    pool.searchSequence[index] = 0;
    pool.hasStimulus[index] = 0;
    pool.stimulusX[index] = Number.NaN;
    pool.stimulusZ[index] = Number.NaN;
    pool.stimulusTick[index] = 0;
    if (this.enemyAiProfile === ENEMY_AI_PROFILE_INVESTIGATIVE) {
      this.#clearInvestigation(index);
    }
    pool.guardReturnStartTick[index] = 0;
    pool.guardUnreachableStartTick[index] = 0;
    pool.navigationSlot[index] = -1;
    this.#clearSearchGoal(index);
    this.#recordPerceptionEvent("awareness-clear", index, tick, { reason });
  }

  /** @param {number} index @param {number} tick @param {string} reason */
  #beginReturn(index, tick, reason) {
    const pool = this.enemies;
    const wasReturning = pool.perceptionState[index] === PERCEPTION_STATE.returning;
    pool.perceptionState[index] = PERCEPTION_STATE.returning;
    pool.huntPhase[index] = HUNT_PHASE.none;
    pool.guardReturnStartTick[index] = tick;
    pool.guardUnreachableStartTick[index] = 0;
    this.#clearSearchGoal(index);
    if (!wasReturning) {
      this.#recordPerceptionEvent("return", index, tick, {
        reason,
        guard: { x: pool.guardX[index], z: pool.guardZ[index] },
      });
    }
  }

  /** @param {number} index @param {number} tick */
  #chooseSearchGoal(index, tick) {
    const pool = this.enemies;
    const startCx = Math.floor(pool.x[index]);
    const startCz = Math.floor(pool.z[index]);
    this.reachability.fill(this.map, startCx, startCz);
    const anchorCx = Math.floor(pool.huntAnchorX[index]);
    const anchorCz = Math.floor(pool.huntAnchorZ[index]);
    const candidateCount = 8 * (
      PERCEPTIVE_WIZARD.searchMaximumRadiusCells
      - PERCEPTIVE_WIZARD.searchMinimumRadiusCells
      + 1
    );
    this.#clearSearchGoal(index);
    for (let checked = 0; checked < candidateCount; checked += 1) {
      const sequence = pool.searchSequence[index];
      const candidate = searchCandidate(
        this.seed,
        pool.spawnSequence[index],
        anchorCx,
        anchorCz,
        sequence,
      );
      pool.searchSequence[index] = (sequence + 1) & 0xffff;
      if (!this.reachability.has(candidate.cx, candidate.cz)) continue;
      if (candidate.cx === startCx && candidate.cz === startCz) continue;
      pool.hasSearchGoal[index] = 1;
      pool.searchGoalX[index] = candidate.x;
      pool.searchGoalZ[index] = candidate.z;
      pool.searchGoalCx[index] = candidate.cx;
      pool.searchGoalCz[index] = candidate.cz;
      pool.searchGoalStartTick[index] = tick;
      return true;
    }
    pool.searchGoalStartTick[index] = tick;
    return false;
  }

  /** @param {number} index @param {number} tick @param {number} anchorX @param {number} anchorZ @param {string} reason @param {number} [state] */
  #beginSearch(index, tick, anchorX, anchorZ, reason, state = PERCEPTION_STATE.hunting) {
    const pool = this.enemies;
    pool.perceptionState[index] = state;
    pool.huntPhase[index] = HUNT_PHASE.search;
    pool.huntAnchorX[index] = anchorX;
    pool.huntAnchorZ[index] = anchorZ;
    pool.searchStartTick[index] = tick;
    pool.searchEndTick[index] = tick + PERCEPTIVE_WIZARD.searchTicks;
    pool.searchSequence[index] = 0;
    this.#chooseSearchGoal(index, tick);
    this.#recordPerceptionEvent("search", index, tick, {
      reason,
      anchor: { x: anchorX, z: anchorZ },
      endTick: pool.searchEndTick[index],
    });
  }

  /** @param {number} index @param {number} tick */
  #beginHuntAfterLoss(index, tick) {
    const pool = this.enemies;
    pool.perceptionState[index] = PERCEPTION_STATE.hunting;
    pool.huntPhase[index] = HUNT_PHASE.travel;
    pool.huntAnchorX[index] = pool.lastSeenX[index];
    pool.huntAnchorZ[index] = pool.lastSeenZ[index];
    pool.huntTravelStartTick[index] = tick;
    pool.searchStartTick[index] = 0;
    pool.searchEndTick[index] = 0;
    this.#clearSearchGoal(index);
    this.#recordPerceptionEvent("loss", index, tick, {
      lastSeen: {
        x: pool.lastSeenX[index],
        z: pool.lastSeenZ[index],
        tick: pool.lastSeenTick[index],
      },
    });
  }

  /** @param {number} index @param {number} tick */
  #beginInvestigativeHuntAfterLoss(index, tick) {
    const pool = this.enemies;
    const result = this.#acceptInvestigationClue(index, tick, {
      source: KNOWLEDGE_SOURCE.visual,
      priority: INVESTIGATION_PRIORITY.lastSeen,
      anchor: { x: pool.lastSeenX[index], z: pool.lastSeenZ[index] },
      observationTick: pool.lastSeenTick[index],
      effectId: 0,
      projectileId: 0,
    }, { state: PERCEPTION_STATE.hunting });
    if (result.decision === INVESTIGATION_DECISION.accept) {
      this.#recordPerceptionEvent("loss", index, tick, {
        lastSeen: {
          x: pool.lastSeenX[index],
          z: pool.lastSeenZ[index],
          tick: pool.lastSeenTick[index],
        },
      });
      return;
    }
    if (pool.investigationPriority[index] > INVESTIGATION_PRIORITY.lastSeen) {
      pool.perceptionState[index] = PERCEPTION_STATE.investigating;
      pool.knowledgeSource[index] = pool.investigationSource[index];
      if (pool.huntPhase[index] === HUNT_PHASE.none) {
        pool.huntPhase[index] = HUNT_PHASE.travel;
        pool.huntAnchorX[index] = pool.investigationAnchorX[index];
        pool.huntAnchorZ[index] = pool.investigationAnchorZ[index];
        pool.huntTravelStartTick[index] = pool.investigationAcceptedTick[index];
      }
      this.#clearCandidate(index);
      this.#recordPerceptionEvent("loss", index, tick, {
        resumedInvestigation: true,
        source: KNOWLEDGE_SOURCE_NAMES[pool.investigationSource[index]] ?? "none",
        priority: pool.investigationPriority[index],
      });
    }
  }

  /** @param {number} index @param {number} tick */
  #confirmPlayer(index, tick) {
    const pool = this.enemies;
    const retainInvestigation = this.enemyAiProfile === ENEMY_AI_PROFILE_INVESTIGATIVE
      && pool.investigationPriority[index] > INVESTIGATION_PRIORITY.none;
    pool.perceptionState[index] = PERCEPTION_STATE.engaged;
    pool.knowledgeSource[index] = KNOWLEDGE_SOURCE.visual;
    pool.confirmedTargetKind[index] = TARGET_KIND.player;
    pool.confirmedTargetId[index] = this.player.id;
    pool.confirmedTargetTeam[index] = ACTOR_TEAM.player;
    if (!retainInvestigation) pool.huntPhase[index] = HUNT_PHASE.none;
    pool.guardReturnStartTick[index] = 0;
    pool.guardUnreachableStartTick[index] = 0;
    this.#clearCandidate(index);
    pool.exposureStartTick[index] = Math.max(0, tick - PERCEPTIVE_WIZARD.exposureTicks);
    pool.exposureProgress[index] = PERCEPTIVE_WIZARD.exposureTicks;
    if (!retainInvestigation) this.#clearSearchGoal(index);
    this.#updateLastSeen(index, tick);
  }

  /** @param {number} simulationTick */
  #perceptionSystem(simulationTick) {
    const pool = this.enemies;
    for (let index = 0; index < pool.activeCount; index += 1) {
      let state = pool.perceptionState[index];
      if (
        state === PERCEPTION_STATE.unaware
        && Math.hypot(
          pool.x[index] - pool.guardX[index],
          pool.z[index] - pool.guardZ[index],
        ) > PERCEPTIVE_WIZARD.guardReturnDistanceMeters
      ) {
        this.#beginReturn(index, simulationTick, "displaced");
        state = pool.perceptionState[index];
      }

      if (state === PERCEPTION_STATE.hunting) {
        if (pool.huntPhase[index] === HUNT_PHASE.travel) {
          const arrived = Math.hypot(
            pool.x[index] - pool.huntAnchorX[index],
            pool.z[index] - pool.huntAnchorZ[index],
          ) <= PERCEPTIVE_WIZARD.lastSeenArrivalMeters;
          const timedOut = simulationTick - pool.huntTravelStartTick[index]
            >= PERCEPTIVE_WIZARD.travelTimeoutTicks;
          if (arrived || timedOut) {
            this.#beginSearch(
              index,
              simulationTick,
              pool.huntAnchorX[index],
              pool.huntAnchorZ[index],
              arrived ? "last-seen-arrival" : "travel-timeout",
            );
          }
        } else if (pool.huntPhase[index] === HUNT_PHASE.search) {
          if (simulationTick >= pool.searchEndTick[index]) {
            this.#beginReturn(index, simulationTick, "search-complete");
          } else {
            const arrived = pool.hasSearchGoal[index]
              && Math.hypot(
                pool.x[index] - pool.searchGoalX[index],
                pool.z[index] - pool.searchGoalZ[index],
              ) <= PERCEPTIVE_WIZARD.lastSeenArrivalMeters;
            const timedOut = simulationTick - pool.searchGoalStartTick[index]
              >= PERCEPTIVE_WIZARD.searchGoalTimeoutTicks;
            if (arrived || timedOut) this.#chooseSearchGoal(index, simulationTick);
          }
        }
        state = pool.perceptionState[index];
      }

      if (state === PERCEPTION_STATE.returning) {
        const arrived = Math.hypot(
          pool.x[index] - pool.guardX[index],
          pool.z[index] - pool.guardZ[index],
        ) <= PERCEPTIVE_WIZARD.guardReturnDistanceMeters;
        if (arrived) {
          this.#clearAwareness(index, simulationTick, "guard-arrival");
        } else {
          const slot = pool.navigationSlot[index];
          const cx = Math.floor(pool.x[index]);
          const cz = Math.floor(pool.z[index]);
          const unreachable = this.destinationFields.isCurrent(slot, this.mapRevision)
            && this.destinationFields.rawCostAt(slot, cx, cz) === NAVIGATION_UNREACHABLE;
          if (!unreachable) {
            pool.guardUnreachableStartTick[index] = 0;
          } else if (pool.guardUnreachableStartTick[index] === 0) {
            pool.guardUnreachableStartTick[index] = simulationTick;
          } else if (
            simulationTick - pool.guardUnreachableStartTick[index]
            >= PERCEPTIVE_WIZARD.travelTimeoutTicks
          ) {
            pool.guardX[index] = this.map.get(cx, cz) === 0 ? cx + 0.5 : pool.x[index];
            pool.guardZ[index] = this.map.get(cx, cz) === 0 ? cz + 0.5 : pool.z[index];
            pool.guardBaseFacingX[index] = pool.facingX[index];
            pool.guardBaseFacingZ[index] = pool.facingZ[index];
            this.#recordPerceptionEvent("return", index, simulationTick, {
              reason: "guard-rebased",
              guard: { x: pool.guardX[index], z: pool.guardZ[index] },
            });
            this.#clearAwareness(index, simulationTick, "guard-rebased");
          }
        }
      }

      if (
        simulationTick % PERCEPTIVE_WIZARD.perceptionLanes
        !== pool.perceptionLane[index]
      ) {
        continue;
      }
      const result = visualCheck(
        this.map,
        pool.x[index],
        pool.z[index],
        pool.facingX[index],
        pool.facingZ[index],
        this.player.x,
        this.player.z,
      );
      pool.currentVisibility[index] = result.visible ? 1 : 0;
      pool.visibilitySampleTick[index] = simulationTick;
      pool.lineOfSight[index] = result.blocked ? 0 : 1;
      state = pool.perceptionState[index];
      if (result.visible) {
        if (
          pool.confirmedTargetKind[index] === TARGET_KIND.player
          && (
            state === PERCEPTION_STATE.hunting
            || state === PERCEPTION_STATE.returning
          )
        ) {
          const from = PERCEPTION_STATE_NAMES[state];
          this.#confirmPlayer(index, simulationTick);
          this.#recordPerceptionEvent("reacquisition", index, simulationTick, {
            from,
            target: { kind: "player", id: this.player.id, team: "player" },
          });
          continue;
        }
        if (state === PERCEPTION_STATE.engaged) {
          this.#updateLastSeen(index, simulationTick);
          continue;
        }
        if (state !== PERCEPTION_STATE.noticing) {
          pool.noticingResumeState[index] = state;
          pool.perceptionState[index] = PERCEPTION_STATE.noticing;
          pool.candidateTargetKind[index] = TARGET_KIND.player;
          pool.candidateTargetId[index] = this.player.id;
          pool.candidateTargetTeam[index] = ACTOR_TEAM.player;
          pool.exposureStartTick[index] = simulationTick;
          pool.exposureProgress[index] = 0;
          this.#recordPerceptionEvent("detection", index, simulationTick, {
            phase: "noticing",
            target: { kind: "player", id: this.player.id, team: "player" },
          });
          continue;
        }
        pool.exposureProgress[index] = Math.min(
          PERCEPTIVE_WIZARD.exposureTicks,
          simulationTick - pool.exposureStartTick[index],
        );
        if (pool.exposureProgress[index] >= PERCEPTIVE_WIZARD.exposureTicks) {
          this.#confirmPlayer(index, simulationTick);
          this.#recordPerceptionEvent("detection", index, simulationTick, {
            phase: "engaged",
            target: { kind: "player", id: this.player.id, team: "player" },
          });
        }
      } else if (state === PERCEPTION_STATE.engaged) {
        this.#beginHuntAfterLoss(index, simulationTick);
      } else if (state === PERCEPTION_STATE.noticing) {
        pool.perceptionState[index] = pool.noticingResumeState[index];
        this.#clearCandidate(index);
      }
    }
  }

  /** @param {number} index */
  #selectVisibleHostileProjectile(index) {
    const pool = this.enemies;
    const range = PERCEPTIVE_WIZARD.visualRangeMeters;
    const candidateCount = this.broadphase.queryProjectiles(
      pool.x[index] - range,
      pool.z[index] - range,
      pool.x[index] + range,
      pool.z[index] + range,
    );
    let selected = -1;
    let selectedDistanceSquared = Infinity;
    for (let candidate = 0; candidate < candidateCount; candidate += 1) {
      const projectileIndex = this.broadphase.projectileCandidates[candidate];
      if (this.projectiles.ownerTeam[projectileIndex] !== ACTOR_TEAM.player) continue;
      const spellCode = this.projectiles.spellCode[projectileIndex];
      if (
        spellCode > 0
        && this.spells.getByCode(spellCode)?.id !== FIREBALL_SPELL_ID
      ) {
        continue;
      }
      const sight = visualCheck(
        this.map,
        pool.x[index],
        pool.z[index],
        pool.facingX[index],
        pool.facingZ[index],
        this.projectiles.x[projectileIndex],
        this.projectiles.z[projectileIndex],
      );
      if (!sight.visible) continue;
      const dx = this.projectiles.x[projectileIndex] - pool.x[index];
      const dz = this.projectiles.z[projectileIndex] - pool.z[index];
      const distanceSquared = dx * dx + dz * dz;
      if (selected >= 0) {
        const farther = distanceSquared > selectedDistanceSquared + 1e-9;
        const sameDistance = Math.abs(distanceSquared - selectedDistanceSquared) <= 1e-9;
        const effectId = this.projectiles.effectId[projectileIndex];
        const selectedEffectId = this.projectiles.effectId[selected];
        const projectileId = this.projectiles.id[projectileIndex];
        const selectedProjectileId = this.projectiles.id[selected];
        if (
          farther
          || (sameDistance && effectId > selectedEffectId)
          || (
            sameDistance
            && effectId === selectedEffectId
            && projectileId >= selectedProjectileId
          )
        ) {
          continue;
        }
      }
      selected = projectileIndex;
      selectedDistanceSquared = distanceSquared;
    }
    return selected;
  }

  /** @param {number} index @param {number} simulationTick */
  #observeHostileProjectile(index, simulationTick) {
    const projectileIndex = this.#selectVisibleHostileProjectile(index);
    if (projectileIndex < 0) return;
    const projectile = {
      x: this.projectiles.x[projectileIndex],
      z: this.projectiles.z[projectileIndex],
      vx: this.projectiles.vx[projectileIndex],
      vz: this.projectiles.vz[projectileIndex],
      age: this.projectiles.age[projectileIndex],
    };
    const inferredOrigin = inferProjectileOrigin(this.map, projectile);
    const effectId = this.projectiles.effectId[projectileIndex];
    const projectileId = this.projectiles.id[projectileIndex];
    this.investigationEventMetrics.projectileObservations += 1;
    this.#recordPerceptionEvent("projectile-observation", index, simulationTick, {
      observation: {
        position: { x: projectile.x, z: projectile.z },
        velocity: { x: projectile.vx, z: projectile.vz },
        age: projectile.age,
      },
      inferredOrigin: {
        x: inferredOrigin.x,
        z: inferredOrigin.z,
        rawX: inferredOrigin.rawX,
        rawZ: inferredOrigin.rawZ,
        clamped: inferredOrigin.clamped,
      },
      effectId: effectId || null,
      projectileId,
    });
    this.#acceptInvestigationClue(index, simulationTick, {
      source: KNOWLEDGE_SOURCE.projectile,
      priority: INVESTIGATION_PRIORITY.projectile,
      anchor: { x: inferredOrigin.x, z: inferredOrigin.z },
      observationTick: simulationTick,
      effectId,
      projectileId,
      projectile,
      inferredOrigin,
    });
  }

  /** @param {number} simulationTick */
  #investigativePerceptionSystem(simulationTick) {
    const pool = this.enemies;
    for (let index = 0; index < pool.activeCount; index += 1) {
      let state = pool.perceptionState[index];
      if (
        state === PERCEPTION_STATE.unaware
        && Math.hypot(
          pool.x[index] - pool.guardX[index],
          pool.z[index] - pool.guardZ[index],
        ) > PERCEPTIVE_WIZARD.guardReturnDistanceMeters
      ) {
        this.#beginReturn(index, simulationTick, "displaced");
        state = pool.perceptionState[index];
      }

      if (
        state === PERCEPTION_STATE.hunting
        || state === PERCEPTION_STATE.investigating
      ) {
        if (pool.huntPhase[index] === HUNT_PHASE.travel) {
          const arrived = Math.hypot(
            pool.x[index] - pool.huntAnchorX[index],
            pool.z[index] - pool.huntAnchorZ[index],
          ) <= PERCEPTIVE_WIZARD.lastSeenArrivalMeters;
          const timedOut = simulationTick - pool.huntTravelStartTick[index]
            >= PERCEPTIVE_WIZARD.travelTimeoutTicks;
          if (arrived || timedOut) {
            this.#beginSearch(
              index,
              simulationTick,
              pool.huntAnchorX[index],
              pool.huntAnchorZ[index],
              arrived
                ? state === PERCEPTION_STATE.investigating
                  ? "investigation-arrival"
                  : "last-seen-arrival"
                : "travel-timeout",
              state,
            );
          }
        } else if (pool.huntPhase[index] === HUNT_PHASE.search) {
          if (simulationTick >= pool.searchEndTick[index]) {
            this.#beginReturn(index, simulationTick, "search-complete");
          } else {
            const arrived = pool.hasSearchGoal[index]
              && Math.hypot(
                pool.x[index] - pool.searchGoalX[index],
                pool.z[index] - pool.searchGoalZ[index],
              ) <= PERCEPTIVE_WIZARD.lastSeenArrivalMeters;
            const timedOut = simulationTick - pool.searchGoalStartTick[index]
              >= PERCEPTIVE_WIZARD.searchGoalTimeoutTicks;
            if (arrived || timedOut) this.#chooseSearchGoal(index, simulationTick);
          }
        }
        state = pool.perceptionState[index];
      }

      if (state === PERCEPTION_STATE.returning) {
        const arrived = Math.hypot(
          pool.x[index] - pool.guardX[index],
          pool.z[index] - pool.guardZ[index],
        ) <= PERCEPTIVE_WIZARD.guardReturnDistanceMeters;
        if (arrived) {
          this.#clearAwareness(index, simulationTick, "guard-arrival");
        } else {
          const slot = pool.navigationSlot[index];
          const cx = Math.floor(pool.x[index]);
          const cz = Math.floor(pool.z[index]);
          const unreachable = this.destinationFields.isCurrent(slot, this.mapRevision)
            && this.destinationFields.rawCostAt(slot, cx, cz) === NAVIGATION_UNREACHABLE;
          if (!unreachable) {
            pool.guardUnreachableStartTick[index] = 0;
          } else if (pool.guardUnreachableStartTick[index] === 0) {
            pool.guardUnreachableStartTick[index] = simulationTick;
          } else if (
            simulationTick - pool.guardUnreachableStartTick[index]
            >= PERCEPTIVE_WIZARD.travelTimeoutTicks
          ) {
            pool.guardX[index] = this.map.get(cx, cz) === 0 ? cx + 0.5 : pool.x[index];
            pool.guardZ[index] = this.map.get(cx, cz) === 0 ? cz + 0.5 : pool.z[index];
            pool.guardBaseFacingX[index] = pool.facingX[index];
            pool.guardBaseFacingZ[index] = pool.facingZ[index];
            this.#recordPerceptionEvent("return", index, simulationTick, {
              reason: "guard-rebased",
              guard: { x: pool.guardX[index], z: pool.guardZ[index] },
            });
            this.#clearAwareness(index, simulationTick, "guard-rebased");
          }
        }
      }

      if (
        simulationTick % PERCEPTIVE_WIZARD.perceptionLanes
        !== pool.perceptionLane[index]
      ) {
        continue;
      }
      const result = visualCheck(
        this.map,
        pool.x[index],
        pool.z[index],
        pool.facingX[index],
        pool.facingZ[index],
        this.player.x,
        this.player.z,
      );
      pool.currentVisibility[index] = result.visible ? 1 : 0;
      pool.visibilitySampleTick[index] = simulationTick;
      pool.lineOfSight[index] = result.blocked ? 0 : 1;
      state = pool.perceptionState[index];
      if (result.visible) {
        if (
          pool.confirmedTargetKind[index] === TARGET_KIND.player
          && (
            state === PERCEPTION_STATE.hunting
            || state === PERCEPTION_STATE.returning
            || state === PERCEPTION_STATE.investigating
          )
        ) {
          const from = PERCEPTION_STATE_NAMES[state];
          this.#confirmPlayer(index, simulationTick);
          this.#recordPerceptionEvent("reacquisition", index, simulationTick, {
            from,
            target: { kind: "player", id: this.player.id, team: "player" },
          });
        } else if (state === PERCEPTION_STATE.engaged) {
          this.#updateLastSeen(index, simulationTick);
        } else if (state !== PERCEPTION_STATE.noticing) {
          pool.noticingResumeState[index] = state;
          pool.perceptionState[index] = PERCEPTION_STATE.noticing;
          pool.candidateTargetKind[index] = TARGET_KIND.player;
          pool.candidateTargetId[index] = this.player.id;
          pool.candidateTargetTeam[index] = ACTOR_TEAM.player;
          pool.exposureStartTick[index] = simulationTick;
          pool.exposureProgress[index] = 0;
          this.#recordPerceptionEvent("detection", index, simulationTick, {
            phase: "noticing",
            target: { kind: "player", id: this.player.id, team: "player" },
          });
        } else {
          pool.exposureProgress[index] = Math.min(
            PERCEPTIVE_WIZARD.exposureTicks,
            simulationTick - pool.exposureStartTick[index],
          );
          if (pool.exposureProgress[index] >= PERCEPTIVE_WIZARD.exposureTicks) {
            this.#confirmPlayer(index, simulationTick);
            this.#recordPerceptionEvent("detection", index, simulationTick, {
              phase: "engaged",
              target: { kind: "player", id: this.player.id, team: "player" },
            });
          }
        }
      } else if (state === PERCEPTION_STATE.engaged) {
        this.#beginInvestigativeHuntAfterLoss(index, simulationTick);
      } else if (state === PERCEPTION_STATE.noticing) {
        pool.perceptionState[index] = pool.noticingResumeState[index];
        this.#clearCandidate(index);
      }
      this.#observeHostileProjectile(index, simulationTick);
    }
  }

  /** @param {number} simulationTick */
  #encounterSystem(simulationTick) {
    if (!this.encounter.enabled || simulationTick < this.encounter.nextSpawnTick) return;
    this.#attemptEnemySpawn(simulationTick);
    this.encounter.nextSpawnTick += ENEMY_WIZARD.spawnIntervalTicks;
  }

  /** @param {number} simulationTick */
  #attemptEnemySpawn(simulationTick) {
    const obelisk = this.scenario.obelisk;
    if (!obelisk) return;
    const slot = this.encounter.spawnCursor;
    const offset = SPAWN_OFFSETS[slot];
    this.encounter.spawnCursor = (slot + 1) % SPAWN_OFFSETS.length;
    this.encounter.attempts += 1;
    const x = obelisk.x + offset.x;
    const z = obelisk.z + offset.z;
    const event = {
      type: "spawn",
      tick: simulationTick,
      slot,
      direction: offset.name,
      position: { x, z },
      result: "blocked",
      enemy: null,
    };
    if (this.enemies.activeCount >= this.encounterMaximumAlive) {
      this.encounter.skippedCapped += 1;
      event.result = "capped";
      this.#recordCombatEvent(event);
      return;
    }
    if (!this.#enemySpawnIsSafe(x, z)) {
      this.encounter.skippedBlocked += 1;
      this.#recordCombatEvent(event);
      return;
    }
    const spawnSequence = this.encounter.nextSpawnSequence;
    const isDefaultArena = this.map.width === 24
      && this.map.height === 24
      && obelisk.x === 20.5
      && obelisk.z === 18.5
      && this.map.playerSpawn.x === 3.5
      && this.map.playerSpawn.z === 18.5;
    let heading = deterministicGuardHeading(this.seed, spawnSequence);
    if (isDefaultArena) {
      const outwardX = x - obelisk.x;
      const outwardZ = z - obelisk.z;
      const outwardLength = Math.hypot(outwardX, outwardZ);
      if (outwardLength > 1e-9) {
        heading = {
          x: outwardX / outwardLength,
          z: outwardZ / outwardLength,
          ordinal: -1,
        };
      }
    }
    const id = this.enemies.spawn({
      spawnSequence,
      spawnTick: simulationTick,
      x,
      z,
      radius: ENEMY_WIZARD.radius,
      massKg: ENEMY_WIZARD.massKg,
      maximumHealth: COMBAT.maximumHealth,
      shotReadyTick: simulationTick + ENEMY_WIZARD.shotIntervalTicks,
      facingX: heading.x,
      facingZ: heading.z,
      guardX: x,
      guardZ: z,
      guardBaseFacingX: heading.x,
      guardBaseFacingZ: heading.z,
      perceptionLane: spawnSequence % PERCEPTIVE_WIZARD.perceptionLanes,
      guardSweepPhase: deterministicGuardSweepPhase(this.seed, spawnSequence),
    });
    if (id === 0) {
      this.encounter.skippedCapped += 1;
      event.result = "capped";
      this.#recordCombatEvent(event);
      return;
    }
    this.encounter.nextSpawnSequence += 1;
    this.encounter.successfulSpawns += 1;
    event.result = "spawned";
    event.enemy = { kind: "enemyWizard", id, spawnSequence };
    this.#recordCombatEvent(event);
  }

  /** @param {number} x @param {number} z */
  #enemySpawnIsSafe(x, z) {
    if (firstSolidContact(this.map, x, z, ENEMY_WIZARD.radius, this._gridContact)) {
      return false;
    }
    if (
      Math.hypot(x - this.player.x, z - this.player.z)
      < ENEMY_WIZARD.radius + this.player.radius
    ) {
      return false;
    }
    for (let index = 0; index < this.rocks.activeCount; index += 1) {
      if (
        Math.hypot(x - this.rocks.x[index], z - this.rocks.z[index])
        < ENEMY_WIZARD.radius + this.rocks.radius[index]
      ) {
        return false;
      }
    }
    for (let index = 0; index < this.enemies.activeCount; index += 1) {
      if (
        Math.hypot(x - this.enemies.x[index], z - this.enemies.z[index])
        < ENEMY_WIZARD.radius + this.enemies.radius[index]
      ) {
        return false;
      }
    }
    for (let index = 0; index < this.dynamicDeadBodies.activeCount; index += 1) {
      if (
        Math.hypot(
          x - this.dynamicDeadBodies.x[index],
          z - this.dynamicDeadBodies.z[index],
        ) < ENEMY_WIZARD.radius + this.dynamicDeadBodies.radius[index]
      ) {
        return false;
      }
    }
    return true;
  }

  #navigationSystem() {
    if (this.enemyAiProfile === ENEMY_AI_PROFILE_TACTICAL) {
      this.navigationField.update(
        this.map,
        this.mapRevision,
        Math.floor(this.player.x),
        Math.floor(this.player.z),
        TACTICAL_WIZARD.navigationExpansionsPerTick,
      );
      return;
    }
    if (!usesPerceptionProfile(this.enemyAiProfile)) return;
    const pool = this.enemies;
    this.destinationFields.beginTick();
    for (let index = 0; index < pool.activeCount; index += 1) {
      pool.navigationSlot[index] = -1;
      let retreating = Boolean(pool.retreating[index]);
      if (!retreating && pool.health[index] <= TACTICAL_WIZARD.retreatEnterHealth) {
        retreating = true;
      } else if (retreating && pool.health[index] >= TACTICAL_WIZARD.retreatExitHealth) {
        retreating = false;
      }
      if (retreating) {
        if (pool.currentVisibility[index]) {
          pool.navigationSlot[index] = this.destinationFields.requestActor(
            TARGET_KIND.player,
            this.player.id,
            ACTOR_TEAM.player,
            this.mapRevision,
            Math.floor(this.player.x),
            Math.floor(this.player.z),
          );
        } else if (
          this.enemyAiProfile === ENEMY_AI_PROFILE_INVESTIGATIVE
          && pool.investigationPriority[index] > INVESTIGATION_PRIORITY.none
          && Number.isFinite(pool.investigationAnchorX[index])
          && Number.isFinite(pool.investigationAnchorZ[index])
        ) {
          pool.navigationSlot[index] = this.destinationFields.requestGoal(
            this.mapRevision,
            Math.floor(pool.investigationAnchorX[index]),
            Math.floor(pool.investigationAnchorZ[index]),
          );
        } else if (pool.hasLastSeen[index]) {
          pool.navigationSlot[index] = this.destinationFields.requestGoal(
            this.mapRevision,
            Math.floor(pool.lastSeenX[index]),
            Math.floor(pool.lastSeenZ[index]),
          );
        } else if (pool.hasStimulus[index]) {
          pool.navigationSlot[index] = this.destinationFields.requestGoal(
            this.mapRevision,
            Math.floor(pool.stimulusX[index]),
            Math.floor(pool.stimulusZ[index]),
          );
        }
        if (pool.navigationSlot[index] >= 0) continue;
      }
      let state = pool.perceptionState[index];
      if (state === PERCEPTION_STATE.noticing) state = pool.noticingResumeState[index];
      if (state === PERCEPTION_STATE.engaged) {
        pool.navigationSlot[index] = this.destinationFields.requestActor(
          TARGET_KIND.player,
          this.player.id,
          ACTOR_TEAM.player,
          this.mapRevision,
          Math.floor(this.player.x),
          Math.floor(this.player.z),
        );
      } else if (
        state === PERCEPTION_STATE.hunting
        || state === PERCEPTION_STATE.investigating
      ) {
        const goalX = pool.huntPhase[index] === HUNT_PHASE.search
          ? pool.searchGoalX[index]
          : pool.huntAnchorX[index];
        const goalZ = pool.huntPhase[index] === HUNT_PHASE.search
          ? pool.searchGoalZ[index]
          : pool.huntAnchorZ[index];
        if (Number.isFinite(goalX) && Number.isFinite(goalZ)) {
          pool.navigationSlot[index] = this.destinationFields.requestGoal(
            this.mapRevision,
            Math.floor(goalX),
            Math.floor(goalZ),
          );
        }
      } else if (state === PERCEPTION_STATE.returning) {
        pool.navigationSlot[index] = this.destinationFields.requestGoal(
          this.mapRevision,
          Math.floor(pool.guardX[index]),
          Math.floor(pool.guardZ[index]),
        );
      }
    }
    this.destinationFields.update(
      this.map,
      PERCEPTIVE_WIZARD.navigationExpansionsPerTick,
    );
  }

  /** @param {number} index @param {number} kind @param {number} x @param {number} z @param {number} [cx] @param {number} [cz] */
  #setEnemyMovementGoal(index, kind, x, z, cx = -1, cz = -1) {
    const pool = this.enemies;
    pool.movementGoalKind[index] = kind;
    pool.movementGoalX[index] = x;
    pool.movementGoalZ[index] = z;
    pool.movementGoalCx[index] = cx;
    pool.movementGoalCz[index] = cz;
  }

  /** @param {number} index */
  #clearEnemyMovementGoal(index) {
    this.#setEnemyMovementGoal(index, ENEMY_GOAL_NONE, Number.NaN, Number.NaN);
  }

  /** @param {number} index @param {number} desiredVx @param {number} desiredVz @param {number} dt @param {boolean} [immediate] */
  #applyEnemyDesiredVelocity(index, desiredVx, desiredVz, dt, immediate = false) {
    const pool = this.enemies;
    pool.desiredVx[index] = desiredVx;
    pool.desiredVz[index] = desiredVz;
    if (immediate) {
      pool.locomotionVx[index] = desiredVx;
      pool.locomotionVz[index] = desiredVz;
      return;
    }
    const deltaVx = desiredVx - pool.locomotionVx[index];
    const deltaVz = desiredVz - pool.locomotionVz[index];
    const deltaLength = Math.hypot(deltaVx, deltaVz);
    const rate = Math.hypot(desiredVx, desiredVz) <= 1e-9
      ? ENEMY_WIZARD.braking
      : ENEMY_WIZARD.acceleration;
    const maximumDelta = rate * dt;
    if (deltaLength <= maximumDelta || deltaLength <= 1e-9) {
      pool.locomotionVx[index] = desiredVx;
      pool.locomotionVz[index] = desiredVz;
    } else {
      pool.locomotionVx[index] += (deltaVx / deltaLength) * maximumDelta;
      pool.locomotionVz[index] += (deltaVz / deltaLength) * maximumDelta;
    }
  }

  /** @param {number} index @param {number} dx @param {number} dz @param {number} speed @param {number} dt @param {boolean} [immediate] */
  #moveEnemyAlong(index, dx, dz, speed, dt, immediate = false) {
    const length = Math.hypot(dx, dz);
    if (length <= 1e-9) {
      this.#applyEnemyDesiredVelocity(index, 0, 0, dt, immediate);
      return;
    }
    this.#applyEnemyDesiredVelocity(
      index,
      (dx / length) * speed,
      (dz / length) * speed,
      dt,
      immediate,
    );
  }

  /** @param {number} index @param {number} simulationTick */
  #advanceEnemyStrafeDecision(index, simulationTick) {
    const pool = this.enemies;
    if (pool.strafeDirection[index] === 0) {
      const decision = strafeDecision(this.seed, pool.spawnSequence[index], 0);
      pool.strafeDirection[index] = decision.direction;
      pool.strafeDecisionSequence[index] = 0;
      pool.strafeChangeTick[index] = pool.spawnTick[index] + decision.durationTicks;
    }
    while (simulationTick >= pool.strafeChangeTick[index]) {
      const sequence = pool.strafeDecisionSequence[index] + 1;
      const decision = strafeDecision(this.seed, pool.spawnSequence[index], sequence);
      pool.strafeDirection[index] = -pool.strafeDirection[index];
      pool.strafeDecisionSequence[index] = sequence;
      pool.strafeChangeTick[index] += decision.durationTicks;
    }
  }

  /** @param {number} index */
  #selectEnemyThreat(index) {
    const pool = this.enemies;
    let bestIndex = -1;
    let bestMetrics = null;
    const candidateCount = usesPerceptionProfile(this.enemyAiProfile)
      ? this.broadphase.queryProjectiles(
        pool.x[index] - PERCEPTIVE_WIZARD.visualRangeMeters,
        pool.z[index] - PERCEPTIVE_WIZARD.visualRangeMeters,
        pool.x[index] + PERCEPTIVE_WIZARD.visualRangeMeters,
        pool.z[index] + PERCEPTIVE_WIZARD.visualRangeMeters,
      )
      : this.projectiles.activeCount;
    for (let candidate = 0; candidate < candidateCount; candidate += 1) {
      const projectileIndex = usesPerceptionProfile(this.enemyAiProfile)
        ? this.broadphase.projectileCandidates[candidate]
        : candidate;
      if (this.projectiles.ownerTeam[projectileIndex] !== ACTOR_TEAM.player) continue;
      if (
        usesPerceptionProfile(this.enemyAiProfile)
        && !visualCheck(
          this.map,
          pool.x[index],
          pool.z[index],
          pool.facingX[index],
          pool.facingZ[index],
          this.projectiles.x[projectileIndex],
          this.projectiles.z[projectileIndex],
        ).visible
      ) {
        continue;
      }
      const metrics = hostileThreatMetrics({
        x: pool.x[index],
        z: pool.z[index],
        vx: pool.vx[index],
        vz: pool.vz[index],
        radius: pool.radius[index],
      }, {
        x: this.projectiles.x[projectileIndex],
        z: this.projectiles.z[projectileIndex],
        vx: this.projectiles.vx[projectileIndex],
        vz: this.projectiles.vz[projectileIndex],
        radius: this.projectiles.radius[projectileIndex],
        age: this.projectiles.age[projectileIndex],
        lifetime: this.projectiles.lifetime[projectileIndex],
      });
      if (!metrics) continue;
      if (bestMetrics) {
        const later = metrics.time > bestMetrics.time + 1e-9;
        const sameTime = Math.abs(metrics.time - bestMetrics.time) <= 1e-9;
        const widerMiss = metrics.missDistance > bestMetrics.missDistance + 1e-9;
        const sameMiss = Math.abs(metrics.missDistance - bestMetrics.missDistance) <= 1e-9;
        const effectId = this.projectiles.effectId[projectileIndex];
        const bestEffectId = this.projectiles.effectId[bestIndex];
        const projectileId = this.projectiles.id[projectileIndex];
        const bestProjectileId = this.projectiles.id[bestIndex];
        if (
          later
          || (sameTime && widerMiss)
          || (sameTime && sameMiss && effectId > bestEffectId)
          || (
            sameTime
            && sameMiss
            && effectId === bestEffectId
            && projectileId >= bestProjectileId
          )
        ) {
          continue;
        }
      }
      bestIndex = projectileIndex;
      bestMetrics = metrics;
    }
    return bestIndex < 0 ? null : { index: bestIndex, metrics: bestMetrics };
  }

  /** @param {number} index @param {number} dt */
  #applyEnemyDodge(index, dt) {
    const pool = this.enemies;
    pool.aiState[index] = ENEMY_AI_DODGE;
    const remainingDistance = TACTICAL_WIZARD.dodgeSpeed
      * pool.dodgeTicksRemaining[index]
      * dt;
    this.#setEnemyMovementGoal(
      index,
      ENEMY_GOAL_DODGE,
      pool.x[index] + pool.dodgeDirectionX[index] * remainingDistance,
      pool.z[index] + pool.dodgeDirectionZ[index] * remainingDistance,
    );
    this.#applyEnemyDesiredVelocity(
      index,
      pool.dodgeDirectionX[index] * TACTICAL_WIZARD.dodgeSpeed,
      pool.dodgeDirectionZ[index] * TACTICAL_WIZARD.dodgeSpeed,
      dt,
      true,
    );
    pool.dodgeTicksRemaining[index] -= 1;
    if (pool.dodgeTicksRemaining[index] === 0) {
      pool.dodgeCooldownTicks[index] = TACTICAL_WIZARD.dodgeCooldownTicks;
    }
  }

  /** @param {number} index @param {number} dt @param {number} simulationTick */
  #prepareTacticalEnemyMovement(index, dt, simulationTick) {
    const pool = this.enemies;
    this.#advanceEnemyStrafeDecision(index, simulationTick);
    if (!pool.retreating[index] && pool.health[index] <= TACTICAL_WIZARD.retreatEnterHealth) {
      pool.retreating[index] = 1;
    } else if (
      pool.retreating[index]
      && pool.health[index] >= TACTICAL_WIZARD.retreatExitHealth
    ) {
      pool.retreating[index] = 0;
    }

    const cellX = Math.floor(pool.x[index]);
    const cellZ = Math.floor(pool.z[index]);
    pool.navigationCost[index] = this.navigationField.rawCostAt(cellX, cellZ);
    pool.navigationVersion[index] = this.navigationField.completed
      ? this.navigationField.version
      : 0;

    if (pool.dodgeTicksRemaining[index] > 0) {
      this.#applyEnemyDodge(index, dt);
      return;
    }
    const wasCoolingDown = pool.dodgeCooldownTicks[index] > 0;
    if (wasCoolingDown) pool.dodgeCooldownTicks[index] -= 1;
    if (!wasCoolingDown) {
      const threat = this.#selectEnemyThreat(index);
      if (threat) {
        const projectileIndex = threat.index;
        const direction = chooseDodgeDirection(
          this.map,
          { x: pool.x[index], z: pool.z[index], radius: pool.radius[index] },
          {
            id: this.projectiles.id[projectileIndex],
            effectId: this.projectiles.effectId[projectileIndex],
            x: this.projectiles.x[projectileIndex],
            z: this.projectiles.z[projectileIndex],
            vx: this.projectiles.vx[projectileIndex],
            vz: this.projectiles.vz[projectileIndex],
            radius: this.projectiles.radius[projectileIndex],
          },
          threat.metrics,
          this.seed,
          pool.spawnSequence[index],
        );
        if (direction) {
          pool.trackedThreatEffectId[index] = this.projectiles.effectId[projectileIndex];
          pool.trackedThreatProjectileId[index] = this.projectiles.id[projectileIndex];
          pool.dodgeDirectionX[index] = direction.x;
          pool.dodgeDirectionZ[index] = direction.z;
          pool.dodgeSide[index] = direction.code;
          pool.dodgeTicksRemaining[index] = TACTICAL_WIZARD.dodgeTicks;
          this.#applyEnemyDodge(index, dt);
          return;
        }
      }
    }
    pool.trackedThreatEffectId[index] = 0;
    pool.trackedThreatProjectileId[index] = 0;
    pool.dodgeDirectionX[index] = 0;
    pool.dodgeDirectionZ[index] = 0;
    pool.dodgeSide[index] = 0;

    const dx = this.player.x - pool.x[index];
    const dz = this.player.z - pool.z[index];
    const distance = Math.hypot(dx, dz);
    let gradientMode = null;
    let directDx = 0;
    let directDz = 0;
    if (pool.retreating[index]) {
      pool.aiState[index] = ENEMY_AI_RETREAT;
      gradientMode = "retreat";
      directDx = -dx;
      directDz = -dz;
    } else if (distance > ENEMY_WIZARD.approachBeyondMeters) {
      pool.aiState[index] = ENEMY_AI_APPROACH;
      gradientMode = "approach";
      directDx = dx;
      directDz = dz;
    } else if (distance < ENEMY_WIZARD.withdrawInsideMeters) {
      pool.aiState[index] = ENEMY_AI_WITHDRAW;
      gradientMode = "retreat";
      directDx = -dx;
      directDz = -dz;
    } else {
      pool.aiState[index] = ENEMY_AI_HOLD;
      if (distance <= 1e-9) {
        this.#clearEnemyMovementGoal(index);
        this.#applyEnemyDesiredVelocity(index, 0, 0, dt);
        return;
      }
      const direction = pool.strafeDirection[index];
      const tangentX = (-dz / distance) * direction;
      const tangentZ = (dx / distance) * direction;
      this.#setEnemyMovementGoal(
        index,
        ENEMY_GOAL_STRAFE,
        pool.x[index] + tangentX,
        pool.z[index] + tangentZ,
      );
      this.#applyEnemyDesiredVelocity(
        index,
        tangentX * TACTICAL_WIZARD.strafeSpeed,
        tangentZ * TACTICAL_WIZARD.strafeSpeed,
        dt,
      );
      return;
    }

    const step = this.navigationField.completed
      ? this.navigationField.gradientStep(this.map, cellX, cellZ, gradientMode)
      : null;
    if (step) {
      this.#setEnemyMovementGoal(
        index,
        ENEMY_GOAL_NAVIGATION,
        step.x,
        step.z,
        step.cx,
        step.cz,
      );
      this.#moveEnemyAlong(
        index,
        step.x - pool.x[index],
        step.z - pool.z[index],
        ENEMY_WIZARD.desiredSpeed,
        dt,
      );
      return;
    }
    this.#setEnemyMovementGoal(
      index,
      ENEMY_GOAL_DIRECT,
      pool.x[index] + directDx,
      pool.z[index] + directDz,
    );
    this.#moveEnemyAlong(index, directDx, directDz, ENEMY_WIZARD.desiredSpeed, dt);
  }

  /**
   * @param {number} index
   * @param {number} targetX
   * @param {number} targetZ
   * @param {"approach"|"retreat"} gradientMode
   * @param {number} directGoalKind
   * @param {number} speed
   * @param {number} dt
   */
  #movePerceptiveWithField(
    index,
    targetX,
    targetZ,
    gradientMode,
    directGoalKind,
    speed,
    dt,
  ) {
    const pool = this.enemies;
    const cellX = Math.floor(pool.x[index]);
    const cellZ = Math.floor(pool.z[index]);
    const slot = pool.navigationSlot[index];
    const step = this.destinationFields.isCurrent(slot)
      ? this.destinationFields.gradientStep(this.map, slot, cellX, cellZ, gradientMode)
      : null;
    if (step) {
      this.#setEnemyMovementGoal(
        index,
        ENEMY_GOAL_NAVIGATION,
        step.x,
        step.z,
        step.cx,
        step.cz,
      );
      this.#moveEnemyAlong(
        index,
        step.x - pool.x[index],
        step.z - pool.z[index],
        speed,
        dt,
      );
      return;
    }
    let dx = targetX - pool.x[index];
    let dz = targetZ - pool.z[index];
    if (gradientMode === "retreat") {
      dx = -dx;
      dz = -dz;
    }
    this.#setEnemyMovementGoal(index, directGoalKind, targetX, targetZ);
    this.#moveEnemyAlong(index, dx, dz, speed, dt);
  }

  /** @param {number} index @param {number} dt @param {number} simulationTick */
  #preparePerceptiveEnemyMovement(index, dt, simulationTick) {
    const pool = this.enemies;
    this.#advanceEnemyStrafeDecision(index, simulationTick);
    if (!pool.retreating[index] && pool.health[index] <= TACTICAL_WIZARD.retreatEnterHealth) {
      pool.retreating[index] = 1;
    } else if (
      pool.retreating[index]
      && pool.health[index] >= TACTICAL_WIZARD.retreatExitHealth
    ) {
      pool.retreating[index] = 0;
    }
    const slot = pool.navigationSlot[index];
    const cellX = Math.floor(pool.x[index]);
    const cellZ = Math.floor(pool.z[index]);
    pool.navigationCost[index] = this.destinationFields.rawCostAt(slot, cellX, cellZ);
    pool.navigationVersion[index] = slot >= 0
      ? this.destinationFields.versions[slot]
      : 0;

    if (pool.dodgeTicksRemaining[index] > 0) {
      this.#applyEnemyDodge(index, dt);
      return;
    }
    const wasCoolingDown = pool.dodgeCooldownTicks[index] > 0;
    if (wasCoolingDown) pool.dodgeCooldownTicks[index] -= 1;
    if (!wasCoolingDown) {
      const threat = this.#selectEnemyThreat(index);
      if (threat) {
        const projectileIndex = threat.index;
        const direction = chooseDodgeDirection(
          this.map,
          { x: pool.x[index], z: pool.z[index], radius: pool.radius[index] },
          {
            id: this.projectiles.id[projectileIndex],
            effectId: this.projectiles.effectId[projectileIndex],
            x: this.projectiles.x[projectileIndex],
            z: this.projectiles.z[projectileIndex],
            vx: this.projectiles.vx[projectileIndex],
            vz: this.projectiles.vz[projectileIndex],
            radius: this.projectiles.radius[projectileIndex],
          },
          threat.metrics,
          this.seed,
          pool.spawnSequence[index],
        );
        if (direction) {
          pool.trackedThreatEffectId[index] = this.projectiles.effectId[projectileIndex];
          pool.trackedThreatProjectileId[index] = this.projectiles.id[projectileIndex];
          pool.dodgeDirectionX[index] = direction.x;
          pool.dodgeDirectionZ[index] = direction.z;
          pool.dodgeSide[index] = direction.code;
          pool.dodgeTicksRemaining[index] = TACTICAL_WIZARD.dodgeTicks;
          this.#applyEnemyDodge(index, dt);
          return;
        }
      }
    }
    pool.trackedThreatEffectId[index] = 0;
    pool.trackedThreatProjectileId[index] = 0;
    pool.dodgeDirectionX[index] = 0;
    pool.dodgeDirectionZ[index] = 0;
    pool.dodgeSide[index] = 0;

    if (pool.retreating[index]) {
      let hostileX = Number.NaN;
      let hostileZ = Number.NaN;
      if (pool.currentVisibility[index]) {
        hostileX = this.player.x;
        hostileZ = this.player.z;
      } else if (
        this.enemyAiProfile === ENEMY_AI_PROFILE_INVESTIGATIVE
        && pool.investigationPriority[index] > INVESTIGATION_PRIORITY.none
        && Number.isFinite(pool.investigationAnchorX[index])
        && Number.isFinite(pool.investigationAnchorZ[index])
      ) {
        hostileX = pool.investigationAnchorX[index];
        hostileZ = pool.investigationAnchorZ[index];
      } else if (pool.hasLastSeen[index]) {
        hostileX = pool.lastSeenX[index];
        hostileZ = pool.lastSeenZ[index];
      } else if (pool.hasStimulus[index]) {
        hostileX = pool.stimulusX[index];
        hostileZ = pool.stimulusZ[index];
      }
      if (Number.isFinite(hostileX) && Number.isFinite(hostileZ)) {
        pool.aiState[index] = ENEMY_AI_RETREAT;
        this.#movePerceptiveWithField(
          index,
          hostileX,
          hostileZ,
          "retreat",
          ENEMY_GOAL_MEMORY,
          ENEMY_WIZARD.desiredSpeed,
          dt,
        );
        return;
      }
    }

    let state = pool.perceptionState[index];
    if (state === PERCEPTION_STATE.noticing) state = pool.noticingResumeState[index];
    if (state === PERCEPTION_STATE.engaged) {
      const dx = this.player.x - pool.x[index];
      const dz = this.player.z - pool.z[index];
      const distance = Math.hypot(dx, dz);
      if (distance > ENEMY_WIZARD.approachBeyondMeters) {
        pool.aiState[index] = ENEMY_AI_APPROACH;
        this.#movePerceptiveWithField(
          index,
          this.player.x,
          this.player.z,
          "approach",
          ENEMY_GOAL_DIRECT,
          ENEMY_WIZARD.desiredSpeed,
          dt,
        );
      } else if (distance < ENEMY_WIZARD.withdrawInsideMeters) {
        pool.aiState[index] = ENEMY_AI_WITHDRAW;
        this.#movePerceptiveWithField(
          index,
          this.player.x,
          this.player.z,
          "retreat",
          ENEMY_GOAL_DIRECT,
          ENEMY_WIZARD.desiredSpeed,
          dt,
        );
      } else if (distance > 1e-9) {
        pool.aiState[index] = ENEMY_AI_HOLD;
        const direction = pool.strafeDirection[index];
        const tangentX = (-dz / distance) * direction;
        const tangentZ = (dx / distance) * direction;
        this.#setEnemyMovementGoal(
          index,
          ENEMY_GOAL_STRAFE,
          pool.x[index] + tangentX,
          pool.z[index] + tangentZ,
        );
        this.#applyEnemyDesiredVelocity(
          index,
          tangentX * TACTICAL_WIZARD.strafeSpeed,
          tangentZ * TACTICAL_WIZARD.strafeSpeed,
          dt,
        );
      } else {
        pool.aiState[index] = ENEMY_AI_HOLD;
        this.#clearEnemyMovementGoal(index);
        this.#applyEnemyDesiredVelocity(index, 0, 0, dt);
      }
      return;
    }

    if (
      state === PERCEPTION_STATE.hunting
      || state === PERCEPTION_STATE.investigating
    ) {
      const searching = pool.huntPhase[index] === HUNT_PHASE.search;
      const hasGoal = searching ? Boolean(pool.hasSearchGoal[index]) : true;
      const targetX = searching ? pool.searchGoalX[index] : pool.huntAnchorX[index];
      const targetZ = searching ? pool.searchGoalZ[index] : pool.huntAnchorZ[index];
      if (hasGoal && Number.isFinite(targetX) && Number.isFinite(targetZ)) {
        pool.aiState[index] = ENEMY_AI_APPROACH;
        this.#movePerceptiveWithField(
          index,
          targetX,
          targetZ,
          "approach",
          searching ? ENEMY_GOAL_SEARCH : ENEMY_GOAL_MEMORY,
          ENEMY_WIZARD.desiredSpeed,
          dt,
        );
      } else {
        pool.aiState[index] = ENEMY_AI_HOLD;
        this.#clearEnemyMovementGoal(index);
        this.#applyEnemyDesiredVelocity(index, 0, 0, dt);
      }
      return;
    }

    if (state === PERCEPTION_STATE.returning) {
      pool.aiState[index] = ENEMY_AI_APPROACH;
      this.#movePerceptiveWithField(
        index,
        pool.guardX[index],
        pool.guardZ[index],
        "approach",
        ENEMY_GOAL_GUARD,
        ENEMY_WIZARD.desiredSpeed,
        dt,
      );
      return;
    }

    pool.aiState[index] = ENEMY_AI_HOLD;
    this.#clearEnemyMovementGoal(index);
    this.#applyEnemyDesiredVelocity(index, 0, 0, dt);
  }

  /** @param {number} dt */
  #prepareBasicEnemyMovement(dt) {
    const pool = this.enemies;
    for (let index = 0; index < pool.activeCount; index += 1) {
      const dx = this.player.x - pool.x[index];
      const dz = this.player.z - pool.z[index];
      const distance = Math.hypot(dx, dz);
      let desiredVx = 0;
      let desiredVz = 0;
      let state = ENEMY_AI_HOLD;
      if (distance > ENEMY_WIZARD.approachBeyondMeters) {
        state = ENEMY_AI_APPROACH;
        if (distance > 1e-9) {
          desiredVx = (dx / distance) * ENEMY_WIZARD.desiredSpeed;
          desiredVz = (dz / distance) * ENEMY_WIZARD.desiredSpeed;
        }
      } else if (distance < ENEMY_WIZARD.withdrawInsideMeters) {
        state = ENEMY_AI_WITHDRAW;
        if (distance > 1e-9) {
          desiredVx = (-dx / distance) * ENEMY_WIZARD.desiredSpeed;
          desiredVz = (-dz / distance) * ENEMY_WIZARD.desiredSpeed;
        }
      }
      pool.aiState[index] = state;
      pool.desiredVx[index] = desiredVx;
      pool.desiredVz[index] = desiredVz;
      pool.navigationCost[index] = NAVIGATION_UNREACHABLE;
      pool.navigationVersion[index] = 0;
      if (state === ENEMY_AI_HOLD) {
        this.#clearEnemyMovementGoal(index);
      } else {
        this.#setEnemyMovementGoal(
          index,
          ENEMY_GOAL_DIRECT,
          pool.x[index] + desiredVx,
          pool.z[index] + desiredVz,
        );
      }
      const deltaVx = desiredVx - pool.locomotionVx[index];
      const deltaVz = desiredVz - pool.locomotionVz[index];
      const deltaLength = Math.hypot(deltaVx, deltaVz);
      const rate = state === ENEMY_AI_HOLD
        ? ENEMY_WIZARD.braking
        : ENEMY_WIZARD.acceleration;
      const maximumDelta = rate * dt;
      if (deltaLength <= maximumDelta || deltaLength <= 1e-9) {
        pool.locomotionVx[index] = desiredVx;
        pool.locomotionVz[index] = desiredVz;
      } else {
        pool.locomotionVx[index] += (deltaVx / deltaLength) * maximumDelta;
        pool.locomotionVz[index] += (deltaVz / deltaLength) * maximumDelta;
      }
    }
  }

  /** @param {number} dt @param {number} simulationTick */
  #prepareEnemyMovement(dt, simulationTick) {
    if (this.enemyAiProfile === ENEMY_AI_PROFILE_PERCEPTIVE) {
      this.broadphase.rebuild(
        this.enemies,
        this.rocks,
        this.projectiles,
        this.dynamicDeadBodies,
      );
      for (let index = 0; index < this.enemies.activeCount; index += 1) {
        this.#preparePerceptiveEnemyMovement(index, dt, simulationTick);
      }
      return;
    }
    if (this.enemyAiProfile === ENEMY_AI_PROFILE_INVESTIGATIVE) {
      for (let index = 0; index < this.enemies.activeCount; index += 1) {
        this.#preparePerceptiveEnemyMovement(index, dt, simulationTick);
      }
      return;
    }
    if (this.enemyAiProfile !== ENEMY_AI_PROFILE_TACTICAL) {
      this.#prepareBasicEnemyMovement(dt);
      return;
    }
    for (let index = 0; index < this.enemies.activeCount; index += 1) {
      this.#prepareTacticalEnemyMovement(index, dt, simulationTick);
    }
  }

  /** @param {number} simulationTick */
  #facingSystem(simulationTick) {
    const pool = this.enemies;
    for (let index = 0; index < pool.activeCount; index += 1) {
      let targetX = 0;
      let targetZ = 0;
      if (pool.currentVisibility[index]) {
        targetX = this.player.x - pool.x[index];
        targetZ = this.player.z - pool.z[index];
      } else if (Math.hypot(pool.desiredVx[index], pool.desiredVz[index]) > 1e-9) {
        targetX = pool.desiredVx[index];
        targetZ = pool.desiredVz[index];
      } else {
        let state = pool.perceptionState[index];
        if (state === PERCEPTION_STATE.noticing) state = pool.noticingResumeState[index];
        if (state === PERCEPTION_STATE.unaware) {
          const sweep = guardSweepFacing(
            pool.guardBaseFacingX[index],
            pool.guardBaseFacingZ[index],
            simulationTick,
            pool.guardSweepPhase[index],
          );
          targetX = sweep.x;
          targetZ = sweep.z;
        } else if (
          (
            state === PERCEPTION_STATE.hunting
            || state === PERCEPTION_STATE.investigating
          )
          && pool.huntPhase[index] === HUNT_PHASE.search
        ) {
          const scan = searchScanFacing(
            this.seed,
            pool.spawnSequence[index],
            Math.max(0, simulationTick - pool.searchStartTick[index]),
          );
          targetX = scan.x;
          targetZ = scan.z;
        } else {
          targetX = pool.guardBaseFacingX[index];
          targetZ = pool.guardBaseFacingZ[index];
        }
      }
      const facing = turnFacing(
        pool.facingX[index],
        pool.facingZ[index],
        targetX,
        targetZ,
      );
      pool.facingX[index] = facing.x;
      pool.facingZ[index] = facing.z;
    }
  }

  /** @param {number} simulationTick */
  #enemyCastSystem(simulationTick) {
    const spell = this.spells.get(FIREBALL_SPELL_ID);
    if (!spell || spell.handler !== "fireball") return;
    const definition = spell.definitions.get(spell.currentRevision);
    if (!definition) throw new Error("Current Fireball definition is unavailable");
    const pool = this.enemies;
    for (let index = 0; index < pool.activeCount; index += 1) {
      let aimX = this.player.x;
      let aimZ = this.player.z;
      let interceptTime = 0;
      let leadTime = 0;
      if (usesPerceptionProfile(this.enemyAiProfile)) {
        pool.predictedAimX[index] = Number.NaN;
        pool.predictedAimZ[index] = Number.NaN;
        pool.aimInterceptTime[index] = 0;
        pool.aimLeadTime[index] = 0;
        const sight = visualCheck(
          this.map,
          pool.x[index],
          pool.z[index],
          pool.facingX[index],
          pool.facingZ[index],
          this.player.x,
          this.player.z,
        );
        pool.lineOfSight[index] = sight.blocked ? 0 : 1;
        if (
          pool.health[index] <= 0
          || pool.perceptionState[index] !== PERCEPTION_STATE.engaged
          || Boolean(pool.retreating[index])
          || simulationTick < pool.shotReadyTick[index]
          || pool.cooldown[index] > 0
          || !sight.visible
        ) {
          continue;
        }
        const prediction = predictSoftenedIntercept({
          shooterX: pool.x[index],
          shooterZ: pool.z[index],
          targetX: this.player.x,
          targetZ: this.player.z,
          targetVx: this.player.vx,
          targetVz: this.player.vz,
          projectileSpeed: Number(definition.projectile.speed),
          projectileLifetime: Number(definition.projectile.lifetime),
        });
        aimX = prediction.x;
        aimZ = prediction.z;
        interceptTime = prediction.interceptTime ?? 0;
        leadTime = prediction.leadTime;
      } else if (this.enemyAiProfile === ENEMY_AI_PROFILE_TACTICAL) {
        const prediction = predictSoftenedIntercept({
          shooterX: pool.x[index],
          shooterZ: pool.z[index],
          targetX: this.player.x,
          targetZ: this.player.z,
          targetVx: this.player.vx,
          targetVz: this.player.vz,
          projectileSpeed: Number(definition.projectile.speed),
          projectileLifetime: Number(definition.projectile.lifetime),
        });
        aimX = prediction.x;
        aimZ = prediction.z;
        interceptTime = prediction.interceptTime ?? 0;
        leadTime = prediction.leadTime;
      }
      pool.predictedAimX[index] = aimX;
      pool.predictedAimZ[index] = aimZ;
      pool.aimInterceptTime[index] = interceptTime;
      pool.aimLeadTime[index] = leadTime;
      if (!usesPerceptionProfile(this.enemyAiProfile)) {
        const blocked = gridRayBlocked(
          this.map,
          pool.x[index],
          pool.z[index],
          this.player.x,
          this.player.z,
        );
        pool.lineOfSight[index] = blocked ? 0 : 1;
        if (
          pool.health[index] <= 0
          || (
            this.enemyAiProfile === ENEMY_AI_PROFILE_TACTICAL
            && Boolean(pool.retreating[index])
          )
          || simulationTick < pool.shotReadyTick[index]
          || pool.cooldown[index] > 0
          || blocked
        ) {
          continue;
        }
      }
      const dx = aimX - pool.x[index];
      const dz = aimZ - pool.z[index];
      const distance = Math.hypot(dx, dz);
      if (distance <= 1e-5) continue;
      const nx = dx / distance;
      const nz = dz / distance;
      const offset = pool.radius[index]
        + Number(definition.projectile.radius)
        + Number(definition.projectile.spawnGap);
      const effectSeed = deriveEnemyCastSeed(
        this.seed,
        pool.spawnSequence[index],
        spell.code,
        pool.castSequence[index],
      );
      const effectId = this.nextEffectId;
      const projectileId = this.projectiles.spawn({
        x: pool.x[index] + nx * offset,
        z: pool.z[index] + nz * offset,
        vx: nx * Number(definition.projectile.speed),
        vz: nz * Number(definition.projectile.speed),
        lifetime: Number(definition.projectile.lifetime),
        radius: Number(definition.projectile.radius),
        ownerId: pool.id[index],
        ownerKind: PROJECTILE_OWNER_KIND.enemyWizard,
        ownerTeam: ACTOR_TEAM.enemy,
        spellCode: spell.code,
        definitionRevision: spell.currentRevision,
        effectId,
        effectSeed,
      });
      if (projectileId === 0) continue;
      pool.cooldown[index] = Number(definition.cast.cooldown);
      pool.castSequence[index] = (pool.castSequence[index] + 1) >>> 0;
      pool.shotReadyTick[index] = simulationTick + ENEMY_WIZARD.shotIntervalTicks;
      this.nextEffectId = (this.nextEffectId + 1) >>> 0 || 1;
      this.#recordCombatEvent({
        type: "cast",
        tick: simulationTick,
        caster: { kind: "enemyWizard", id: pool.id[index], team: "enemy" },
        spellId: spell.id,
        definitionRevision: spell.currentRevision,
        effectId,
        effectSeed,
        projectileId,
        target: { kind: "player", id: this.player.id },
        ...(
          this.enemyAiProfile === ENEMY_AI_PROFILE_TACTICAL
          || usesPerceptionProfile(this.enemyAiProfile)
          ? { aim: { x: aimX, z: aimZ, interceptTime, leadTime } }
          : {}),
      });
    }
  }

  /** @param {number} simulationTick */
  #advanceDeadBodyLifecycle(simulationTick) {
    if (this.deadBodyProfile !== DEAD_BODY_PROFILE_V1) return;
    const pool = this.dynamicDeadBodies;
    let index = 0;
    while (index < pool.activeCount) {
      const ageTicks = simulationTick - pool.deathTick[index];
      const speed = Math.hypot(pool.vx[index], pool.vz[index]);
      if (
        ageTicks >= DEAD_BODY.fallTicks
        && speed <= DEAD_BODY.quietSpeed
        && pool.touched[index] === 0
      ) {
        pool.quietTickCount[index] = Math.min(
          0xffff,
          pool.quietTickCount[index] + 1,
        );
      } else {
        pool.quietTickCount[index] = 0;
      }
      if (ageTicks >= DEAD_BODY.maximumDynamicTicks) {
        this.#settleDeadBody(index, DEAD_BODY_SETTLE_REASON.timeout, simulationTick);
        continue;
      }
      if (pool.quietTickCount[index] >= DEAD_BODY.quietTicks) {
        this.#settleDeadBody(index, DEAD_BODY_SETTLE_REASON.quiet, simulationTick);
        continue;
      }
      index += 1;
    }
  }

  /** @param {number} index @param {number} reason @param {number} simulationTick */
  #settleDeadBody(index, reason, simulationTick) {
    const pool = this.dynamicDeadBodies;
    this.inertDeadBodies.push({
      id: pool.id[index],
      spawnSequence: pool.spawnSequence[index],
      deathTick: pool.deathTick[index],
      settledTick: simulationTick,
      x: pool.x[index],
      z: pool.z[index],
      facingX: pool.facingX[index],
      facingZ: pool.facingZ[index],
      radius: pool.radius[index],
      massKg: pool.massKg[index],
      settleReason: reason,
    });
    if (reason === DEAD_BODY_SETTLE_REASON.quiet) pool.quietSettles += 1;
    else if (reason === DEAD_BODY_SETTLE_REASON.timeout) pool.timeoutSettles += 1;
    else if (reason === DEAD_BODY_SETTLE_REASON.capacity) pool.forcedSettles += 1;
    pool.removeSwap(index);
  }

  /** @param {number} simulationTick */
  #transferDeadEnemies(simulationTick) {
    let index = 0;
    while (index < this.enemies.activeCount) {
      if (this.enemies.health[index] <= 0) {
        if (this.deadBodyProfile === DEAD_BODY_PROFILE_V1) {
          if (this.dynamicDeadBodies.activeCount >= this.dynamicDeadBodies.capacity) {
            this.#settleDeadBody(
              this.dynamicDeadBodies.oldestIndex(),
              DEAD_BODY_SETTLE_REASON.capacity,
              simulationTick,
            );
          }
          const facingLength = Math.hypot(
            this.enemies.facingX[index],
            this.enemies.facingZ[index],
          );
          const bodyIndex = this.dynamicDeadBodies.spawn({
            id: this.enemies.id[index],
            spawnSequence: this.enemies.spawnSequence[index],
            deathTick: simulationTick,
            x: this.enemies.x[index],
            z: this.enemies.z[index],
            vx: this.enemies.locomotionVx[index] + this.enemies.externalVx[index],
            vz: this.enemies.locomotionVz[index] + this.enemies.externalVz[index],
            facingX: facingLength > 1e-9 ? this.enemies.facingX[index] : 1,
            facingZ: facingLength > 1e-9 ? this.enemies.facingZ[index] : 0,
            radius: this.enemies.radius[index],
            massKg: this.enemies.massKg[index],
          });
          if (bodyIndex < 0) {
            throw new Error("Dynamic dead-body capacity invariant violated");
          }
        }
        this.enemies.removeSwap(index);
      } else {
        index += 1;
      }
    }
  }

  /** @param {number} simulationTick */
  #healthRegenerationSystem(simulationTick) {
    if (this.player.health > 0 && this.player.health < this.player.maximumHealth) {
      if (this.player.lastDamageTick !== simulationTick) this.player.damageFreeTicks += 1;
      if (this.player.damageFreeTicks >= COMBAT.regenerationDelayTicks) {
        this.player.health = Math.min(
          this.player.maximumHealth,
          this.player.health + COMBAT.regenerationPerSecond * SIMULATION.dt,
        );
      }
    }
    const pool = this.enemies;
    for (let index = 0; index < pool.activeCount; index += 1) {
      if (pool.health[index] >= pool.maximumHealth[index]) continue;
      if (pool.lastDamageTick[index] !== simulationTick) pool.damageFreeTicks[index] += 1;
      if (pool.damageFreeTicks[index] >= COMBAT.regenerationDelayTicks) {
        pool.health[index] = Math.min(
          pool.maximumHealth[index],
          pool.health[index] + COMBAT.regenerationPerSecond * SIMULATION.dt,
        );
      }
    }
  }

  /** @param {{x:number,z:number}|null} target @param {number} dt @param {number} simulationTick */
  #prepareMovement(target, dt, simulationTick) {
    const player = this.player;
    let desiredVx = 0;
    let desiredVz = 0;
    let movementMode = PLAYER_MOVEMENT_IDLE;
    let targetDistance = 0;
    let directionX = player.movementDirectionX;
    let directionZ = player.movementDirectionZ;
    if (target) {
      const dx = target.x - player.x;
      const dz = target.z - player.z;
      const length = Math.hypot(dx, dz);
      targetDistance = length;
      if (length > 1e-5) {
        directionX = dx / length;
        directionZ = dz / length;
        movementMode = this.movementSoundProfile === MOVEMENT_SOUND_PROFILE_V1
          && length <= MOVEMENT_SOUND.walkTargetRadiusMeters
          ? PLAYER_MOVEMENT_WALKING
          : PLAYER_MOVEMENT_RUNNING;
        const desiredSpeed = movementMode === PLAYER_MOVEMENT_WALKING
          ? MOVEMENT_SOUND.walkSpeedMetersPerSecond
          : PLAYER.desiredSpeed;
        desiredVx = directionX * desiredSpeed;
        desiredVz = directionZ * desiredSpeed;
      }
    }
    const previousMode = player.movementMode;
    player.movementMode = movementMode;
    player.movementTargetDistance = targetDistance;
    player.movementDirectionX = directionX;
    player.movementDirectionZ = directionZ;
    if (movementMode !== PLAYER_MOVEMENT_RUNNING) {
      player.runningStrideProgress = 0;
      player.runningNextFootstepDistance = MOVEMENT_SOUND.firstFootstepMeters;
      player.lastFootstepHeadingX = directionX;
      player.lastFootstepHeadingZ = directionZ;
      player.lastFootstepTick = 0;
      player.runningStartTick = 0;
    } else if (previousMode !== PLAYER_MOVEMENT_RUNNING) {
      player.runningStrideProgress = 0;
      player.runningNextFootstepDistance = MOVEMENT_SOUND.firstFootstepMeters;
      player.lastFootstepHeadingX = directionX;
      player.lastFootstepHeadingZ = directionZ;
      player.lastFootstepTick = 0;
      player.runningStartTick = simulationTick;
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

  /** @param {number} simulationTick */
  #movementSoundSystem(simulationTick) {
    if (
      this.movementSoundProfile !== MOVEMENT_SOUND_PROFILE_V1
      || this.player.movementMode !== PLAYER_MOVEMENT_RUNNING
    ) {
      return;
    }
    const player = this.player;
    const locomotionSpeed = Math.min(
      PLAYER.desiredSpeed,
      Math.hypot(player.locomotionVx, player.locomotionVz),
    );
    player.runningStrideProgress += locomotionSpeed * SIMULATION.dt;
    const headingDot = player.lastFootstepHeadingX * player.movementDirectionX
      + player.lastFootstepHeadingZ * player.movementDirectionZ;
    const gateTick = player.lastFootstepTick || player.runningStartTick;
    const turnFootstep = locomotionSpeed > 1e-5
      && headingDot <= Math.cos(MOVEMENT_SOUND.turnThresholdRadians) + 1e-9
      && simulationTick - gateTick >= MOVEMENT_SOUND.turnCooldownTicks;
    let reason = SOUND_EVENT_REASON.none;
    if (turnFootstep) {
      reason = SOUND_EVENT_REASON.turn;
      player.runningStrideProgress = 0;
    } else if (
      player.runningStrideProgress + 1e-9
      >= player.runningNextFootstepDistance
    ) {
      reason = SOUND_EVENT_REASON.stride;
      player.runningStrideProgress = Math.max(
        0,
        player.runningStrideProgress - player.runningNextFootstepDistance,
      );
    }
    if (reason === SOUND_EVENT_REASON.none) return;
    player.runningNextFootstepDistance = MOVEMENT_SOUND.runningStrideMeters;
    player.lastFootstepHeadingX = player.movementDirectionX;
    player.lastFootstepHeadingZ = player.movementDirectionZ;
    player.lastFootstepTick = simulationTick;
    this.#queueSoundEvent({
      tick: simulationTick,
      kind: SOUND_EVENT_KIND.footstep,
      reason,
      sourceKind: PROJECTILE_OWNER_KIND.player,
      sourceId: player.id,
      sourceTeam: ACTOR_TEAM.player,
      x: player.x,
      z: player.z,
      radius: MOVEMENT_SOUND.footstepHearingMeters,
    });
  }

  /** @param {{tick:number,kind:number,reason:number,sourceKind:number,sourceId:number,sourceTeam:number,x:number,z:number,radius:number,effectId?:number,projectileId?:number}} value */
  #queueSoundEvent(value) {
    const id = this.soundEvents.push(value);
    if (id === 0) return 0;
    const index = this.soundEvents.activeCount - 1;
    if (this.soundEventHistory.length === this.soundEventHistory.capacity) {
      this.soundEventHistoryDropped += 1;
    }
    this.soundEventHistory.push(this.#soundEventSnapshot(index));
    if (value.kind === SOUND_EVENT_KIND.footstep) {
      this.soundEventMetrics.emittedFootsteps += 1;
    } else if (value.kind === SOUND_EVENT_KIND.fireballImpact) {
      this.soundEventMetrics.emittedFireballImpacts += 1;
    }
    return id;
  }

  /** @param {number} index */
  #soundEventSnapshot(index) {
    const pool = this.soundEvents;
    return {
      id: pool.id[index],
      tick: pool.tick[index],
      kind: SOUND_EVENT_KIND_NAMES[pool.kind[index]] ?? "unknown",
      reason: SOUND_EVENT_REASON_NAMES[pool.reason[index]] ?? "none",
      source: {
        kind: ownerKindName(pool.sourceKind[index]),
        id: pool.sourceId[index],
        team: teamName(pool.sourceTeam[index]),
      },
      x: pool.x[index],
      z: pool.z[index],
      radius: pool.radius[index],
      effectId: pool.effectId[index] || null,
      projectileId: pool.projectileId[index] || null,
    };
  }

  /** @param {number} dt */
  #bodyPhysicsSystem(dt) {
    const player = this.player;
    const enemies = this.enemies;
    const deadBodies = this.dynamicDeadBodies;
    player.previousX = player.x;
    player.previousZ = player.z;
    for (let index = 0; index < enemies.activeCount; index += 1) {
      enemies.previousX[index] = enemies.x[index];
      enemies.previousZ[index] = enemies.z[index];
    }
    for (let index = 0; index < this.rocks.activeCount; index += 1) {
      this.rocks.previousX[index] = this.rocks.x[index];
      this.rocks.previousZ[index] = this.rocks.z[index];
    }
    for (let index = 0; index < deadBodies.activeCount; index += 1) {
      deadBodies.previousX[index] = deadBodies.x[index];
      deadBodies.previousZ[index] = deadBodies.z[index];
      deadBodies.touched[index] = 0;
    }

    const playerDamping = Math.exp(-PLAYER.externalDamping * dt);
    player.externalVx *= playerDamping;
    player.externalVz *= playerDamping;
    const enemyDamping = Math.exp(-ENEMY_WIZARD.externalDamping * dt);
    for (let index = 0; index < enemies.activeCount; index += 1) {
      enemies.externalVx[index] *= enemyDamping;
      enemies.externalVz[index] *= enemyDamping;
      this.#syncEnemyVelocity(index);
    }
    const rockDamping = Math.exp(-ROCK.damping * dt);
    const deadBodyDamping = Math.exp(-DEAD_BODY.damping * dt);
    let maximumSpeed = Math.hypot(
      player.locomotionVx + player.externalVx,
      player.locomotionVz + player.externalVz,
    );
    let minimumRadius = player.radius;
    for (let index = 0; index < enemies.activeCount; index += 1) {
      maximumSpeed = Math.max(maximumSpeed, Math.hypot(enemies.vx[index], enemies.vz[index]));
      minimumRadius = Math.min(minimumRadius, enemies.radius[index]);
    }
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
    for (let index = 0; index < deadBodies.activeCount; index += 1) {
      deadBodies.vx[index] *= deadBodyDamping;
      deadBodies.vz[index] *= deadBodyDamping;
      const speed = Math.hypot(deadBodies.vx[index], deadBodies.vz[index]);
      if (speed > DEAD_BODY.maxSpeed) {
        const scale = DEAD_BODY.maxSpeed / speed;
        deadBodies.vx[index] *= scale;
        deadBodies.vz[index] *= scale;
        deadBodies.speedClamped += 1;
        maximumSpeed = Math.max(maximumSpeed, DEAD_BODY.maxSpeed);
      } else {
        maximumSpeed = Math.max(maximumSpeed, speed);
      }
      minimumRadius = Math.min(minimumRadius, deadBodies.radius[index]);
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
      for (let index = 0; index < enemies.activeCount; index += 1) {
        this.#syncEnemyVelocity(index);
        enemies.x[index] += enemies.vx[index] * stepDt;
        enemies.z[index] += enemies.vz[index] * stepDt;
      }
      for (let index = 0; index < this.rocks.activeCount; index += 1) {
        this.rocks.x[index] += this.rocks.vx[index] * stepDt;
        this.rocks.z[index] += this.rocks.vz[index] * stepDt;
      }
      for (let index = 0; index < deadBodies.activeCount; index += 1) {
        deadBodies.x[index] += deadBodies.vx[index] * stepDt;
        deadBodies.z[index] += deadBodies.vz[index] * stepDt;
      }

      this.#resolvePlayerGrid(substep === 0);
      for (let index = 0; index < enemies.activeCount; index += 1) {
        this.#resolveEnemyGrid(index, substep === 0);
      }
      for (let index = 0; index < this.rocks.activeCount; index += 1) {
        this.#resolveRockGrid(index, substep === 0);
      }
      for (let index = 0; index < deadBodies.activeCount; index += 1) {
        this.#resolveDeadBodyGrid(index, substep === 0);
      }
      for (let pass = 0; pass < DYNAMIC_PHYSICS.solverIterations; pass += 1) {
        const record = substep === 0 && pass === 0;
        this.broadphase.rebuild(
          enemies,
          this.rocks,
          this.projectiles,
          this.dynamicDeadBodies,
        );
        const playerRockRange = player.radius + MAX_ROCK_RADIUS
          + BROADPHASE_CORRECTION_MARGIN;
        const playerRockCount = this.broadphase.queryRocks(
          player.x - playerRockRange,
          player.z - playerRockRange,
          player.x + playerRockRange,
          player.z + playerRockRange,
        );
        for (let candidate = 0; candidate < playerRockCount; candidate += 1) {
          this.#resolvePlayerRock(this.broadphase.rockCandidates[candidate], record);
        }
        const playerEnemyRange = player.radius + ENEMY_WIZARD.radius
          + BROADPHASE_CORRECTION_MARGIN;
        const playerEnemyCount = this.broadphase.queryEnemies(
          player.x - playerEnemyRange,
          player.z - playerEnemyRange,
          player.x + playerEnemyRange,
          player.z + playerEnemyRange,
        );
        for (let candidate = 0; candidate < playerEnemyCount; candidate += 1) {
          this.#resolvePlayerEnemy(this.broadphase.enemyCandidates[candidate], record);
        }
        for (let enemyIndex = 0; enemyIndex < enemies.activeCount; enemyIndex += 1) {
          const enemyRockRange = enemies.radius[enemyIndex] + MAX_ROCK_RADIUS
            + BROADPHASE_CORRECTION_MARGIN;
          const enemyRockCount = this.broadphase.queryRocks(
            enemies.x[enemyIndex] - enemyRockRange,
            enemies.z[enemyIndex] - enemyRockRange,
            enemies.x[enemyIndex] + enemyRockRange,
            enemies.z[enemyIndex] + enemyRockRange,
          );
          for (let candidate = 0; candidate < enemyRockCount; candidate += 1) {
            this.#resolveEnemyRock(
              enemyIndex,
              this.broadphase.rockCandidates[candidate],
              record,
            );
          }
          const enemyRange = enemies.radius[enemyIndex] + ENEMY_WIZARD.radius
            + BROADPHASE_CORRECTION_MARGIN;
          const rightEnemyCount = this.broadphase.queryEnemies(
            enemies.x[enemyIndex] - enemyRange,
            enemies.z[enemyIndex] - enemyRange,
            enemies.x[enemyIndex] + enemyRange,
            enemies.z[enemyIndex] + enemyRange,
            enemyIndex + 1,
          );
          for (let candidate = 0; candidate < rightEnemyCount; candidate += 1) {
            this.#resolveEnemyEnemy(
              enemyIndex,
              this.broadphase.enemyCandidates[candidate],
              record,
            );
          }
        }
        for (let left = 0; left < this.rocks.activeCount; left += 1) {
          const rockRange = this.rocks.radius[left] + MAX_ROCK_RADIUS
            + BROADPHASE_CORRECTION_MARGIN;
          const rightRockCount = this.broadphase.queryRocks(
            this.rocks.x[left] - rockRange,
            this.rocks.z[left] - rockRange,
            this.rocks.x[left] + rockRange,
            this.rocks.z[left] + rockRange,
            left + 1,
          );
          for (let candidate = 0; candidate < rightRockCount; candidate += 1) {
            this.#resolveRockRock(left, this.broadphase.rockCandidates[candidate], record);
          }
        }
        const playerDeadBodyRange = player.radius + ENEMY_WIZARD.radius
          + BROADPHASE_CORRECTION_MARGIN;
        const playerDeadBodyCount = this.broadphase.queryDeadBodies(
          player.x - playerDeadBodyRange,
          player.z - playerDeadBodyRange,
          player.x + playerDeadBodyRange,
          player.z + playerDeadBodyRange,
        );
        for (let candidate = 0; candidate < playerDeadBodyCount; candidate += 1) {
          this.#resolvePlayerDeadBody(
            this.broadphase.deadBodyCandidates[candidate],
            record,
          );
        }
        for (let enemyIndex = 0; enemyIndex < enemies.activeCount; enemyIndex += 1) {
          const range = enemies.radius[enemyIndex] + ENEMY_WIZARD.radius
            + BROADPHASE_CORRECTION_MARGIN;
          const count = this.broadphase.queryDeadBodies(
            enemies.x[enemyIndex] - range,
            enemies.z[enemyIndex] - range,
            enemies.x[enemyIndex] + range,
            enemies.z[enemyIndex] + range,
          );
          for (let candidate = 0; candidate < count; candidate += 1) {
            this.#resolveEnemyDeadBody(
              enemyIndex,
              this.broadphase.deadBodyCandidates[candidate],
              record,
            );
          }
        }
        for (let rockIndex = 0; rockIndex < this.rocks.activeCount; rockIndex += 1) {
          const range = this.rocks.radius[rockIndex] + ENEMY_WIZARD.radius
            + BROADPHASE_CORRECTION_MARGIN;
          const count = this.broadphase.queryDeadBodies(
            this.rocks.x[rockIndex] - range,
            this.rocks.z[rockIndex] - range,
            this.rocks.x[rockIndex] + range,
            this.rocks.z[rockIndex] + range,
          );
          for (let candidate = 0; candidate < count; candidate += 1) {
            this.#resolveRockDeadBody(
              rockIndex,
              this.broadphase.deadBodyCandidates[candidate],
              record,
            );
          }
        }
        for (let left = 0; left < deadBodies.activeCount; left += 1) {
          const range = deadBodies.radius[left] + ENEMY_WIZARD.radius
            + BROADPHASE_CORRECTION_MARGIN;
          const count = this.broadphase.queryDeadBodies(
            deadBodies.x[left] - range,
            deadBodies.z[left] - range,
            deadBodies.x[left] + range,
            deadBodies.z[left] + range,
            left + 1,
          );
          for (let candidate = 0; candidate < count; candidate += 1) {
            this.#resolveDeadBodyDeadBody(
              left,
              this.broadphase.deadBodyCandidates[candidate],
              record,
            );
          }
        }
        this.#resolvePlayerGrid(false);
        for (let index = 0; index < enemies.activeCount; index += 1) {
          this.#resolveEnemyGrid(index, false);
        }
        for (let index = 0; index < this.rocks.activeCount; index += 1) {
          this.#resolveRockGrid(index, false);
        }
        for (let index = 0; index < deadBodies.activeCount; index += 1) {
          this.#resolveDeadBodyGrid(index, false);
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
    for (let index = 0; index < enemies.activeCount; index += 1) {
      this.#syncEnemyVelocity(index);
    }
  }

  #syncPlayerVelocity() {
    this.player.vx = this.player.locomotionVx + this.player.externalVx;
    this.player.vz = this.player.locomotionVz + this.player.externalVz;
  }

  /** @param {number} index */
  #syncEnemyVelocity(index) {
    this.enemies.vx[index] = this.enemies.locomotionVx[index]
      + this.enemies.externalVx[index];
    this.enemies.vz[index] = this.enemies.locomotionVz[index]
      + this.enemies.externalVz[index];
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
  #resolveEnemyGrid(index, record) {
    const pool = this.enemies;
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
      this.#removeInwardEnemyVelocity(index, contact.nx, contact.nz);
      if (record) this.#recordGridContact(BODY_ENEMY_WIZARD, pool.id[index], contact);
    }
  }

  /** @param {number} index @param {number} nx @param {number} nz */
  #removeInwardEnemyVelocity(index, nx, nz) {
    const pool = this.enemies;
    const locomotionInward = pool.locomotionVx[index] * nx + pool.locomotionVz[index] * nz;
    if (locomotionInward < 0) {
      pool.locomotionVx[index] -= nx * locomotionInward;
      pool.locomotionVz[index] -= nz * locomotionInward;
    }
    const externalInward = pool.externalVx[index] * nx + pool.externalVz[index] * nz;
    if (externalInward < 0) {
      pool.externalVx[index] -= nx * externalInward;
      pool.externalVz[index] -= nz * externalInward;
    }
    this.#syncEnemyVelocity(index);
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
  #resolveDeadBodyGrid(index, record) {
    const pool = this.dynamicDeadBodies;
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
          tangentX * (1 - DEAD_BODY.wallFriction)
          - normalSpeed * DEAD_BODY.wallRestitution * contact.nx;
        pool.vz[index] =
          tangentZ * (1 - DEAD_BODY.wallFriction)
          - normalSpeed * DEAD_BODY.wallRestitution * contact.nz;
      }
      if (record) {
        this.#recordGridContact(BODY_ENEMY_WIZARD_BODY, pool.id[index], contact);
      }
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

  /** @param {number} enemyIndex @param {number} rockIndex @param {boolean} record */
  #resolveEnemyRock(enemyIndex, rockIndex, record) {
    const enemies = this.enemies;
    const rocks = this.rocks;
    if (
      !circleCircleContact(
        enemies.x[enemyIndex],
        enemies.z[enemyIndex],
        enemies.radius[enemyIndex],
        rocks.x[rockIndex],
        rocks.z[rockIndex],
        rocks.radius[rockIndex],
        this._bodyContact,
      )
    ) {
      return;
    }
    const contact = this._bodyContact;
    const inverseMassSum = enemies.inverseMass[enemyIndex] + rocks.inverseMass[rockIndex];
    const correction =
      (Math.max(contact.penetration - DYNAMIC_PHYSICS.penetrationSlop, 0)
        * DYNAMIC_PHYSICS.positionCorrection) / inverseMassSum;
    enemies.x[enemyIndex] -= contact.nx * correction * enemies.inverseMass[enemyIndex];
    enemies.z[enemyIndex] -= contact.nz * correction * enemies.inverseMass[enemyIndex];
    rocks.x[rockIndex] += contact.nx * correction * rocks.inverseMass[rockIndex];
    rocks.z[rockIndex] += contact.nz * correction * rocks.inverseMass[rockIndex];

    const actor = this._enemyBodyVelocity;
    actor.vx = enemies.vx[enemyIndex];
    actor.vz = enemies.vz[enemyIndex];
    actor.desiredVx = enemies.desiredVx[enemyIndex];
    actor.desiredVz = enemies.desiredVz[enemyIndex];
    actor.locomotionVx = enemies.locomotionVx[enemyIndex];
    actor.locomotionVz = enemies.locomotionVz[enemyIndex];
    actor.externalVx = enemies.externalVx[enemyIndex];
    actor.externalVz = enemies.externalVz[enemyIndex];
    actor.inverseMass = enemies.inverseMass[enemyIndex];
    const body = this._dynamicBodyVelocity;
    body.vx = rocks.vx[rockIndex];
    body.vz = rocks.vz[rockIndex];
    body.inverseMass = rocks.inverseMass[rockIndex];
    resolvePlayerDynamicBodyVelocity(
      actor,
      body,
      contact.nx,
      contact.nz,
      DYNAMIC_PHYSICS.bodyRestitution,
      DYNAMIC_PHYSICS.bodyFriction,
    );
    enemies.locomotionVx[enemyIndex] = actor.locomotionVx;
    enemies.locomotionVz[enemyIndex] = actor.locomotionVz;
    enemies.externalVx[enemyIndex] = actor.externalVx;
    enemies.externalVz[enemyIndex] = actor.externalVz;
    enemies.vx[enemyIndex] = actor.vx;
    enemies.vz[enemyIndex] = actor.vz;
    rocks.vx[rockIndex] = body.vx;
    rocks.vz[rockIndex] = body.vz;
    if (record) {
      this.#recordBodyContact(
        BODY_ENEMY_WIZARD,
        enemies.id[enemyIndex],
        BODY_ROCK,
        rocks.id[rockIndex],
        contact,
      );
    }
  }

  /** @param {number} enemyIndex @param {boolean} record */
  #resolvePlayerEnemy(enemyIndex, record) {
    const player = this.player;
    const enemies = this.enemies;
    if (
      !circleCircleContact(
        player.x,
        player.z,
        player.radius,
        enemies.x[enemyIndex],
        enemies.z[enemyIndex],
        enemies.radius[enemyIndex],
        this._bodyContact,
      )
    ) {
      return;
    }
    const contact = this._bodyContact;
    const inverseMassSum = player.inverseMass + enemies.inverseMass[enemyIndex];
    const correction =
      (Math.max(contact.penetration - DYNAMIC_PHYSICS.penetrationSlop, 0)
        * DYNAMIC_PHYSICS.positionCorrection) / inverseMassSum;
    player.x -= contact.nx * correction * player.inverseMass;
    player.z -= contact.nz * correction * player.inverseMass;
    enemies.x[enemyIndex] += contact.nx * correction * enemies.inverseMass[enemyIndex];
    enemies.z[enemyIndex] += contact.nz * correction * enemies.inverseMass[enemyIndex];

    this.#syncPlayerVelocity();
    this.#syncEnemyVelocity(enemyIndex);
    let relativeVx = enemies.vx[enemyIndex] - player.vx;
    let relativeVz = enemies.vz[enemyIndex] - player.vz;
    const normalSpeed = relativeVx * contact.nx + relativeVz * contact.nz;
    if (normalSpeed < 0) {
      const impulse =
        (-(1 + DYNAMIC_PHYSICS.bodyRestitution) * normalSpeed) / inverseMassSum;
      const impulseX = impulse * contact.nx;
      const impulseZ = impulse * contact.nz;
      player.externalVx -= impulseX * player.inverseMass;
      player.externalVz -= impulseZ * player.inverseMass;
      enemies.externalVx[enemyIndex] += impulseX * enemies.inverseMass[enemyIndex];
      enemies.externalVz[enemyIndex] += impulseZ * enemies.inverseMass[enemyIndex];
      this.#syncPlayerVelocity();
      this.#syncEnemyVelocity(enemyIndex);
      relativeVx = enemies.vx[enemyIndex] - player.vx;
      relativeVz = enemies.vz[enemyIndex] - player.vz;
      const tangentSpeed = relativeVx * -contact.nz + relativeVz * contact.nx;
      const tangentImpulse = clampMagnitude(
        -tangentSpeed / inverseMassSum,
        impulse * DYNAMIC_PHYSICS.bodyFriction,
      );
      const frictionX = -contact.nz * tangentImpulse;
      const frictionZ = contact.nx * tangentImpulse;
      player.externalVx -= frictionX * player.inverseMass;
      player.externalVz -= frictionZ * player.inverseMass;
      enemies.externalVx[enemyIndex] += frictionX * enemies.inverseMass[enemyIndex];
      enemies.externalVz[enemyIndex] += frictionZ * enemies.inverseMass[enemyIndex];
      this.#syncPlayerVelocity();
      this.#syncEnemyVelocity(enemyIndex);
    }
    if (record) {
      this.#recordBodyContact(
        BODY_PLAYER,
        player.id,
        BODY_ENEMY_WIZARD,
        enemies.id[enemyIndex],
        contact,
      );
    }
  }

  /** @param {number} left @param {number} right @param {boolean} record */
  #resolveEnemyEnemy(left, right, record) {
    const pool = this.enemies;
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
    this.#syncEnemyVelocity(left);
    this.#syncEnemyVelocity(right);
    let relativeVx = pool.vx[right] - pool.vx[left];
    let relativeVz = pool.vz[right] - pool.vz[left];
    const normalSpeed = relativeVx * contact.nx + relativeVz * contact.nz;
    if (normalSpeed < 0) {
      const impulse =
        (-(1 + DYNAMIC_PHYSICS.bodyRestitution) * normalSpeed) / inverseMassSum;
      const impulseX = impulse * contact.nx;
      const impulseZ = impulse * contact.nz;
      pool.externalVx[left] -= impulseX * pool.inverseMass[left];
      pool.externalVz[left] -= impulseZ * pool.inverseMass[left];
      pool.externalVx[right] += impulseX * pool.inverseMass[right];
      pool.externalVz[right] += impulseZ * pool.inverseMass[right];
      this.#syncEnemyVelocity(left);
      this.#syncEnemyVelocity(right);
      relativeVx = pool.vx[right] - pool.vx[left];
      relativeVz = pool.vz[right] - pool.vz[left];
      const tangentSpeed = relativeVx * -contact.nz + relativeVz * contact.nx;
      const tangentImpulse = clampMagnitude(
        -tangentSpeed / inverseMassSum,
        impulse * DYNAMIC_PHYSICS.bodyFriction,
      );
      const frictionX = -contact.nz * tangentImpulse;
      const frictionZ = contact.nx * tangentImpulse;
      pool.externalVx[left] -= frictionX * pool.inverseMass[left];
      pool.externalVz[left] -= frictionZ * pool.inverseMass[left];
      pool.externalVx[right] += frictionX * pool.inverseMass[right];
      pool.externalVz[right] += frictionZ * pool.inverseMass[right];
      this.#syncEnemyVelocity(left);
      this.#syncEnemyVelocity(right);
    }
    if (record) {
      this.#recordBodyContact(
        BODY_ENEMY_WIZARD,
        pool.id[left],
        BODY_ENEMY_WIZARD,
        pool.id[right],
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

  /** @param {number} bodyIndex @param {boolean} record */
  #resolvePlayerDeadBody(bodyIndex, record) {
    const player = this.player;
    const bodies = this.dynamicDeadBodies;
    if (
      !circleCircleContact(
        player.x,
        player.z,
        player.radius,
        bodies.x[bodyIndex],
        bodies.z[bodyIndex],
        bodies.radius[bodyIndex],
        this._bodyContact,
      )
    ) {
      return;
    }
    const contact = this._bodyContact;
    const inverseMassSum = player.inverseMass + bodies.inverseMass[bodyIndex];
    const correction =
      (Math.max(contact.penetration - DYNAMIC_PHYSICS.penetrationSlop, 0)
        * DYNAMIC_PHYSICS.positionCorrection) / inverseMassSum;
    player.x -= contact.nx * correction * player.inverseMass;
    player.z -= contact.nz * correction * player.inverseMass;
    bodies.x[bodyIndex] += contact.nx * correction * bodies.inverseMass[bodyIndex];
    bodies.z[bodyIndex] += contact.nz * correction * bodies.inverseMass[bodyIndex];

    const body = this._dynamicBodyVelocity;
    body.vx = bodies.vx[bodyIndex];
    body.vz = bodies.vz[bodyIndex];
    body.inverseMass = bodies.inverseMass[bodyIndex];
    resolvePlayerDynamicBodyVelocity(
      player,
      body,
      contact.nx,
      contact.nz,
      DYNAMIC_PHYSICS.bodyRestitution,
      DYNAMIC_PHYSICS.bodyFriction,
    );
    bodies.vx[bodyIndex] = body.vx;
    bodies.vz[bodyIndex] = body.vz;
    bodies.touched[bodyIndex] = 1;
    if (record) {
      this.#recordBodyContact(
        BODY_PLAYER,
        player.id,
        BODY_ENEMY_WIZARD_BODY,
        bodies.id[bodyIndex],
        contact,
      );
    }
  }

  /** @param {number} enemyIndex @param {number} bodyIndex @param {boolean} record */
  #resolveEnemyDeadBody(enemyIndex, bodyIndex, record) {
    const enemies = this.enemies;
    const bodies = this.dynamicDeadBodies;
    if (
      !circleCircleContact(
        enemies.x[enemyIndex],
        enemies.z[enemyIndex],
        enemies.radius[enemyIndex],
        bodies.x[bodyIndex],
        bodies.z[bodyIndex],
        bodies.radius[bodyIndex],
        this._bodyContact,
      )
    ) {
      return;
    }
    const contact = this._bodyContact;
    const inverseMassSum = enemies.inverseMass[enemyIndex] + bodies.inverseMass[bodyIndex];
    const correction =
      (Math.max(contact.penetration - DYNAMIC_PHYSICS.penetrationSlop, 0)
        * DYNAMIC_PHYSICS.positionCorrection) / inverseMassSum;
    enemies.x[enemyIndex] -= contact.nx * correction * enemies.inverseMass[enemyIndex];
    enemies.z[enemyIndex] -= contact.nz * correction * enemies.inverseMass[enemyIndex];
    bodies.x[bodyIndex] += contact.nx * correction * bodies.inverseMass[bodyIndex];
    bodies.z[bodyIndex] += contact.nz * correction * bodies.inverseMass[bodyIndex];

    const actor = this._enemyBodyVelocity;
    actor.vx = enemies.vx[enemyIndex];
    actor.vz = enemies.vz[enemyIndex];
    actor.desiredVx = enemies.desiredVx[enemyIndex];
    actor.desiredVz = enemies.desiredVz[enemyIndex];
    actor.locomotionVx = enemies.locomotionVx[enemyIndex];
    actor.locomotionVz = enemies.locomotionVz[enemyIndex];
    actor.externalVx = enemies.externalVx[enemyIndex];
    actor.externalVz = enemies.externalVz[enemyIndex];
    actor.inverseMass = enemies.inverseMass[enemyIndex];
    const body = this._dynamicBodyVelocity;
    body.vx = bodies.vx[bodyIndex];
    body.vz = bodies.vz[bodyIndex];
    body.inverseMass = bodies.inverseMass[bodyIndex];
    resolvePlayerDynamicBodyVelocity(
      actor,
      body,
      contact.nx,
      contact.nz,
      DYNAMIC_PHYSICS.bodyRestitution,
      DYNAMIC_PHYSICS.bodyFriction,
    );
    enemies.locomotionVx[enemyIndex] = actor.locomotionVx;
    enemies.locomotionVz[enemyIndex] = actor.locomotionVz;
    enemies.externalVx[enemyIndex] = actor.externalVx;
    enemies.externalVz[enemyIndex] = actor.externalVz;
    enemies.vx[enemyIndex] = actor.vx;
    enemies.vz[enemyIndex] = actor.vz;
    bodies.vx[bodyIndex] = body.vx;
    bodies.vz[bodyIndex] = body.vz;
    bodies.touched[bodyIndex] = 1;
    if (record) {
      this.#recordBodyContact(
        BODY_ENEMY_WIZARD,
        enemies.id[enemyIndex],
        BODY_ENEMY_WIZARD_BODY,
        bodies.id[bodyIndex],
        contact,
      );
    }
  }

  /** @param {number} rockIndex @param {number} bodyIndex @param {boolean} record */
  #resolveRockDeadBody(rockIndex, bodyIndex, record) {
    const rocks = this.rocks;
    const bodies = this.dynamicDeadBodies;
    if (
      !circleCircleContact(
        rocks.x[rockIndex],
        rocks.z[rockIndex],
        rocks.radius[rockIndex],
        bodies.x[bodyIndex],
        bodies.z[bodyIndex],
        bodies.radius[bodyIndex],
        this._bodyContact,
      )
    ) {
      return;
    }
    const contact = this._bodyContact;
    const inverseMassSum = rocks.inverseMass[rockIndex] + bodies.inverseMass[bodyIndex];
    const correction =
      (Math.max(contact.penetration - DYNAMIC_PHYSICS.penetrationSlop, 0)
        * DYNAMIC_PHYSICS.positionCorrection) / inverseMassSum;
    rocks.x[rockIndex] -= contact.nx * correction * rocks.inverseMass[rockIndex];
    rocks.z[rockIndex] -= contact.nz * correction * rocks.inverseMass[rockIndex];
    bodies.x[bodyIndex] += contact.nx * correction * bodies.inverseMass[bodyIndex];
    bodies.z[bodyIndex] += contact.nz * correction * bodies.inverseMass[bodyIndex];

    const left = this._dynamicBodyVelocity;
    left.vx = rocks.vx[rockIndex];
    left.vz = rocks.vz[rockIndex];
    left.inverseMass = rocks.inverseMass[rockIndex];
    const right = this._secondDynamicBodyVelocity;
    right.vx = bodies.vx[bodyIndex];
    right.vz = bodies.vz[bodyIndex];
    right.inverseMass = bodies.inverseMass[bodyIndex];
    resolveDynamicBodyPairVelocity(
      left,
      right,
      contact.nx,
      contact.nz,
      DYNAMIC_PHYSICS.bodyRestitution,
      DYNAMIC_PHYSICS.bodyFriction,
    );
    rocks.vx[rockIndex] = left.vx;
    rocks.vz[rockIndex] = left.vz;
    bodies.vx[bodyIndex] = right.vx;
    bodies.vz[bodyIndex] = right.vz;
    bodies.touched[bodyIndex] = 1;
    if (record) {
      this.#recordBodyContact(
        BODY_ROCK,
        rocks.id[rockIndex],
        BODY_ENEMY_WIZARD_BODY,
        bodies.id[bodyIndex],
        contact,
      );
    }
  }

  /** @param {number} leftIndex @param {number} rightIndex @param {boolean} record */
  #resolveDeadBodyDeadBody(leftIndex, rightIndex, record) {
    const bodies = this.dynamicDeadBodies;
    if (
      !circleCircleContact(
        bodies.x[leftIndex],
        bodies.z[leftIndex],
        bodies.radius[leftIndex],
        bodies.x[rightIndex],
        bodies.z[rightIndex],
        bodies.radius[rightIndex],
        this._bodyContact,
      )
    ) {
      return;
    }
    const contact = this._bodyContact;
    const inverseMassSum = bodies.inverseMass[leftIndex] + bodies.inverseMass[rightIndex];
    const correction =
      (Math.max(contact.penetration - DYNAMIC_PHYSICS.penetrationSlop, 0)
        * DYNAMIC_PHYSICS.positionCorrection) / inverseMassSum;
    bodies.x[leftIndex] -= contact.nx * correction * bodies.inverseMass[leftIndex];
    bodies.z[leftIndex] -= contact.nz * correction * bodies.inverseMass[leftIndex];
    bodies.x[rightIndex] += contact.nx * correction * bodies.inverseMass[rightIndex];
    bodies.z[rightIndex] += contact.nz * correction * bodies.inverseMass[rightIndex];

    const left = this._dynamicBodyVelocity;
    left.vx = bodies.vx[leftIndex];
    left.vz = bodies.vz[leftIndex];
    left.inverseMass = bodies.inverseMass[leftIndex];
    const right = this._secondDynamicBodyVelocity;
    right.vx = bodies.vx[rightIndex];
    right.vz = bodies.vz[rightIndex];
    right.inverseMass = bodies.inverseMass[rightIndex];
    resolveDynamicBodyPairVelocity(
      left,
      right,
      contact.nx,
      contact.nz,
      DYNAMIC_PHYSICS.bodyRestitution,
      DYNAMIC_PHYSICS.bodyFriction,
    );
    bodies.vx[leftIndex] = left.vx;
    bodies.vz[leftIndex] = left.vz;
    bodies.vx[rightIndex] = right.vx;
    bodies.vz[rightIndex] = right.vz;
    bodies.touched[leftIndex] = 1;
    bodies.touched[rightIndex] = 1;
    if (record) {
      this.#recordBodyContact(
        BODY_ENEMY_WIZARD_BODY,
        bodies.id[leftIndex],
        BODY_ENEMY_WIZARD_BODY,
        bodies.id[rightIndex],
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
      ownerKind: PROJECTILE_OWNER_KIND.player,
      ownerTeam: ACTOR_TEAM.player,
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
      // Successful automatic casts are made explicit in schema-v5-and-newer command
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
      ownerKind: PROJECTILE_OWNER_KIND.player,
      ownerTeam: ACTOR_TEAM.player,
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
    this.broadphase.rebuild(
      this.enemies,
      this.rocks,
      this.projectiles,
      this.dynamicDeadBodies,
    );
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
      const rockPadding = pool.radius[index] + MAX_ROCK_RADIUS;
      const rockCandidateCount = this.broadphase.queryRocks(
        Math.min(startX, startX + deltaX) - rockPadding,
        Math.min(startZ, startZ + deltaZ) - rockPadding,
        Math.max(startX, startX + deltaX) + rockPadding,
        Math.max(startZ, startZ + deltaZ) + rockPadding,
      );
      const enemyPadding = pool.radius[index] + ENEMY_WIZARD.radius;
      const enemyCandidateCount = pool.ownerTeam[index] === ACTOR_TEAM.player
        ? this.broadphase.queryEnemies(
          Math.min(startX, startX + deltaX) - enemyPadding,
          Math.min(startZ, startZ + deltaZ) - enemyPadding,
          Math.max(startX, startX + deltaX) + enemyPadding,
          Math.max(startZ, startZ + deltaZ) + enemyPadding,
        )
        : 0;
      const deadBodyPadding = pool.radius[index] + ENEMY_WIZARD.radius;
      const deadBodyCandidateCount = this.broadphase.queryDeadBodies(
        Math.min(startX, startX + deltaX) - deadBodyPadding,
        Math.min(startZ, startZ + deltaZ) - deadBodyPadding,
        Math.max(startX, startX + deltaX) + deadBodyPadding,
        Math.max(startZ, startZ + deltaZ) + deadBodyPadding,
      );
      let hitKind = "";
      let hitRockIndex = -1;
      let hitActorIndex = -1;
      let hitDeadBodyIndex = -1;
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
        for (let candidate = 0; candidate < rockCandidateCount; candidate += 1) {
          const rockIndex = this.broadphase.rockCandidates[candidate];
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
        for (let candidate = 0; candidate < deadBodyCandidateCount; candidate += 1) {
          const bodyIndex = this.broadphase.deadBodyCandidates[candidate];
          if (
            Math.hypot(
              testX - this.dynamicDeadBodies.x[bodyIndex],
              testZ - this.dynamicDeadBodies.z[bodyIndex],
            ) <= pool.radius[index] + this.dynamicDeadBodies.radius[bodyIndex]
          ) {
            hitKind = "enemyWizardBody";
            hitDeadBodyIndex = bodyIndex;
            hitX = testX;
            hitZ = testZ;
            break;
          }
        }
        if (hitKind) break;
        if (pool.ownerTeam[index] === ACTOR_TEAM.enemy) {
          if (
            Math.hypot(testX - this.player.x, testZ - this.player.z)
            <= pool.radius[index] + this.player.radius
          ) {
            hitKind = "player";
            hitX = testX;
            hitZ = testZ;
          }
        } else if (pool.ownerTeam[index] === ACTOR_TEAM.player) {
          for (let candidate = 0; candidate < enemyCandidateCount; candidate += 1) {
            const enemyIndex = this.broadphase.enemyCandidates[candidate];
            if (
              Math.hypot(
                testX - this.enemies.x[enemyIndex],
                testZ - this.enemies.z[enemyIndex],
              ) <= pool.radius[index] + this.enemies.radius[enemyIndex]
            ) {
              hitKind = "enemyWizard";
              hitActorIndex = enemyIndex;
              hitX = testX;
              hitZ = testZ;
              break;
            }
          }
        }
        if (hitKind) break;
      }

      if (hitKind) {
        const event = this.#createExplosionEvent(
          index,
          hitKind,
          hitRockIndex,
          hitActorIndex,
          hitDeadBodyIndex,
          hitX,
          hitZ,
        );
        this.#applyExplosion(event);
        if (
          this.movementSoundProfile === MOVEMENT_SOUND_PROFILE_V1
          && event.spellId === FIREBALL_SPELL_ID
        ) {
          this.#queueSoundEvent({
            tick: Number(event.tick),
            kind: SOUND_EVENT_KIND.fireballImpact,
            reason: SOUND_EVENT_REASON.impact,
            sourceKind: pool.ownerKind[index],
            sourceId: pool.ownerId[index],
            sourceTeam: pool.ownerTeam[index],
            x: Number(event.originX),
            z: Number(event.originZ),
            radius: PERCEPTIVE_WIZARD.fireballHearingMeters,
            effectId: Number(event.effectId) >>> 0,
            projectileId: Number(event.projectileId) >>> 0,
          });
        } else {
          this.#deliverFireballExplosionHearing(event, pool.ownerTeam[index]);
        }
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

  #deliverQueuedSoundEvents() {
    if (this.enemyAiProfile !== ENEMY_AI_PROFILE_INVESTIGATIVE) return;
    for (let eventIndex = 0; eventIndex < this.soundEvents.activeCount; eventIndex += 1) {
      this.#deliverSoundEvent(eventIndex);
    }
  }

  /** @param {number} eventIndex */
  #deliverSoundEvent(eventIndex) {
    const sounds = this.soundEvents;
    const x = sounds.x[eventIndex];
    const z = sounds.z[eventIndex];
    const radius = sounds.radius[eventIndex];
    const kind = sounds.kind[eventIndex];
    const soundEventId = sounds.id[eventIndex];
    const tick = sounds.tick[eventIndex];
    const candidateCount = this.broadphase.queryEnemies(
      x - radius,
      z - radius,
      x + radius,
      z + radius,
    );
    for (let candidate = 0; candidate < candidateCount; candidate += 1) {
      const index = this.broadphase.enemyCandidates[candidate];
      if (!(this.enemies.health[index] > 0)) continue;
      this.soundEventMetrics.listenerChecks += 1;
      const hearing = soundHearingCheck(
        this.enemies.x[index],
        this.enemies.z[index],
        ACTOR_TEAM.enemy,
        x,
        z,
        sounds.sourceTeam[eventIndex],
        radius,
      );
      if (!hearing.heard) continue;
      const isFootstep = kind === SOUND_EVENT_KIND.footstep;
      if (isFootstep) {
        this.soundEventMetrics.heardFootsteps += 1;
        this.investigationEventMetrics.heardFootsteps += 1;
      } else {
        this.soundEventMetrics.heardFireballImpacts += 1;
        this.investigationEventMetrics.heardExplosions += 1;
      }
      this.#recordPerceptionEvent(
        isFootstep ? "footstep-heard" : "explosion-heard",
        index,
        tick,
        {
          soundEventId,
          soundKind: SOUND_EVENT_KIND_NAMES[kind] ?? "unknown",
          soundReason: SOUND_EVENT_REASON_NAMES[sounds.reason[eventIndex]] ?? "none",
          sound: { x, z },
          ...(isFootstep ? { footstep: { x, z } } : { impact: { x, z } }),
          distance: hearing.distance,
          radius,
          effectId: sounds.effectId[eventIndex] || null,
          projectileId: sounds.projectileId[eventIndex] || null,
        },
      );
      this.#acceptInvestigationClue(index, tick, {
        source: KNOWLEDGE_SOURCE.sound,
        priority: INVESTIGATION_PRIORITY.sound,
        anchor: { x, z },
        observationTick: tick,
        effectId: sounds.effectId[eventIndex],
        projectileId: sounds.projectileId[eventIndex],
        soundEventId,
        soundKind: kind,
        soundRadius: radius,
      });
    }
  }

  /** @param {Record<string,any>} event @param {number} sourceTeam */
  #deliverFireballExplosionHearing(event, sourceTeam) {
    if (
      this.enemyAiProfile !== ENEMY_AI_PROFILE_INVESTIGATIVE
      || event.spellId !== FIREBALL_SPELL_ID
    ) {
      return;
    }
    const x = Number(event.originX);
    const z = Number(event.originZ);
    const radius = PERCEPTIVE_WIZARD.fireballHearingMeters;
    const candidateCount = this.broadphase.queryEnemies(
      x - radius,
      z - radius,
      x + radius,
      z + radius,
    );
    for (let candidate = 0; candidate < candidateCount; candidate += 1) {
      const index = this.broadphase.enemyCandidates[candidate];
      if (!(this.enemies.health[index] > 0)) continue;
      const hearing = fireballHearingCheck(
        this.enemies.x[index],
        this.enemies.z[index],
        ACTOR_TEAM.enemy,
        x,
        z,
        sourceTeam,
        radius,
      );
      if (!hearing.heard) continue;
      this.investigationEventMetrics.heardExplosions += 1;
      this.#recordPerceptionEvent("explosion-heard", index, Number(event.tick), {
        impact: { x, z },
        distance: hearing.distance,
        radius,
        effectId: Number(event.effectId) >>> 0 || null,
        projectileId: Number(event.projectileId) >>> 0 || null,
      });
      this.#acceptInvestigationClue(index, Number(event.tick), {
        source: KNOWLEDGE_SOURCE.sound,
        priority: INVESTIGATION_PRIORITY.sound,
        anchor: { x, z },
        observationTick: Number(event.tick),
        effectId: Number(event.effectId) >>> 0,
        projectileId: Number(event.projectileId) >>> 0,
      });
    }
  }

  /**
   * @param {number} projectileIndex
   * @param {string} hitKind
   * @param {number} rockIndex
   * @param {number} actorIndex
   * @param {number} deadBodyIndex
   * @param {number} hitX
   * @param {number} hitZ
   */
  #createExplosionEvent(
    projectileIndex,
    hitKind,
    rockIndex,
    actorIndex,
    deadBodyIndex,
    hitX,
    hitZ,
  ) {
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
    } else if (
      hitKind === "player"
      || hitKind === "enemyWizard"
      || hitKind === "enemyWizardBody"
    ) {
      const body = hitKind === "player"
        ? this.player
        : hitKind === "enemyWizard"
          ? {
            id: this.enemies.id[actorIndex],
            x: this.enemies.x[actorIndex],
            z: this.enemies.z[actorIndex],
            radius: this.enemies.radius[actorIndex],
          }
          : {
            id: this.dynamicDeadBodies.id[deadBodyIndex],
            x: this.dynamicDeadBodies.x[deadBodyIndex],
            z: this.dynamicDeadBodies.z[deadBodyIndex],
            radius: this.dynamicDeadBodies.radius[deadBodyIndex],
          };
      const dx = hitX - body.x;
      const dz = hitZ - body.z;
      const distance = Math.hypot(dx, dz);
      if (distance > 1e-9) {
        nx = dx / distance;
        nz = dz / distance;
      } else {
        const velocityLength = Math.hypot(pool.vx[projectileIndex], pool.vz[projectileIndex]);
        nx = velocityLength > 0 ? -pool.vx[projectileIndex] / velocityLength : 1;
        nz = velocityLength > 0 ? -pool.vz[projectileIndex] / velocityLength : 0;
      }
      contactX = body.x + nx * body.radius;
      contactZ = body.z + nz * body.radius;
      hit = { kind: hitKind, id: body.id };
    } else {
      cell = { cx: this._gridContact.cx, cz: this._gridContact.cz };
      const obelisk = this.scenario.obeliskAtCell(cell.cx, cell.cz);
      hit = obelisk
        ? { kind: "obelisk", id: obelisk.spawnId, cx: cell.cx, cz: cell.cz }
        : { kind: "cell", cx: cell.cx, cz: cell.cz };
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
      owner: {
        kind: ownerKindName(pool.ownerKind[projectileIndex]),
        id: pool.ownerId[projectileIndex],
        team: teamName(pool.ownerTeam[projectileIndex]),
      },
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
    for (let index = 0; index < this.enemies.activeCount; index += 1) {
      this.#applyExplosionToEnemy(event, index);
    }
    for (let index = 0; index < this.rocks.activeCount; index += 1) {
      this.#applyExplosionToRock(event, index);
    }
    for (let index = 0; index < this.dynamicDeadBodies.activeCount; index += 1) {
      this.#applyExplosionToDeadBody(event, index);
    }
    this.#syncPlayerVelocity();
    for (let index = 0; index < this.enemies.activeCount; index += 1) {
      this.#syncEnemyVelocity(index);
    }
  }

  /** @param {Record<string, any>} event */
  #applyExplosionToPlayer(event) {
    let response = computeExplosionResponse({
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
    const directHit = event.hit?.kind === "player"
      && Number(event.hit.id) === this.player.id;
    if (!response && !directHit) return;
    const hasBlastResponse = Boolean(response);
    response ??= zeroImpulseResponse(
      event,
      this.player.x,
      this.player.z,
      this.player.radius,
    );
    const blocked = hasBlastResponse
      ? gridRayBlocked(
        this.map,
        event.originX,
        event.originZ,
        this.player.x,
        this.player.z,
      )
      : false;
    if (hasBlastResponse && !blocked) {
      this.player.externalVx += response.deltaVx;
      this.player.externalVz += response.deltaVz;
    }
    const damage = this.#combatDamageFor(
      event,
      "player",
      this.player.id,
      "player",
      response.surfaceDistance,
      blocked,
    );
    const healthAfter = damage.amount > 0
      ? this.#damagePlayer(damage.amount, event, damage.kind)
      : this.player.health;
    event.responses.push(
      this.#describeExplosionResponse(
        "player",
        this.player.id,
        this.player.x,
        this.player.z,
        blocked,
        response,
        damage.amount,
        healthAfter,
      ),
    );
  }

  /** @param {Record<string, any>} event @param {number} index */
  #applyExplosionToEnemy(event, index) {
    const pool = this.enemies;
    let response = computeExplosionResponse({
      originX: event.originX,
      originZ: event.originZ,
      bodyX: pool.x[index],
      bodyZ: pool.z[index],
      bodyRadius: pool.radius[index],
      massKg: pool.massKg[index],
      blastRadius: event.radius,
      pressureImpulse: event.pressureImpulse,
      fallbackNx: -event.nx,
      fallbackNz: -event.nz,
    });
    const directHit = event.hit?.kind === "enemyWizard"
      && Number(event.hit.id) === pool.id[index];
    if (!response && !directHit) return;
    const hasBlastResponse = Boolean(response);
    response ??= zeroImpulseResponse(
      event,
      pool.x[index],
      pool.z[index],
      pool.radius[index],
    );
    const blocked = hasBlastResponse
      ? gridRayBlocked(
        this.map,
        event.originX,
        event.originZ,
        pool.x[index],
        pool.z[index],
      )
      : false;
    if (hasBlastResponse && !blocked) {
      pool.externalVx[index] += response.deltaVx;
      pool.externalVz[index] += response.deltaVz;
    }
    const damage = this.#combatDamageFor(
      event,
      "enemyWizard",
      pool.id[index],
      "enemy",
      response.surfaceDistance,
      blocked,
    );
    const healthAfter = damage.amount > 0
      ? this.#damageEnemy(index, damage.amount, event, damage.kind)
      : pool.health[index];
    event.responses.push(
      this.#describeExplosionResponse(
        "enemyWizard",
        pool.id[index],
        pool.x[index],
        pool.z[index],
        blocked,
        response,
        damage.amount,
        healthAfter,
      ),
    );
  }

  /**
   * @param {Record<string, any>} event
   * @param {string} targetKind
   * @param {number} targetId
   * @param {string} targetTeam
   * @param {number} surfaceDistance
   * @param {boolean} blocked
   */
  #combatDamageFor(event, targetKind, targetId, targetTeam, surfaceDistance, blocked) {
    if (event.owner?.team === targetTeam) return { amount: 0, kind: "immune" };
    if (event.hit?.kind === targetKind && Number(event.hit.id) === targetId) {
      return { amount: COMBAT.directDamage, kind: "direct" };
    }
    if (blocked) return { amount: 0, kind: "blocked" };
    if (!(event.radius > 0)) {
      return {
        amount: surfaceDistance <= 0 ? COMBAT.directDamage : 0,
        kind: "splash",
      };
    }
    return {
      amount: COMBAT.directDamage * clamp(1 - surfaceDistance / event.radius, 0, 1),
      kind: "splash",
    };
  }

  /** @param {number} amount @param {Record<string, any>} source @param {string} kind */
  #damagePlayer(amount, source, kind) {
    if (!(amount > 0) || this.player.health <= 0) return this.player.health;
    const before = this.player.health;
    this.player.health = Math.max(0, before - amount);
    this.player.damageFreeTicks = 0;
    this.player.lastDamageTick = this.tickCount + 1;
    this.#recordCombatEvent({
      type: "damage",
      tick: this.tickCount + 1,
      damageKind: kind,
      amount: Math.min(amount, before),
      requestedAmount: amount,
      healthBefore: before,
      healthAfter: this.player.health,
      target: { kind: "player", id: this.player.id, team: "player" },
      owner: source.owner ? { ...source.owner } : null,
      projectileId: source.projectileId ?? null,
      effectId: source.effectId ?? null,
    });
    if (this.player.health === 0) {
      this.#recordCombatEvent({
        type: "death",
        tick: this.tickCount + 1,
        target: { kind: "player", id: this.player.id, team: "player" },
        owner: source.owner ? { ...source.owner } : null,
      });
      this.levelState = "defeated";
      this.defeatedTicksRemaining = COMBAT.defeatedTicks;
      this.#recordCombatEvent({
        type: "defeat",
        tick: this.tickCount + 1,
        restartTicks: COMBAT.defeatedTicks,
        restartSeconds: COMBAT.defeatedTicks / SIMULATION.tickHz,
      });
    }
    return this.player.health;
  }

  /** @param {number} index @param {Record<string,any>} source @param {number} tick */
  #applyUnseenDamageStimulus(index, source, tick) {
    if (this.enemyAiProfile === ENEMY_AI_PROFILE_INVESTIGATIVE) {
      const x = Number.isFinite(Number(source.originX))
        ? Number(source.originX)
        : Number(source.x ?? this.enemies.x[index]);
      const z = Number.isFinite(Number(source.originZ))
        ? Number(source.originZ)
        : Number(source.z ?? this.enemies.z[index]);
      const result = this.#acceptInvestigationClue(index, tick, {
        source: KNOWLEDGE_SOURCE.damage,
        priority: INVESTIGATION_PRIORITY.damage,
        anchor: { x, z },
        observationTick: tick,
        effectId: Number(source.effectId) >>> 0,
        projectileId: Number(source.projectileId) >>> 0,
      }, { immediateSearch: true });
      this.#recordPerceptionEvent("damage-alert", index, tick, {
        stimulus: { x, z },
        accepted: result.decision === INVESTIGATION_DECISION.accept,
        decision: result.decision,
      });
      return;
    }
    if (this.enemyAiProfile !== ENEMY_AI_PROFILE_PERCEPTIVE) return;
    const pool = this.enemies;
    const playerVisible = visualCheck(
      this.map,
      pool.x[index],
      pool.z[index],
      pool.facingX[index],
      pool.facingZ[index],
      this.player.x,
      this.player.z,
    ).visible;
    if (playerVisible || pool.hasLastSeen[index]) return;
    const x = Number.isFinite(Number(source.originX))
      ? Number(source.originX)
      : Number(source.x ?? pool.x[index]);
    const z = Number.isFinite(Number(source.originZ))
      ? Number(source.originZ)
      : Number(source.z ?? pool.z[index]);
    pool.knowledgeSource[index] = KNOWLEDGE_SOURCE.damage;
    pool.confirmedTargetKind[index] = TARGET_KIND.none;
    pool.confirmedTargetId[index] = 0;
    pool.confirmedTargetTeam[index] = 0;
    pool.hasStimulus[index] = 1;
    pool.stimulusX[index] = x;
    pool.stimulusZ[index] = z;
    pool.stimulusTick[index] = tick;
    this.#clearCandidate(index);
    this.#recordPerceptionEvent("damage-alert", index, tick, {
      stimulus: { x, z },
    });
    this.#beginSearch(index, tick, x, z, "damage-alert");
  }

  /** @param {number} index @param {number} amount @param {Record<string, any>} source @param {string} kind */
  #damageEnemy(index, amount, source, kind) {
    const pool = this.enemies;
    if (!(amount > 0) || pool.health[index] <= 0) return pool.health[index];
    const before = pool.health[index];
    pool.health[index] = Math.max(0, before - amount);
    pool.damageFreeTicks[index] = 0;
    pool.lastDamageTick[index] = this.tickCount + 1;
    this.#applyUnseenDamageStimulus(index, source, this.tickCount + 1);
    const target = {
      kind: "enemyWizard",
      id: pool.id[index],
      team: "enemy",
      spawnSequence: pool.spawnSequence[index],
    };
    this.#recordCombatEvent({
      type: "damage",
      tick: this.tickCount + 1,
      damageKind: kind,
      amount: Math.min(amount, before),
      requestedAmount: amount,
      healthBefore: before,
      healthAfter: pool.health[index],
      target,
      owner: source.owner ? { ...source.owner } : null,
      projectileId: source.projectileId ?? null,
      effectId: source.effectId ?? null,
    });
    if (pool.health[index] === 0) {
      this.#recordCombatEvent({
        type: "death",
        tick: this.tickCount + 1,
        target,
        owner: source.owner ? { ...source.owner } : null,
      });
    }
    return pool.health[index];
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

  /** @param {Record<string, any>} event @param {number} index */
  #applyExplosionToDeadBody(event, index) {
    const pool = this.dynamicDeadBodies;
    let response = computeExplosionResponse({
      originX: event.originX,
      originZ: event.originZ,
      bodyX: pool.x[index],
      bodyZ: pool.z[index],
      bodyRadius: pool.radius[index],
      massKg: pool.massKg[index],
      blastRadius: event.radius,
      pressureImpulse: event.pressureImpulse,
      fallbackNx: -event.nx,
      fallbackNz: -event.nz,
    });
    const directHit = event.hit?.kind === "enemyWizardBody"
      && Number(event.hit.id) === pool.id[index];
    if (!response && !directHit) return;
    const hasBlastResponse = Boolean(response);
    response ??= zeroImpulseResponse(
      event,
      pool.x[index],
      pool.z[index],
      pool.radius[index],
    );
    const blocked = hasBlastResponse
      ? gridRayBlocked(
        this.map,
        event.originX,
        event.originZ,
        pool.x[index],
        pool.z[index],
      )
      : false;
    if (hasBlastResponse && !blocked) {
      pool.vx[index] += response.deltaVx;
      pool.vz[index] += response.deltaVz;
      const speed = Math.hypot(pool.vx[index], pool.vz[index]);
      if (speed > DEAD_BODY.maxSpeed) {
        const scale = DEAD_BODY.maxSpeed / speed;
        pool.vx[index] *= scale;
        pool.vz[index] *= scale;
        pool.speedClamped += 1;
      }
    }
    pool.touched[index] = 1;
    event.responses.push(
      this.#describeExplosionResponse(
        "enemyWizardBody",
        pool.id[index],
        pool.x[index],
        pool.z[index],
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
   * @param {number} [damage]
   * @param {number|null} [healthAfter]
   */
  #describeExplosionResponse(kind, id, x, z, blocked, response, damage = 0, healthAfter = null) {
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
      damage,
      healthAfter,
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

  encounterDiagnostics() {
    const snapshot = this.snapshot();
    return {
      schemaVersion: snapshot.schemaVersion,
      gameplayProfile: snapshot.gameplayProfile,
      enemyAiProfile: snapshot.enemyAiProfile,
      movementSoundProfile: snapshot.movementSoundProfile,
      tick: snapshot.tick,
      level: cloneUnknown(snapshot.level),
      encounter: cloneUnknown(snapshot.encounter),
      navigation: cloneUnknown(snapshot.navigation),
      player: {
        id: snapshot.player.id,
        health: snapshot.player.health,
        maximumHealth: snapshot.player.maximumHealth,
        regeneration: cloneUnknown(snapshot.player.regeneration),
        movement: cloneUnknown(snapshot.player.movement),
      },
      enemies: snapshot.enemies.map((enemy) => ({
        id: enemy.id,
        spawnSequence: enemy.spawnSequence,
        spawnTick: enemy.spawnTick,
        position: { x: enemy.x, z: enemy.z },
        velocity: { x: enemy.vx, z: enemy.vz },
        health: enemy.health,
        maximumHealth: enemy.maximumHealth,
        regeneration: cloneUnknown(enemy.regeneration),
        cooldowns: { ...enemy.cooldowns },
        castSequence: enemy.castSequence,
        shotReadyTick: enemy.shotReadyTick,
        ticksUntilShot: enemy.ticksUntilShot,
        aiState: enemy.aiState,
        behaviorState: enemy.behaviorState,
        movementGoal: cloneUnknown(enemy.movementGoal),
        navigationField: cloneUnknown(enemy.navigationField),
        strafe: cloneUnknown(enemy.strafe),
        predictedAimPoint: cloneUnknown(enemy.predictedAimPoint),
        aimLeadTime: enemy.aimLeadTime,
        trackedThreatEffectId: enemy.trackedThreatEffectId,
        dodge: cloneUnknown(enemy.dodge),
        retreating: enemy.retreating,
        lineOfSight: enemy.lineOfSight,
        ...(enemy.perceptionState
          ? {
            perceptionState: enemy.perceptionState,
            knowledgeSource: enemy.knowledgeSource,
            currentVisibility: enemy.currentVisibility,
            visibilitySampleTick: enemy.visibilitySampleTick,
            perceptionLane: enemy.perceptionLane,
            exposure: cloneUnknown(enemy.exposure),
            facing: cloneUnknown(enemy.facing),
            candidateTarget: cloneUnknown(enemy.candidateTarget),
            confirmedTarget: cloneUnknown(enemy.confirmedTarget),
            guard: cloneUnknown(enemy.guard),
            lastSeen: cloneUnknown(enemy.lastSeen),
            stimulus: cloneUnknown(enemy.stimulus),
            ...(enemy.investigation
              ? { investigation: cloneUnknown(enemy.investigation) }
              : {}),
            hunt: cloneUnknown(enemy.hunt),
          }
          : {}),
      })),
      recentCombatEvents: snapshot.recentCombatEvents.map(cloneUnknown),
      combatEventMetrics: { ...snapshot.combatEventMetrics },
      recentPerceptionEvents: snapshot.recentPerceptionEvents.map(cloneUnknown),
      perceptionEventMetrics: { ...snapshot.perceptionEventMetrics },
      soundEvents: cloneUnknown(snapshot.soundEvents),
      soundEventMetrics: { ...snapshot.soundEventMetrics },
      ...(snapshot.investigationEventMetrics
        ? { investigationEventMetrics: { ...snapshot.investigationEventMetrics } }
        : {}),
    };
  }

  /** @param {number} index */
  #enemyBehaviorState(index) {
    if (usesPerceptionProfile(this.enemyAiProfile)) {
      if (this.enemies.aiState[index] === ENEMY_AI_DODGE) return "dodge";
      if (this.enemies.aiState[index] === ENEMY_AI_RETREAT) return "retreat";
      const state = this.enemies.perceptionState[index];
      if (state === PERCEPTION_STATE.engaged) {
        return ENEMY_AI_STATE_NAMES_TACTICAL[this.enemies.aiState[index]] ?? "engage";
      }
      return PERCEPTION_STATE_NAMES[state] ?? "unaware";
    }
    const names = (
      this.enemyAiProfile === ENEMY_AI_PROFILE_TACTICAL
      || usesPerceptionProfile(this.enemyAiProfile)
    )
      ? ENEMY_AI_STATE_NAMES_TACTICAL
      : ENEMY_AI_STATE_NAMES_BASIC;
    return names[this.enemies.aiState[index]] ?? names[0];
  }

  /** @param {number} index */
  #enemyMovementGoal(index) {
    const kindCode = this.enemies.movementGoalKind[index];
    const x = this.enemies.movementGoalX[index];
    const z = this.enemies.movementGoalZ[index];
    if (
      kindCode === ENEMY_GOAL_NONE
      || !Number.isFinite(x)
      || !Number.isFinite(z)
    ) {
      return null;
    }
    return {
      kind: ENEMY_GOAL_NAMES[kindCode] ?? "none",
      x,
      z,
      cell: kindCode === ENEMY_GOAL_NAVIGATION
        ? {
          cx: this.enemies.movementGoalCx[index],
          cz: this.enemies.movementGoalCz[index],
        }
        : null,
    };
  }

  /** @param {number} index */
  #enemyTacticalState(index) {
    const pool = this.enemies;
    const navigationCost = pool.navigationCost[index];
    const aimX = pool.predictedAimX[index];
    const aimZ = pool.predictedAimZ[index];
    const destination = usesPerceptionProfile(this.enemyAiProfile)
      ? this.destinationFields.slotDiagnostics(pool.navigationSlot[index])
      : null;
    return {
      behaviorState: this.#enemyBehaviorState(index),
      movementGoal: this.#enemyMovementGoal(index),
      navigationField: {
        slot: destination?.slot ?? null,
        key: destination?.key ?? null,
        cost: navigationCost === NAVIGATION_UNREACHABLE ? null : navigationCost,
        version: pool.navigationVersion[index],
        stale: destination?.stale ?? false,
        building: destination?.building ?? false,
        completed: destination?.completed ?? false,
      },
      strafe: {
        direction: pool.strafeDirection[index] > 0
          ? "left"
          : pool.strafeDirection[index] < 0
            ? "right"
            : null,
        directionCode: pool.strafeDirection[index],
        decisionSequence: pool.strafeDecisionSequence[index],
        changeTick: pool.strafeChangeTick[index] || null,
        ticksUntilChange: pool.strafeChangeTick[index]
          ? Math.max(0, pool.strafeChangeTick[index] - this.tickCount)
          : null,
      },
      predictedAimPoint: Number.isFinite(aimX) && Number.isFinite(aimZ)
        ? { x: aimX, z: aimZ }
        : null,
      aimInterceptTime: pool.aimInterceptTime[index],
      aimLeadTime: pool.aimLeadTime[index],
      trackedThreatEffectId: pool.trackedThreatEffectId[index] || null,
      trackedThreatProjectileId: pool.trackedThreatProjectileId[index] || null,
      dodge: {
        ticksRemaining: pool.dodgeTicksRemaining[index],
        cooldownTicks: pool.dodgeCooldownTicks[index],
        side: pool.dodgeSide[index] > 0
          ? "left"
          : pool.dodgeSide[index] < 0
            ? "right"
            : null,
        direction: pool.dodgeSide[index] === 0
          ? null
          : {
            x: pool.dodgeDirectionX[index],
            z: pool.dodgeDirectionZ[index],
          },
      },
      retreating: Boolean(pool.retreating[index]),
    };
  }

  /** @param {number} kind @param {number} id @param {number} team */
  #targetSnapshot(kind, id, team) {
    if (!(kind > 0) || !(id > 0)) return null;
    return {
      kind: TARGET_KIND_NAMES[kind] ?? "unknown",
      kindCode: kind,
      id,
      team: teamName(team),
      teamCode: team,
    };
  }

  /** @param {number} index */
  #enemyPerceptionState(index) {
    const pool = this.enemies;
    const state = pool.perceptionState[index];
    const hasLastSeen = Boolean(pool.hasLastSeen[index]);
    const hasSearchGoal = Boolean(pool.hasSearchGoal[index]);
    const hasStimulus = Boolean(pool.hasStimulus[index]);
    const hasInvestigation = this.enemyAiProfile === ENEMY_AI_PROFILE_INVESTIGATIVE
      && pool.investigationPriority[index] > INVESTIGATION_PRIORITY.none;
    return {
      perceptionState: PERCEPTION_STATE_NAMES[state] ?? "unaware",
      perceptionStateCode: state,
      knowledgeSource: KNOWLEDGE_SOURCE_NAMES[pool.knowledgeSource[index]] ?? "none",
      knowledgeSourceCode: pool.knowledgeSource[index],
      currentVisibility: Boolean(pool.currentVisibility[index]),
      visibilitySampleTick: pool.visibilitySampleTick[index] || null,
      perceptionLane: pool.perceptionLane[index],
      exposure: {
        progressTicks: pool.exposureProgress[index],
        thresholdTicks: PERCEPTIVE_WIZARD.exposureTicks,
        startTick: pool.exposureStartTick[index] || null,
      },
      facing: { x: pool.facingX[index], z: pool.facingZ[index] },
      candidateTarget: this.#targetSnapshot(
        pool.candidateTargetKind[index],
        pool.candidateTargetId[index],
        pool.candidateTargetTeam[index],
      ),
      confirmedTarget: this.#targetSnapshot(
        pool.confirmedTargetKind[index],
        pool.confirmedTargetId[index],
        pool.confirmedTargetTeam[index],
      ),
      guard: {
        point: { x: pool.guardX[index], z: pool.guardZ[index] },
        baseHeading: {
          x: pool.guardBaseFacingX[index],
          z: pool.guardBaseFacingZ[index],
        },
        sweepPhaseTicks: pool.guardSweepPhase[index],
        returnStartTick: pool.guardReturnStartTick[index] || null,
        unreachableStartTick: pool.guardUnreachableStartTick[index] || null,
        unreachableTimeoutTick: pool.guardUnreachableStartTick[index]
          ? pool.guardUnreachableStartTick[index] + PERCEPTIVE_WIZARD.travelTimeoutTicks
          : null,
      },
      lastSeen: hasLastSeen
        ? {
          position: { x: pool.lastSeenX[index], z: pool.lastSeenZ[index] },
          velocity: { x: pool.lastSeenVx[index], z: pool.lastSeenVz[index] },
          tick: pool.lastSeenTick[index],
        }
        : null,
      stimulus: hasStimulus
        ? {
          position: { x: pool.stimulusX[index], z: pool.stimulusZ[index] },
          tick: pool.stimulusTick[index],
        }
        : null,
      ...(this.enemyAiProfile === ENEMY_AI_PROFILE_INVESTIGATIVE
        ? {
          investigation: {
            active: hasInvestigation,
            source: KNOWLEDGE_SOURCE_NAMES[pool.investigationSource[index]] ?? "none",
            sourceCode: pool.investigationSource[index],
            priority: pool.investigationPriority[index],
            anchor: hasInvestigation
              && Number.isFinite(pool.investigationAnchorX[index])
              && Number.isFinite(pool.investigationAnchorZ[index])
              ? {
                x: pool.investigationAnchorX[index],
                z: pool.investigationAnchorZ[index],
              }
              : null,
            observationTick: pool.investigationObservationTick[index] || null,
            acceptedTick: pool.investigationAcceptedTick[index] || null,
            effectId: pool.investigationEffectId[index] || null,
            projectileId: pool.investigationProjectileId[index] || null,
            sound: pool.investigationSource[index] === KNOWLEDGE_SOURCE.sound
              ? {
                eventId: pool.investigationSoundEventId[index] || null,
                kind: pool.investigationSoundKind[index] > SOUND_EVENT_KIND.none
                  ? SOUND_EVENT_KIND_NAMES[pool.investigationSoundKind[index]] ?? "unknown"
                  : "fireball-impact",
                radius: pool.investigationSoundRadius[index]
                  || PERCEPTIVE_WIZARD.fireballHearingMeters,
              }
              : null,
            projectileObservation: Number.isFinite(pool.investigationProjectileX[index])
              && Number.isFinite(pool.investigationProjectileZ[index])
              ? {
                position: {
                  x: pool.investigationProjectileX[index],
                  z: pool.investigationProjectileZ[index],
                },
                velocity: {
                  x: pool.investigationProjectileVx[index],
                  z: pool.investigationProjectileVz[index],
                },
                age: pool.investigationProjectileAge[index],
              }
              : null,
            inferredOrigin: Number.isFinite(pool.investigationOriginX[index])
              && Number.isFinite(pool.investigationOriginZ[index])
              ? {
                x: pool.investigationOriginX[index],
                z: pool.investigationOriginZ[index],
              }
              : null,
          },
        }
        : {}),
      hunt: {
        phase: HUNT_PHASE_NAMES[pool.huntPhase[index]] ?? "none",
        phaseCode: pool.huntPhase[index],
        anchor: Number.isFinite(pool.huntAnchorX[index])
          && Number.isFinite(pool.huntAnchorZ[index])
          ? { x: pool.huntAnchorX[index], z: pool.huntAnchorZ[index] }
          : null,
        travelStartTick: pool.huntTravelStartTick[index] || null,
        travelTimeoutTick: pool.huntTravelStartTick[index]
          ? pool.huntTravelStartTick[index] + PERCEPTIVE_WIZARD.travelTimeoutTicks
          : null,
        searchStartTick: pool.searchStartTick[index] || null,
        searchEndTick: pool.searchEndTick[index] || null,
        searchTicksRemaining: pool.searchEndTick[index]
          ? Math.max(0, pool.searchEndTick[index] - this.tickCount)
          : null,
        searchGoal: hasSearchGoal
          ? {
            x: pool.searchGoalX[index],
            z: pool.searchGoalZ[index],
            cell: { cx: pool.searchGoalCx[index], cz: pool.searchGoalCz[index] },
            startTick: pool.searchGoalStartTick[index],
            timeoutTick: pool.searchGoalStartTick[index]
              + PERCEPTIVE_WIZARD.searchGoalTimeoutTicks,
          }
          : null,
        sequence: pool.searchSequence[index],
      },
    };
  }

  /** @param {number} [id] */
  enemyDiagnostics(id) {
    const snapshot = this.snapshot();
    const requestedId = id === undefined ? null : Number(id);
    return {
      schemaVersion: snapshot.schemaVersion,
      tick: snapshot.tick,
      enemyAiProfile: snapshot.enemyAiProfile,
      movementSoundProfile: snapshot.movementSoundProfile,
      navigation: cloneUnknown(snapshot.navigation),
      recentPerceptionEvents: snapshot.recentPerceptionEvents.map(cloneUnknown),
      perceptionEventMetrics: { ...snapshot.perceptionEventMetrics },
      soundEvents: cloneUnknown(snapshot.soundEvents),
      soundEventMetrics: { ...snapshot.soundEventMetrics },
      ...(snapshot.investigationEventMetrics
        ? { investigationEventMetrics: { ...snapshot.investigationEventMetrics } }
        : {}),
      enemies: snapshot.enemies
        .filter((enemy) => requestedId === null || enemy.id === requestedId)
        .map(cloneUnknown),
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

    const obelisks = this.scenario.entities
      .filter((entity) => entity.kind === "obelisk")
      .map((entity) => ({
        kind: "obelisk",
        id: entity.spawnId,
        spawnId: entity.spawnId,
        x: entity.x,
        z: entity.z,
        cell: { cx: Math.floor(entity.x), cz: Math.floor(entity.z) },
        solid: true,
        invulnerable: true,
      }));

    const enemies = new Array(this.enemies.activeCount);
    for (let index = 0; index < enemies.length; index += 1) {
      const health = this.enemies.health[index];
      const maximumHealth = this.enemies.maximumHealth[index];
      const damageFreeTicks = this.enemies.damageFreeTicks[index];
      const tacticalState = this.#enemyTacticalState(index);
      const perceptionState = usesPerceptionProfile(this.enemyAiProfile)
        ? this.#enemyPerceptionState(index)
        : null;
      enemies[index] = {
        kind: "enemyWizard",
        id: this.enemies.id[index],
        index,
        spawnSequence: this.enemies.spawnSequence[index],
        spawnTick: this.enemies.spawnTick[index],
        x: this.enemies.x[index],
        z: this.enemies.z[index],
        previousX: this.enemies.previousX[index],
        previousZ: this.enemies.previousZ[index],
        vx: this.enemies.vx[index],
        vz: this.enemies.vz[index],
        desiredVx: this.enemies.desiredVx[index],
        desiredVz: this.enemies.desiredVz[index],
        locomotionVx: this.enemies.locomotionVx[index],
        locomotionVz: this.enemies.locomotionVz[index],
        externalVx: this.enemies.externalVx[index],
        externalVz: this.enemies.externalVz[index],
        radius: this.enemies.radius[index],
        massKg: this.enemies.massKg[index],
        team: "enemy",
        health,
        maximumHealth,
        damageFreeTicks,
        lastDamageTick: this.enemies.lastDamageTick[index],
        regeneration: {
          delayTicks: COMBAT.regenerationDelayTicks,
          damageFreeTicks,
          ratePerSecond: COMBAT.regenerationPerSecond,
          active: health > 0
            && health < maximumHealth
            && damageFreeTicks >= COMBAT.regenerationDelayTicks,
        },
        cooldowns: { [FIREBALL_SPELL_ID]: this.enemies.cooldown[index] },
        castSequence: this.enemies.castSequence[index],
        shotReadyTick: this.enemies.shotReadyTick[index],
        ticksUntilShot: Math.max(
          0,
          this.enemies.shotReadyTick[index] - this.tickCount,
        ),
        aiState: tacticalState.behaviorState,
        ...tacticalState,
        ...(perceptionState ?? {}),
        lineOfSight: Boolean(this.enemies.lineOfSight[index]),
      };
    }

    const dynamicDeadBodies = new Array(this.dynamicDeadBodies.activeCount);
    for (let index = 0; index < dynamicDeadBodies.length; index += 1) {
      dynamicDeadBodies[index] = {
        kind: "enemyWizardBody",
        id: this.dynamicDeadBodies.id[index],
        index,
        spawnSequence: this.dynamicDeadBodies.spawnSequence[index],
        phase: "dynamic",
        interacting: true,
        deathTick: this.dynamicDeadBodies.deathTick[index],
        settledTick: null,
        settleReason: null,
        ageTicks: this.tickCount - this.dynamicDeadBodies.deathTick[index],
        x: this.dynamicDeadBodies.x[index],
        z: this.dynamicDeadBodies.z[index],
        previousX: this.dynamicDeadBodies.previousX[index],
        previousZ: this.dynamicDeadBodies.previousZ[index],
        vx: this.dynamicDeadBodies.vx[index],
        vz: this.dynamicDeadBodies.vz[index],
        facing: {
          x: this.dynamicDeadBodies.facingX[index],
          z: this.dynamicDeadBodies.facingZ[index],
        },
        radius: this.dynamicDeadBodies.radius[index],
        massKg: this.dynamicDeadBodies.massKg[index],
        quietTickCount: this.dynamicDeadBodies.quietTickCount[index],
      };
    }
    const inertDeadBodies = new Array(this.inertDeadBodies.length);
    for (let ordinal = 0; ordinal < inertDeadBodies.length; ordinal += 1) {
      const index = this.inertDeadBodies.storageIndex(ordinal);
      inertDeadBodies[ordinal] = {
        kind: "enemyWizardBody",
        id: this.inertDeadBodies.id[index],
        index: ordinal,
        spawnSequence: this.inertDeadBodies.spawnSequence[index],
        phase: "inert",
        interacting: false,
        deathTick: this.inertDeadBodies.deathTick[index],
        settledTick: this.inertDeadBodies.settledTick[index],
        settleReason:
          DEAD_BODY_SETTLE_REASON_NAMES[this.inertDeadBodies.settleReason[index]] ?? null,
        ageTicks: this.tickCount - this.inertDeadBodies.deathTick[index],
        x: this.inertDeadBodies.x[index],
        z: this.inertDeadBodies.z[index],
        previousX: this.inertDeadBodies.x[index],
        previousZ: this.inertDeadBodies.z[index],
        vx: 0,
        vz: 0,
        facing: {
          x: this.inertDeadBodies.facingX[index],
          z: this.inertDeadBodies.facingZ[index],
        },
        radius: this.inertDeadBodies.radius[index],
        massKg: this.inertDeadBodies.massKg[index],
        quietTickCount: DEAD_BODY.quietTicks,
      };
    }

    const projectiles = new Array(this.projectiles.activeCount);
    for (let index = 0; index < projectiles.length; index += 1) {
      projectiles[index] = {
        kind: "projectile",
        id: this.projectiles.id[index],
        ownerId: this.projectiles.ownerId[index],
        ownerKind: ownerKindName(this.projectiles.ownerKind[index]),
        ownerTeam: teamName(this.projectiles.ownerTeam[index]),
        owner: {
          kind: ownerKindName(this.projectiles.ownerKind[index]),
          id: this.projectiles.ownerId[index],
          team: teamName(this.projectiles.ownerTeam[index]),
        },
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
    const recentCombatEvents = this.combatEvents
      .toArray(COMBAT.snapshotEventCount)
      .map(cloneUnknown);
    const recentPerceptionEvents = this.perceptionEvents
      .toArray(PERCEPTIVE_WIZARD.perceptionSnapshotEventCount)
      .map(cloneUnknown);
    const currentSoundEvents = new Array(this.soundEvents.activeCount);
    for (let index = 0; index < currentSoundEvents.length; index += 1) {
      currentSoundEvents[index] = this.#soundEventSnapshot(index);
    }
    const recentSoundEvents = this.soundEventHistory
      .toArray(MOVEMENT_SOUND.snapshotEventCount)
      .map(cloneUnknown);
    return {
      schemaVersion: SCHEMA_VERSION,
      seed: this.seed,
      rngState: this.rng.state,
      tick: this.tickCount,
      gameplayProfile: this.gameplayProfile,
      enemyAiProfile: this.enemyAiProfile,
      deadBodyProfile: this.deadBodyProfile,
      movementSoundProfile: this.movementSoundProfile,
      navigation: usesPerceptionProfile(this.enemyAiProfile)
        ? this.destinationFields.diagnostics(this.mapRevision)
        : {
          mapRevision: this.mapRevision,
          ...this.navigationField.diagnostics(
            this.mapRevision,
            Math.floor(this.player.x),
            Math.floor(this.player.z),
          ),
        },
      level: {
        state: this.levelState,
        defeatedTicksRemaining: this.defeatedTicksRemaining,
        defeatedSecondsRemaining: this.defeatedTicksRemaining / SIMULATION.tickHz,
      },
      encounter: {
        enabled: this.encounter.enabled,
        spawnIntervalTicks: ENEMY_WIZARD.spawnIntervalTicks,
        nextSpawnTick: this.encounter.nextSpawnTick,
        ticksUntilSpawn: this.encounter.enabled
          ? Math.max(0, this.encounter.nextSpawnTick - this.tickCount)
          : null,
        spawnCursor: this.encounter.spawnCursor,
        nextDirection: SPAWN_OFFSETS[this.encounter.spawnCursor].name,
        attempts: this.encounter.attempts,
        successfulSpawns: this.encounter.successfulSpawns,
        skippedAttempts: {
          blocked: this.encounter.skippedBlocked,
          capped: this.encounter.skippedCapped,
        },
        nextSpawnSequence: this.encounter.nextSpawnSequence,
        alive: this.enemies.activeCount,
        capacity: this.enemies.capacity,
        maximumAlive: this.encounterMaximumAlive,
      },
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
        movementMode: PLAYER_MOVEMENT_MODE_NAMES[this.player.movementMode] ?? "idle",
        movementModeCode: this.player.movementMode,
        movement: {
          mode: PLAYER_MOVEMENT_MODE_NAMES[this.player.movementMode] ?? "idle",
          targetDistanceMeters: this.player.movementTargetDistance,
          walkTargetRadiusMeters: MOVEMENT_SOUND.walkTargetRadiusMeters,
          walkSpeedMetersPerSecond: MOVEMENT_SOUND.walkSpeedMetersPerSecond,
          runSpeedMetersPerSecond: PLAYER.desiredSpeed,
          strideProgressMeters: this.player.runningStrideProgress,
          nextFootstepDistanceMeters: Math.max(
            0,
            this.player.runningNextFootstepDistance
              - this.player.runningStrideProgress,
          ),
          lastFootstepTick: this.player.lastFootstepTick || null,
        },
        regeneration: {
          delayTicks: COMBAT.regenerationDelayTicks,
          damageFreeTicks: this.player.damageFreeTicks,
          ratePerSecond: COMBAT.regenerationPerSecond,
          active: this.player.health > 0
            && this.player.health < this.player.maximumHealth
            && this.player.damageFreeTicks >= COMBAT.regenerationDelayTicks,
        },
        cooldowns: Object.fromEntries(
          this.spells.list().map((spell) => [
            spell.id,
            this.spellCooldowns[spell.code],
          ]),
        ),
        castSequences: Object.fromEntries(
          this.spells.list().map((spell) => [
            spell.id,
            this.castSequences[spell.code],
          ]),
        ),
      },
      spells: this.spells.snapshotTable(
        this.#spellRevisionReferences(recentEvents),
      ),
      rocks,
      obelisks,
      enemies,
      deadBodies: {
        dynamic: dynamicDeadBodies,
        inert: inertDeadBodies,
      },
      projectiles,
      particles,
      contacts,
      contactMetrics: {
        dropped: this.contacts.dropped,
      },
      recentEvents,
      recentCombatEvents,
      recentPerceptionEvents,
      soundEvents: {
        current: currentSoundEvents,
        recent: recentSoundEvents,
      },
      combatEventMetrics: {
        retained: this.combatEvents.length,
        capacity: this.combatEvents.capacity,
        dropped: this.combatEventDropped,
      },
      perceptionEventMetrics: {
        retained: this.perceptionEvents.length,
        capacity: this.perceptionEvents.capacity,
        dropped: this.perceptionEventDropped,
      },
      soundEventMetrics: {
        ...this.soundEventMetrics,
        retained: this.soundEventHistory.length,
        historyCapacity: this.soundEventHistory.capacity,
        historyDropped: this.soundEventHistoryDropped,
        queueDropped: this.soundEvents.dropped,
        maximumEventsPerTick: this.soundEvents.maximumEventsPerTick,
      },
      ...(this.enemyAiProfile === ENEMY_AI_PROFILE_INVESTIGATIVE
        ? { investigationEventMetrics: { ...this.investigationEventMetrics } }
        : {}),
      broadphase: this.broadphase.diagnostics(),
      pools: {
        rocks: {
          active: this.rocks.activeCount,
          capacity: this.rocks.capacity,
          dropped: this.rocks.dropped,
          speedClamped: this.rocks.speedClamped,
        },
        enemies: {
          active: this.enemies.activeCount,
          capacity: this.enemies.capacity,
          dropped: this.enemies.dropped,
        },
        dynamicDeadBodies: {
          active: this.dynamicDeadBodies.activeCount,
          capacity: this.dynamicDeadBodies.capacity,
          forcedSettles: this.dynamicDeadBodies.forcedSettles,
          quietSettles: this.dynamicDeadBodies.quietSettles,
          timeoutSettles: this.dynamicDeadBodies.timeoutSettles,
          speedClamped: this.dynamicDeadBodies.speedClamped,
        },
        inertDeadBodies: {
          active: this.inertDeadBodies.length,
          capacity: this.inertDeadBodies.capacity,
          overwritten: this.inertDeadBodies.overwritten,
        },
        projectiles: {
          active: this.projectiles.activeCount,
          capacity: this.projectiles.capacity,
          dropped: this.projectiles.dropped,
        },
        soundEvents: {
          active: this.soundEvents.activeCount,
          capacity: this.soundEvents.capacity,
          dropped: this.soundEvents.dropped,
          maximumPerTick: this.soundEvents.maximumEventsPerTick,
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
    for (let index = 0; index < this.enemies.activeCount; index += 1) {
      const distance = Math.hypot(x - this.enemies.x[index], z - this.enemies.z[index]);
      if (distance <= this.enemies.radius[index] + 0.08 && distance < bestDistance) {
        best = this.#describeEnemy(index);
        bestDistance = distance;
      }
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
    const obelisk = this.scenario.obeliskAtCell(cx, cz);
    if (obelisk) return this.#describeObelisk(obelisk);
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
    if (selection.kind === "enemyWizard") {
      const index = this.enemies.findIndexById(Number(selection.id));
      return index < 0 ? null : this.#describeEnemy(index);
    }
    if (selection.kind === "obelisk") {
      const obelisk = this.scenario.entities.find(
        (entity) => entity.kind === "obelisk" && entity.spawnId === Number(selection.id),
      );
      return obelisk ? this.#describeObelisk(obelisk) : null;
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
      team: "player",
      health: this.player.health,
      maximumHealth: this.player.maximumHealth,
      regeneration: {
        delayTicks: COMBAT.regenerationDelayTicks,
        damageFreeTicks: this.player.damageFreeTicks,
        ratePerSecond: COMBAT.regenerationPerSecond,
        active: this.player.health > 0
          && this.player.health < this.player.maximumHealth
          && this.player.damageFreeTicks >= COMBAT.regenerationDelayTicks,
      },
      cooldowns: Object.fromEntries(
        this.spells.list().map((spell) => [spell.id, this.spellCooldowns[spell.code]]),
      ),
      castSequences: Object.fromEntries(
        this.spells.list().map((spell) => [spell.id, this.castSequences[spell.code]]),
      ),
      movement: {
        mode: PLAYER_MOVEMENT_MODE_NAMES[this.player.movementMode] ?? "idle",
        targetDistanceMeters: this.player.movementTargetDistance,
        strideProgressMeters: this.player.runningStrideProgress,
        nextFootstepDistanceMeters: Math.max(
          0,
          this.player.runningNextFootstepDistance
            - this.player.runningStrideProgress,
        ),
        lastFootstepTick: this.player.lastFootstepTick || null,
      },
      cell: null,
      age: null,
      lifetime: null,
      flags: { coolingDown: this.player.cooldown > 0 },
      raw: { ...this.player },
    };
  }

  /** @param {number} index */
  #describeEnemy(index) {
    const health = this.enemies.health[index];
    const maximumHealth = this.enemies.maximumHealth[index];
    const damageFreeTicks = this.enemies.damageFreeTicks[index];
    const tacticalState = this.#enemyTacticalState(index);
    const perceptionState = usesPerceptionProfile(this.enemyAiProfile)
      ? this.#enemyPerceptionState(index)
      : null;
    return {
      kind: "enemyWizard",
      id: this.enemies.id[index],
      index,
      spawnSequence: this.enemies.spawnSequence[index],
      spawnTick: this.enemies.spawnTick[index],
      position: { x: this.enemies.x[index], y: 0, z: this.enemies.z[index] },
      velocity: { x: this.enemies.vx[index], y: 0, z: this.enemies.vz[index] },
      desiredVelocity: {
        x: this.enemies.desiredVx[index],
        y: 0,
        z: this.enemies.desiredVz[index],
      },
      locomotionVelocity: {
        x: this.enemies.locomotionVx[index],
        y: 0,
        z: this.enemies.locomotionVz[index],
      },
      externalVelocity: {
        x: this.enemies.externalVx[index],
        y: 0,
        z: this.enemies.externalVz[index],
      },
      radius: this.enemies.radius[index],
      massKg: this.enemies.massKg[index],
      health,
      maximumHealth,
      team: "enemy",
      cooldowns: { [FIREBALL_SPELL_ID]: this.enemies.cooldown[index] },
      castSequence: this.enemies.castSequence[index],
      shotReadyTick: this.enemies.shotReadyTick[index],
      aiState: tacticalState.behaviorState,
      ...tacticalState,
      ...(perceptionState ?? {}),
      lineOfSight: Boolean(this.enemies.lineOfSight[index]),
      regeneration: {
        delayTicks: COMBAT.regenerationDelayTicks,
        damageFreeTicks,
        ratePerSecond: COMBAT.regenerationPerSecond,
        active: health > 0
          && health < maximumHealth
          && damageFreeTicks >= COMBAT.regenerationDelayTicks,
      },
      cell: null,
      age: null,
      lifetime: null,
      flags: {
        coolingDown: this.enemies.cooldown[index] > 0,
        lineOfSight: Boolean(this.enemies.lineOfSight[index]),
        retreating: tacticalState.retreating,
        dodging: tacticalState.dodge.ticksRemaining > 0,
      },
    };
  }

  /** @param {{spawnId:number,x:number,z:number}} obelisk */
  #describeObelisk(obelisk) {
    const cx = Math.floor(obelisk.x);
    const cz = Math.floor(obelisk.z);
    return {
      kind: "obelisk",
      id: obelisk.spawnId,
      index: this.scenario.entities.findIndex((entity) => entity === obelisk),
      spawnId: obelisk.spawnId,
      position: { x: obelisk.x, y: 0, z: obelisk.z },
      velocity: null,
      radius: Math.SQRT1_2,
      massKg: null,
      cell: { cx, cz, tile: 1, inBounds: true },
      age: null,
      lifetime: null,
      flags: { authored: true, solid: true, protected: true, invulnerable: true },
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
      ownerKind: ownerKindName(this.projectiles.ownerKind[index]),
      ownerTeam: teamName(this.projectiles.ownerTeam[index]),
      owner: {
        kind: ownerKindName(this.projectiles.ownerKind[index]),
        id: this.projectiles.ownerId[index],
        team: teamName(this.projectiles.ownerTeam[index]),
      },
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
    for (let index = 0; index < this.enemies.activeCount; index += 1) {
      if (
        Math.hypot(x - this.enemies.x[index], z - this.enemies.z[index]) <
        definition.radius + this.enemies.radius[index]
      ) {
        return false;
      }
    }
    for (let index = 0; index < this.dynamicDeadBodies.activeCount; index += 1) {
      if (
        Math.hypot(
          x - this.dynamicDeadBodies.x[index],
          z - this.dynamicDeadBodies.z[index],
        ) < definition.radius + this.dynamicDeadBodies.radius[index]
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
        enemyCapacity: this.commandLogEnemyCapacity,
        encounterMaximumAlive: this.commandLogEncounterMaximumAlive,
        projectileCapacity: this.projectiles.capacity,
        particleCapacity: this.particles.capacity,
        particleBurstCount: this.particleBurstCount,
        particleProfile: this.commandLogParticleProfile,
        particleBounce: this.commandLogParticleBounce,
        particleWallCollision: this.commandLogParticleWallCollision,
        spells: cloneUnknown(this.commandLogSpellBaseline),
        gameplayProfile: this.commandLogGameplayProfile,
        enemyAiProfile: this.commandLogEnemyAiProfile,
        deadBodyProfile: this.commandLogDeadBodyProfile,
        movementSoundProfile: this.commandLogMovementSoundProfile,
        soundEventCapacity: this.commandLogSoundEventCapacity,
        dynamicDeadBodyCapacity: this.commandLogDynamicDeadBodyCapacity,
        inertDeadBodyCapacity: this.commandLogInertDeadBodyCapacity,
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
    const recordingSchema = Number(recording.schemaVersion);
    if (!Number.isInteger(recordingSchema) || recordingSchema < 2 || recordingSchema > 11) {
      throw new RangeError(`Unsupported recording schema: ${recording.schemaVersion}`);
    }
    const scenario = ArenaScenario.fromJSON(recording.initialScenario ?? recording.initialMap);
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
      throw new TypeError(`Schema-v${recordingSchema} recording is missing its spell baseline`);
    }
    let gameplayProfile = GAMEPLAY_PROFILE_PRE_COMBAT;
    let enemyAiProfile = ENEMY_AI_PROFILE_NONE;
    let deadBodyProfile = DEAD_BODY_PROFILE_NONE;
    let movementSoundProfile = MOVEMENT_SOUND_PROFILE_NONE;
    let soundEventCapacity;
    let dynamicDeadBodyCapacity = DEAD_BODY.dynamicCapacity;
    let inertDeadBodyCapacity = DEAD_BODY.inertCapacity;
    if (recordingSchema === 6) {
      gameplayProfile = String(recording.configuration?.gameplayProfile ?? "");
      enemyAiProfile = String(recording.configuration?.enemyAiProfile ?? "");
      const validProfiles = (
        gameplayProfile === GAMEPLAY_PROFILE_OBELISK_DUEL
        && enemyAiProfile === ENEMY_AI_PROFILE_BASIC
      ) || (
        gameplayProfile === GAMEPLAY_PROFILE_PRE_COMBAT
        && enemyAiProfile === ENEMY_AI_PROFILE_NONE
      );
      if (!validProfiles) {
        throw new TypeError("Schema-v6 recording has invalid or missing gameplay profiles");
      }
    } else if (recordingSchema === 7) {
      gameplayProfile = String(recording.configuration?.gameplayProfile ?? "");
      enemyAiProfile = String(recording.configuration?.enemyAiProfile ?? "");
      const validProfiles = (
        gameplayProfile === GAMEPLAY_PROFILE_OBELISK_DUEL
        && enemyAiProfile === ENEMY_AI_PROFILE_TACTICAL
      ) || (
        gameplayProfile === GAMEPLAY_PROFILE_PRE_COMBAT
        && enemyAiProfile === ENEMY_AI_PROFILE_NONE
      );
      if (!validProfiles) {
        throw new TypeError("Schema-v7 recording has invalid or missing gameplay profiles");
      }
    } else if (recordingSchema === 8) {
      gameplayProfile = String(recording.configuration?.gameplayProfile ?? "");
      enemyAiProfile = String(recording.configuration?.enemyAiProfile ?? "");
      const validProfiles = (
        gameplayProfile === GAMEPLAY_PROFILE_OBELISK_DUEL
        && enemyAiProfile === ENEMY_AI_PROFILE_PERCEPTIVE
      ) || (
        gameplayProfile === GAMEPLAY_PROFILE_PRE_COMBAT
        && enemyAiProfile === ENEMY_AI_PROFILE_NONE
      );
      if (!validProfiles) {
        throw new TypeError("Schema-v8 recording has invalid or missing gameplay profiles");
      }
      if (
        gameplayProfile === GAMEPLAY_PROFILE_OBELISK_DUEL
        && (
          Number(recording.configuration?.enemyCapacity) !== ENEMY_WIZARD.capacity
          || Number(recording.configuration?.encounterMaximumAlive)
            !== ENEMY_WIZARD.encounterMaximumAlive
        )
      ) {
        throw new TypeError("Schema-v8 recording has invalid enemy capacity metadata");
      }
    } else if (
      recordingSchema === 9
      || recordingSchema === 10
      || recordingSchema === 11
    ) {
      gameplayProfile = String(recording.configuration?.gameplayProfile ?? "");
      enemyAiProfile = String(recording.configuration?.enemyAiProfile ?? "");
      const validProfiles = (
        gameplayProfile === GAMEPLAY_PROFILE_OBELISK_DUEL
        && enemyAiProfile === ENEMY_AI_PROFILE_INVESTIGATIVE
      ) || (
        gameplayProfile === GAMEPLAY_PROFILE_PRE_COMBAT
        && enemyAiProfile === ENEMY_AI_PROFILE_NONE
      );
      if (!validProfiles) {
        throw new TypeError(
          `Schema-v${recordingSchema} recording has invalid or missing gameplay profiles`,
        );
      }
      if (
        gameplayProfile === GAMEPLAY_PROFILE_OBELISK_DUEL
        && (
          Number(recording.configuration?.enemyCapacity) !== ENEMY_WIZARD.capacity
          || Number(recording.configuration?.encounterMaximumAlive)
            !== ENEMY_WIZARD.encounterMaximumAlive
        )
      ) {
        throw new TypeError(
          `Schema-v${recordingSchema} recording has invalid enemy capacity metadata`,
        );
      }
      if (recordingSchema >= 10) {
        deadBodyProfile = String(recording.configuration?.deadBodyProfile ?? "");
        dynamicDeadBodyCapacity = Number(
          recording.configuration?.dynamicDeadBodyCapacity,
        );
        inertDeadBodyCapacity = Number(
          recording.configuration?.inertDeadBodyCapacity,
        );
        if (deadBodyProfile !== DEAD_BODY_PROFILE_V1) {
          throw new TypeError(
            `Schema-v${recordingSchema} recording has invalid or missing dead-body profile`,
          );
        }
        if (
          !Number.isInteger(dynamicDeadBodyCapacity)
          || dynamicDeadBodyCapacity <= 0
          || dynamicDeadBodyCapacity > DEAD_BODY.maximumDynamicCapacity
          || !Number.isInteger(inertDeadBodyCapacity)
          || inertDeadBodyCapacity <= 0
          || inertDeadBodyCapacity > DEAD_BODY.maximumInertCapacity
        ) {
          throw new TypeError(
            `Schema-v${recordingSchema} recording has invalid dead-body capacities`,
          );
        }
      }
      if (recordingSchema === 11) {
        movementSoundProfile = String(
          recording.configuration?.movementSoundProfile ?? "",
        );
        if (movementSoundProfile !== MOVEMENT_SOUND_PROFILE_V1) {
          throw new TypeError(
            "Schema-v11 recording has invalid or missing movement-sound profile",
          );
        }
        soundEventCapacity = Number(recording.configuration?.soundEventCapacity);
        if (
          !Number.isInteger(soundEventCapacity)
          || soundEventCapacity <= 0
        ) {
          throw new TypeError("Schema-v11 recording has invalid sound-event capacity");
        }
      }
    }
    const enemyCapacity = recordingSchema >= 8
      ? Number(recording.configuration?.enemyCapacity ?? ENEMY_WIZARD.capacity)
      : ENEMY_WIZARD.legacyCapacity;
    const encounterMaximumAlive = recordingSchema >= 8
      ? Number(
        recording.configuration?.encounterMaximumAlive
        ?? ENEMY_WIZARD.encounterMaximumAlive,
      )
      : ENEMY_WIZARD.legacyCapacity;
    const projectileCapacity = recording.configuration?.projectileCapacity
      ?? (recordingSchema >= 8 ? PROJECTILE.capacity : PROJECTILE.legacyCapacity);
    const simulation = new Simulation({
      seed: recording.seed,
      scenario,
      rockCapacity: recording.configuration?.rockCapacity,
      enemyCapacity,
      encounterMaximumAlive,
      projectileCapacity,
      particleCapacity: recording.configuration?.particleCapacity,
      particleBurstCount: recording.configuration?.particleBurstCount,
      particleProfile,
      particleBounce,
      particleWallCollision,
      spellBaseline,
      legacyFireballMode: recordingSchema < 5,
      gameplayProfile,
      enemyAiProfile,
      deadBodyProfile,
      movementSoundProfile,
      soundEventCapacity,
      dynamicDeadBodyCapacity,
      inertDeadBodyCapacity,
    });
    for (const entry of recording.commands) simulation.tick(entry.command);
    return simulation;
  }
}
