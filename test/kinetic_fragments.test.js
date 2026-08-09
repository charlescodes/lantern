import test from "node:test";
import assert from "node:assert/strict";

import {
  KINETIC_FRAGMENT_CAPACITY,
  KINETIC_FRAGMENT_COMPONENT_NAMES,
  KINETIC_FRAGMENT_MAXIMUM_BOUNCES,
  KINETIC_FRAGMENT_MAXIMUM_COUNT,
  KINETIC_FRAGMENT_MAXIMUM_SIZE_METERS,
  KINETIC_FRAGMENT_MAXIMUM_VISUAL_SCALE,
  KINETIC_FRAGMENT_MINIMUM_COUNT,
  KINETIC_FRAGMENT_MINIMUM_SIZE_METERS,
  KINETIC_FRAGMENT_MINIMUM_VISIBLE_EDGE_PIXELS,
  KINETIC_FRAGMENT_MOTION,
  KINETIC_FRAGMENT_STEP_SECONDS,
  KINETIC_FRAGMENT_SURFACE_OFFSET_METERS,
  KineticFragmentPool,
  createKineticFragmentBurst,
  kineticFragmentCount,
  kineticFragmentPresentationSize,
  kineticFragmentStrength,
  sampleKineticFragment,
  writeKineticFragmentTriangle,
} from "../src/presentation/kinetic_fragments.js";
import { GridMap } from "../src/sim/grid_map.js";
import { Simulation } from "../src/sim/simulation.js";

function openMap(width = 12, height = 12) {
  return {
    width,
    height,
    cells: Array(width * height).fill(0),
    playerSpawn: { x: 1.5, z: 1.5 },
  };
}

function explosion(id, overrides = {}) {
  return {
    type: "explosion",
    id,
    tick: id,
    effectSeed: 0x1234_abcd,
    spellId: "future-generic-blast",
    hit: { kind: "rock", id: 7 },
    originX: 5.5,
    y: 0.1,
    originZ: 5.5,
    nx: 1,
    nz: 0,
    radius: 2.5,
    pressureImpulse: 800,
    ...overrides,
  };
}

function snapshot(map, tick = 0, recentEvents = [], overrides = {}) {
  return {
    seed: 0x5eed_1234,
    tick,
    map,
    obelisks: [],
    recentEvents,
    ...overrides,
  };
}

function closeTo(actual, expected, epsilon = 1e-5) {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `expected ${actual} to be within ${epsilon} of ${expected}`,
  );
}

function sampleBurst(burst) {
  return Array.from(
    { length: burst.count },
    (_, ordinal) => sampleKineticFragment(burst, ordinal, {}),
  );
}

test("default generic explosions produce sixteen deterministic centimeter fragments", () => {
  const event = explosion(7);
  const first = createKineticFragmentBurst(event);
  const repeated = createKineticFragmentBurst({ ...event });
  assert.ok(first);
  assert.ok(repeated);
  assert.equal(first.strength, 1);
  assert.equal(first.count, 16);
  assert.deepEqual(sampleBurst(repeated), sampleBurst(first));

  const samples = sampleBurst(first);
  for (const sample of samples) {
    assert.ok(sample.size >= KINETIC_FRAGMENT_MINIMUM_SIZE_METERS);
    assert.ok(sample.size <= KINETIC_FRAGMENT_MAXIMUM_SIZE_METERS);
    assert.ok(sample.vy > 0);
    assert.ok(sample.maximumBounces >= 1);
    assert.ok(sample.maximumBounces <= KINETIC_FRAGMENT_MAXIMUM_BOUNCES);
  }
  const changedSeed = createKineticFragmentBurst(explosion(7, { effectSeed: 99 }));
  const changedId = createKineticFragmentBurst(explosion(8));
  assert.ok(changedSeed);
  assert.ok(changedId);
  assert.notDeepEqual(sampleBurst(changedSeed), samples);
  assert.notDeepEqual(sampleBurst(changedId), samples);
});

