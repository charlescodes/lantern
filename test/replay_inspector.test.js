import test from "node:test";
import assert from "node:assert/strict";

import {
  PARTICLE_PROFILE_M02,
  PARTICLE_PROFILE_M0_2_5,
  SCHEMA_VERSION,
} from "../src/config.js";
import { FixedStepRuntime } from "../src/runtime/fixed_step_runtime.js";
import { GridMap } from "../src/sim/grid_map.js";
import { ArenaScenario } from "../src/sim/scenario.js";
import { Simulation } from "../src/sim/simulation.js";

function comparable(simulation) {
  const snapshot = simulation.snapshot();
  return {
    seed: snapshot.seed,
    rngState: snapshot.rngState,
    tick: snapshot.tick,
    particleProfile: snapshot.particleProfile,
    player: snapshot.player,
    rocks: snapshot.rocks,
    projectiles: snapshot.projectiles,
    particles: snapshot.particles,
    recentEvents: snapshot.recentEvents,
    pools: snapshot.pools,
    debugFlags: snapshot.debugFlags,
  };
}

test("same seed and command log replay to matching simulation state", () => {
  const simulation = new Simulation({ seed: 0xdecafbad, particleBurstCount: 12 });
  for (let tick = 0; tick < 360; tick += 1) {
    simulation.tick({
      move: tick < 180 ? { x: 19.5, z: 18.5 } : { x: 3.5, z: 4.5 },
      cast: tick % 18 === 0 ? { x: 11.5, z: 19.5 } : null,
    });
  }
  const recording = simulation.exportCommandLog();
  const replayed = Simulation.replay(recording);
  assert.deepEqual(comparable(replayed), comparable(simulation));
});

test("pinned projectile identity resolves after swap compaction", () => {
  const simulation = new Simulation({ projectileCapacity: 4, particleBurstCount: 1 });
  const spawn = (x) => simulation.projectiles.spawn({ x, z: 2, vx: 0, vz: 0, lifetime: 2, radius: 0.12 });
  spawn(1);
  spawn(2);
  const pinnedId = spawn(3);
  assert.equal(simulation.projectiles.findIndexById(pinnedId), 2);
  simulation.projectiles.removeSwap(0);
  const inspected = simulation.resolveSelection({ kind: "projectile", id: pinnedId });
  assert.equal(inspected.id, pinnedId);
  assert.equal(inspected.index, 0);
  assert.equal(inspected.position.x, 3);
});

test("map and debug mutations only apply when a tick consumes their command", () => {
  const simulation = new Simulation();
  const before = simulation.map.get(2, 2);
  const command = { type: "setTile", cx: 2, cz: 2, tile: before === 1 ? 0 : 1 };
  assert.equal(simulation.map.get(2, 2), before);
  simulation.tick(command);
  assert.equal(simulation.map.get(2, 2), before === 1 ? 0 : 1);
});

test("snapshots and exported recordings cannot mutate simulation history", () => {
  const simulation = new Simulation({ particleBurstCount: 1 });
  simulation.projectiles.spawn({ x: 1.5, z: 19.5, vx: 600, vz: 0, lifetime: 2, radius: 0.12 });
  simulation.tick({ move: { x: 5, z: 18.5 } });
  const snapshot = simulation.snapshot();
  const originalEventX = simulation.impactEvents.toArray()[0].x;
  snapshot.recentEvents[0].x = -999;
  const recording = simulation.exportCommandLog();
  recording.initialMap.cells[0] = 0;
  recording.commands[0].command.move.x = -999;
  assert.equal(simulation.impactEvents.toArray()[0].x, originalEventX);
  assert.equal(simulation.commandLogMap.cells[0], 1);
  assert.equal(simulation.commandLog.toArray()[0].command.move.x, 5);
});

test("snapshot, runtime, and recording schema are v4 while scenarios remain v2", () => {
  const simulation = new Simulation({
    particleBounce: false,
    particleWallCollision: false,
  });
  const runtime = new FixedStepRuntime({ simulation });
  const snapshot = simulation.snapshot();
  const recording = simulation.exportCommandLog();
  assert.equal(SCHEMA_VERSION, 4);
  assert.equal(snapshot.schemaVersion, 4);
  assert.equal(runtime.metrics().schemaVersion, 4);
  assert.deepEqual(Object.keys(runtime.metrics().snapshotMs), ["p50", "p95", "p99"]);
  assert.ok(runtime.metrics().snapshotMs.p99 >= 0);
  assert.equal(recording.schemaVersion, 4);
  assert.equal(snapshot.particleProfile, PARTICLE_PROFILE_M0_2_5);
  assert.equal(snapshot.scenarioVersion, 2);
  assert.equal(recording.initialScenario.version, 2);
  assert.equal(recording.configuration.particleProfile, PARTICLE_PROFILE_M0_2_5);
  assert.equal(recording.configuration.particleBounce, false);
  assert.equal(recording.configuration.particleWallCollision, false);
  assert.equal(Simulation.replay(recording).debugFlags.particleBounce, false);
  assert.equal(Simulation.replay(recording).debugFlags.particleWallCollision, false);
});

