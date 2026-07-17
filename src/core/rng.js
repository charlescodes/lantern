// @ts-check

const NON_ZERO_FALLBACK = 0x6d2b79f5;

/** @param {unknown} value */
export function normalizeSeed(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    const seed = Math.trunc(value) >>> 0;
    return seed || NON_ZERO_FALLBACK;
  }

  const text = String(value ?? "lantern");
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) || NON_ZERO_FALLBACK;
}

export class SeededRng {
  /** @param {unknown} seed */
  constructor(seed) {
    this.initialSeed = normalizeSeed(seed);
    this.state = this.initialSeed;
  }

  /** @param {unknown} seed */
  reset(seed) {
    this.initialSeed = normalizeSeed(seed);
    this.state = this.initialSeed;
  }

  nextUint() {
    let value = this.state >>> 0;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    this.state = value >>> 0;
    return this.state;
  }

  nextFloat() {
    return this.nextUint() / 0x1_0000_0000;
  }

  /** @param {number} min @param {number} max */
  range(min, max) {
    return min + (max - min) * this.nextFloat();
  }
}
