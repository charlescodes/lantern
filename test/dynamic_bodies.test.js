import test from "node:test";
import assert from "node:assert/strict";

import { placeInstance } from "../src/authoring/authoring_commands.js";
import { ROCK_ARCHETYPES } from "../src/config.js";
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

test("sustained locomotion pushes lighter rocks farther without storing release recoil", () => {
  const displacements = [];
  for (const archetype of ["small", "medium", "large"]) {
    const map = borderedMap(24, 8, { x: 2, z: 4 });
    const scenario = new ArenaScenario(map, [
      { kind: "rock", archetype, x: 4, z: 4 },
    ]);
    const simulation = new Simulation({ scenario, particleBurstCount: 0 });
    const authoredX = simulation.rocks.x[0];
    let minimumSeparation = Infinity;
    let maximumExternalSpeed = 0;

    const sampleContact = () => {
      minimumSeparation = Math.min(
        minimumSeparation,
        Math.hypot(
          simulation.rocks.x[0] - simulation.player.x,
          simulation.rocks.z[0] - simulation.player.z,
        ) - simulation.rocks.radius[0] - simulation.player.radius,
      );
      maximumExternalSpeed = Math.max(
        maximumExternalSpeed,
        Math.hypot(simulation.player.externalVx, simulation.player.externalVz),
      );
    };

    for (let tick = 0; tick < 120; tick += 1) {
      simulation.tick({ move: { x: 20, z: 4 } });
      sampleContact();
    }
    const holdRockDisplacement = simulation.rocks.x[0] - authoredX;
    const releaseX = simulation.player.x;
    let minimumReleaseX = releaseX;
    for (let tick = 0; tick < 60; tick += 1) {
      simulation.tick(null);
      minimumReleaseX = Math.min(minimumReleaseX, simulation.player.x);
      sampleContact();
    }

    displacements.push(holdRockDisplacement);
    assert.ok(maximumExternalSpeed <= 1e-9, `${archetype} contact stored external velocity`);
    assert.ok(
      releaseX - minimumReleaseX < 0.01,
      `${archetype} contact recoiled ${releaseX - minimumReleaseX}m after release`,
    );
    assert.ok(
      minimumSeparation >= -0.003,
      `${archetype} overlap exceeded the 0.003m tolerance`,
    );
  }

  assert.ok(displacements[0] > displacements[1]);
  assert.ok(displacements[1] > displacements[2]);
});

test("the player pushes a lightweight standing torch while its authored start stays fixed", () => {
  const map = borderedMap(16, 8, { x: 2, z: 4 });
  const source = new ArenaScenario(map).toAuthoringJSON();
  const placed = placeInstance(source, "object.torch", 4, 4);
  const simulation = new Simulation({
    scenario: new ArenaScenario(placed.document),
    particleBurstCount: 0,
  });

  for (let tick = 0; tick < 120; tick += 1) {
    simulation.tick({ move: { x: 14, z: 4 } });
  }

  assert.ok(simulation.rocks.x[0] > 4.1, "the torch should be pushed along the floor");
  assert.equal(simulation.snapshot().rocks[0].kind, "torch");
  assert.equal(simulation.snapshot().rocks[0].upright, true);
  assert.equal(JSON.parse(simulation.saveMap()).layers[0].instances[0].x, 4);
});

test("the player pushes a table without pivoting or rewriting its authored transform", () => {
  const map = borderedMap(24, 8, { x: 2, z: 4.5 });
  const source = new ArenaScenario(map).toAuthoringJSON();
  const placed = placeInstance(source, "object.table", 4.5, 4.5, { rotation: 0 });
  const simulation = new Simulation({
    scenario: new ArenaScenario(placed.document),
    particleBurstCount: 0,
  });
  const initial = simulation.snapshot().rocks[0];

  for (let tick = 0; tick < 180; tick += 1) {
    simulation.tick({ move: { x: 20, z: 4.5 } });
  }

  const table = simulation.snapshot().rocks[0];
  const saved = JSON.parse(simulation.saveMap()).layers[0].instances[0];
  assert.equal(table.kind, "table");
  assert.equal(table.collider, "box");
  assert.equal(table.fixedRotation, true);
  assert.ok(table.x > initial.x + 1, "the table should slide when pushed");
  assert.equal(table.rotation, 0, "translation must not create physical rotation");
  assert.equal(Object.hasOwn(table, "angularVelocity"), false);
  assert.ok(table.massKg > ROCK_ARCHETYPES.medium.massKg);
  assert.ok(table.massKg < ROCK_ARCHETYPES.medium.massKg * 1.15);
  assert.equal(saved.id, placed.instanceId);
  assert.equal(saved.x, 4.5);
  assert.equal(saved.z, 4.5);
  assert.equal(saved.rotation, 0);

  simulation.reset();
  const resetTable = simulation.snapshot().rocks[0];
  assert.equal(resetTable.x, initial.x);
  assert.equal(resetTable.z, initial.z);
  assert.equal(resetTable.rotation, initial.rotation);
});

test("an independently moving rock still produces damped external knockback", () => {
  const map = borderedMap(16, 8, { x: 5, z: 4 });
  const scenario = new ArenaScenario(map, [
    { kind: "rock", archetype: "medium", x: 7, z: 4 },
  ]);
  const simulation = new Simulation({ scenario, particleBurstCount: 0 });
  simulation.rocks.vx[0] = -6;
  let peakKnockback = 0;

  for (let tick = 0; tick < 90; tick += 1) {
    simulation.tick(null);
    peakKnockback = Math.min(peakKnockback, simulation.player.externalVx);
  }

  assert.ok(peakKnockback < -0.1, "incoming rock should create visible external knockback");
  assert.equal(simulation.player.locomotionVx, 0);
  assert.ok(simulation.player.externalVx < 0);
  assert.ok(
    Math.abs(simulation.player.externalVx) < Math.abs(peakKnockback) * 0.5,
    "incoming-rock knockback should damp after impact",
  );
});
