import test from "node:test";
import assert from "node:assert/strict";

import {
  boxBoxContact,
  circleBoxContact,
  firstSolidBoxContact,
  firstSolidContact,
  resolveCircleAgainstGrid,
  sanitizePointAgainstGrid,
  sweepPointAgainstGrid,
} from "../src/sim/collision.js";
import { GridMap } from "../src/sim/grid_map.js";
import { Simulation } from "../src/sim/simulation.js";

function borderedMap(width, height, spawn) {
  const map = new GridMap(width, height, undefined, spawn);
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

test("fixed boxes use deterministic circle, box, and grid contacts without angular state", () => {
  const bodyContact = { nx: 0, nz: 0, penetration: 0, x: 0, z: 0 };
  assert.equal(circleBoxContact(1.1, 0, 0.3, 0, 0, 0.9, 0.36, bodyContact), true);
  assert.equal(bodyContact.nx, -1);
  assert.ok(Math.abs(bodyContact.penetration - 0.1) < 1e-12);
  assert.equal(circleBoxContact(0, 0.7, 0.3, 0, 0, 0.9, 0.36, bodyContact), false);
  assert.equal(boxBoxContact(0, 0, 0.9, 0.36, 1.5, 0, 0.9, 0.36, bodyContact), true);
  assert.equal(bodyContact.nx, 1);

  const map = new GridMap(6, 6, undefined, { x: 1.5, z: 1.5 });
  map.set(3, 2, 1);
  const gridContact = { nx: 0, nz: 0, penetration: 0, px: 0, pz: 0, cx: 0, cz: 0 };
  assert.equal(firstSolidBoxContact(map, 2.25, 2.5, 0.9, 0.36, gridContact), true);
  assert.equal(gridContact.nx, -1);
  assert.equal(gridContact.cx, 3);
  assert.equal(gridContact.cz, 2);
});

test("penetrating circles are fully corrected and inward velocity is removed", () => {
  const map = borderedMap(6, 6, { x: 1.5, z: 1.5 });
  map.set(2, 2, 1);
  const body = { x: 2.5, z: 2.5, vx: 3, vz: 2 };
  const contacts = [];
  resolveCircleAgainstGrid(map, body, 0.3, (contact) => contacts.push({ ...contact }));
  const scratch = { nx: 0, nz: 0, penetration: 0, px: 0, pz: 0, cx: 0, cz: 0 };
  assert.equal(firstSolidContact(map, body.x, body.z, 0.3, scratch), false);
  assert.ok(contacts.length > 0);
  assert.ok(Number.isFinite(body.x) && Number.isFinite(body.z));
});

test("a diameter 0.6 m player can traverse a one-cell doorway", () => {
  const map = borderedMap(8, 7, { x: 1.5, z: 3.5 });
  for (let z = 1; z < 6; z += 1) {
    if (z !== 3) map.set(3, z, 1);
  }
  const simulation = new Simulation({ map, seed: 7, particleBurstCount: 1 });
  for (let tick = 0; tick < 120; tick += 1) {
    simulation.tick({ move: { x: 6.5, z: 3.5 } });
  }
  assert.ok(simulation.player.x > 4.2, `expected player through doorway, x=${simulation.player.x}`);
  const scratch = { nx: 0, nz: 0, penetration: 0, px: 0, pz: 0, cx: 0, cz: 0 };
  assert.equal(firstSolidContact(map, simulation.player.x, simulation.player.z, simulation.player.radius, scratch), false);
});

test("corner contact remains stable while tangential motion slides", () => {
  const map = borderedMap(8, 8, { x: 2.2, z: 2.2 });
  for (let z = 1; z <= 5; z += 1) map.set(4, z, 1);
  map.set(5, 5, 1);
  map.set(6, 5, 1);
  const simulation = new Simulation({ map, seed: 9, particleBurstCount: 1 });
  for (let tick = 0; tick < 240; tick += 1) {
    simulation.tick({ move: { x: 6.5, z: 6.5 } });
  }
  const scratch = { nx: 0, nz: 0, penetration: 0, px: 0, pz: 0, cx: 0, cz: 0 };
  assert.equal(firstSolidContact(map, simulation.player.x, simulation.player.z, simulation.player.radius, scratch), false);
  assert.ok(Number.isFinite(simulation.player.vx) && Number.isFinite(simulation.player.vz));
});

test("swept points report deterministic axial and diagonal grid contacts", () => {
  const map = new GridMap(6, 6, undefined, { x: 1.5, z: 1.5 });
  const hit = { x: 0, z: 0, time: 0, nx: 0, nz: 0, cx: 0, cz: 0 };
  map.set(3, 1, 1);
  assert.equal(sweepPointAgainstGrid(map, 1.5, 1.5, 4.5, 1.5, hit), true);
  assert.deepEqual(
    { x: hit.x, z: hit.z, time: hit.time, nx: hit.nx, nz: hit.nz, cx: hit.cx, cz: hit.cz },
    { x: 3, z: 1.5, time: 0.5, nx: -1, nz: 0, cx: 3, cz: 1 },
  );

  map.set(3, 1, 0);
  map.set(2, 2, 1);
  assert.equal(sweepPointAgainstGrid(map, 1.5, 1.5, 3.5, 3.5, hit), true);
  assert.equal(hit.x, 2);
  assert.equal(hit.z, 2);
  assert.equal(hit.time, 0.25);
  assert.equal(hit.cx, 2);
  assert.equal(hit.cz, 2);
  assert.ok(Math.abs(hit.nx + Math.SQRT1_2) < 1e-12);
  assert.ok(Math.abs(hit.nz + Math.SQRT1_2) < 1e-12);
});

test("swept points resolve closed corners and map boundaries without skimming", () => {
  const map = new GridMap(5, 5, undefined, { x: 1.5, z: 1.5 });
  const hit = { x: 0, z: 0, time: 0, nx: 0, nz: 0, cx: 0, cz: 0 };
  map.set(2, 1, 1);
  map.set(1, 2, 1);
  assert.equal(sweepPointAgainstGrid(map, 1.5, 1.5, 3.5, 3.5, hit), true);
  assert.deepEqual({ cx: hit.cx, cz: hit.cz }, { cx: 2, cz: 1 });
  assert.ok(Math.abs(hit.nx + Math.SQRT1_2) < 1e-12);
  assert.ok(Math.abs(hit.nz + Math.SQRT1_2) < 1e-12);

  map.set(2, 1, 0);
  map.set(1, 2, 0);
  assert.equal(sweepPointAgainstGrid(map, 1.5, 1.5, -1, 1.5, hit), true);
  assert.ok(Math.abs(hit.x) < 1e-12);
  assert.ok(Math.abs(hit.time - 0.6) < 1e-12);
  assert.deepEqual(
    { z: hit.z, nx: hit.nx, nz: hit.nz, cx: hit.cx, cz: hit.cz },
    { z: 1.5, nx: 1, nz: 0, cx: -1, cz: 1 },
  );
});

test("particle spawn points correct through at most eight solid cells", () => {
  const map = new GridMap(12, 3, undefined, { x: 0.5, z: 1.5 });
  const corrected = { x: 0, z: 0, cx: 0, cz: 0, passes: 0 };
  map.set(2, 1, 1);
  assert.equal(sanitizePointAgainstGrid(map, 2.5, 1.5, -1, 0, corrected), true);
  assert.equal(corrected.passes, 1);
  assert.equal(map.get(Math.floor(corrected.x), Math.floor(corrected.z)), 0);

  for (let cx = 1; cx <= 9; cx += 1) map.set(cx, 1, 1);
  assert.equal(sanitizePointAgainstGrid(map, 9.5, 1.5, -1, 0, corrected), false);
  assert.equal(corrected.passes, 8);
  assert.equal(map.get(corrected.cx, corrected.cz), 1);
});
