import test from "node:test";
import assert from "node:assert/strict";

import {
  ACTOR_TEAM,
  ENEMY_ARCHETYPE,
  ENEMY_ARCHETYPE_PROFILE_NONE,
  ENEMY_ARCHETYPE_PROFILE_V1,
  ENEMY_AI_PROFILE_BASIC,
  ENEMY_URCHIN,
  PROJECTILE_KIND,
  PROJECTILE_OWNER_KIND,
  SCHEMA_VERSION,
} from "../src/config.js";
import { FIREBALL_SPELL_CODE, FIREBALL_SPELL_ID } from "../src/spells/fireball_definition.js";
import { ProjectilePool, EnemyPool } from "../src/sim/pools.js";
import {
  createNavigationDebugArenaScenario,
} from "../src/sim/scenario.js";
import { Simulation } from "../src/sim/simulation.js";

test("enemy and projectile pools preserve stable archetype identity through swap removal", () => {
  const enemies = new EnemyPool(3);
  for (const archetype of [ENEMY_ARCHETYPE.wizard, ENEMY_ARCHETYPE.urchin]) {
    enemies.spawn({
      archetype,
      spawnSequence: archetype,
      spawnTick: 0,
      x: archetype,
      z: 2,
      radius: 0.2,
      massKg: 35,
      maximumHealth: 50,
      shotReadyTick: 75,
    });
  }
  enemies.removeSwap(0);
  assert.equal(enemies.archetype[0], ENEMY_ARCHETYPE.urchin);

  const projectiles = new ProjectilePool(3);
  projectiles.spawn({ x: 1, z: 1, vx: 0, vz: 0, lifetime: 1, radius: 0.1 });
  projectiles.spawn({
    x: 2,
    z: 2,
    vx: 0,
    vz: 0,
    lifetime: 1,
    radius: 0.1,
    projectileKind: PROJECTILE_KIND.thrownStone,
  });
  projectiles.removeSwap(0);
  assert.equal(projectiles.projectileKind[0], PROJECTILE_KIND.thrownStone);
});

test("navigation encounters spawn independently tuned half-height Urchins", () => {
  const simulation = new Simulation({
    scenario: createNavigationDebugArenaScenario(),
    encounterEnemyArchetype: "urchin",
    particleBurstCount: 0,
  });
  simulation.tick(null);
  const [enemy] = simulation.snapshot().enemies;
  assert.equal(enemy.kind, "enemyUrchin");
  assert.equal(enemy.archetype, "urchin");
  assert.ok(Math.abs(enemy.radius - ENEMY_URCHIN.radius) < 1e-6);
  assert.equal(enemy.massKg, ENEMY_URCHIN.massKg);
  assert.equal(enemy.maximumHealth, ENEMY_URCHIN.maximumHealth);
  assert.equal(enemy.presentationHeight, ENEMY_URCHIN.presentationHeight);
  assert.deepEqual(enemy.cooldowns, { "thrown-stone": 0 });
});

test("thrown stones deal two damage without impulse or spell effects and disappear", () => {
  const simulation = new Simulation({
    scenario: createNavigationDebugArenaScenario(),
    encounterEnemyArchetype: "urchin",
    particleBurstCount: 0,
  });
  const projectileId = simulation.projectiles.spawn({
    x: simulation.player.x - 0.35,
    z: simulation.player.z,
    vx: ENEMY_URCHIN.projectile.speed,
    vz: 0,
    lifetime: ENEMY_URCHIN.projectile.lifetime,
    radius: ENEMY_URCHIN.projectile.radius,
    ownerId: 77,
    ownerKind: PROJECTILE_OWNER_KIND.enemyUrchin,
    ownerTeam: ACTOR_TEAM.enemy,
    projectileKind: PROJECTILE_KIND.thrownStone,
  });
  assert.ok(projectileId > 0);
  simulation.encounter.enabled = false;
  simulation.tick(null);
  const snapshot = simulation.snapshot();
  assert.equal(snapshot.player.health, 98);
  assert.equal(snapshot.player.externalVx, 0);
  assert.equal(snapshot.player.externalVz, 0);
  assert.equal(snapshot.projectiles.length, 0);
  assert.equal(snapshot.particles.length, 0);
  assert.equal(snapshot.recentEvents.length, 0);
  assert.equal(snapshot.soundEvents.current.length, 0);
  const damage = snapshot.recentCombatEvents.find((event) => event.type === "damage");
  assert.equal(damage.amount, 2);
  assert.equal(damage.id, 1);
  assert.equal(damage.owner.kind, "enemyUrchin");
  assert.equal(damage.effectId, null);
  assert.deepEqual(damage.position, {
    x: snapshot.player.x,
    z: snapshot.player.z,
  });
  assert.equal(damage.visualCenterY, snapshot.player.worldY + 0.8);
  assert.equal(damage.layerIndex, snapshot.player.layerIndex);
  assert.equal(damage.layerId, snapshot.player.layerId);
  assert.ok(Math.abs(damage.launchDirection.x - 1) < 1e-6);
  assert.ok(Math.abs(damage.launchDirection.z) < 1e-6);
});

