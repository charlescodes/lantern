// @ts-check

const LANE_HASHES = Object.freeze({
  angle: 0x3c6ef372,
  speed: 0xa54ff53a,
  bias: 0x510e527f,
  vertical: 0x9b05688c,
  lifetime: 0x1f83d9ab,
  size: 0x5be0cd19,
  hue: 0xcbbb9d5d,
  brightness: 0x629a292a,
  saturation: 0x9159015a,
});

/** @param {number} value */
export function mixUint32(value) {
  let hash = Number(value) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 16), 0x21f0aaad);
  hash = Math.imul(hash ^ (hash >>> 15), 0x735a2d97);
  return (hash ^ (hash >>> 15)) >>> 0;
}

/**
 * Stable automatic variation seed. Cast sequence is incremented only after a
 * projectile spawn succeeds, so rejected casts do not consume this sequence.
 *
 * @param {number} simulationSeed
 * @param {number} spellCode
 * @param {number} castSequence
 */
export function deriveCastSeed(simulationSeed, spellCode, castSequence) {
  let hash = mixUint32((Number(simulationSeed) >>> 0) ^ 0x9e3779b9);
  hash = mixUint32(hash ^ Math.imul(Number(spellCode) >>> 0, 0x85ebca6b));
  return mixUint32(hash ^ Math.imul(Number(castSequence) >>> 0, 0xc2b2ae35));
}

/**
 * Enemy casts have a separate domain and a caster-local sequence. Adding or
 * removing another enemy therefore cannot perturb either player variation or
 * an existing enemy's future casts.
 *
 * @param {number} simulationSeed
 * @param {number} spawnSequence
 * @param {number} spellCode
 * @param {number} castSequence
 */
export function deriveEnemyCastSeed(
  simulationSeed,
  spawnSequence,
  spellCode,
  castSequence,
) {
  let hash = mixUint32((Number(simulationSeed) >>> 0) ^ 0xe11e_6d79);
  hash = mixUint32(hash ^ Math.imul(Number(spawnSequence) >>> 0, 0x27d4_eb2d));
  hash = mixUint32(hash ^ Math.imul(Number(spellCode) >>> 0, 0x1656_67b1));
  return mixUint32(hash ^ Math.imul(Number(castSequence) >>> 0, 0xd3a2_646c));
}

/** @param {number} effectSeed @param {number} ordinal */
export function deriveSampleSeed(effectSeed, ordinal) {
  return mixUint32(
    (Number(effectSeed) >>> 0)
    ^ Math.imul((Number(ordinal) + 1) >>> 0, 0x9e3779b1),
  );
}

/** @param {number} seed @param {keyof typeof LANE_HASHES|string} lane */
export function laneUint32(seed, lane) {
  const laneHash = LANE_HASHES[/** @type {keyof typeof LANE_HASHES} */ (lane)];
  if (laneHash === undefined) throw new RangeError(`Unknown random lane: ${lane}`);
  return mixUint32((Number(seed) >>> 0) ^ laneHash);
}

/** @param {number} seed @param {keyof typeof LANE_HASHES|string} lane */
export function laneUnit(seed, lane) {
  return laneUint32(seed, lane) / 0x1_0000_0000;
}

/** @param {number} seed @param {keyof typeof LANE_HASHES|string} lane */
export function laneSignedUnit(seed, lane) {
  return laneUnit(seed, lane) * 2 - 1;
}
