import test from "node:test";
import assert from "node:assert/strict";

import {
  cloneFireballDefinition,
  DEFAULT_FIREBALL_DEFINITION,
  FIREBALL_DEFINITION_DESCRIPTORS,
  getFireballDefinitionValue,
  parseFireballDefinitionJson,
  serializeFireballDefinition,
  setFireballDefinitionValue,
  validateFireballDefinition,
} from "../src/spells/fireball_definition.js";
import { SpellRegistry } from "../src/spells/spell_registry.js";

function draft() {
  return cloneFireballDefinition(DEFAULT_FIREBALL_DEFINITION);
}

test("one descriptor table produces a complete immutable Fireball v1 default", () => {
  assert.equal(DEFAULT_FIREBALL_DEFINITION.formatVersion, 1);
  assert.equal(Object.isFrozen(DEFAULT_FIREBALL_DEFINITION), true);
  assert.equal(Object.isFrozen(DEFAULT_FIREBALL_DEFINITION.projectile), true);
  assert.equal(validateFireballDefinition(DEFAULT_FIREBALL_DEFINITION).ok, true);

  const paths = new Set();
  for (const descriptor of FIREBALL_DEFINITION_DESCRIPTORS) {
    assert.equal(paths.has(descriptor.path), false, descriptor.path);
    paths.add(descriptor.path);
    assert.equal(
      getFireballDefinitionValue(DEFAULT_FIREBALL_DEFINITION, descriptor.path),
      descriptor.default,
      descriptor.path,
    );
    assert.equal(typeof descriptor.label, "string");
    assert.equal(typeof descriptor.description, "string");
    assert.equal(typeof descriptor.section, "string");
    assert.ok(Object.hasOwn(descriptor, "unit"));
  }

  assert.equal(DEFAULT_FIREBALL_DEFINITION.cast.cooldown, 0.2);
  assert.deepEqual(DEFAULT_FIREBALL_DEFINITION.projectile, {
    speed: 9,
    radius: 0.12,
    lifetime: 4,
    spawnGap: 0.02,
  });
  assert.equal(DEFAULT_FIREBALL_DEFINITION.emission.burstCount, 224);
  assert.equal(DEFAULT_FIREBALL_DEFINITION.palette.perParticleHueVariation, 0);
  assert.equal(DEFAULT_FIREBALL_DEFINITION.palette.perParticleSaturationVariation, 0);
  assert.equal(DEFAULT_FIREBALL_DEFINITION.palette.perParticleBrightnessVariation, 0);
});

test("strict validation rejects unknown, missing, non-finite, malformed, and out-of-range fields", () => {
  const cases = [
    {
      mutate(value) { value.extra = true; },
      code: "unknown_field",
      path: "extra",
    },
    {
      mutate(value) { delete value.projectile.speed; },
      code: "required",
      path: "projectile.speed",
    },
    {
      mutate(value) { value.projectile.speed = Number.NaN; },
      code: "finite_number",
      path: "projectile.speed",
    },
    {
      mutate(value) { value.projectile.radius = 1.01; },
      code: "bounds",
      path: "projectile.radius",
    },
    {
      mutate(value) { value.emission.burstCount = 1.5; },
      code: "integer",
      path: "emission.burstCount",
    },
    {
      mutate(value) { value.palette.core = "#fff"; },
      code: "color",
      path: "palette.core",
    },
    {
      mutate(value) { value.collision.groundMode = "slide"; },
      code: "enum",
      path: "collision.groundMode",
    },
    {
      mutate(value) { value.collision.wallCollision = 1; },
      code: "boolean",
      path: "collision.wallCollision",
    },
    {
      mutate(value) { value.presentation.flightLightIntensity = 151; },
      code: "bounds",
      path: "presentation.flightLightIntensity",
    },
  ];
  for (const fixture of cases) {
    const value = draft();
    fixture.mutate(value);
    const result = validateFireballDefinition(value);
    assert.equal(result.ok, false);
    assert.equal(result.value, null);
    assert.ok(
      result.errors.some(
        (error) => error.code === fixture.code && error.path === fixture.path,
      ),
      JSON.stringify(result.errors),
    );
  }
});

