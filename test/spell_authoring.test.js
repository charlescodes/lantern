import test from "node:test";
import assert from "node:assert/strict";

import {
  DEAD_BODY_PROFILE_NONE,
  ENEMY_AI_PROFILE_NONE,
  GAMEPLAY_PROFILE_PRE_COMBAT,
  MOVEMENT_SOUND_PROFILE_NONE,
  SCHEMA_VERSION,
  SIMULATION,
} from "../src/config.js";
import {
  cloneFireballDefinition,
  DEFAULT_FIREBALL_DEFINITION,
} from "../src/spells/fireball_definition.js";
import { GridMap } from "../src/sim/grid_map.js";
import { Simulation } from "../src/sim/simulation.js";

function definition(mutate = () => {}) {
  const value = cloneFireballDefinition(DEFAULT_FIREBALL_DEFINITION);
  mutate(value);
  return value;
}

function impactMap() {
  const map = new GridMap(12, 7, undefined, { x: 1.5, z: 3.5 });
  map.set(4, 3, 1);
  return map;
}

function runUntil(simulation, predicate, maximumTicks = 240) {
  for (let tick = 0; tick < maximumTicks; tick += 1) {
    if (predicate()) return tick;
    simulation.tick(null);
  }
  assert.fail(`condition was not reached within ${maximumTicks} ticks`);
}

test("Apply and cast in one tick uses the new immutable revision", () => {
  const simulation = new Simulation();
  const next = definition((value) => {
    value.projectile.speed = 20;
    value.projectile.radius = 0.3;
  });
  simulation.tick({
    actions: [{
      type: "applySpellDefinition",
      spellId: "fireball",
      expectedRevision: 1,
      definition: next,
    }],
    cast: { x: 18.5, z: 18.5, spellId: "fireball", variationSeed: 7 },
  });
  assert.equal(simulation.getSpellDefinition("fireball").revision, 2);
  assert.equal(simulation.projectiles.activeCount, 1);
  assert.equal(simulation.projectiles.definitionRevision[0], 2);
  assert.equal(simulation.projectiles.vx[0], 20);
  assert.equal(simulation.projectiles.radius[0], Math.fround(0.3));
  assert.equal(simulation.projectiles.effectSeed[0], 7);
  const inspected = simulation.queryAt(
    simulation.projectiles.x[0],
    simulation.projectiles.z[0],
  );
  assert.deepEqual(
    {
      spell: inspected.spell,
      revision: inspected.definitionRevision,
      effectId: inspected.effectId,
      seed: inspected.effectSeed,
      y: inspected.position.y,
    },
    {
      spell: "fireball",
      revision: 2,
      effectId: 1,
      seed: 7,
      y: Math.fround(0.3),
    },
  );
});

test("an in-flight cast keeps its revision while future casts use the next one", () => {
  const map = new GridMap(48, 8, undefined, { x: 2, z: 4 });
  const simulation = new Simulation({ map, seed: 0x51a7 });
  simulation.tick({
    cast: { x: 44, z: 4, variationSeed: 0x11111111 },
  });
  const firstId = simulation.projectiles.id[0];
  const changed = definition((value) => {
    value.projectile.speed = 18;
    value.projectile.radius = 0.25;
  });
  simulation.tick({
    type: "applySpellDefinition",
    spellId: "fireball",
    expectedRevision: 1,
    definition: changed,
  });
  let first = simulation.projectiles.findIndexById(firstId);
  assert.ok(first >= 0);
  assert.equal(simulation.projectiles.definitionRevision[first], 1);
  assert.equal(simulation.projectiles.vx[first], 9);
  assert.equal(simulation.projectiles.radius[first], Math.fround(0.12));

  simulation.spellCooldowns[1] = 0;
  simulation.tick({
    cast: { x: 44, z: 4, variationSeed: 0x22222222 },
  });
  first = simulation.projectiles.findIndexById(firstId);
  const second = first === 0 ? 1 : 0;
  assert.equal(simulation.projectiles.definitionRevision[first], 1);
  assert.equal(simulation.projectiles.definitionRevision[second], 2);
  assert.equal(simulation.projectiles.vx[second], 18);
  assert.equal(simulation.projectiles.radius[second], 0.25);
  assert.deepEqual(simulation.spells.diagnostics()[0].revisions, [1, 2]);
  assert.deepEqual(
    simulation.snapshot().spells[0].revisions.map((entry) => entry.revision),
    [1, 2],
  );
});

