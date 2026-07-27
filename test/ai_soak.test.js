import test from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import os from "node:os";

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
import { Simulation } from "../src/sim/simulation.js";

function placeEnemy(simulation, index, x, z) {
  simulation.enemies.x[index] = x;
  simulation.enemies.z[index] = z;
  simulation.enemies.previousX[index] = x;
  simulation.enemies.previousZ[index] = z;
  simulation.enemies.vx[index] = 0;
  simulation.enemies.vz[index] = 0;
  simulation.enemies.desiredVx[index] = 0;
  simulation.enemies.desiredVz[index] = 0;
  simulation.enemies.locomotionVx[index] = 0;
  simulation.enemies.locomotionVz[index] = 0;
  simulation.enemies.externalVx[index] = 0;
  simulation.enemies.externalVz[index] = 0;
  simulation.enemies.shotReadyTick[index] = 0xffff_ffff;
}

function fillEnemyPool(simulation) {
  const positions = [
    { x: 20.5, z: 17.5 },
    { x: 21.5, z: 18.5 },
    { x: 20.5, z: 19.5 },
    { x: 19.5, z: 18.5 },
  ];
  assert.equal(simulation.enemies.activeCount, 1);
  placeEnemy(simulation, 0, positions[0].x, positions[0].z);
  for (let index = 1; index < ENEMY_WIZARD.capacity; index += 1) {
    const id = simulation.enemies.spawn({
      spawnSequence: index + 1,
      spawnTick: simulation.tickCount,
      x: positions[index].x,
      z: positions[index].z,
      radius: ENEMY_WIZARD.radius,
      massKg: ENEMY_WIZARD.massKg,
      maximumHealth: COMBAT.maximumHealth,
      shotReadyTick: 0xffff_ffff,
    });
    assert.ok(id > 0);
    placeEnemy(simulation, index, positions[index].x, positions[index].z);
  }
}

function spawnThreat(simulation, enemyIndex, effectId) {
  const spell = simulation.spells.get(FIREBALL_SPELL_ID);
  const definition = spell.definitions.get(spell.currentRevision);
  return simulation.projectiles.spawn({
    x: simulation.enemies.x[enemyIndex] - 4,
    z: simulation.enemies.z[enemyIndex] + 0.60,
    vx: 9,
    vz: 0,
    lifetime: 0.65,
    radius: definition.projectile.radius,
    ownerId: simulation.player.id,
    ownerKind: PROJECTILE_OWNER_KIND.player,
    ownerTeam: ACTOR_TEAM.player,
    spellCode: FIREBALL_SPELL_CODE,
    definitionRevision: spell.currentRevision,
    effectId,
    effectSeed: effectId ^ 0xa170_0000,
  });
}

test("four tactical wizards withstand dense threats, map edits, and retreat cycles below 8 ms p99", () => {
  const simulation = new Simulation({
    seed: 0x0700_a170,
    particleBurstCount: 0,
  });
  simulation.tick(null);
  fillEnemyPool(simulation);
  assert.equal(simulation.enemyAiProfile, ENEMY_AI_PROFILE_TACTICAL);

  const totalTicks = 3_600;
  const samples = new Float64Array(totalTicks);
  const heapBefore = process.memoryUsage().heapUsed;
  let effectId = 1;
  let threatSpawns = 0;
  let retreatTicks = 0;
  let engagementTicks = 0;
  let maximumProjectiles = 0;
  let maximumNavigationExpansions = 0;
  let mapEdits = 0;

  for (let tick = 0; tick < totalTicks; tick += 1) {
    const phase = tick % 600;
    for (let index = 0; index < simulation.enemies.activeCount; index += 1) {
      simulation.enemies.health[index] = phase < 180 ? 30 : phase === 180 ? 60 : 100;
      simulation.enemies.shotReadyTick[index] = 0xffff_ffff;
    }
    if (tick % 12 === 0) {
      for (let index = 0; index < simulation.enemies.activeCount; index += 1) {
        if (spawnThreat(simulation, index, effectId) !== 0) threatSpawns += 1;
        effectId += 1;
      }
    }
    const toggleMap = tick > 0 && tick % 300 === 0;
    const command = {
      move: tick % 480 < 240 ? { x: 12.5, z: 12.5 } : { x: 3.5, z: 18.5 },
      cast: null,
      actions: toggleMap
        ? [{
          type: "setTile",
          cx: 2,
          cz: 2,
          tile: simulation.map.get(2, 2) === 1 ? 0 : 1,
        }]
        : [],
    };
    const revisionBefore = simulation.mapRevision;
    const started = performance.now();
    simulation.tick(command);
    samples[tick] = performance.now() - started;
    if (simulation.mapRevision !== revisionBefore) mapEdits += 1;
    maximumProjectiles = Math.max(maximumProjectiles, simulation.projectiles.activeCount);
    maximumNavigationExpansions = Math.max(
      maximumNavigationExpansions,
      simulation.navigationField.expansionsThisTick,
    );
    assert.equal(simulation.enemies.activeCount, ENEMY_WIZARD.capacity);
    assert.ok(simulation.projectiles.activeCount <= simulation.projectiles.capacity);
    for (let index = 0; index < simulation.enemies.activeCount; index += 1) {
      if (simulation.enemies.retreating[index]) retreatTicks += 1;
      else engagementTicks += 1;
    }
  }

  const sorted = Array.from(samples.slice(24)).sort((left, right) => left - right);
  const p99 = sorted[Math.ceil(sorted.length * 0.99) - 1];
  const heapAfter = process.memoryUsage().heapUsed;
  assert.ok(threatSpawns >= 1_000);
  assert.ok(maximumProjectiles >= 8);
  assert.ok(retreatTicks > 0);
  assert.ok(engagementTicks > 0);
  assert.equal(mapEdits, 11);
  assert.ok(maximumNavigationExpansions <= 2_048);
  assert.ok(p99 < 8, `tactical simulation p99 ${p99.toFixed(3)} ms exceeded 8 ms`);
  assert.ok(heapAfter - heapBefore < 64 * 2 ** 20, "tactical stress exceeded 64 MiB");
  assert.doesNotThrow(() => JSON.stringify(simulation.enemyDiagnostics()));
  console.log(JSON.stringify({
    hardware: `${os.cpus()[0]?.model ?? "unknown CPU"} (${os.cpus().length} logical)`,
    node: process.version,
    ticksMeasured: sorted.length,
    tacticalEnemies: simulation.enemies.activeCount,
    threatSpawns,
    maximumProjectiles,
    mapEdits,
    maximumNavigationExpansions,
    simP99Ms: Number(p99.toFixed(3)),
    heapDeltaMiB: Number(((heapAfter - heapBefore) / 2 ** 20).toFixed(2)),
  }));
});