test("strength scaling is bounded, diminishing, and motion-led", () => {
  assert.equal(kineticFragmentStrength(0, 0), 0);
  assert.equal(kineticFragmentCount(0), KINETIC_FRAGMENT_MINIMUM_COUNT);
  assert.equal(kineticFragmentStrength(2.5, 800), 1);
  assert.equal(kineticFragmentCount(1), 16);
  assert.equal(kineticFragmentStrength(1e30, 1e30), 2);
  assert.equal(kineticFragmentCount(2), KINETIC_FRAGMENT_MAXIMUM_COUNT);

  const baseline = createKineticFragmentBurst(explosion(1));
  const strong = createKineticFragmentBurst(explosion(1, {
    radius: 12,
    pressureImpulse: 5_000,
  }));
  assert.ok(baseline);
  assert.ok(strong);
  assert.equal(strong.count, KINETIC_FRAGMENT_MAXIMUM_COUNT);
  const baselineSample = sampleKineticFragment(baseline, 0);
  const strongSample = sampleKineticFragment(strong, 0);
  assert.ok(
    Math.hypot(strongSample.vx, strongSample.vz)
      > Math.hypot(baselineSample.vx, baselineSample.vz),
  );
  assert.ok(strongSample.vy > baselineSample.vy);
  assert.ok(
    Math.hypot(strongSample.angularX, strongSample.angularY, strongSample.angularZ)
      > Math.hypot(
        baselineSample.angularX,
        baselineSample.angularY,
        baselineSample.angularZ,
      ),
  );
  assert.ok(strongSample.size <= KINETIC_FRAGMENT_MAXIMUM_SIZE_METERS);
  assert.ok(
    strongSample.lifetime <= KINETIC_FRAGMENT_MOTION.maximumLifetimeSeconds,
  );
});

test("bounded camera readability makes the default burst rasterizable while preserving shrink", () => {
  const burst = createKineticFragmentBurst(explosion(1));
  assert.ok(burst);
  const pool = new KineticFragmentPool();
  for (let ordinal = 0; ordinal < burst.count; ordinal += 1) {
    pool.spawn(sampleKineticFragment(burst, ordinal, {}));
  }
  const defaultViewportScale = 640 / 24;
  const presentationEdges = [];
  for (let index = 0; index < pool.activeCount; index += 1) {
    const physicalSize = pool.currentSize(index, 1);
    const presentationSize = kineticFragmentPresentationSize(
      pool,
      index,
      1,
      defaultViewportScale,
    );
    presentationEdges.push(presentationSize * defaultViewportScale);
    assert.ok(presentationSize >= physicalSize);
    assert.ok(
      presentationSize
        <= physicalSize * KINETIC_FRAGMENT_MAXIMUM_VISUAL_SCALE + 1e-7,
    );
  }
  presentationEdges.sort((left, right) => left - right);
  assert.ok(
    presentationEdges[Math.floor(presentationEdges.length / 2)]
      >= KINETIC_FRAGMENT_MINIMUM_VISIBLE_EDGE_PIXELS - 1e-5,
  );

  const physicalBefore = pool.currentSize(0, 1);
  const presentationBefore = kineticFragmentPresentationSize(
    pool,
    0,
    1,
    defaultViewportScale,
  );
  pool.step();
  const physicalAfter = pool.currentSize(0, 1);
  const presentationAfter = kineticFragmentPresentationSize(
    pool,
    0,
    1,
    defaultViewportScale,
  );
  closeTo(
    presentationAfter / presentationBefore,
    physicalAfter / physicalBefore,
  );
});

test("wall bursts offset into free space and keep every horizontal direction in its hemisphere", () => {
  const event = explosion(1, {
    hit: { kind: "cell", cx: 5, cz: 5 },
    originX: 5,
    originZ: 5.5,
    y: 0.9,
    nx: -3,
    nz: 0,
  });
  const burst = createKineticFragmentBurst(event);
  assert.ok(burst);
  assert.equal(burst.wall, true);
  closeTo(burst.x, 5 - KINETIC_FRAGMENT_SURFACE_OFFSET_METERS, 1e-12);
  closeTo(burst.y, 0.9, 1e-12);
  closeTo(burst.z, 5.5, 1e-12);
  for (const sample of sampleBurst(burst)) {
    assert.ok(sample.vx * burst.nx + sample.vz * burst.nz > 0);
    assert.ok(sample.vy > 0);
  }
});