test("schema-4 recordings capture initial particle profile and collision modes", () => {
  const simulation = new Simulation({
    particleProfile: PARTICLE_PROFILE_M02,
    particleBounce: true,
  });
  simulation.tick({
    actions: [
      { type: "setDebugFlag", name: "particleBounce", value: false },
      { type: "setDebugFlag", name: "particleWallCollision", value: false },
    ],
  });
  const recording = simulation.exportCommandLog();
  assert.equal(recording.configuration.particleProfile, PARTICLE_PROFILE_M02);
  assert.equal(recording.configuration.particleBounce, true);
  assert.equal(recording.configuration.particleWallCollision, true);
  const replayed = Simulation.replay(recording);
  assert.equal(replayed.particleProfile, PARTICLE_PROFILE_M02);
  assert.equal(replayed.debugFlags.particleBounce, false);
  assert.equal(replayed.debugFlags.particleWallCollision, false);
  assert.deepEqual(comparable(replayed), comparable(simulation));
});

test("schema-4 recordings normalize the temporary m0.25 profile spelling", () => {
  const simulation = new Simulation({ particleBurstCount: 4 });
  simulation.tick({ cast: { x: 11.5, z: 19.5 } });
  const recording = simulation.exportCommandLog();
  recording.configuration.particleProfile = "m0.25-balanced";

  const replayed = Simulation.replay(recording);
  assert.equal(replayed.particleProfile, PARTICLE_PROFILE_M0_2_5);
  assert.deepEqual(comparable(replayed), comparable(simulation));
});

test("schema-3 recordings select the exact legacy M0.2 particle profile", () => {
  const map = new GridMap(8, 6, undefined, { x: 1.5, z: 2.5 });
  map.set(3, 2, 1);
  const simulation = new Simulation({
    map,
    seed: 0x5a17,
    particleBurstCount: 8,
    particleProfile: PARTICLE_PROFILE_M02,
    particleBounce: false,
  });
  for (let tick = 0; tick < 20; tick += 1) {
    simulation.tick(tick === 0 ? { cast: { x: 4.5, z: 2.5 } } : null);
  }
  const recording = simulation.exportCommandLog();
  recording.schemaVersion = 3;
  delete recording.configuration.particleProfile;
  delete recording.configuration.particleBounce;

  const replayed = Simulation.replay(recording);
  assert.equal(replayed.particleProfile, PARTICLE_PROFILE_M02);
  assert.equal(replayed.debugFlags.particleBounce, false);
  assert.deepEqual(comparable(replayed), comparable(simulation));
});

test("schema-2 recordings replay with legacy non-colliding particles", () => {
  const map = new GridMap(6, 5, undefined, { x: 2.5, z: 2.5 });
  map.set(1, 2, 1);
  map.set(3, 2, 1);
  const simulation = new Simulation({
    map,
    seed: 0x20_02,
    particleBurstCount: 64,
    particleProfile: PARTICLE_PROFILE_M02,
    particleBounce: false,
  });
  const commands = [];
  for (let tick = 0; tick < 60; tick += 1) {
    const command = tick === 0 ? { cast: { x: 4.5, z: 2.5 } } : null;
    simulation.tick(command);
    commands.push(command);
  }
  assert.ok(simulation.particles.wallBounces > 0);

  const legacyRecording = simulation.exportCommandLog();
  legacyRecording.schemaVersion = 2;
  delete legacyRecording.configuration.particleWallCollision;
  const replayed = Simulation.replay(legacyRecording);
  assert.equal(replayed.particleProfile, PARTICLE_PROFILE_M02);
  assert.equal(replayed.debugFlags.particleBounce, false);
  assert.equal(replayed.debugFlags.particleWallCollision, false);
  assert.equal(replayed.particles.wallBounces, 0);

  const expected = new Simulation({
    scenario: ArenaScenario.fromJSON(legacyRecording.initialScenario),
    seed: legacyRecording.seed,
    rockCapacity: legacyRecording.configuration.rockCapacity,
    projectileCapacity: legacyRecording.configuration.projectileCapacity,
    particleCapacity: legacyRecording.configuration.particleCapacity,
    particleBurstCount: legacyRecording.configuration.particleBurstCount,
    particleProfile: PARTICLE_PROFILE_M02,
    particleBounce: false,
    particleWallCollision: false,
  });
  for (const command of commands) expected.tick(command);
  assert.deepEqual(comparable(replayed), comparable(expected));
});
