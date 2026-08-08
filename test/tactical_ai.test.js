import test from "node:test";
import assert from "node:assert/strict";

import {
  ACTOR_TEAM,
  COMBAT,
  DEAD_BODY_PROFILE_NONE,
  ENEMY_AI_PROFILE_BASIC,
  ENEMY_AI_PROFILE_TACTICAL,
  ENEMY_WIZARD,
  PROJECTILE,
  PROJECTILE_OWNER_KIND,
  SCHEMA_VERSION,
  TACTICAL_WIZARD,
} from "../src/config.js";
import {
  cloneFireballDefinition,
  FIREBALL_SPELL_CODE,
  FIREBALL_SPELL_ID,
} from "../src/spells/fireball_definition.js";
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

function tacticalSimulation(map, options = {}) {
  return new Simulation({
    scenario: new ArenaScenario(map),
    seed: options.seed ?? 0x7000_0007,
    particleBurstCount: 0,
    projectileCapacity: PROJECTILE.legacyCapacity,
    enemyAiProfile: ENEMY_AI_PROFILE_TACTICAL,
  });
}

function spawnEnemy(simulation, x, z, options = {}) {
  const id = simulation.enemies.spawn({
    spawnSequence: options.spawnSequence ?? simulation.enemies.activeCount + 1,
    spawnTick: options.spawnTick ?? simulation.tickCount,
    x,
    z,
    radius: ENEMY_WIZARD.radius,
    massKg: ENEMY_WIZARD.massKg,
    maximumHealth: COMBAT.maximumHealth,
    shotReadyTick: options.shotReadyTick ?? 0xffff_ffff,
  });
  assert.ok(id > 0);
  return id;
}

function spawnPlayerFireball(simulation, value) {
  const spell = simulation.spells.get(FIREBALL_SPELL_ID);
  assert.ok(spell);
  const definition = spell.definitions.get(spell.currentRevision);
  const id = simulation.projectiles.spawn({
    x: value.x,
    z: value.z,
    vx: value.vx,
    vz: value.vz,
    lifetime: value.lifetime ?? definition.projectile.lifetime,
    radius: value.radius ?? definition.projectile.radius,
    ownerId: simulation.player.id,
    ownerKind: PROJECTILE_OWNER_KIND.player,
    ownerTeam: ACTOR_TEAM.player,
    spellCode: FIREBALL_SPELL_CODE,
    definitionRevision: spell.currentRevision,
    effectId: value.effectId,
    effectSeed: value.effectSeed ?? value.effectId,
  });
  assert.ok(id > 0);
  return id;
}

test("tactical movement uses the shared field through a doorway and invalidates on map edits", () => {
  const map = borderedMap(30, 22, { x: 2.5, z: 2.5 });
  for (let z = 1; z < 21; z += 1) {
    if (z !== 11) map.set(15, z, 1);
  }
  const simulation = tacticalSimulation(map);
  const enemyId = spawnEnemy(simulation, 26.5, 18.5);
  simulation.tick(null);
  let enemy = simulation.snapshot().enemies.find((entry) => entry.id === enemyId);
  assert.equal(simulation.enemyAiProfile, ENEMY_AI_PROFILE_TACTICAL);
  assert.equal(enemy.behaviorState, "approach");
  assert.equal(enemy.movementGoal.kind, "navigation");
  assert.equal(enemy.navigationField.version, 1);
  const diagnostics = simulation.enemyDiagnostics(enemyId);
  assert.equal(diagnostics.schemaVersion, SCHEMA_VERSION);
  assert.equal(diagnostics.enemyAiProfile, ENEMY_AI_PROFILE_TACTICAL);
  assert.equal(diagnostics.enemies.length, 1);
  assert.equal(diagnostics.enemies[0].id, enemyId);
  assert.equal(diagnostics.enemies[0].behaviorState, "approach");
  assert.deepEqual(simulation.enemyDiagnostics(0xffff_ffff).enemies, []);

  let crossingZ = null;
  for (let tick = 0; tick < 600; tick += 1) {
    const beforeX = simulation.enemies.x[simulation.enemies.findIndexById(enemyId)];
    simulation.tick(null);
    const index = simulation.enemies.findIndexById(enemyId);
    if (index < 0) break;
    const afterX = simulation.enemies.x[index];
    if (beforeX > 16 && afterX <= 15) crossingZ = simulation.enemies.z[index];
    if (afterX < 15) break;
  }
  const index = simulation.enemies.findIndexById(enemyId);
  assert.ok(simulation.enemies.x[index] < 15, "enemy should reach the player side of the wall");
  assert.ok(crossingZ === null || Math.abs(crossingZ - 11.5) < 1.2);

  const before = simulation.snapshot().navigation;
  simulation.tick({ type: "setTile", cx: 27, cz: 2, tile: 1 });
  const after = simulation.snapshot().navigation;
  assert.equal(after.mapRevision, before.mapRevision + 1);
  assert.ok(after.version > before.version);
  assert.ok(after.expansionsThisTick <= TACTICAL_WIZARD.navigationExpansionsPerTick);
});

