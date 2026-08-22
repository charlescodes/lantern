import test from "node:test";
import assert from "node:assert/strict";

import {
  ACTOR_TEAM,
  COMBAT,
  DEAD_BODY,
  DEAD_BODY_PROFILE_NONE,
  DEAD_BODY_PROFILE_V1,
  ENEMY_AI_PROFILE_NONE,
  ENEMY_WIZARD,
  GAMEPLAY_PROFILE_PRE_COMBAT,
  PROJECTILE_OWNER_KIND,
} from "../src/config.js";
import {
  DEAD_BODY_SETTLE_REASON,
  DynamicDeadBodyPool,
  InertDeadBodyRing,
} from "../src/sim/dead_body_pool.js";
import { GridMap } from "../src/sim/grid_map.js";
import { Simulation } from "../src/sim/simulation.js";
import {
  cloneFireballDefinition,
  DEFAULT_FIREBALL_DEFINITION,
  FIREBALL_SPELL_CODE,
  FIREBALL_SPELL_ID,
} from "../src/spells/fireball_definition.js";

function borderedMap() {
  const map = new GridMap(20, 20, undefined, { x: 2.5, z: 10.5 });
  for (let x = 0; x < map.width; x += 1) {
    map.set(x, 0, 1);
    map.set(x, map.height - 1, 1);
  }
  for (let z = 0; z < map.height; z += 1) {
    map.set(0, z, 1);
    map.set(map.width - 1, z, 1);
  }
  return map;
}

function simulation(options = {}) {
  return new Simulation({
    map: borderedMap(),
    gameplayProfile: GAMEPLAY_PROFILE_PRE_COMBAT,
    enemyAiProfile: ENEMY_AI_PROFILE_NONE,
    particleBurstCount: 0,
    ...options,
  });
}

function spawnEnemy(value, x, z, health = COMBAT.maximumHealth) {
  const spawnSequence = value.enemies.nextId;
  const id = value.enemies.spawn({
    spawnSequence,
    spawnTick: value.tickCount,
    x,
    z,
    radius: ENEMY_WIZARD.radius,
    massKg: ENEMY_WIZARD.massKg,
    maximumHealth: COMBAT.maximumHealth,
    shotReadyTick: 0xffff_ffff,
    facingX: 1,
    facingZ: 0,
  });
  assert.ok(id > 0);
  const index = value.enemies.findIndexById(id);
  value.enemies.health[index] = health;
  return id;
}

function spawnBody(value, id, x, z, overrides = {}) {
  const index = value.dynamicDeadBodies.spawn({
    id,
    spawnSequence: id,
    deathTick: overrides.deathTick ?? value.tickCount,
    x,
    z,
    vx: overrides.vx ?? 0,
    vz: overrides.vz ?? 0,
    facingX: overrides.facingX ?? 1,
    facingZ: overrides.facingZ ?? 0,
    radius: ENEMY_WIZARD.radius,
    massKg: ENEMY_WIZARD.massKg,
  });
  assert.ok(index >= 0);
  return index;
}

function spawnFireball(value, ownerTeam, x, z, vx = 0, vz = 0) {
  const spell = value.spells.get(FIREBALL_SPELL_ID);
  assert.ok(spell);
  const definition = spell.definitions.get(spell.currentRevision);
  assert.ok(definition);
  return value.projectiles.spawn({
    x,
    z,
    vx,
    vz,
    lifetime: definition.projectile.lifetime,
    radius: definition.projectile.radius,
    ownerId: ownerTeam === ACTOR_TEAM.player ? value.player.id : 99,
    ownerKind: ownerTeam === ACTOR_TEAM.player
      ? PROJECTILE_OWNER_KIND.player
      : PROJECTILE_OWNER_KIND.enemyWizard,
    ownerTeam,
    spellCode: FIREBALL_SPELL_CODE,
    definitionRevision: spell.currentRevision,
    effectId: 100 + ownerTeam,
    effectSeed: 200 + ownerTeam,
  });
}

