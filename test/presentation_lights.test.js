import test from "node:test";
import assert from "node:assert/strict";

import {
  PRESENTATION_LIGHT_CAPACITY,
  PRESENTATION_LIGHT_GROUP_SIZE,
  SUPPORTED_PRESENTATION_LIGHT_CAPACITIES,
  PresentationLightBudget,
  applyFireballTint,
  deriveFireballTint,
  rec709Luminance,
  sparkFireColor,
  writeSparkFireColor,
} from "../src/presentation/light_budget.js";
import { applyLightPool } from "../src/presentation/light_pool.js";
import { mergeCatalogPropLights } from "../src/presentation/catalog_lights.js";

/** @param {number} id @param {number} x @param {number} z @param {number} [size] @param {number} [age] */
function particle(id, x, z, size = 0.06, age = 0.1) {
  return {
    id,
    x,
    y: 0.2,
    z,
    size,
    currentSize: size * (1 - age),
    age,
    lifetime: 1,
  };
}

/** @param {number} id @param {number} x @param {number} z */
function projectile(id, x, z) {
  return {
    id,
    x,
    z,
    previousX: x,
    previousZ: z,
    age: 0.1,
    lifetime: 4,
  };
}

/** @param {number} id @param {number} projectileId @param {number} tick @param {number} x @param {number} z */
function impact(id, projectileId, tick, x, z) {
  return {
    type: "explosion",
    id,
    projectileId,
    tick,
    originX: x,
    originZ: z,
  };
}

function snapshot(overrides = {}) {
  return {
    seed: 0x5eed1234,
    tick: 100,
    recentEvents: [],
    projectiles: [],
    particles: [],
    ...overrides,
  };
}

/** @param {number} firstId @param {number} x @param {number} z @param {number} [count] */
function burst(firstId, x, z, count = 8) {
  return Array.from({ length: count }, (_, index) => (
    particle(
      firstId + index,
      x + index * 0.002,
      z + index * 0.002,
      0.085 - index * 0.006,
      index * 0.01,
    )
  ));
}

test("catalog prop lights lease bounded resident slots and follow runtime torch positions", () => {
  const transient = Array.from({ length: 16 }, (_, residentSlot) => ({
    key: `transient:${residentSlot}`,
    residentSlot,
  }));
  const torches = Array.from({ length: 6 }, (_, index) => ({
    kind: "torch",
    id: index + 1,
    authoringId: `torch-${5 - index}`,
    definitionId: "object.torch",
    x: 10 + index,
    z: 20 + index,
  }));
  const assignments = mergeCatalogPropLights(transient, torches, 16);
  const propLights = assignments.filter((assignment) => assignment.kind === "catalog-prop");

  assert.equal(assignments.length, 16);
  assert.deepEqual(propLights.map((light) => light.residentSlot), [12, 13, 14, 15]);
  assert.deepEqual(
    propLights.map((light) => light.authoringId),
    ["torch-0", "torch-1", "torch-2", "torch-3"],
  );
  assert.equal(propLights[0].x, 15);
  assert.equal(propLights[0].y, 1.82);
  assert.equal(propLights[0].intensity, 18);
  assert.equal(assignments.some((light) => light.key === "transient:15"), false);
});

test("default topology is two atomic eight-slot effect groups", () => {
  const budget = new PresentationLightBudget();
  assert.equal(PRESENTATION_LIGHT_CAPACITY, 16);
  assert.equal(PRESENTATION_LIGHT_GROUP_SIZE, 8);
  assert.equal(budget.capacity, 16);
  assert.equal(budget.groupCapacity, 2);
});

test("transient lights are isolated to the visible runtime layer", () => {
  const budget = new PresentationLightBudget();
  const lowerProjectile = { ...projectile(1, 2, 2), layerId: "lower" };
  const upperProjectile = { ...projectile(2, 7, 7), layerId: "upper" };
  let assignments = budget.allocate(/** @type {any} */ (snapshot({
    projectiles: [lowerProjectile, upperProjectile],
  })), true, true, "lower");
  assert.deepEqual(assignments.map((light) => light.sourceId), [1]);

  assignments = budget.allocate(/** @type {any} */ (snapshot({
    tick: 101,
    projectiles: [lowerProjectile, upperProjectile],
  })), true, true, "upper");
  assert.deepEqual(assignments.map((light) => light.sourceId), [2]);
});

