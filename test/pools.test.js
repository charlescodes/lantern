import test from "node:test";
import assert from "node:assert/strict";

import { ParticlePool, ProjectilePool, RockPool } from "../src/sim/pools.js";

test("projectile swap-and-pop copies every component, including stable ID", () => {
  const pool = new ProjectilePool(3);
  pool.spawn({ x: 1, z: 2, vx: 3, vz: 4, lifetime: 5, radius: 0.1 });
  pool.spawn({ x: 10, z: 20, vx: 30, vz: 40, lifetime: 50, radius: 0.2 });
  const lastId = pool.spawn({
    x: 100,
    z: 200,
    vx: 300,
    vz: 400,
    lifetime: 500,
    radius: 0.3,
    ownerId: 77,
  });
  pool.previousX[2] = 91;
  pool.previousZ[2] = 92;
  pool.age[2] = 93;
  pool.removeSwap(0);
  assert.equal(pool.activeCount, 2);
  assert.deepEqual(
    {
      id: pool.id[0], x: pool.x[0], z: pool.z[0], previousX: pool.previousX[0], previousZ: pool.previousZ[0],
      vx: pool.vx[0], vz: pool.vz[0], age: pool.age[0], lifetime: pool.lifetime[0], radius: pool.radius[0],
      ownerId: pool.ownerId[0],
    },
    {
      id: lastId,
      x: 100,
      z: 200,
      previousX: 91,
      previousZ: 92,
      vx: 300,
      vz: 400,
      age: 93,
      lifetime: 500,
      radius: Math.fround(0.3),
      ownerId: 77,
    },
  );
});

test("particle swap-and-pop copies every component and flags", () => {
  const pool = new ParticlePool(2);
  pool.spawn({ x: 1, y: 2, z: 3, vx: 4, vy: 5, vz: 6, lifetime: 7, size: 0.1 });
  const lastId = pool.spawn({ x: 10, y: 20, z: 30, vx: 40, vy: 50, vz: 60, lifetime: 70, size: 0.25 });
  pool.age[1] = 12;
  pool.bounced[1] = 1;
  pool.removeSwap(0);
  assert.equal(pool.activeCount, 1);
  assert.deepEqual(
    {
      id: pool.id[0], x: pool.x[0], y: pool.y[0], z: pool.z[0], vx: pool.vx[0], vy: pool.vy[0],
      vz: pool.vz[0], age: pool.age[0], lifetime: pool.lifetime[0], size: pool.size[0], bounced: pool.bounced[0],
    },
    { id: lastId, x: 10, y: 20, z: 30, vx: 40, vy: 50, vz: 60, age: 12, lifetime: 70, size: 0.25, bounced: 1 },
  );
});

test("rock swap-and-pop copies authored identity, mass, and velocity", () => {
  const pool = new RockPool(2);
  pool.spawn({ spawnId: 4, archetype: 1, x: 1, z: 2, radius: 0.1, massKg: 11 });
  const lastId = pool.spawn({
    spawnId: 8,
    archetype: 3,
    x: 5,
    z: 6,
    radius: 0.9,
    massKg: 7_940,
  });
  pool.vx[1] = 7;
  pool.vz[1] = 8;
  pool.removeSwap(0);
  assert.deepEqual(
    {
      id: pool.id[0],
      spawnId: pool.spawnId[0],
      archetype: pool.archetype[0],
      x: pool.x[0],
      z: pool.z[0],
      vx: pool.vx[0],
      vz: pool.vz[0],
      radius: pool.radius[0],
      massKg: pool.massKg[0],
    },
    {
      id: lastId,
      spawnId: 8,
      archetype: 3,
      x: 5,
      z: 6,
      vx: 7,
      vz: 8,
      radius: Math.fround(0.9),
      massKg: 7_940,
    },
  );
});

test("pool counts remain within their declared bounds", () => {
  const pool = new ParticlePool(4);
  const value = { x: 0, y: 1, z: 0, vx: 0, vy: 0, vz: 0, lifetime: 1, size: 0.1 };
  for (let index = 0; index < 20; index += 1) pool.spawn(value);
  assert.ok(pool.activeCount >= 0 && pool.activeCount <= pool.capacity);
  while (pool.activeCount > 0) pool.removeSwap(0);
  assert.ok(pool.activeCount >= 0 && pool.activeCount <= pool.capacity);
});
