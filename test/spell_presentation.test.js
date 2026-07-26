import test from "node:test";
import assert from "node:assert/strict";

import * as THREE from "three/webgpu";

import {
  cloneFireballDefinition,
  DEFAULT_FIREBALL_DEFINITION,
} from "../src/spells/fireball_definition.js";
import {
  FIREBALL_COLOR_CORE,
  FIREBALL_COLOR_FLIGHT_LIGHT,
  FIREBALL_COLOR_IMPACT_LIGHT,
  FIREBALL_COLOR_PARTICLE,
  FIREBALL_COLOR_PROJECTILE,
  writeFireballPaletteColor,
} from "../src/spells/palette.js";
import { Camera3D } from "../src/presentation/camera_3d.js";
import { PresentationLightBudget } from "../src/presentation/light_budget.js";
import {
  parsePresentationOptions,
  PresentationFlags,
} from "../src/presentation/options.js";
import { ThreePresentation } from "../src/presentation/three_presentation.js";
import { GridMap } from "../src/sim/grid_map.js";
import { Simulation } from "../src/sim/simulation.js";
import { TrueSightSystem } from "../src/visibility/true_sight.js";

function closeColor(actual, expected, epsilon = 1e-6) {
  for (const component of ["r", "g", "b"]) {
    assert.ok(
      Math.abs(actual[component] - expected[component]) <= epsilon,
      `${component}: ${actual[component]} vs ${expected[component]}`,
    );
  }
}

function authoredDefinition() {
  const value = cloneFireballDefinition(DEFAULT_FIREBALL_DEFINITION);
  value.cast.cooldown = 0;
  value.emission.burstCount = 8;
  value.palette.perCastHueVariation = 18;
  value.palette.perCastSaturationVariation = 0.12;
  value.palette.perCastBrightnessVariation = 0.08;
  value.palette.perParticleHueVariation = 12;
  value.palette.perParticleSaturationVariation = 0.08;
  value.palette.perParticleBrightnessVariation = 0.05;
  value.presentation.flightLightIntensity = 77;
  value.presentation.flightLightRange = 8;
  value.presentation.flightLightDecay = 3;
  value.presentation.impactLightIntensity = 101;
  value.presentation.impactLightRange = 9;
  value.presentation.impactLightDecay = 1.5;
  value.presentation.sparkLightIntensity = 31;
  value.presentation.sparkLightRange = 4;
  value.presentation.sparkLightDecay = 1;
  value.presentation.projectileEmissiveStrength = 6;
  value.presentation.particleEmissiveStrength = 5;
  return value;
}

function fakeCanvas() {
  return {
    width: 1,
    height: 1,
    style: {},
    getContext() {
      return null;
    },
    addEventListener() {},
    removeEventListener() {},
    setAttribute() {},
    removeAttribute() {},
    getBoundingClientRect() {
      return { width: 800, height: 600 };
    },
  };
}

test("shared palette sampling applies one global A/B master to every color role", () => {
  const definition = authoredDefinition();
  const roles = [
    FIREBALL_COLOR_PROJECTILE,
    FIREBALL_COLOR_FLIGHT_LIGHT,
    FIREBALL_COLOR_IMPACT_LIGHT,
    FIREBALL_COLOR_PARTICLE,
  ];
  for (const kind of roles) {
    const base = { r: 0, g: 0, b: 0 };
    const varied = { r: 0, g: 0, b: 0 };
    writeFireballPaletteColor(base, definition, {
      kind,
      life: 0.73,
      effectSeed: 0x1234abcd,
      sampleOrdinal: 4,
      variationEnabled: false,
    });
    writeFireballPaletteColor(varied, definition, {
      kind,
      life: 0.73,
      effectSeed: 0x1234abcd,
      sampleOrdinal: 4,
      variationEnabled: true,
    });
    assert.notDeepEqual(varied, base, `role ${kind} ignored variation`);
  }

  const first = { r: 0, g: 0, b: 0 };
  const second = { r: 0, g: 0, b: 0 };
  writeFireballPaletteColor(first, definition, {
    kind: FIREBALL_COLOR_PARTICLE,
    life: 0.5,
    effectSeed: 99,
    sampleOrdinal: 1,
  });
  writeFireballPaletteColor(second, definition, {
    kind: FIREBALL_COLOR_PARTICLE,
    life: 0.5,
    effectSeed: 99,
    sampleOrdinal: 2,
  });
  assert.notDeepEqual(first, second);
});

