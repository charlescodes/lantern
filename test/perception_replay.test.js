import test from "node:test";
import assert from "node:assert/strict";

import {
  DEAD_BODY,
  DEAD_BODY_PROFILE_NONE,
  DEAD_BODY_PROFILE_V1,
  ENEMY_AI_PROFILE_BASIC,
  ENEMY_AI_PROFILE_INVESTIGATIVE,
  ENEMY_AI_PROFILE_PERCEPTIVE,
  ENEMY_AI_PROFILE_TACTICAL,
  ENEMY_WIZARD,
  MOVEMENT_SOUND_PROFILE_NONE,
  MOVEMENT_SOUND_PROFILE_V1,
  PROJECTILE,
  SCHEMA_VERSION,
} from "../src/config.js";
import { Simulation } from "../src/sim/simulation.js";

function runFixture(simulation, ticks = 360) {
  for (let tick = 0; tick < ticks; tick += 1) {
    simulation.tick({
      move: tick < 120
        ? { x: 20.5, z: 14.5 }
        : tick < 240
          ? { x: 14.5, z: 7.5 }
          : { x: 3.5, z: 18.5 },
      cast: tick % 90 === 0 ? { x: 20.5, z: 17.5 } : null,
      actions: tick === 180
        ? [{ type: "setTile", cx: 13, cz: 15, tile: 1 }]
        : tick === 210
          ? [{ type: "setTile", cx: 13, cz: 15, tile: 0 }]
          : [],
    });
  }
}

function withoutBroadphase(snapshot) {
  const value = structuredClone(snapshot);
  delete value.broadphase;
  return value;
}

test("schema-v11 recording stores investigative, dead-body, and movement-sound profiles and replays exactly", () => {
  const source = new Simulation({ seed: 0x0800_f17e, particleBurstCount: 0 });
  runFixture(source);
  const recording = source.exportCommandLog();
  assert.equal(recording.schemaVersion, 13);
  assert.equal(recording.configuration.enemyAiProfile, ENEMY_AI_PROFILE_INVESTIGATIVE);
  assert.equal(recording.configuration.enemyCapacity, ENEMY_WIZARD.capacity);
  assert.equal(
    recording.configuration.encounterMaximumAlive,
    ENEMY_WIZARD.encounterMaximumAlive,
  );
  assert.equal(recording.configuration.projectileCapacity, PROJECTILE.capacity);
  assert.equal(recording.configuration.deadBodyProfile, DEAD_BODY_PROFILE_V1);
  assert.equal(recording.configuration.movementSoundProfile, MOVEMENT_SOUND_PROFILE_V1);
  assert.equal(recording.configuration.soundEventCapacity, PROJECTILE.capacity + 1);
  assert.equal(
    recording.configuration.dynamicDeadBodyCapacity,
    DEAD_BODY.dynamicCapacity,
  );
  assert.equal(
    recording.configuration.inertDeadBodyCapacity,
    DEAD_BODY.inertCapacity,
  );
  const replay = Simulation.replay(recording);
  assert.equal(replay.enemies.capacity, 64);
  assert.equal(replay.encounterMaximumAlive, 4);
  assert.deepEqual(withoutBroadphase(replay.snapshot()), withoutBroadphase(source.snapshot()));
});

test("schema-v8 recording selects the frozen perceptive profile", () => {
  const source = new Simulation({
    seed: 0x0800_f17e,
    particleBurstCount: 0,
    enemyAiProfile: ENEMY_AI_PROFILE_PERCEPTIVE,
    deadBodyProfile: DEAD_BODY_PROFILE_NONE,
    movementSoundProfile: MOVEMENT_SOUND_PROFILE_NONE,
  });
  runFixture(source);
  const recording = source.exportCommandLog();
  recording.schemaVersion = 8;
  const replay = Simulation.replay(recording);
  assert.equal(replay.enemyAiProfile, ENEMY_AI_PROFILE_PERCEPTIVE);
  assert.deepEqual(withoutBroadphase(replay.snapshot()), withoutBroadphase(source.snapshot()));
});