test("impacts, emitted particles, and ongoing particle physics resolve captured revisions", () => {
  const firstDefinition = definition((value) => {
    value.cast.cooldown = 0;
    value.emission.burstCount = 3;
    value.emission.spawnHeight = 2;
    value.emission.verticalMinimum = 5;
    value.emission.verticalRange = 0;
    value.emission.gravity = -9.81;
  });
  const simulation = new Simulation({
    map: impactMap(),
    seed: 0xa11ce,
    initialFireballDefinition: firstDefinition,
  });
  simulation.tick({
    cast: { x: 8, z: 3.5, variationSeed: 123 },
  });
  const secondDefinition = cloneFireballDefinition(firstDefinition);
  secondDefinition.impact.blastRadius = 8;
  secondDefinition.impact.pressureImpulse = 2_000;
  secondDefinition.impact.visualLifetime = 1.5;
  secondDefinition.emission.gravity = 10;
  simulation.tick({
    type: "applySpellDefinition",
    spellId: "fireball",
    expectedRevision: 1,
    definition: secondDefinition,
  });
  runUntil(simulation, () => simulation.impactEvents.length === 1);
  const firstImpact = simulation.impactEvents.toArray()[0];
  assert.equal(firstImpact.definitionRevision, 1);
  assert.equal(firstImpact.effectSeed, 123);
  assert.equal(firstImpact.radius, 2.5);
  assert.equal(firstImpact.pressureImpulse, 800);
  assert.equal(firstImpact.visualLifetime, 0.2);
  assert.ok(
    simulation.snapshot().particles.every(
      (particle) => particle.definitionRevision === 1 && particle.effectSeed === 123,
    ),
  );

  simulation.tick({
    cast: { x: 8, z: 3.5, variationSeed: 456 },
  });
  runUntil(simulation, () => simulation.impactEvents.length === 2);
  const secondImpact = simulation.impactEvents.toArray()[1];
  assert.equal(secondImpact.definitionRevision, 2);
  assert.equal(secondImpact.effectSeed, 456);
  assert.equal(secondImpact.radius, 8);
  assert.equal(secondImpact.pressureImpulse, 2_000);
  assert.equal(secondImpact.visualLifetime, 1.5);

  const before = new Map(
    simulation.snapshot().particles.map((particle) => [particle.id, particle]),
  );
  simulation.tick(null);
  for (const particle of simulation.snapshot().particles) {
    const previous = before.get(particle.id);
    if (!previous) continue;
    const expectedGravity = particle.definitionRevision === 1 ? -9.81 : 10;
    assert.ok(
      Math.abs((particle.vy - previous.vy) - expectedGravity * SIMULATION.dt) < 2e-5,
      `revision ${particle.definitionRevision} gravity did not remain captured`,
    );
  }
});

test("particle lifecycle and wall response keep each particle's captured revision", () => {
  const map = new GridMap(9, 7, undefined, { x: 2.5, z: 3.5 });
  for (let z = 1; z < map.height - 1; z += 1) map.set(4, z, 1);
  const first = definition((value) => {
    value.emission.gravity = 0;
    value.collision.wallNormalRetention = 0.25;
    value.collision.wallTangentialRetention = 0.5;
    value.particleLifecycle.shrinkExponent = 1;
  });
  const simulation = new Simulation({
    map,
    initialFireballDefinition: first,
  });
  const firstId = simulation.particles.spawn({
    x: 3.95,
    y: 3,
    z: 2.5,
    vx: 6,
    vy: 0,
    vz: 2,
    lifetime: 2,
    size: 0.1,
    spellCode: 1,
    definitionRevision: 1,
    effectId: 1,
    effectSeed: 1,
    sampleOrdinal: 0,
    sampleSeed: 1,
  });
  const second = cloneFireballDefinition(first);
  second.collision.wallNormalRetention = 0.9;
  second.collision.wallTangentialRetention = 0.8;
  second.particleLifecycle.shrinkExponent = 4;
  assert.equal(
    simulation.applySpellDefinition("fireball", second, 1).revision,
    2,
  );
  const secondId = simulation.particles.spawn({
    x: 3.95,
    y: 3,
    z: 3.5,
    vx: 6,
    vy: 0,
    vz: 2,
    lifetime: 2,
    size: 0.1,
    spellCode: 1,
    definitionRevision: 2,
    effectId: 2,
    effectSeed: 2,
    sampleOrdinal: 0,
    sampleSeed: 2,
  });

  simulation.tick(null);
  const firstIndex = simulation.particles.findIndexById(firstId);
  const secondIndex = simulation.particles.findIndexById(secondId);
  assert.ok(firstIndex >= 0 && secondIndex >= 0);
  assert.ok(Math.abs(simulation.particles.vx[firstIndex] + 1.5) < 1e-5);
  assert.ok(Math.abs(simulation.particles.vz[firstIndex] - 1) < 1e-5);
  assert.ok(Math.abs(simulation.particles.vx[secondIndex] + 5.4) < 1e-5);
  assert.ok(Math.abs(simulation.particles.vz[secondIndex] - 1.6) < 1e-5);
  const snapshot = simulation.snapshot();
  const firstParticle = snapshot.particles.find((particle) => particle.id === firstId);
  const secondParticle = snapshot.particles.find((particle) => particle.id === secondId);
  assert.ok(firstParticle.currentSize > secondParticle.currentSize);
});

