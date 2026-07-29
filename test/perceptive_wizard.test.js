import test from "node:test";
import assert from "node:assert/strict";

import {
  ACTOR_TEAM,
  COMBAT,
  ENEMY_AI_PROFILE_PERCEPTIVE,
  ENEMY_WIZARD,
  PERCEPTIVE_WIZARD,
  PROJECTILE_OWNER_KIND,
  SIMULATION,
} from "../src/config.js";
import {
  FIREBALL_SPELL_CODE,
  FIREBALL_SPELL_ID,
} from "../src/spells/fireball_definition.js";
import { GridMap } from "../src/sim/grid_map.js";
import { EnemyWizardPool } from "../src/sim/pools.js";
import {
  deterministicGuardHeading,
  guardSweepFacing,
  HUNT_PHASE,
  KNOWLEDGE_SOURCE,
  PERCEPTION_STATE,
  perceptiveLaneUint32,
  searchCandidate,
  turnFacing,
  visualCheck,
} from "../src/sim/perceptive_wizard.js";
import { ArenaScenario } from "../src/sim/scenario.js";
import { Simulation } from "../src/sim/simulation.js";

function borderedMap(width = 24, height = 16, spawn = { x: 3.5, z: 8.5 }) {
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

function simulationFor(map = borderedMap(), options = {}) {
  return new Simulation({
    scenario: new ArenaScenario(map),
    enemyAiProfile: ENEMY_AI_PROFILE_PERCEPTIVE,
    particleBurstCount: 0,
    seed: options.seed ?? 0x0800_0008,
  });
}

function spawnEnemy(simulation, value = {}) {
  const spawnSequence = value.spawnSequence ?? simulation.enemies.activeCount + 1;
  const id = simulation.enemies.spawn({
    spawnSequence,
    spawnTick: simulation.tickCount,
    x: value.x ?? 10.5,
    z: value.z ?? 8.5,
    radius: ENEMY_WIZARD.radius,
    massKg: ENEMY_WIZARD.massKg,
    maximumHealth: COMBAT.maximumHealth,
    shotReadyTick: value.shotReadyTick ?? 0xffff_ffff,
    facingX: value.facingX ?? -1,
    facingZ: value.facingZ ?? 0,
    guardX: value.guardX ?? value.x ?? 10.5,
    guardZ: value.guardZ ?? value.z ?? 8.5,
    guardBaseFacingX: value.guardBaseFacingX ?? value.facingX ?? -1,
    guardBaseFacingZ: value.guardBaseFacingZ ?? value.facingZ ?? 0,
    perceptionLane: value.perceptionLane ?? spawnSequence % PERCEPTIVE_WIZARD.perceptionLanes,
    guardSweepPhase: value.guardSweepPhase ?? 0,
  });
  assert.ok(id > 0);
  return id;
}

function tickUntil(simulation, targetTick, command = null) {
  while (simulation.tickCount < targetTick) simulation.tick(command);
}

test("visual checks pin cone, range, close-awareness, and grid occlusion boundaries", () => {
  const map = borderedMap(32, 24, { x: 2.5, z: 2.5 });
  const origin = { x: 10.5, z: 10.5 };
  const boundaryAngle = Math.PI / 3;
  const onCone = visualCheck(
    map,
    origin.x,
    origin.z,
    1,
    0,
    origin.x + Math.cos(boundaryAngle) * 12,
    origin.z + Math.sin(boundaryAngle) * 12,
  );
  assert.equal(onCone.visible, true);
  assert.equal(onCone.inRange, true);
  assert.equal(onCone.inCone, true);
  assert.equal(visualCheck(map, origin.x, origin.z, 1, 0, 22.5001, 10.5).visible, false);
  assert.equal(visualCheck(map, origin.x, origin.z, 1, 0, 9.0, 10.5).visible, true);
  assert.equal(visualCheck(map, origin.x, origin.z, 1, 0, 8.999, 10.5).visible, false);

  map.set(11, 10, 1);
  const blocked = visualCheck(map, origin.x, origin.z, 1, 0, 13.5, 10.5);
  assert.equal(blocked.visible, false);
  assert.equal(blocked.blocked, true);
  map.set(11, 10, 0);
  // Dynamic rocks never enter this geometry-only API.
  assert.equal(visualCheck(map, origin.x, origin.z, 1, 0, 13.5, 10.5).visible, true);
});

test("facing turns by at most 180 degrees per second and guard sweep stays within 45 degrees", () => {
  const turned = turnFacing(1, 0, -1, 0);
  const angle = Math.atan2(turned.z, turned.x);
  assert.ok(Math.abs(angle - Math.PI * SIMULATION.dt) < 1e-12);
  const heading = deterministicGuardHeading(0x0800_0008, 19);
  assert.ok(heading.ordinal >= 0 && heading.ordinal < 8);
  for (let tick = 0; tick <= PERCEPTIVE_WIZARD.guardSweepCycleTicks; tick += 1) {
    const sweep = guardSweepFacing(heading.x, heading.z, tick, 37);
    assert.ok(Math.abs(sweep.offsetRadians) <= Math.PI / 4 + 1e-12);
    assert.ok(Math.abs(Math.hypot(sweep.x, sweep.z) - 1) < 1e-12);
  }
});

test("perception lanes and search transforms are enemy-local, named, and stable", () => {
  const seed = 0x8123_4567;
  const pinned = {
    heading: perceptiveLaneUint32(seed, 7, "fallback-heading"),
    sweep: perceptiveLaneUint32(seed, 7, "guard-sweep-phase"),
    rotation: perceptiveLaneUint32(seed, 7, "search-rotation"),
    reverse: perceptiveLaneUint32(seed, 7, "search-reverse"),
  };
  perceptiveLaneUint32(seed, 99, "search-rotation", 45);
  assert.deepEqual({
    heading: perceptiveLaneUint32(seed, 7, "fallback-heading"),
    sweep: perceptiveLaneUint32(seed, 7, "guard-sweep-phase"),
    rotation: perceptiveLaneUint32(seed, 7, "search-rotation"),
    reverse: perceptiveLaneUint32(seed, 7, "search-reverse"),
  }, pinned);
  const candidates = Array.from({ length: 24 }, (_, sequence) => (
    searchCandidate(seed, 7, 10, 10, sequence)
  ));
  assert.deepEqual(new Set(candidates.map((candidate) => candidate.radius)), new Set([1, 2, 3]));
  assert.equal(new Set(candidates.map((candidate) => `${candidate.cx}:${candidate.cz}`)).size, 24);
  assert.throws(
    () => perceptiveLaneUint32(seed, 7, "global-rng"),
    /Unknown perceptive lane/,
  );
});

test("staggered visual samples require an uninterrupted 15-tick exposure and reset exactly", () => {
  const simulation = simulationFor();
  spawnEnemy(simulation, { spawnSequence: 1, perceptionLane: 1 });
  simulation.tick(null);
  let enemy = simulation.snapshot().enemies[0];
  assert.equal(enemy.perceptionState, "noticing");
  assert.deepEqual(enemy.exposure, { progressTicks: 0, thresholdTicks: 15, startTick: 1 });
  tickUntil(simulation, 6);
  assert.equal(simulation.snapshot().enemies[0].exposure.progressTicks, 5);

  simulation.enemies.facingX[0] = 1;
  simulation.enemies.facingZ[0] = 0;
  tickUntil(simulation, 11);
  enemy = simulation.snapshot().enemies[0];
  assert.equal(enemy.perceptionState, "unaware");
  assert.equal(enemy.exposure.progressTicks, 0);

  simulation.enemies.facingX[0] = -1;
  simulation.enemies.facingZ[0] = 0;
  tickUntil(simulation, 16);
  assert.equal(simulation.snapshot().enemies[0].perceptionState, "noticing");
  tickUntil(simulation, 30);
  assert.equal(simulation.snapshot().enemies[0].perceptionState, "noticing");
  simulation.tick(null);
  enemy = simulation.snapshot().enemies[0];
  assert.equal(enemy.perceptionState, "engaged");
  assert.equal(enemy.exposure.progressTicks, 15);
  assert.equal(enemy.confirmedTarget.id, simulation.player.id);
  assert.equal(enemy.lastSeen.tick, 31);
});

test("lost sight stops casts, preserves a personal last-seen point, and reacquires on one sample", () => {
  const map = borderedMap();
  const simulation = simulationFor(map);
  const enemyId = spawnEnemy(
    simulation,
    { spawnSequence: 1, perceptionLane: 1, shotReadyTick: 1 },
  );
  tickUntil(simulation, 16);
  assert.equal(simulation.enemies.castSequence[0], 1);
  simulation.enemies.shotReadyTick[0] = 17;
  simulation.enemies.cooldown[0] = 0;
  simulation.tick({ type: "setTile", cx: 7, cz: 8, tile: 1 });
  assert.equal(simulation.enemies.castSequence[0], 1, "fresh grid LOS blocks a ready shot");
  assert.equal(simulation.enemies.shotReadyTick[0], 17, "blocked shots remain ready");
  tickUntil(simulation, 21);
  let enemy = simulation.snapshot().enemies[0];
  assert.equal(enemy.perceptionState, "hunting");
  assert.deepEqual(enemy.lastSeen.position, { x: 3.5, z: 8.5 });
  assert.equal(enemy.hunt.phase, "travel");

  simulation.tick({ type: "setTile", cx: 7, cz: 8, tile: 0 });
  simulation.enemies.facingX[0] = -1;
  simulation.enemies.facingZ[0] = 0;
  tickUntil(simulation, 26);
  enemy = simulation.snapshot().enemies[0];
  assert.equal(enemy.perceptionState, "engaged");
  assert.equal(enemy.lastSeen.tick, 26);
  assert.equal(
    simulation.snapshot().recentPerceptionEvents.at(-1).type,
    "reacquisition",
  );
  const diagnostics = simulation.enemyDiagnostics(enemyId);
  assert.equal(diagnostics.enemies.length, 1);
  assert.equal(diagnostics.enemies[0].perceptionState, "engaged");
  assert.equal(diagnostics.recentPerceptionEvents.at(-1).type, "reacquisition");
  assert.deepEqual(diagnostics.perceptionEventMetrics, {
    retained: simulation.perceptionEvents.length,
    capacity: PERCEPTIVE_WIZARD.perceptionEventCapacity,
    dropped: simulation.perceptionEventDropped,
  });
});

test("unseen damage creates an impact-only search and visible projectiles alone do not reveal owners", () => {
  const simulation = simulationFor();
  spawnEnemy(simulation, {
    x: 10.5,
    z: 8.5,
    facingX: 1,
    facingZ: 0,
    guardBaseFacingX: 1,
    perceptionLane: 4,
  });
  const spell = simulation.spells.get(FIREBALL_SPELL_ID);
  const definition = spell.definitions.get(spell.currentRevision);
  simulation.projectiles.spawn({
    x: 6.5,
    z: 8.5,
    vx: 9,
    vz: 0,
    lifetime: definition.projectile.lifetime,
    radius: definition.projectile.radius,
    ownerId: simulation.player.id,
    ownerKind: PROJECTILE_OWNER_KIND.player,
    ownerTeam: ACTOR_TEAM.player,
    spellCode: FIREBALL_SPELL_CODE,
    definitionRevision: spell.currentRevision,
    effectId: 91,
    effectSeed: 91,
  });
  simulation.tick(null);
  assert.equal(simulation.enemies.dodgeTicksRemaining[0], 0, "a threat behind facing is unseen");
  assert.equal(simulation.enemies.confirmedTargetId[0], 0);

  tickUntil(simulation, 30);
  const enemy = simulation.snapshot().enemies[0];
  assert.equal(enemy.health, 75);
  assert.equal(enemy.perceptionState, "hunting");
  assert.equal(enemy.knowledgeSource, "damage");
  assert.equal(enemy.confirmedTarget, null);
  assert.ok(enemy.stimulus);
  assert.equal(enemy.hunt.phase, "search");
  assert.equal(enemy.hunt.searchEndTick - enemy.hunt.searchStartTick, 480);
  assert.ok(
    simulation.snapshot().recentPerceptionEvents.some((event) => event.type === "damage-alert"),
  );
});

test("visible hostile projectiles can dodge without advancing player exposure", () => {
  const simulation = simulationFor();
  spawnEnemy(simulation, {
    x: 10.5,
    z: 8.5,
    facingX: -1,
    facingZ: 0,
    perceptionLane: 4,
  });
  const spell = simulation.spells.get(FIREBALL_SPELL_ID);
  const definition = spell.definitions.get(spell.currentRevision);
  simulation.projectiles.spawn({
    x: 6.5,
    z: 8.5,
    vx: 8,
    vz: 0,
    lifetime: 2,
    radius: definition.projectile.radius,
    ownerId: simulation.player.id,
    ownerKind: PROJECTILE_OWNER_KIND.player,
    ownerTeam: ACTOR_TEAM.player,
    spellCode: FIREBALL_SPELL_CODE,
    definitionRevision: spell.currentRevision,
    effectId: 55,
    effectSeed: 55,
  });
  simulation.tick(null);
  assert.equal(simulation.enemies.dodgeTicksRemaining[0], TACTICAL_DODGE_REMAINING_AFTER_FIRST_TICK);
  assert.equal(simulation.enemies.candidateTargetId[0], 0);
  assert.equal(simulation.enemies.exposureProgress[0], 0);
});

const TACTICAL_DODGE_REMAINING_AFTER_FIRST_TICK = 17;

test("search lasts exactly eight seconds, then return clears memory or rebases after timeout", () => {
  const map = borderedMap();
  for (let z = 1; z < map.height - 1; z += 1) map.set(6, z, 1);
  const simulation = simulationFor(map);
  spawnEnemy(simulation, {
    x: 10.5,
    z: 8.5,
    facingX: 1,
    facingZ: 0,
    guardX: 10.5,
    guardZ: 8.5,
    perceptionLane: 4,
  });
  const pool = simulation.enemies;
  pool.perceptionState[0] = PERCEPTION_STATE.hunting;
  pool.knowledgeSource[0] = KNOWLEDGE_SOURCE.visual;
  pool.confirmedTargetKind[0] = 1;
  pool.confirmedTargetId[0] = simulation.player.id;
  pool.confirmedTargetTeam[0] = ACTOR_TEAM.player;
  pool.hasLastSeen[0] = 1;
  pool.lastSeenX[0] = pool.x[0];
  pool.lastSeenZ[0] = pool.z[0];
  pool.lastSeenTick[0] = 1;
  pool.huntPhase[0] = HUNT_PHASE.travel;
  pool.huntAnchorX[0] = pool.x[0];
  pool.huntAnchorZ[0] = pool.z[0];
  pool.huntTravelStartTick[0] = 1;
  simulation.tick(null);
  let enemy = simulation.snapshot().enemies[0];
  assert.equal(enemy.hunt.phase, "search");
  const searchStart = enemy.hunt.searchStartTick;
  const searchEnd = enemy.hunt.searchEndTick;
  assert.equal(searchEnd - searchStart, PERCEPTIVE_WIZARD.searchTicks);
  tickUntil(simulation, searchEnd - 1);
  assert.equal(simulation.snapshot().enemies[0].perceptionState, "hunting");
  simulation.tick(null);
  enemy = simulation.snapshot().enemies[0];
  assert.equal(enemy.perceptionState, "returning");
  assert.ok(enemy.lastSeen, "return preserves memory until guard arrival");

  pool.guardX[0] = 2.5;
  pool.guardZ[0] = 2.5;
  pool.guardReturnStartTick[0] = simulation.tickCount;
  while (pool.guardUnreachableStartTick[0] === 0) simulation.tick(null);
  const unreachableStartTick = pool.guardUnreachableStartTick[0];
  tickUntil(
    simulation,
    unreachableStartTick + PERCEPTIVE_WIZARD.travelTimeoutTicks,
  );
  enemy = simulation.snapshot().enemies[0];
  assert.equal(enemy.perceptionState, "unaware");
  assert.equal(enemy.lastSeen, null);
  assert.deepEqual(enemy.guard.point, {
    x: Math.floor(enemy.x) + 0.5,
    z: Math.floor(enemy.z) + 0.5,
  });
});

test("a reachable long guard return does not rebase after twelve seconds", () => {
  const map = borderedMap(128, 8, { x: 3.5, z: 2.5 });
  const simulation = simulationFor(map);
  spawnEnemy(simulation, {
    x: 120.5,
    z: 4.5,
    facingX: 1,
    facingZ: 0,
    guardX: 2.5,
    guardZ: 4.5,
    perceptionLane: 4,
  });
  const pool = simulation.enemies;
  pool.perceptionState[0] = PERCEPTION_STATE.returning;
  pool.guardReturnStartTick[0] = 1;
  tickUntil(simulation, PERCEPTIVE_WIZARD.travelTimeoutTicks + 10);
  const enemy = simulation.snapshot().enemies[0];
  assert.equal(enemy.perceptionState, "returning");
  assert.deepEqual(enemy.guard.point, { x: 2.5, z: 4.5 });
  assert.equal(enemy.guard.unreachableStartTick, null);
  assert.ok(enemy.x > 40, "the distant but reachable guard has not yet been reached");
});

test("a route opened on the guard timeout tick invalidates stale unreachable proof", () => {
  const map = borderedMap();
  for (let z = 1; z < map.height - 1; z += 1) map.set(6, z, 1);
  const simulation = simulationFor(map);
  spawnEnemy(simulation, {
    x: 10.5,
    z: 8.5,
    facingX: 1,
    facingZ: 0,
    guardX: 2.5,
    guardZ: 8.5,
    perceptionLane: 4,
  });
  const pool = simulation.enemies;
  pool.perceptionState[0] = PERCEPTION_STATE.returning;
  pool.guardReturnStartTick[0] = 1;
  while (pool.guardUnreachableStartTick[0] === 0) simulation.tick(null);
  const unreachableStartTick = pool.guardUnreachableStartTick[0];
  tickUntil(
    simulation,
    unreachableStartTick + PERCEPTIVE_WIZARD.travelTimeoutTicks - 1,
  );
  simulation.tick({ type: "setTile", cx: 6, cz: 8, tile: 0 });
  const enemy = simulation.snapshot().enemies[0];
  assert.equal(enemy.perceptionState, "returning");
  assert.deepEqual(enemy.guard.point, { x: 2.5, z: 8.5 });
  assert.equal(enemy.guard.unreachableStartTick, null);
});

test("pool swap preserves every v8 perception and navigation identity component", () => {
  const pool = new EnemyWizardPool(4);
  for (let index = 0; index < 3; index += 1) {
    pool.spawn({
      spawnSequence: index + 1,
      spawnTick: index,
      x: index + 2,
      z: index + 3,
      radius: ENEMY_WIZARD.radius,
      massKg: ENEMY_WIZARD.massKg,
      maximumHealth: COMBAT.maximumHealth,
      shotReadyTick: index + 10,
    });
  }
  const components = [
    "perceptionState", "knowledgeSource", "perceptionLane", "currentVisibility",
    "visibilitySampleTick", "exposureStartTick", "exposureProgress",
    "noticingResumeState", "candidateTargetKind", "candidateTargetId",
    "candidateTargetTeam", "confirmedTargetKind", "confirmedTargetId",
    "confirmedTargetTeam", "facingX", "facingZ", "guardX", "guardZ",
    "guardBaseFacingX", "guardBaseFacingZ", "guardSweepPhase",
    "guardReturnStartTick", "guardUnreachableStartTick", "hasLastSeen", "lastSeenX", "lastSeenZ",
    "lastSeenVx", "lastSeenVz", "lastSeenTick", "huntPhase", "huntAnchorX",
    "huntAnchorZ", "huntTravelStartTick", "searchStartTick", "searchEndTick",
    "hasSearchGoal", "searchGoalX", "searchGoalZ", "searchGoalCx",
    "searchGoalCz", "searchGoalStartTick", "searchSequence", "hasStimulus",
    "stimulusX", "stimulusZ", "stimulusTick", "navigationSlot",
  ];
  for (let ordinal = 0; ordinal < components.length; ordinal += 1) {
    pool[components[ordinal]][2] = 100 + ordinal;
  }
  const expected = Object.fromEntries(components.map((name) => [name, pool[name][2]]));
  pool.removeSwap(0);
  for (const name of components) assert.equal(pool[name][0], expected[name], name);
});
