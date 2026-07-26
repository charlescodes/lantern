// @ts-check

export const FIREBALL_SPELL_ID = "fireball";
export const FIREBALL_SPELL_CODE = 1;
export const FIREBALL_DEFINITION_FORMAT_VERSION = 1;

const NUMBER = "number";
const COLOR = "color";
const ENUM = "enum";
const BOOLEAN = "boolean";

/**
 * The authoring descriptor is the single source of truth for defaults, UI
 * labels, units, slider precision, and scalar validation.
 *
 * @param {Record<string, unknown>} value
 */
function descriptor(value) {
  return Object.freeze(value);
}

export const FIREBALL_DEFINITION_DESCRIPTORS = Object.freeze([
  descriptor({
    path: "cast.cooldown",
    section: "Essentials",
    label: "Cast cooldown",
    description: "Minimum time between successful Fireball casts.",
    type: NUMBER,
    default: 0.2,
    minimum: 0,
    maximum: 5,
    step: 0.01,
    unit: "s",
  }),
  descriptor({
    path: "impact.blastRadius",
    section: "Essentials",
    label: "Blast radius",
    description: "Authoritative radial reach of the impact impulse.",
    type: NUMBER,
    default: 2.5,
    minimum: 0,
    maximum: 12,
    step: 0.05,
    unit: "m",
  }),
  descriptor({
    path: "impact.pressureImpulse",
    section: "Essentials",
    label: "Pressure impulse",
    description: "Authoritative impulse budget before falloff, area, and mass.",
    type: NUMBER,
    default: 800,
    minimum: 0,
    maximum: 5_000,
    step: 10,
    unit: "N·s/m²",
  }),
  descriptor({
    path: "impact.visualLifetime",
    section: "Essentials",
    label: "Impact visual life",
    description: "Presentation lifetime of the impact ring and pulse.",
    type: NUMBER,
    default: 0.2,
    minimum: 0.02,
    maximum: 2,
    step: 0.01,
    unit: "s",
  }),

  descriptor({
    path: "projectile.speed",
    section: "Projectile",
    label: "Speed",
    description: "Authoritative horizontal projectile speed.",
    type: NUMBER,
    default: 9,
    minimum: 0.1,
    maximum: 40,
    step: 0.1,
    unit: "m/s",
  }),
  descriptor({
    path: "projectile.radius",
    section: "Projectile",
    label: "Radius",
    description: "Authoritative projectile collision radius.",
    type: NUMBER,
    default: 0.12,
    minimum: 0.02,
    maximum: 1,
    step: 0.01,
    unit: "m",
  }),
  descriptor({
    path: "projectile.lifetime",
    section: "Projectile",
    label: "Lifetime",
    description: "Maximum authoritative flight time before despawn.",
    type: NUMBER,
    default: 4,
    minimum: 0.1,
    maximum: 20,
    step: 0.1,
    unit: "s",
  }),
  descriptor({
    path: "projectile.spawnGap",
    section: "Projectile",
    label: "Spawn gap",
    description: "Extra clearance between the player and projectile at cast.",
    type: NUMBER,
    default: 0.02,
    minimum: 0,
    maximum: 1,
    step: 0.01,
    unit: "m",
  }),

  descriptor({
    path: "emission.burstCount",
    section: "Distribution",
    label: "Burst count",
    description: "Number of deterministic particle samples requested per impact.",
    type: NUMBER,
    integer: true,
    default: 224,
    minimum: 0,
    maximum: 1_024,
    step: 1,
    unit: "particles",
  }),
  descriptor({
    path: "emission.spawnHeight",
    section: "Distribution",
    label: "Relative spawn height",
    description: "Particle and impact height above the X/Z impact origin.",
    type: NUMBER,
    default: 0.1,
    minimum: 0,
    maximum: 2,
    step: 0.01,
    unit: "m",
  }),
  descriptor({
    path: "emission.gravity",
    section: "Distribution",
    label: "Gravity",
    description: "Authoritative vertical acceleration applied every fixed tick.",
    type: NUMBER,
    default: -9.81,
    minimum: -40,
    maximum: 10,
    step: 0.1,
    unit: "m/s²",
  }),
  descriptor({
    path: "emission.horizontalSpeedMinimum",
    section: "Distribution",
    label: "Horizontal speed min",
    description: "Minimum isotropic horizontal speed sample.",
    type: NUMBER,
    default: 1.4,
    minimum: 0,
    maximum: 30,
    step: 0.1,
    unit: "m/s",
  }),
  descriptor({
    path: "emission.horizontalSpeedMaximum",
    section: "Distribution",
    label: "Horizontal speed max",
    description: "Maximum isotropic horizontal speed sample.",
    type: NUMBER,
    default: 5.8,
    minimum: 0,
    maximum: 30,
    step: 0.1,
    unit: "m/s",
  }),
  descriptor({
    path: "emission.horizontalSpeedCap",
    section: "Distribution",
    label: "Horizontal speed cap",
    description: "Safety cap after the outward bias is added.",
    type: NUMBER,
    default: 7,
    minimum: 0,
    maximum: 30,
    step: 0.1,
    unit: "m/s",
  }),
  descriptor({
    path: "emission.outwardBiasMinimum",
    section: "Distribution",
    label: "Outward bias min",
    description: "Minimum speed added along the impact normal.",
    type: NUMBER,
    default: 0.2,
    minimum: 0,
    maximum: 30,
    step: 0.1,
    unit: "m/s",
  }),
  descriptor({
    path: "emission.outwardBiasMaximum",
    section: "Distribution",
    label: "Outward bias max",
    description: "Maximum speed added along the impact normal.",
    type: NUMBER,
    default: 1.1,
    minimum: 0,
    maximum: 30,
    step: 0.1,
    unit: "m/s",
  }),
  descriptor({
    path: "emission.verticalMinimum",
    section: "Distribution",
    label: "Vertical minimum",
    description: "Minimum initial upward speed.",
    type: NUMBER,
    default: 0.6,
    minimum: 0,
    maximum: 30,
    step: 0.1,
    unit: "m/s",
  }),
  descriptor({
    path: "emission.verticalRange",
    section: "Distribution",
    label: "Vertical range",
    description: "Range multiplied by the powered vertical random lane.",
    type: NUMBER,
    default: 5.9,
    minimum: 0,
    maximum: 30,
    step: 0.1,
    unit: "m/s",
  }),
  descriptor({
    path: "emission.verticalPower",
    section: "Distribution",
    label: "Vertical power",
    description: "Shapes the vertical roll; values above one favor lower arcs.",
    type: NUMBER,
    default: 2,
    minimum: 0,
    maximum: 4,
    step: 0.05,
    unit: "",
  }),

  descriptor({
    path: "particleLifecycle.sizeMinimum",
    section: "Lifetime",
    label: "Size min",
    description: "Minimum sampled maximum particle radius.",
    type: NUMBER,
    default: 0.025,
    minimum: 0.005,
    maximum: 0.5,
    step: 0.005,
    unit: "m",
  }),
  descriptor({
    path: "particleLifecycle.sizeMaximum",
    section: "Lifetime",
    label: "Size max",
    description: "Maximum sampled maximum particle radius.",
    type: NUMBER,
    default: 0.085,
    minimum: 0.005,
    maximum: 0.5,
    step: 0.005,
    unit: "m",
  }),
  descriptor({
    path: "particleLifecycle.lifetimeMinimum",
    section: "Lifetime",
    label: "Lifetime min",
    description: "Lower clamp for the sampled particle lifetime.",
    type: NUMBER,
    default: 0.18,
    minimum: 0.02,
    maximum: 10,
    step: 0.01,
    unit: "s",
  }),
  descriptor({
    path: "particleLifecycle.lifetimeMaximum",
    section: "Lifetime",
    label: "Lifetime max",
    description: "Upper clamp for the sampled particle lifetime.",
    type: NUMBER,
    default: 1.1,
    minimum: 0.02,
    maximum: 10,
    step: 0.01,
    unit: "s",
  }),
  descriptor({
    path: "particleLifecycle.lifetimeBase",
    section: "Lifetime",
    label: "Lifetime base",
    description: "Base term in the visible lifetime formula.",
    type: NUMBER,
    default: 0.22,
    minimum: 0.02,
    maximum: 10,
    step: 0.01,
    unit: "s",
  }),
  descriptor({
    path: "particleLifecycle.lifetimeSizeScale",
    section: "Lifetime",
    label: "Size lifetime scale",
    description: "Seconds added per normalized maximum-size unit.",
    type: NUMBER,
    default: 0.83,
    minimum: -10,
    maximum: 10,
    step: 0.01,
    unit: "s",
  }),
  descriptor({
    path: "particleLifecycle.lifetimeJitter",
    section: "Lifetime",
    label: "Lifetime jitter",
    description: "Peak-to-peak deterministic jitter width.",
    type: NUMBER,
    default: 0.12,
    minimum: 0.02,
    maximum: 10,
    step: 0.01,
    unit: "s",
  }),
  descriptor({
    path: "particleLifecycle.shrinkExponent",
    section: "Lifetime",
    label: "Shrink exponent",
    description: "Power applied to remaining normalized life for visible radius.",
    type: NUMBER,
    default: 0.65,
    minimum: 0,
    maximum: 4,
    step: 0.05,
    unit: "",
  }),

  descriptor({
    path: "collision.groundMode",
    section: "Collision",
    label: "Ground mode",
    description: "Bounce once and settle, or remove on first ground contact.",
    type: ENUM,
    default: "bounce-settle",
    values: Object.freeze(["bounce-settle", "remove"]),
    unit: "",
  }),
  descriptor({
    path: "collision.groundVerticalRetention",
    section: "Collision",
    label: "Ground vertical retention",
    description: "Vertical speed retained by the first ground bounce.",
    type: NUMBER,
    default: 0.45,
    minimum: 0,
    maximum: 1,
    step: 0.01,
    unit: "",
  }),
  descriptor({
    path: "collision.groundHorizontalRetention",
    section: "Collision",
    label: "Ground horizontal retention",
    description: "Horizontal speed retained on ground contacts.",
    type: NUMBER,
    default: 0.82,
    minimum: 0,
    maximum: 1,
    step: 0.01,
    unit: "",
  }),
  descriptor({
    path: "collision.wallCollision",
    section: "Collision",
    label: "Wall collision",
    description: "Allows this spell's particles to sweep against map walls.",
    type: BOOLEAN,
    default: true,
    unit: "",
  }),
  descriptor({
    path: "collision.wallNormalRetention",
    section: "Collision",
    label: "Wall normal retention",
    description: "Reflected normal speed retained after a wall hit.",
    type: NUMBER,
    default: 0.8,
    minimum: 0,
    maximum: 1,
    step: 0.01,
    unit: "",
  }),
  descriptor({
    path: "collision.wallTangentialRetention",
    section: "Collision",
    label: "Wall tangent retention",
    description: "Tangential speed retained after a wall hit.",
    type: NUMBER,
    default: 0.95,
    minimum: 0,
    maximum: 1,
    step: 0.01,
    unit: "",
  }),

  descriptor({
    path: "palette.projectile",
    section: "Palette",
    label: "Projectile",
    description: "Outer projectile color.",
    type: COLOR,
    default: "#FF834D",
    unit: "",
  }),
  descriptor({
    path: "palette.core",
    section: "Palette",
    label: "Core",
    description: "Projectile core and hottest light color.",
    type: COLOR,
    default: "#FFE4A3",
    unit: "",
  }),
  descriptor({
    path: "palette.hot",
    section: "Palette",
    label: "Hot",
    description: "Young spark color.",
    type: COLOR,
    default: "#FFBD59",
    unit: "",
  }),
  descriptor({
    path: "palette.ember",
    section: "Palette",
    label: "Ember",
    description: "Middle spark and warm light color.",
    type: COLOR,
    default: "#FF7814",
    unit: "",
  }),
  descriptor({
    path: "palette.decay",
    section: "Palette",
    label: "Decay",
    description: "Old spark color.",
    type: COLOR,
    default: "#F01F06",
    unit: "",
  }),
  descriptor({
    path: "palette.gradientSplit",
    section: "Palette",
    label: "Gradient split",
    description: "Remaining-life point separating decay/ember and ember/hot.",
    type: NUMBER,
    default: 0.58,
    minimum: 0,
    maximum: 1,
    step: 0.01,
    unit: "",
  }),
  descriptor({
    path: "palette.perCastHueVariation",
    section: "Palette",
    label: "Per-cast hue",
    description: "Maximum signed hue offset shared by one cast.",
    type: NUMBER,
    default: 3,
    minimum: 0,
    maximum: 30,
    step: 0.5,
    unit: "°",
  }),
  descriptor({
    path: "palette.perCastSaturationVariation",
    section: "Palette",
    label: "Per-cast saturation",
    description: "Maximum signed saturation offset shared by one cast.",
    type: NUMBER,
    default: 0.02,
    minimum: 0,
    maximum: 0.25,
    step: 0.005,
    unit: "",
  }),
  descriptor({
    path: "palette.perCastBrightnessVariation",
    section: "Palette",
    label: "Per-cast brightness",
    description: "Maximum signed brightness offset shared by one cast.",
    type: NUMBER,
    default: 0,
    minimum: 0,
    maximum: 0.25,
    step: 0.005,
    unit: "",
  }),
  descriptor({
    path: "palette.perParticleHueVariation",
    section: "Palette",
    label: "Per-particle hue",
    description: "Maximum additional signed hue offset per spark.",
    type: NUMBER,
    default: 0,
    minimum: 0,
    maximum: 30,
    step: 0.5,
    unit: "°",
  }),
  descriptor({
    path: "palette.perParticleSaturationVariation",
    section: "Palette",
    label: "Per-particle saturation",
    description: "Maximum additional signed saturation offset per spark.",
    type: NUMBER,
    default: 0,
    minimum: 0,
    maximum: 0.25,
    step: 0.005,
    unit: "",
  }),
  descriptor({
    path: "palette.perParticleBrightnessVariation",
    section: "Palette",
    label: "Per-particle brightness",
    description: "Maximum additional signed brightness offset per spark.",
    type: NUMBER,
    default: 0,
    minimum: 0,
    maximum: 0.25,
    step: 0.005,
    unit: "",
  }),

  descriptor({
    path: "presentation.projectileEmissiveStrength",
    section: "Emissive",
    label: "Projectile emissive",
    description: "Presentation-only projectile emissive energy.",
    type: NUMBER,
    default: 3.8,
    minimum: 0,
    maximum: 12,
    step: 0.1,
    unit: "",
  }),
  descriptor({
    path: "presentation.particleEmissiveStrength",
    section: "Emissive",
    label: "Particle emissive",
    description: "Presentation-only spark emissive energy.",
    type: NUMBER,
    default: 2.6,
    minimum: 0,
    maximum: 12,
    step: 0.1,
    unit: "",
  }),
  descriptor({
    path: "presentation.flightLightIntensity",
    section: "Lighting",
    label: "Flight intensity",
    description: "Presentation-only projectile point-light intensity.",
    type: NUMBER,
    default: 22,
    minimum: 0,
    maximum: 150,
    step: 1,
    unit: "",
  }),
  descriptor({
    path: "presentation.flightLightRange",
    section: "Lighting",
    label: "Flight range",
    description: "Presentation-only projectile point-light range.",
    type: NUMBER,
    default: 3,
    minimum: 0,
    maximum: 20,
    step: 0.1,
    unit: "m",
  }),
  descriptor({
    path: "presentation.flightLightDecay",
    section: "Lighting",
    label: "Flight decay",
    description: "Presentation-only projectile point-light decay.",
    type: NUMBER,
    default: 2,
    minimum: 0,
    maximum: 4,
    step: 0.1,
    unit: "",
  }),
  descriptor({
    path: "presentation.impactLightIntensity",
    section: "Lighting",
    label: "Impact intensity",
    description: "Peak presentation-only impact point-light intensity.",
    type: NUMBER,
    default: 52,
    minimum: 0,
    maximum: 150,
    step: 1,
    unit: "",
  }),
  descriptor({
    path: "presentation.impactLightRange",
    section: "Lighting",
    label: "Impact range",
    description: "Presentation-only impact point-light range.",
    type: NUMBER,
    default: 5,
    minimum: 0,
    maximum: 20,
    step: 0.1,
    unit: "m",
  }),
  descriptor({
    path: "presentation.impactLightDecay",
    section: "Lighting",
    label: "Impact decay",
    description: "Presentation-only impact point-light decay.",
    type: NUMBER,
    default: 2,
    minimum: 0,
    maximum: 4,
    step: 0.1,
    unit: "",
  }),
  descriptor({
    path: "presentation.sparkLightIntensity",
    section: "Lighting",
    label: "Spark intensity",
    description: "Maximum presentation-only spark-carrier light intensity.",
    type: NUMBER,
    default: 13,
    minimum: 0,
    maximum: 150,
    step: 1,
    unit: "",
  }),
  descriptor({
    path: "presentation.sparkLightRange",
    section: "Lighting",
    label: "Spark range",
    description: "Presentation-only spark-carrier point-light range.",
    type: NUMBER,
    default: 1.5,
    minimum: 0,
    maximum: 20,
    step: 0.1,
    unit: "m",
  }),
  descriptor({
    path: "presentation.sparkLightDecay",
    section: "Lighting",
    label: "Spark decay",
    description: "Presentation-only spark-carrier point-light decay.",
    type: NUMBER,
    default: 2,
    minimum: 0,
    maximum: 4,
    step: 0.1,
    unit: "",
  }),
]);