test("global particle debug switches remain overrides around per-spell collision", () => {
  const map = new GridMap(9, 7, undefined, { x: 2.5, z: 3.5 });
  for (let z = 1; z < map.height - 1; z += 1) map.set(4, z, 1);
  const spawnWallParticle = (simulation) => simulation.particles.spawn({
    x: 3.95,
    y: 2,
    z: 3.5,
    vx: 6,
    vy: 0,
    vz: 0,
    lifetime: 2,
    size: 0.1,
    spellCode: 1,
    definitionRevision: 1,
    effectId: 1,
    effectSeed: 1,
  });

  const spellBypass = definition((value) => {
    value.emission.gravity = 0;
    value.collision.wallCollision = false;
  });
  const bypassedBySpell = new Simulation({
    map,
    initialFireballDefinition: spellBypass,
  });
  spawnWallParticle(bypassedBySpell);
  bypassedBySpell.tick(null);
  assert.equal(bypassedBySpell.particles.wallBounces, 0);
  assert.ok(bypassedBySpell.particles.x[0] > 4);

  const bypassedGlobally = new Simulation({
    map,
    initialFireballDefinition: definition((value) => {
      value.emission.gravity = 0;
      value.collision.wallCollision = true;
    }),
    particleWallCollision: false,
  });
  spawnWallParticle(bypassedGlobally);
  bypassedGlobally.tick(null);
  assert.equal(bypassedGlobally.particles.wallBounces, 0);
  assert.ok(bypassedGlobally.particles.x[0] > 4);

  for (const [groundMode, globalBounce] of [
    ["bounce-settle", false],
    ["remove", true],
  ]) {
    const ground = new Simulation({
      initialFireballDefinition: definition((value) => {
        value.emission.gravity = 0;
        value.collision.groundMode = groundMode;
      }),
      particleBounce: globalBounce,
    });
    ground.particles.spawn({
      x: ground.player.x,
      y: 0.01,
      z: ground.player.z,
      vx: 0,
      vy: -2,
      vz: 0,
      lifetime: 2,
      size: 0.1,
      spellCode: 1,
      definitionRevision: 1,
      effectId: 1,
      effectSeed: 1,
    });
    ground.tick(null);
    assert.equal(ground.particles.activeCount, 0);
  }
});