test("projectile slot zero becomes its explosion pulse without changing identity", () => {
  const budget = new PresentationLightBudget();
  const value = snapshot({
    tick: 10,
    projectiles: [projectile(7, 3, 4)],
  });
  const flight = budget.allocate(/** @type {any} */ (value));
  assert.equal(flight.length, 1);
  assert.equal(flight[0].kind, "projectile");
  assert.equal(flight[0].groupSlot, 0);

  value.tick = 11;
  value.projectiles = [];
  value.recentEvents = [impact(91, 7, 11, 5, 6)];
  value.particles = burst(100, 5, 6);
  const explosion = budget.allocate(/** @type {any} */ (value));
  assert.equal(explosion[0].kind, "explosion");
  assert.equal(explosion[0].key, flight[0].key);
  assert.equal(explosion[0].residentSlot, flight[0].residentSlot);
  assert.equal(explosion.filter((light) => light.projectileId === 7).length, 8);
});

test("an impact leases the seven largest associated newly observed sparks", () => {
  const budget = new PresentationLightBudget({ capacity: 8 });
  const particles = [
    particle(9, 1, 1, 0.04, 0.01),
    particle(8, 1, 1, 0.08, 0.9),
    particle(7, 1, 1, 0.07, 0.1),
    particle(6, 1, 1, 0.06, 0.2),
    particle(5, 1, 1, 0.05, 0.3),
    particle(4, 1, 1, 0.03, 0.1),
    particle(3, 1, 1, 0.025, 0.1),
    particle(2, 1, 1, 0.085, 0.99),
    particle(1, 1, 1, 0.04, 0.7),
  ];
  const assignments = budget.allocate(/** @type {any} */ (snapshot({
    recentEvents: [impact(1, 10, 100, 1, 1)],
    particles,
  })));
  assert.deepEqual(
    assignments.filter((light) => light.kind === "particle").map((light) => light.sourceId),
    [2, 8, 7, 6, 5, 9, 1],
  );
  assert.deepEqual(
    assignments.map((light) => light.groupSlot),
    [0, 1, 2, 3, 4, 5, 6, 7],
  );
});

test("new sparks associate with the nearest new impact and event ID breaks distance ties", () => {
  const budget = new PresentationLightBudget();
  const assignments = budget.allocate(/** @type {any} */ (snapshot({
    recentEvents: [
      impact(2, 20, 100, 0, 0),
      impact(1, 10, 100, 2, 0),
    ],
    particles: [
      particle(1, 0.1, 0),
      particle(2, 1.9, 0),
      particle(3, 1, 0),
    ],
  })));
  const groupByParticle = new Map(
    assignments
      .filter((light) => light.kind === "particle")
      .map((light) => [light.sourceId, light.projectileId]),
  );
  assert.equal(groupByParticle.get(1), 20);
  assert.equal(groupByParticle.get(2), 10);
  assert.equal(groupByParticle.get(3), 10);
});

test("capacity sixteen keeps two complete overlapping fireball groups", () => {
  const budget = new PresentationLightBudget({ capacity: 16 });
  const assignments = budget.allocate(/** @type {any} */ (snapshot({
    recentEvents: [
      impact(1, 11, 100, 2, 2),
      impact(2, 22, 100, 8, 8),
    ],
    particles: [
      ...burst(100, 2, 2),
      ...burst(200, 8, 8),
    ],
  })));
  assert.equal(assignments.length, 16);
  for (const projectileId of [11, 22]) {
    const group = assignments.filter((light) => light.projectileId === projectileId);
    assert.equal(group.length, 8);
    assert.deepEqual(group.map((light) => light.groupSlot), [0, 1, 2, 3, 4, 5, 6, 7]);
  }
  assert.deepEqual(
    new Set(assignments.map((light) => light.residentSlot)),
    new Set(Array.from({ length: 16 }, (_, index) => index)),
  );
});

test("a third impact retires the oldest whole group and its tail never relights", () => {
  const budget = new PresentationLightBudget({
    capacity: 16,
    explosionLifetimeTicks: 2,
  });
  const value = snapshot({
    tick: 10,
    recentEvents: [impact(1, 1, 10, 1, 1)],
    particles: burst(100, 1, 1),
  });
  budget.allocate(/** @type {any} */ (value));

  value.tick = 11;
  value.recentEvents.push(impact(2, 2, 11, 5, 5));
  value.particles.push(...burst(200, 5, 5));
  budget.allocate(/** @type {any} */ (value));

  value.tick = 12;
  value.recentEvents.push(impact(3, 3, 12, 9, 9));
  value.particles.push(...burst(300, 9, 9));
  const third = budget.allocate(/** @type {any} */ (value));
  assert.deepEqual(
    [...new Set(third.map((light) => light.projectileId))].sort(),
    [2, 3],
  );
  assert.equal(third.some((light) => light.sourceId >= 100 && light.sourceId < 200), false);

  value.tick = 14;
  value.particles = value.particles.filter((entry) => entry.id < 200 || entry.id >= 300);
  const afterOpening = budget.allocate(/** @type {any} */ (value));
  assert.deepEqual(
    [...new Set(afterOpening.map((light) => light.projectileId))],
    [3],
  );
  assert.equal(afterOpening.some((light) => light.projectileId === 1), false);
});