test("dynamic and inert dead-body storage stays dense, bounded, and FIFO", () => {
  const dynamic = new DynamicDeadBodyPool(2);
  const row = (id, deathTick) => ({
    id,
    spawnSequence: id,
    deathTick,
    x: id,
    z: id + 1,
    vx: 0,
    vz: 0,
    facingX: 1,
    facingZ: 0,
    radius: 0.3,
    massKg: 75,
  });
  assert.equal(dynamic.spawn(row(2, 5)), 0);
  assert.equal(dynamic.spawn(row(1, 5)), 1);
  assert.equal(dynamic.oldestIndex(), 1);
  assert.equal(dynamic.spawn(row(3, 6)), -1);
  dynamic.removeSwap(0);
  assert.equal(dynamic.activeCount, 1);
  assert.equal(dynamic.id[0], 1);

  const inert = new InertDeadBodyRing(2);
  const settled = (id) => ({
    ...row(id, id),
    settledTick: id + 10,
    settleReason: DEAD_BODY_SETTLE_REASON.quiet,
  });
  assert.equal(inert.push(settled(1)), false);
  assert.equal(inert.push(settled(2)), false);
  assert.equal(inert.push(settled(3)), true);
  assert.equal(inert.length, 2);
  assert.equal(inert.overwritten, 1);
  assert.deepEqual(
    [0, 1].map((ordinal) => inert.id[inert.storageIndex(ordinal)]),
    [2, 3],
  );
});

test("dead-body capacities are validated and schema-profile behavior can be disabled", () => {
  assert.throws(
    () => simulation({ dynamicDeadBodyCapacity: 0 }),
    /Dynamic dead-body capacity/,
  );
  assert.throws(
    () => simulation({ inertDeadBodyCapacity: DEAD_BODY.maximumInertCapacity + 1 }),
    /Inert dead-body capacity/,
  );
  const value = simulation({ deadBodyProfile: DEAD_BODY_PROFILE_NONE });
  spawnEnemy(value, 8, 8, 0);
  value.tick(null);
  assert.equal(value.enemies.activeCount, 0);
  assert.equal(value.dynamicDeadBodies.activeCount, 0);
  assert.equal(value.inertDeadBodies.length, 0);
});

test("death transfers compact AI state and settles only after the fall plus quiet window", () => {
  const value = simulation();
  const id = spawnEnemy(value, 8, 8, 0);
  value.enemies.locomotionVx[0] = 1.25;
  value.enemies.externalVz[0] = -0.5;
  value.enemies.facingX[0] = 0;
  value.enemies.facingZ[0] = -1;
  value.tick(null);
  let snapshot = value.snapshot();
  assert.equal(value.enemies.findIndexById(id), -1);
  assert.equal(snapshot.deadBodies.dynamic.length, 1);
  assert.equal(snapshot.deadBodies.dynamic[0].id, id);
  assert.ok(snapshot.deadBodies.dynamic[0].vx > 0);
  assert.ok(snapshot.deadBodies.dynamic[0].vx < 1.25);
  assert.ok(snapshot.deadBodies.dynamic[0].vz < 0);
  assert.ok(snapshot.deadBodies.dynamic[0].vz > -0.5);
  assert.deepEqual(snapshot.deadBodies.dynamic[0].facing, { x: 0, z: -1 });

  value.dynamicDeadBodies.vx[0] = 0;
  value.dynamicDeadBodies.vz[0] = 0;
  for (let tick = 0; tick < DEAD_BODY.fallTicks + DEAD_BODY.quietTicks - 2; tick += 1) {
    value.tick(null);
  }
  assert.equal(value.dynamicDeadBodies.activeCount, 1);
  value.tick(null);
  snapshot = value.snapshot();
  assert.equal(snapshot.deadBodies.dynamic.length, 0);
  assert.equal(snapshot.deadBodies.inert.length, 1);
  assert.equal(snapshot.deadBodies.inert[0].settleReason, "quiet");
  assert.equal(snapshot.deadBodies.inert[0].interacting, false);
});

test("movement resets quiet progress and the three-second ceiling forces settlement", () => {
  const value = simulation();
  spawnBody(value, 7, 8, 8, { deathTick: 0 });
  for (let tick = 0; tick < DEAD_BODY.fallTicks; tick += 1) value.tick(null);
  assert.equal(value.dynamicDeadBodies.quietTickCount[0], 1);
  value.dynamicDeadBodies.vx[0] = DEAD_BODY.quietSpeed * 2;
  value.tick(null);
  assert.equal(value.dynamicDeadBodies.quietTickCount[0], 0);

  let safetyTicks = 0;
  while (value.dynamicDeadBodies.activeCount > 0) {
    value.dynamicDeadBodies.vx[0] = DEAD_BODY.maxSpeed;
    value.dynamicDeadBodies.vz[0] = 0;
    value.tick(null);
    safetyTicks += 1;
    assert.ok(safetyTicks <= DEAD_BODY.maximumDynamicTicks);
  }
  assert.equal(value.dynamicDeadBodies.activeCount, 0);
  assert.equal(value.inertDeadBodies.length, 1);
  assert.equal(value.snapshot().deadBodies.inert[0].settleReason, "timeout");
  assert.equal(value.dynamicDeadBodies.timeoutSettles, 1);
});

