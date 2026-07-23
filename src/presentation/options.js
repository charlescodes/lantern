// @ts-check

export const PRESENTATION_FLAG_NAMES = Object.freeze([
  "dynamicLights",
  "lightColorVariation",
  "bloom",
  "shadows",
]);

export const PRESENTATION_RELOAD_OPTION_NAMES = Object.freeze([
  "renderer",
  "backend",
  "lights",
  "aa",
]);

export const PRESENTATION_LIVE_OPTION_NAMES = Object.freeze([
  "dpr",
  ...PRESENTATION_FLAG_NAMES,
]);

export const PRESENTATION_LIGHT_CAPACITIES = Object.freeze([8, 16, 32, 64]);
export const PRESENTATION_DPR_CAPS = Object.freeze([1, 1.5, 2]);

const PRESENTATION_FLAG_SET = new Set(PRESENTATION_FLAG_NAMES);
const RELOAD_OPTION_SET = new Set(PRESENTATION_RELOAD_OPTION_NAMES);
const LIVE_OPTION_SET = new Set(PRESENTATION_LIVE_OPTION_NAMES);

/** @param {URLSearchParams} parameters @param {string} name @param {boolean} fallback */
function booleanOption(parameters, name, fallback) {
  const value = parameters.get(name);
  if (value === "1") return true;
  if (value === "0") return false;
  return fallback;
}

/** @param {URLSearchParams} parameters @param {string} name @param {readonly number[]} supported @param {number} fallback */
function numericOption(parameters, name, supported, fallback) {
  const value = Number(parameters.get(name));
  return supported.includes(value) ? value : fallback;
}

/**
 * Parses only canonical presentation values. Invalid and unsupported values
 * fall back independently so a bad tuning parameter cannot change the route.
 * @param {string|URLSearchParams} [search]
 */
export function parsePresentationOptions(search = "") {
  const parameters = search instanceof URLSearchParams
    ? search
    : new URLSearchParams(String(search).replace(/^\?/, ""));
  const renderer = parameters.get("renderer") === "3d" ? "3d" : "2d";
  const backend = renderer === "3d" && parameters.get("backend") === "webgl"
    ? "webgl"
    : "auto";
  return Object.freeze({
    renderer,
    backend,
    forceWebGL: renderer === "3d" && backend === "webgl",
    lights: numericOption(parameters, "lights", PRESENTATION_LIGHT_CAPACITIES, 16),
    dpr: numericOption(parameters, "dpr", PRESENTATION_DPR_CAPS, 1.5),
    aa: booleanOption(parameters, "aa", true),
    dynamicLights: booleanOption(parameters, "dynamicLights", true),
    lightColorVariation: booleanOption(parameters, "lightColorVariation", true),
    bloom: booleanOption(parameters, "bloom", false),
    shadows: booleanOption(parameters, "shadows", false),
  });
}

/** @param {ReturnType<typeof parsePresentationOptions>} options */
export function presentationOptionsToSearch(options) {
  const parameters = new URLSearchParams();
  parameters.set("renderer", options.renderer);
  if (options.renderer === "3d" && options.backend === "webgl") {
    parameters.set("backend", "webgl");
  }
  parameters.set("lights", String(options.lights));
  parameters.set("dpr", String(options.dpr));
  parameters.set("aa", options.aa ? "1" : "0");
  parameters.set("dynamicLights", options.dynamicLights ? "1" : "0");
  parameters.set("lightColorVariation", options.lightColorVariation ? "1" : "0");
  parameters.set("bloom", options.bloom ? "1" : "0");
  parameters.set("shadows", options.shadows ? "1" : "0");
  return `?${parameters.toString()}`;
}

/** @param {string|URLSearchParams} [search] */
export function canonicalizePresentationSearch(search = "") {
  return presentationOptionsToSearch(parsePresentationOptions(search));
}

/** @param {string} name */
export function presentationOptionMode(name) {
  if (RELOAD_OPTION_SET.has(name)) return "reload";
  if (LIVE_OPTION_SET.has(name)) return "live";
  return null;
}

/**
 * Applies one raw URL setting, then canonicalizes the complete option set.
 * @param {string|URLSearchParams} search
 * @param {string} name
 * @param {unknown} value
 */
export function updatePresentationSearch(search, name, value) {
  if (!RELOAD_OPTION_SET.has(name) && !LIVE_OPTION_SET.has(name)) return null;
  const parameters = search instanceof URLSearchParams
    ? new URLSearchParams(search)
    : new URLSearchParams(String(search).replace(/^\?/, ""));
  if (typeof value === "boolean") parameters.set(name, value ? "1" : "0");
  else parameters.set(name, String(value));
  return canonicalizePresentationSearch(parameters);
}

export class PresentationFlags {
  /**
   * @param {{dynamicLights?:boolean,lightColorVariation?:boolean,bloom?:boolean,shadows?:boolean}} [initial]
   */
  constructor(initial = {}) {
    this.values = {
      dynamicLights: initial.dynamicLights ?? true,
      lightColorVariation: initial.lightColorVariation ?? true,
      bloom: initial.bloom ?? false,
      shadows: initial.shadows ?? false,
    };
  }

  /** @param {string} name @param {unknown} value */
  set(name, value) {
    if (!PRESENTATION_FLAG_SET.has(name)) return false;
    this.values[name] = Boolean(value);
    return true;
  }

  snapshot() {
    return { ...this.values };
  }
}
