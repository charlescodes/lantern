import test from "node:test";
import assert from "node:assert/strict";

import { PresentationFlags } from "../src/presentation/options.js";
import {
  TRUE_SIGHT_MAX_RAYS,
  TrueSightSystem,
} from "../src/visibility/true_sight.js";

function map(width, height, walls = []) {
  const cells = new Array(width * height).fill(0);
  for (const [cx, cz] of walls) cells[cz * width + cx] = 1;
  return { width, height, cells, playerSpawn: { x: 0.5, z: 0.5 } };
}

function snapshot(value, x, z, options = {}) {
  return {
    tick: options.tick ?? 1,
    seed: options.seed ?? 1,
    map: value,
    player: {
      x,
      z,
      previousX: options.previousX ?? x,
      previousZ: options.previousZ ?? z,
    },
  };
}

function hardMask(frame) {
  return Buffer.from(frame.logicalMask).toString("base64");
}

test("empty maps reveal the complete map with deterministic finite boundaries", () => {
  const value = snapshot(map(24, 24), 12.5, 12.5);
  const before = JSON.stringify(value);
  const first = new TrueSightSystem().update(value, 0, { deltaMs: 0 });
  const second = new TrueSightSystem().update(value, 0, { deltaMs: 0 });

  assert.equal(first.maskWidth, 192);
  assert.equal(first.maskHeight, 192);
  assert.ok(first.logicalMask.every((entry) => entry === 255));
  assert.ok(first.polygon.length >= 4);
  assert.ok(first.polygon.every((point) => (
    Number.isFinite(point.x)
    && Number.isFinite(point.z)
    && point.x >= 0
    && point.z >= 0
    && point.x <= 24
    && point.z <= 24
  )));
  assert.deepEqual(first.polygon, second.polygon);
  assert.equal(hardMask(first), hardMask(second));
  assert.equal(JSON.stringify(value), before);
});

test("a nearby wall casts a wider angular wedge than the same wall farther away", () => {
  const value = map(12, 12, [[6, 5]]);
  const near = new TrueSightSystem().update(
    snapshot(value, 5, 5.5),
    0,
    { deltaMs: 0 },
  );
  const far = new TrueSightSystem().update(
    snapshot(value, 2, 5.5),
    0,
    { deltaMs: 0 },
  );
  let nearHidden = 0;
  let farHidden = 0;
  for (let z = 0.25; z < 12; z += 0.25) {
    if (!near.isPointVisible(10, z)) nearHidden += 1;
    if (!far.isPointVisible(10, z)) farHidden += 1;
  }
  assert.ok(nearHidden > farHidden);
});

test("the occluding wall remains visible while floor and walls behind it stay hidden", () => {
  const value = map(12, 12, [[6, 5], [8, 5]]);
  const frame = new TrueSightSystem().update(
    snapshot(value, 5, 5.5),
    0,
    { deltaMs: 0 },
  );
  assert.equal(frame.isPointVisible(6.5, 5.5), true);
  assert.equal(frame.isPointVisible(7.5, 5.5), false);
  assert.equal(frame.isPointVisible(8.5, 5.5), false);
  assert.deepEqual(
    frame.visibleWallCells.map((cell) => [cell.cx, cell.cz]),
    [[6, 5]],
  );
});

test("doorways, corridors, concave corners, boundaries, and grid-line origins stay finite", () => {
  const walls = [];
  for (let z = 1; z < 11; z += 1) {
    if (z !== 6) walls.push([4, z]);
  }
  for (let x = 4; x < 11; x += 1) walls.push([x, 9]);
  walls.splice(walls.findIndex(([x, z]) => x === 7 && z === 9), 1);
  const value = map(12, 12, walls);
  for (const [x, z] of [[2, 6], [2.000000001, 6], [3.999999999, 6]]) {
    const frame = new TrueSightSystem().update(
      snapshot(value, x, z),
      0,
      { deltaMs: 0 },
    );
    assert.ok(frame.polygon.length >= 3);
    assert.ok(frame.polygon.every((point) => (
      Number.isFinite(point.x) && Number.isFinite(point.z)
    )));
    assert.ok(frame.rays.every((ray) => (
      ray.crossings <= value.width + value.height + 4
    )));
  }
});