test("hot overflow settles the oldest body and inert overflow overwrites FIFO", () => {
  const value = simulation({
    dynamicDeadBodyCapacity: 1,
    inertDeadBodyCapacity: 2,
  });
  for (let id = 1; id <= 4; id += 1) {
    spawnEnemy(value, 5 + id * 2, 5, 0);
    value.tick(null);
  }
  assert.equal(value.dynamicDeadBodies.activeCount, 1);
  assert.equal(value.dynamicDeadBodies.id[0], 4);
  assert.equal(value.dynamicDeadBodies.forcedSettles, 3);
  assert.equal(value.inertDeadBodies.length, 2);
  assert.equal(value.inertDeadBodies.overwritten, 1);
  assert.deepEqual(
    value.snapshot().deadBodies.inert.map((body) => body.id),
    [2, 3],
  );
  value.reset();
  assert.equal(value.dynamicDeadBodies.activeCount, 0);
  assert.equal(value.dynamicDeadBodies.forcedSettles, 0);
  assert.equal(value.inertDeadBodies.length, 0);
  assert.equal(value.inertDeadBodies.overwritten, 0);

  spawnBody(value, 20, 8, 8);
  value.inertDeadBodies.push({
    id: 21,
    spawnSequence: 21,
    deathTick: 0,
    settledTick: 0,
    x: 10,
    z: 10,
    facingX: 1,
    facingZ: 0,
    radius: 0.3,
    massKg: 75,
    settleReason: DEAD_BODY_SETTLE_REASON.quiet,
  });
  value.tick({ type: "restoreScenario" });
  assert.equal(value.dynamicDeadBodies.activeCount, 0);
  assert.equal(value.inertDeadBodies.length, 0);
});

test("dynamic bodies participate in every circle collision pairing and map placement guard", () => {
  const value = simulation();
  spawnBody(value, 11, 2.9, 10.5);
  const enemyId = spawnEnemy(value, 5, 5);
  spawnBody(value, 12, 5.4, 5);
  const rockId = value.rocks.spawn({
    spawnId: 100,
    archetype: 2,
    x: 8,
    z: 8,
    radius: 0.3,
    massKg: 294,
  });
  assert.ok(rockId > 0);
  spawnBody(value, 13, 8.4, 8);
  spawnBody(value, 14, 12, 12);
  spawnBody(value, 15, 12.4, 12);
  assert.equal(value.canPlaceRock("small", 12, 12), false);
  value.tick(null);
  const pairs = value.snapshot().contacts.map((contact) => (
    `${contact.a.kind}:${contact.b.kind}`
  ));
  assert.ok(pairs.includes("player:enemyWizardBody"));
  assert.ok(pairs.includes("enemyWizard:enemyWizardBody"), `missing enemy/body: ${pairs}`);
  assert.ok(pairs.includes("rock:enemyWizardBody"), `missing rock/body: ${pairs}`);
  assert.ok(
    pairs.includes("enemyWizardBody:enemyWizardBody"),
    `missing body/body: ${pairs}`,
  );
  assert.ok(value.enemies.findIndexById(enemyId) >= 0);

  const body = value.snapshot().deadBodies.dynamic.find((entry) => entry.id === 14);
  assert.ok(body);
  const cx = Math.floor(body.x);
  const cz = Math.floor(body.z);
  value.tick({ actions: [{ type: "setTile", cx, cz, tile: 1 }] });
  assert.match(value.lastError, /overlap an authored or active body/);
  assert.equal(value.map.get(cx, cz), 0);
});

