import test from "node:test";
import assert from "node:assert/strict";

import {
  PRESENTATION_LIGHT_CAPACITY,
  PresentationLightBudget,
  sparkFireColor,
} from "../src/presentation/light_budget.js";

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

test("spark lights keep stable leases until a carrier disappears", () => {
  const budget = new PresentationLightBudget();
  const initialSnapshot = snapshot();
  const first = budget.allocate(/** @type {any} */ (initialSnapshot));
  const leased = first.filter((light) => light.kind === "particle").map((light) => light.sourceId);

  initialSnapshot.particles.push(particle(999, 0.085, 0));
  const retained = budget.allocate(/** @type {any} */ (initialSnapshot));
  assert.deepEqual(
    retained.filter((light) => light.kind === "particle").map((light) => light.sourceId),
    leased,
  );

  initialSnapshot.particles = initialSnapshot.particles.filter((value) => value.id !== leased[1]);
  const replaced = budget.allocate(/** @type {any} */ (initialSnapshot));
  const nextIds = replaced.filter((light) => light.kind === "particle").map((light) => light.sourceId);
  assert.equal(nextIds.includes(leased[1]), false);
  assert.equal(nextIds.includes(999), true);
});

test("disabling dynamic lights releases leases and returns an empty budget", () => {
  const budget = new PresentationLightBudget();
  budget.allocate(/** @type {any} */ (snapshot()));
  assert.ok(budget.sparkLeases.size > 0);
  assert.deepEqual(budget.allocate(/** @type {any} */ (snapshot()), false), []);
  assert.equal(budget.sparkLeases.size, 0);
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
