// @ts-check

export const SCHEMA_VERSION = 5;
export const MAP_VERSION = 1;
export const SCENARIO_VERSION = 2;
export const APPLICATION_VERSION = "0.5.0";

export const SIMULATION = Object.freeze({
  tickHz: 60,
  dt: 1 / 60,
  maxFrameSeconds: 0.25,
});

export const WORLD = Object.freeze({
  width: 24,
  height: 24,
});

export const PLAYER = Object.freeze({
  radius: 0.3,
  massKg: 75,
  desiredSpeed: 4.5,
  acceleration: 22,
  braking: 28,
  externalDamping: 2,
});

export const PROJECTILE = Object.freeze({
  capacity: 128,
  radius: 0.12,
  speed: 9,
  lifetime: 4,
  cooldown: 0.2,
  spawnGap: 0.02,
});

export const PARTICLE = Object.freeze({
  capacity: 4096,
  burstCount: 224,
  gravity: -9.81,
  initialY: 0.1,
  minimumSize: 0.025,
  maximumSize: 0.085,
  maximumHorizontalSpeed: 7,
  wallNormalRetention: 0.8,
  wallTangentialRetention: 0.95,
  maximumWallContactsPerTick: 4,
  wallSeparationEpsilon: 1e-5,
  spawnCorrectionPasses: 8,
});

export const PARTICLE_PROFILE_M02 = "m0.2";
export const PARTICLE_PROFILE_M0_2_5 = "m0.2.5-balanced";
const PARTICLE_PROFILE_M0_25_TYPO = "m0.25-balanced";
export const DEFAULT_PARTICLE_PROFILE = PARTICLE_PROFILE_M0_2_5;

/** @param {unknown} value */
export function normalizeParticleProfile(value) {
  const profile = String(value);
  return profile === PARTICLE_PROFILE_M0_25_TYPO
    ? PARTICLE_PROFILE_M0_2_5
    : profile;
}

export const PARTICLE_PROFILES = Object.freeze({
  [PARTICLE_PROFILE_M02]: Object.freeze({
    verticalMinimum: 2.2,
    verticalRange: 5.3,
    verticalPower: 1,
    lifetimeMinimum: 0.25,
    lifetimeMaximum: 0.8,
    lifetimeBase: 0.525,
    lifetimeSizeScale: 0,
    lifetimeJitter: 0.55,
    shrinkExponent: 0,
    groundVerticalRetention: 0.35,
    groundHorizontalRetention: 0.75,
    groundSettlesAfterBounce: false,
    defaultGroundBounce: false,
  }),
  [PARTICLE_PROFILE_M0_2_5]: Object.freeze({
    verticalMinimum: 0.6,
    verticalRange: 5.9,
    verticalPower: 2,
    lifetimeMinimum: 0.18,
    lifetimeMaximum: 1.1,
    lifetimeBase: 0.22,
    lifetimeSizeScale: 0.83,
    lifetimeJitter: 0.12,
    shrinkExponent: 0.65,
    groundVerticalRetention: 0.45,
    groundHorizontalRetention: 0.82,
    groundSettlesAfterBounce: true,
    defaultGroundBounce: true,
  }),
});

export const ROCK_DENSITY_KG_M3 = 2_600;

/** @param {number} radius */
export function sphereMassKg(radius) {
  return (4 / 3) * Math.PI * radius ** 3 * ROCK_DENSITY_KG_M3;
}

export const ROCK_ARCHETYPES = Object.freeze({
  small: Object.freeze({ code: 1, radius: 0.1, massKg: sphereMassKg(0.1) }),
  medium: Object.freeze({ code: 2, radius: 0.3, massKg: sphereMassKg(0.3) }),
  large: Object.freeze({ code: 3, radius: 0.9, massKg: sphereMassKg(0.9) }),
});

export const ROCK = Object.freeze({
  capacity: 64,
  damping: 1.5,
  settleSpeed: 0.02,
  maxSpeed: 20,
  wallRestitution: 0.18,
  wallFriction: 0.2,
});

export const DYNAMIC_PHYSICS = Object.freeze({
  solverIterations: 4,
  penetrationSlop: 0.001,
  positionCorrection: 0.8,
  bodyRestitution: 0.1,
  bodyFriction: 0.35,
  maximumSubsteps: 8,
  travelRadiusFraction: 0.5,
});

export const EXPLOSION = Object.freeze({
  radius: 2.5,
  pressureImpulse: 800,
  originEpsilon: 0.0001,
  debugTicks: 12,
});

export const HISTORY = Object.freeze({
  commands: 36_000,
  events: 256,
  metrics: 1_024,
});

export const DEFAULT_DEBUG_FLAGS = Object.freeze({
  gridCoordinates: true,
  velocityVectors: true,
  contacts: true,
  explosionForces: true,
  particleStems: true,
  particleBounce: true,
  particleWallCollision: true,
});
