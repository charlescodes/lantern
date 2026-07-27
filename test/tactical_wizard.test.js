import test from "node:test";
import assert from "node:assert/strict";

import { TACTICAL_WIZARD } from "../src/config.js";
import { GridMap } from "../src/sim/grid_map.js";
import {
  chooseDodgeDirection,
  hostileThreatMetrics,
  predictSoftenedIntercept,
  solveInterceptTime,
  strafeDecision,
  tacticalLaneUint32,
} from "../src/sim/tactical_wizard.js";

function borderedMap(width, height) {
  const map = new GridMap(width, height, undefined, { x: 1.5, z: 1.5 });
  for (let x = 0; x < width; x += 1) {
    map.set(x, 0, 1);
    map.set(x, height - 1, 1);
  }
  for (let z = 0; z < height; z += 1) {
    map.set(0, z, 1);
    map.set(width - 1, z, 1);
  }
  return map;
}

test("intercept solver handles stationary, lateral, approaching, and unreachable targets", () => {
  assert.equal(solveInterceptTime(0, 0, 9, 0, 0, 0, 9), 1);
  const lateral = solveInterceptTime(0, 0, 9, 0, 0, 3, 9);
  assert.ok(Math.abs(lateral - 1.0606601717798212) < 1e-12);
  const approaching = solveInterceptTime(0, 0, 9, 0, -3, 0, 9);
  assert.ok(Math.abs(approaching - 0.75) < 1e-12);
  assert.equal(solveInterceptTime(0, 0, 9, 0, 12, 0, 9), null);
});

test("softened lead uses 75 percent after lifetime and 1.5-second clamping", () => {
  const lateral = predictSoftenedIntercept({
    shooterX: 0,
    shooterZ: 0,
    targetX: 9,
    targetZ: 0,
    targetVx: 0,
    targetVz: 3,
    projectileSpeed: 9,
    projectileLifetime: 4,
  });
  assert.equal(lateral.valid, true);
  assert.ok(Math.abs(lateral.leadTime - lateral.interceptTime * 0.75) < 1e-12);
  assert.ok(Math.abs(lateral.z - 3 * lateral.leadTime) < 1e-12);

  const clamped = predictSoftenedIntercept({
    shooterX: 0,
    shooterZ: 0,
    targetX: 30,
    targetZ: 0,
    targetVx: 0,
    targetVz: 2,
    projectileSpeed: 9,
    projectileLifetime: 0.8,
  });
  assert.ok(clamped.interceptTime > 0.8);
  assert.equal(clamped.clampedTime, 0.8);
  assert.ok(Math.abs(clamped.leadTime - 0.6) < 1e-12);
  assert.ok(Math.abs(clamped.z - 1.2) < 1e-12);

  const unreachable = predictSoftenedIntercept({
    shooterX: 0,
    shooterZ: 0,
    targetX: 9,
    targetZ: 0,
    targetVx: 12,
    targetVz: 0,
    projectileSpeed: 9,
    projectileLifetime: 4,
  });
  assert.deepEqual(
    { valid: unreachable.valid, x: unreachable.x, z: unreachable.z, leadTime: unreachable.leadTime },
    { valid: false, x: 9, z: 0, leadTime: 0 },
  );
});

test("threat detection accepts genuine approaches and rejects near misses, late, close, and expiring shots", () => {
  const enemy = { x: 5, z: 5, vx: 0, vz: 0, radius: 0.3 };
  const genuine = hostileThreatMetrics(enemy, {
    x: 1,
    z: 5,
    vx: 8,
    vz: 0,
    radius: 0.12,
    age: 0,
    lifetime: 2,
  });
  assert.ok(genuine);
  assert.equal(genuine.time, 0.5);

  assert.equal(hostileThreatMetrics(enemy, {
    x: 1,
    z: 6,
    vx: 8,
    vz: 0,
    radius: 0.12,
  }), null);
  assert.equal(hostileThreatMetrics(enemy, {
    x: 3.5,
    z: 5,
    vx: 8,
    vz: 0,
    radius: 0.12,
  }), null);
  assert.equal(hostileThreatMetrics(enemy, {
    x: 2.9,
    z: 5,
    vx: 12,
    vz: 0,
    radius: 0.12,
  }), null);
  assert.equal(hostileThreatMetrics(enemy, {
    x: 1,
    z: 5,
    vx: 8,
    vz: 0,
    radius: 0.12,
    age: 0.8,
    lifetime: 1,
  }), null);
});

test("dodge chooses the legal perpendicular side and resolves open ties stably", () => {
  const map = borderedMap(10, 10);
  map.set(4, 3, 1);
  map.set(4, 2, 1);
  const enemy = { x: 4.5, z: 4.5, radius: 0.3 };
  const projectile = { x: 1, z: 4.5, vx: 8, vz: 0, radius: 0.12, effectId: 71 };
  const threat = { time: 0.4375 };
  const selected = chooseDodgeDirection(map, enemy, projectile, threat, 0x1234, 9);
  assert.ok(selected);
  assert.equal(selected.side, "left");
  assert.equal(selected.leftLegal, true);
  assert.equal(selected.rightLegal, false);

  const open = borderedMap(12, 12);
  const first = chooseDodgeDirection(open, enemy, projectile, threat, 0x1234, 9);
  const second = chooseDodgeDirection(open, enemy, projectile, threat, 0x1234, 9);
  assert.deepEqual(second, first);
});

test("enemy-local strafe lanes are bounded, pinned, and independent of call order", () => {
  const seed = 0x7000_0007;
  const first = strafeDecision(seed, 3, 0);
  const second = strafeDecision(seed, 3, 1);
  assert.ok(first.direction === -1 || first.direction === 1);
  assert.ok(first.durationTicks >= TACTICAL_WIZARD.strafeMinimumTicks);
  assert.ok(first.durationTicks <= TACTICAL_WIZARD.strafeMaximumTicks);
  const pinned = {
    direction: tacticalLaneUint32(seed, 3, "strafe-direction", 4),
    duration: tacticalLaneUint32(seed, 3, "strafe-duration", 4),
    dodge: tacticalLaneUint32(seed, 3, "dodge-tie", 99),
  };
  assert.deepEqual(pinned, {
    direction: 1_819_942_308,
    duration: 2_938_146_646,
    dodge: 1_783_341_079,
  });
  assert.deepEqual(first, { direction: 1, durationTicks: 101 });
  assert.deepEqual(second, { direction: -1, durationTicks: 173 });
  tacticalLaneUint32(seed, 999, "dodge-tie", 1);
  strafeDecision(seed, 4, 200);
  assert.deepEqual({
    direction: tacticalLaneUint32(seed, 3, "strafe-direction", 4),
    duration: tacticalLaneUint32(seed, 3, "strafe-duration", 4),
    dodge: tacticalLaneUint32(seed, 3, "dodge-tie", 99),
  }, pinned);
  assert.notDeepEqual(first, second);
  assert.throws(() => tacticalLaneUint32(seed, 3, "future"), /Unknown tactical lane/);
});