export const FIREBALL_DEFINITION_SECTIONS = Object.freeze([
  "Essentials",
  "Projectile",
  "Distribution",
  "Lifetime",
  "Collision",
  "Palette",
  "Emissive",
  "Lighting",
]);

const EXPECTED_TOP_LEVEL_KEYS = Object.freeze([
  "formatVersion",
  "cast",
  "projectile",
  "impact",
  "emission",
  "particleLifecycle",
  "collision",
  "palette",
  "presentation",
]);

const DESCRIPTORS_BY_OBJECT = new Map();
for (const item of FIREBALL_DEFINITION_DESCRIPTORS) {
  const [objectName, fieldName] = String(item.path).split(".");
  const fields = DESCRIPTORS_BY_OBJECT.get(objectName) ?? new Map();
  fields.set(fieldName, item);
  DESCRIPTORS_BY_OBJECT.set(objectName, fields);
}

/** @param {unknown} value */
function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

/** @param {unknown} value */
function cloneJsonValue(value) {
  if (Array.isArray(value)) return value.map(cloneJsonValue);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(/** @type {Record<string, unknown>} */ (value))
        .map(([key, item]) => [key, cloneJsonValue(item)]),
    );
  }
  return value;
}

/** @param {unknown} value */
function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const item of Object.values(value)) deepFreeze(item);
  return Object.freeze(value);
}