test("pool swap removal copies spell, revision, effect, and sample identities", () => {
  const simulation = new Simulation({ projectileCapacity: 3, particleCapacity: 3 });
  simulation.projectiles.spawn({
    x: 1, z: 1, vx: 1, vz: 0, lifetime: 1, radius: 0.1,
    spellCode: 1, definitionRevision: 2, effectId: 3, effectSeed: 4,
  });
  simulation.projectiles.spawn({
    x: 2, z: 2, vx: 2, vz: 0, lifetime: 2, radius: 0.2,
    spellCode: 5, definitionRevision: 6, effectId: 7, effectSeed: 8,
  });
  simulation.projectiles.removeSwap(0);
  assert.deepEqual(
    {
      spellCode: simulation.projectiles.spellCode[0],
      definitionRevision: simulation.projectiles.definitionRevision[0],
      effectId: simulation.projectiles.effectId[0],
      effectSeed: simulation.projectiles.effectSeed[0],
    },
    { spellCode: 5, definitionRevision: 6, effectId: 7, effectSeed: 8 },
  );

  simulation.particles.spawn({
    x: 1, y: 1, z: 1, vx: 1, vy: 1, vz: 1, lifetime: 1, size: 0.1,
    spellCode: 1, definitionRevision: 2, effectId: 3, effectSeed: 4,
    sampleOrdinal: 5, sampleSeed: 6,
  });
  simulation.particles.spawn({
    x: 2, y: 2, z: 2, vx: 2, vy: 2, vz: 2, lifetime: 2, size: 0.2,
    spellCode: 7, definitionRevision: 8, effectId: 9, effectSeed: 10,
    sampleOrdinal: 11, sampleSeed: 12,
  });
  simulation.particles.removeSwap(0);
  assert.deepEqual(
    {
      spellCode: simulation.particles.spellCode[0],
      definitionRevision: simulation.particles.definitionRevision[0],
      effectId: simulation.particles.effectId[0],
      effectSeed: simulation.particles.effectSeed[0],
      sampleOrdinal: simulation.particles.sampleOrdinal[0],
      sampleSeed: simulation.particles.sampleSeed[0],
    },
    {
      spellCode: 7,
      definitionRevision: 8,
      effectId: 9,
      effectSeed: 10,
      sampleOrdinal: 11,
      sampleSeed: 12,
    },
  );
});

test("locked seeds reproduce exact samples and do not consume global simulation RNG", () => {
  const authored = definition((value) => {
    value.cast.cooldown = 0;
    value.emission.burstCount = 16;
  });
  const create = () => new Simulation({
    map: impactMap(),
    seed: 0xdecafbad,
    initialFireballDefinition: authored,
  });
  const left = create();
  const right = create();
  left.tick({ cast: { x: 8, z: 3.5, variationSeed: 0x0badf00d } });
  right.tick({ cast: { x: 8, z: 3.5, variationSeed: 0x0badf00d } });
  runUntil(left, () => left.impactEvents.length === 1);
  runUntil(right, () => right.impactEvents.length === 1);
  assert.deepEqual(left.snapshot().particles, right.snapshot().particles);
  assert.equal(left.rng.state, left.seed);
  assert.equal(right.rng.state, right.seed);
  assert.equal(
    left.exportCommandLog().commands[0].command.cast.variationSeed,
    0x0badf00d,
  );
});

test("burst count changes neither later effect seeds nor shared particle ordinals", () => {
  const smallDefinition = definition((value) => {
    value.cast.cooldown = 0;
    value.emission.burstCount = 4;
  });
  const largeDefinition = cloneFireballDefinition(smallDefinition);
  largeDefinition.emission.burstCount = 12;
  const small = new Simulation({
    map: impactMap(),
    seed: 0x5555aaaa,
    initialFireballDefinition: smallDefinition,
  });
  const large = new Simulation({
    map: impactMap(),
    seed: 0x5555aaaa,
    initialFireballDefinition: largeDefinition,
  });
  small.tick({ cast: { x: 8, z: 3.5 } });
  large.tick({ cast: { x: 8, z: 3.5 } });
  assert.equal(small.projectiles.effectSeed[0], large.projectiles.effectSeed[0]);
  runUntil(small, () => small.impactEvents.length === 1);
  runUntil(large, () => large.impactEvents.length === 1);
  const firstFour = (simulation) => simulation.snapshot().particles
    .toSorted((a, b) => a.sampleOrdinal - b.sampleOrdinal)
    .slice(0, 4)
    .map((particle) => ({
      sampleOrdinal: particle.sampleOrdinal,
      sampleSeed: particle.sampleSeed,
      vx: particle.vx,
      vy: particle.vy,
      vz: particle.vz,
      lifetime: particle.lifetime,
      size: particle.size,
    }));
  assert.deepEqual(firstFour(small), firstFour(large));

  small.tick({ cast: { x: 8, z: 3.5 } });
  large.tick({ cast: { x: 8, z: 3.5 } });
  const smallSecond = small.projectiles.effectSeed[
    small.projectiles.activeCount - 1
  ];
  const largeSecond = large.projectiles.effectSeed[
    large.projectiles.activeCount - 1
  ];
  assert.equal(smallSecond, largeSecond);
});