test("no completed field falls back to basic movement and stale rebuilds keep the previous field", () => {
  const map = borderedMap(64, 64, { x: 2.5, z: 2.5 });
  const simulation = tacticalSimulation(map);
  const enemyId = spawnEnemy(simulation, 55.5, 55.5);
  simulation.tick(null);
  let snapshot = simulation.snapshot();
  let enemy = snapshot.enemies.find((entry) => entry.id === enemyId);
  assert.equal(snapshot.navigation.completed, false);
  assert.equal(snapshot.navigation.building, true);
  assert.equal(enemy.movementGoal.kind, "direct");
  assert.equal(enemy.navigationField.version, 0);

  simulation.tick(null);
  snapshot = simulation.snapshot();
  enemy = snapshot.enemies.find((entry) => entry.id === enemyId);
  assert.equal(snapshot.navigation.completed, true);
  assert.equal(enemy.movementGoal.kind, "navigation");
  const completedVersion = snapshot.navigation.version;

  simulation.player.x = 3.5;
  simulation.player.previousX = 3.5;
  simulation.tick(null);
  snapshot = simulation.snapshot();
  enemy = snapshot.enemies.find((entry) => entry.id === enemyId);
  assert.equal(snapshot.navigation.building, true);
  assert.equal(snapshot.navigation.stale, true);
  assert.equal(snapshot.navigation.version, completedVersion);
  assert.equal(enemy.movementGoal.kind, "navigation");
  assert.equal(enemy.navigationField.version, completedVersion);
});

test("engagement strafes at 3.5 m/s, changes side on schedule, and corrects range", () => {
  const map = borderedMap(28, 20, { x: 10.5, z: 10.5 });
  const simulation = tacticalSimulation(map, { seed: 0x7a7a_0001 });
  const enemyId = spawnEnemy(simulation, 17.5, 10.5);
  simulation.tick(null);
  let index = simulation.enemies.findIndexById(enemyId);
  assert.equal(simulation.enemies.aiState[index], 0);
  assert.ok(
    Math.abs(
      Math.hypot(simulation.enemies.desiredVx[index], simulation.enemies.desiredVz[index])
      - TACTICAL_WIZARD.strafeSpeed,
    ) < 1e-6,
  );
  const initialDirection = simulation.enemies.strafeDirection[index];
  const initialChangeTick = simulation.enemies.strafeChangeTick[index];
  assert.ok(initialChangeTick >= TACTICAL_WIZARD.strafeMinimumTicks);
  assert.ok(initialChangeTick <= TACTICAL_WIZARD.strafeMaximumTicks);
  while (simulation.tickCount < initialChangeTick) simulation.tick(null);
  index = simulation.enemies.findIndexById(enemyId);
  assert.equal(simulation.enemies.strafeDirection[index], -initialDirection);
  assert.equal(simulation.enemies.strafeDecisionSequence[index], 1);

  simulation.enemies.x[index] = 22.5;
  simulation.enemies.z[index] = 10.5;
  simulation.enemies.locomotionVx[index] = 0;
  simulation.enemies.locomotionVz[index] = 0;
  simulation.tick(null);
  assert.equal(simulation.snapshot().enemies.find((entry) => entry.id === enemyId).behaviorState, "approach");
  assert.ok(simulation.enemies.desiredVx[index] < 0);

  simulation.enemies.x[index] = 15.5;
  simulation.enemies.z[index] = 10.5;
  simulation.enemies.locomotionVx[index] = 0;
  simulation.enemies.locomotionVz[index] = 0;
  simulation.tick(null);
  assert.equal(simulation.snapshot().enemies.find((entry) => entry.id === enemyId).behaviorState, "withdraw");
  assert.ok(simulation.enemies.desiredVx[index] > 0);
});

