import test from "node:test";
import assert from "node:assert/strict";

import {
  ACTOR_TEAM,
  COMBAT,
  ENEMY_AI_PROFILE_INVESTIGATIVE,
  ENEMY_WIZARD,
  PERCEPTIVE_WIZARD,
  PROJECTILE_OWNER_KIND,
  TACTICAL_WIZARD,
} from "../src/config.js";
import {
  FIREBALL_SPELL_CODE,
  FIREBALL_SPELL_ID,
} from "../src/spells/fireball_definition.js";
import { GridMap } from "../src/sim/grid_map.js";
import { EnemyWizardPool } from "../src/sim/pools.js";
import {
  arbitrateInvestigationClue,
  fireballHearingCheck,
  inferProjectileOrigin,
  INVESTIGATION_DECISION,
  INVESTIGATION_PRIORITY,
  KNOWLEDGE_SOURCE,
  PERCEPTION_STATE,
  TARGET_KIND,
} from "../src/sim/perceptive_wizard.js";
import { ArenaScenario } from "../src/sim/scenario.js";
import { Simulation } from "../src/sim/simulation.js";

function borderedMap(width = 30, height = 20, spawn = { x: 2.5, z: 2.5 }) {
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

function investigativeSimulation(map = borderedMap(), options = {}) {
  return new Simulation({
    scenario: new ArenaScenario(map),
    enemyAiProfile: ENEMY_AI_PROFILE_INVESTIGATIVE,
    particleBurstCount: 0,
    seed: options.seed ?? 0x0900_0009,
    useBroadphase: options.useBroadphase,
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
    facingX: value.facingX ?? 1,
    facingZ: value.facingZ ?? 0,
    guardX: value.guardX ?? value.x ?? 10.5,
    guardZ: value.guardZ ?? value.z ?? 8.5,
    guardBaseFacingX: value.guardBaseFacingX ?? value.facingX ?? 1,
    guardBaseFacingZ: value.guardBaseFacingZ ?? value.facingZ ?? 0,
    perceptionLane: value.perceptionLane ?? 1,
    guardSweepPhase: value.guardSweepPhase ?? 0,
  });
  assert.ok(id > 0);
  return id;
}

function spawnFireball(simulation, value = {}) {
  const spell = simulation.spells.get(FIREBALL_SPELL_ID);
  const definition = spell.definitions.get(spell.currentRevision);
  const id = simulation.projectiles.spawn({
    x: value.x ?? 12.5,
    z: value.z ?? 8.5,
    vx: value.vx ?? 0,
    vz: value.vz ?? 0,
    lifetime: value.lifetime ?? definition.projectile.lifetime,
    radius: value.radius ?? definition.projectile.radius,
    ownerId: value.ownerId ?? simulation.player.id,
    ownerKind: value.ownerKind ?? PROJECTILE_OWNER_KIND.player,
    ownerTeam: value.ownerTeam ?? ACTOR_TEAM.player,
    spellCode: FIREBALL_SPELL_CODE,
    definitionRevision: spell.currentRevision,
    effectId: value.effectId ?? 1,
    effectSeed: value.effectSeed ?? value.effectId ?? 1,
  });
  assert.ok(id > 0);
  if (value.age !== undefined) {
    simulation.projectiles.age[simulation.projectiles.findIndexById(id)] = value.age;
  }
  return id;
}

function tickUntil(simulation, tick) {
  while (simulation.tickCount < tick) simulation.tick(null);
}

test("v9 constants append investigation values and trajectory reconstruction clamps to the map", () => {
  assert.equal(PERCEPTION_STATE.investigating, 5);
  assert.equal(KNOWLEDGE_SOURCE.projectile, 3);
  assert.equal(KNOWLEDGE_SOURCE.sound, 4);
  const map = borderedMap(24, 16);
  assert.deepEqual(
    inferProjectileOrigin(map, { x: 9.5, z: 7.5, vx: 4, vz: -2, age: 1.5 }),
    {
      x: 3.5,
      z: 10.5,
      rawX: 3.5,
      rawZ: 10.5,
      clamped: false,
    },
  );
  assert.deepEqual(
    inferProjectileOrigin(map, { x: 1, z: 15, vx: 20, vz: -20, age: 2 }),
    {
      x: 0.5,
      z: 15.5,
      rawX: -39,
      rawZ: 55,
      clamped: true,
    },
  );
});

test("hearing uses an inclusive 16m boundary and rejects allied or neutral sources", () => {
  assert.deepEqual(
    fireballHearingCheck(16, 0, ACTOR_TEAM.enemy, 0, 0, ACTOR_TEAM.player),
    { heard: true, hostile: true, inRange: true, distance: 16 },
  );
  assert.equal(
    fireballHearingCheck(16.0001, 0, ACTOR_TEAM.enemy, 0, 0, ACTOR_TEAM.player).heard,
    false,
  );
  assert.equal(
    fireballHearingCheck(1, 0, ACTOR_TEAM.enemy, 0, 0, ACTOR_TEAM.enemy).heard,
    false,
  );
  assert.equal(
    fireballHearingCheck(1, 0, ACTOR_TEAM.enemy, 0, 0, 0).heard,
    false,
  );
});

test("clue arbitration pins priority, freshness ties, and same-effect deduplication", () => {
  const current = {
    priority: INVESTIGATION_PRIORITY.projectile,
    observationTick: 20,
    effectId: 40,
    projectileId: 7,
  };
  assert.equal(arbitrateInvestigationClue(current, {
    priority: INVESTIGATION_PRIORITY.sound,
    observationTick: 21,
    effectId: 41,
    projectileId: 8,
  }).decision, INVESTIGATION_DECISION.priorityReject);
  assert.equal(arbitrateInvestigationClue(current, {
    priority: INVESTIGATION_PRIORITY.projectile,
    observationTick: 21,
    effectId: 1,
    projectileId: 1,
  }).decision, INVESTIGATION_DECISION.accept);
  assert.equal(arbitrateInvestigationClue(current, {
    priority: INVESTIGATION_PRIORITY.projectile,
    observationTick: 20,
    effectId: 41,
    projectileId: 1,
  }).reason, "same-tick-effect");
  assert.equal(arbitrateInvestigationClue({
    ...current,
    effectId: 0,
  }, {
    priority: INVESTIGATION_PRIORITY.projectile,
    observationTick: 20,
    effectId: 0,
    projectileId: 8,
  }).reason, "same-tick-projectile");
  assert.equal(arbitrateInvestigationClue(current, {
    priority: INVESTIGATION_PRIORITY.sound,
    observationTick: 99,
    effectId: 40,
    projectileId: 7,
  }).decision, INVESTIGATION_DECISION.deduplicate);
  assert.equal(arbitrateInvestigationClue({
    priority: INVESTIGATION_PRIORITY.sound,
    observationTick: 20,
    soundEventId: 4,
  }, {
    priority: INVESTIGATION_PRIORITY.sound,
    observationTick: 20,
    soundEventId: 5,
  }).reason, "same-tick-sound");
});

test("a visible non-threatening Fireball redirects anonymously to its reconstructed origin", () => {
  const map = borderedMap(30, 20, { x: 2.5, z: 8.5 });
  const simulation = investigativeSimulation(map);
  spawnEnemy(simulation, { x: 10.5, z: 8.5, facingX: 1, perceptionLane: 1 });
  spawnFireball(simulation, {
    x: 12.5,
    z: 8.5,
    vx: 2,
    vz: 0,
    age: 1,
    effectId: 70,
  });
  simulation.tick(null);
  const enemy = simulation.snapshot().enemies[0];
  assert.equal(enemy.perceptionState, "investigating");
  assert.equal(enemy.knowledgeSource, "projectile");
  assert.deepEqual(enemy.investigation.anchor, { x: 10.5, z: 8.5 });
  assert.deepEqual(enemy.investigation.inferredOrigin, { x: 10.5, z: 8.5 });
  assert.equal(enemy.investigation.effectId, 70);
  assert.equal(enemy.confirmedTarget, null);
  assert.equal(enemy.candidateTarget, null);
  assert.equal(enemy.exposure.progressTicks, 0);
  assert.equal(enemy.dodge.ticksRemaining, 0, "investigation is not limited to threats");
  assert.equal(enemy.castSequence, 0, "an inferred launch point never permits casting");
});

test("nearest projectile selection and ID ties are deterministic", () => {
  const simulation = investigativeSimulation(borderedMap(30, 20, { x: 2.5, z: 8.5 }));
  spawnEnemy(simulation, { x: 10.5, z: 8.5, facingX: 1, perceptionLane: 1 });
  spawnFireball(simulation, { x: 13.5, z: 8.5, effectId: 90 });
  const nearestId = spawnFireball(simulation, { x: 12.5, z: 8.5, effectId: 80 });
  spawnFireball(simulation, { x: 12.5, z: 8.5, effectId: 81 });
  simulation.tick(null);
  let investigation = simulation.snapshot().enemies[0].investigation;
  assert.equal(investigation.effectId, 80);
  assert.equal(investigation.projectileId, nearestId);

  const tied = investigativeSimulation(borderedMap(30, 20, { x: 2.5, z: 8.5 }));
  spawnEnemy(tied, { x: 10.5, z: 8.5, facingX: 1, perceptionLane: 1 });
  const firstId = spawnFireball(tied, { x: 12.5, z: 8.5, effectId: 50 });
  spawnFireball(tied, { x: 12.5, z: 8.5, effectId: 50 });
  tied.tick(null);
  investigation = tied.snapshot().enemies[0].investigation;
  assert.equal(investigation.projectileId, firstId);
});

test("repeated projectile samples update diagnostics without restarting travel", () => {
  const simulation = investigativeSimulation(borderedMap(40, 20, { x: 2.5, z: 8.5 }));
  spawnEnemy(simulation, { x: 10.5, z: 8.5, facingX: 1, perceptionLane: 1 });
  spawnFireball(simulation, {
    x: 16.5,
    z: 8.5,
    vx: 0.25,
    effectId: 120,
    lifetime: 10,
  });
  simulation.tick(null);
  const travelStart = simulation.enemies.huntTravelStartTick[0];
  const acceptedTick = simulation.enemies.investigationAcceptedTick[0];
  tickUntil(simulation, 6);
  assert.equal(simulation.enemies.huntTravelStartTick[0], travelStart);
  assert.equal(simulation.enemies.investigationAcceptedTick[0], acceptedTick);
  assert.equal(simulation.enemies.investigationObservationTick[0], 6);
  assert.ok(simulation.investigationEventMetrics.deduplicated >= 1);
});

test("newer same-priority projectile evidence redirects travel", () => {
  const simulation = investigativeSimulation(borderedMap(40, 20, { x: 2.5, z: 8.5 }));
  spawnEnemy(simulation, { x: 10.5, z: 8.5, facingX: 1, perceptionLane: 1 });
  spawnFireball(simulation, {
    x: 16.5,
    z: 8.5,
    vx: 0,
    effectId: 121,
    lifetime: 10,
  });
  simulation.tick(null);
  const firstTravelStart = simulation.enemies.huntTravelStartTick[0];
  const firstAnchor = simulation.enemies.huntAnchorX[0];

  spawnFireball(simulation, {
    x: 12.5,
    z: 8.5,
    vx: 0,
    effectId: 122,
    lifetime: 10,
  });
  tickUntil(simulation, 6);
  const enemy = simulation.snapshot().enemies[0];
  assert.equal(enemy.investigation.effectId, 122);
  assert.equal(enemy.investigation.observationTick, 6);
  assert.equal(enemy.hunt.travelStartTick, 6);
  assert.notEqual(enemy.hunt.anchor.x, firstAnchor);
  assert.notEqual(enemy.hunt.travelStartTick, firstTravelStart);
  assert.equal(simulation.investigationEventMetrics.acceptedRedirects, 2);
});

test("a seen Fireball outranks and deduplicates its later behind-wall explosion", () => {
  const map = borderedMap(30, 20, { x: 2.5, z: 8.5 });
  for (let z = 1; z < map.height - 1; z += 1) map.set(15, z, 1);
  const simulation = investigativeSimulation(map);
  spawnEnemy(simulation, { x: 10.5, z: 8.5, facingX: 1, perceptionLane: 1 });
  spawnFireball(simulation, { x: 14.8, z: 8.5, vx: 9, effectId: 130 });
  simulation.tick(null);
  const enemy = simulation.snapshot().enemies[0];
  assert.equal(enemy.investigation.source, "projectile");
  assert.equal(enemy.investigation.priority, INVESTIGATION_PRIORITY.projectile);
  assert.ok(enemy.investigation.anchor.x < 15);
  assert.equal(simulation.investigationEventMetrics.projectileObservations, 1);
  assert.equal(simulation.investigationEventMetrics.heardExplosions, 1);
  assert.ok(simulation.investigationEventMetrics.deduplicated >= 1);
  assert.equal(simulation.investigationEventMetrics.acceptedRedirects, 1);
});

test("an unseen hostile explosion crosses walls, starts moving next tick, and allied or neutral impacts are ignored", () => {
  const map = borderedMap(32, 20, { x: 2.5, z: 2.5 });
  for (let z = 1; z < map.height - 1; z += 1) map.set(15, z, 1);
  const simulation = investigativeSimulation(map);
  spawnEnemy(simulation, {
    x: 20.5,
    z: 10.5,
    facingX: 1,
    guardBaseFacingX: 1,
    perceptionLane: 4,
  });
  spawnFireball(simulation, { x: 14.8, z: 10.5, vx: 9, effectId: 140 });
  simulation.tick(null);
  let enemy = simulation.snapshot().enemies[0];
  assert.equal(enemy.perceptionState, "investigating");
  assert.equal(enemy.investigation.source, "sound");
  assert.equal(enemy.vx, 0, "the impact occurs after this tick's movement decision");
  simulation.tick(null);
  enemy = simulation.snapshot().enemies[0];
  assert.ok(enemy.vx < 0, "movement begins on the following tick");

  const allied = investigativeSimulation(map);
  spawnEnemy(allied, {
    x: 20.5,
    z: 10.5,
    facingX: 1,
    guardBaseFacingX: 1,
    perceptionLane: 4,
  });
  spawnFireball(allied, {
    x: 14.8,
    z: 10.5,
    vx: 9,
    effectId: 141,
    ownerId: 99,
    ownerKind: PROJECTILE_OWNER_KIND.enemyWizard,
    ownerTeam: ACTOR_TEAM.enemy,
  });
  allied.tick(null);
  assert.equal(allied.snapshot().enemies[0].perceptionState, "unaware");
  assert.equal(allied.investigationEventMetrics.heardExplosions, 0);

  const neutral = investigativeSimulation(map);
  spawnEnemy(neutral, {
    x: 20.5,
    z: 10.5,
    facingX: 1,
    guardBaseFacingX: 1,
    perceptionLane: 4,
  });
  spawnFireball(neutral, {
    x: 14.8,
    z: 10.5,
    vx: 9,
    effectId: 142,
    ownerId: 0,
    ownerKind: 0,
    ownerTeam: 0,
  });
  neutral.tick(null);
  assert.equal(neutral.snapshot().enemies[0].perceptionState, "unaware");
  assert.equal(neutral.investigationEventMetrics.heardExplosions, 0);
});

test("damage redirects sound, last-seen supersedes damage, and then rejects lower clues", () => {
  const map = borderedMap(40, 20, { x: 2.5, z: 8.5 });
  map.set(20, 8, 1);
  const simulation = investigativeSimulation(map);
  spawnEnemy(simulation, { x: 18.5, z: 8.5, facingX: 1, perceptionLane: 4 });
  spawnFireball(simulation, { x: 20.8, z: 8.5, vx: -9, effectId: 150 });
  simulation.tick(null);
  assert.equal(simulation.snapshot().enemies[0].investigation.source, "sound");

  const index = 0;
  spawnFireball(simulation, {
    x: simulation.enemies.x[index],
    z: simulation.enemies.z[index],
    effectId: 151,
  });
  simulation.tick(null);
  let enemy = simulation.snapshot().enemies[0];
  assert.equal(enemy.investigation.source, "damage");
  assert.equal(enemy.perceptionState, "investigating");
  assert.equal(enemy.hunt.phase, "search");

  const retainedAnchor = { ...enemy.investigation.anchor };
  simulation.enemies.currentVisibility[index] = 0;
  simulation.enemies.perceptionState[index] = PERCEPTION_STATE.engaged;
  simulation.enemies.confirmedTargetKind[index] = TARGET_KIND.player;
  simulation.enemies.confirmedTargetId[index] = simulation.player.id;
  simulation.enemies.confirmedTargetTeam[index] = ACTOR_TEAM.player;
  simulation.enemies.hasLastSeen[index] = 1;
  simulation.enemies.lastSeenX[index] = 8.5;
  simulation.enemies.lastSeenZ[index] = 8.5;
  simulation.enemies.lastSeenTick[index] = simulation.tickCount + 1;
  simulation.enemies.perceptionLane[index] = (simulation.tickCount + 1)
    % PERCEPTIVE_WIZARD.perceptionLanes;
  simulation.tick(null);
  enemy = simulation.snapshot().enemies[0];
  assert.equal(enemy.perceptionState, "hunting");
  assert.equal(enemy.investigation.priority, INVESTIGATION_PRIORITY.lastSeen);
  assert.deepEqual(enemy.investigation.anchor, { x: 8.5, z: 8.5 });
  assert.notDeepEqual(enemy.investigation.anchor, retainedAnchor);

  const lastSeenTravelStart = enemy.hunt.travelStartTick;
  const rejectionsBefore = simulation.investigationEventMetrics.priorityRejected;
  simulation.enemies.perceptionLane[index] = 0;
  spawnFireball(simulation, {
    x: simulation.enemies.x[index],
    z: simulation.enemies.z[index],
    effectId: 152,
  });
  simulation.tick(null);
  enemy = simulation.snapshot().enemies[0];
  assert.equal(enemy.perceptionState, "hunting");
  assert.equal(enemy.investigation.priority, INVESTIGATION_PRIORITY.lastSeen);
  assert.deepEqual(enemy.investigation.anchor, { x: 8.5, z: 8.5 });
  assert.equal(enemy.hunt.travelStartTick, lastSeenTravelStart);
  assert.ok(simulation.investigationEventMetrics.priorityRejected >= rejectionsBefore + 2);
});

test("anonymous exposure needs 15 uninterrupted ticks, resumes its clue, and later reacquires immediately", () => {
  const map = borderedMap(40, 20, { x: 18.5, z: 8.5 });
  const simulation = investigativeSimulation(map);
  spawnEnemy(simulation, {
    x: 10.5,
    z: 8.5,
    facingX: -1,
    guardBaseFacingX: -1,
    perceptionLane: 1,
    shotReadyTick: 1,
  });
  spawnFireball(simulation, { x: 6.5, z: 8.5, vx: 0, effectId: 160, lifetime: 10 });
  simulation.tick(null);
  const travelStart = simulation.enemies.huntTravelStartTick[0];
  assert.equal(simulation.enemies.perceptionState[0], PERCEPTION_STATE.investigating);
  assert.equal(simulation.enemies.castSequence[0], 0);

  simulation.player.x = 8.5;
  simulation.player.z = 8.5;
  while (simulation.tickCount < 6) {
    simulation.enemies.facingX[0] = -1;
    simulation.enemies.facingZ[0] = 0;
    simulation.tick(null);
  }
  assert.equal(simulation.enemies.perceptionState[0], PERCEPTION_STATE.noticing);
  assert.equal(simulation.enemies.confirmedTargetId[0], 0);
  simulation.player.x = 18.5;
  while (simulation.tickCount < 11) {
    simulation.enemies.facingX[0] = -1;
    simulation.enemies.facingZ[0] = 0;
    simulation.tick(null);
  }
  assert.equal(simulation.enemies.perceptionState[0], PERCEPTION_STATE.investigating);
  assert.equal(simulation.enemies.huntTravelStartTick[0], travelStart);

  simulation.player.x = 8.5;
  while (simulation.tickCount < 36) {
    simulation.enemies.facingX[0] = -1;
    simulation.enemies.facingZ[0] = 0;
    simulation.tick(null);
  }
  assert.equal(simulation.enemies.perceptionState[0], PERCEPTION_STATE.engaged);
  assert.equal(simulation.enemies.confirmedTargetId[0], simulation.player.id);
  assert.equal(simulation.enemies.investigationPriority[0], INVESTIGATION_PRIORITY.projectile);

  simulation.player.x = 18.5;
  while (simulation.tickCount < 41) {
    simulation.enemies.facingX[0] = -1;
    simulation.enemies.facingZ[0] = 0;
    simulation.tick(null);
  }
  assert.equal(simulation.enemies.perceptionState[0], PERCEPTION_STATE.investigating);
  assert.equal(simulation.enemies.confirmedTargetId[0], simulation.player.id);

  simulation.player.x = 8.5;
  while (simulation.tickCount < 46) {
    simulation.enemies.facingX[0] = -1;
    simulation.enemies.facingZ[0] = 0;
    simulation.tick(null);
  }
  assert.equal(simulation.enemies.perceptionState[0], PERCEPTION_STATE.engaged);
  assert.equal(simulation.enemies.confirmedTargetId[0], simulation.player.id);
});

test("dodge and retreat override movement without discarding an investigation clue", () => {
  const map = borderedMap(30, 20, { x: 18.5, z: 8.5 });
  const simulation = investigativeSimulation(map);
  spawnEnemy(simulation, {
    x: 10.5,
    z: 8.5,
    facingX: -1,
    guardBaseFacingX: -1,
    perceptionLane: 1,
  });
  simulation.enemies.health[0] = TACTICAL_WIZARD.retreatEnterHealth;
  spawnFireball(simulation, { x: 6.5, z: 8.5, vx: 9, effectId: 170 });
  simulation.tick(null);
  let enemy = simulation.snapshot().enemies[0];
  assert.equal(enemy.behaviorState, "dodge");
  assert.equal(enemy.perceptionState, "investigating");
  assert.equal(enemy.investigation.effectId, 170);
  const anchor = { ...enemy.investigation.anchor };

  simulation.projectiles.reset();
  simulation.enemies.dodgeTicksRemaining[0] = 0;
  simulation.enemies.dodgeCooldownTicks[0] = 1;
  simulation.tick(null);
  enemy = simulation.snapshot().enemies[0];
  assert.equal(enemy.behaviorState, "retreat");
  assert.equal(enemy.perceptionState, "investigating");
  assert.deepEqual(enemy.investigation.anchor, anchor);
});

test("investigation uses the existing 480-tick search and returns to guard", () => {
  const map = borderedMap(48, 20, { x: 2.5, z: 2.5 });
  map.set(22, 10, 1);
  const simulation = investigativeSimulation(map);
  spawnEnemy(simulation, {
    x: 21.5,
    z: 10.5,
    facingX: 1,
    guardBaseFacingX: 1,
    perceptionLane: 4,
  });
  spawnFireball(simulation, { x: 21.8, z: 10.5, vx: 9, effectId: 180 });
  simulation.tick(null);
  simulation.tick(null);
  let enemy = simulation.snapshot().enemies[0];
  assert.equal(enemy.perceptionState, "investigating");
  assert.equal(enemy.hunt.phase, "search");
  assert.equal(
    enemy.hunt.searchEndTick - enemy.hunt.searchStartTick,
    PERCEPTIVE_WIZARD.searchTicks,
  );
  tickUntil(simulation, enemy.hunt.searchEndTick);
  enemy = simulation.snapshot().enemies[0];
  assert.equal(enemy.perceptionState, "returning");
  for (let tick = 0; tick < 240 && simulation.enemies.perceptionState[0] !== PERCEPTION_STATE.unaware; tick += 1) {
    simulation.tick(null);
  }
  enemy = simulation.snapshot().enemies[0];
  assert.equal(enemy.perceptionState, "unaware");
  assert.equal(enemy.investigation.active, false);
});

test("pool reset and swap-move cover every investigation component", () => {
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
    "investigationSource",
    "investigationPriority",
    "investigationAnchorX",
    "investigationAnchorZ",
    "investigationObservationTick",
    "investigationAcceptedTick",
    "investigationEffectId",
    "investigationProjectileId",
    "investigationSoundEventId",
    "investigationSoundKind",
    "investigationSoundRadius",
    "investigationProjectileX",
    "investigationProjectileZ",
    "investigationProjectileVx",
    "investigationProjectileVz",
    "investigationProjectileAge",
    "investigationOriginX",
    "investigationOriginZ",
  ];
  for (let ordinal = 0; ordinal < components.length; ordinal += 1) {
    pool[components[ordinal]][2] = 200 + ordinal;
  }
  const expected = Object.fromEntries(components.map((name) => [name, pool[name][2]]));
  pool.removeSwap(0);
  for (const name of components) assert.equal(pool[name][0], expected[name], name);

  pool.reset();
  pool.spawn({
    spawnSequence: 9,
    spawnTick: 9,
    x: 1,
    z: 1,
    radius: ENEMY_WIZARD.radius,
    massKg: ENEMY_WIZARD.massKg,
    maximumHealth: COMBAT.maximumHealth,
    shotReadyTick: 9,
  });
  assert.equal(pool.investigationPriority[0], INVESTIGATION_PRIORITY.none);
  assert.equal(pool.investigationSource[0], KNOWLEDGE_SOURCE.none);
  assert.equal(pool.investigationSoundEventId[0], 0);
  assert.equal(pool.investigationSoundKind[0], 0);
  assert.equal(pool.investigationSoundRadius[0], 0);
  assert.equal(Number.isNaN(pool.investigationAnchorX[0]), true);
  assert.equal(Number.isNaN(pool.investigationProjectileX[0]), true);
});