test("schema-v10 keeps full-speed silent movement and direct Fireball hearing", () => {
  const source = new Simulation({
    seed: 0x1000_f17e,
    particleBurstCount: 0,
    movementSoundProfile: MOVEMENT_SOUND_PROFILE_NONE,
  });
  runFixture(source);
  const recording = source.exportCommandLog();
  recording.schemaVersion = 10;
  delete recording.configuration.movementSoundProfile;
  delete recording.configuration.soundEventCapacity;
  const replay = Simulation.replay(recording);
  assert.equal(replay.movementSoundProfile, MOVEMENT_SOUND_PROFILE_NONE);
  assert.equal(replay.soundEventMetrics.emittedFootsteps, 0);
  assert.deepEqual(withoutBroadphase(replay.snapshot()), withoutBroadphase(source.snapshot()));
});

test("schema-v7 and v6 replay construct historical four-entry pools and frozen profiles", () => {
  const tacticalSource = new Simulation({
    seed: 0x0700_f17e,
    enemyAiProfile: ENEMY_AI_PROFILE_TACTICAL,
    deadBodyProfile: DEAD_BODY_PROFILE_NONE,
    movementSoundProfile: MOVEMENT_SOUND_PROFILE_NONE,
    projectileCapacity: PROJECTILE.legacyCapacity,
    particleBurstCount: 0,
  });
  runFixture(tacticalSource, 240);
  const v7 = tacticalSource.exportCommandLog();
  v7.schemaVersion = 7;
  delete v7.configuration.enemyCapacity;
  delete v7.configuration.encounterMaximumAlive;
  const tacticalReplay = Simulation.replay(v7);
  assert.equal(tacticalReplay.enemyAiProfile, ENEMY_AI_PROFILE_TACTICAL);
  assert.equal(tacticalReplay.enemies.capacity, ENEMY_WIZARD.legacyCapacity);
  assert.deepEqual(
    withoutBroadphase(tacticalReplay.snapshot()),
    withoutBroadphase(tacticalSource.snapshot()),
  );

  const v6 = structuredClone(v7);
  v6.schemaVersion = 6;
  v6.configuration.enemyAiProfile = ENEMY_AI_PROFILE_BASIC;
  const basicReplay = Simulation.replay(v6);
  assert.equal(basicReplay.enemyAiProfile, ENEMY_AI_PROFILE_BASIC);
  assert.equal(basicReplay.enemies.capacity, 4);
  assert.equal(basicReplay.navigationField.version, 0);
});

test("schema-v8 rejects compatibility metadata or profiles that would blur replay boundaries", () => {
  const source = new Simulation({
    particleBurstCount: 0,
    enemyAiProfile: ENEMY_AI_PROFILE_PERCEPTIVE,
  });
  source.tick(null);
  const recording = source.exportCommandLog();
  recording.schemaVersion = 8;
  assert.equal(SCHEMA_VERSION, 13);
  assert.throws(
    () => Simulation.replay({
      ...structuredClone(recording),
      configuration: {
        ...structuredClone(recording.configuration),
        enemyCapacity: 4,
      },
    }),
    /invalid enemy capacity metadata/,
  );
  assert.throws(
    () => Simulation.replay({
      ...structuredClone(recording),
      configuration: {
        ...structuredClone(recording.configuration),
        enemyAiProfile: ENEMY_AI_PROFILE_TACTICAL,
      },
    }),
    /invalid or missing gameplay profiles/,
  );
});

test("schema-v11 rejects perceptive profile metadata at the new boundary", () => {
  const source = new Simulation({ particleBurstCount: 0 });
  source.tick(null);
  const recording = source.exportCommandLog();
  assert.equal(recording.schemaVersion, 13);
  assert.throws(
    () => Simulation.replay({
      ...structuredClone(recording),
      configuration: {
        ...structuredClone(recording.configuration),
        enemyAiProfile: ENEMY_AI_PROFILE_PERCEPTIVE,
      },
    }),
    /invalid or missing gameplay profiles/,
  );
  assert.throws(
    () => Simulation.replay({
      ...structuredClone(recording),
      configuration: {
        ...structuredClone(recording.configuration),
        movementSoundProfile: MOVEMENT_SOUND_PROFILE_NONE,
      },
    }),
    /invalid or missing movement-sound profile/,
  );
});

