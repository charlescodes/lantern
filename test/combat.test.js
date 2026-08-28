import test from "node:test";
import assert from "node:assert/strict";

import {
  ACTOR_TEAM,
  COMBAT,
  ENEMY_AI_PROFILE_INVESTIGATIVE,
  ENEMY_AI_PROFILE_NONE,
  ENEMY_WIZARD,
  GAMEPLAY_PROFILE_PRE_COMBAT,
  PROJECTILE_OWNER_KIND,
  SCENARIO_VERSION,
} from "../src/config.js";
import {
  cloneFireballDefinition,
  FIREBALL_SPELL_CODE,
  FIREBALL_SPELL_ID,
} from "../src/spells/fireball_definition.js";
import { deriveCastSeed, deriveEnemyCastSeed } from "../src/spells/random.js";
import { firstSolidContact } from "../src/sim/collision.js";
import { GridMap } from "../src/sim/grid_map.js";
import { EnemyWizardPool } from "../src/sim/pools.js";
import { ArenaScenario, createDebugArenaScenario } from "../src/sim/scenario.js";
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

function obeliskScenario(options = {}) {
  const map = borderedMap(
    options.width ?? 12,
    options.height ?? 10,
    options.spawn ?? { x: 2.5, z: 4.5 },
  );
  const x = options.x ?? 8.5;
  const z = options.z ?? 4.5;
  map.set(Math.floor(x), Math.floor(z), 1);
  for (const cell of options.extraWalls ?? []) map.set(cell.cx, cell.cz, 1);
  return new ArenaScenario(map, [
    ...(options.rocks ?? []),
    { kind: "obelisk", x, z },
  ]);
}

function sandboxSimulation(options = {}) {
  const scenario = options.scenario ?? new ArenaScenario(
    borderedMap(options.width ?? 14, options.height ?? 10, options.spawn ?? { x: 2.5, z: 4.5 }),
  );
  return new Simulation({
    scenario,
    seed: options.seed ?? 0x600d_f00d,
    particleBurstCount: 0,
    gameplayProfile: GAMEPLAY_PROFILE_PRE_COMBAT,
    enemyAiProfile: ENEMY_AI_PROFILE_NONE,
  });
}

