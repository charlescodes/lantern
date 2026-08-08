import test from "node:test";
import assert from "node:assert/strict";

import { Camera3D } from "../src/presentation/camera_3d.js";

/** @param {number} actual @param {number} expected @param {number} [epsilon] */
function closeTo(actual, expected, epsilon = 1e-9) {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `expected ${actual} to be within ${epsilon} of ${expected}`,
  );
}

test("orthographic camera projects the ground at 45 degree yaw and 55 degree pitch", () => {
  const camera = new Camera3D({ centerX: 10, centerZ: 20 });
  camera.resize(1_200, 600);

  assert.equal(camera.visibleHeightMeters, 24);
  assert.equal(camera.visibleWidthMeters, 48);
  assert.deepEqual(camera.worldToViewport(10, 20), { x: 600, y: 300 });

  const forward = camera.groundForward;
  const right = camera.groundRight;
  const forwardToTop = 12 / Math.sin(camera.downwardPitchRadians);
  const top = camera.worldToViewport(
    10 + forward.x * forwardToTop,
    20 + forward.z * forwardToTop,
  );
  closeTo(top.x, 600);
  closeTo(top.y, 0);
  const rightEdge = camera.worldToViewport(
    10 + right.x * 24,
    20 + right.z * 24,
  );
  closeTo(rightEdge.x, 1_200);
  closeTo(rightEdge.y, 300);
});

test("viewport pointer rays round-trip through the Y=0 ground plane", () => {
  const camera = new Camera3D({ centerX: 8.5, centerZ: 13.25 });
  camera.resize(1_000, 700);

  for (const point of [
    { x: 0, y: 0 },
    { x: 500, y: 350 },
    { x: 999, y: 699 },
    { x: 212.5, y: 543.25 },
  ]) {
    const world = camera.viewportToWorld(point.x, point.y);
    const restored = camera.worldToViewport(world.x, world.z);
    closeTo(restored.x, point.x);
    closeTo(restored.y, point.y);
  }
});

test("3D cursor-anchored zoom retains the ground point and metric bounds", () => {
  const camera = new Camera3D({ centerX: 10, centerZ: 20 });
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
});

test("3D centered zoom changes coverage without moving the ground target", () => {
  const camera = new Camera3D({ centerX: 10, centerZ: 20 });

  assert.equal(camera.zoomByFactor(2), true);
  assert.equal(camera.visibleHeightMeters, 12);
  assert.equal(camera.centerX, 10);
  assert.equal(camera.centerZ, 20);

  camera.zoomByFactor(1_000);
  assert.equal(camera.visibleHeightMeters, 4);
  camera.zoomByFactor(0.000_001);
  assert.equal(camera.visibleHeightMeters, 64);
  assert.equal(camera.zoomByFactor(0), false);
  assert.equal(camera.visibleHeightMeters, 64);
});

test("3D camera pan, focus, and backend-neutral render pose use world meters", () => {
  const camera = new Camera3D({ centerX: 5, centerZ: 7 });
  camera.resize(800, 400);
  camera.panByWorld(-1.25, 2.5);
  assert.equal(camera.centerX, 3.75);
  assert.equal(camera.centerZ, 9.5);
  camera.focus(12, 14);

  const pose = camera.renderPose();
  closeTo(Math.hypot(pose.direction.x, pose.direction.y, pose.direction.z), 1);
  closeTo(pose.position.x + pose.direction.x * 64, pose.target.x);
  closeTo(pose.position.y + pose.direction.y * 64, pose.target.y);
  closeTo(pose.position.z + pose.direction.z * 64, pose.target.z);
  assert.equal(pose.left, -24);
  assert.equal(pose.right, 24);
  assert.equal(pose.top, 12);
  assert.equal(pose.bottom, -12);
});

test("3D camera rejects invalid pitch and metric bounds", () => {
  assert.throws(
    () => new Camera3D({ downwardPitchDegrees: 0 }),
    /finite metric bounds and pose/,
  );
  assert.throws(
    () => new Camera3D({ downwardPitchDegrees: 90 }),
    /finite metric bounds and pose/,
  );
  assert.throws(
    () => new Camera3D({ maximumVisibleHeightMeters: 2 }),
    /finite metric bounds and pose/,
  );
  assert.throws(
    () => new Camera3D({ visibleHeightMeters: Number.NaN }),
    /visible height/,
  );
});