const SCHEMA_V8_GOLDEN_AF58A3D = Object.freeze([
  {
    tick: 1,
    mapRevision: 1,
    player: [
      3.5059486604731496,
      18.498600315182788,
      0.3569196283889779,
      -0.08398108903270067,
      100,
    ],
    enemy: [
      20.5, 17.5, 0, 0, "unaware", "unaware", "none", false, 1, 0,
      null, null, null, "none", null, null, 0,
    ],
    counts: [1, 1, 0, 1, 0],
    lastPerception: null,
  },
  {
    tick: 180,
    mapRevision: 1,
    player: [
      12.611693065580791,
      16.300001,
      1.0590829951993141,
      0.000823004667989017,
      100,
    ],
    enemy: [
      21.25232696533203,
      17.201330184936523,
      0.087493896484375,
      -2.5537447929382324,
      "hunting",
      "hunting",
      "damage",
      false,
      176,
      0,
      null,
      null,
      null,
      "search",
      20.200077056884766,
      17.48967170715332,
      0,
    ],
    counts: [1, 0, 2, 2, 2],
    lastPerception: "search",
  },
  {
    tick: 240,
    mapRevision: 3,
    player: [
      13.505280179602615,
      14.750529775569508,
      0.6111809052137946,
      -4.457627081430703,
      100,
    ],
    enemy: [
      18.271549224853516,
      16.60692024230957,
      -4.169098854064941,
      -0.5959357619285583,
      "hunting",
      "hunting",
      "visual",
      false,
      236,
      15,
      13.272557258605957,
      16.128053665161133,
      221,
      "travel",
      13.272557258605957,
      16.128053665161133,
      1,
    ],
    counts: [1, 1, 3, 3, 5],
    lastPerception: "loss",
  },
  {
    tick: 360,
    mapRevision: 3,
    player: [9.300001, 14.699630439407173, 0, -0.0442272711392039, 100],
    enemy: [
      13.77044677734375,
      17.600303649902344,
      4.463354110717773,
      -0.6123905181884766,
      "hunting",
      "hunting",
      "visual",
      false,
      356,
      15,
      13.272557258605957,
      16.128053665161133,
      221,
      "search",
      13.272557258605957,
      16.128053665161133,
      1,
    ],
    counts: [1, 0, 5, 3, 6],
    lastPerception: "search",
  },
]);

function schemaV8GoldenPoint(simulation) {
  const snapshot = simulation.snapshot();
  const enemy = snapshot.enemies[0];
  return {
    tick: simulation.tickCount,
    mapRevision: simulation.mapRevision,
    player: [
      simulation.player.x,
      simulation.player.z,
      simulation.player.vx,
      simulation.player.vz,
      simulation.player.health,
    ],
    enemy: enemy
      ? [
        enemy.x,
        enemy.z,
        enemy.vx,
        enemy.vz,
        enemy.behaviorState,
        enemy.perceptionState,
        enemy.knowledgeSource,
        enemy.currentVisibility,
        enemy.visibilitySampleTick,
        enemy.exposure.progressTicks,
        enemy.lastSeen?.position.x ?? null,
        enemy.lastSeen?.position.z ?? null,
        enemy.lastSeen?.tick ?? null,
        enemy.hunt.phase,
        enemy.hunt.anchor?.x ?? null,
        enemy.hunt.anchor?.z ?? null,
        enemy.castSequence,
      ]
      : null,
    counts: [
      simulation.enemies.activeCount,
      simulation.projectiles.activeCount,
      simulation.impactEvents.length,
      simulation.combatEvents.length,
      simulation.perceptionEvents.length,
    ],
    lastPerception: snapshot.recentPerceptionEvents.at(-1)?.type ?? null,
  };
}