test("the live Fireball explosion event feeds the generic consumer unchanged", () => {
  const map = new GridMap(12, 7, undefined, { x: 1.5, z: 3.5 });
  map.set(4, 3, 1);
  const simulation = new Simulation({ map, particleBurstCount: 0 });
  const pool = new KineticFragmentPool();
  pool.prime(simulation.snapshot());
  let latest = simulation.snapshot();
  for (let tick = 0; tick < 120 && pool.ingestedExplosions === 0; tick += 1) {
    simulation.tick(tick === 0 ? { cast: { x: 8, z: 3.5 } } : null);
    latest = simulation.snapshot();
    const before = JSON.stringify(latest);
    pool.ingest(latest);
    assert.equal(JSON.stringify(latest), before);
  }
  const event = latest.recentEvents.at(-1);
  assert.equal(event?.type, "explosion");
  assert.equal(event?.hit.kind, "cell");
  assert.equal(pool.ingestedExplosions, 1);
  assert.equal(pool.activeCount, 16);
  assert.ok(
    Array.from(pool.explosionId.slice(0, pool.activeCount))
      .every((id) => id === event.id),
  );
  for (let index = 0; index < pool.activeCount; index += 1) {
    assert.ok(pool.vx[index] * event.nx + pool.vz[index] * event.nz > 0);
  }
  const replayed = Simulation.replay(simulation.exportCommandLog()).snapshot();
  const replayedEvent = replayed.recentEvents.at(-1);
  assert.deepEqual(
    createKineticFragmentBurst(replayedEvent),
    createKineticFragmentBurst(event),
  );
  const lateRendererPool = new KineticFragmentPool();
  lateRendererPool.prime(replayed);
  assert.equal(lateRendererPool.activeCount, 0);
});

test("pool saturation rejects new samples without replacing resident fragments", () => {
  const map = openMap();
  const first = new KineticFragmentPool({ capacity: 20 });
  const second = new KineticFragmentPool({ capacity: 20 });
  for (const pool of [first, second]) {
    pool.prime(snapshot(map));
    const event1 = explosion(1);
    pool.ingest(snapshot(map, 1, [event1]));
    assert.equal(pool.activeCount, 16);
    assert.equal(pool.dropped, 0);
    const firstIds = Array.from(pool.id.slice(0, pool.activeCount));
    const event2 = explosion(2);
    pool.ingest(snapshot(map, 2, [event1, event2]));
    assert.equal(pool.activeCount, 20);
    assert.equal(pool.dropped, 12);
    assert.equal(pool.ingestedExplosions, 2);
    assert.deepEqual(Array.from(pool.id.slice(0, 16)), firstIds);
  }
  assert.deepEqual(first.diagnostics(), second.diagnostics());
  for (const name of KINETIC_FRAGMENT_COMPONENT_NAMES) {
    assert.deepEqual(
      Array.from(first[name].slice(0, first.activeCount)),
      Array.from(second[name].slice(0, second.activeCount)),
    );
  }
});

