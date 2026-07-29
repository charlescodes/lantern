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
  cloneFireballDefinition,
  DEFAULT_FIREBALL_DEFINITION,
  FIREBALL_SPELL_CODE,
  FIREBALL_SPELL_ID,
} from "../src/spells/fireball_definition.js";
import { Simulation } from "../src/sim/simulation.js";

function maximumStressDefinition() {
  const definition = cloneFireballDefinition(DEFAULT_FIREBALL_DEFINITION);
  definition.cast.cooldown = 0;
  definition.projectile.speed = 40;
  definition.projectile.radius = 1;
  definition.projectile.lifetime = 20;
  definition.projectile.spawnGap = 1;
  definition.impact.blastRadius = 12;
  definition.impact.pressureImpulse = 5_000;
  definition.impact.visualLifetime = 2;
  definition.emission.burstCount = 1_024;
  definition.emission.spawnHeight = 2;
  definition.emission.gravity = -40;
  definition.emission.horizontalSpeedMinimum = 30;
  definition.emission.horizontalSpeedMaximum = 30;
  definition.emission.horizontalSpeedCap = 30;
  definition.emission.outwardBiasMinimum = 30;
  definition.emission.outwardBiasMaximum = 30;
  definition.emission.verticalMinimum = 30;
  definition.emission.verticalRange = 30;
  definition.emission.verticalPower = 4;
  definition.particleLifecycle.sizeMinimum = 0.5;
  definition.particleLifecycle.sizeMaximum = 0.5;
  definition.particleLifecycle.lifetimeMinimum = 10;
  definition.particleLifecycle.lifetimeMaximum = 10;
  definition.particleLifecycle.lifetimeBase = 10;
  definition.particleLifecycle.lifetimeSizeScale = 10;
  definition.particleLifecycle.lifetimeJitter = 10;
  definition.particleLifecycle.shrinkExponent = 4;
  definition.collision.groundVerticalRetention = 1;
  definition.collision.groundHorizontalRetention = 1;
  definition.collision.wallNormalRetention = 1;
  definition.collision.wallTangentialRetention = 1;
  definition.palette.perCastHueVariation = 30;
  definition.palette.perCastSaturationVariation = 0.25;
  definition.palette.perCastBrightnessVariation = 0.25;
  definition.palette.perParticleHueVariation = 30;
  definition.palette.perParticleSaturationVariation = 0.25;
  definition.palette.perParticleBrightnessVariation = 0.25;
  definition.presentation.projectileEmissiveStrength = 12;
  definition.presentation.particleEmissiveStrength = 12;
  definition.presentation.flightLightIntensity = 150;
  definition.presentation.flightLightRange = 20;
  definition.presentation.flightLightDecay = 4;
  definition.presentation.impactLightIntensity = 150;
  definition.presentation.impactLightRange = 20;
  definition.presentation.impactLightDecay = 4;
  definition.presentation.sparkLightIntensity = 150;
  definition.presentation.sparkLightRange = 20;
  definition.presentation.sparkLightDecay = 4;
  return definition;
}

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
    { x: 12.5, z: 17.5 },
    { x: 15.5, z: 17.5 },
    { x: 15.5, z: 21.5 },
    { x: 12.5, z: 21.5 },
  ];
  assert.equal(simulation.enemies.activeCount, 1);
  placeEnemy(simulation, 0, positions[0].x, positions[0].z);
  for (let index = 1; index < simulation.enemies.capacity; index += 1) {
    const id = simulation.enemies.spawn({
      spawnSequence: 100 + index,
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
  assert.equal(simulation.enemies.activeCount, simulation.enemies.capacity);
}

function spawnProjectile(simulation, value) {
  const spell = simulation.spells.get(FIREBALL_SPELL_ID);
  assert.ok(spell);
  const definition = spell.definitions.get(spell.currentRevision);
  assert.ok(definition);
  const id = simulation.projectiles.spawn({
    x: value.x,
    z: value.z,
    vx: 0,
    vz: 0,
    lifetime: definition.projectile.lifetime,
    radius: definition.projectile.radius,
    ownerId: value.ownerId,
    ownerKind: value.ownerKind,
    ownerTeam: value.ownerTeam,
    spellCode: FIREBALL_SPELL_CODE,
    definitionRevision: spell.currentRevision,
    effectId: value.effectId,
    effectSeed: value.effectSeed,
  });
  assert.ok(id > 0);
  return id;
}

test("four-enemy combat deaths and repeated restarts stay bounded below 8 ms at maximum tuning", () => {
  const definition = maximumStressDefinition();
  const simulation = new Simulation({
    seed: 0x0600_c0de,
    initialFireballDefinition: definition,
    enemyAiProfile: ENEMY_AI_PROFILE_TACTICAL,
  });
  const timings = [];
  const heapBefore = process.memoryUsage().heapUsed;
  let maximumEnemies = 0;
  let enemyDeaths = 0;
  let restarts = 0;
  const timedTick = (command = null) => {
    const started = performance.now();
    simulation.tick(command);
    timings.push(performance.now() - started);
    maximumEnemies = Math.max(maximumEnemies, simulation.enemies.activeCount);
  };

  for (let cycle = 0; cycle < 3; cycle += 1) {
    timedTick();
    assert.equal(simulation.tickCount, 1);
    fillEnemyPool(simulation);
    maximumEnemies = Math.max(maximumEnemies, simulation.enemies.activeCount);

    const victimId = simulation.enemies.id[0];
    simulation.enemies.health[0] = COMBAT.directDamage;
    spawnProjectile(simulation, {
      x: simulation.enemies.x[0],
      z: simulation.enemies.z[0],
      ownerId: simulation.player.id,
      ownerKind: PROJECTILE_OWNER_KIND.player,
      ownerTeam: ACTOR_TEAM.player,
      effectId: 0x100 + cycle,
      effectSeed: 0x6000 + cycle,
    });
    timedTick();
    assert.equal(simulation.enemies.findIndexById(victimId), -1);
    assert.equal(simulation.enemies.activeCount, simulation.enemies.capacity - 1);
    assert.ok(simulation.particles.activeCount >= definition.emission.burstCount);
    enemyDeaths += 1;

    for (let index = 0; index < simulation.enemies.activeCount; index += 1) {
      simulation.enemies.health[index] = COMBAT.maximumHealth;
      simulation.enemies.shotReadyTick[index] = 0xffff_ffff;
    }
    const shooterId = simulation.enemies.id[0];
    simulation.player.health = COMBAT.directDamage;
    spawnProjectile(simulation, {
      x: simulation.player.x,
      z: simulation.player.z,
      ownerId: shooterId,
      ownerKind: PROJECTILE_OWNER_KIND.enemyWizard,
      ownerTeam: ACTOR_TEAM.enemy,
      effectId: 0x200 + cycle,
      effectSeed: 0x7000 + cycle,
    });
    timedTick();
    assert.equal(simulation.levelState, "defeated");
    assert.equal(simulation.defeatedTicksRemaining, COMBAT.defeatedTicks);

    for (let tick = 0; tick < COMBAT.defeatedTicks; tick += 1) timedTick();
    assert.equal(simulation.tickCount, 0);
    assert.equal(simulation.levelState, "running");
    assert.equal(simulation.player.health, COMBAT.maximumHealth);
    assert.equal(simulation.enemies.activeCount, 0);
    assert.equal(simulation.projectiles.activeCount, 0);
    assert.equal(simulation.particles.activeCount, 0);
    assert.equal(simulation.getSpellDefinition(FIREBALL_SPELL_ID).revision, 1);
    assert.deepEqual(simulation.getSpellDefinition(FIREBALL_SPELL_ID).definition, definition);
    assert.equal(simulation.commandLog.length, 0);
    restarts += 1;
  }

  const measured = timings.slice(12).sort((left, right) => left - right);
  const p99 = measured[Math.ceil(measured.length * 0.99) - 1];
  const heapAfter = process.memoryUsage().heapUsed;
  assert.equal(maximumEnemies, ENEMY_WIZARD.legacyCapacity);
  assert.equal(enemyDeaths, 3);
  assert.equal(restarts, 3);
  assert.ok(p99 < 8, `combat simulation p99 ${p99.toFixed(3)} ms exceeded 8 ms`);
  assert.ok(heapAfter - heapBefore < 64 * 2 ** 20, "combat stress exceeded 64 MiB");
  assert.doesNotThrow(() => JSON.stringify(simulation.snapshot()));
  console.log(JSON.stringify({
    hardware: `${os.cpus()[0]?.model ?? "unknown CPU"} (${os.cpus().length} logical)`,
    node: process.version,
    ticksMeasured: measured.length,
    maximumEnemies,
    enemyDeaths,
    restarts,
    simP99Ms: Number(p99.toFixed(3)),
    heapDeltaMiB: Number(((heapAfter - heapBefore) / 2 ** 20).toFixed(2)),
  }));
});