/** @param {string} path @param {string} code @param {string} message @param {unknown} [actual] */
function validationError(path, code, message, actual) {
  const error = { path, code, message };
  if (arguments.length >= 4) {
    Object.assign(error, { actual });
  }
  return error;
}

/** @param {unknown} target @param {string} path @param {unknown} value */
export function setFireballDefinitionValue(target, path, value) {
  const [objectName, fieldName] = path.split(".");
  if (
    !objectName
    || !fieldName
    || !isRecord(target)
    || !isRecord(target[objectName])
  ) {
    return false;
  }
  target[objectName][fieldName] = value;
  return true;
}

/** @param {Record<string, any>} target @param {string} path */
export function getFireballDefinitionValue(target, path) {
  const [objectName, fieldName] = path.split(".");
  return target?.[objectName]?.[fieldName];
}

export function createDefaultFireballDefinition() {
  /** @type {Record<string, any>} */
  const definition = { formatVersion: FIREBALL_DEFINITION_FORMAT_VERSION };
  for (const objectName of DESCRIPTORS_BY_OBJECT.keys()) definition[objectName] = {};
  for (const item of FIREBALL_DEFINITION_DESCRIPTORS) {
    setFireballDefinitionValue(definition, String(item.path), item.default);
  }
  return deepFreeze(definition);
}

