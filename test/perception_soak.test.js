import test from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import os from "node:os";

import {
  ACTOR_TEAM,
  COMBAT,
  ENEMY_AI_PROFILE_PERCEPTIVE,
  ENEMY_WIZARD,
  PERCEPTIVE_WIZARD,
  PROJECTILE_OWNER_KIND,
} from "../src/config.js";
import {
  FIREBALL_SPELL_CODE,
  FIREBALL_SPELL_ID,
} from "../src/spells/fireball_definition.js";
import { GridMap } from "../src/sim/grid_map.js";
import {
  KNOWLEDGE_SOURCE,
  PERCEPTION_STATE,
  TARGET_KIND,
} from "../src/sim/perceptive_wizard.js";
import { ArenaScenario } from "../src/sim/scenario.js";
import { Simulation } from "../src/sim/simulation.js";
import {
  configurePerceptionStressFixture,
  createPerceptionStressSimulation,
  PERCEPTION_STRESS_CASTERS,
  PERCEPTION_STRESS_MOBS,
  spawnStressProjectile,
} from "./support/perception_stress_fixture.js";

function percentile(values, fraction) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * fraction) - 1] ?? 0;
}

test("7,200-tick perceptive 50-mob soak stays bounded through mixed hunting and combat pressure", () => {
  const simulation = createPerceptionStressSimulation();
  const totalTicks = 7_200;
  const warmupTicks = 120;
  const samples = new Float64Array(totalTicks);
  let heapBefore = 0;
  let effectId = 1;
  let damageAlerts = 0;
  let dodgeTicks = 0;
  let retreatTicks = 0;
  let deaths = 0;
  let restarts = 0;
  let mapEdits = 0;
  let maximumExpansions = 0;
  let maximumProjectiles = 0;
  const perceptionStateTicks = new Uint32Array(6);

  for (let ordinal = 0; ordinal < totalTicks; ordinal += 1) {
    if (simulation.enemies.activeCount < PERCEPTION_STRESS_MOBS) {
      configurePerceptionStressFixture(simulation);
    }
    simulation.player.maximumHealth = 10_000;
    simulation.player.health = 10_000;
    simulation.player.x = 12.5;
    simulation.player.z = 24.5;
    simulation.player.previousX = 12.5;
    simulation.player.previousZ = 24.5;
    simulation.player.vx = 0;
    simulation.player.vz = 0;
    simulation.player.desiredVx = 0;
    simulation.player.desiredVz = 0;
    simulation.player.locomotionVx = 0;
    simulation.player.locomotionVz = 0;
    simulation.player.externalVx = 0;
    simulation.player.externalVz = 0;
    const phase = ordinal % 600;
    for (let index = 0; index < 3; index += 1) {
      if (phase < 120) simulation.enemies.health[index] = 30;
      else if (phase === 120) simulation.enemies.health[index] = 60;
    }

    const restart = ordinal === 2_399 || ordinal === 4_799;
    let deathId = 0;
    let alertId = 0;
    let dodgeId = 0;
    if (!restart && ordinal > 0 && ordinal % 900 === 450) {
      const victimIndex = simulation.enemies.activeCount - 1;
      deathId = simulation.enemies.id[victimIndex];
      assert.ok(spawnStressProjectile(simulation, victimIndex, effectId, { lethal: true }) > 0);
      effectId += 1;
    } else if (!restart && ordinal % 240 === 120) {
      const victimIndex = Math.min(45, simulation.enemies.activeCount - 1);
      simulation.enemies.health[victimIndex] = COMBAT.maximumHealth;
      alertId = simulation.enemies.id[victimIndex];
      assert.ok(spawnStressProjectile(simulation, victimIndex, effectId) > 0);
      effectId += 1;
    }
    if (!restart && ordinal % 150 === 30) {
      dodgeId = simulation.enemies.id[5];
      assert.ok(spawnStressProjectile(simulation, 5, effectId, { visibleThreat: true }) > 0);
      effectId += 1;
    }

    const actions = [];
    if (restart) actions.push({ type: "reset", seed: simulation.seed });
    else if (ordinal > 0 && ordinal % 360 === 0) {
      actions.push({
        type: "setTile",
        cx: 42,
        cz: 2,
        tile: simulation.map.get(42, 2) === 1 ? 0 : 1,
      });
    }
    const revisionBefore = simulation.mapRevision;
    const started = performance.now();
    simulation.tick(actions.length > 0 ? { actions } : null);
    samples[ordinal] = performance.now() - started;
    if (ordinal === warmupTicks) heapBefore = process.memoryUsage().heapUsed;
    if (simulation.mapRevision !== revisionBefore) mapEdits += 1;
    if (restart) {
      restarts += 1;
      assert.equal(simulation.tickCount, 1);
      configurePerceptionStressFixture(simulation);
    }
    if (deathId > 0 && simulation.enemies.findIndexById(deathId) < 0) deaths += 1;
    if (alertId > 0) {
      const index = simulation.enemies.findIndexById(alertId);
      if (index >= 0 && simulation.enemies.knowledgeSource[index] === KNOWLEDGE_SOURCE.damage) {
        damageAlerts += 1;
      }
    }
    if (dodgeId > 0) {
      const index = simulation.enemies.findIndexById(dodgeId);
      if (index >= 0 && simulation.enemies.dodgeTicksRemaining[index] > 0) dodgeTicks += 1;
    }
    for (let index = 0; index < simulation.enemies.activeCount; index += 1) {
      perceptionStateTicks[simulation.enemies.perceptionState[index]] += 1;
      if (simulation.enemies.retreating[index]) retreatTicks += 1;
    }
    maximumExpansions = Math.max(
      maximumExpansions,
      simulation.destinationFields.expansionsThisTick,
    );
    maximumProjectiles = Math.max(maximumProjectiles, simulation.projectiles.activeCount);
    assert.ok(simulation.enemies.activeCount <= PERCEPTION_STRESS_MOBS);
    assert.ok(simulation.projectiles.activeCount <= simulation.projectiles.capacity);
  }

  const measured = Array.from(samples.slice(warmupTicks));
  const p99 = percentile(measured, 0.99);
  const heapAfter = process.memoryUsage().heapUsed;
  const snapshot = simulation.snapshot();
  assert.equal(simulation.enemyAiProfile, ENEMY_AI_PROFILE_PERCEPTIVE);
  assert.equal(simulation.enemies.capacity, ENEMY_WIZARD.capacity);
  assert.equal(simulation.encounterMaximumAlive, ENEMY_WIZARD.encounterMaximumAlive);
  assert.ok(perceptionStateTicks[PERCEPTION_STATE.engaged] > 0);
  assert.ok(perceptionStateTicks[PERCEPTION_STATE.hunting] > 0);
  assert.ok(perceptionStateTicks[PERCEPTION_STATE.returning] > 0);
  assert.ok(perceptionStateTicks[PERCEPTION_STATE.unaware] > 0);
  assert.ok(damageAlerts > 0);
  assert.ok(dodgeTicks > 0);
  assert.ok(retreatTicks > 0);
  assert.ok(deaths >= 7);
  assert.equal(restarts, 2);
  assert.ok(mapEdits >= 17);
  assert.ok(maximumProjectiles > 0);
  assert.ok(maximumExpansions <= PERCEPTIVE_WIZARD.navigationExpansionsPerTick);
  assert.ok(
    snapshot.recentPerceptionEvents.length
      <= PERCEPTIVE_WIZARD.perceptionSnapshotEventCount,
  );
  assert.ok(
    snapshot.perceptionEventMetrics.retained
      <= PERCEPTIVE_WIZARD.perceptionEventCapacity,
  );
  assert.ok(p99 < 8, `perception simulation p99 ${p99.toFixed(3)} ms exceeded 8 ms`);
  assert.ok(heapAfter - heapBefore < 64 * 2 ** 20, "perception stress exceeded 64 MiB");
  console.log(JSON.stringify({
    hardware: `${os.cpus()[0]?.model ?? "unknown CPU"} (${os.cpus().length} logical)`,
    node: process.version,
    ticksMeasured: measured.length,
    livingMobs: simulation.enemies.activeCount,
    representativeCasters: PERCEPTION_STRESS_CASTERS,
    damageAlerts,
    dodgeTicks,
    retreatTicks,
    deaths,
    restarts,
    mapEdits,
    maximumProjectiles,
    maximumNavigationExpansions: maximumExpansions,
    simP99Ms: Number(p99.toFixed(3)),
    heapDeltaMiB: Number(((heapAfter - heapBefore) / 2 ** 20).toFixed(2)),
  }));
});