test("both teams' Fireballs hit dynamic bodies while inert bodies remain entirely noninteractive", () => {
  for (const team of [ACTOR_TEAM.player, ACTOR_TEAM.enemy]) {
    const value = simulation();
    spawnBody(value, team, 8, 8);
    assert.ok(spawnFireball(value, team, 8, 8) > 0);
    value.tick(null);
    const event = value.snapshot().recentEvents.at(-1);
    assert.equal(event.hit.kind, "enemyWizardBody");
    assert.equal(event.hit.id, team);
    assert.ok(event.responses.some((response) => response.kind === "enemyWizardBody"));
    assert.equal(value.projectiles.activeCount, 0);
    assert.equal(value.dynamicDeadBodies.touched[0], 1);
  }

  const inertOnly = simulation();
  inertOnly.inertDeadBodies.push({
    id: 50,
    spawnSequence: 50,
    deathTick: 0,
    settledTick: 1,
    x: 8,
    z: 8,
    facingX: 1,
    facingZ: 0,
    radius: 0.3,
    massKg: 75,
    settleReason: DEAD_BODY_SETTLE_REASON.quiet,
  });
  assert.equal(inertOnly.canPlaceRock("small", 8, 8), true);
  assert.ok(spawnFireball(inertOnly, ACTOR_TEAM.player, 8, 8) > 0);
  inertOnly.tick(null);
  assert.equal(inertOnly.projectiles.activeCount, 1);
  assert.equal(inertOnly.snapshot().recentEvents.length, 0);
  inertOnly.tick({ actions: [{ type: "setTile", cx: 8, cz: 8, tile: 1 }] });
  assert.equal(inertOnly.lastError, null);
  assert.equal(inertOnly.map.get(8, 8), 1);
  assert.equal(inertOnly.snapshot().deadBodies.inert[0].x, 8);
});

test("schema 11 captures body configuration while schema 9 forces corpse-free behavior", () => {
  const definition = cloneFireballDefinition(DEFAULT_FIREBALL_DEFINITION);
  definition.cast.cooldown = 0;
  definition.projectile.speed = 40;
  definition.projectile.radius = 1;
  definition.impact.blastRadius = 12;
  definition.emission.burstCount = 0;
  const source = new Simulation({
    seed: 0xdead_0010,
    initialFireballDefinition: definition,
    particleBurstCount: 0,
    dynamicDeadBodyCapacity: 3,
    inertDeadBodyCapacity: 7,
  });
  for (let tick = 0; tick < 180; tick += 1) {
    const target = source.enemies.activeCount > 0
      ? { x: source.enemies.x[0], z: source.enemies.z[0] }
      : null;
    source.tick({ move: target, cast: target });
  }
  const recording = source.exportCommandLog();
  assert.equal(recording.schemaVersion, 12);
  assert.equal(recording.configuration.deadBodyProfile, DEAD_BODY_PROFILE_V1);
  assert.equal(recording.configuration.dynamicDeadBodyCapacity, 3);
  assert.equal(recording.configuration.inertDeadBodyCapacity, 7);
  assert.equal(source.enemies.activeCount, 0);
  assert.equal(source.dynamicDeadBodies.activeCount, 1);
  assert.deepEqual(Simulation.replay(recording).snapshot(), source.snapshot());

  const schema9 = structuredClone(recording);
  schema9.schemaVersion = 9;
  delete schema9.configuration.deadBodyProfile;
  delete schema9.configuration.dynamicDeadBodyCapacity;
  delete schema9.configuration.inertDeadBodyCapacity;
  const legacy = Simulation.replay(schema9);
  assert.equal(legacy.deadBodyProfile, DEAD_BODY_PROFILE_NONE);
  assert.deepEqual(legacy.snapshot().deadBodies, { dynamic: [], inert: [] });
  assert.throws(
    () => Simulation.replay({
      ...recording,
      configuration: { ...recording.configuration, deadBodyProfile: "unknown" },
    }),
    /invalid or missing dead-body profile/,
  );
  assert.throws(
    () => Simulation.replay({
      ...recording,
      configuration: {
        ...recording.configuration,
        dynamicDeadBodyCapacity: 0,
      },
    }),
    /invalid dead-body capacities/,
  );
});

test("dead-body broadphase and brute-force modes remain deterministic", () => {
  const left = simulation({ useBroadphase: true });
  const right = simulation({ useBroadphase: false });
  for (const value of [left, right]) {
    spawnBody(value, 1, 2.9, 10.5, { vx: -2 });
    spawnBody(value, 2, 3.4, 10.5, { vx: -1 });
    value.rocks.spawn({
      spawnId: 1,
      archetype: 2,
      x: 4,
      z: 10.5,
      radius: 0.3,
      massKg: 294,
    });
  }
  for (let tick = 0; tick < 30; tick += 1) {
    left.tick({ move: { x: 10, z: 10.5 } });
    right.tick({ move: { x: 10, z: 10.5 } });
  }
  const comparable = (value) => {
    const snapshot = structuredClone(value.snapshot());
    delete snapshot.broadphase;
    return snapshot;
  };
  assert.deepEqual(comparable(left), comparable(right));
});
