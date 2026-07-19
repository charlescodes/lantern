import test from "node:test";
import assert from "node:assert/strict";

import {
  PARTICLE_PROFILE_M02,
  PARTICLE_PROFILE_M0_2_5,
} from "../src/config.js";
import { GridMap } from "../src/sim/grid_map.js";
import { Simulation } from "../src/sim/simulation.js";

/** @param {number} actual @param {number} expected @param {number} [epsilon] */
function closeTo(actual, expected, epsilon = 1e-6) {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `expected ${actual} to be within ${epsilon} of ${expected}`,
  );
}

/** @param {number} burstCount @param {string} [particleProfile] */
function impactBurst(burstCount, particleProfile = PARTICLE_PROFILE_M0_2_5) {
  const map = new GridMap(8, 6, undefined, { x: 1.5, z: 2.5 });
  map.set(3, 2, 1);
  const simulation = new Simulation({
    map,
    seed: 0x5a17,
    particleCapacity: burstCount,
    particleBurstCount: burstCount,
    particleProfile,
    particleWallCollision: false,
  });
  simulation.projectiles.spawn({
    x: 2,
    z: 2.5,
    vx: 120,
    vz: 0,
    lifetime: 2,
    radius: 0.12,
  });
  simulation.tick(null);
  return simulation;
}

test("balanced profile correlates maximum size and lifetime within bounded ranges", () => {
  const simulation = impactBurst(4_096);
  const particles = simulation.snapshot().particles.toSorted((left, right) => left.size - right.size);
  assert.equal(particles.length, 4_096);
  for (const particle of particles) {
    assert.ok(particle.size >= 0.025 && particle.size <= Math.fround(0.085));
    assert.ok(particle.lifetime >= Math.fround(0.18) && particle.lifetime <= Math.fround(1.1));
    assert.ok(particle.currentSize > 0 && particle.currentSize < particle.size);
  }

  const quartile = particles.length / 4;
  const small = particles.slice(0, quartile);
  const large = particles.slice(-quartile);
  const largestSmallLifetime = Math.max(...small.map((particle) => particle.lifetime));
  const smallestLargeLifetime = Math.min(...large.map((particle) => particle.lifetime));
  assert.ok(smallestLargeLifetime > largestSmallLifetime);
  const meanLifetime =
    particles.reduce((sum, particle) => sum + particle.lifetime, 0) / particles.length;
  assert.ok(meanLifetime > 0.61 && meanLifetime < 0.66);
});

test("balanced low arcs make a majority of a full burst contact the ground", () => {
  const simulation = impactBurst(4_096);
  for (let tick = 0; tick < 72; tick += 1) simulation.tick(null);
  const groundHitRatio = simulation.particles.groundBounces / 4_096;
  assert.ok(
    groundHitRatio >= 0.5 && groundHitRatio <= 0.7,
    `expected 50-70% ground hits, observed ${(groundHitRatio * 100).toFixed(1)}%`,
  );
  assert.equal(simulation.debugFlags.particleBounce, true);
});

test("balanced particles expire by size-linked lifetime after settling on the ground", () => {
  const simulation = impactBurst(4_096);
  const particles = simulation.snapshot().particles
    .map((particle) => ({
      id: particle.id,
      size: particle.size,
      lifetime: particle.lifetime,
      death: null,
    }))
    .toSorted((left, right) => left.size - right.size);

  for (let tick = 0; tick < 72; tick += 1) {
    simulation.tick(null);
    const alive = new Set();
    for (let index = 0; index < simulation.particles.activeCount; index += 1) {
      alive.add(simulation.particles.id[index]);
    }
    for (const particle of particles) {
      if (particle.death === null && !alive.has(particle.id)) {
        particle.death = simulation.tickCount / 60;
        assert.ok(
          particle.death + 1e-5 >= particle.lifetime,
          `particle ${particle.id} died at ${particle.death}s before ${particle.lifetime}s`,
        );
      }
    }
  }

  assert.ok(particles.every((particle) => particle.death !== null));
  const quartile = particles.length / 4;
  const meanDeath = (items) =>
    items.reduce((sum, particle) => sum + particle.death, 0) / items.length;
  const smallMeanDeath = meanDeath(particles.slice(0, quartile));
  const largeMeanDeath = meanDeath(particles.slice(-quartile));
  assert.ok(
    largeMeanDeath - smallMeanDeath > 0.5,
    `expected visibly staggered expiry, observed ${smallMeanDeath}s versus ${largeMeanDeath}s`,
  );
});

