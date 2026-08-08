import test from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import os from "node:os";

import {
  ACTOR_TEAM,
  COMBAT,
  ENEMY_AI_PROFILE_INVESTIGATIVE,
  ENEMY_WIZARD,
  MOVEMENT_SOUND,
  PROJECTILE,
  PROJECTILE_OWNER_KIND,
} from "../src/config.js";
import {
  FIREBALL_SPELL_CODE,
  FIREBALL_SPELL_ID,
} from "../src/spells/fireball_definition.js";
import { GridMap } from "../src/sim/grid_map.js";
import { ArenaScenario } from "../src/sim/scenario.js";
import { Simulation } from "../src/sim/simulation.js";

const MOB_COUNT = 50;

function soundStressMap() {
  const map = new GridMap(96, 96, undefined, { x: 44.5, z: 48.5 });
  for (let cell = 0; cell < 96; cell += 1) {
    map.set(cell, 0, 1);
    map.set(cell, 95, 1);
    map.set(0, cell, 1);
    map.set(95, cell, 1);
  }
  for (let z = 1; z < 95; z += 1) {
    map.set(40, z, 1);
    map.set(48, z, 1);
  }
  return map;
}

function mobPosition(index) {
  return {
    x: 50.5 + (index % 5),
    z: 30.5 + Math.floor(index / 5) * 4,
  };
}

function spawnMobs(simulation) {
  for (let index = 0; index < MOB_COUNT; index += 1) {
    const position = mobPosition(index);
    assert.ok(simulation.enemies.spawn({
      spawnSequence: index + 1,
      spawnTick: 0,
      x: position.x,
      z: position.z,
      radius: ENEMY_WIZARD.radius,
      massKg: ENEMY_WIZARD.massKg,
      maximumHealth: COMBAT.maximumHealth,
      shotReadyTick: 0xffff_ffff,
      facingX: 1,
      facingZ: 0,
      guardX: position.x,
      guardZ: position.z,
      guardBaseFacingX: 1,
      guardBaseFacingZ: 0,
      perceptionLane: (index + 1) % 5,
      guardSweepPhase: 0,
    }) > 0);
  }
}

function restoreMobLattice(simulation) {
  const pool = simulation.enemies;
  for (let index = 0; index < MOB_COUNT; index += 1) {
    const position = mobPosition(index);
    pool.x[index] = position.x;
    pool.z[index] = position.z;
    pool.previousX[index] = position.x;
    pool.previousZ[index] = position.z;
    pool.vx[index] = 0;
    pool.vz[index] = 0;
    pool.locomotionVx[index] = 0;
    pool.locomotionVz[index] = 0;
    pool.externalVx[index] = 0;
    pool.externalVz[index] = 0;
    pool.health[index] = COMBAT.maximumHealth;
    pool.shotReadyTick[index] = 0xffff_ffff;
  }
}

function spawnWallImpact(simulation, effectId) {
  const spell = simulation.spells.get(FIREBALL_SPELL_ID);
  const definition = spell.definitions.get(spell.currentRevision);
  return simulation.projectiles.spawn({
    x: 41.25,
    z: simulation.player.z,
    vx: -20,
    vz: 0,
    lifetime: definition.projectile.lifetime,
    radius: definition.projectile.radius,
    ownerId: simulation.player.id,
    ownerKind: PROJECTILE_OWNER_KIND.player,
    ownerTeam: ACTOR_TEAM.player,
    spellCode: FIREBALL_SPELL_CODE,
    definitionRevision: spell.currentRevision,
    effectId,
    effectSeed: effectId ^ 0x5011_d000,
  });
}

