import test from "node:test";
import assert from "node:assert/strict";

import { MOVEMENT_SOUND } from "../src/config.js";
import {
  shouldFadeWall,
  WALL_FADED_OPACITY,
  WALL_FADE_RADIUS_METERS,
  WALL_OPACITY_ATTRIBUTE,
} from "../src/presentation/wall_occlusion.js";

const DIAGONAL = Math.SQRT1_2;

test("wall fading shares the walking radius and fixed presentation constants", () => {
  assert.equal(WALL_FADE_RADIUS_METERS, MOVEMENT_SOUND.walkTargetRadiusMeters);
  assert.equal(WALL_FADED_OPACITY, 0.33);
  assert.equal(WALL_OPACITY_ATTRIBUTE, "wallOpacity");
});

test("nearby walls fade only when the player is on their screen-top side", () => {
  assert.equal(
    shouldFadeWall(3.3, 3.5, 2, 3, DIAGONAL, DIAGONAL),
    true,
  );
  assert.equal(
    shouldFadeWall(1.7, 3.5, 2, 3, DIAGONAL, DIAGONAL),
    false,
  );
  assert.equal(
    shouldFadeWall(3.3, 2.7, 2, 3, DIAGONAL, DIAGONAL),
    false,
  );
});

test("wall fading keeps the proximity boundary inclusive and follows camera yaw", () => {
  const boundaryX = 3 + WALL_FADE_RADIUS_METERS;
  assert.equal(
    shouldFadeWall(boundaryX, 3.5, 2, 3, DIAGONAL, DIAGONAL),
    true,
  );
  assert.equal(
    shouldFadeWall(boundaryX + 0.000_001, 3.5, 2, 3, DIAGONAL, DIAGONAL),
    false,
  );
  assert.equal(shouldFadeWall(1.7, 3.5, 2, 3, -1, 0), true);
  assert.equal(shouldFadeWall(3.3, 3.5, 2, 3, -1, 0), false);
});
