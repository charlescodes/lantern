// @ts-check

export const SCHEMA_VERSION = 1;
export const MAP_VERSION = 1;

export const SIMULATION = Object.freeze({
  tickHz: 60,
  dt: 1 / 60,
  maxFrameSeconds: 0.25,
});

export const WORLD = Object.freeze({
  width: 24,
  height: 24,
  pixelsPerMeter: 32,
});

export const PLAYER = Object.freeze({
  radius: 0.3,
  desiredSpeed: 4.5,
  acceleration: 22,
  braking: 28,
});

export const PROJECTILE = Object.freeze({
  capacity: 128,
  radius: 0.12,
  speed: 9,
  lifetime: 2,
  cooldown: 0.2,
  spawnGap: 0.02,
});

export const PARTICLE = Object.freeze({
  capacity: 4096,
  burstCount: 224,
  gravity: -9.81,
  initialY: 0.1,
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
  particleStems: true,
  particleBounce: false,
});