test("genuine hostile fireballs trigger an 18-tick perpendicular dodge and 105-tick cooldown", () => {
  const map = borderedMap(18, 12, { x: 2.5, z: 5.5 });
  const simulation = tacticalSimulation(map);
  const enemyId = spawnEnemy(simulation, 8.5, 5.5);
  spawnPlayerFireball(simulation, {
    x: 4.5,
    z: 5.5,
    vx: 9,
    vz: 0,
    effectId: 41,
  });
  simulation.tick(null);
  let index = simulation.enemies.findIndexById(enemyId);
  assert.equal(simulation.enemies.aiState[index], 4);
  assert.equal(simulation.enemies.trackedThreatEffectId[index], 41);
  assert.equal(simulation.enemies.dodgeTicksRemaining[index], 17);
  assert.ok(Math.abs(Math.hypot(
    simulation.enemies.locomotionVx[index],
    simulation.enemies.locomotionVz[index],
  ) - TACTICAL_WIZARD.dodgeSpeed) < 1e-6);
  const dodgeGoal = simulation.snapshot().enemies
    .find((entry) => entry.id === enemyId).movementGoal;
  simulation.tick(null);
  const continuedGoal = simulation.snapshot().enemies
    .find((entry) => entry.id === enemyId).movementGoal;
  assert.ok(Math.abs(continuedGoal.x - dodgeGoal.x) < 1e-5);
  assert.ok(Math.abs(continuedGoal.z - dodgeGoal.z) < 1e-5);

  for (let tick = 0; tick < 16; tick += 1) simulation.tick(null);
  index = simulation.enemies.findIndexById(enemyId);
  assert.equal(simulation.enemies.dodgeTicksRemaining[index], 0);
  assert.equal(simulation.enemies.dodgeCooldownTicks[index], 105);
  for (let tick = 0; tick < 105; tick += 1) simulation.tick(null);
  assert.equal(simulation.enemies.dodgeCooldownTicks[index], 0);
});

test("simultaneous threats select the earliest stable effect identity", () => {
  const map = borderedMap(18, 12, { x: 2.5, z: 5.5 });
  const simulation = tacticalSimulation(map);
  const enemyId = spawnEnemy(simulation, 8.5, 5.5);
  spawnPlayerFireball(simulation, {
    x: 4.5,
    z: 5.5,
    vx: 8,
    vz: 0,
    effectId: 61,
  });
  spawnPlayerFireball(simulation, {
    x: 3.5,
    z: 5.5,
    vx: 12,
    vz: 0,
    effectId: 62,
  });
  simulation.tick(null);
  const index = simulation.enemies.findIndexById(enemyId);
  assert.equal(simulation.enemies.trackedThreatEffectId[index], 62);
});

