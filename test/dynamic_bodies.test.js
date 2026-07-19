import test from "node:test";
import assert from "node:assert/strict";

import { firstSolidContact } from "../src/sim/collision.js";
import { GridMap } from "../src/sim/grid_map.js";
import { ArenaScenario } from "../src/sim/scenario.js";
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

test("fast rocks remain outside wall cells and reflect with bounded speed", () => {
  const map = borderedMap(8, 8, { x: 4, z: 4 });
  const scenario = new ArenaScenario(map, [
    { kind: "rock", archetype: "small", x: 1.2, z: 2 },
  ]);
  const simulation = new Simulation({ scenario, particleBurstCount: 0 });
  simulation.rocks.vx[0] = -20;

  simulation.tick(null);

  const scratch = { nx: 0, nz: 0, penetration: 0, px: 0, pz: 0, cx: 0, cz: 0 };
  assert.equal(
    firstSolidContact(
      simulation.map,
      simulation.rocks.x[0],
      simulation.rocks.z[0],
      simulation.rocks.radius[0],
      scratch,
    ),
    false,
  );
  assert.ok(simulation.rocks.vx[0] >= 0);
  assert.ok(Math.hypot(simulation.rocks.vx[0], simulation.rocks.vz[0]) <= 20);
});

test("rock-rock collision transfers momentum and resolves overlap", () => {
  const map = borderedMap(9, 7, { x: 2, z: 5 });
  const scenario = new ArenaScenario(map, [
    { kind: "rock", archetype: "small", x: 3, z: 3 },
    { kind: "rock", archetype: "small", x: 3.24, z: 3 },
  ]);
  const simulation = new Simulation({ scenario, particleBurstCount: 0 });
  simulation.rocks.vx[0] = 8;

  simulation.tick(null);

  const distance = Math.hypot(
    simulation.rocks.x[1] - simulation.rocks.x[0],
    simulation.rocks.z[1] - simulation.rocks.z[0],
  );
  assert.ok(simulation.rocks.vx[1] > 0, "the struck rock should gain forward velocity");
  assert.ok(distance >= simulation.rocks.radius[0] + simulation.rocks.radius[1] - 0.002);
  assert.ok(simulation.snapshot().contacts.some((contact) => contact.type === "body"));
});

test("player and rock stay separated while locomotion pushes the rock", () => {
  const map = borderedMap(10, 7, { x: 2, z: 3.5 });
  const scenario = new ArenaScenario(map, [
    { kind: "rock", archetype: "medium", x: 4, z: 3.5 },
  ]);
  const simulation = new Simulation({ scenario, particleBurstCount: 0 });
  const authoredX = simulation.rocks.x[0];
  for (let tick = 0; tick < 120; tick += 1) {
    simulation.tick({ move: { x: 8, z: 3.5 } });
  }

  const distance = Math.hypot(
    simulation.rocks.x[0] - simulation.player.x,
    simulation.rocks.z[0] - simulation.player.z,
  );
  assert.ok(distance >= simulation.rocks.radius[0] + simulation.player.radius - 0.003);
  assert.ok(simulation.rocks.x[0] > authoredX);
});
