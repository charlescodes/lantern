import test from "node:test";
import assert from "node:assert/strict";

import {
  ACTOR_TEAM,
  COMBAT,
  ENEMY_AI_PROFILE_INVESTIGATIVE,
  ENEMY_WIZARD,
  MOVEMENT_SOUND,
  MOVEMENT_SOUND_PROFILE_NONE,
  MOVEMENT_SOUND_PROFILE_V1,
  PLAYER,
} from "../src/config.js";
import { GridMap } from "../src/sim/grid_map.js";
import {
  INVESTIGATION_PRIORITY,
  KNOWLEDGE_SOURCE,
  PERCEPTION_STATE,
  soundHearingCheck,
} from "../src/sim/perceptive_wizard.js";
import { ArenaScenario } from "../src/sim/scenario.js";
import { Simulation } from "../src/sim/simulation.js";
import {
  SOUND_EVENT_KIND,
  SOUND_EVENT_REASON,
  SoundEventQueue,
} from "../src/sim/sound_event_pool.js";

function borderedMap(width = 30, height = 24, spawn = { x: 2.5, z: 10.5 }) {
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

function simulation(options = {}) {
  return new Simulation({
    scenario: new ArenaScenario(options.map ?? borderedMap()),
    enemyAiProfile: options.enemyAiProfile ?? ENEMY_AI_PROFILE_INVESTIGATIVE,
    movementSoundProfile: options.movementSoundProfile ?? MOVEMENT_SOUND_PROFILE_V1,
    particleBurstCount: 0,
    seed: 0x1100_0001,
    useBroadphase: options.useBroadphase,
    soundEventCapacity: options.soundEventCapacity,
  });
}

function spawnEnemy(value, x, z, overrides = {}) {
  const id = value.enemies.spawn({
    spawnSequence: overrides.spawnSequence ?? value.enemies.activeCount + 1,
    spawnTick: value.tickCount,
    x,
    z,
    radius: ENEMY_WIZARD.radius,
    massKg: ENEMY_WIZARD.massKg,
    maximumHealth: COMBAT.maximumHealth,
    shotReadyTick: overrides.shotReadyTick ?? 0xffff_ffff,
    facingX: overrides.facingX ?? 1,
    facingZ: overrides.facingZ ?? 0,
    guardX: x,
    guardZ: z,
    guardBaseFacingX: overrides.facingX ?? 1,
    guardBaseFacingZ: overrides.facingZ ?? 0,
    perceptionLane: overrides.perceptionLane ?? 1,
    guardSweepPhase: 0,
  });
  assert.ok(id > 0);
  return id;
}

function tickRelative(value, dx, dz) {
  value.tick({ move: { x: value.player.x + dx, z: value.player.z + dz } });
}

function runUntilFootsteps(value, count, direction = { x: 1, z: 0 }, limit = 300) {
  const endTick = value.tickCount + limit;
  while (value.soundEventMetrics.emittedFootsteps < count && value.tickCount < endTick) {
    tickRelative(value, direction.x * 10, direction.z * 10);
  }
  assert.equal(value.soundEventMetrics.emittedFootsteps, count);
  return value.soundEventHistory.toArray().filter((event) => event.kind === "footstep");
}

test("proximity movement uses the inclusive walk zone while legacy movement keeps full speed", () => {
  const value = simulation();
  value.tick({
    move: {
      x: value.player.x + MOVEMENT_SOUND.walkTargetRadiusMeters,
      z: value.player.z,
    },
  });
  let snapshot = value.snapshot();
  assert.equal(snapshot.player.movement.mode, "walking");
  assert.equal(snapshot.player.desiredVx, MOVEMENT_SOUND.walkSpeedMetersPerSecond);
  assert.equal(snapshot.player.movement.targetDistanceMeters, 0.75);

  value.tick({ move: { x: value.player.x + 0.750_001, z: value.player.z } });
  snapshot = value.snapshot();
  assert.equal(snapshot.player.movement.mode, "running");
  assert.equal(snapshot.player.desiredVx, PLAYER.desiredSpeed);

  const legacy = simulation({ movementSoundProfile: MOVEMENT_SOUND_PROFILE_NONE });
  legacy.tick({ move: { x: legacy.player.x + 0.5, z: legacy.player.z } });
  assert.equal(legacy.snapshot().player.desiredVx, PLAYER.desiredSpeed);
  assert.equal(legacy.soundEventMetrics.emittedFootsteps, 0);
});

test("walking, walk-mode deceleration, and external knockback emit no footsteps", () => {
  const value = simulation();
  for (let tick = 0; tick < 120; tick += 1) tickRelative(value, 0.5, 0);
  assert.equal(value.snapshot().player.movement.mode, "walking");
  assert.equal(value.soundEventMetrics.emittedFootsteps, 0);

  runUntilFootsteps(value, 1);
  const before = value.soundEventMetrics.emittedFootsteps;
  value.player.externalVx = 12;
  for (let tick = 0; tick < 30; tick += 1) tickRelative(value, 0.5, 0);
  assert.equal(value.snapshot().player.movement.mode, "walking");
  assert.equal(value.soundEventMetrics.emittedFootsteps, before);
});

test("running emits a half-stride first step, full-stride repeats, and resets after walking", () => {
  const value = simulation();
  const startX = value.player.x;
  let footsteps = runUntilFootsteps(value, 1);
  assert.equal(footsteps[0].reason, "stride");
  assert.ok(footsteps[0].x - startX >= 0.65);
  assert.ok(footsteps[0].x - startX <= 0.85);

  footsteps = runUntilFootsteps(value, 2);
  const repeatDistance = footsteps[1].x - footsteps[0].x;
  assert.ok(repeatDistance >= 1.4 && repeatDistance <= 1.6, repeatDistance);

  tickRelative(value, 0.5, 0);
  assert.equal(value.player.runningStrideProgress, 0);
  const resetStartX = value.player.x;
  footsteps = runUntilFootsteps(value, 3);
  const resetDistance = footsteps[2].x - resetStartX;
  assert.ok(resetDistance >= 0.65 && resetDistance <= 0.85, resetDistance);
});

test("a 120-degree turn emits one gated footstep while 119 degrees does not", () => {
  const value = simulation();
  runUntilFootsteps(value, 1);
  const firstTick = value.player.lastFootstepTick;
  while (value.tickCount - firstTick < MOVEMENT_SOUND.turnCooldownTicks) {
    tickRelative(value, 10, 0);
  }
  const before = value.soundEventMetrics.emittedFootsteps;
  const angle119 = 119 * Math.PI / 180;
  tickRelative(value, Math.cos(angle119) * 10, Math.sin(angle119) * 10);
  assert.equal(value.soundEventMetrics.emittedFootsteps, before);

  const angle120 = 120 * Math.PI / 180;
  value.player.runningStrideProgress = value.player.runningNextFootstepDistance;
  tickRelative(value, Math.cos(angle120) * 10, Math.sin(angle120) * 10);
  assert.equal(value.soundEventMetrics.emittedFootsteps, before + 1);
  const latest = value.soundEventHistory.toArray().at(-1);
  assert.equal(latest.kind, "footstep");
  assert.equal(latest.reason, "turn");
  assert.equal(value.player.runningStrideProgress, 0);

  tickRelative(value, -10, 0);
  assert.equal(value.soundEventMetrics.emittedFootsteps, before + 1);
});

test("sound hearing is hostile, inclusive, radial, and geometry independent", () => {
  assert.deepEqual(
    soundHearingCheck(8, 0, ACTOR_TEAM.enemy, 0, 0, ACTOR_TEAM.player, 8),
    { heard: true, hostile: true, inRange: true, distance: 8 },
  );
  assert.equal(
    soundHearingCheck(8.000_001, 0, ACTOR_TEAM.enemy, 0, 0, ACTOR_TEAM.player, 8).heard,
    false,
  );
  assert.equal(
    soundHearingCheck(1, 0, ACTOR_TEAM.enemy, 0, 0, ACTOR_TEAM.enemy, 8).heard,
    false,
  );
  assert.equal(soundHearingCheck(1, 0, ACTOR_TEAM.enemy, 0, 0, 0, 8).heard, false);
});

test("behind-wall footsteps anonymously redirect investigation on the following movement tick", () => {
  const map = borderedMap();
  for (let z = 1; z < map.height - 1; z += 1) map.set(6, z, 1);
  const value = simulation({ map });
  const enemyId = spawnEnemy(value, 10, 10.5, { facingX: 1, perceptionLane: 4 });

  const footsteps = runUntilFootsteps(value, 1, { x: 0, z: 1 });
  let enemy = value.snapshot().enemies.find((candidate) => candidate.id === enemyId);
  assert.equal(enemy.perceptionState, "investigating");
  assert.equal(enemy.investigation.source, "sound");
  assert.equal(enemy.investigation.priority, INVESTIGATION_PRIORITY.sound);
  assert.equal(enemy.investigation.sound.kind, "footstep");
  assert.equal(enemy.investigation.sound.radius, MOVEMENT_SOUND.footstepHearingMeters);
  assert.deepEqual(enemy.investigation.anchor, {
    x: footsteps[0].x,
    z: footsteps[0].z,
  });
  assert.equal(enemy.confirmedTarget, null);
  assert.equal(enemy.exposure.progressTicks, 0);
  assert.equal(value.enemies.perceptionState[0], PERCEPTION_STATE.investigating);
  assert.equal(value.enemies.knowledgeSource[0], KNOWLEDGE_SOURCE.sound);
  assert.equal(value.enemies.castSequence[0], 0);
  assert.equal(enemy.vx, 0);
  assert.equal(enemy.vz, 0);

  tickRelative(value, 0, 10);
  enemy = value.snapshot().enemies.find((candidate) => candidate.id === enemyId);
  assert.ok(Math.hypot(enemy.desiredVx, enemy.desiredVz) > 0);

  const redirected = runUntilFootsteps(value, 2, { x: 0, z: 1 });
  enemy = value.snapshot().enemies.find((candidate) => candidate.id === enemyId);
  assert.deepEqual(enemy.investigation.anchor, {
    x: redirected[1].x,
    z: redirected[1].z,
  });
  assert.ok(value.soundEventMetrics.heardFootsteps >= 2);
  assert.ok(value.investigationEventMetrics.heardFootsteps >= 2);
});

test("schema-v11 Fireball impacts use the shared sound queue and retain source identity", () => {
  const map = borderedMap();
  for (let z = 1; z < map.height - 1; z += 1) map.set(6, z, 1);
  const value = simulation({ map });
  const enemyId = spawnEnemy(value, 10.5, 10.5, { facingX: 1, perceptionLane: 3 });
  value.tick({ cast: { x: 10.5, z: 10.5 } });
  const endTick = value.tickCount + 120;
  while (
    value.soundEventMetrics.emittedFireballImpacts === 0
    && value.tickCount < endTick
  ) {
    value.tick(null);
  }
  assert.equal(value.soundEventMetrics.emittedFireballImpacts, 1);
  assert.equal(value.soundEventMetrics.heardFireballImpacts, 1);
  const sound = value.soundEventHistory.toArray().at(-1);
  assert.equal(sound.kind, "fireball-impact");
  assert.equal(sound.reason, "impact");
  assert.ok(sound.effectId > 0);
  assert.ok(sound.projectileId > 0);
  assert.deepEqual(sound.source, { kind: "player", id: 1, team: "player" });

  const enemy = value.snapshot().enemies.find((candidate) => candidate.id === enemyId);
  assert.equal(enemy.investigation.source, "sound");
  assert.deepEqual(enemy.investigation.sound, {
    eventId: sound.id,
    kind: "fireball-impact",
    radius: 16,
  });
  const heard = value.perceptionEvents
    .toArray()
    .find((event) => event.type === "explosion-heard");
  assert.equal(heard.tick, sound.tick);
  assert.equal(heard.soundEventId, sound.id);
  assert.equal(heard.soundKind, "fireball-impact");
});

test("the one-tick sound queue is bounded, ordered, and drops newest", () => {
  const queue = new SoundEventQueue(2);
  const event = (tick, kind) => ({
    tick,
    kind,
    reason: SOUND_EVENT_REASON.stride,
    sourceKind: 1,
    sourceId: 1,
    sourceTeam: ACTOR_TEAM.player,
    x: tick,
    z: 0,
    radius: 8,
  });
  assert.equal(queue.push(event(1, SOUND_EVENT_KIND.footstep)), 1);
  assert.equal(queue.push(event(1, SOUND_EVENT_KIND.fireballImpact)), 2);
  assert.equal(queue.push(event(1, SOUND_EVENT_KIND.footstep)), 0);
  assert.deepEqual(Array.from(queue.id), [1, 2]);
  assert.equal(queue.dropped, 1);
  assert.equal(queue.maximumEventsPerTick, 2);
  queue.beginTick();
  assert.equal(queue.activeCount, 0);
  assert.equal(queue.push(event(2, SOUND_EVENT_KIND.footstep)), 3);
});

test("simulation sound-event capacity is tunable, bounded, and replay-pinned", () => {
  const value = simulation({ soundEventCapacity: 3 });
  assert.equal(value.soundEvents.capacity, 3);
  const recording = value.exportCommandLog();
  assert.equal(recording.configuration.soundEventCapacity, 3);
  assert.equal(Simulation.replay(recording).soundEvents.capacity, 3);
  assert.throws(
    () => simulation({ soundEventCapacity: 0 }),
    /Sound-event capacity/,
  );
  const missing = structuredClone(recording);
  delete missing.configuration.soundEventCapacity;
  assert.throws(() => Simulation.replay(missing), /invalid sound-event capacity/);
});