test("automatic seed sequence advances only for successful casts and is logged explicitly", () => {
  const simulation = new Simulation({ projectileCapacity: 1, seed: 0x1234 });
  simulation.tick({ cast: { x: 10, z: 18.5 } });
  const firstSeed = simulation.projectiles.effectSeed[0];
  assert.equal(simulation.castSequences[1], 1);
  assert.equal(
    simulation.exportCommandLog().commands[0].command.cast.variationSeed,
    firstSeed,
  );

  simulation.tick({ cast: { x: 10, z: 18.5 } });
  assert.equal(simulation.castSequences[1], 1, "cooldown rejection consumed a seed");
  simulation.spellCooldowns[1] = 0;
  simulation.tick({ cast: { x: simulation.player.x, z: simulation.player.z } });
  assert.equal(simulation.castSequences[1], 1, "zero-distance rejection consumed a seed");
  simulation.tick({ cast: { x: 10, z: 18.5 } });
  assert.equal(simulation.castSequences[1], 1, "pool saturation consumed a seed");
  assert.equal(simulation.projectiles.dropped, 1);
});

test("Clear removes only active Fireball effects and retained events without reversing impulses", () => {
  const authored = definition((value) => {
    value.emission.burstCount = 4;
  });
  const simulation = new Simulation({
    map: impactMap(),
    initialFireballDefinition: authored,
  });
  simulation.tick({ cast: { x: 8, z: 3.5 } });
  runUntil(simulation, () => simulation.impactEvents.length === 1);
  const externalBefore = {
    vx: simulation.player.externalVx,
    vz: simulation.player.externalVz,
  };
  const result = simulation.clearSpellEffects("fireball");
  assert.equal(result.ok, true);
  assert.ok(result.removed.particles > 0);
  assert.equal(result.removed.events, 1);
  assert.equal(result.impulsesReversed, false);
  assert.equal(simulation.projectiles.activeCount, 0);
  assert.equal(simulation.particles.activeCount, 0);
  assert.equal(simulation.impactEvents.length, 0);
  assert.deepEqual(
    { vx: simulation.player.externalVx, vz: simulation.player.externalVz },
    externalBefore,
  );
});

test("revision pruning waits for live effects, then preserves monotonic counters", () => {
  const map = new GridMap(48, 8, undefined, { x: 2, z: 4 });
  const simulation = new Simulation({ map });
  simulation.tick({ cast: { x: 44, z: 4 } });
  const changed = definition((value) => {
    value.projectile.speed = 12;
  });
  simulation.tick({
    type: "applySpellDefinition",
    spellId: "fireball",
    expectedRevision: 1,
    definition: changed,
  });
  assert.deepEqual(simulation.spells.diagnostics()[0].revisions, [1, 2]);
  simulation.clearSpellEffects("fireball");
  assert.deepEqual(simulation.spells.diagnostics()[0].revisions, [2]);
  assert.deepEqual(
    simulation.snapshot().spells[0].revisions.map((entry) => entry.revision),
    [2],
  );
  const third = simulation.applySpellDefinition(
    "fireball",
    DEFAULT_FIREBALL_DEFINITION,
    2,
  );
  assert.equal(third.ok, true);
  assert.equal(third.revision, 3);
});

test("reset preserves the applied revision and makes it the schema-v11 recording baseline", () => {
  const simulation = new Simulation();
  const changed = definition((value) => {
    value.projectile.speed = 14;
  });
  simulation.tick({
    type: "applySpellDefinition",
    spellId: "fireball",
    expectedRevision: 1,
    definition: changed,
  });
  simulation.tick({ cast: { x: 10, z: 18.5 } });
  assert.equal(simulation.castSequences[1], 1);
  simulation.tick({ type: "reset", seed: 0x777 });
  assert.equal(simulation.getSpellDefinition("fireball").revision, 2);
  assert.equal(simulation.getSpellDefinition("fireball").definition.projectile.speed, 14);
  assert.equal(simulation.castSequences[1], 0);
  assert.equal(simulation.projectiles.activeCount, 0);
  assert.deepEqual(simulation.spells.diagnostics()[0].revisions, [2]);
  const recording = simulation.exportCommandLog();
  assert.equal(recording.schemaVersion, 14);
  assert.equal(recording.configuration.spells[0].currentRevision, 2);
  assert.equal(recording.configuration.spells[0].revisionCounter, 2);
  assert.equal(recording.configuration.spells[0].definition.projectile.speed, 14);
});