test("flight, impact, and spark lights use captured definition energy and shared colors", () => {
  const map = new GridMap(12, 7, undefined, { x: 1.5, z: 3.5 });
  map.set(4, 3, 1);
  const definition = authoredDefinition();
  const simulation = new Simulation({
    map,
    seed: 0x123456,
    initialFireballDefinition: definition,
  });
  const budget = new PresentationLightBudget({ capacity: 8 });
  simulation.tick({
    cast: { x: 8, z: 3.5, variationSeed: 0xabcdef01 },
  });
  let snapshot = simulation.snapshot();
  const flight = budget.allocate(snapshot, true, true)[0];
  const expectedFlight = { r: 0, g: 0, b: 0 };
  writeFireballPaletteColor(expectedFlight, definition, {
    kind: FIREBALL_COLOR_FLIGHT_LIGHT,
    life: 1 - snapshot.projectiles[0].age / snapshot.projectiles[0].lifetime,
    effectSeed: 0xabcdef01,
  });
  closeColor(flight.color, expectedFlight);
  assert.equal(flight.intensity, 77);
  assert.equal(flight.distance, 8);
  assert.equal(flight.decay, 3);

  for (let tick = 0; tick < 120 && simulation.impactEvents.length === 0; tick += 1) {
    simulation.tick(null);
    snapshot = simulation.snapshot();
    budget.allocate(snapshot, true, true);
  }
  snapshot = simulation.snapshot();
  const impactAssignments = budget.allocate(snapshot, true, true);
  const impact = impactAssignments.find((assignment) => assignment.kind === "explosion");
  assert.ok(impact);
  const impactEvent = snapshot.recentEvents.at(-1);
  const impactLife = 1 - (snapshot.tick - impactEvent.tick)
    / Math.round(impactEvent.visualLifetime * 60);
  const expectedImpact = { r: 0, g: 0, b: 0 };
  writeFireballPaletteColor(expectedImpact, definition, {
    kind: FIREBALL_COLOR_IMPACT_LIGHT,
    life: impactLife,
    effectSeed: impactEvent.effectSeed,
  });
  closeColor(impact.color, expectedImpact);
  assert.equal(impact.distance, 9);
  assert.equal(impact.decay, 1.5);

  const spark = impactAssignments.find((assignment) => assignment.kind === "particle");
  assert.ok(spark);
  const particle = snapshot.particles.find((entry) => entry.id === spark.sourceId);
  const expectedSpark = { r: 0, g: 0, b: 0 };
  writeFireballPaletteColor(expectedSpark, definition, {
    kind: FIREBALL_COLOR_PARTICLE,
    life: 1 - particle.age / particle.lifetime,
    effectSeed: particle.effectSeed,
    sampleOrdinal: particle.sampleOrdinal,
  });
  closeColor(spark.color, expectedSpark);
  assert.equal(spark.distance, 4);
  assert.equal(spark.decay, 1);
  assert.ok(spark.intensity > 0 && spark.intensity <= 31);

  simulation.tick({ type: "clearSpellEffects", spellId: "fireball" });
  assert.deepEqual(budget.allocate(simulation.snapshot(), true, true), []);
  assert.equal(budget.diagnostics().admittedGroupCount, 0);
});

test("overlapping flight lights resolve energy through each projectile revision", () => {
  const map = new GridMap(48, 8, undefined, { x: 2, z: 4 });
  const first = authoredDefinition();
  first.presentation.flightLightIntensity = 11;
  const second = cloneFireballDefinition(first);
  second.presentation.flightLightIntensity = 99;
  const simulation = new Simulation({ map, initialFireballDefinition: first });
  simulation.tick({ cast: { x: 44, z: 4, variationSeed: 1 } });
  simulation.tick({
    actions: [{
      type: "applySpellDefinition",
      spellId: "fireball",
      expectedRevision: 1,
      definition: second,
    }],
    cast: { x: 44, z: 4, variationSeed: 2 },
  });
  const snapshot = simulation.snapshot();
  const assignments = new PresentationLightBudget({ capacity: 16 })
    .allocate(snapshot);
  const byProjectile = new Map(
    assignments
      .filter((assignment) => assignment.kind === "projectile")
      .map((assignment) => [assignment.sourceId, assignment]),
  );
  for (const projectile of snapshot.projectiles) {
    assert.equal(
      byProjectile.get(projectile.id).intensity,
      projectile.definitionRevision === 1 ? 11 : 99,
    );
  }
});