test("thrown stones disappear silently on walls and at their bounded lifetime", () => {
  const simulation = new Simulation({ particleBurstCount: 0 });
  simulation.encounter.enabled = false;
  const spawnStone = (value) => simulation.projectiles.spawn({
    x: value.x,
    z: value.z,
    vx: value.vx ?? 0,
    vz: value.vz ?? 0,
    lifetime: value.lifetime ?? ENEMY_URCHIN.projectile.lifetime,
    radius: ENEMY_URCHIN.projectile.radius,
    ownerId: 77,
    ownerKind: PROJECTILE_OWNER_KIND.enemyUrchin,
    ownerTeam: ACTOR_TEAM.enemy,
    projectileKind: PROJECTILE_KIND.thrownStone,
  });
  spawnStone({ x: 1.11, z: 1.5, vx: -ENEMY_URCHIN.projectile.speed });
  simulation.tick(null);
  assert.equal(simulation.projectiles.activeCount, 0);
  assert.equal(simulation.snapshot().recentEvents.length, 0);

  spawnStone({
    x: simulation.player.x + 2,
    z: simulation.player.z,
    lifetime: 0.001,
  });
  simulation.tick(null);
  const snapshot = simulation.snapshot();
  assert.equal(snapshot.projectiles.length, 0);
  assert.equal(snapshot.recentEvents.length, 0);
  assert.equal(snapshot.particles.length, 0);
  assert.equal(snapshot.soundEvents.current.length, 0);
});

test("Urchins use the shared AI loop to launch their own stone attack", () => {
  const simulation = new Simulation({
    encounterEnemyArchetype: "urchin",
    enemyAiProfile: ENEMY_AI_PROFILE_BASIC,
    particleBurstCount: 0,
  });
  simulation.tick(null);
  assert.equal(simulation.enemies.activeCount, 1);
  simulation.enemies.shotReadyTick[0] = 0;
  simulation.tick(null);
  const snapshot = simulation.snapshot();
  assert.equal(snapshot.projectiles.length, 1);
  assert.equal(snapshot.projectiles[0].projectileKind, "thrown-stone");
  assert.equal(snapshot.projectiles[0].spellId, null);
  assert.equal(snapshot.projectiles[0].ownerKind, "enemyUrchin");
  const attack = snapshot.recentCombatEvents.find((event) => event.type === "attack");
  assert.equal(attack.attackId, "thrown-stone");
  assert.equal(attack.caster.kind, "enemyUrchin");
  assert.equal(snapshot.recentEvents.length, 0);
});

test("two direct Fireballs defeat a half-health Urchin and preserve corpse identity", () => {
  const simulation = new Simulation({
    scenario: createNavigationDebugArenaScenario(),
    encounterEnemyArchetype: "urchin",
    particleBurstCount: 0,
  });
  simulation.tick(null);
  simulation.encounter.enabled = false;
  const fireball = simulation.spells.get(FIREBALL_SPELL_ID);
  const definition = fireball.definitions.get(fireball.currentRevision);
  const hit = () => simulation.projectiles.spawn({
    x: simulation.enemies.x[0],
    z: simulation.enemies.z[0],
    vx: 0,
    vz: 0,
    lifetime: definition.projectile.lifetime,
    radius: definition.projectile.radius,
    ownerId: simulation.player.id,
    ownerKind: PROJECTILE_OWNER_KIND.player,
    ownerTeam: ACTOR_TEAM.player,
    projectileKind: PROJECTILE_KIND.fireball,
    spellCode: FIREBALL_SPELL_CODE,
    definitionRevision: fireball.currentRevision,
    effectId: 400 + simulation.tickCount,
    effectSeed: 500 + simulation.tickCount,
    layerIndex: simulation.enemies.layerIndex[0],
  });
  hit();
  simulation.tick(null);
  assert.equal(simulation.enemies.health[0], 25);
  hit();
  simulation.tick(null);
  const snapshot = simulation.snapshot();
  assert.equal(snapshot.enemies.length, 0);
  assert.equal(snapshot.deadBodies.dynamic.length, 1);
  assert.equal(snapshot.deadBodies.dynamic[0].kind, "enemyUrchinBody");
  assert.equal(snapshot.deadBodies.dynamic[0].archetype, "urchin");
  assert.equal(snapshot.deadBodies.dynamic[0].presentationHeight, ENEMY_URCHIN.presentationHeight);
});

test("schema-v16 records the encounter archetype and older schemas remain wizard-only", () => {
  const simulation = new Simulation({
    scenario: createNavigationDebugArenaScenario(),
    encounterEnemyArchetype: "urchin",
    particleBurstCount: 0,
  });
  simulation.tick(null);
  const recording = simulation.exportCommandLog();
  assert.equal(recording.schemaVersion, SCHEMA_VERSION);
  assert.equal(recording.configuration.enemyArchetypeProfile, ENEMY_ARCHETYPE_PROFILE_V1);
  assert.equal(recording.configuration.encounterEnemyArchetype, "urchin");
  assert.deepEqual(Simulation.replay(recording).snapshot(), simulation.snapshot());

  const legacy = structuredClone(recording);
  legacy.schemaVersion = 15;
  delete legacy.configuration.enemyArchetypeProfile;
  delete legacy.configuration.encounterEnemyArchetype;
  const replay = Simulation.replay(legacy);
  assert.equal(replay.enemyArchetypeProfile, ENEMY_ARCHETYPE_PROFILE_NONE);
  assert.equal(replay.encounterEnemyArchetype, "wizard");
  assert.equal(replay.snapshot().enemies[0].archetype, "wizard");

  const invalid = structuredClone(recording);
  invalid.configuration.encounterEnemyArchetype = "dragon";
  assert.throws(() => Simulation.replay(invalid), /invalid encounter enemy archetype/);
});