function spawnEnemy(simulation, x, z, options = {}) {
  const spawnSequence = options.spawnSequence ?? simulation.enemies.activeCount + 1;
  const id = simulation.enemies.spawn({
    spawnSequence,
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

function spawnFireball(simulation, value) {
  const spell = simulation.spells.get(FIREBALL_SPELL_ID);
  assert.ok(spell);
  const definition = spell.definitions.get(value.definitionRevision ?? spell.currentRevision);
  assert.ok(definition);
  const id = simulation.projectiles.spawn({
    x: value.x,
    z: value.z,
    vx: value.vx ?? 0,
    vz: value.vz ?? 0,
    lifetime: value.lifetime ?? definition.projectile.lifetime,
    radius: value.radius ?? definition.projectile.radius,
    ownerId: value.ownerId,
    ownerKind: value.ownerKind,
    ownerTeam: value.ownerTeam,
    spellCode: FIREBALL_SPELL_CODE,
    definitionRevision: value.definitionRevision ?? spell.currentRevision,
    effectId: value.effectId ?? 77,
    effectSeed: value.effectSeed ?? 0x1234_5678,
  });
  assert.ok(id > 0);
  return id;
}

function assertOutsideSolid(simulation, x, z, radius) {
  const contact = { nx: 0, nz: 0, penetration: 0, px: 0, pz: 0, cx: 0, cz: 0 };
  assert.equal(firstSolidContact(simulation.map, x, z, radius, contact), false);
}

test("scenario v3 validates a singleton protected obelisk and imports v1/v2 without encounters", () => {
  const scenario = obeliskScenario();
  const json = scenario.toJSON();
  assert.equal(json.version, SCENARIO_VERSION);
  assert.deepEqual(json.entities.at(-1), { kind: "obelisk", x: 8.5, z: 4.5 });
  assert.deepEqual(ArenaScenario.fromJSON(json).toJSON(), json);
  assert.equal(scenario.setTile(8, 4, 0), false);
  assert.equal(scenario.map.get(8, 4), 1);
  assert.equal(scenario.removeRock(scenario.obelisk.spawnId), false);

  const legacyMap = borderedMap(8, 8, { x: 2.5, z: 2.5 });
  const v1 = ArenaScenario.fromJSON(legacyMap.toJSON());
  const v2 = ArenaScenario.fromJSON({
    ...legacyMap.toJSON(),
    version: 2,
    entities: [{ kind: "rock", archetype: "small", x: 4.5, z: 4.5 }],
  });
  assert.equal(v1.obelisk, null);
  assert.equal(v2.obelisk, null);
  const v1Simulation = new Simulation({ scenario: v1, particleBurstCount: 0 });
  const v2Simulation = new Simulation({ scenario: v2, particleBurstCount: 0 });
  v1Simulation.tick(null);
  v2Simulation.tick(null);
  assert.equal(v1Simulation.enemies.activeCount, 0);
  assert.equal(v2Simulation.enemies.activeCount, 0);
  assert.equal(v1Simulation.snapshot().encounter.enabled, false);
  assert.equal(v2Simulation.snapshot().encounter.enabled, false);
});

test("scenario v3 rejects malformed, overlapping, or multiple obelisks", () => {
  const map = borderedMap(10, 8, { x: 2.5, z: 3.5 });
  map.set(6, 3, 1);
  map.set(7, 3, 1);
  assert.throws(
    () => new ArenaScenario(map, [{ kind: "obelisk", x: 6.4, z: 3.5 }]),
    /cell-centered/,
  );
  assert.throws(
    () => new ArenaScenario(map, [{ kind: "obelisk", x: 5.5, z: 3.5 }]),
    /solid/,
  );
  assert.throws(
    () => new ArenaScenario(map, [
      { kind: "obelisk", x: 6.5, z: 3.5 },
      { kind: "obelisk", x: 7.5, z: 3.5 },
    ]),
    /at most one/,
  );

  const playerMap = borderedMap(8, 8, { x: 4.5, z: 4.5 });
  playerMap.set(4, 4, 1);
  assert.throws(
    () => new ArenaScenario(playerMap, [{ kind: "obelisk", x: 4.5, z: 4.5 }]),
    /inside solid geometry|overlapping the player/,
  );

  const adjacentPlayerMap = borderedMap(10, 8, { x: 6.5, z: 2.5 });
  adjacentPlayerMap.set(6, 3, 1);
  assert.doesNotThrow(
    () => new ArenaScenario(adjacentPlayerMap, [{ kind: "obelisk", x: 6.5, z: 3.5 }]),
  );

  const rockMap = borderedMap(10, 8, { x: 2.5, z: 3.5 });
  rockMap.set(6, 3, 1);
  assert.throws(
    () => new ArenaScenario(rockMap, [
      { kind: "rock", archetype: "large", x: 5.2, z: 3.5 },
      { kind: "obelisk", x: 6.5, z: 3.5 },
    ]),
    /inside solid geometry/,
  );
});

test("default encounter spawns immediately, repeats every 1,800 ticks, rotates, caps, and resets", () => {
  const simulation = new Simulation({ particleBurstCount: 0 });
  const obelisk = simulation.scenario.obelisk;
  assert.deepEqual({ x: obelisk.x, z: obelisk.z }, { x: 20.5, z: 18.5 });
  assert.equal(simulation.map.get(20, 18), 1);

  simulation.tick(null);
  let diagnostics = simulation.encounterDiagnostics();
  assert.equal(diagnostics.enemies.length, 1);
  assert.deepEqual(diagnostics.recentCombatEvents[0].position, { x: 20.5, z: 17.5 });
  assert.equal(diagnostics.recentCombatEvents[0].direction, "north");
  assert.equal(diagnostics.encounter.ticksUntilSpawn, 1_800);

  while (simulation.tickCount < 1_800) {
    simulation.tick(null);
    simulation.player.health = COMBAT.maximumHealth;
    for (let index = 0; index < simulation.enemies.activeCount; index += 1) {
      simulation.enemies.shotReadyTick[index] = 0xffff_ffff;
      simulation.enemies.health[index] = COMBAT.maximumHealth;
    }
  }
  assert.equal(simulation.enemies.activeCount, 1);
  simulation.tick(null);
  diagnostics = simulation.encounterDiagnostics();
  assert.equal(diagnostics.enemies.length, 2);
  assert.equal(
    diagnostics.recentCombatEvents.filter((event) => event.type === "spawn").at(-1).direction,
    "east",
  );

  while (simulation.tickCount < 7_201) {
    simulation.tick(null);
    simulation.player.health = COMBAT.maximumHealth;
    for (let index = 0; index < simulation.enemies.activeCount; index += 1) {
      simulation.enemies.shotReadyTick[index] = 0xffff_ffff;
      simulation.enemies.health[index] = COMBAT.maximumHealth;
    }
  }
  diagnostics = simulation.encounterDiagnostics();
  assert.equal(diagnostics.enemies.length, 4);
  assert.equal(diagnostics.encounter.attempts, 5);
  assert.equal(diagnostics.encounter.skippedAttempts.capped, 1);
  assert.equal(diagnostics.encounter.spawnCursor, 5);

  simulation.reset(simulation.seed);
  diagnostics = simulation.encounterDiagnostics();
  assert.equal(diagnostics.tick, 0);
  assert.equal(diagnostics.enemies.length, 0);
  assert.equal(diagnostics.encounter.nextSpawnTick, 1);
  assert.equal(diagnostics.encounter.attempts, 0);
  assert.equal(diagnostics.recentCombatEvents.length, 0);
});

test("authored-state restore restarts encounter cadence without backlogged attempts", () => {
  const simulation = new Simulation({ particleBurstCount: 0 });
  for (let tick = 0; tick < 30; tick += 1) simulation.tick(null);
  simulation.tick({ type: "restoreScenario" });
  assert.equal(simulation.tickCount, 31);
  assert.equal(simulation.encounter.attempts, 1);
  assert.equal(simulation.encounter.successfulSpawns, 1);
  assert.equal(simulation.enemies.activeCount, 1);
  assert.equal(
    simulation.encounter.nextSpawnTick - simulation.tickCount,
    ENEMY_WIZARD.spawnIntervalTicks,
  );
});

test("blocked and capped spawn attempts rotate once without queueing retries", () => {
  const blockedScenario = obeliskScenario({ extraWalls: [{ cx: 8, cz: 3 }] });
  const blocked = new Simulation({ scenario: blockedScenario, particleBurstCount: 0 });
  blocked.tick(null);
  let diagnostics = blocked.encounterDiagnostics();
  assert.equal(blocked.enemies.activeCount, 0);
  assert.equal(diagnostics.encounter.skippedAttempts.blocked, 1);
  assert.equal(diagnostics.encounter.spawnCursor, 1);
  assert.equal(diagnostics.recentCombatEvents.at(-1).result, "blocked");
  blocked.tick(null);
  assert.equal(blocked.enemies.activeCount, 0, "blocked attempts must not retry next tick");

  const capped = new Simulation({ scenario: obeliskScenario(), particleBurstCount: 0 });
  for (const [index, point] of [[0, [2, 2]], [1, [3, 2]], [2, [4, 2]], [3, [5, 2]]]) {
    spawnEnemy(capped, point[0], point[1], { spawnSequence: index + 1 });
  }
  capped.tick(null);
  diagnostics = capped.encounterDiagnostics();
  assert.equal(diagnostics.encounter.skippedAttempts.capped, 1);
  assert.equal(diagnostics.encounter.spawnCursor, 1);
  capped.enemies.removeSwap(0);
  capped.tick(null);
  assert.equal(capped.enemies.activeCount, 3, "capped attempt must not be queued");
});

test("spawn safety rejects dynamic player and authored-rock occupancy", () => {
  const playerBlocked = obeliskScenario({
    spawn: { x: 8.5, z: 3.5 },
  });
  const playerSimulation = new Simulation({
    scenario: playerBlocked,
    particleBurstCount: 0,
  });
  playerSimulation.tick(null);
  assert.equal(playerSimulation.enemies.activeCount, 0);
  assert.equal(playerSimulation.encounter.skippedBlocked, 1);

  const rockBlocked = obeliskScenario({
    rocks: [{ kind: "rock", archetype: "small", x: 8.5, z: 3.5 }],
  });
  const rockSimulation = new Simulation({
    scenario: rockBlocked,
    particleBurstCount: 0,
  });
  rockSimulation.tick(null);
  assert.equal(rockSimulation.enemies.activeCount, 0);
  assert.equal(rockSimulation.encounter.skippedBlocked, 1);
});

test("enemy pool swap removal preserves every caster and AI identity field", () => {
  const pool = new EnemyWizardPool(4);
  for (let index = 0; index < 3; index += 1) {
    pool.spawn({
      spawnSequence: index + 10,
      spawnTick: index + 20,
      x: index + 1,
      z: index + 2,
      radius: 0.3,
      massKg: 75,
      maximumHealth: 100,
      shotReadyTick: index + 30,
    });
  }
  const components = [
    "id", "spawnSequence", "spawnTick", "x", "z", "previousX", "previousZ",
    "vx", "vz", "desiredVx", "desiredVz", "locomotionVx", "locomotionVz",
    "externalVx", "externalVz", "radius", "massKg", "inverseMass", "health",
    "maximumHealth", "damageFreeTicks", "lastDamageTick", "cooldown",
    "castSequence", "shotReadyTick", "aiState", "lineOfSight",
    "movementGoalKind", "movementGoalX", "movementGoalZ", "movementGoalCx",
    "movementGoalCz", "navigationCost", "navigationVersion", "strafeDirection",
    "strafeChangeTick", "strafeDecisionSequence", "predictedAimX", "predictedAimZ",
    "aimInterceptTime", "aimLeadTime", "trackedThreatEffectId",
    "trackedThreatProjectileId", "dodgeTicksRemaining", "dodgeCooldownTicks",
    "dodgeDirectionX", "dodgeDirectionZ", "dodgeSide", "retreating",
  ];
  for (let ordinal = 0; ordinal < components.length; ordinal += 1) {
    pool[components[ordinal]][2] = 100 + ordinal;
  }
  const expected = Object.fromEntries(components.map((name) => [name, pool[name][2]]));
  pool.removeSwap(0);
  assert.equal(pool.activeCount, 2);
  for (const name of components) assert.equal(pool[name][0], expected[name], name);
});

test("basic wizard corrects range, wall-slides, and keeps blocked shots ready", () => {
  const map = borderedMap(18, 12, { x: 2.5, z: 5.5 });
  map.set(7, 5, 1);
  const simulation = sandboxSimulation({ scenario: new ArenaScenario(map) });
  const enemyId = spawnEnemy(simulation, 13.5, 5.5, { shotReadyTick: 1 });

  simulation.tick(null);
  let index = simulation.enemies.findIndexById(enemyId);
  assert.equal(simulation.enemies.aiState[index], 1);
  assert.ok(simulation.enemies.desiredVx[index] < 0);
  assert.equal(simulation.enemies.lineOfSight[index], 0);
  assert.equal(simulation.enemies.shotReadyTick[index], 1);
  assert.equal(simulation.projectiles.activeCount, 0);

  simulation.tick({ type: "setTile", cx: 7, cz: 5, tile: 0 });
  index = simulation.enemies.findIndexById(enemyId);
  assert.equal(simulation.enemies.lineOfSight[index], 1);
  assert.equal(simulation.enemies.castSequence[index], 1);
  assert.equal(simulation.enemies.shotReadyTick[index], 77);
  assert.equal(simulation.projectiles.activeCount, 1);
  assert.equal(simulation.projectiles.ownerId[0], enemyId);
  assert.equal(simulation.projectiles.ownerKind[0], PROJECTILE_OWNER_KIND.enemyWizard);
  assert.equal(simulation.projectiles.ownerTeam[0], ACTOR_TEAM.enemy);

  simulation.projectiles.reset();
  simulation.enemies.x[index] = 8.5;
  simulation.enemies.z[index] = 5.5;
  simulation.enemies.locomotionVx[index] = 0;
  simulation.enemies.locomotionVz[index] = 0;
  simulation.tick(null);
  assert.equal(simulation.enemies.aiState[index], 0, "6-9m is the hold band");

  simulation.enemies.x[index] = 4.5;
  simulation.enemies.z[index] = 5.5;
  simulation.enemies.locomotionVx[index] = 0;
  simulation.enemies.locomotionVz[index] = 0;
  simulation.tick(null);
  assert.equal(simulation.enemies.aiState[index], 2);
  assert.ok(simulation.enemies.desiredVx[index] > 0);

  simulation.map.set(5, 5, 1);
  simulation.enemies.x[index] = 4.69;
  simulation.enemies.z[index] = 5.1;
  simulation.enemies.locomotionVx[index] = 0;
  simulation.enemies.locomotionVz[index] = 0;
  simulation.tick(null);
  assertOutsideSolid(
    simulation,
    simulation.enemies.x[index],
    simulation.enemies.z[index],
    simulation.enemies.radius[index],
  );
  assert.ok(Math.abs(simulation.enemies.vz[index]) > 0.01, "tangential wall motion should survive");
});

test("enemy actors resolve player, rock, enemy, and grid contacts with player fundamentals", () => {
  const map = borderedMap(18, 12, { x: 2.5, z: 5.5 });
  const scenario = new ArenaScenario(map, [
    { kind: "rock", archetype: "medium", x: 8.5, z: 5.5 },
  ]);
  const simulation = sandboxSimulation({ scenario });
  const playerContactId = spawnEnemy(simulation, 2.9, 5.5);
  const rockContactId = spawnEnemy(simulation, 8.0, 5.5);
  const enemyLeftId = spawnEnemy(simulation, 12.0, 5.5);
  const enemyRightId = spawnEnemy(simulation, 12.4, 5.5);
  simulation.tick(null);
  const snapshot = simulation.snapshot();
  for (const enemy of snapshot.enemies) {
    assert.equal(enemy.radius, Math.fround(simulation.player.radius));
    assert.equal(enemy.massKg, Math.fround(simulation.player.massKg));
    assertOutsideSolid(simulation, enemy.x, enemy.z, enemy.radius);
  }
  const playerEnemy = snapshot.contacts.find((contact) => (
    contact.a.kind === "player"
    && contact.b.kind === "enemyWizard"
    && contact.b.id === playerContactId
  ));
  const enemyRock = snapshot.contacts.find((contact) => (
    contact.a.kind === "enemyWizard"
    && contact.a.id === rockContactId
    && contact.b.kind === "rock"
  ));
  const enemyEnemy = snapshot.contacts.find((contact) => (
    contact.a.kind === "enemyWizard"
    && contact.a.id === enemyLeftId
    && contact.b.kind === "enemyWizard"
    && contact.b.id === enemyRightId
  ));
  assert.ok(playerEnemy);
  assert.ok(enemyRock);
  assert.ok(enemyEnemy);
  assert.ok(Math.hypot(
    simulation.player.x - simulation.enemies.x[simulation.enemies.findIndexById(playerContactId)],
    simulation.player.z - simulation.enemies.z[simulation.enemies.findIndexById(playerContactId)],
  ) >= ENEMY_WIZARD.radius * 2 - 0.003);
});

test("enemy casts use current shared revisions with independent cooldowns, sequences, and seeds", () => {
  const simulation = sandboxSimulation({ seed: 0x1234_abcd });
  const enemyId = spawnEnemy(simulation, 8.5, 4.5, {
    spawnSequence: 19,
    shotReadyTick: 1,
  });
  const playerSeedBefore = simulation.spellDiagnostics(FIREBALL_SPELL_ID).currentSeed;
  const definition = cloneFireballDefinition(
    simulation.getSpellDefinition(FIREBALL_SPELL_ID).definition,
  );
  definition.projectile.speed = 17;
  definition.cast.cooldown = 0.75;
  definition.emission.burstCount = 0;

  simulation.tick({
    type: "applySpellDefinition",
    spellId: FIREBALL_SPELL_ID,
    expectedRevision: 1,
    definition,
  });
  const index = simulation.enemies.findIndexById(enemyId);
  assert.equal(simulation.projectiles.activeCount, 1);
  assert.equal(simulation.projectiles.definitionRevision[0], 2);
  assert.ok(Math.abs(Math.hypot(simulation.projectiles.vx[0], simulation.projectiles.vz[0]) - 17) < 1e-5);
  assert.equal(simulation.enemies.cooldown[index], 0.75);
  assert.equal(simulation.enemies.castSequence[index], 1);
  assert.equal(
    simulation.projectiles.effectSeed[0],
    deriveEnemyCastSeed(simulation.seed, 19, FIREBALL_SPELL_CODE, 0),
  );
  assert.equal(simulation.castSequences[FIREBALL_SPELL_CODE], 0);
  assert.equal(simulation.spellCooldowns[FIREBALL_SPELL_CODE], 0);
  assert.equal(simulation.spellDiagnostics(FIREBALL_SPELL_ID).currentSeed, playerSeedBefore);

  simulation.tick({ cast: { x: 3.5, z: 8.5 } });
  const playerProjectile = simulation.snapshot().projectiles.find(
    (projectile) => projectile.ownerKind === "player",
  );
  assert.ok(playerProjectile);
  assert.equal(
    playerProjectile.effectSeed,
    deriveCastSeed(simulation.seed, FIREBALL_SPELL_CODE, 0),
  );
  assert.equal(simulation.enemies.castSequence[index], 1);
});

test("direct and splash damage are symmetric, wall-blocked, and team immune while impulse stays neutral", () => {
  const direct = sandboxSimulation();
  const enemyId = spawnEnemy(direct, 5.5, 4.5);
  spawnFireball(direct, {
    x: 4.5,
    z: 4.5,
    vx: 120,
    ownerId: direct.player.id,
    ownerKind: PROJECTILE_OWNER_KIND.player,
    ownerTeam: ACTOR_TEAM.player,
  });
  direct.tick(null);
  let enemyIndex = direct.enemies.findIndexById(enemyId);
  assert.equal(direct.enemies.health[enemyIndex], 75);
  const directEvent = direct.impactEvents.toArray().at(-1);
  assert.equal(directEvent.hit.kind, "enemyWizard");
  assert.equal(directEvent.owner.kind, "player");
  assert.equal(directEvent.owner.team, "player");
  assert.equal(
    directEvent.responses.find((response) => response.kind === "enemyWizard").damage,
    25,
  );

  const splashMap = borderedMap(12, 10, { x: 2.5, z: 4.5 });
  splashMap.set(6, 4, 1);
  const splash = sandboxSimulation({ scenario: new ArenaScenario(splashMap) });
  const nearId = spawnEnemy(splash, 5.3, 6.0);
  const shieldedId = spawnEnemy(splash, 7.2, 4.5);
  spawnFireball(splash, {
    x: 5.2,
    z: 4.5,
    vx: 120,
    ownerId: splash.player.id,
    ownerKind: PROJECTILE_OWNER_KIND.player,
    ownerTeam: ACTOR_TEAM.player,
  });
  splash.tick(null);
  const splashEvent = splash.impactEvents.toArray().at(-1);
  const nearResponse = splashEvent.responses.find(
    (response) => response.kind === "enemyWizard" && response.id === nearId,
  );
  const shieldedResponse = splashEvent.responses.find(
    (response) => response.kind === "enemyWizard" && response.id === shieldedId,
  );
  assert.ok(nearResponse && nearResponse.damage > 0 && nearResponse.damage < 25);
  assert.ok(Math.abs(
    nearResponse.damage
      - 25 * Math.max(0, Math.min(1, 1 - nearResponse.surfaceDistance / splashEvent.radius)),
  ) < 1e-9);
  assert.ok(shieldedResponse?.blocked);
  assert.equal(shieldedResponse.damage, 0);

  const friendly = sandboxSimulation();
  const casterId = spawnEnemy(friendly, 4.5, 4.5);
  const allyId = spawnEnemy(friendly, 5.2, 5.5);
  spawnFireball(friendly, {
    x: 6.7,
    z: 4.5,
    vx: 120,
    ownerId: casterId,
    ownerKind: PROJECTILE_OWNER_KIND.enemyWizard,
    ownerTeam: ACTOR_TEAM.enemy,
  });
  friendly.map.set(7, 4, 1);
  friendly.tick(null);
  const casterIndex = friendly.enemies.findIndexById(casterId);
  const allyIndex = friendly.enemies.findIndexById(allyId);
  assert.equal(friendly.enemies.health[casterIndex], 100);
  assert.equal(friendly.enemies.health[allyIndex], 100);
  assert.ok(
    Math.hypot(
      friendly.enemies.externalVx[casterIndex],
      friendly.enemies.externalVz[casterIndex],
    ) > 0,
    "friendly casters remain eligible for neutral blast impulse",
  );

  const passThrough = sandboxSimulation();
  const passId = spawnEnemy(passThrough, 5.5, 4.5);
  spawnFireball(passThrough, {
    x: 5.5,
    z: 4.5,
    ownerId: passId,
    ownerKind: PROJECTILE_OWNER_KIND.enemyWizard,
    ownerTeam: ACTOR_TEAM.enemy,
  });
  passThrough.tick(null);
  enemyIndex = passThrough.enemies.findIndexById(passId);
  assert.equal(passThrough.enemies.health[enemyIndex], 100);
  assert.equal(passThrough.projectiles.activeCount, 1);
});

test("zero authored blast radius keeps fixed direct damage and finite physical state", () => {
  const simulation = sandboxSimulation();
  const definition = cloneFireballDefinition(
    simulation.getSpellDefinition(FIREBALL_SPELL_ID).definition,
  );
  definition.impact.blastRadius = 0;
  definition.impact.pressureImpulse = 5_000;
  definition.emission.burstCount = 0;
  simulation.tick({
    type: "applySpellDefinition",
    spellId: FIREBALL_SPELL_ID,
    expectedRevision: 1,
    definition,
  });
  const enemyId = spawnEnemy(simulation, 5.5, 4.5);
  spawnFireball(simulation, {
    x: simulation.enemies.x[0],
    z: simulation.enemies.z[0],
    ownerId: simulation.player.id,
    ownerKind: PROJECTILE_OWNER_KIND.player,
    ownerTeam: ACTOR_TEAM.player,
  });
  simulation.tick(null);
  const index = simulation.enemies.findIndexById(enemyId);
  assert.equal(simulation.enemies.health[index], 75);
  assert.ok(Number.isFinite(simulation.enemies.externalVx[index]));
  assert.ok(Number.isFinite(simulation.enemies.externalVz[index]));
  const event = simulation.impactEvents.toArray().at(-1);
  assert.equal(event.radius, 0);
  assert.equal(event.responses.find((response) => response.id === enemyId).damage, 25);
});

test("the obelisk identifies impacts and blocks splash like any solid cell", () => {
  const scenario = obeliskScenario({ x: 6.5, z: 4.5 });
  const simulation = sandboxSimulation({ scenario });
  const enemyId = spawnEnemy(simulation, 7.5, 4.5);
  spawnFireball(simulation, {
    x: 5.2,
    z: 4.5,
    vx: 120,
    ownerId: simulation.player.id,
    ownerKind: PROJECTILE_OWNER_KIND.player,
    ownerTeam: ACTOR_TEAM.player,
  });
  simulation.tick(null);
  const event = simulation.impactEvents.toArray().at(-1);
  assert.equal(event.hit.kind, "obelisk");
  assert.equal(event.hit.id, scenario.obelisk.spawnId);
  const response = event.responses.find(
    (value) => value.kind === "enemyWizard" && value.id === enemyId,
  );
  assert.ok(response?.blocked);
  assert.equal(response.damage, 0);
});

test("damage-free regeneration starts after 300 ticks and new damage restarts its timer", () => {
  const simulation = sandboxSimulation();
  const enemyId = spawnEnemy(simulation, 5.5, 4.5);
  const damage = () => spawnFireball(simulation, {
    x: simulation.enemies.x[simulation.enemies.findIndexById(enemyId)],
    z: simulation.enemies.z[simulation.enemies.findIndexById(enemyId)],
    ownerId: simulation.player.id,
    ownerKind: PROJECTILE_OWNER_KIND.player,
    ownerTeam: ACTOR_TEAM.player,
  });
  damage();
  simulation.tick(null);
  let index = simulation.enemies.findIndexById(enemyId);
  assert.equal(simulation.enemies.health[index], 75);
  for (let tick = 0; tick < 299; tick += 1) simulation.tick(null);
  index = simulation.enemies.findIndexById(enemyId);
  assert.equal(simulation.enemies.health[index], 75);
  simulation.tick(null);
  assert.ok(simulation.enemies.health[index] > 75);
  assert.ok(Math.abs(simulation.enemies.health[index] - (75 + 1 / 60)) < 1e-5);

  damage();
  simulation.tick(null);
  index = simulation.enemies.findIndexById(enemyId);
  assert.equal(simulation.enemies.damageFreeTicks[index], 0);
  assert.ok(Math.abs(simulation.enemies.health[index] - (50 + 1 / 60)) < 1e-5);
  simulation.tick(null);
  assert.equal(simulation.enemies.damageFreeTicks[index], 1);
  assert.ok(Math.abs(simulation.enemies.health[index] - (50 + 1 / 60)) < 1e-5);

  const playerSimulation = sandboxSimulation();
  const casterId = spawnEnemy(playerSimulation, 9.5, 7.5);
  spawnFireball(playerSimulation, {
    x: playerSimulation.player.x,
    z: playerSimulation.player.z,
    ownerId: casterId,
    ownerKind: PROJECTILE_OWNER_KIND.enemyWizard,
    ownerTeam: ACTOR_TEAM.enemy,
  });
  playerSimulation.tick(null);
  assert.equal(playerSimulation.player.health, 75);
  for (let tick = 0; tick < 299; tick += 1) playerSimulation.tick(null);
  assert.equal(playerSimulation.player.health, 75);
  playerSimulation.tick(null);
  assert.ok(Math.abs(playerSimulation.player.health - (75 + 1 / 60)) < 1e-9);
});

test("dead casters compact after projectile processing while their captured-revision effects survive", () => {
  const map = borderedMap(14, 10, { x: 2.5, z: 4.5 });
  const simulation = sandboxSimulation({ scenario: new ArenaScenario(map) });
  const doomedId = spawnEnemy(simulation, 5.5, 4.5, { spawnSequence: 11 });
  const survivorId = spawnEnemy(simulation, 9.5, 7.5, { spawnSequence: 12 });
  let doomedIndex = simulation.enemies.findIndexById(doomedId);
  simulation.enemies.health[doomedIndex] = 25;
  const survivorIndex = simulation.enemies.findIndexById(survivorId);
  simulation.enemies.cooldown[survivorIndex] = 1.25;
  simulation.enemies.castSequence[survivorIndex] = 7;
  simulation.enemies.aiState[survivorIndex] = 2;

  const deadCasterProjectile = spawnFireball(simulation, {
    x: 7.5,
    z: 2.5,
    vx: 9,
    ownerId: doomedId,
    ownerKind: PROJECTILE_OWNER_KIND.enemyWizard,
    ownerTeam: ACTOR_TEAM.enemy,
    definitionRevision: 1,
    effectId: 401,
  });
  const nextDefinition = cloneFireballDefinition(
    simulation.getSpellDefinition(FIREBALL_SPELL_ID).definition,
  );
  nextDefinition.impact.blastRadius = 4;
  nextDefinition.emission.burstCount = 0;
  spawnFireball(simulation, {
    x: simulation.enemies.x[doomedIndex],
    z: simulation.enemies.z[doomedIndex],
    ownerId: simulation.player.id,
    ownerKind: PROJECTILE_OWNER_KIND.player,
    ownerTeam: ACTOR_TEAM.player,
    effectId: 402,
  });
  simulation.tick({
    type: "applySpellDefinition",
    spellId: FIREBALL_SPELL_ID,
    expectedRevision: 1,
    definition: nextDefinition,
  });

  assert.equal(simulation.enemies.findIndexById(doomedId), -1);
  const compacted = simulation.enemies.findIndexById(survivorId);
  assert.equal(compacted, 0);
  assert.ok(Math.abs(simulation.enemies.cooldown[compacted] - (1.25 - 1 / 60)) < 1e-6);
  assert.equal(simulation.enemies.castSequence[compacted], 7);
  assert.equal(simulation.enemies.aiState[compacted], 0, "live AI may update before compaction");
  assert.ok(simulation.projectiles.findIndexById(deadCasterProjectile) >= 0);

  for (let tick = 0; tick < 120 && simulation.projectiles.findIndexById(deadCasterProjectile) >= 0; tick += 1) {
    simulation.tick(null);
  }
  const event = simulation.impactEvents.toArray().find(
    (value) => value.projectileId === deadCasterProjectile,
  );
  assert.ok(event);
  assert.deepEqual(event.owner, { kind: "enemyWizard", id: doomedId, team: "enemy" });
  assert.equal(event.definitionRevision, 1);
  assert.equal(event.radius, 2.5);
});

test("player defeat freezes autonomy for 90 ticks then restarts the same seed and applied revision", () => {
  const simulation = new Simulation({ particleBurstCount: 0, seed: 0xfeed_0600 });
  const definition = cloneFireballDefinition(
    simulation.getSpellDefinition(FIREBALL_SPELL_ID).definition,
  );
  definition.projectile.speed = 13;
  definition.emission.burstCount = 0;
  simulation.tick({
    type: "applySpellDefinition",
    spellId: FIREBALL_SPELL_ID,
    expectedRevision: 1,
    definition,
  });
  simulation.player.health = 25;
  const enemyId = simulation.enemies.id[0];
  spawnFireball(simulation, {
    x: simulation.player.x,
    z: simulation.player.z,
    ownerId: enemyId,
    ownerKind: PROJECTILE_OWNER_KIND.enemyWizard,
    ownerTeam: ACTOR_TEAM.enemy,
  });
  simulation.tick(null);
  assert.equal(simulation.levelState, "defeated");
  assert.equal(simulation.defeatedTicksRemaining, 90);
  assert.equal(simulation.player.health, 0);
  const frozen = {
    x: simulation.player.x,
    z: simulation.player.z,
    enemies: simulation.enemies.activeCount,
    projectiles: simulation.projectiles.activeCount,
    particles: simulation.particles.activeCount,
  };

  const revision3 = cloneFireballDefinition(definition);
  revision3.projectile.speed = 15;
  simulation.tick({
    move: { x: 20, z: 20 },
    cast: { x: 10, z: 10 },
    actions: [{
      type: "applySpellDefinition",
      spellId: FIREBALL_SPELL_ID,
      expectedRevision: 2,
      definition: revision3,
    }],
  });
  assert.equal(simulation.getSpellDefinition(FIREBALL_SPELL_ID).revision, 3);
  assert.equal(simulation.defeatedTicksRemaining, 89);
  assert.equal(simulation.player.x, frozen.x);
  assert.equal(simulation.player.z, frozen.z);
  assert.equal(simulation.enemies.activeCount, frozen.enemies);
  assert.equal(simulation.projectiles.activeCount, frozen.projectiles);
  assert.equal(simulation.particles.activeCount, frozen.particles);

  for (let tick = 0; tick < 88; tick += 1) simulation.tick({ cast: { x: 10, z: 10 } });
  assert.equal(simulation.levelState, "defeated");
  assert.equal(simulation.defeatedTicksRemaining, 1);
  simulation.tick(null);
  assert.equal(simulation.tickCount, 0);
  assert.equal(simulation.levelState, "running");
  assert.equal(simulation.player.health, 100);
  assert.equal(simulation.enemies.activeCount, 0);
  assert.equal(simulation.projectiles.activeCount, 0);
  assert.equal(simulation.particles.activeCount, 0);
  assert.equal(simulation.encounter.nextSpawnTick, 1);
  assert.equal(simulation.commandLog.length, 0);
  assert.equal(simulation.getSpellDefinition(FIREBALL_SPELL_ID).revision, 3);
  const recording = simulation.exportCommandLog();
  assert.equal(recording.seed, 0xfeed_0600);
  assert.equal(recording.configuration.spells[0].currentRevision, 3);
  assert.equal(recording.configuration.gameplayProfile, "obelisk-duel-v1");
  assert.equal(recording.configuration.enemyAiProfile, ENEMY_AI_PROFILE_INVESTIGATIVE);
});

test("manual reset during defeat ignores movement and casting and leaves a clean tick-zero baseline", () => {
  const simulation = new Simulation({ particleBurstCount: 0, seed: 0x0600_1234 });
  simulation.tick(null);
  simulation.player.health = COMBAT.directDamage;
  spawnFireball(simulation, {
    x: simulation.player.x,
    z: simulation.player.z,
    ownerId: simulation.enemies.id[0],
    ownerKind: PROJECTILE_OWNER_KIND.enemyWizard,
    ownerTeam: ACTOR_TEAM.enemy,
  });
  simulation.tick(null);
  assert.equal(simulation.levelState, "defeated");

  simulation.tick({
    move: { x: 22.5, z: 22.5 },
    cast: { x: 22.5, z: 22.5 },
    actions: [{ type: "reset", seed: simulation.seed }],
  });
  assert.equal(simulation.tickCount, 0);
  assert.equal(simulation.levelState, "running");
  assert.equal(simulation.player.x, simulation.map.playerSpawn.x);
  assert.equal(simulation.player.z, simulation.map.playerSpawn.z);
  assert.equal(simulation.player.health, COMBAT.maximumHealth);
  assert.equal(simulation.enemies.activeCount, 0);
  assert.equal(simulation.projectiles.activeCount, 0);
  assert.equal(simulation.encounter.nextSpawnTick, 1);
  assert.equal(simulation.commandLog.length, 0);
});

test("snapshots, queries, diagnostics, ownership, and combat history expose bounded schema-v11 state", () => {
  const simulation = sandboxSimulation();
  const enemyId = spawnEnemy(simulation, 5.5, 4.5, { spawnSequence: 9 });
  for (let tick = 0; tick < 300; tick += 1) {
    const index = simulation.enemies.findIndexById(enemyId);
    spawnFireball(simulation, {
      x: simulation.enemies.x[index],
      z: simulation.enemies.z[index],
      ownerId: simulation.player.id,
      ownerKind: PROJECTILE_OWNER_KIND.player,
      ownerTeam: ACTOR_TEAM.player,
      effectId: tick + 1,
    });
    simulation.tick(null);
    const current = simulation.enemies.findIndexById(enemyId);
    simulation.enemies.health[current] = 100;
  }
  const snapshot = simulation.snapshot();
  assert.equal(snapshot.schemaVersion, 13);
  assert.equal(snapshot.player.maximumHealth, 100);
  assert.equal(snapshot.enemies[0].maximumHealth, 100);
  assert.equal(snapshot.pools.enemies.capacity, 4);
  assert.equal(snapshot.recentCombatEvents.length, COMBAT.snapshotEventCount);
  assert.equal(snapshot.combatEventMetrics.retained, COMBAT.eventCapacity);
  assert.ok(snapshot.combatEventMetrics.dropped > 0);
  assert.equal(snapshot.projectiles.length, 0);
  const enemyQuery = simulation.queryAt(
    simulation.enemies.x[0],
    simulation.enemies.z[0],
  );
  assert.equal(enemyQuery.kind, "enemyWizard");
  assert.equal(enemyQuery.id, enemyId);
  assert.equal(simulation.resolveSelection({ kind: "enemyWizard", id: enemyId }).id, enemyId);

  const duel = new Simulation({ particleBurstCount: 0 });
  const obelisk = duel.scenario.obelisk;
  const obeliskQuery = duel.queryAt(obelisk.x, obelisk.z);
  assert.equal(obeliskQuery.kind, "obelisk");
  assert.equal(obeliskQuery.flags.invulnerable, true);
  assert.equal(duel.resolveSelection({ kind: "obelisk", id: obeliskQuery.id }).id, obeliskQuery.id);
  const diagnostics = duel.encounterDiagnostics();
  assert.equal(diagnostics.level.state, "running");
  assert.equal(diagnostics.encounter.nextSpawnTick, 1);
});

test("schema-v11 replay is exact and schema-v2 through v5 force frozen pre-combat behavior", () => {
  const live = new Simulation({ seed: 0x7000_0007, particleBurstCount: 0 });
  for (let tick = 0; tick < 180; tick += 1) {
    live.tick({
      move: { x: 12.5, z: 12.5 },
      cast: tick % 30 === 0 ? { x: 15.5, z: 18.5 } : null,
    });
  }
  const recording = live.exportCommandLog();
  assert.equal(recording.schemaVersion, 13);
  assert.equal(recording.configuration.gameplayProfile, "obelisk-duel-v1");
  assert.equal(recording.configuration.enemyAiProfile, ENEMY_AI_PROFILE_INVESTIGATIVE);
  assert.deepEqual(Simulation.replay(recording).snapshot(), live.snapshot());
  assert.throws(
    () => Simulation.replay({
      ...recording,
      configuration: { ...recording.configuration, enemyAiProfile: "" },
    }),
    /invalid or missing gameplay profiles/,
  );

  const legacyMap = borderedMap(10, 8, { x: 2.5, z: 3.5 });
  legacyMap.set(7, 3, 1);
  const commands = Array.from({ length: 30 }, (_, tick) => ({
    tick: tick + 1,
    command: {
      move: tick < 15 ? { x: 5.5, z: 3.5 } : null,
      cast: tick === 0 ? { x: 8.5, z: 3.5 } : null,
      actions: [],
    },
  }));
  for (const schemaVersion of [2, 3, 4, 5]) {
    const legacy = {
      schemaVersion,
      seed: 0x2000 + schemaVersion,
      initialMap: legacyMap.toJSON(),
      configuration: {
        rockCapacity: 64,
        projectileCapacity: 128,
        particleCapacity: 4_096,
        particleBurstCount: 0,
        particleProfile: schemaVersion >= 4 ? "m0.2.5-balanced" : undefined,
        particleBounce: schemaVersion >= 4 ? true : undefined,
        particleWallCollision: schemaVersion >= 3 ? true : undefined,
        spells: schemaVersion >= 5
          ? live.spells.cloneBaseline()
          : undefined,
      },
      truncated: false,
      commands,
    };
    const replayed = Simulation.replay(legacy);
    assert.equal(replayed.gameplayProfile, GAMEPLAY_PROFILE_PRE_COMBAT);
    assert.equal(replayed.enemyAiProfile, ENEMY_AI_PROFILE_NONE);
    assert.equal(replayed.enemies.activeCount, 0);
    assert.equal(replayed.snapshot().encounter.enabled, false);
  }
});

test("default scenario authored state remains replay-safe without relying on simulation RNG", () => {
  const left = new Simulation({ seed: 0xabc0_0600, particleBurstCount: 0 });
  const right = new Simulation({ seed: 0xabc0_0600, particleBurstCount: 0 });
  assert.deepEqual(createDebugArenaScenario().toJSON(), left.scenario.toJSON());
  const rngState = left.rng.state;
  for (let tick = 0; tick < 180; tick += 1) {
    left.tick(null);
    right.tick(null);
  }
  assert.equal(left.rng.state, rngState);
  assert.deepEqual(left.snapshot(), right.snapshot());
});
