// @ts-check

export const PRESENTATION_FLAG_NAMES = Object.freeze([
  "dynamicLights",
  "bloom",
  "shadows",
]);

const PRESENTATION_FLAG_SET = new Set(PRESENTATION_FLAG_NAMES);

/**
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
  });
}

export class PresentationFlags {
  /**
   * @param {{dynamicLights?:boolean,bloom?:boolean,shadows?:boolean}} [initial]
   */
  constructor(initial = {}) {
    this.values = {
      dynamicLights: initial.dynamicLights ?? true,
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