test("swap-and-pop copies every kinetic fragment component", () => {
  const pool = new KineticFragmentPool({ capacity: 3 });
  pool.spawn({
    explosionId: 1,
    effectSeed: 2,
    sampleOrdinal: 3,
    sampleSeed: 4,
    x: 5,
    y: 6,
    z: 7,
    vx: 8,
    vy: 9,
    vz: 10,
    rotationX: 11,
    rotationY: 12,
    rotationZ: 13,
    angularX: 14,
    angularY: 15,
    angularZ: 16,
    lifetime: 17,
    size: 0.02,
    maximumBounces: 1,
  });
  pool.spawn({
    explosionId: 101,
    effectSeed: 102,
    sampleOrdinal: 103,
    sampleSeed: 104,
    x: 105,
    y: 106,
    z: 107,
    vx: 108,
    vy: 109,
    vz: 110,
    rotationX: 111,
    rotationY: 112,
    rotationZ: 113,
    angularX: 114,
    angularY: 115,
    angularZ: 116,
    lifetime: 117,
    size: 0.07,
    maximumBounces: 2,
  });
  pool.previousX[1] = 201;
  pool.previousY[1] = 202;
  pool.previousZ[1] = 203;
  pool.previousRotationX[1] = 204;
  pool.previousRotationY[1] = 205;
  pool.previousRotationZ[1] = 206;
  pool.age[1] = 0.5;
  pool.bounceCount[1] = 2;
  const expected = Object.fromEntries(
    KINETIC_FRAGMENT_COMPONENT_NAMES.map((name) => [name, pool[name][1]]),
  );
  assert.equal(pool.removeSwap(0), true);
  assert.equal(pool.activeCount, 1);
  for (const name of KINETIC_FRAGMENT_COMPONENT_NAMES) {
    assert.equal(pool[name][0], expected[name], `${name} was not copied`);
  }
});

test("fixed-step integration applies drag, gravity, tumble, and interpolation once per tick", () => {
  const pool = new KineticFragmentPool({ capacity: 2 });
  pool.spawn({
    x: 1,
    y: 10,
    z: 3,
    vx: 6,
    vy: 3,
    vz: -2,
    rotationX: 0.1,
    rotationY: 0.2,
    rotationZ: 0.3,
    angularX: 4,
    angularY: -5,
    angularZ: 6,
    lifetime: 2,
    size: 0.05,
    maximumBounces: 2,
  });
  pool.step();
  const dt = KINETIC_FRAGMENT_STEP_SECONDS;
  const linearRetention = 1 - KINETIC_FRAGMENT_MOTION.linearDragPerSecond * dt;
  const angularRetention = 1 - KINETIC_FRAGMENT_MOTION.angularDragPerSecond * dt;
  const expectedVx = 6 * linearRetention;
  const expectedVy = (
    3 + KINETIC_FRAGMENT_MOTION.gravityMetersPerSecondSquared * dt
  ) * linearRetention;
  const expectedVz = -2 * linearRetention;
  closeTo(pool.age[0], dt);
  closeTo(pool.previousX[0], 1);
  closeTo(pool.previousY[0], 10);
  closeTo(pool.previousZ[0], 3);
  closeTo(pool.vx[0], expectedVx);
  closeTo(pool.vy[0], expectedVy);
  closeTo(pool.vz[0], expectedVz);
  closeTo(pool.x[0], 1 + expectedVx * dt);
  closeTo(pool.y[0], 10 + expectedVy * dt);
  closeTo(pool.z[0], 3 + expectedVz * dt);
  closeTo(pool.rotationX[0], 0.1 + 4 * angularRetention * dt);
  closeTo(pool.rotationY[0], 0.2 - 5 * angularRetention * dt);
  closeTo(pool.rotationZ[0], 0.3 + 6 * angularRetention * dt);
  closeTo(pool.currentSize(0, 0), 0.05);
  assert.ok(pool.currentSize(0, 1) < 0.05);

  const triangleAtPrevious = new Float32Array(9);
  const triangleAtCurrent = new Float32Array(9);
  writeKineticFragmentTriangle(pool, 0, 0, triangleAtPrevious);
  writeKineticFragmentTriangle(pool, 0, 1, triangleAtCurrent);
  assert.notDeepEqual(Array.from(triangleAtCurrent), Array.from(triangleAtPrevious));
});

