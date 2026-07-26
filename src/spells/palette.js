// @ts-check

import {
  deriveSampleSeed,
  laneSignedUnit,
} from "./random.js";

export const FIREBALL_COLOR_PROJECTILE = 1;
export const FIREBALL_COLOR_CORE = 2;
export const FIREBALL_COLOR_PARTICLE = 3;
export const FIREBALL_COLOR_FLIGHT_LIGHT = 4;
export const FIREBALL_COLOR_IMPACT_LIGHT = 5;

/** @param {number} value @param {number} minimum @param {number} maximum */
function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

/** @param {string} color */
function hexRgb(color) {
  const value = Number.parseInt(color.slice(1), 16);
  return {
    r: ((value >>> 16) & 0xff) / 255,
    g: ((value >>> 8) & 0xff) / 255,
    b: (value & 0xff) / 255,
  };
}

/**
 * @param {{r:number,g:number,b:number}} target
 * @param {string} color
 */
function writeHex(target, color) {
  const value = Number.parseInt(color.slice(1), 16);
  target.r = ((value >>> 16) & 0xff) / 255;
  target.g = ((value >>> 8) & 0xff) / 255;
  target.b = (value & 0xff) / 255;
}

/**
 * @param {{r:number,g:number,b:number}} target
 * @param {string} fromColor
 * @param {string} toColor
 * @param {number} amount
 */
function writeMix(target, fromColor, toColor, amount) {
  const fromValue = Number.parseInt(fromColor.slice(1), 16);
  const toValue = Number.parseInt(toColor.slice(1), 16);
  const t = clamp(amount, 0, 1);
  const fromR = ((fromValue >>> 16) & 0xff) / 255;
  const fromG = ((fromValue >>> 8) & 0xff) / 255;
  const fromB = (fromValue & 0xff) / 255;
  target.r = fromR + ((((toValue >>> 16) & 0xff) / 255) - fromR) * t;
  target.g = fromG + ((((toValue >>> 8) & 0xff) / 255) - fromG) * t;
  target.b = fromB + (((toValue & 0xff) / 255) - fromB) * t;
}

/**
 * Applies HSV offsets in place without allocating intermediate color objects.
 *
 * @param {{r:number,g:number,b:number}} target
 * @param {number} hueDegrees
 * @param {number} saturationOffset
 * @param {number} brightnessOffset
 */
function applyHsvOffset(target, hueDegrees, saturationOffset, brightnessOffset) {
  const r = target.r;
  const g = target.g;
  const b = target.b;
  const maximum = Math.max(r, g, b);
  const minimum = Math.min(r, g, b);
  const delta = maximum - minimum;
  let hue = 0;
  if (delta > 1e-12) {
    if (maximum === r) hue = ((g - b) / delta) % 6;
    else if (maximum === g) hue = (b - r) / delta + 2;
    else hue = (r - g) / delta + 4;
    hue /= 6;
    if (hue < 0) hue += 1;
  }
  hue = (hue + hueDegrees / 360) % 1;
  if (hue < 0) hue += 1;
  const saturation = clamp(
    maximum <= 1e-12 ? 0 : delta / maximum + saturationOffset,
    0,
    1,
  );
  const value = clamp(maximum + brightnessOffset, 0, 1);
  const scaled = hue * 6;
  const sector = Math.floor(scaled);
  const fraction = scaled - sector;
  const p = value * (1 - saturation);
  const q = value * (1 - fraction * saturation);
  const t = value * (1 - (1 - fraction) * saturation);
  switch (sector % 6) {
    case 0:
      target.r = value; target.g = t; target.b = p; break;
    case 1:
      target.r = q; target.g = value; target.b = p; break;
    case 2:
      target.r = p; target.g = value; target.b = t; break;
    case 3:
      target.r = p; target.g = q; target.b = value; break;
    case 4:
      target.r = t; target.g = p; target.b = value; break;
    default:
      target.r = value; target.g = p; target.b = q; break;
  }
}

/**
 * Allocation-free shared Fireball palette sampler. `target` may be a plain
 * mutable RGB object or a Three.js Color.
 *
 * @param {{r:number,g:number,b:number,setRGB?:(r:number,g:number,b:number)=>unknown}} target
 * @param {Record<string, any>} definition
 * @param {{
 * kind:number,
 * life?:number,
 * effectSeed?:number,
 * sampleOrdinal?:number,
 * sampleSeed?:number,
 * variationEnabled?:boolean
 * }} sample
 */
export function writeFireballPaletteColor(target, definition, sample) {
  const palette = definition.palette;
  const life = clamp(Number(sample.life ?? 1), 0, 1);
  if (sample.kind === FIREBALL_COLOR_PROJECTILE) {
    writeHex(target, palette.projectile);
  } else if (sample.kind === FIREBALL_COLOR_CORE) {
    writeHex(target, palette.core);
  } else if (sample.kind === FIREBALL_COLOR_FLIGHT_LIGHT) {
    writeMix(target, palette.ember, palette.core, 0.68 + life * 0.22);
  } else if (sample.kind === FIREBALL_COLOR_IMPACT_LIGHT) {
    writeMix(target, palette.ember, palette.core, life);
  } else {
    const split = clamp(Number(palette.gradientSplit), 0, 1);
    if (life >= split) {
      const denominator = Math.max(1e-9, 1 - split);
      writeMix(target, palette.ember, palette.hot, (life - split) / denominator);
    } else {
      const denominator = Math.max(1e-9, split);
      writeMix(target, palette.decay, palette.ember, life / denominator);
    }
  }

  if (sample.variationEnabled !== false) {
    const effectSeed = Number(sample.effectSeed ?? 0) >>> 0;
    let hue = laneSignedUnit(effectSeed, "hue")
      * Number(palette.perCastHueVariation);
    let saturation = laneSignedUnit(effectSeed, "saturation")
      * Number(palette.perCastSaturationVariation);
    let brightness = laneSignedUnit(effectSeed, "brightness")
      * Number(palette.perCastBrightnessVariation);
    if (
      sample.kind === FIREBALL_COLOR_PARTICLE
      && Number.isInteger(sample.sampleOrdinal)
      && Number(sample.sampleOrdinal) >= 0
    ) {
      const sampleSeed = Number.isInteger(sample.sampleSeed)
        ? Number(sample.sampleSeed) >>> 0
        : deriveSampleSeed(effectSeed, Number(sample.sampleOrdinal));
      hue += laneSignedUnit(sampleSeed, "hue")
        * Number(palette.perParticleHueVariation);
      saturation += laneSignedUnit(sampleSeed, "saturation")
        * Number(palette.perParticleSaturationVariation);
      brightness += laneSignedUnit(sampleSeed, "brightness")
        * Number(palette.perParticleBrightnessVariation);
    }
    applyHsvOffset(target, hue, saturation, brightness);
  }
  if (typeof target.setRGB === "function") target.setRGB(target.r, target.g, target.b);
  return target;
}

/** @param {{r:number,g:number,b:number}} color */
export function fireballColorToHex(color) {
  const value = (
    (Math.round(clamp(color.r, 0, 1) * 255) << 16)
    | (Math.round(clamp(color.g, 0, 1) * 255) << 8)
    | Math.round(clamp(color.b, 0, 1) * 255)
  ) >>> 0;
  return `#${value.toString(16).padStart(6, "0").toUpperCase()}`;
}

/** @param {{r:number,g:number,b:number}} color */
export function rec709Luminance(color) {
  return color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722;
}

// Kept as an exported utility for tests and non-hot authoring diagnostics.
export function parseFireballHexColor(color) {
  return hexRgb(color);
}
