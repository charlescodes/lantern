import test from "node:test";
import assert from "node:assert/strict";

import { GridMap } from "../src/sim/grid_map.js";
import { ArenaScenario } from "../src/sim/scenario.js";
import { Simulation } from "../src/sim/simulation.js";

/** @param {number} actual @param {number} expected @param {number} [epsilon] */
function closeTo(actual, expected, epsilon = 1e-5) {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `expected ${actual} to be within ${epsilon} of ${expected}`,
  );
}

test("impact emission preserves speed while pointing into the outward half-plane", () => {
  const map = new GridMap(8, 6, undefined, { x: 1.5, z: 2.5 });
  map.set(3, 2, 1);
  const simulation = new Simulation({
    map,
    seed: 0x5a17,
    particleBurstCount: 64,
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

  const [event] = simulation.impactEvents.toArray();
  assert.equal(event.hit.kind, "cell");
  assert.equal(event.nx, -1);
  assert.equal(event.nz, 0);
  assert.equal(simulation.particles.activeCount, 64);
  for (let index = 0; index < simulation.particles.activeCount; index += 1) {
    const vx = simulation.particles.vx[index];
    const vz = simulation.particles.vz[index];
    assert.ok(vx * event.nx + vz * event.nz >= -1e-6);
    assert.ok(Math.hypot(vx, vz) <= 7 + 1e-6);
    assert.equal(map.get(
      Math.floor(simulation.particles.x[index]),
      Math.floor(simulation.particles.z[index]),
    ), 0);
  }
});

test("wall reflection retains exactly 80 percent normal and 95 percent tangent speed", () => {
  const map = new GridMap(8, 6, undefined, { x: 1.5, z: 1.5 });
  map.set(3, 2, 1);
  const simulation = new Simulation({ map, particleBurstCount: 0 });
  const id = simulation.particles.spawn({
    x: 2.95,
    y: 10,
    z: 2.25,
    vx: 6,
    vy: 4,
    vz: 3,
    lifetime: 1,
    size: 0.05,
  });

  simulation.tick(null);

  const index = simulation.particles.findIndexById(id);
  assert.ok(index >= 0);
  closeTo(simulation.particles.vx[index], -4.8);
  closeTo(simulation.particles.vz[index], 2.85);
  closeTo(simulation.particles.vy[index], 4 - 9.81 / 60);
  assert.equal(simulation.particles.wallBounceCount[index], 1);
  assert.equal(simulation.particles.wallBounces, 1);
  assert.equal(simulation.snapshot().contacts.length, 0);
});

test("a high, maximum-travel spark cannot tunnel through a one-cell wall", () => {
  const map = new GridMap(12, 6, undefined, { x: 1.5, z: 2.5 });
  map.set(4, 2, 1);
  const simulation = new Simulation({ map, particleBurstCount: 0 });
  const id = simulation.particles.spawn({
    x: 1.5,
    y: 100,
    z: 2.5,
    vx: 240,
    vy: 0,
    vz: 0,
    lifetime: 1,
    size: 0.05,
  });

  simulation.tick(null);

  const index = simulation.particles.findIndexById(id);
  assert.ok(index >= 0);
  assert.ok(simulation.particles.vx[index] < 0);
  assert.equal(simulation.particles.wallBounceCount[index], 1);
  assert.equal(map.get(
    Math.floor(simulation.particles.x[index]),
    Math.floor(simulation.particles.z[index]),
  ), 0);
});

test("a spark can ricochet repeatedly in a corridor and still expires by lifetime", () => {
  const map = new GridMap(5, 5, undefined, { x: 2.5, z: 1.5 });
  for (let z = 1; z <= 3; z += 1) {
    map.set(1, z, 1);
    map.set(3, z, 1);
  }
  const simulation = new Simulation({ map, particleBurstCount: 0 });
  const id = simulation.particles.spawn({
    x: 2.5,
    y: 10,
    z: 2.5,
    vx: 180,
    vy: 0,
    vz: 0,
    lifetime: 0.3,
    size: 0.05,
  });
  let observedBounces = 0;

  for (let tick = 0; tick < 30; tick += 1) {
    simulation.tick(null);
    const index = simulation.particles.findIndexById(id);
    if (index < 0) break;
    observedBounces = Math.max(observedBounces, simulation.particles.wallBounceCount[index]);
    assert.equal(map.get(
      Math.floor(simulation.particles.x[index]),
      Math.floor(simulation.particles.z[index]),
    ), 0);
  }

  assert.ok(observedBounces >= 2);
  assert.equal(simulation.particles.findIndexById(id), -1);
  assert.ok(simulation.particles.wallBounces >= observedBounces);
});

test("particle wall sweeps ignore the player and solid rocks", () => {
  const map = new GridMap(10, 6, undefined, { x: 2, z: 2.5 });
  const scenario = new ArenaScenario(map, [
    { kind: "rock", archetype: "medium", x: 4, z: 2.5 },
  ]);
  const simulation = new Simulation({ scenario, particleBurstCount: 0 });
  const playerCrossing = simulation.particles.spawn({
    x: 1.5, y: 10, z: 2.5, vx: 60, vy: 0, vz: 0, lifetime: 1, size: 0.05,
  });
  const rockCrossing = simulation.particles.spawn({
    x: 3.5, y: 10, z: 2.5, vx: 60, vy: 0, vz: 0, lifetime: 1, size: 0.05,
  });

  simulation.tick(null);

  const playerIndex = simulation.particles.findIndexById(playerCrossing);
  const rockIndex = simulation.particles.findIndexById(rockCrossing);
  closeTo(simulation.particles.x[playerIndex], 2.5);
  closeTo(simulation.particles.x[rockIndex], 4.5);
  assert.equal(simulation.particles.wallBounces, 0);
  assert.equal(simulation.player.externalVx, 0);
  assert.equal(simulation.rocks.vx[0], 0);
});

test("wall collision and ground bounce toggles remain independent", () => {
  const map = new GridMap(8, 6, undefined, { x: 1.5, z: 1.5 });
  map.set(3, 2, 1);
  const simulation = new Simulation({ map, particleBurstCount: 0 });
  const id = simulation.particles.spawn({
    x: 2.95, y: 10, z: 2.5, vx: 6, vy: 0, vz: 0, lifetime: 1, size: 0.05,
  });
  simulation.tick({ type: "setDebugFlag", name: "particleWallCollision", value: false });
  const index = simulation.particles.findIndexById(id);
  assert.ok(simulation.particles.x[index] > 3);
  assert.equal(simulation.particles.wallBounceCount[index], 0);

  const groundSimulation = new Simulation({
    map,
    particleBurstCount: 0,
    particleWallCollision: false,
  });
  const groundId = groundSimulation.particles.spawn({
    x: 2.95, y: 0.01, z: 2.5, vx: 6, vy: -2, vz: 0, lifetime: 1, size: 0.05,
  });
  groundSimulation.tick({ type: "setDebugFlag", name: "particleBounce", value: true });
  const groundIndex = groundSimulation.particles.findIndexById(groundId);
  assert.ok(groundIndex >= 0);
  assert.equal(groundSimulation.particles.bounced[groundIndex], 1);
  assert.equal(groundSimulation.particles.wallBounceCount[groundIndex], 0);
  assert.ok(groundSimulation.particles.x[groundIndex] > 3);
});

test("invalid embedded particles are corrected or discarded with visible counters", () => {
  const correctedMap = new GridMap(6, 4, undefined, { x: 1.5, z: 1.5 });
  correctedMap.set(2, 1, 1);
  const correctedSimulation = new Simulation({ map: correctedMap, particleBurstCount: 0 });
  const correctedId = correctedSimulation.particles.spawn({
    x: 2.5, y: 10, z: 1.5, vx: 1, vy: 0, vz: 0, lifetime: 1, size: 0.05,
  });
  correctedSimulation.tick(null);
  const correctedIndex = correctedSimulation.particles.findIndexById(correctedId);
  assert.ok(correctedIndex >= 0);
  assert.equal(correctedMap.get(
    Math.floor(correctedSimulation.particles.x[correctedIndex]),
    Math.floor(correctedSimulation.particles.z[correctedIndex]),
  ), 0);

  const blockedMap = new GridMap(12, 3, undefined, { x: 0.5, z: 1.5 });
  for (let cx = 1; cx <= 9; cx += 1) blockedMap.set(cx, 1, 1);
  const blockedSimulation = new Simulation({ map: blockedMap, particleBurstCount: 0 });
  blockedSimulation.particles.spawn({
    x: 9.5, y: 10, z: 1.5, vx: 1, vy: 0, vz: 0, lifetime: 1, size: 0.05,
  });
  blockedSimulation.tick(null);
  const snapshot = blockedSimulation.snapshot();
  assert.equal(blockedSimulation.particles.activeCount, 0);
  assert.equal(blockedSimulation.particles.collisionDiscards, 1);
  assert.equal(snapshot.pools.particles.collisionDiscards, 1);
});

test("failed impact spawn correction is counted even when wall sweeps are disabled", () => {
  const map = new GridMap(12, 4, undefined, { x: 10.5, z: 2.5 });
  for (let cx = 0; cx <= 9; cx += 1) map.set(cx, 1, 1);
  const simulation = new Simulation({
    map,
    seed: 0xbad5_afe,
    particleBurstCount: 4,
    particleWallCollision: false,
  });
  simulation.projectiles.spawn({
    x: 9.5,
    z: 1.5,
    vx: 1,
    vz: 0,
    lifetime: 1,
    radius: 0.12,
  });

  simulation.tick(null);

  assert.equal(simulation.impactEvents.length, 1);
  assert.equal(simulation.particles.activeCount, 0);
  assert.equal(simulation.particles.collisionDiscards, 4);
  assert.equal(simulation.snapshot().pools.particles.collisionDiscards, 4);
});

test("snapshot and inspector preserve per-particle wall bounce identity after compaction", () => {
  const simulation = new Simulation({ particleBurstCount: 0 });
  simulation.particles.spawn({
    x: 2, y: 2, z: 2, vx: 0, vy: 0, vz: 0, lifetime: 1, size: 0.05,
  });
  const pinnedId = simulation.particles.spawn({
    x: 3, y: 3, z: 3, vx: 0, vy: 0, vz: 0, lifetime: 1, size: 0.05,
  });
  simulation.particles.wallBounceCount[1] = 7;
  simulation.particles.removeSwap(0);

  const inspected = simulation.resolveSelection({ kind: "particle", id: pinnedId });
  const [particle] = simulation.snapshot().particles;
  assert.equal(inspected.id, pinnedId);
  assert.equal(inspected.index, 0);
  assert.equal(inspected.wallBounceCount, 7);
  assert.equal(inspected.flags.wallBounces, 7);
  assert.equal(particle.id, pinnedId);
  assert.equal(particle.wallBounceCount, 7);
});