function openCasterSimulation() {
  const map = new GridMap(96, 96, undefined, { x: 48.5, z: 48.5 });
  for (let cell = 0; cell < 96; cell += 1) {
    map.set(cell, 0, 1);
    map.set(cell, 95, 1);
    map.set(0, cell, 1);
    map.set(95, cell, 1);
  }
  const simulation = new Simulation({
    scenario: new ArenaScenario(map),
    seed: 0x0800_50ca,
    enemyAiProfile: ENEMY_AI_PROFILE_PERCEPTIVE,
    particleBurstCount: 0,
  });
  for (let index = 0; index < 50; index += 1) {
    const innerCount = 22;
    const inner = index < innerCount;
    const ordinal = inner ? index : index - innerCount;
    const count = inner ? innerCount : 28;
    const radius = inner ? 7.5 : 10;
    const angle = ordinal * Math.PI * 2 / count;
    const x = 48.5 + Math.cos(angle) * radius;
    const z = 48.5 + Math.sin(angle) * radius;
    assert.ok(simulation.enemies.spawn({
      spawnSequence: index + 1,
      spawnTick: 0,
      x,
      z,
      radius: ENEMY_WIZARD.radius,
      massKg: ENEMY_WIZARD.massKg,
      maximumHealth: COMBAT.maximumHealth,
      shotReadyTick: 1,
      facingX: (48.5 - x) / radius,
      facingZ: (48.5 - z) / radius,
      guardX: x,
      guardZ: z,
      guardBaseFacingX: (48.5 - x) / radius,
      guardBaseFacingZ: (48.5 - z) / radius,
      perceptionLane: (index + 1) % PERCEPTIVE_WIZARD.perceptionLanes,
    }) > 0);
  }
  return simulation;
}