test("schema-v8 replay retains the af58a3d perceptive golden trace", () => {
  const source = new Simulation({
    seed: 0x0800_f17e,
    particleBurstCount: 0,
    enemyAiProfile: ENEMY_AI_PROFILE_PERCEPTIVE,
    movementSoundProfile: MOVEMENT_SOUND_PROFILE_NONE,
  });
  runFixture(source);
  const recording = source.exportCommandLog();
  recording.schemaVersion = 8;
  const actual = SCHEMA_V8_GOLDEN_AF58A3D.map(({ tick }) => {
    const prefix = structuredClone(recording);
    prefix.commands = prefix.commands.slice(0, tick);
    const replay = Simulation.replay(prefix);
    assert.equal(replay.enemyAiProfile, ENEMY_AI_PROFILE_PERCEPTIVE);
    return schemaV8GoldenPoint(replay);
  });
  assert.deepEqual(actual, SCHEMA_V8_GOLDEN_AF58A3D);
});

const SCHEMA_V7_GOLDEN_2727C2E = Object.freeze([
  {
    tick: 1, mapRevision: 1, player: [3.506111111111111, 18.5],
    enemy: [20.49388885498047, 17.5, -0.36666667461395264, 0, -4.5, 0],
    behavior: "approach", goal: ["navigation", 19.5, 17.5], field: [174, 1],
    strafe: [-1, 0, 175],
    aim: [3.9186110496520996, 18.5, 1.8169093132019043, 1.125],
    casts: 0, projectiles: 0,
  },
  {
    tick: 30, mapRevision: 1, player: [5.313139558232376, 18.5],
    enemy: [18.905941009521484, 18.142719268798828, -3.5827395915985107, 2.611935615539551, -4.340616226196289, 1.1870344877243042],
    behavior: "approach", goal: ["navigation", 17.5, 18.5], field: [130, 3],
    strafe: [-1, 0, 175],
    aim: [8.704991340637207, 18.5, 1.0085963010787964, 0.7564471960067749],
    casts: 0, projectiles: 0,
  },
  {
    tick: 60, mapRevision: 1, player: [6.355190421840226, 18.5],
    enemy: [16.70694351196289, 18.476577758789062, -4.499152660369873, 0.0873187780380249, -4.499152660369873, 0.0873187780380249],
    behavior: "approach", goal: ["navigation", 15.5, 18.5], field: [100, 4],
    strafe: [-1, 0, 175],
    aim: [7.840875625610352, 18.5, 0.9300969243049622, 0.6975727081298828],
    casts: 0, projectiles: 0,
  },
  {
    tick: 76, mapRevision: 1, player: [6.965148640299112, 18.5],
    enemy: [15.536127090454102, 18.516273498535156, -3.6290323734283447, 0.6993644833564758, -0.001862725242972374, 3.499999523162842],
    behavior: "engage", goal: ["strafe", 15.596078872680664, 19.504615783691406], field: [90, 4],
    strafe: [-1, 0, 175],
    aim: [8.398699760437012, 18.5, 0.7399551272392273, 0.5549663305282593],
    casts: 1, projectiles: 1,
  },
  {
    tick: 120, mapRevision: 1, player: [6.801530815308354, 16.14912710357728],
    enemy: [14.632012367248535, 20.712955474853516, -1.7735652923583984, 2.708789825439453, -3.173450469970703, -3.1904876232147217],
    behavior: "approach", goal: ["navigation", 13.5, 19.5], field: [96, 8],
    strafe: [-1, 0, 175],
    aim: [5.418398380279541, 11.278468132019043, 1.7432719469070435, 1.125],
    casts: 1, projectiles: 0,
  },
  {
    tick: 180, mapRevision: 3, player: [6.603068793745226, 12.581089804593002],
    enemy: [12.270903587341309, 18.412986755371094, -0.24935875833034515, -1.9537221193313599, 2.4996931552886963, -2.449802875518799],
    behavior: "engage", goal: ["strafe", 12.9892578125, 17.74560546875], field: [102, 15],
    strafe: [1, 1, 324],
    aim: [8.987088203430176, 12.567177772521973, 0.7064390778541565, 0.5298293232917786],
    casts: 1, projectiles: 0,
  },
  {
    tick: 240, mapRevision: 3, player: [7.699999, 12.556391755070266],
    enemy: [14.296405792236328, 16.30000114440918, 1.7273659706115723, 0, 1.733109474182129, -3.040778160095215],
    behavior: "engage", goal: ["strafe", 14.76279067993164, 15.431207656860352], field: [110, 16],
    strafe: [1, 1, 324],
    aim: [7.6999711990356445, 12.542832374572754, 0.843737781047821, 0.6328033208847046],
    casts: 1, projectiles: 0,
  },
]);

