import test from "node:test";
import assert from "node:assert/strict";

import { MOVEMENT_SOUND } from "../src/config.js";
import {
  createOpenTopWallGeometry,
  createWallCapGeometry,
  shouldSuppressWallCap,
  WALL_CAP_RELIEF_RADIUS_METERS,
  WALL_HEIGHT_METERS,
} from "../src/presentation/wall_cap_relief.js";

test("wall-cap relief uses the inclusive walking radius against cell footprints", () => {
  assert.equal(
    WALL_CAP_RELIEF_RADIUS_METERS,
    MOVEMENT_SOUND.walkTargetRadiusMeters,
  );
  assert.equal(shouldSuppressWallCap(1.25, 3.5, 2, 3), true);
  assert.equal(shouldSuppressWallCap(1.249_999, 3.5, 2, 3), false);
  assert.equal(shouldSuppressWallCap(2.5, 3.5, 2, 3), true);
  assert.equal(shouldSuppressWallCap(1.5, 2.5, 2, 3), true);
  assert.equal(shouldSuppressWallCap(1.4, 2.4, 2, 3), false);
});

test("wall sides omit only the top face and the separate cap faces upward", () => {
  const sides = createOpenTopWallGeometry();
  const sidePositions = sides.getAttribute("position");
  assert.equal(sidePositions.count, 30);
  for (let vertex = 0; vertex < sidePositions.count; vertex += 3) {
    const isTop = [0, 1, 2].every(
      (offset) => (
        Math.abs(sidePositions.getY(vertex + offset) - WALL_HEIGHT_METERS / 2)
          < 1e-9
      ),
    );
    assert.equal(isTop, false);
  }

  const cap = createWallCapGeometry();
  const capPositions = cap.getAttribute("position");
  const capNormals = cap.getAttribute("normal");
  assert.equal(capPositions.count, 4);
  assert.equal(cap.index?.count, 6);
  for (let vertex = 0; vertex < capPositions.count; vertex += 1) {
    assert.ok(Math.abs(capPositions.getY(vertex)) < 1e-9);
    assert.ok(Math.abs(capNormals.getY(vertex) - 1) < 1e-9);
  }
  sides.dispose();
  cap.dispose();
});