function forceCasterState(simulation, castTick) {
  const pool = simulation.enemies;
  simulation.player.x = 48.5;
  simulation.player.z = castTick ? 48.5 : 84.5;
  simulation.player.previousX = simulation.player.x;
  simulation.player.previousZ = simulation.player.z;
  simulation.player.vx = 0;
  simulation.player.vz = 0;
  simulation.player.desiredVx = 0;
  simulation.player.desiredVz = 0;
  simulation.player.locomotionVx = 0;
  simulation.player.locomotionVz = 0;
  simulation.player.externalVx = 0;
  simulation.player.externalVz = 0;
  simulation.player.maximumHealth = 10_000;
  simulation.player.health = 10_000;
  for (let index = 0; index < pool.activeCount; index += 1) {
    const innerCount = 22;
    const inner = index < innerCount;
    const ordinal = inner ? index : index - innerCount;
    const count = inner ? innerCount : 28;
    const radius = inner ? 7.5 : 10;
    const angle = ordinal * Math.PI * 2 / count;
    pool.x[index] = 48.5 + Math.cos(angle) * radius;
    pool.z[index] = 48.5 + Math.sin(angle) * radius;
    pool.previousX[index] = pool.x[index];
    pool.previousZ[index] = pool.z[index];
    pool.vx[index] = 0;
    pool.vz[index] = 0;
    pool.locomotionVx[index] = 0;
    pool.locomotionVz[index] = 0;
    pool.externalVx[index] = 0;
    pool.externalVz[index] = 0;
    if (!castTick) continue;
    pool.facingX[index] = (48.5 - pool.x[index]) / radius;
    pool.facingZ[index] = (48.5 - pool.z[index]) / radius;
    pool.perceptionState[index] = PERCEPTION_STATE.engaged;
    pool.knowledgeSource[index] = KNOWLEDGE_SOURCE.visual;
    pool.currentVisibility[index] = 1;
    pool.confirmedTargetKind[index] = TARGET_KIND.player;
    pool.confirmedTargetId[index] = simulation.player.id;
    pool.confirmedTargetTeam[index] = ACTOR_TEAM.player;
    pool.hasLastSeen[index] = 1;
    pool.lastSeenX[index] = 48.5;
    pool.lastSeenZ[index] = 48.5;
    pool.lastSeenTick[index] = simulation.tickCount;
    pool.cooldown[index] = 0;
    pool.shotReadyTick[index] = simulation.tickCount + 1;
  }
}

test("50 default-lifetime casters fit the 256-projectile pool with particles disabled", () => {
  const simulation = openCasterSimulation();
  let maximumProjectiles = 0;
  const volleyCastCounts = [];
  for (let ordinal = 0; ordinal < 600; ordinal += 1) {
    const castTick = ordinal % ENEMY_WIZARD.shotIntervalTicks === 0;
    forceCasterState(simulation, castTick);
    simulation.tick(null);
    maximumProjectiles = Math.max(maximumProjectiles, simulation.projectiles.activeCount);
    if (castTick) {
      volleyCastCounts.push(Array.from(
        simulation.enemies.castSequence.slice(0, simulation.enemies.activeCount),
      ).reduce((sum, value) => sum + value, 0));
    }
  }
  const totalCasts = Array.from(
    simulation.enemies.castSequence.slice(0, simulation.enemies.activeCount),
  ).reduce((sum, value) => sum + value, 0);
  console.log(JSON.stringify({
    casterStressTick: simulation.tickCount,
    levelState: simulation.levelState,
    totalCasts,
    volleyCastCounts,
    maximumProjectiles,
    activeProjectiles: simulation.projectiles.activeCount,
    projectileDrops: simulation.projectiles.dropped,
  }));
  assert.equal(simulation.enemies.activeCount, 50);
  assert.equal(simulation.particles.activeCount, 0);
  assert.equal(simulation.particles.dropped, 0);
  assert.equal(simulation.projectiles.capacity, 256);
  assert.equal(simulation.projectiles.dropped, 0);
  assert.equal(totalCasts, 400);
  assert.ok(maximumProjectiles >= 200);
});
