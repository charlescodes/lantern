import test from "node:test";
import assert from "node:assert/strict";

import {
  PRESENTATION_LIGHT_CAPACITY,
  PresentationLightBudget,
  sparkFireColor,
  writeSparkFireColor,
} from "../src/presentation/light_budget.js";
import { applyLightPool } from "../src/presentation/light_pool.js";

/** @param {number} id @param {number} size @param {number} [age] */
function particle(id, size, age = 0.1) {
  return {
    id,
    x: id / 10,
    y: 0.2,
    z: id / 20,
    size,
    currentSize: size * 0.9,
    age,
    lifetime: 1,
  };
}

function snapshot() {
  return {
    tick: 100,
    recentEvents: [
      { type: "explosion", id: 2, tick: 99, originX: 2, originZ: 3 },
      { type: "explosion", id: 1, tick: 100, originX: 1, originZ: 2 },
    ],
    projectiles: [
      { id: 7, x: 7, z: 1, age: 0.2, lifetime: 4 },
      { id: 3, x: 3, z: 1, age: 0.1, lifetime: 4 },
    ],
    particles: [
      particle(10, 0.08),
      particle(11, 0.07),
      particle(12, 0.06),
      particle(13, 0.05),
      particle(14, 0.04),
      particle(15, 0.03),
    ],
  };
}

test("deterministic light budgeting caps the pool and honors source priority", () => {
  const firstBudget = new PresentationLightBudget();
  const secondBudget = new PresentationLightBudget();
  const first = firstBudget.allocate(/** @type {any} */ (snapshot()));
  const second = secondBudget.allocate(/** @type {any} */ (snapshot()));

  assert.equal(PRESENTATION_LIGHT_CAPACITY, 8);
  assert.equal(first.length, 8);
  assert.deepEqual(first, second);
  assert.deepEqual(first.map((light) => light.kind), [
    "explosion",
    "explosion",
    "projectile",
    "projectile",
    "particle",
    "particle",
    "particle",
    "particle",
  ]);
  assert.deepEqual(first.slice(0, 4).map((light) => light.sourceId), [1, 2, 3, 7]);
  assert.ok(first.every((light) => light.decay === 2));
  assert.deepEqual(first.slice(0, 2).map((light) => light.distance), [5, 5]);
  assert.deepEqual(first.slice(2, 4).map((light) => light.distance), [3, 3]);
  assert.ok(first.slice(4).every((light) => light.distance === 1.5));
});

test("removed carriers leave dark capacity instead of backfilling from older sparks", () => {
  const budget = new PresentationLightBudget();
  const initialSnapshot = snapshot();
  const first = budget.allocate(/** @type {any} */ (initialSnapshot));
  const leased = first.filter((light) => light.kind === "particle").map((light) => light.sourceId);

  initialSnapshot.particles.push(particle(999, 0.085, 0));
  initialSnapshot.tick += 1;
  const retained = budget.allocate(/** @type {any} */ (initialSnapshot));
  assert.deepEqual(
    retained.filter((light) => light.kind === "particle").map((light) => light.sourceId),
    leased,
  );

  initialSnapshot.particles = initialSnapshot.particles.filter((value) => value.id !== leased[1]);
  initialSnapshot.tick += 1;
  const darkened = budget.allocate(/** @type {any} */ (initialSnapshot));
  const darkenedIds = darkened
    .filter((light) => light.kind === "particle")
    .map((light) => light.sourceId);
  assert.deepEqual(darkenedIds, leased.filter((id) => id !== leased[1]));
  assert.equal(darkenedIds.includes(999), false);

  initialSnapshot.particles.push(particle(1_000, 0.04, 0));
  initialSnapshot.tick += 1;
  const laterBurst = budget.allocate(/** @type {any} */ (initialSnapshot));
  assert.deepEqual(
    laterBurst.filter((light) => light.kind === "particle").map((light) => light.sourceId),
    [...darkenedIds, 1_000],
  );
});

test("low-life leased sparks stay bound while intensity fades continuously to zero", () => {
  const budget = new PresentationLightBudget({ capacity: 1 });
  const value = snapshot();
  value.recentEvents = [];
  value.projectiles = [];
  value.particles = [particle(41, 0.085, 0)];

  const initial = budget.allocate(/** @type {any} */ (value))[0];
  value.tick += 1;
  value.particles[0].age = 0.99;
  const fading = budget.allocate(/** @type {any} */ (value))[0];
  const life = 0.01;
  const expectedFade = life * life * (3 - 2 * life);

  assert.equal(fading.key, initial.key);
  assert.ok(fading.intensity > 0);
  assert.ok(fading.intensity < initial.intensity * 0.001);
  assert.ok(Math.abs(fading.intensity - initial.intensity * expectedFade) < 1e-12);

  value.tick += 1;
  value.particles[0].age = 1;
  const zero = budget.allocate(/** @type {any} */ (value))[0];
  assert.equal(zero.key, initial.key);
  assert.equal(zero.intensity, 0);
});

