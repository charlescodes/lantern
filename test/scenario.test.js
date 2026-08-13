import test from "node:test";
import assert from "node:assert/strict";

import { SCENARIO_VERSION } from "../src/config.js";
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

test("scenario v2 round-trips rocks while map v1 remains loadable", () => {
  const map = borderedMap(9, 8, { x: 2, z: 2 });
  const scenario = new ArenaScenario(map, [
    { kind: "rock", archetype: "small", x: 4, z: 3 },
    { kind: "rock", archetype: "medium", x: 6, z: 4 },
  ]);
  const restored = ArenaScenario.fromJSON(JSON.stringify(scenario.toJSON()));
  assert.deepEqual(restored.toJSON(), scenario.toJSON());
  assert.equal(restored.toJSON().version, SCENARIO_VERSION);

  const legacy = ArenaScenario.fromJSON(map.toJSON());
  assert.deepEqual(legacy.map.toJSON(), map.toJSON());
  assert.deepEqual(legacy.entities, []);
});

test("authored edits reject overlap and restore reconstructs original body state", () => {
  const map = borderedMap(9, 8, { x: 2, z: 2 });
  const scenario = new ArenaScenario(map, [
    { kind: "rock", archetype: "small", x: 4, z: 3 },
  ]);
  const simulation = new Simulation({ scenario, particleBurstCount: 0 });
  const rockId = simulation.rocks.id[0];

  simulation.tick({ type: "placeRock", archetype: "medium", x: 4, z: 3 });
  assert.equal(simulation.rocks.activeCount, 1);
  assert.match(simulation.lastError, /overlaps/);

  simulation.tick({ type: "placeRock", archetype: "medium", x: 6, z: 4 });
  assert.equal(simulation.rocks.activeCount, 2);
  simulation.rocks.vx[0] = 5;
  simulation.tick(null);
  assert.notEqual(simulation.rocks.x[0], 4);

  simulation.tick({ type: "restoreScenario" });
  assert.equal(simulation.rocks.activeCount, 2);
  assert.equal(simulation.rocks.id[0], rockId);
  assert.equal(simulation.rocks.x[0], 4);
  assert.equal(simulation.rocks.vx[0], 0);
  assert.equal(simulation.projectiles.activeCount, 0);
  const saved = JSON.parse(simulation.saveScenario());
  assert.equal(saved.format, "lantern-authoring-map");
  assert.equal(saved.layers[0].instances.length, 2);
});

test("wall authoring cannot place solids over active or authored bodies", () => {
  const map = borderedMap(8, 8, { x: 2.5, z: 2.5 });
  const scenario = new ArenaScenario(map, [
    { kind: "rock", archetype: "small", x: 4.5, z: 4.5 },
  ]);
  const simulation = new Simulation({ scenario, particleBurstCount: 0 });

  simulation.tick({ type: "setTile", cx: 2, cz: 2, tile: 1 });
  assert.equal(simulation.map.get(2, 2), 0);
  assert.ok(simulation.lastError);
  simulation.tick({ type: "setTile", cx: 4, cz: 4, tile: 1 });
  assert.equal(simulation.map.get(4, 4), 0);
  assert.ok(simulation.lastError);
});

test("scenario and runtime rock limits reject truncation instead of silently dropping bodies", () => {
  const map = borderedMap(12, 12, { x: 2, z: 2 });
  const entities = Array.from({ length: 65 }, (_, index) => ({
    kind: /** @type {const} */ ("rock"),
    archetype: "small",
    x: 3 + (index % 9),
    z: 3 + Math.floor(index / 9),
  }));
  assert.throws(() => new ArenaScenario(map, entities), /64-rock limit/);

  const scenario = new ArenaScenario(map, [
    { kind: "rock", archetype: "small", x: 4, z: 4 },
    { kind: "rock", archetype: "small", x: 5, z: 4 },
  ]);
  assert.throws(
    () => new Simulation({ scenario, rockCapacity: 1, particleBurstCount: 0 }),
    /more rocks than/,
  );
});
