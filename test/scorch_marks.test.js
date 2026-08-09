import test from "node:test";
import assert from "node:assert/strict";

import {
  SCORCH_CORE_TRIANGLE_COUNT,
  SCORCH_FLECK_TRIANGLE_COUNT,
  SCORCH_GROUND_Y_METERS,
  SCORCH_MARK_CAPACITY,
  ScorchMarkPool,
  createScorchMark,
  scorchMarkRadius,
} from "../src/presentation/scorch_marks.js";
import { FIREBALL_PRESENTATION_HEIGHT_METERS } from "../src/presentation/combat_visuals.js";
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

function impact(id, overrides = {}) {
  return {
    type: "explosion",
    id,
    tick: id,
    effectSeed: 0x1234_abcd,
    hit: { kind: "rock", id: 7 },
    originX: 5.5,
    originZ: 5.5,
    y: 0.1,
    nx: 1,
    nz: 0,
    radius: 2.5,
    pressureImpulse: 800,
    cell: null,
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

function edgeLength(triangle) {
  return Math.hypot(triangle.u1 - triangle.u0, triangle.v1 - triangle.v0);
}

function trianglePoints(triangle) {
  return [
    { u: triangle.u0, v: triangle.v0 },
    { u: triangle.u1, v: triangle.v1 },
    { u: triangle.u2, v: triangle.v2 },
  ];
}

test("scorch radius is blast-led with bounded diminishing pressure influence", () => {
  assert.equal(scorchMarkRadius(2.5, 800), 1);
  assert.ok(scorchMarkRadius(2.5, 100) < 1);
  assert.ok(scorchMarkRadius(2.5, 5_000) > 1);
  assert.ok(scorchMarkRadius(5, 100) > scorchMarkRadius(2.5, 5_000));
  assert.equal(scorchMarkRadius(0, 0), 0.15);
  assert.equal(scorchMarkRadius(12, 5_000), 4);
  assert.equal(scorchMarkRadius(Number.NaN, Number.NaN), 0.15);
});

test("one deterministic ground recipe contains eight cores and sixteen visible flecks", () => {
  const map = openMap();
  const first = createScorchMark(impact(1), map);
  const repeated = createScorchMark(impact(1), map);
  const varied = createScorchMark(impact(1, { effectSeed: 99 }), map);
  assert.ok(first);
  assert.deepEqual(repeated, first);
  assert.notDeepEqual(varied?.coreTriangles, first.coreTriangles);
  assert.equal(first.surface.kind, "ground");
  assert.equal(first.surface.y, SCORCH_GROUND_Y_METERS);
  assert.equal(first.radius, 1);
  assert.equal(first.coreTriangles.length, SCORCH_CORE_TRIANGLE_COUNT);
  assert.equal(first.fleckTriangles.length, SCORCH_FLECK_TRIANGLE_COUNT);
  for (const triangle of first.coreTriangles) {
    const edge = edgeLength(triangle);
    assert.ok(edge >= 0.15 - 1e-12 && edge <= 0.3 + 1e-12);
  }
  for (const triangle of first.fleckTriangles) {
    const edge = edgeLength(triangle);
    assert.ok(edge >= 0.02 - 1e-12 && edge <= 0.1 + 1e-12);
  }
});

test("wall recipes stay on the struck cell face and obelisks fall back to ground", () => {
  const map = openMap(8, 8);
  map.cells[3 * map.width + 4] = 1;
  const wallEvent = impact(1, {
    hit: { kind: "cell", cx: 4, cz: 3 },
    cell: { cx: 4, cz: 3 },
    originX: 4 - 0.0001,
    originZ: 3.12,
    nx: -1,
    nz: 0,
    radius: 12,
    pressureImpulse: 5_000,
  });
  const mark = createScorchMark(wallEvent, map);
  assert.ok(mark);
  assert.equal(mark.surface.kind, "wall");
  assert.equal(mark.surface.x, 4);
  assert.equal(mark.surface.y, FIREBALL_PRESENTATION_HEIGHT_METERS);
  assert.equal(mark.surface.z, 3.12);
  assert.equal(mark.coreTriangles.length, SCORCH_CORE_TRIANGLE_COUNT);
  assert.equal(mark.fleckTriangles.length, SCORCH_FLECK_TRIANGLE_COUNT);
  for (const triangle of [...mark.coreTriangles, ...mark.fleckTriangles]) {
    for (const point of trianglePoints(triangle)) {
      assert.ok(point.u >= mark.surface.bounds.uMinimum - 1e-12);
      assert.ok(point.u <= mark.surface.bounds.uMaximum + 1e-12);
      assert.ok(point.v >= mark.surface.bounds.vMinimum - 1e-12);
      assert.ok(point.v <= mark.surface.bounds.vMaximum + 1e-12);
      assert.ok(mark.surface.y + point.v >= 0.01 - 1e-12);
      assert.ok(mark.surface.y + point.v <= 2.49 + 1e-12);
    }
  }

  const obelisk = createScorchMark(impact(2, {
    hit: { kind: "obelisk", id: 2, cx: 4, cz: 3 },
    cell: { cx: 4, cz: 3 },
    originX: 3.9,
    originZ: 3.5,
    nx: -1,
  }), map, [{ cell: { cx: 4, cz: 3 } }]);
  assert.ok(obelisk);
  assert.equal(obelisk.surface.kind, "ground");
  assert.equal(obelisk.surface.y, SCORCH_GROUND_Y_METERS);
});

test("ground recipes discard triangles whose vertices enter solid map cells", () => {
  const map = openMap(8, 8);
  map.cells[3 * map.width + 4] = 1;
  const mark = createScorchMark(impact(1, {
    originX: 3.92,
    originZ: 3.5,
  }), map);
  assert.ok(mark);
  assert.ok(
    mark.coreTriangles.length + mark.fleckTriangles.length
      < SCORCH_CORE_TRIANGLE_COUNT + SCORCH_FLECK_TRIANGLE_COUNT,
  );
  for (const triangle of [...mark.coreTriangles, ...mark.fleckTriangles]) {
    for (const point of trianglePoints(triangle)) {
      const x = mark.surface.x + point.u;
      const z = mark.surface.z + point.v;
      assert.equal(map.cells[Math.floor(z) * map.width + Math.floor(x)], 0);
    }
  }
});

test("a real simulation wall impact feeds the local recipe without new state", () => {
  const map = new GridMap(12, 7, undefined, { x: 1.5, z: 3.5 });
  map.set(4, 3, 1);
  const simulation = new Simulation({ map, particleBurstCount: 0 });
  const pool = new ScorchMarkPool();
  pool.prime(simulation.snapshot());
  for (let tick = 0; tick < 120 && pool.length === 0; tick += 1) {
    simulation.tick(tick === 0 ? { cast: { x: 8, z: 3.5 } } : null);
    pool.ingest(simulation.snapshot());
  }
  assert.equal(pool.length, 1);
  const mark = pool.at(0);
  assert.equal(mark?.surface.kind, "wall");
  assert.equal(mark?.surface.cell.cx, 4);
  assert.equal(mark?.surface.cell.cz, 3);
  assert.equal(mark?.surface.y, FIREBALL_PRESENTATION_HEIGHT_METERS);
  assert.equal(mark?.radius, 1);
  assert.equal(mark?.coreTriangles.length, 8);
  assert.equal(mark?.fleckTriangles.length, 16);
});

test("presentation pool primes history, deduplicates events, and never mutates snapshots", () => {
  const map = openMap();
  const pool = new ScorchMarkPool();
  const oldEvent = impact(1);
  pool.prime(snapshot(map, 10, [oldEvent]));
  assert.equal(pool.length, 0);

  const newEvent = impact(2, { tick: 11 });
  const next = snapshot(map, 11, [oldEvent, newEvent]);
  const before = JSON.stringify(next);
  assert.equal(pool.ingest(next), true);
  assert.equal(JSON.stringify(next), before);
  assert.equal(pool.length, 1);
  assert.equal(pool.at(0)?.eventId, 2);
  assert.equal(pool.ingest(next), false);
  assert.equal(pool.length, 1);

  const duplicate = snapshot(map, 12, [newEvent, impact(3), impact(3)]);
  pool.ingest(duplicate);
  assert.equal(pool.length, 2);
  assert.equal(pool.diagnostics().duplicateEvents, 1);
});

test("malformed event identities and off-map impacts are skipped without throwing", () => {
  const map = openMap();
  const pool = new ScorchMarkPool();
  pool.prime(snapshot(map));
  assert.doesNotThrow(() => pool.ingest(snapshot(map, 1, [
    impact(null),
    impact(1.5),
    impact(2, { originX: -10, originZ: -10 }),
  ])));
  assert.equal(pool.length, 0);
  assert.equal(pool.diagnostics().skippedEvents, 3);
});

test("FIFO overwrite remains bounded at two hundred marks", () => {
  const map = openMap();
  const pool = new ScorchMarkPool();
  pool.prime(snapshot(map));
  for (let id = 1; id <= 1_000; id += 1) {
    pool.ingest(snapshot(map, id, [impact(id)]));
  }
  assert.equal(pool.capacity, SCORCH_MARK_CAPACITY);
  assert.equal(pool.length, SCORCH_MARK_CAPACITY);
  assert.equal(pool.at(0)?.eventId, 801);
  assert.equal(pool.at(pool.length - 1)?.eventId, 1_000);
  assert.deepEqual(pool.diagnostics(), {
    capacity: 200,
    active: 200,
    overwrites: 800,
    ingested: 1_000,
    missedEvents: 0,
    duplicateEvents: 0,
    skippedEvents: 0,
    resets: 0,
    coreTriangles: 1_600,
    fleckTriangles: 3_200,
  });
});

test("timeline, seed, event-history, and map resets clear local marks", () => {
  const map = openMap();
  const pool = new ScorchMarkPool();
  pool.prime(snapshot(map));
  pool.ingest(snapshot(map, 1, [impact(1)]));
  assert.equal(pool.length, 1);

  assert.equal(pool.ingest(snapshot(map, 2, [])), true);
  assert.equal(pool.length, 0);
  pool.ingest(snapshot(map, 3, [impact(2)]));
  assert.equal(pool.length, 1);

  assert.equal(pool.ingest(snapshot(map, 2, [impact(2)])), true);
  assert.equal(pool.length, 0);
  pool.ingest(snapshot(map, 4, [impact(3)]));
  assert.equal(pool.length, 1);

  const changedMap = openMap();
  changedMap.cells[0] = 1;
  assert.equal(pool.ingest(snapshot(changedMap, 5, [impact(3)])), true);
  assert.equal(pool.length, 0);

  pool.ingest(snapshot(changedMap, 6, [impact(4)]));
  assert.equal(pool.length, 1);
  assert.equal(pool.ingest(snapshot(changedMap, 7, [impact(4)], {
    seed: 0x1234,
  })), true);
  assert.equal(pool.length, 0);
  assert.equal(pool.diagnostics().resets, 4);
});
