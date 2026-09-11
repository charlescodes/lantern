import test from "node:test";
import assert from "node:assert/strict";

import { Camera2D } from "../src/browser/camera.js";
import {
  DAMAGE_NUMBER_CAPACITY,
  DAMAGE_NUMBER_DIRECTED_DISTANCE_METERS,
  DAMAGE_NUMBER_FONT,
  DAMAGE_NUMBER_LIFETIME_SECONDS,
  DAMAGE_NUMBER_MAXIMUM_RADIUS_METERS,
  DAMAGE_NUMBER_SOURCELESS_RADIUS_METERS,
  DamageNumberOverlay,
  DamageNumberPool,
  createDamageNumber,
  damageNumberOpacity,
  damageNumberPositionAt,
  damageNumberViewportFromNdc,
  formatDamageNumber,
  projectDamageNumberCanvas,
} from "../src/presentation/damage_numbers.js";

function damageEvent(id, overrides = {}) {
  return {
    type: "damage",
    id,
    tick: overrides.tick ?? 1,
    amount: overrides.amount ?? 25,
    position: overrides.position ?? { x: 4, z: 5 },
    visualCenterY: overrides.visualCenterY ?? 0.8,
    layerIndex: overrides.layerIndex ?? 0,
    layerId: overrides.layerId ?? "ground",
    launchDirection: Object.hasOwn(overrides, "launchDirection")
      ? overrides.launchDirection
      : { x: 1, z: 0 },
    target: overrides.target ?? { kind: "enemyWizard", id: 7, team: "enemy" },
  };
}

function snapshot(tick, events = [], overrides = {}) {
  return {
    tick,
    seed: overrides.seed ?? 0x1234_5678,
    map: overrides.map ?? {
      layerId: "ground",
      width: 8,
      height: 8,
      cells: new Array(64).fill(0),
    },
    obelisks: [],
    recentCombatEvents: events,
  };
}

test("damage-number recipes format applied damage and stay deterministic and bounded", () => {
  assert.equal(formatDamageNumber(0.01), "1");
  assert.equal(formatDamageNumber(2.49), "2");
  assert.equal(formatDamageNumber(2.5), "3");
  const first = createDamageNumber(damageEvent(4), 99);
  const repeat = createDamageNumber(damageEvent(4), 99);
  const different = createDamageNumber(damageEvent(5), 99);
  assert.deepEqual(first, repeat);
  assert.notDeepEqual(first, different);
  assert.ok(first);
  assert.ok(Math.hypot(first.vx, first.vz) >= DAMAGE_NUMBER_DIRECTED_DISTANCE_METERS);
  assert.ok(Math.hypot(first.vx, first.vz) <= DAMAGE_NUMBER_MAXIMUM_RADIUS_METERS);

  const vertical = createDamageNumber(damageEvent(6, { launchDirection: null }), 99);
  assert.ok(vertical);
  assert.ok(Math.hypot(vertical.vx, vertical.vz) <= DAMAGE_NUMBER_SOURCELESS_RADIUS_METERS);
  assert.equal(createDamageNumber(damageEvent(7, { amount: 0 })), null);
  assert.equal(createDamageNumber({ ...damageEvent(8), type: "healing" }, 99), null);
});

test("the one-second analytic arc reaches a two-meter apex and fades smoothly", () => {
  const origin = { x: 1, y: 0.8, z: 2 };
  const velocity = { x: 0.35, z: -0.1 };
  const apex = damageNumberPositionAt(origin, velocity, DAMAGE_NUMBER_LIFETIME_SECONDS);
  assert.ok(Math.abs(apex.y - 2.8) < 1e-12);
  assert.ok(Math.abs(apex.x - 1.35) < 1e-12);
  assert.ok(Math.abs(apex.z - 1.9) < 1e-12);
  assert.equal(damageNumberOpacity(0), 1);
  assert.equal(damageNumberOpacity(0.2), 1);
  assert.ok(damageNumberOpacity(0.5) < 1);
  assert.ok(damageNumberOpacity(0.5) > 0);
  assert.equal(damageNumberOpacity(1), 0);
});