test("same-tick admission prefers impact, then flight, then tail, followed by ID", () => {
  const impactFirst = new PresentationLightBudget({ capacity: 8 });
  const value = snapshot({
    tick: 20,
    recentEvents: [
      impact(9, 9, 20, 1, 1),
      impact(8, 8, 20, 3, 3),
    ],
    projectiles: [projectile(1, 7, 7)],
    particles: [
      ...burst(100, 1, 1),
      ...burst(200, 3, 3),
    ],
  });
  const assignments = impactFirst.allocate(/** @type {any} */ (value));
  assert.deepEqual(
    [...new Set(assignments.map((light) => light.projectileId))],
    [8],
  );

  const flightBeforeTail = new PresentationLightBudget({
    capacity: 8,
    explosionLifetimeTicks: 1,
  });
  const tail = snapshot({
    tick: 30,
    recentEvents: [impact(1, 1, 30, 1, 1)],
    particles: burst(300, 1, 1),
  });
  flightBeforeTail.allocate(/** @type {any} */ (tail));
  tail.tick = 31;
  tail.projectiles = [projectile(2, 5, 5)];
  const flight = flightBeforeTail.allocate(/** @type {any} */ (tail));
  assert.deepEqual(
    [...new Set(flight.map((light) => light.projectileId))],
    [2],
  );
});

test("carrier disappearance leaves its exact tail slot dark without backfill", () => {
  const budget = new PresentationLightBudget({
    capacity: 8,
    explosionLifetimeTicks: 1,
  });
  const value = snapshot({
    recentEvents: [impact(1, 1, 100, 2, 2)],
    particles: burst(1, 2, 2),
  });
  const initial = budget.allocate(/** @type {any} */ (value));
  const carrier = initial.find((light) => light.groupSlot === 3);
  assert.ok(carrier);
  const unlitOldParticle = value.particles[7].id;

  value.tick = 101;
  value.particles = value.particles.filter((entry) => entry.id !== carrier.sourceId);
  const tail = budget.allocate(/** @type {any} */ (value));
  assert.equal(tail.some((light) => light.groupSlot === 3), false);
  assert.equal(tail.some((light) => light.sourceId === unlitOldParticle), false);
  assert.deepEqual(
    tail.map((light) => light.groupSlot),
    [1, 2, 4, 5, 6, 7],
  );
});

test("an unlit flight may request a fresh group when that projectile impacts", () => {
  const budget = new PresentationLightBudget({ capacity: 8 });
  const value = snapshot({
    tick: 1,
    projectiles: [projectile(1, 1, 1), projectile(2, 2, 2)],
  });
  const flight = budget.allocate(/** @type {any} */ (value));
  assert.equal(flight[0].projectileId, 1);

  value.tick = 2;
  value.projectiles = [projectile(1, 1, 1)];
  value.recentEvents = [impact(1, 2, 2, 4, 4)];
  value.particles = burst(10, 4, 4);
  const impactAssignments = budget.allocate(/** @type {any} */ (value));
  assert.ok(impactAssignments.every((light) => light.projectileId === 2));
  assert.equal(impactAssignments[0].kind, "explosion");
});

test("disable, timeline rollback, and seed changes clear all group observations", () => {
  const budget = new PresentationLightBudget({ capacity: 8 });
  const value = snapshot({
    recentEvents: [impact(1, 1, 100, 1, 1)],
    particles: burst(1, 1, 1),
  });
  budget.allocate(/** @type {any} */ (value));
  assert.equal(budget.diagnostics().admittedGroupCount, 1);
  assert.deepEqual(budget.allocate(/** @type {any} */ (value), false), []);
  assert.equal(budget.groups.size, 0);
  assert.equal(budget.observedParticleIds.size, 0);

  budget.allocate(/** @type {any} */ (value));
  value.tick = 99;
  value.recentEvents = [];
  value.particles = [];
  budget.allocate(/** @type {any} */ (value));
  assert.equal(budget.groups.size, 0);

  value.tick = 100;
  value.seed += 1;
  value.particles = [particle(1, 0, 0)];
  const afterSeed = budget.allocate(/** @type {any} */ (value));
  assert.equal(afterSeed.length, 1);
  assert.equal(afterSeed[0].projectileId, "orphan");
});

