import test from "node:test";
import assert from "node:assert/strict";

import { EXPLOSION, ROCK_ARCHETYPES } from "../src/config.js";
import { computeExplosionResponse } from "../src/sim/explosion.js";
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

test("physical rock masses produce lower acceleration for larger archetypes", () => {
  const small = ROCK_ARCHETYPES.small;
  const large = ROCK_ARCHETYPES.large;
  const smallResponse = computeExplosionResponse({
    originX: 0,
    originZ: 0,
    bodyX: 1,
    bodyZ: 0,
    bodyRadius: small.radius,
    massKg: small.massKg,
    blastRadius: EXPLOSION.radius,
    pressureImpulse: EXPLOSION.pressureImpulse,
    fallbackNx: 1,
    fallbackNz: 0,
  });
  const largeResponse = computeExplosionResponse({
    originX: 0,
    originZ: 0,
    bodyX: 1,
    bodyZ: 0,
    bodyRadius: large.radius,
    massKg: large.massKg,
    blastRadius: EXPLOSION.radius,
    pressureImpulse: EXPLOSION.pressureImpulse,
    fallbackNx: 1,
    fallbackNz: 0,
  });

  assert.ok(smallResponse);
  assert.ok(largeResponse);
  assert.ok(smallResponse.deltaVx > largeResponse.deltaVx);
  assert.ok(small.massKg > 10 && small.massKg < 12);
  assert.ok(large.massKg > 7_900 && large.massKg < 8_000);
});

test("a projectile explodes on a rock and applies blast rules to rock and owner", () => {
  const map = borderedMap(10, 8, { x: 2.2, z: 4 });
  const scenario = new ArenaScenario(map, [
    { kind: "rock", archetype: "small", x: 5, z: 4 },
  ]);
  const simulation = new Simulation({ scenario, particleBurstCount: 0 });
  simulation.projectiles.spawn({
    x: 4,
    z: 4,
    vx: 120,
    vz: 0,
    lifetime: 2,
    radius: 0.12,
    ownerId: simulation.player.id,
  });

  simulation.tick(null);

  assert.equal(simulation.projectiles.activeCount, 0);
  assert.equal(simulation.impactEvents.length, 1);
  const [event] = simulation.impactEvents.toArray();
  assert.equal(event.type, "explosion");
  assert.equal(event.hit.kind, "rock");
  assert.equal(event.hit.id, simulation.rocks.id[0]);
  assert.ok(simulation.rocks.vx[0] > 0);
  assert.ok(simulation.player.externalVx < 0, "the projectile owner should receive self-knockback");
  assert.ok(event.responses.some((response) => response.kind === "player" && !response.blocked));
  assert.ok(event.responses.some((response) => response.kind === "rock" && !response.blocked));
});

test("solid cells block blast impulse without shielding the origin side", () => {
  const map = borderedMap(11, 8, { x: 3, z: 4 });
  map.set(5, 4, 1);
  const scenario = new ArenaScenario(map, [
    { kind: "rock", archetype: "small", x: 7, z: 4 },
  ]);
  const simulation = new Simulation({ scenario, particleBurstCount: 0 });
  simulation.projectiles.spawn({
    x: 4,
    z: 4,
    vx: 120,
    vz: 0,
    lifetime: 2,
    radius: 0.12,
    ownerId: simulation.player.id,
  });

  simulation.tick(null);

  const [event] = simulation.impactEvents.toArray();
  const playerResponse = event.responses.find((response) => response.kind === "player");
  const rockResponse = event.responses.find((response) => response.kind === "rock");
  assert.equal(event.hit.kind, "cell");
  assert.ok(playerResponse && !playerResponse.blocked);
  assert.ok(rockResponse && rockResponse.blocked);
  assert.ok(simulation.player.externalVx < 0);
  assert.equal(simulation.rocks.vx[0], 0);
  assert.equal(rockResponse.impulse, 0);
  assert.ok(rockResponse.potentialImpulse > 0);
});