test("ground contact honors the sampled bounce limit and low energy expires", () => {
  const pool = new KineticFragmentPool({ capacity: 2 });
  pool.spawn({
    x: 1,
    y: 0.001,
    z: 1,
    vx: 2,
    vy: -2,
    vz: 1,
    angularX: 3,
    angularY: 4,
    angularZ: 5,
    lifetime: 10,
    size: 0.05,
    maximumBounces: 2,
  });
  pool.step();
  assert.equal(pool.activeCount, 1);
  assert.equal(pool.bounceCount[0], 1);
  assert.equal(pool.groundBounces, 1);
  assert.ok(pool.vy[0] > 0);

  pool.y[0] = 0.001;
  pool.vy[0] = -2;
  pool.step();
  assert.equal(pool.activeCount, 1);
  assert.equal(pool.bounceCount[0], 2);
  assert.equal(pool.groundBounces, 2);

  pool.y[0] = 0.001;
  pool.vy[0] = -2;
  pool.step();
  assert.equal(pool.activeCount, 0);
  assert.equal(pool.groundBounces, KINETIC_FRAGMENT_MAXIMUM_BOUNCES);
  assert.equal(pool.expired, 1);

  pool.spawn({
    x: 1,
    y: 1,
    z: 1,
    vx: 0,
    vy: 0,
    vz: 0,
    lifetime: KINETIC_FRAGMENT_STEP_SECONDS / 2,
    size: 0.05,
  });
  pool.step();
  assert.equal(pool.activeCount, 0);
  assert.equal(pool.expired, 2);
});

test("event cursor resets safely and never mutates snapshots or reconstructs old bursts", () => {
  const map = openMap();
  const oldEvent = explosion(1);
  const pool = new KineticFragmentPool();
  pool.prime(snapshot(map, 10, [oldEvent]));
  assert.equal(pool.activeCount, 0);

  const newEvent = explosion(2, { tick: 11 });
  const next = snapshot(map, 11, [oldEvent, newEvent]);
  const before = JSON.stringify(next);
  pool.ingest(next);
  assert.equal(JSON.stringify(next), before);
  assert.equal(pool.activeCount, 16);
  assert.equal(pool.ingestedExplosions, 1);
  const age = pool.age[0];
  pool.ingest(next);
  assert.equal(pool.activeCount, 16);
  assert.equal(pool.age[0], age);

  pool.ingest(snapshot(map, 5, [oldEvent]));
  assert.equal(pool.activeCount, 0);
  assert.equal(pool.resets, 1);
  pool.ingest(snapshot(map, 6, [oldEvent, explosion(2, { tick: 6 })]));
  assert.equal(pool.activeCount, 16);
  assert.equal(pool.id[0], 1);
  pool.ingest(snapshot(map, 7, [oldEvent, newEvent], { seed: 99 }));
  assert.equal(pool.activeCount, 0);
  assert.equal(pool.resets, 2);

  const changedMap = openMap();
  changedMap.cells[0] = 1;
  pool.ingest(snapshot(changedMap, 8, [oldEvent, newEvent], { seed: 99 }));
  assert.equal(pool.resets, 3);
  pool.ingest(snapshot(changedMap, 9, [], { seed: 99 }));
  assert.equal(pool.resets, 4);

  const reconstructed = new KineticFragmentPool();
  reconstructed.prime(next);
  assert.equal(reconstructed.activeCount, 0);
  assert.equal(reconstructed.ingestedExplosions, 0);
});

test("one thousand repeated explosions stay bounded and expire from resident storage", () => {
  const map = openMap();
  const pool = new KineticFragmentPool();
  const identities = Object.fromEntries(
    KINETIC_FRAGMENT_COMPONENT_NAMES.map((name) => [name, pool[name]]),
  );
  pool.prime(snapshot(map));
  const retained = [];
  for (let id = 1; id <= 1_000; id += 1) {
    retained.push(explosion(id));
    if (retained.length > 32) retained.shift();
    pool.ingest(snapshot(map, id, retained));
    assert.ok(pool.activeCount >= 0);
    assert.ok(pool.activeCount <= KINETIC_FRAGMENT_CAPACITY);
  }
  assert.equal(pool.ingestedExplosions, 1_000);
  assert.ok(pool.dropped > 0);
  for (const name of KINETIC_FRAGMENT_COMPONENT_NAMES) {
    assert.equal(pool[name], identities[name]);
  }

  for (let tick = 1_001; tick <= 1_100; tick += 1) {
    pool.ingest(snapshot(map, tick, retained));
  }
  assert.equal(pool.activeCount, 0);
});