test("scenario restoration clears reused transient IDs even while tick increases", () => {
  const budget = new PresentationLightBudget({ capacity: 8 });
  const value = snapshot({
    tick: 10,
    recentEvents: [impact(1, 1, 10, 1, 1)],
    particles: burst(1, 1, 1),
  });
  budget.allocate(/** @type {any} */ (value));

  value.tick = 11;
  value.recentEvents = [];
  value.projectiles = [];
  value.particles = [];
  assert.deepEqual(budget.allocate(/** @type {any} */ (value)), []);
  assert.equal(budget.observedParticleIds.size, 0);

  value.tick = 12;
  value.projectiles = [projectile(1, 2, 2)];
  const reusedFlight = budget.allocate(/** @type {any} */ (value));
  assert.equal(reusedFlight[0].kind, "projectile");
  value.tick = 13;
  value.projectiles = [];
  value.recentEvents = [impact(1, 1, 13, 3, 3)];
  value.particles = burst(1, 3, 3);
  const reusedImpact = budget.allocate(/** @type {any} */ (value));
  assert.equal(reusedImpact.length, 8);
});

test("observation and retirement bookkeeping stays bounded to current snapshot history", () => {
  const budget = new PresentationLightBudget({ capacity: 8 });
  const value = snapshot({
    tick: 1,
    recentEvents: [impact(1, 1, 1, 1, 1)],
    particles: burst(1, 1, 1),
  });
  budget.allocate(/** @type {any} */ (value));
  assert.equal(budget.observedParticleIds.size, value.particles.length);
  assert.equal(budget.observedEventIds.size, value.recentEvents.length);

  value.tick = 2;
  value.recentEvents = [impact(2, 2, 2, 4, 4)];
  value.particles = burst(100, 4, 4, 3);
  budget.allocate(/** @type {any} */ (value));
  assert.equal(budget.observedParticleIds.size, 3);
  assert.deepEqual([...budget.observedEventIds], [2]);
  assert.ok(budget.retiredTailProjectileIds.size <= value.recentEvents.length);
});

test("direct particle fixtures use a deterministic orphan tail group", () => {
  const first = new PresentationLightBudget({ capacity: 8 });
  const second = new PresentationLightBudget({ capacity: 8 });
  const value = snapshot({ particles: burst(1, 3, 3, 10) });
  const left = first.allocate(/** @type {any} */ (value));
  const right = second.allocate(/** @type {any} */ (value));
  assert.deepEqual(left, right);
  assert.equal(left.length, 7);
  assert.ok(left.every((light) => light.projectileId === "orphan"));
  assert.deepEqual(left.map((light) => light.groupSlot), [1, 2, 3, 4, 5, 6, 7]);
});

test("every supported capacity admits only complete eight-slot groups", () => {
  assert.deepEqual(SUPPORTED_PRESENTATION_LIGHT_CAPACITIES, [8, 16, 32, 64]);
  for (const capacity of SUPPORTED_PRESENTATION_LIGHT_CAPACITIES) {
    const budget = new PresentationLightBudget({ capacity });
    const groupCount = capacity / 8 + 1;
    const events = [];
    const particles = [];
    for (let index = 0; index < groupCount; index += 1) {
      const id = index + 1;
      events.push(impact(id, id, 100, id * 3, id * 3));
      particles.push(...burst(id * 100, id * 3, id * 3));
    }
    const assignments = budget.allocate(/** @type {any} */ (snapshot({
      recentEvents: events,
      particles,
    })));
    assert.equal(assignments.length, capacity);
    assert.equal(new Set(assignments.map((light) => light.projectileId)).size, capacity / 8);
    assert.ok(assignments.every((light) => light.residentSlot < capacity));
  }
  assert.throws(
    () => new PresentationLightBudget({ capacity: 24 }),
    /must be one of/,
  );
});

test("explosion pulse fades smoothly and releases only group slot zero", () => {
  const budget = new PresentationLightBudget({
    capacity: 8,
    explosionLifetimeTicks: 10,
  });
  const value = snapshot({
    recentEvents: [impact(1, 1, 100, 1, 2)],
    particles: burst(1, 1, 2),
  });
  const initial = budget.allocate(/** @type {any} */ (value));
  value.tick = 109;
  const fading = budget.allocate(/** @type {any} */ (value));
  assert.ok(fading[0].intensity < initial[0].intensity * 0.03);
  value.tick = 110;
  const tail = budget.allocate(/** @type {any} */ (value));
  assert.equal(tail.some((light) => light.groupSlot === 0), false);
  assert.equal(tail.length, 7);
});