test("exact diagonal corner ties prefer the lowest solid-cell index", () => {
  const value = map(6, 6, [[3, 2], [2, 3]]);
  const frame = new TrueSightSystem().update(
    snapshot(value, 2.5, 2.5),
    0,
    { deltaMs: 0 },
  );
  const tiedRay = frame.rays.find(
    (ray) => Math.abs(ray.angle - Math.PI / 4) < 1e-12,
  );
  assert.ok(tiedRay);
  assert.deepEqual(tiedRay.hitCell, {
    cx: 3,
    cz: 2,
    index: 15,
  });
  const duplicate = new TrueSightSystem().update(
    snapshot(value, 2.5, 2.5),
    0,
    { deltaMs: 0 },
  );
  assert.deepEqual(frame.polygon, duplicate.polygon);
  assert.equal(hardMask(frame), hardMask(duplicate));
});

test("map topology hashes invalidate exactly once per actual edit", () => {
  const value = map(8, 8);
  const system = new TrueSightSystem();
  let frame = system.update(snapshot(value, 2.5, 2.5), 0, { deltaMs: 0 });
  assert.equal(frame.topologyBuildCount, 1);
  frame = system.update(
    snapshot(value, 2.5, 2.5, { tick: 2 }),
    0,
    { deltaMs: 16 },
  );
  assert.equal(frame.topologyBuildCount, 1);
  value.cells[3 * value.width + 4] = 1;
  frame = system.update(
    snapshot(value, 2.5, 2.5, { tick: 3 }),
    0,
    { deltaMs: 16 },
  );
  assert.equal(frame.topologyBuildCount, 2);
  frame = system.update(
    snapshot(value, 2.5, 2.5, { tick: 4 }),
    0,
    { deltaMs: 16 },
  );
  assert.equal(frame.topologyBuildCount, 2);
});

test("dense corner topology uses the deterministic bounded 2048-ray fallback", () => {
  const value = map(50, 50);
  for (let z = 1; z < value.height; z += 3) {
    for (let x = 1; x < value.width; x += 3) {
      value.cells[z * value.width + x] = 1;
    }
  }
  const input = snapshot(value, 0.5, 0.5);
  const first = new TrueSightSystem().update(input, 0, { deltaMs: 0 });
  const second = new TrueSightSystem().update(input, 0, { deltaMs: 0 });
  assert.equal(first.fallbackUsed, true);
  assert.equal(first.rayCount, TRUE_SIGHT_MAX_RAYS);
  assert.ok(first.rays.every((ray) => (
    ray.crossings <= value.width + value.height + 4
  )));
  assert.deepEqual(first.polygon, second.polygon);
  assert.equal(hardMask(first), hardMask(second));
});

test("mask resolution keeps eight texels per meter and uniformly caps at 256", () => {
  const arena = new TrueSightSystem().update(
    snapshot(map(24, 24), 1.5, 1.5),
    0,
    { deltaMs: 0 },
  );
  assert.deepEqual([arena.maskWidth, arena.maskHeight], [192, 192]);
  const large = new TrueSightSystem().update(
    snapshot(map(256, 128), 1.5, 1.5),
    0,
    { deltaMs: 0 },
  );
  assert.deepEqual([large.maskWidth, large.maskHeight], [256, 128]);
  assert.equal(large.texelsPerMeter, 1);
});