test("Three keeps mesh, material, node, color, emissive, and light resources stable across applies", () => {
  const options = parsePresentationOptions("?renderer=3d&lights=16");
  const flags = new PresentationFlags(options);
  const simulation = new Simulation({
    initialFireballDefinition: authoredDefinition(),
  });
  simulation.tick({
    cast: { x: 10, z: 18.5, variationSeed: 0x2468ace0 },
  });
  simulation.particles.spawn({
    x: 4,
    y: 1,
    z: 18,
    vx: 0,
    vy: 0,
    vz: 0,
    lifetime: 2,
    size: 0.08,
    spellCode: 1,
    definitionRevision: 1,
    effectId: 1,
    effectSeed: 0x2468ace0,
    sampleOrdinal: 3,
    sampleSeed: 4,
  });
  let snapshot = simulation.snapshot();
  const sightFrame = new TrueSightSystem({ flags }).update(
    snapshot,
    0,
    { mode: "play", deltaMs: 0 },
  );
  const presentation = new ThreePresentation(
    fakeCanvas(),
    new Camera3D(),
    options,
    performance.now(),
    flags,
    sightFrame,
  );
  presentation.resize = () => {};
  presentation.webRenderer.render = () => {};
  const view = {
    mouseWorld: { x: snapshot.player.x, z: snapshot.player.z },
    mouseInside: false,
    hover: null,
    selected: null,
    mode: "play",
    editorTool: "wall",
    placementValid: true,
    sightFrame,
  };
  presentation.render(snapshot, 0, view);
  assert.equal(presentation.projectileMaterial.color.getHex(), 0xffffff);

  const identities = {
    projectileMesh: presentation.projectileMesh,
    particleMesh: presentation.particleMesh,
    projectileMaterial: presentation.projectileMaterial,
    particleMaterial: presentation.particleMaterial,
    projectileColor: presentation.projectileMesh.instanceColor,
    particleColor: presentation.particleMesh.instanceColor,
    projectileEmissive: presentation.projectileMesh.userData.instanceEmissive,
    particleEmissive: presentation.particleMesh.userData.instanceEmissive,
    projectileEmissiveNode: presentation.projectileMaterial.emissiveNode,
    particleEmissiveNode: presentation.particleMaterial.emissiveNode,
    lights: [...presentation.dynamicLights],
  };
  assert.equal(identities.projectileColor.count, snapshot.pools.projectiles.capacity);
  assert.equal(identities.particleColor.count, snapshot.pools.particles.capacity);
  assert.equal(identities.projectileEmissive.count, snapshot.pools.projectiles.capacity);
  assert.equal(identities.particleEmissive.count, snapshot.pools.particles.capacity);

  const expectedProjectile = { r: 0, g: 0, b: 0 };
  writeFireballPaletteColor(expectedProjectile, authoredDefinition(), {
    kind: FIREBALL_COLOR_PROJECTILE,
    effectSeed: 0x2468ace0,
  });
  const actualProjectile = new THREE.Color();
  presentation.projectileMesh.getColorAt(0, actualProjectile);
  closeColor(actualProjectile, expectedProjectile);

  const changed = authoredDefinition();
  changed.palette.projectile = "#40A0FF";
  changed.presentation.projectileEmissiveStrength = 10;
  simulation.tick({
    actions: [{
      type: "applySpellDefinition",
      spellId: "fireball",
      expectedRevision: 1,
      definition: changed,
    }],
    cast: {
      x: 10,
      z: 18.5,
      variationSeed: 0x13579bdf,
    },
  });
  snapshot = simulation.snapshot();
  presentation.render(snapshot, 0, { ...view, sightFrame });

  assert.equal(presentation.projectileMesh, identities.projectileMesh);
  assert.equal(presentation.particleMesh, identities.particleMesh);
  assert.equal(presentation.projectileMaterial, identities.projectileMaterial);
  assert.equal(presentation.particleMaterial, identities.particleMaterial);
  assert.equal(presentation.projectileMesh.instanceColor, identities.projectileColor);
  assert.equal(presentation.particleMesh.instanceColor, identities.particleColor);
  assert.equal(
    presentation.projectileMesh.userData.instanceEmissive,
    identities.projectileEmissive,
  );
  assert.equal(
    presentation.particleMesh.userData.instanceEmissive,
    identities.particleEmissive,
  );
  assert.equal(
    presentation.projectileMaterial.emissiveNode,
    identities.projectileEmissiveNode,
  );
  assert.equal(
    presentation.particleMaterial.emissiveNode,
    identities.particleEmissiveNode,
  );
  assert.ok(
    presentation.dynamicLights.every(
      (light, index) => light === identities.lights[index] && light.visible,
    ),
  );

  const changedIndex = snapshot.projectiles.findIndex(
    (projectile) => projectile.definitionRevision === 2,
  );
  assert.ok(changedIndex >= 0);
  const expectedChanged = { r: 0, g: 0, b: 0 };
  writeFireballPaletteColor(expectedChanged, changed, {
    kind: FIREBALL_COLOR_PROJECTILE,
    effectSeed: 0x13579bdf,
  });
  presentation.projectileMesh.getColorAt(changedIndex, actualProjectile);
  closeColor(actualProjectile, expectedChanged);
  const expectedEmissive = { r: 0, g: 0, b: 0 };
  writeFireballPaletteColor(expectedEmissive, changed, {
    kind: FIREBALL_COLOR_CORE,
    effectSeed: 0x13579bdf,
  });
  const emissive = presentation.projectileMesh.userData.instanceEmissive;
  assert.equal(emissive.getX(changedIndex), Math.fround(expectedEmissive.r * 10));
  assert.equal(emissive.getY(changedIndex), Math.fround(expectedEmissive.g * 10));
  assert.equal(emissive.getZ(changedIndex), Math.fround(expectedEmissive.b * 10));
});
