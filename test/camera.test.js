import test from "node:test";
import assert from "node:assert/strict";

import { Camera2D } from "../src/browser/camera.js";

/** @param {number} actual @param {number} expected @param {number} [epsilon] */
function closeTo(actual, expected, epsilon = 1e-9) {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `expected ${actual} to be within ${epsilon} of ${expected}`,
  );
}

test("camera projection derives viewport scale from a metric visible height", () => {
  const camera = new Camera2D({ centerX: 10, centerZ: 20 });
  camera.resize(1_200, 600);

  assert.equal(camera.visibleHeightMeters, 24);
  assert.equal(camera.visibleWidthMeters, 48);
  assert.equal(camera.worldToViewportScale, 25);
  assert.deepEqual(camera.worldToViewport(10, 20), { x: 600, y: 300 });
  assert.deepEqual(camera.worldToViewport(22, 32), { x: 900, y: 600 });
  assert.deepEqual(camera.viewportToWorld(0, 0), { x: -14, z: 8 });
  assert.equal(camera.worldLengthToViewport(1), 25);
  assert.equal(camera.viewportLengthToWorld(25), 1);

  const point = { x: 13.75, z: 17.25 };
  const viewport = camera.worldToViewport(point.x, point.z);
  const restored = camera.viewportToWorld(viewport.x, viewport.y);
  closeTo(restored.x, point.x);
  closeTo(restored.z, point.z);
});

test("resize changes raster projection without changing world coverage height", () => {
  const camera = new Camera2D({ centerX: 2, centerZ: 3 });
  camera.resize(800, 400);
  const before = camera.worldToViewport(4, 5);

  camera.resize(1_600, 800);
  const after = camera.worldToViewport(4, 5);

  assert.equal(camera.visibleHeightMeters, 24);
  assert.equal(camera.visibleWidthMeters, 48);
  closeTo(after.x - 800, (before.x - 400) * 2);
  closeTo(after.y - 400, (before.y - 200) * 2);
});

test("cursor-anchored zoom changes metric coverage and respects its bounds", () => {
  const camera = new Camera2D({ centerX: 10, centerZ: 20 });
  camera.resize(800, 400);
  const anchor = { x: 620, y: 90 };
  const before = camera.viewportToWorld(anchor.x, anchor.y);

  assert.equal(camera.zoomAtViewport(anchor.x, anchor.y, 2), true);
  assert.equal(camera.visibleHeightMeters, 12);
  const after = camera.viewportToWorld(anchor.x, anchor.y);
  closeTo(after.x, before.x);
  closeTo(after.z, before.z);

  camera.zoomAtViewport(anchor.x, anchor.y, 1_000);
  assert.equal(camera.visibleHeightMeters, 4);
  camera.zoomAtViewport(anchor.x, anchor.y, 0.000_001);
  assert.equal(camera.visibleHeightMeters, 64);
  assert.equal(camera.zoomAtViewport(anchor.x, anchor.y, 0), false);
  assert.equal(camera.visibleHeightMeters, 64);
});

test("camera panning is expressed in world meters", () => {
  const camera = new Camera2D({ centerX: 5, centerZ: 7 });
  camera.panByWorld(-1.25, 2.5);
  assert.equal(camera.centerX, 3.75);
  assert.equal(camera.centerZ, 9.5);
});

test("camera rejects invalid metric bounds", () => {
  assert.throws(
    () => new Camera2D({ minimumVisibleHeightMeters: 0 }),
    /finite metric bounds/,
  );
  assert.throws(
    () => new Camera2D({
      minimumVisibleHeightMeters: 20,
      maximumVisibleHeightMeters: 10,
    }),
    /finite metric bounds/,
  );
  assert.throws(
    () => new Camera2D({ visibleHeightMeters: Number.NaN }),
    /visible height/,
  );
});