test("current radius shrinks by normalized age in snapshots, picking, and inspector output", () => {
  const map = new GridMap(10, 10, undefined, { x: 1.5, z: 1.5 });
  const simulation = new Simulation({ map, particleBurstCount: 0 });
  const id = simulation.particles.spawn({
    x: 5,
    y: 5,
    z: 5,
    vx: 0,
    vy: 0,
    vz: 0,
    lifetime: 1,
    size: 0.08,
  });
  const spawned = simulation.snapshot().particles[0];
  closeTo(spawned.size, Math.fround(0.08));
  closeTo(spawned.currentSize, Math.fround(0.08));
  assert.equal(simulation.queryAt(5.145, 5).kind, "particle");

  simulation.particles.age[0] = 0.5;
  const halfway = simulation.snapshot().particles[0];
  const expectedHalfway = Math.fround(0.08) * 0.5 ** 0.65;
  closeTo(halfway.currentSize, expectedHalfway);
  const inspected = simulation.resolveSelection({ kind: "particle", id });
  closeTo(inspected.radius, expectedHalfway);
  closeTo(inspected.maxRadius, Math.fround(0.08));
  assert.equal(simulation.queryAt(5.145, 5).kind, "cell");

  simulation.particles.age[0] = 0.99;
  const nearlyExpired = simulation.snapshot().particles[0];
  closeTo(nearlyExpired.currentSize, Math.fround(0.08) * 0.01 ** 0.65);
  assert.ok(nearlyExpired.currentSize < halfway.currentSize);
});

test("balanced ground response bounces once, then settles until age expiry", () => {
  const map = new GridMap(8, 6, undefined, { x: 1.5, z: 1.5 });
  const simulation = new Simulation({
    map,
    particleBurstCount: 0,
    particleWallCollision: false,
  });
  const id = simulation.particles.spawn({
    x: 2,
    y: 0.01,
    z: 1.5,
    vx: 6,
    vy: -2,
    vz: 3,
    lifetime: 1,
    size: 0.05,
  });

  simulation.tick(null);

  const index = simulation.particles.findIndexById(id);
  assert.ok(index >= 0);
  closeTo(simulation.particles.vx[index], 6 * 0.82);
  closeTo(simulation.particles.vy[index], Math.abs(-2 - 9.81 / 60) * 0.45);
  closeTo(simulation.particles.vz[index], 3 * 0.82);
  assert.equal(simulation.particles.bounced[index], 1);
  assert.equal(simulation.particles.groundBounces, 1);
  assert.equal(simulation.snapshot().pools.particles.groundBounces, 1);

  simulation.particles.y[index] = -0.01;
  simulation.particles.vy[index] = -1;
  simulation.tick(null);
  const settledIndex = simulation.particles.findIndexById(id);
  assert.ok(settledIndex >= 0);
  closeTo(simulation.particles.y[settledIndex], 0);
  closeTo(simulation.particles.vy[settledIndex], 0);
  closeTo(simulation.particles.vx[settledIndex], 6 * 0.82 * 0.82);
  closeTo(simulation.particles.vz[settledIndex], 3 * 0.82 * 0.82);
  assert.equal(simulation.particles.bounced[settledIndex], 1);
  assert.equal(simulation.particles.groundBounces, 1);

  simulation.particles.age[settledIndex] =
    simulation.particles.lifetime[settledIndex] - 1 / 120;
  simulation.tick(null);
  assert.equal(simulation.particles.findIndexById(id), -1);
  assert.equal(simulation.particles.groundBounces, 1);
});

