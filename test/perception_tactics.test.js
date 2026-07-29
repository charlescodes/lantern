import test from "node:test";
import assert from "node:assert/strict";

import {
  ACTOR_TEAM,
  COMBAT,
  ENEMY_AI_PROFILE_PERCEPTIVE,
  ENEMY_WIZARD,
  PERCEPTIVE_WIZARD,
  PROJECTILE_OWNER_KIND,
  TACTICAL_WIZARD,
} from "../src/config.js";
import { PresentationFlags } from "../src/presentation/options.js";
import {
  cloneFireballDefinition,
  FIREBALL_SPELL_CODE,
  FIREBALL_SPELL_ID,
} from "../src/spells/fireball_definition.js";
import { GridMap } from "../src/sim/grid_map.js";
import {
  HUNT_PHASE,
  KNOWLEDGE_SOURCE,
  PERCEPTION_STATE,
  TARGET_KIND,
} from "../src/sim/perceptive_wizard.js";
import { ArenaScenario } from "../src/sim/scenario.js";
import { Simulation } from "../src/sim/simulation.js";
import { TrueSightSystem } from "../src/visibility/true_sight.js";

function borderedMap(width = 20, height = 14, spawn = { x: 2.5, z: 6.5 }) {
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

function perceptiveSimulation(map = borderedMap(), seed = 0x0800_7ac7) {
  return new Simulation({
    scenario: new ArenaScenario(map),
    seed,
    particleBurstCount: 0,
    enemyAiProfile: ENEMY_AI_PROFILE_PERCEPTIVE,
  });
}

function spawnEnemy(simulation, x, z, options = {}) {
  const dx = simulation.player.x - x;
  const dz = simulation.player.z - z;
  const length = Math.hypot(dx, dz) || 1;
  const spawnSequence = options.spawnSequence ?? simulation.enemies.activeCount + 1;
  const id = simulation.enemies.spawn({
    spawnSequence,
    spawnTick: simulation.tickCount,
    x,
    z,
    radius: ENEMY_WIZARD.radius,
    massKg: ENEMY_WIZARD.massKg,
    maximumHealth: COMBAT.maximumHealth,
    shotReadyTick: options.shotReadyTick ?? 0xffff_ffff,
    facingX: options.facingX ?? dx / length,
    facingZ: options.facingZ ?? dz / length,
    guardX: x,
    guardZ: z,
    guardBaseFacingX: options.facingX ?? dx / length,
    guardBaseFacingZ: options.facingZ ?? dz / length,
    perceptionLane: options.perceptionLane ?? spawnSequence % PERCEPTIVE_WIZARD.perceptionLanes,
    guardSweepPhase: 0,
  });
  assert.ok(id > 0);
  return id;
}

function forceEngaged(simulation, index) {
  const pool = simulation.enemies;
  const dx = simulation.player.x - pool.x[index];
  const dz = simulation.player.z - pool.z[index];
  const length = Math.hypot(dx, dz) || 1;
  pool.facingX[index] = dx / length;
  pool.facingZ[index] = dz / length;
  pool.perceptionState[index] = PERCEPTION_STATE.engaged;
  pool.knowledgeSource[index] = KNOWLEDGE_SOURCE.visual;
  pool.currentVisibility[index] = 1;
  pool.exposureProgress[index] = PERCEPTIVE_WIZARD.exposureTicks;
  pool.confirmedTargetKind[index] = TARGET_KIND.player;
  pool.confirmedTargetId[index] = simulation.player.id;
  pool.confirmedTargetTeam[index] = ACTOR_TEAM.player;
  pool.hasLastSeen[index] = 1;
  pool.lastSeenX[index] = simulation.player.x;
  pool.lastSeenZ[index] = simulation.player.z;
  pool.lastSeenVx[index] = simulation.player.vx;
  pool.lastSeenVz[index] = simulation.player.vz;
  pool.lastSeenTick[index] = simulation.tickCount;
}

function spawnPlayerFireball(simulation, value) {
  const spell = simulation.spells.get(FIREBALL_SPELL_ID);
  const definition = spell.definitions.get(spell.currentRevision);
  const id = simulation.projectiles.spawn({
    x: value.x,
    z: value.z,
    vx: value.vx ?? 0,
    vz: value.vz ?? 0,
    lifetime: definition.projectile.lifetime,
    radius: definition.projectile.radius,
    ownerId: simulation.player.id,
    ownerKind: PROJECTILE_OWNER_KIND.player,
    ownerTeam: ACTOR_TEAM.player,
    spellCode: FIREBALL_SPELL_CODE,
    definitionRevision: spell.currentRevision,
    effectId: value.effectId,
    effectSeed: value.effectId,
  });
  assert.ok(id > 0);
  return id;
}

test("personal visual memory never alerts another mob and a damage-only clue still needs full exposure", () => {
  const map = borderedMap(18, 16, { x: 3.5, z: 8.5 });
  const simulation = perceptiveSimulation(map);
  const visualId = spawnEnemy(simulation, 10.5, 8.5, {
    spawnSequence: 1,
    perceptionLane: 1,
  });
  const unawareId = spawnEnemy(simulation, 10.5, 12.5, {
    spawnSequence: 2,
    perceptionLane: 2,
    facingX: 1,
    facingZ: 0,
  });
  while (simulation.tickCount < 16) simulation.tick(null);
  let visualIndex = simulation.enemies.findIndexById(visualId);
  let unawareIndex = simulation.enemies.findIndexById(unawareId);
  assert.equal(simulation.enemies.perceptionState[visualIndex], PERCEPTION_STATE.engaged);
  assert.equal(simulation.enemies.perceptionState[unawareIndex], PERCEPTION_STATE.unaware);
  assert.equal(simulation.enemies.hasLastSeen[unawareIndex], 0);
  assert.equal(simulation.enemies.confirmedTargetId[unawareIndex], 0);

  simulation.tick({ type: "setTile", cx: 7, cz: 8, tile: 1 });
  while (simulation.tickCount < 21) simulation.tick(null);
  visualIndex = simulation.enemies.findIndexById(visualId);
  unawareIndex = simulation.enemies.findIndexById(unawareId);
  assert.equal(simulation.enemies.perceptionState[visualIndex], PERCEPTION_STATE.hunting);
  assert.equal(simulation.enemies.perceptionState[unawareIndex], PERCEPTION_STATE.unaware);
  assert.notEqual(simulation.enemies.lastSeenTick[visualIndex], 0);
  assert.equal(simulation.enemies.lastSeenTick[unawareIndex], 0);

  spawnPlayerFireball(simulation, {
    x: simulation.enemies.x[unawareIndex],
    z: simulation.enemies.z[unawareIndex],
    effectId: 800,
  });
  simulation.tick(null);
  unawareIndex = simulation.enemies.findIndexById(unawareId);
  assert.equal(simulation.enemies.knowledgeSource[unawareIndex], KNOWLEDGE_SOURCE.damage);
  assert.equal(simulation.enemies.perceptionState[unawareIndex], PERCEPTION_STATE.hunting);
  assert.equal(simulation.enemies.confirmedTargetId[unawareIndex], 0);

  const holdX = simulation.enemies.x[unawareIndex];
  const holdZ = simulation.enemies.z[unawareIndex];
  const facePlayer = () => {
    unawareIndex = simulation.enemies.findIndexById(unawareId);
    simulation.enemies.x[unawareIndex] = holdX;
    simulation.enemies.z[unawareIndex] = holdZ;
    simulation.enemies.previousX[unawareIndex] = holdX;
    simulation.enemies.previousZ[unawareIndex] = holdZ;
    const dx = simulation.player.x - holdX;
    const dz = simulation.player.z - holdZ;
    const length = Math.hypot(dx, dz);
    simulation.enemies.facingX[unawareIndex] = dx / length;
    simulation.enemies.facingZ[unawareIndex] = dz / length;
  };
  while (true) {
    facePlayer();
    simulation.tick(null);
    unawareIndex = simulation.enemies.findIndexById(unawareId);
    if (simulation.enemies.visibilitySampleTick[unawareIndex] === simulation.tickCount) break;
  }
  const firstSample = simulation.tickCount;
  assert.equal(simulation.enemies.perceptionState[unawareIndex], PERCEPTION_STATE.noticing);
  assert.equal(simulation.enemies.exposureProgress[unawareIndex], 0);
  while (simulation.tickCount < firstSample + PERCEPTIVE_WIZARD.exposureTicks) {
    facePlayer();
    simulation.tick(null);
  }
  unawareIndex = simulation.enemies.findIndexById(unawareId);
  assert.equal(simulation.enemies.perceptionState[unawareIndex], PERCEPTION_STATE.engaged);
  assert.equal(simulation.enemies.confirmedTargetId[unawareIndex], simulation.player.id);
});

test("perceptive engagement retains strafe, range control, intercept, Apply ordering, and blocked readiness", () => {
  const map = borderedMap(20, 14, { x: 2.5, z: 6.5 });
  const slow = perceptiveSimulation(map, 0x0800_a11a);
  const fast = perceptiveSimulation(map, 0x0800_a11a);
  spawnEnemy(slow, 10.5, 6.5, { shotReadyTick: 1, perceptionLane: 4 });
  spawnEnemy(fast, 10.5, 6.5, { shotReadyTick: 1, perceptionLane: 4 });
  forceEngaged(slow, 0);
  forceEngaged(fast, 0);
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
  assert.ok(Math.abs(Math.hypot(slowEnemy.desiredVx, slowEnemy.desiredVz) - 3.5) < 1e-6);
  assert.ok(slowEnemy.predictedAimPoint.z > slow.player.z);
  assert.ok(slowEnemy.aimLeadTime > fastEnemy.aimLeadTime);
  assert.ok(Math.abs(Math.hypot(fast.projectiles.vx[0], fast.projectiles.vz[0]) - 18) < 1e-5);

  slow.projectiles.reset();
  slow.enemies.shotReadyTick[0] = 0xffff_ffff;
  slow.enemies.x[0] = 13.5;
  slow.enemies.z[0] = 6.5;
  forceEngaged(slow, 0);
  slow.tick(null);
  assert.equal(slow.snapshot().enemies[0].behaviorState, "approach");
  assert.ok(slow.enemies.desiredVx[0] < 0);
  slow.enemies.x[0] = 7.5;
  slow.enemies.z[0] = 6.5;
  forceEngaged(slow, 0);
  slow.tick(null);
  assert.equal(slow.snapshot().enemies[0].behaviorState, "withdraw");
  assert.ok(slow.enemies.desiredVx[0] > 0);

  const blockedMap = borderedMap(20, 14, { x: 2.5, z: 6.5 });
  blockedMap.set(6, 6, 1);
  const blocked = perceptiveSimulation(blockedMap);
  spawnEnemy(blocked, 10.5, 6.5, { shotReadyTick: 1, perceptionLane: 4 });
  forceEngaged(blocked, 0);
  blocked.tick(null);
  assert.equal(blocked.projectiles.activeCount, 0);
  assert.equal(blocked.enemies.shotReadyTick[0], 1);
  assert.equal(blocked.enemies.lineOfSight[0], 0);
});

test("perceptive dodge precedes retreat, suppresses casting, and resumes at 60 health without losing memory", () => {
  const simulation = perceptiveSimulation(borderedMap(20, 14, { x: 2.5, z: 6.5 }));
  const enemyId = spawnEnemy(simulation, 9.5, 6.5, {
    shotReadyTick: 1,
    perceptionLane: 4,
  });
  forceEngaged(simulation, 0);
  simulation.enemies.health[0] = TACTICAL_WIZARD.retreatEnterHealth;
  spawnPlayerFireball(simulation, {
    x: 5.5,
    z: 6.5,
    vx: 9,
    vz: 0,
    effectId: 801,
  });
  simulation.tick(null);
  let index = simulation.enemies.findIndexById(enemyId);
  assert.equal(simulation.enemies.retreating[index], 1);
  assert.equal(simulation.snapshot().enemies[index].behaviorState, "dodge");
  assert.equal(simulation.enemies.castSequence[index], 0);
  assert.equal(simulation.enemies.perceptionState[index], PERCEPTION_STATE.engaged);
  assert.equal(simulation.enemies.hasLastSeen[index], 1);

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
  index = simulation.enemies.findIndexById(enemyId);
  assert.equal(simulation.enemies.retreating[index], 0);
  assert.equal(simulation.enemies.castSequence[index], 1);
  assert.equal(simulation.enemies.perceptionState[index], PERCEPTION_STATE.engaged);
});

test("search clocks continue under retreat and returning memory reacquires on its first sample", () => {
  const simulation = perceptiveSimulation();
  const enemyId = spawnEnemy(simulation, 10.5, 6.5, { perceptionLane: 3 });
  const pool = simulation.enemies;
  pool.perceptionState[0] = PERCEPTION_STATE.hunting;
  pool.knowledgeSource[0] = KNOWLEDGE_SOURCE.visual;
  pool.confirmedTargetKind[0] = TARGET_KIND.player;
  pool.confirmedTargetId[0] = simulation.player.id;
  pool.confirmedTargetTeam[0] = ACTOR_TEAM.player;
  pool.hasLastSeen[0] = 1;
  pool.lastSeenX[0] = simulation.player.x;
  pool.lastSeenZ[0] = simulation.player.z;
  pool.huntPhase[0] = HUNT_PHASE.search;
  pool.huntAnchorX[0] = 10.5;
  pool.huntAnchorZ[0] = 6.5;
  pool.searchStartTick[0] = 1;
  pool.searchEndTick[0] = 3;
  pool.guardX[0] = 15.5;
  pool.guardZ[0] = 6.5;
  pool.health[0] = 30;
  pool.facingX[0] = 1;
  pool.facingZ[0] = 0;
  while (simulation.tickCount < 3) simulation.tick(null);
  assert.equal(pool.retreating[0], 1);
  assert.equal(pool.perceptionState[0], PERCEPTION_STATE.returning);
  assert.equal(pool.hasLastSeen[0], 1);

  pool.health[0] = 60;
  const dx = simulation.player.x - pool.x[0];
  const dz = simulation.player.z - pool.z[0];
  const length = Math.hypot(dx, dz);
  pool.facingX[0] = dx / length;
  pool.facingZ[0] = dz / length;
  while (true) {
    simulation.tick(null);
    if (pool.visibilitySampleTick[0] === simulation.tickCount) break;
  }
  assert.equal(pool.perceptionState[0], PERCEPTION_STATE.engaged);
  assert.equal(
    simulation.snapshot().recentPerceptionEvents.at(-1).type,
    "reacquisition",
  );
  assert.equal(simulation.enemies.findIndexById(enemyId), 0);
});

test("TrueSight and presentation lighting flags cannot alter perception authority", () => {
  const simulation = perceptiveSimulation();
  spawnEnemy(simulation, 10.5, 6.5, { spawnSequence: 1, perceptionLane: 1 });
  const before = simulation.snapshot();
  const flags = new PresentationFlags({
    trueSight: true,
    sightFade: true,
    dynamicLights: true,
    lightColorVariation: true,
  });
  const sight = new TrueSightSystem({ flags });
  sight.update(before, 0, { mode: "play", deltaMs: 16 });
  flags.set("trueSight", false);
  flags.set("dynamicLights", false);
  sight.update(before, 0, { mode: "play", deltaMs: 16 });
  assert.deepEqual(simulation.snapshot(), before);
  while (simulation.tickCount < 16) simulation.tick(null);
  assert.equal(simulation.snapshot().enemies[0].perceptionState, "engaged");
});
