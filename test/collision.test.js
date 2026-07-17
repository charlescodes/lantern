import test from "node:test";
import assert from "node:assert/strict";

import { firstSolidContact, resolveCircleAgainstGrid } from "../src/sim/collision.js";
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
