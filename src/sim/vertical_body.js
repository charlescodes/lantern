// @ts-check

export const VERTICAL_MODE = Object.freeze({
  SUPPORTED: 1,
  FALLING: 2,
  JUMPING: 3,
  LEVITATING: 4,
});

export const VERTICAL_MODE_NAMES = Object.freeze([
  "none",
  "supported",
  "falling",
  "jumping",
  "levitating",
]);

export const SUPPORT_KIND = Object.freeze({
  NONE: 0,
  FLOOR: 1,
  ELEVATOR: 2,
});

export const SUPPORT_KIND_NAMES = Object.freeze([
  "none",
  "floor",
  "elevator",
]);

export const VERTICAL_CAPABILITY = Object.freeze({
  GRAVITY: 1 << 0,
  FLOOR_SUPPORT: 1 << 1,
  ELEVATOR_SUPPORT: 1 << 2,
  AIRBORNE_LOW_PASS: 1 << 3,
  CAN_RIDE_ELEVATOR: 1 << 4,
  CAN_JUMP: 1 << 6,
  CAN_PRESS_PLATE: 1 << 7,
});

export const DEFAULT_ACTOR_VERTICAL_CAPABILITIES =
  VERTICAL_CAPABILITY.GRAVITY
  | VERTICAL_CAPABILITY.FLOOR_SUPPORT
  | VERTICAL_CAPABILITY.ELEVATOR_SUPPORT
  | VERTICAL_CAPABILITY.CAN_RIDE_ELEVATOR
  | VERTICAL_CAPABILITY.CAN_JUMP
  | VERTICAL_CAPABILITY.CAN_PRESS_PLATE;

export const DEFAULT_PROP_VERTICAL_CAPABILITIES =
  VERTICAL_CAPABILITY.GRAVITY
  | VERTICAL_CAPABILITY.FLOOR_SUPPORT
  | VERTICAL_CAPABILITY.ELEVATOR_SUPPORT
  | VERTICAL_CAPABILITY.AIRBORNE_LOW_PASS
  | VERTICAL_CAPABILITY.CAN_RIDE_ELEVATOR
  | VERTICAL_CAPABILITY.CAN_PRESS_PLATE;

/** @param {number} flags @param {number} capability */
export function hasVerticalCapability(flags, capability) {
  return (flags & capability) === capability;
}

/**
 * Adds the generic vertical columns used by an existing bounded SoA pool.
 * Pool lifecycle code remains responsible for spawn defaults and swap removal.
 * @param {Record<string, any>} pool
 * @param {number} capacity
 */
export function installVerticalBodyColumns(pool, capacity) {
  pool.worldY = new Float32Array(capacity);
  pool.previousWorldY = new Float32Array(capacity);
  pool.verticalVelocityY = new Float32Array(capacity);
  pool.verticalMode = new Uint8Array(capacity);
  pool.supportKind = new Uint8Array(capacity);
  pool.supportId = new Uint32Array(capacity);
  pool.layerIndex = new Uint16Array(capacity);
  pool.transitConnectorId = new Uint32Array(capacity);
  pool.verticalCapabilities = new Uint16Array(capacity);
  pool.latestApertureFit = new Int8Array(capacity);
}

/**
 * @param {Record<string, any>} pool
 * @param {number} index
 * @param {Record<string, any>} value
 * @param {number} [defaultCapabilities]
 */
export function initializeVerticalBody(
  pool,
  index,
  value,
  defaultCapabilities = DEFAULT_PROP_VERTICAL_CAPABILITIES,
) {
  const worldY = Number(value.worldY ?? 0);
  pool.worldY[index] = worldY;
  pool.previousWorldY[index] = worldY;
  pool.verticalVelocityY[index] = Number(value.verticalVelocityY ?? 0);
  pool.verticalMode[index] = Number(value.verticalMode ?? VERTICAL_MODE.SUPPORTED);
  pool.supportKind[index] = Number(value.supportKind ?? SUPPORT_KIND.FLOOR);
  pool.supportId[index] = Number(value.supportId ?? 0) >>> 0;
  pool.layerIndex[index] = Number(value.layerIndex ?? 0);
  pool.transitConnectorId[index] = Number(value.transitConnectorId ?? 0) >>> 0;
  pool.verticalCapabilities[index] = Number(
    value.verticalCapabilities ?? defaultCapabilities,
  );
  pool.latestApertureFit[index] = 0;
}

/** @param {Record<string, any>} pool @param {number} target @param {number} source */
export function copyVerticalBody(pool, target, source) {
  pool.worldY[target] = pool.worldY[source];
  pool.previousWorldY[target] = pool.previousWorldY[source];
  pool.verticalVelocityY[target] = pool.verticalVelocityY[source];
  pool.verticalMode[target] = pool.verticalMode[source];
  pool.supportKind[target] = pool.supportKind[source];
  pool.supportId[target] = pool.supportId[source];
  pool.layerIndex[target] = pool.layerIndex[source];
  pool.transitConnectorId[target] = pool.transitConnectorId[source];
  pool.verticalCapabilities[target] = pool.verticalCapabilities[source];
  pool.latestApertureFit[target] = pool.latestApertureFit[source];
}