test("schema-v11 recording replays definitions, revisions, effects, and explicit seeds exactly", () => {
  const authored = definition((value) => {
    value.cast.cooldown = 0;
    value.emission.burstCount = 8;
  });
  const simulation = new Simulation({
    map: impactMap(),
    seed: 0x51515151,
    initialFireballDefinition: authored,
  });
  simulation.tick({ cast: { x: 8, z: 3.5, variationSeed: 10 } });
  const changed = cloneFireballDefinition(authored);
  changed.palette.perParticleHueVariation = 12;
  changed.emission.gravity = -4;
  simulation.tick({
    type: "applySpellDefinition",
    spellId: "fireball",
    expectedRevision: 1,
    definition: changed,
  });
  simulation.tick({ cast: { x: 8, z: 3.5, variationSeed: 20 } });
  for (let tick = 0; tick < 80; tick += 1) simulation.tick(null);
  const recording = simulation.exportCommandLog();
  assert.equal(SCHEMA_VERSION, 14);
  assert.equal(recording.schemaVersion, 14);
  assert.equal(recording.commands[0].command.cast.variationSeed, 10);
  assert.equal(recording.commands[2].command.cast.variationSeed, 20);
  const replayed = Simulation.replay(recording);
  assert.deepEqual(replayed.snapshot(), simulation.snapshot());
  assert.deepEqual(replayed.spells.diagnostics(), simulation.spells.diagnostics());

  const missingBaseline = structuredClone(recording);
  delete missingBaseline.configuration.spells;
  assert.throws(
    () => Simulation.replay(missingBaseline),
    /missing its spell baseline/,
  );
});

test("a genuine schema-v5 recording retains exact versioned-spell behavior without combat", () => {
  const authored = definition((value) => {
    value.cast.cooldown = 0;
    value.emission.burstCount = 8;
  });
  const simulation = new Simulation({
    map: impactMap(),
    seed: 0x0505_0505,
    initialFireballDefinition: authored,
    gameplayProfile: GAMEPLAY_PROFILE_PRE_COMBAT,
    enemyAiProfile: ENEMY_AI_PROFILE_NONE,
    deadBodyProfile: DEAD_BODY_PROFILE_NONE,
    movementSoundProfile: MOVEMENT_SOUND_PROFILE_NONE,
  });
  simulation.tick({ cast: { x: 8, z: 3.5, variationSeed: 0x501 } });
  const changed = cloneFireballDefinition(authored);
  changed.projectile.speed = 13;
  changed.emission.gravity = -5;
  simulation.tick({
    type: "applySpellDefinition",
    spellId: "fireball",
    expectedRevision: 1,
    definition: changed,
  });
  simulation.tick({ cast: { x: 8, z: 3.5, variationSeed: 0x502 } });
  for (let tick = 0; tick < 80; tick += 1) simulation.tick(null);

  const recording = simulation.exportCommandLog();
  recording.schemaVersion = 5;
  recording.initialScenario.version = 2;
  delete recording.configuration.gameplayProfile;
  delete recording.configuration.enemyAiProfile;
  const replayed = Simulation.replay(recording);

  assert.equal(replayed.gameplayProfile, GAMEPLAY_PROFILE_PRE_COMBAT);
  assert.equal(replayed.enemyAiProfile, ENEMY_AI_PROFILE_NONE);
  assert.deepEqual(replayed.snapshot(), simulation.snapshot());
  assert.deepEqual(replayed.spells.diagnostics(), simulation.spells.diagnostics());
});

test("apply commands deep-clone complete documents before history or registry storage", () => {
  const simulation = new Simulation();
  const changed = definition((value) => {
    value.projectile.speed = 15;
  });
  simulation.tick({
    type: "applySpellDefinition",
    spellId: "fireball",
    expectedRevision: 1,
    definition: changed,
  });
  changed.projectile.speed = 2;
  assert.equal(simulation.getSpellDefinition("fireball").definition.projectile.speed, 15);
  const recording = simulation.exportCommandLog();
  assert.equal(
    recording.commands[0].command.actions[0].definition.projectile.speed,
    15,
  );
  recording.commands[0].command.actions[0].definition.projectile.speed = 1;
  assert.equal(
    simulation.exportCommandLog().commands[0].command.actions[0].definition.projectile.speed,
    15,
  );
});