test("explosion and projectile preemption permanently retire old spark leases", () => {
  for (const source of ["explosion", "projectile"]) {
    const budget = new PresentationLightBudget({
      capacity: 2,
      explosionLifetimeTicks: 2,
    });
    const value = snapshot();
    value.recentEvents = [];
    value.projectiles = [];
    value.particles = [particle(51, 0.08), particle(52, 0.07)];

    assert.deepEqual(
      budget.allocate(/** @type {any} */ (value)).map((light) => light.sourceId),
      [51, 52],
    );

    value.tick += 1;
    if (source === "explosion") {
      value.recentEvents = [{
        type: "explosion",
        id: 91,
        tick: value.tick,
        originX: 1,
        originZ: 2,
      }];
    } else {
      value.projectiles = [{ id: 92, x: 1, z: 2, age: 0, lifetime: 4 }];
    }
    assert.deepEqual(
      budget.allocate(/** @type {any} */ (value)).map((light) => light.kind),
      [source, "particle"],
    );
    assert.equal(budget.sparkLeases.has(52), false);

    value.tick += 2;
    value.projectiles = [];
    const afterPreemption = budget.allocate(/** @type {any} */ (value));
    assert.deepEqual(
      afterPreemption.map((light) => light.key),
      ["particle:51"],
    );
  }
});

test("dynamic-light disable and timeline rollback clear observations and leases", () => {
  const budget = new PresentationLightBudget();
  const value = snapshot();
  budget.allocate(/** @type {any} */ (value));
  assert.ok(budget.sparkLeases.size > 0);
  assert.ok(budget.observedSparkIds.size > budget.sparkLeases.size);

  assert.deepEqual(budget.allocate(/** @type {any} */ (value), false), []);
  assert.equal(budget.sparkLeases.size, 0);
  assert.equal(budget.observedSparkIds.size, 0);
  assert.equal(budget.lastTick, null);

  budget.allocate(/** @type {any} */ (value));
  assert.ok(budget.sparkLeases.size > 0);
  value.tick -= 1;
  value.recentEvents = [];
  value.projectiles = [];
  value.particles = [];
  assert.deepEqual(budget.allocate(/** @type {any} */ (value)), []);
  assert.equal(budget.sparkLeases.size, 0);
  assert.equal(budget.observedSparkIds.size, 0);

  value.tick += 1;
  value.particles = [particle(10, 0.08)];
  assert.deepEqual(
    budget.allocate(/** @type {any} */ (value)).map((light) => light.key),
    ["particle:10"],
  );
});

test("explosion lights pulse down and release their slot at the lifetime boundary", () => {
  const budget = new PresentationLightBudget({ capacity: 1, explosionLifetimeTicks: 10 });
  const value = snapshot();
  value.recentEvents = [
    { type: "explosion", id: 1, tick: 100, originX: 1, originZ: 2 },
  ];
  value.projectiles = [];
  value.particles = [];

  const initial = budget.allocate(/** @type {any} */ (value))[0];
  value.tick = 109;
  const fading = budget.allocate(/** @type {any} */ (value))[0];
  assert.ok(fading.intensity < initial.intensity * 0.03);
  value.tick = 110;
  assert.deepEqual(budget.allocate(/** @type {any} */ (value)), []);
});