test("retreat stops casting at 30 health, survives dodge interruption, and re-engages at 60", () => {
  const map = borderedMap(20, 12, { x: 2.5, z: 5.5 });
  const simulation = tacticalSimulation(map);
  const enemyId = spawnEnemy(simulation, 9.5, 5.5, { shotReadyTick: 1 });
  let index = simulation.enemies.findIndexById(enemyId);
  simulation.enemies.health[index] = 30;
  spawnPlayerFireball(simulation, {
    x: 5.5,
    z: 5.5,
    vx: 9,
    vz: 0,
    effectId: 51,
  });
  simulation.tick(null);
  index = simulation.enemies.findIndexById(enemyId);
  assert.equal(simulation.enemies.retreating[index], 1);
  assert.equal(simulation.enemies.aiState[index], 4, "dodge temporarily interrupts retreat movement");
  assert.equal(simulation.enemies.castSequence[index], 0);
  assert.equal(
    Array.from(simulation.projectiles.ownerTeam.slice(0, simulation.projectiles.activeCount))
      .includes(ACTOR_TEAM.enemy),
    false,
  );

  simulation.projectiles.reset();
  simulation.enemies.dodgeTicksRemaining[index] = 0;
  simulation.enemies.dodgeCooldownTicks[index] = 0;
  simulation.enemies.health[index] = 59.99;
  simulation.enemies.damageFreeTicks[index] = COMBAT.regenerationDelayTicks;
  simulation.tick(null);
  assert.ok(simulation.enemies.health[index] >= 60);
  assert.equal(simulation.enemies.retreating[index], 1);
  assert.equal(simulation.enemies.castSequence[index], 0);
  simulation.tick(null);
  assert.equal(simulation.enemies.retreating[index], 0);
  assert.equal(simulation.enemies.castSequence[index], 1);
});

test("tactical aim leads current velocity and same-tick Apply immediately changes projectile speed", () => {
  const map = borderedMap(18, 12, { x: 2.5, z: 5.5 });
  const slow = tacticalSimulation(map, { seed: 0x7000_00aa });
  const fast = tacticalSimulation(map, { seed: 0x7000_00aa });
  spawnEnemy(slow, 10.5, 5.5, { shotReadyTick: 1 });
  spawnEnemy(fast, 10.5, 5.5, { shotReadyTick: 1 });
  slow.player.externalVz = 3;
  fast.player.externalVz = 3;
  const fasterDefinition = cloneFireballDefinition(
    fast.getSpellDefinition(FIREBALL_SPELL_ID).definition,
  );
  fasterDefinition.projectile.speed = 18;
  slow.tick(null);
  fast.tick({
    actions: [{
      type: "applySpellDefinition",
      spellId: FIREBALL_SPELL_ID,
      expectedRevision: 1,
      definition: fasterDefinition,
    }],
  });
  const slowEnemy = slow.snapshot().enemies[0];
  const fastEnemy = fast.snapshot().enemies[0];
  assert.ok(slowEnemy.predictedAimPoint.z > slow.player.z);
  assert.ok(slowEnemy.aimLeadTime > fastEnemy.aimLeadTime);
  assert.ok(slow.projectiles.vz[0] > 0);
  assert.ok(Math.abs(Math.hypot(fast.projectiles.vx[0], fast.projectiles.vz[0]) - 18) < 1e-5);

  const blockedMap = borderedMap(18, 12, { x: 2.5, z: 5.5 });
  blockedMap.set(6, 5, 1);
  const blocked = tacticalSimulation(blockedMap);
  const blockedId = spawnEnemy(blocked, 10.5, 5.5, { shotReadyTick: 1 });
  blocked.tick(null);
  const blockedIndex = blocked.enemies.findIndexById(blockedId);
  assert.equal(blocked.enemies.lineOfSight[blockedIndex], 0);
  assert.equal(blocked.enemies.shotReadyTick[blockedIndex], 1);
  assert.equal(blocked.projectiles.activeCount, 0);
});