function schemaV7GoldenPoint(simulation) {
  const enemy = simulation.snapshot().enemies[0];
  return {
    tick: simulation.tickCount,
    mapRevision: simulation.mapRevision,
    player: [simulation.player.x, simulation.player.z],
    enemy: [
      enemy.x,
      enemy.z,
      enemy.vx,
      enemy.vz,
      enemy.desiredVx,
      enemy.desiredVz,
    ],
    behavior: enemy.behaviorState,
    goal: [enemy.movementGoal.kind, enemy.movementGoal.x, enemy.movementGoal.z],
    field: [enemy.navigationField.cost, enemy.navigationField.version],
    strafe: [
      enemy.strafe.directionCode,
      enemy.strafe.decisionSequence,
      enemy.strafe.changeTick,
    ],
    aim: [
      enemy.predictedAimPoint.x,
      enemy.predictedAimPoint.z,
      enemy.aimInterceptTime,
      enemy.aimLeadTime,
    ],
    casts: enemy.castSequence,
    projectiles: simulation.projectiles.activeCount,
  };
}

test("schema-v7 replay retains the 2727c2e omniscient tactical golden trace", () => {
  const source = new Simulation({
    seed: 0x7000_0700,
    particleBurstCount: 0,
    enemyAiProfile: ENEMY_AI_PROFILE_TACTICAL,
    movementSoundProfile: MOVEMENT_SOUND_PROFILE_NONE,
    projectileCapacity: PROJECTILE.legacyCapacity,
  });
  for (let ordinal = 0; ordinal < 240; ordinal += 1) {
    source.tick({
      move: ordinal < 80
        ? { x: 18.5, z: 18.5 }
        : ordinal < 160
          ? { x: 3.5, z: 4.5 }
          : { x: 20.5, z: 12.5 },
      cast: null,
      actions: ordinal === 120
        ? [{ type: "setTile", cx: 13, cz: 15, tile: 1 }]
        : ordinal === 150
          ? [{ type: "setTile", cx: 13, cz: 15, tile: 0 }]
          : [],
    });
  }
  const recording = source.exportCommandLog();
  recording.schemaVersion = 7;
  delete recording.configuration.enemyCapacity;
  delete recording.configuration.encounterMaximumAlive;
  const actual = SCHEMA_V7_GOLDEN_2727C2E.map(({ tick }) => {
    const prefix = structuredClone(recording);
    prefix.commands = prefix.commands.slice(0, tick);
    const replay = Simulation.replay(prefix);
    assert.equal(replay.enemyAiProfile, ENEMY_AI_PROFILE_TACTICAL);
    assert.equal(replay.enemies.capacity, ENEMY_WIZARD.legacyCapacity);
    return schemaV7GoldenPoint(replay);
  });
  assert.deepEqual(actual, SCHEMA_V7_GOLDEN_2727C2E);
  assert.equal(actual[0].enemy[0] - actual[0].player[0] > 12, true);
  assert.notEqual(actual[0].aim, null, "v7 remains omniscient beyond v8 visual range");
});