test("disabling Ground bounce still kills a particle on its first ground contact", () => {
  const simulation = new Simulation({
    particleBurstCount: 0,
    particleWallCollision: false,
  });
  simulation.particles.spawn({
    x: 2,
    y: 0.01,
    z: 2,
    vx: 1,
    vy: -2,
    vz: 0,
    lifetime: 1,
    size: 0.05,
  });
  simulation.tick({ type: "setDebugFlag", name: "particleBounce", value: false });
  assert.equal(simulation.particles.activeCount, 0);
  assert.equal(simulation.particles.groundBounces, 0);
});

test("legacy M0.2 profile reproduces its fixed-seed particle fixture exactly", () => {
  const simulation = impactBurst(4, PARTICLE_PROFILE_M02);
  const actual = simulation.snapshot().particles.map((particle) => ({
    x: particle.x,
    y: particle.y,
    z: particle.z,
    vx: particle.vx,
    vy: particle.vy,
    vz: particle.vz,
    size: particle.size,
    currentSize: particle.currentSize,
    age: particle.age,
    lifetime: particle.lifetime,
  }));
  assert.equal(simulation.rng.state, 3_962_604_150);
  assert.deepEqual(actual, [
    {
      x: 2.9417531490325928,
      y: 0.21324731409549713,
      z: 2.5415754318237305,
      vx: -3.488819122314453,
      vy: 6.7948384284973145,
      vz: 2.4945309162139893,
      size: 0.030715517699718475,
      currentSize: 0.030715517699718475,
      age: 0.01666666753590107,
      lifetime: 0.43087324500083923,
    },
    {
      x: 2.987039089202881,
      y: 0.21612831950187683,
      z: 2.587405204772949,
      vx: -0.7716677188873291,
      vy: 6.9676995277404785,
      vz: 5.244314670562744,
      size: 0.06780045479536057,
      currentSize: 0.06780045479536057,
      age: 0.01666666753590107,
      lifetime: 0.47880518436431885,
    },
    {
      x: 2.9930102825164795,
      y: 0.18891644477844238,
      z: 2.4746108055114746,
      vx: -0.41339200735092163,
      vy: 5.334986209869385,
      vz: -1.5233464241027832,
      size: 0.028052054345607758,
      currentSize: 0.028052054345607758,
      age: 0.01666666753590107,
      lifetime: 0.790307343006134,
    },
    {
      x: 2.9730706214904785,
      y: 0.1946500986814499,
      z: 2.406928300857544,
      vx: -1.6097749471664429,
      vy: 5.679006099700928,
      vz: -5.584299564361572,
      size: 0.08035694062709808,
      currentSize: 0.08035694062709808,
      age: 0.01666666753590107,
      lifetime: 0.3781084418296814,
    },
  ]);
});

test("legacy M0.2 profile preserves constant radius and exact ground response", () => {
  const simulation = new Simulation({
    particleBurstCount: 0,
    particleProfile: PARTICLE_PROFILE_M02,
    particleBounce: true,
    particleWallCollision: false,
  });
  const id = simulation.particles.spawn({
    x: 2,
    y: 0.01,
    z: 1.5,
    vx: 6,
    vy: -2,
    vz: 3,
    lifetime: 1,
    size: 0.05,
  });
  simulation.tick(null);
  const index = simulation.particles.findIndexById(id);
  assert.deepEqual(
    {
      x: simulation.particles.x[index],
      y: simulation.particles.y[index],
      z: simulation.particles.z[index],
      vx: simulation.particles.vx[index],
      vy: simulation.particles.vy[index],
      vz: simulation.particles.vz[index],
      bounced: simulation.particles.bounced[index],
    },
    {
      x: 2.0999999046325684,
      y: 0,
      z: 1.5499999523162842,
      vx: 4.5,
      vy: 0.7572250366210938,
      vz: 2.25,
      bounced: 1,
    },
  );
  simulation.particles.age[index] = 0.5;
  const [particle] = simulation.snapshot().particles;
  assert.equal(particle.currentSize, particle.size);
  simulation.particles.y[index] = -0.01;
  simulation.particles.vy[index] = -1;
  simulation.tick(null);
  assert.equal(simulation.particles.findIndexById(id), -1);
});

test("unsupported particle profiles fail instead of silently changing replay behavior", () => {
  assert.throws(
    () => new Simulation({ particleProfile: "future-profile" }),
    /Unsupported particle profile/,
  );
});