test("7,200-tick movement-sound soak keeps 50 listeners and both sound sources bounded", () => {
  const simulation = new Simulation({
    scenario: new ArenaScenario(soundStressMap()),
    seed: 0x1100_50ad,
    enemyAiProfile: ENEMY_AI_PROFILE_INVESTIGATIVE,
    particleBurstCount: 0,
  });
  spawnMobs(simulation);
  assert.equal(simulation.soundEvents.capacity, PROJECTILE.capacity + 1);

  const totalTicks = 7_200;
  const warmupTicks = 120;
  const samples = new Float64Array(totalTicks);
  let heapBefore = 0;
  let effectId = 1;
  let wallImpacts = 0;
  let maximumQueueOccupancy = 0;

  for (let ordinal = 0; ordinal < totalTicks; ordinal += 1) {
    restoreMobLattice(simulation);
    if (ordinal % 60 === 0) {
      assert.ok(spawnWallImpact(simulation, effectId) > 0);
      effectId += 1;
      wallImpacts += 1;
    }
    const targetZ = ordinal % 360 < 180 ? 68.5 : 28.5;
    const started = performance.now();
    simulation.tick({ move: { x: 46.5, z: targetZ } });
    samples[ordinal] = performance.now() - started;
    if (ordinal === warmupTicks) heapBefore = process.memoryUsage().heapUsed;
    maximumQueueOccupancy = Math.max(
      maximumQueueOccupancy,
      simulation.soundEvents.activeCount,
    );
    assert.equal(simulation.enemies.activeCount, MOB_COUNT);
    assert.ok(simulation.soundEvents.activeCount <= simulation.soundEvents.capacity);
    assert.ok(simulation.projectiles.activeCount <= simulation.projectiles.capacity);
  }

  const measured = Array.from(samples.slice(warmupTicks));
  measured.sort((left, right) => left - right);
  const p99 = measured[Math.ceil(measured.length * 0.99) - 1];
  const heapAfter = process.memoryUsage().heapUsed;
  const snapshot = simulation.snapshot();
  assert.equal(wallImpacts, 120);
  assert.equal(simulation.soundEventMetrics.emittedFireballImpacts, wallImpacts);
  assert.ok(simulation.soundEventMetrics.emittedFootsteps > 250);
  assert.ok(simulation.soundEventMetrics.heardFootsteps > 0);
  assert.ok(simulation.soundEventMetrics.heardFireballImpacts > 0);
  assert.ok(simulation.soundEventMetrics.listenerChecks > 0);
  assert.ok(simulation.investigationEventMetrics.heardFootsteps > 0);
  assert.ok(simulation.investigationEventMetrics.heardExplosions > 0);
  assert.ok(simulation.investigationEventMetrics.acceptedRedirects > 0);
  assert.equal(simulation.soundEvents.dropped, 0);
  assert.ok(maximumQueueOccupancy > 0);
  assert.ok(simulation.soundEvents.maximumEventsPerTick <= 2);
  assert.equal(snapshot.soundEventMetrics.retained, MOVEMENT_SOUND.historyCapacity);
  assert.ok(snapshot.soundEventMetrics.historyDropped > 0);
  assert.ok(snapshot.soundEvents.recent.length <= MOVEMENT_SOUND.snapshotEventCount);
  assert.ok(p99 < 8, `movement-sound simulation p99 ${p99.toFixed(3)} ms exceeded 8 ms`);
  assert.ok(heapAfter - heapBefore < 64 * 2 ** 20, "movement-sound stress exceeded 64 MiB");
  assert.doesNotThrow(() => JSON.stringify(snapshot));
  console.log(JSON.stringify({
    hardware: `${os.cpus()[0]?.model ?? "unknown CPU"} (${os.cpus().length} logical)`,
    node: process.version,
    ticksMeasured: measured.length,
    listeners: MOB_COUNT,
    emittedFootsteps: simulation.soundEventMetrics.emittedFootsteps,
    emittedFireballImpacts: simulation.soundEventMetrics.emittedFireballImpacts,
    heardFootsteps: simulation.soundEventMetrics.heardFootsteps,
    heardFireballImpacts: simulation.soundEventMetrics.heardFireballImpacts,
    maximumQueueOccupancy,
    queueCapacity: simulation.soundEvents.capacity,
    simP99Ms: Number(p99.toFixed(3)),
    heapDeltaMiB: Number(((heapAfter - heapBefore) / 2 ** 20).toFixed(2)),
  }));
});
