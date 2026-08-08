import test from "node:test";
import assert from "node:assert/strict";

import { Camera2D } from "../src/browser/camera.js";
import { Camera3D } from "../src/presentation/camera_3d.js";
import {
  focusCameraOnPlayer,
  interpolateRenderValue,
  syncPlayerCamera,
} from "../src/presentation/player_camera.js";

const PLAYER = Object.freeze({
  previousX: 2,
  previousZ: 4,
  x: 10,
  z: 20,
});

test("player render interpolation is bounded to the local snapshot interval", () => {
  assert.equal(interpolateRenderValue(2, 10, 0), 2);
  assert.equal(interpolateRenderValue(2, 10, 0.25), 4);
  assert.equal(interpolateRenderValue(2, 10, 1), 10);
  assert.equal(interpolateRenderValue(2, 10, -1), 2);
  assert.equal(interpolateRenderValue(2, 10, 2), 10);
  assert.equal(interpolateRenderValue(2, 10, Number.NaN), 2);
});

test("both presentation cameras focus on the exact player render pose", () => {
  for (const camera of [new Camera2D(), new Camera3D()]) {
    focusCameraOnPlayer(camera, PLAYER, 0.25);
    assert.equal(camera.centerX, 4);
    assert.equal(camera.centerZ, 8);
    assert.deepEqual(
      camera.worldToViewport(camera.centerX, camera.centerZ),
      { x: 0.5, y: 0.5 },
    );
  }
});

test("automatic following owns play mode but leaves the edit camera free", () => {
  const camera = new Camera2D({ centerX: 30, centerZ: 40 });

  assert.equal(syncPlayerCamera(camera, PLAYER, 0.5, "edit"), false);
  assert.equal(camera.centerX, 30);
  assert.equal(camera.centerZ, 40);

  assert.equal(syncPlayerCamera(camera, PLAYER, 0.5, "play"), true);
  assert.equal(camera.centerX, 6);
  assert.equal(camera.centerZ, 12);
});