test("every numeric descriptor rejects values outside its authoring bounds", () => {
  for (const descriptor of FIREBALL_DEFINITION_DESCRIPTORS) {
    if (descriptor.type !== "number") continue;
    const distance = Math.max(
      Number(descriptor.step ?? 0),
      (Number(descriptor.maximum) - Number(descriptor.minimum)) / 100,
      0.001,
    );
    for (const value of [
      Number(descriptor.minimum) - distance,
      Number(descriptor.maximum) + distance,
    ]) {
      const candidate = draft();
      setFireballDefinitionValue(candidate, descriptor.path, value);
      const result = validateFireballDefinition(candidate);
      assert.equal(result.ok, false, descriptor.path);
      assert.ok(
        result.errors.some(
          (error) => error.code === "bounds" && error.path === descriptor.path,
        ),
        `${descriptor.path} accepted ${value}`,
      );
    }
  }
});

test("relational bounds reject min greater than max without clamping either value", () => {
  for (const [minimumPath, maximumPath] of [
    ["emission.horizontalSpeedMinimum", "emission.horizontalSpeedMaximum"],
    ["emission.outwardBiasMinimum", "emission.outwardBiasMaximum"],
    ["particleLifecycle.sizeMinimum", "particleLifecycle.sizeMaximum"],
    ["particleLifecycle.lifetimeMinimum", "particleLifecycle.lifetimeMaximum"],
  ]) {
    const value = draft();
    setFireballDefinitionValue(value, minimumPath, 0.4);
    setFireballDefinitionValue(value, maximumPath, 0.2);
    const result = validateFireballDefinition(value);
    assert.equal(result.ok, false);
    assert.ok(
      result.errors.some(
        (error) => error.code === "relation" && error.path === maximumPath,
      ),
    );
    assert.equal(getFireballDefinitionValue(value, minimumPath), 0.4);
    assert.equal(getFireballDefinitionValue(value, maximumPath), 0.2);
  }
});

test("validation normalizes color case into a deeply frozen independent document", () => {
  const value = draft();
  value.palette.projectile = "#abcdef";
  const result = validateFireballDefinition(value);
  assert.equal(result.ok, true);
  assert.equal(result.value.palette.projectile, "#ABCDEF");
  assert.equal(Object.isFrozen(result.value), true);
  assert.equal(Object.isFrozen(result.value.palette), true);
  value.palette.projectile = "#000000";
  assert.equal(result.value.palette.projectile, "#ABCDEF");
  assert.throws(() => {
    result.value.palette.projectile = "#FFFFFF";
  }, TypeError);
});

test("JSON import/export round trips complete documents and reports syntax errors structurally", () => {
  const value = draft();
  value.projectile.speed = 17.5;
  value.palette.perParticleHueVariation = 9;
  const serialized = serializeFireballDefinition(value);
  assert.equal(serialized.ok, true);
  const parsed = parseFireballDefinitionJson(serialized.value);
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.value, validateFireballDefinition(value).value);

  const invalidJson = parseFireballDefinitionJson("{");
  assert.equal(invalidJson.ok, false);
  assert.equal(invalidJson.errors[0].code, "json");

  const primitive = parseFireballDefinitionJson("null");
  assert.equal(primitive.ok, false);
  assert.equal(primitive.errors[0].code, "type");
  assert.equal(
    setFireballDefinitionValue(null, "projectile.speed", 12),
    false,
  );
});

test("registry apply is atomic, immutable, revision-checked, and monotonically numbered", () => {
  const registry = new SpellRegistry();
  const original = registry.describe("fireball");
  const invalid = draft();
  invalid.projectile.speed = 100;
  const rejected = registry.apply("fireball", invalid, 1);
  assert.equal(rejected.ok, false);
  assert.equal(registry.describe("fireball").revision, 1);
  assert.deepEqual(registry.describe("fireball").definition, original.definition);

  const changed = draft();
  changed.projectile.speed = 12;
  const applied = registry.apply("fireball", changed, 1);
  assert.equal(applied.ok, true);
  assert.equal(applied.revision, 2);
  changed.projectile.speed = 2;
  assert.equal(registry.describe("fireball").definition.projectile.speed, 12);

  const conflict = registry.apply("fireball", draft(), 1);
  assert.equal(conflict.ok, false);
  assert.equal(conflict.errors[0].code, "revision_conflict");
  assert.equal(registry.describe("fireball").revision, 2);

  registry.prune(new Map());
  assert.deepEqual(registry.diagnostics()[0].revisions, [2]);
  const next = registry.apply("fireball", draft(), 2);
  assert.equal(next.revision, 3);
});