test("spark fire color cools from yellow core through amber to red-orange", () => {
  const young = sparkFireColor(1);
  const middle = sparkFireColor(0.58);
  const old = sparkFireColor(0);
  assert.ok(young.g > middle.g && middle.g > old.g);
  assert.ok(young.b > middle.b && middle.b > old.b);
  assert.ok(old.r > 0.9);
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

/** @param {number} id */
function assignment(id) {
  return {
    key: `test:${id}`,
    x: id,
    y: 0.5,
    z: id + 1,
    color: { r: 1, g: 0.5, b: 0.1 },
    intensity: id + 1,
    distance: 3,
    decay: 2,
  };
}

test("keyed resident slots survive removal, insertion, disable, and 0 -> 8 -> 0", () => {
  const lights = Array.from(
    { length: PRESENTATION_LIGHT_CAPACITY },
    (_, index) => residentLight(index),
  );
  const identities = [...lights];
  assert.equal(applyLightPool(lights, [assignment(1), assignment(2), assignment(3)]), 3);
  const originalSlots = new Map(
    lights.map((light, index) => [light.userData.assignment, index]),
  );

  assert.equal(applyLightPool(lights, [assignment(3), assignment(2), assignment(4)]), 3);
  assert.equal(lights[originalSlots.get("test:2")].userData.assignment, "test:2");
  assert.equal(lights[originalSlots.get("test:3")].userData.assignment, "test:3");
  assert.equal(lights[originalSlots.get("test:1")].userData.assignment, "test:4");

  const beforeDisable = lights.map((light) => light.userData.assignment);
  assert.equal(applyLightPool(lights, [], false), 0);
  assert.ok(lights.every((light) => light.intensity === 0));
  assert.deepEqual(lights.map((light) => light.userData.assignment), beforeDisable);
  assert.equal(applyLightPool(lights, [assignment(4), assignment(2), assignment(3)]), 3);
  assert.deepEqual(lights.map((light) => light.userData.assignment), beforeDisable);

  assert.equal(applyLightPool(lights, []), 0);
  assert.ok(lights.every((light) => light.userData.assignment === null));
  const full = Array.from(
    { length: PRESENTATION_LIGHT_CAPACITY },
    (_, index) => assignment(index + 10),
  );
  assert.equal(applyLightPool(lights, full), PRESENTATION_LIGHT_CAPACITY);
  assert.deepEqual(
    lights.map((light) => light.userData.assignment),
    full.map((value) => value.key),
  );
  assert.equal(applyLightPool(lights, []), 0);
  assert.ok(lights.every((light) => light.userData.assignment === null));

  assert.ok(lights.every((light) => light.visible));
  assert.ok(lights.every((light) => light.castShadow === false));
  assert.ok(lights.every((light, index) => light === identities[index]));
});

test("dynamicLights=false zeros all intensities without changing topology", () => {
  const lights = Array.from(
    { length: PRESENTATION_LIGHT_CAPACITY },
    (_, index) => residentLight(index),
  );
  const identities = [...lights];
  assert.equal(
    applyLightPool(
      lights,
      Array.from({ length: PRESENTATION_LIGHT_CAPACITY }, (_, index) => assignment(index)),
      false,
    ),
    0,
  );
  assert.ok(lights.every((light, index) => light === identities[index]));
  assert.ok(lights.every((light) => light.visible));
  assert.ok(lights.every((light) => light.intensity === 0));
});

test("single-explosion tail darkens slots without hopping to an eighth old spark", () => {
  const budget = new PresentationLightBudget({
    capacity: PRESENTATION_LIGHT_CAPACITY,
    explosionLifetimeTicks: 2,
  });
  const lights = Array.from(
    { length: PRESENTATION_LIGHT_CAPACITY },
    (_, index) => residentLight(index),
  );
  const value = {
    tick: 200,
    recentEvents: [
      { type: "explosion", id: 71, tick: 200, originX: 2, originZ: 3 },
    ],
    projectiles: [],
    particles: Array.from(
      { length: PRESENTATION_LIGHT_CAPACITY },
      (_, index) => particle(index + 1, 0.085 - index * 0.005, 0.05),
    ),
  };

  const initial = budget.allocate(/** @type {any} */ (value));
  const initialParticleKeys = initial
    .filter((light) => light.kind === "particle")
    .map((light) => light.key);
  assert.equal(initial[0].key, "explosion:71");
  assert.equal(initialParticleKeys.length, 7);
  assert.equal(initialParticleKeys.includes("particle:8"), false);
  assert.equal(applyLightPool(lights, initial), 8);
  const explosionSlot = lights.findIndex(
    (light) => light.userData.assignment === "explosion:71",
  );
  const initialSlots = new Map(
    lights.map((light, index) => [light.userData.assignment, index]),
  );

  value.tick += 2;
  const pulseExpired = budget.allocate(/** @type {any} */ (value));
  assert.deepEqual(pulseExpired.map((light) => light.key), initialParticleKeys);
  assert.equal(applyLightPool(lights, pulseExpired), 7);
  assert.equal(lights[explosionSlot].intensity, 0);
  assert.equal(lights[explosionSlot].userData.assignment, null);
  for (const key of initialParticleKeys) {
    assert.equal(lights[initialSlots.get(key)].userData.assignment, key);
  }

  const allowedTailKeys = new Set(initialParticleKeys);
  let previousCount = initialParticleKeys.length;
  for (const removedKey of initialParticleKeys) {
    const removedId = Number(removedKey.split(":")[1]);
    value.tick += 1;
    value.particles = value.particles.filter((entry) => entry.id !== removedId);
    const tail = budget.allocate(/** @type {any} */ (value));
    const tailKeys = tail.map((light) => light.key);
    assert.equal(tailKeys.length, previousCount - 1);
    assert.ok(tailKeys.every((key) => allowedTailKeys.has(key)));
    assert.equal(tailKeys.includes("particle:8"), false);
    assert.equal(applyLightPool(lights, tail), tailKeys.length);
    previousCount = tailKeys.length;
  }
});

test("spark color writer reuses the provided color target", () => {
  const target = {
    setRGB(r, g, b) {
      this.value = { r, g, b };
    },
  };
  assert.equal(writeSparkFireColor(target, 0.58), target);
  assert.deepEqual(target.value, sparkFireColor(0.58));
});
