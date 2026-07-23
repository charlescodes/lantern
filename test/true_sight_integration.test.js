import test from "node:test";
import assert from "node:assert/strict";

import { applyLightPool } from "../src/presentation/light_pool.js";
import {
  queryVisibleAt,
  resolveVisibleSelection,
} from "../src/visibility/presentation_gate.js";
import { TrueSightSystem } from "../src/visibility/true_sight.js";

function sightFrame() {
  const width = 12;
  const height = 12;
  const cells = new Array(width * height).fill(0);
  cells[5 * width + 6] = 1;
  return new TrueSightSystem().update({
    tick: 1,
    seed: 1,
    map: { width, height, cells },
    player: {
      x: 5,
      z: 5.5,
      previousX: 5,
      previousZ: 5.5,
    },
  }, 0, { deltaMs: 0 });
}

test("hidden hover and pinned details are gated while raw diagnostic queries stay unrestricted", () => {
  const frame = sightFrame();
  const hiddenEntity = {
    kind: "rock",
    id: 7,
    position: { x: 9, y: 0, z: 5.5 },
    velocity: { x: 1, y: 0, z: 0 },
    radius: 0.2,
  };
  let rawQueries = 0;
  const simulation = {
    queryAt() {
      rawQueries += 1;
      return hiddenEntity;
    },
    resolveSelection(selection) {
      return selection.id === 7 ? hiddenEntity : null;
    },
  };
  const pinned = { kind: "rock", id: 7 };

  assert.equal(queryVisibleAt(simulation, frame, 9, 5.5, "play"), null);
  assert.equal(rawQueries, 0);
  assert.equal(simulation.queryAt(9, 5.5), hiddenEntity);
  assert.equal(rawQueries, 1);
  assert.deepEqual(resolveVisibleSelection(simulation, frame, pinned), {
    entity: null,
    hidden: true,
  });
  assert.deepEqual(pinned, { kind: "rock", id: 7 });
  assert.equal(
    queryVisibleAt(simulation, frame, 9, 5.5, "edit"),
    hiddenEntity,
  );
});

test("display visibility darkens resident light assignments without changing leases", () => {
  const light = {
    position: { set() {} },
    color: { setRGB() {} },
    intensity: 0,
    distance: 0,
    decay: 0,
    visible: false,
    castShadow: true,
    userData: {},
  };
  const assignment = {
    key: "projectile:42",
    residentSlot: 0,
    x: 9,
    y: 0.9,
    z: 5.5,
    color: { r: 1, g: 0.5, b: 0.1 },
    intensity: 4,
    distance: 5,
    decay: 2,
  };

  assert.equal(applyLightPool([light], [assignment], true, () => 0), 1);
  assert.equal(light.intensity, 0);
  assert.equal(light.userData.assignment, assignment.key);
  assert.equal(applyLightPool([light], [assignment], true, () => 0.25), 1);
  assert.equal(light.intensity, 1);
  assert.equal(light.userData.assignment, assignment.key);
});

test("logical and display consumers share one reusable frame without snapshot mutation", () => {
  const width = 10;
  const height = 10;
  const cells = new Array(width * height).fill(0);
  cells[4 * width + 5] = 1;
  const snapshot = {
    tick: 1,
    seed: 5,
    map: { width, height, cells },
    player: { x: 4, z: 4.5, previousX: 4, previousZ: 4.5 },
  };
  const before = JSON.stringify(snapshot);
  const system = new TrueSightSystem();
  const first = system.update(snapshot, 0, { deltaMs: 0 });
  const logicalMask = first.logicalMask;
  const displayMask = first.displayMask;
  const polygon = first.polygon;
  const rays = first.rays;
  snapshot.tick = 2;
  const second = system.update(snapshot, 0, { deltaMs: 16 });

  assert.equal(second, first);
  assert.equal(second.logicalMask, logicalMask);
  assert.equal(second.displayMask, displayMask);
  assert.equal(second.polygon, polygon);
  assert.equal(second.rays, rays);
  snapshot.tick = 1;
  assert.equal(JSON.stringify(snapshot), before);
});