test("another enemy, particle traffic, palette edits, and harmless player casts do not perturb strafe choices", () => {
  const map = borderedMap(32, 24, { x: 10.5, z: 10.5 });
  const left = tacticalSimulation(map, { seed: 0x7dee_0001 });
  const right = tacticalSimulation(map, { seed: 0x7dee_0001 });
  const leftId = spawnEnemy(left, 17.5, 10.5, { spawnSequence: 11 });
  const rightId = spawnEnemy(right, 17.5, 10.5, { spawnSequence: 11 });
  spawnEnemy(right, 27.5, 19.5, { spawnSequence: 12 });
  right.particles.spawn({
    x: 25,
    y: 1,
    z: 20,
    vx: 0,
    vy: 0,
    vz: 0,
    lifetime: 10,
    size: 0.05,
  });
  const paletteEdit = cloneFireballDefinition(
    right.getSpellDefinition(FIREBALL_SPELL_ID).definition,
  );
  paletteEdit.palette.perCastHueVariation = Math.min(
    180,
    paletteEdit.palette.perCastHueVariation + 1,
  );
  for (let tick = 0; tick < 240; tick += 1) {
    left.tick(null);
    right.tick({
      cast: tick === 0 ? { x: 1.5, z: 1.5 } : null,
      actions: tick === 0 ? [{
        type: "applySpellDefinition",
        spellId: FIREBALL_SPELL_ID,
        expectedRevision: 1,
        definition: paletteEdit,
      }] : [],
    });
    const leftIndex = left.enemies.findIndexById(leftId);
    const rightIndex = right.enemies.findIndexById(rightId);
    assert.deepEqual({
      direction: right.enemies.strafeDirection[rightIndex],
      changeTick: right.enemies.strafeChangeTick[rightIndex],
      sequence: right.enemies.strafeDecisionSequence[rightIndex],
    }, {
      direction: left.enemies.strafeDirection[leftIndex],
      changeTick: left.enemies.strafeChangeTick[leftIndex],
      sequence: left.enemies.strafeDecisionSequence[leftIndex],
    });
  }
  assert.equal(right.getSpellDefinition(FIREBALL_SPELL_ID).revision, 2);
});

test("schema-v7 tactical replay is exact while schema-v6 selects frozen basic direct aim", () => {
  const live = new Simulation({
    seed: 0x7000_0700,
    particleBurstCount: 0,
    projectileCapacity: PROJECTILE.legacyCapacity,
    enemyAiProfile: ENEMY_AI_PROFILE_TACTICAL,
    deadBodyProfile: DEAD_BODY_PROFILE_NONE,
  });
  for (let tick = 0; tick < 180; tick += 1) {
    live.tick({
      move: { x: 10.5, z: 10.5 },
      cast: tick % 45 === 0 ? { x: 18.5, z: 18.5 } : null,
    });
  }
  const recording = live.exportCommandLog();
  recording.schemaVersion = 7;
  delete recording.configuration.enemyCapacity;
  delete recording.configuration.encounterMaximumAlive;
  assert.equal(recording.schemaVersion, 7);
  assert.equal(recording.configuration.enemyAiProfile, ENEMY_AI_PROFILE_TACTICAL);
  assert.deepEqual(Simulation.replay(recording).snapshot(), live.snapshot());

  const basicMap = borderedMap(16, 12, { x: 2.5, z: 5.5 });
  basicMap.set(11, 5, 1);
  const basic = new Simulation({
    seed: 0x6000_0006,
    particleBurstCount: 0,
    enemyAiProfile: ENEMY_AI_PROFILE_BASIC,
    deadBodyProfile: DEAD_BODY_PROFILE_NONE,
    scenario: new ArenaScenario(basicMap, [{ kind: "obelisk", x: 11.5, z: 5.5 }]),
  });
  for (let tick = 0; tick < 90; tick += 1) {
    basic.tick({ move: { x: 2.5, z: 9.5 } });
  }
  const schema6 = basic.exportCommandLog();
  schema6.schemaVersion = 6;
  const replayed = Simulation.replay(schema6);
  assert.equal(replayed.enemyAiProfile, ENEMY_AI_PROFILE_BASIC);
  assert.equal(replayed.enemies.strafeDirection[0], 0);
  const castEvent = replayed.combatEvents.toArray().find((event) => event.type === "cast");
  assert.ok(castEvent);
  assert.equal(Object.hasOwn(castEvent, "aim"), false);
  assert.equal(SCHEMA_VERSION, 10);
});