test("fade timing, disabled fading, rollback, jumps, and edit transitions snap as specified", () => {
  const flags = new PresentationFlags();
  const system = new TrueSightSystem({ flags });
  const value = map(12, 12, [[6, 5]]);
  let tick = 1;
  const next = (overrides = {}) => snapshot(
    value,
    overrides.x ?? 5,
    overrides.z ?? 5.5,
    {
      tick: overrides.tick ?? tick++,
      seed: overrides.seed ?? 1,
      previousX: overrides.previousX,
      previousZ: overrides.previousZ,
    },
  );
  let frame = system.update(next(), 0, { deltaMs: 0, mode: "play" });
  assert.equal(frame.displayVisibilityAt(9, 5.5), 0);

  flags.set("trueSight", false);
  frame = system.update(next(), 0, { deltaMs: 50, mode: "play" });
  assert.ok(Math.abs(frame.displayVisibilityAt(9, 5.5) - 0.5) < 0.01);
  frame = system.update(next(), 0, { deltaMs: 50, mode: "play" });
  assert.equal(frame.displayVisibilityAt(9, 5.5), 1);

  flags.set("trueSight", true);
  frame = system.update(next(), 0, { deltaMs: 75, mode: "play" });
  assert.ok(Math.abs(frame.displayVisibilityAt(9, 5.5) - 0.5) < 0.01);
  frame = system.update(next(), 0, { deltaMs: 75, mode: "play" });
  assert.equal(frame.displayVisibilityAt(9, 5.5), 0);

  flags.set("trueSight", false);
  flags.set("sightFade", false);
  frame = system.update(next(), 0, { deltaMs: 1, mode: "play" });
  assert.equal(frame.displayVisibilityAt(9, 5.5), 1);
  assert.equal(frame.snapReason, "fade-disabled");

  flags.set("trueSight", true);
  flags.set("sightFade", true);
  frame = system.update(next({ tick: 1 }), 0, { deltaMs: 1, mode: "play" });
  assert.equal(frame.displayVisibilityAt(9, 5.5), 0);
  assert.equal(frame.snapReason, "tick-rollback");

  flags.set("trueSight", false);
  frame = system.update(next({ x: 8, z: 2 }), 0, {
    deltaMs: 1,
    mode: "play",
  });
  assert.equal(frame.snapReason, "movement-jump");
  assert.equal(frame.displayVisibilityAt(9, 5.5), 1);

  flags.set("trueSight", true);
  frame = system.update(next({ x: 8, z: 2 }), 0, {
    deltaMs: 1,
    mode: "edit",
  });
  assert.equal(frame.snapReason, "edit-mode-transition");
  assert.ok(frame.logicalMask.every((entry) => entry === 255));
  frame = system.update(next({ x: 8, z: 2 }), 0, {
    deltaMs: 1,
    mode: "play",
  });
  assert.equal(frame.snapReason, "edit-mode-transition");
});

test("circle visibility permits partial peeking without casting entity rays", () => {
  const value = map(12, 12, [[6, 5]]);
  const frame = new TrueSightSystem().update(
    snapshot(value, 5, 5.5),
    0,
    { deltaMs: 0 },
  );
  const rayCount = frame.rayCount;
  assert.equal(frame.isPointVisible(7.5, 5.5), false);
  assert.equal(frame.isCircleVisible(7.5, 5.5, 0.2), false);
  assert.equal(frame.isCircleVisible(7.5, 5.5, 1), true);
  assert.equal(frame.rayCount, rayCount);
  assert.doesNotThrow(() => JSON.stringify(frame.diagnostics()));
});

test("resetting TrueSight metrics immediately clears every cached timing summary", () => {
  const system = new TrueSightSystem();
  system.update(snapshot(map(8, 8), 2.5, 2.5), 0, { deltaMs: 0 });
  system.resetPerformanceMetrics();
  const timings = system.frame.diagnostics().timings;
  for (const summary of Object.values(timings)) {
    assert.deepEqual(summary, {
      last: 0,
      p50: 0,
      p95: 0,
      p99: 0,
      max: 0,
    });
  }
});