test("fireball tint is stable, bounded, shared, and luminance preserving", () => {
  for (const projectileId of [1, 2, 99, 0xffff]) {
    const tint = deriveFireballTint(0x12345678, projectileId);
    assert.deepEqual(tint, deriveFireballTint(0x12345678, projectileId));
    assert.ok(tint.amount >= 0.01);
    assert.ok(tint.amount <= 0.03);
    const source = sparkFireColor(0.63);
    const tinted = applyFireballTint(source, tint);
    assert.ok(Math.abs(rec709Luminance(tinted) - rec709Luminance(source)) < 1e-12);
  }

  const budget = new PresentationLightBudget({ capacity: 8 });
  const value = snapshot({
    recentEvents: [impact(1, 7, 100, 1, 1)],
    particles: burst(1, 1, 1),
  });
  const first = budget.allocate(/** @type {any} */ (value));
  value.tick += 1;
  const second = budget.allocate(/** @type {any} */ (value));
  assert.deepEqual(
    new Set(first.map((light) => JSON.stringify(light.tint))),
    new Set(second.map((light) => JSON.stringify(light.tint))),
  );
  assert.equal(new Set(first.map((light) => JSON.stringify(light.tint))).size, 1);
});

test("color variation changes point lights only and can be disabled live", () => {
  const varied = new PresentationLightBudget({ capacity: 8 });
  const plain = new PresentationLightBudget({ capacity: 8 });
  const value = snapshot({
    recentEvents: [impact(1, 7, 100, 1, 1)],
    particles: burst(1, 1, 1),
  });
  const tinted = varied.allocate(/** @type {any} */ (value), true, true);
  const untinted = plain.allocate(/** @type {any} */ (value), true, false);
  assert.notDeepEqual(tinted.map((light) => light.color), untinted.map((light) => light.color));
  for (let index = 0; index < tinted.length; index += 1) {
    assert.ok(
      Math.abs(
        rec709Luminance(tinted[index].color)
        - rec709Luminance(untinted[index].color),
      ) < 1e-12,
    );
  }

  const target = {
    setRGB(r, g, b) {
      this.value = { r, g, b };
    },
  };
  writeSparkFireColor(target, 0.58);
  assert.deepEqual(target.value, sparkFireColor(0.58));
});

function residentLight(id) {
  return {
    id,
    visible: false,
    castShadow: true,
    intensity: -1,
    distance: 0,
    decay: 0,
    userData: {},
    position: {
      set(x, y, z) {
        this.value = [x, y, z];
      },
    },
    color: {
      setRGB(r, g, b) {
        this.value = [r, g, b];
      },
    },
  };
}

/** @param {number} slot @param {number} [id] */
function assignment(slot, id = slot) {
  return {
    key: `test:${id}`,
    residentSlot: slot,
    x: id,
    y: 0.5,
    z: id + 1,
    color: { r: 1, g: 0.5, b: 0.1 },
    intensity: id + 1,
    distance: 3,
    decay: 2,
  };
}

test("explicit resident slots preserve group identity while holes stay dark", () => {
  const lights = Array.from({ length: 16 }, (_, index) => residentLight(index));
  const identities = [...lights];
  assert.equal(applyLightPool(lights, [assignment(0), assignment(7), assignment(8)]), 3);
  assert.equal(lights[7].userData.assignment, "test:7");

  assert.equal(applyLightPool(lights, [assignment(0), assignment(8), assignment(15)]), 3);
  assert.equal(lights[7].intensity, 0);
  assert.equal(lights[7].userData.assignment, null);
  assert.equal(lights[8].userData.assignment, "test:8");
  assert.equal(lights[15].userData.assignment, "test:15");
  assert.ok(lights.every((light) => light.visible));
  assert.ok(lights.every((light) => light.castShadow === false));
  assert.ok(lights.every((light, index) => light === identities[index]));
});

test("dynamicLights=false zeros all resident intensities without changing topology", () => {
  const lights = Array.from({ length: 16 }, (_, index) => residentLight(index));
  const identities = [...lights];
  applyLightPool(lights, Array.from({ length: 16 }, (_, index) => assignment(index)));
  assert.equal(applyLightPool(lights, [], false), 0);
  assert.ok(lights.every((light, index) => light === identities[index]));
  assert.ok(lights.every((light) => light.visible));
  assert.ok(lights.every((light) => light.castShadow === false));
  assert.ok(lights.every((light) => light.intensity === 0));
});
