import test from "node:test";
import assert from "node:assert/strict";

import { GridMap } from "../src/sim/grid_map.js";
import { Simulation } from "../src/sim/simulation.js";

test("a high-speed projectile cannot tunnel through a one-cell wall", () => {
  const map = new GridMap(8, 5, undefined, { x: 1.5, z: 1.5 });
  map.set(3, 2, 1);
  const simulation = new Simulation({ map, seed: 5, particleBurstCount: 4 });
  const id = simulation.projectiles.spawn({
    x: 1.5,
    z: 2.5,
    vx: 240,
    vz: 0,
    lifetime: 2,
    radius: 0.12,
  });
  simulation.tick(null);
  assert.ok(id > 0);
  assert.equal(simulation.projectiles.activeCount, 0);
  assert.equal(simulation.impactEvents.length, 1);
  const [impact] = simulation.impactEvents.toArray();
  assert.equal(impact.projectileId, id);
  assert.equal(impact.cell.cx, 3);
  assert.ok(impact.x < 3.1);
  assert.equal(simulation.particles.activeCount, 4);
});

test("projectile capacity rejects excess spawns and exposes a dropped count", () => {
  const simulation = new Simulation({ projectileCapacity: 1, particleBurstCount: 1 });
  const spawn = { x: 2, z: 2, vx: 1, vz: 0, lifetime: 2, radius: 0.12 };
  assert.ok(simulation.projectiles.spawn(spawn) > 0);
  assert.equal(simulation.projectiles.spawn(spawn), 0);
  assert.equal(simulation.projectiles.activeCount, 1);
  assert.equal(simulation.projectiles.dropped, 1);
});