export const DEFAULT_FIREBALL_DEFINITION = createDefaultFireballDefinition();

/**
 * Returns either a deeply frozen normalized complete document or structured
 * errors. No field is clamped and no partial result is ever returned.
 *
 * @param {unknown} input
 * @returns {{ok:true,value:Readonly<Record<string,any>>,errors:[]} | {ok:false,value:null,errors:Array<Record<string,unknown>>}}
 */
export function validateFireballDefinition(input) {
  /** @type {Array<Record<string, unknown>>} */
  const errors = [];
  if (!isRecord(input)) {
    return {
      ok: false,
      value: null,
      errors: [validationError("", "type", "Definition must be a JSON object", input)],
    };
  }
  const source = /** @type {Record<string, unknown>} */ (input);
  const expectedTopLevel = new Set(EXPECTED_TOP_LEVEL_KEYS);
  for (const key of Object.keys(source)) {
    if (!expectedTopLevel.has(key)) {
      errors.push(validationError(key, "unknown_field", `Unknown field "${key}"`));
    }
  }
  for (const key of EXPECTED_TOP_LEVEL_KEYS) {
    if (!Object.hasOwn(source, key)) {
      errors.push(validationError(key, "required", `Missing required field "${key}"`));
    }
  }
  if (
    Object.hasOwn(source, "formatVersion")
    && source.formatVersion !== FIREBALL_DEFINITION_FORMAT_VERSION
  ) {
    errors.push(validationError(
      "formatVersion",
      "format_version",
      `formatVersion must be ${FIREBALL_DEFINITION_FORMAT_VERSION}`,
      source.formatVersion,
    ));
  }

  for (const [objectName, fields] of DESCRIPTORS_BY_OBJECT) {
    const objectValue = source[objectName];
    if (!isRecord(objectValue)) {
      if (Object.hasOwn(source, objectName)) {
        errors.push(validationError(
          objectName,
          "type",
          `${objectName} must be an object`,
          objectValue,
        ));
      }
      continue;
    }
    const object = /** @type {Record<string, unknown>} */ (objectValue);
    for (const key of Object.keys(object)) {
      if (!fields.has(key)) {
        errors.push(validationError(
          `${objectName}.${key}`,
          "unknown_field",
          `Unknown field "${objectName}.${key}"`,
        ));
      }
    }
    for (const [fieldName, item] of fields) {
      const path = `${objectName}.${fieldName}`;
      if (!Object.hasOwn(object, fieldName)) {
        errors.push(validationError(path, "required", `Missing required field "${path}"`));
        continue;
      }
      const value = object[fieldName];
      if (item.type === NUMBER) {
        if (typeof value !== "number" || !Number.isFinite(value)) {
          errors.push(validationError(path, "finite_number", `${path} must be finite`, value));
          continue;
        }
        if (item.integer === true && !Number.isInteger(value)) {
          errors.push(validationError(path, "integer", `${path} must be an integer`, value));
        }
        if (value < Number(item.minimum) || value > Number(item.maximum)) {
          errors.push(validationError(
            path,
            "bounds",
            `${path} must be between ${item.minimum} and ${item.maximum}`,
            value,
          ));
        }
      } else if (item.type === COLOR) {
        if (typeof value !== "string" || !/^#[0-9a-fA-F]{6}$/.test(value)) {
          errors.push(validationError(
            path,
            "color",
            `${path} must be an exact #RRGGBB color`,
            value,
          ));
        }
      } else if (item.type === ENUM) {
        if (!Array.isArray(item.values) || !item.values.includes(value)) {
          errors.push(validationError(
            path,
            "enum",
            `${path} must be one of ${item.values?.join(", ")}`,
            value,
          ));
        }
      } else if (item.type === BOOLEAN && typeof value !== "boolean") {
        errors.push(validationError(path, "boolean", `${path} must be boolean`, value));
      }
    }
  }

  const relations = [
    ["emission.horizontalSpeedMinimum", "emission.horizontalSpeedMaximum"],
    ["emission.outwardBiasMinimum", "emission.outwardBiasMaximum"],
    ["particleLifecycle.sizeMinimum", "particleLifecycle.sizeMaximum"],
    ["particleLifecycle.lifetimeMinimum", "particleLifecycle.lifetimeMaximum"],
  ];
  for (const [minimumPath, maximumPath] of relations) {
    const minimum = getFireballDefinitionValue(/** @type {any} */ (source), minimumPath);
    const maximum = getFireballDefinitionValue(/** @type {any} */ (source), maximumPath);
    if (
      typeof minimum === "number"
      && Number.isFinite(minimum)
      && typeof maximum === "number"
      && Number.isFinite(maximum)
      && minimum > maximum
    ) {
      errors.push(validationError(
        maximumPath,
        "relation",
        `${minimumPath} must be less than or equal to ${maximumPath}`,
        maximum,
      ));
    }
  }

  if (errors.length > 0) return { ok: false, value: null, errors };
  const normalized = /** @type {Record<string, any>} */ (cloneJsonValue(source));
  for (const item of FIREBALL_DEFINITION_DESCRIPTORS) {
    if (item.type !== COLOR) continue;
    const value = String(getFireballDefinitionValue(normalized, String(item.path)));
    setFireballDefinitionValue(normalized, String(item.path), value.toUpperCase());
  }
  return {
    ok: true,
    value: /** @type {Readonly<Record<string, any>>} */ (deepFreeze(normalized)),
    errors: [],
  };
}

/** @param {string} json */
export function parseFireballDefinitionJson(json) {
  try {
    return validateFireballDefinition(JSON.parse(json));
  } catch (error) {
    return {
      ok: false,
      value: null,
      errors: [validationError(
        "",
        "json",
        error instanceof Error ? error.message : String(error),
      )],
    };
  }
}

/** @param {unknown} definition */
export function serializeFireballDefinition(definition) {
  const result = validateFireballDefinition(definition);
  if (!result.ok) return result;
  return {
    ok: true,
    value: JSON.stringify(result.value, null, 2),
    errors: [],
  };
}

/** @param {unknown} definition */
export function cloneFireballDefinition(definition) {
  const result = validateFireballDefinition(definition);
  return result.ok ? cloneJsonValue(result.value) : null;
}
