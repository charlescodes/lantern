import test from "node:test";
import assert from "node:assert/strict";

import {
  ACTOR_TEAM,
  COMBAT,
  ENEMY_AI_PROFILE_TACTICAL,
  ENEMY_WIZARD,
  PROJECTILE_OWNER_KIND,
} from "../src/config.js";
import {
  FIREBALL_SPELL_CODE,
  FIREBALL_SPELL_ID,
} from "../src/spells/fireball_definition.js";
import { GridMap } from "../src/sim/grid_map.js";
import { MapCellBroadphase } from "../src/sim/map_cell_broadphase.js";
import { ArenaScenario } from "../src/sim/scenario.js";
import { Simulation } from "../src/sim/simulation.js";

function borderedMap(width = 20, height = 14, spawn = { x: 3.5, z: 6.5 }) {
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

function pool(capacity, values) {
  const x = new Float32Array(capacity);
  const z = new Float32Array(capacity);
  for (let index = 0; index < values.length; index += 1) {
    x[index] = values[index].x;
    z[index] = values[index].z;
  }
  return { activeCount: values.length, x, z };
}

test("map-cell queries deduplicate and return body-class pool order", () => {
  const map = borderedMap(12, 10);
  const enemies = pool(8, [
    { x: 5.2, z: 5.2 },
    { x: 2.5, z: 2.5 },
    { x: 5.8, z: 5.8 },
    { x: 5.1, z: 4.9 },
  ]);
  const rocks = pool(8, [
    { x: 5.4, z: 5.4 },
    { x: 8.5, z: 8.5 },
    { x: 4.9, z: 5.1 },
  ]);
  const projectiles = pool(8, [
    { x: 5.5, z: 5.5 },
    { x: 5.7, z: 5.7 },
  ]);
  const broadphase = new MapCellBroadphase(map, {
    enemyCapacity: 8,
    rockCapacity: 8,
    projectileCapacity: 8,
  });
  broadphase.rebuild(enemies, rocks, projectiles);
  let count = broadphase.queryEnemies(4, 4, 6, 6);
  assert.deepEqual(Array.from(broadphase.enemyCandidates.slice(0, count)), [0, 2, 3]);
  count = broadphase.queryEnemies(4, 4, 6, 6, 2);
  assert.deepEqual(Array.from(broadphase.enemyCandidates.slice(0, count)), [2, 3]);
  count = broadphase.queryRocks(4, 4, 6, 6);
  assert.deepEqual(Array.from(broadphase.rockCandidates.slice(0, count)), [0, 2]);
  count = broadphase.queryProjectiles(4, 4, 6, 6);
  assert.deepEqual(Array.from(broadphase.projectileCandidates.slice(0, count)), [0, 1]);
});

function comparisonSimulation(useBroadphase) {
  const map = borderedMap(24, 18, { x: 4.5, z: 8.5 });
  map.set(12, 8, 1);
  map.set(12, 9, 1);
  const scenario = new ArenaScenario(map, [
    { kind: "rock", archetype: "large", x: 8.5, z: 6.5 },
    { kind: "rock", archetype: "medium", x: 9.5, z: 10.5 },
    { kind: "rock", archetype: "small", x: 6.5, z: 8.5 },
  ]);
  const simulation = new Simulation({
    scenario,
    seed: 0xb80a_d123,
    enemyAiProfile: ENEMY_AI_PROFILE_TACTICAL,
    particleBurstCount: 0,
    useBroadphase,
  });
  for (const [index, point] of [[0, [14.5, 7.5]], [1, [15.5, 10.5]], [2, [10.5, 8.5]]]) {
    const id = simulation.enemies.spawn({
      spawnSequence: index + 1,
      spawnTick: 0,
      x: point[0],
      z: point[1],
      radius: ENEMY_WIZARD.radius,
      massKg: ENEMY_WIZARD.massKg,
      maximumHealth: COMBAT.maximumHealth,
      shotReadyTick: 0xffff_ffff,
    });
    assert.ok(id > 0);
  }
  return simulation;
}

function comparableSnapshot(simulation) {
  const snapshot = structuredClone(simulation.snapshot());
  delete snapshot.broadphase;
  return snapshot;
}

test("broadphase and brute-force oracle produce exact collision, contact, and projectile traces", () => {
  const broadphase = comparisonSimulation(true);
  const brute = comparisonSimulation(false);
  for (let tick = 0; tick < 360; tick += 1) {
    const command = {
      move: tick % 120 < 60 ? { x: 17.5, z: 11.5 } : { x: 4.5, z: 4.5 },
      cast: tick % 45 === 0 ? { x: 16.5, z: 8.5 } : null,
      actions: [],
    };
    broadphase.tick(command);
    brute.tick(command);
    assert.deepEqual(
      comparableSnapshot(broadphase),
      comparableSnapshot(brute),
      `broadphase diverged at tick ${tick + 1}`,
    );
  }
});

test("swept projectile candidates retain the historical first enemy pool hit", () => {
  const map = borderedMap();
  const simulation = new Simulation({
    scenario: new ArenaScenario(map),
    enemyAiProfile: ENEMY_AI_PROFILE_TACTICAL,
    particleBurstCount: 0,
  });
  for (let index = 0; index < 2; index += 1) {
    simulation.enemies.spawn({
      spawnSequence: index + 1,
      spawnTick: 0,
      x: 10.5 + index * 0.7,
      z: 6.5,
      radius: ENEMY_WIZARD.radius,
      massKg: ENEMY_WIZARD.massKg,
      maximumHealth: COMBAT.maximumHealth,
      shotReadyTick: 0xffff_ffff,
    });
  }
  const spell = simulation.spells.get(FIREBALL_SPELL_ID);
  const definition = spell.definitions.get(spell.currentRevision);
  simulation.projectiles.spawn({
    x: 9.8,
    z: 6.5,
    vx: 60,
    vz: 0,
    lifetime: 1,
    radius: definition.projectile.radius,
    ownerId: simulation.player.id,
    ownerKind: PROJECTILE_OWNER_KIND.player,
    ownerTeam: ACTOR_TEAM.player,
    spellCode: FIREBALL_SPELL_CODE,
    definitionRevision: spell.currentRevision,
    effectId: 10,
    effectSeed: 10,
  });
  const firstId = simulation.enemies.id[0];
  simulation.tick(null);
  const damage = simulation.snapshot().recentCombatEvents.find((event) => event.type === "damage");
  assert.equal(damage.target.id, firstId);
});