test("the pool ingests same-tick events once, catches up by ticks, expires, and swap-removes", () => {
  const pool = new DamageNumberPool({ capacity: 4 });
  pool.prime(snapshot(0));
  const events = [damageEvent(1), damageEvent(2)];
  pool.ingest(snapshot(1, events));
  assert.equal(pool.activeCount, 2);
  assert.equal(pool.ingestedEvents, 2);
  pool.ingest(snapshot(1, events));
  assert.equal(pool.activeCount, 2);
  assert.equal(pool.ingestedEvents, 2);

  const removedId = pool.eventId[0];
  const swappedId = pool.eventId[1];
  assert.equal(pool.removeSwap(0), true);
  assert.equal(pool.activeCount, 1);
  assert.equal(pool.eventId[0], swappedId);
  assert.notEqual(pool.eventId[0], removedId);

  pool.step(59);
  assert.equal(pool.activeCount, 1);
  pool.step(1);
  assert.equal(pool.activeCount, 0);
  assert.equal(pool.expired, 1);

  const catchup = new DamageNumberPool();
  catchup.prime(snapshot(0));
  catchup.ingest(snapshot(31, [damageEvent(3, { tick: 1 })]));
  assert.ok(Math.abs(catchup.age[0] - 0.5) < 1e-6);
});

test("overflow drops newest numbers and timeline or toggle resets do not resurrect history", () => {
  const pool = new DamageNumberPool();
  pool.prime(snapshot(0));
  const events = Array.from(
    { length: DAMAGE_NUMBER_CAPACITY + 1 },
    (_, index) => damageEvent(index + 1),
  );
  pool.ingest(snapshot(1, events));
  assert.equal(pool.activeCount, DAMAGE_NUMBER_CAPACITY);
  assert.equal(pool.dropped, 1);
  assert.equal(pool.ingestedEvents, DAMAGE_NUMBER_CAPACITY + 1);

  pool.ingest(snapshot(0, []));
  assert.equal(pool.activeCount, 0);
  assert.equal(pool.resets, 1);
  pool.ingest(snapshot(1, [damageEvent(1)]));
  assert.equal(pool.activeCount, 1);
  pool.clearForToggle();
  pool.ingest(snapshot(1, [damageEvent(1)]));
  assert.equal(pool.activeCount, 0, "re-enabling primes past retained events");
  pool.ingest(snapshot(2, [damageEvent(1), damageEvent(2, { tick: 2 })]));
  assert.equal(pool.activeCount, 1);

  const changedSeed = snapshot(2, [damageEvent(1), damageEvent(2, { tick: 2 })], { seed: 7 });
  pool.ingest(changedSeed);
  assert.equal(pool.activeCount, 0);
  pool.ingest(changedSeed);
  assert.equal(pool.activeCount, 0);
});

test("projection helpers preserve CSS viewport coordinates and Canvas height lift", () => {
  const camera = new Camera2D({ centerX: 4, centerZ: 4, visibleHeightMeters: 8 });
  camera.resize(800, 800);
  assert.deepEqual(
    projectDamageNumberCanvas(camera, { x: 4, y: 2, z: 4 }, 0),
    { x: 400, y: 200 },
  );
  assert.deepEqual(
    damageNumberViewportFromNdc({ x: 0.5, y: -0.5, z: 0 }, 800, 600),
    { x: 600, y: 450 },
  );
  assert.equal(damageNumberViewportFromNdc({ x: 0, y: 0, z: 2 }, 800, 600), null);
});

test("the overlay uses constant CSS text, layer filtering, and enemy TrueSight opacity", () => {
  const calls = [];
  const context = {
    font: "",
    globalAlpha: 1,
    setTransform() {},
    clearRect() {},
    strokeText(text, x, y) { calls.push({ kind: "stroke", text, x, y, alpha: this.globalAlpha, font: this.font }); },
    fillText(text, x, y) { calls.push({ kind: "fill", text, x, y, alpha: this.globalAlpha, font: this.font }); },
  };
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => context,
    getBoundingClientRect: () => ({ width: 640, height: 360 }),
  };
  const previousWindow = globalThis.window;
  globalThis.window = { devicePixelRatio: 2 };
  try {
    const pool = new DamageNumberPool({ capacity: 3 });
    pool.spawn(createDamageNumber(damageEvent(1), 4));
    pool.spawn(createDamageNumber(damageEvent(2, {
      layerIndex: 1,
      target: { kind: "player", id: 1, team: "player" },
    }), 4));
    const overlay = new DamageNumberOverlay(canvas);
    overlay.render(pool, 1, {
      layerIndex: 0,
      project: (point) => ({ x: point.x, y: point.y }),
      sightFrame: { displayVisibilityAt: () => 0.5 },
      dprCap: 2,
    });
    const fills = calls.filter((call) => call.kind === "fill");
    assert.equal(fills.length, 1);
    assert.equal(fills[0].alpha, 0.5);
    assert.equal(fills[0].font, DAMAGE_NUMBER_FONT);
    assert.equal(canvas.width, 1280);
    assert.equal(canvas.height, 720);
  } finally {
    globalThis.window = previousWindow;
  }
});
