import test from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import os from "node:os";

import {
  cloneFireballDefinition,
  DEFAULT_FIREBALL_DEFINITION,
} from "../src/spells/fireball_definition.js";
import { GridMap } from "../src/sim/grid_map.js";
import { Simulation } from "../src/sim/simulation.js";

function maximumStressDefinition() {
  const definition = cloneFireballDefinition(DEFAULT_FIREBALL_DEFINITION);
  definition.cast.cooldown = 0;
  definition.projectile.speed = 40;
  definition.projectile.radius = 1;
  definition.projectile.lifetime = 20;
  definition.projectile.spawnGap = 1;
  definition.impact.blastRadius = 12;
  definition.impact.pressureImpulse = 5_000;
  definition.impact.visualLifetime = 2;
  definition.emission.burstCount = 1_024;
  definition.emission.spawnHeight = 2;
  definition.emission.gravity = -40;
  definition.emission.horizontalSpeedMinimum = 30;
  definition.emission.horizontalSpeedMaximum = 30;
  definition.emission.horizontalSpeedCap = 30;
  definition.emission.outwardBiasMinimum = 30;
  definition.emission.outwardBiasMaximum = 30;
  definition.emission.verticalMinimum = 30;
  definition.emission.verticalRange = 30;
  definition.emission.verticalPower = 4;
  definition.particleLifecycle.sizeMinimum = 0.5;
  definition.particleLifecycle.sizeMaximum = 0.5;
  definition.particleLifecycle.lifetimeMinimum = 10;
  definition.particleLifecycle.lifetimeMaximum = 10;
  definition.particleLifecycle.lifetimeBase = 10;
  definition.particleLifecycle.lifetimeSizeScale = 10;
  definition.particleLifecycle.lifetimeJitter = 10;
  definition.particleLifecycle.shrinkExponent = 4;
  definition.collision.groundVerticalRetention = 1;
  definition.collision.groundHorizontalRetention = 1;
  definition.collision.wallNormalRetention = 1;
  definition.collision.wallTangentialRetention = 1;
  definition.palette.perCastHueVariation = 30;
  definition.palette.perCastSaturationVariation = 0.25;
  definition.palette.perCastBrightnessVariation = 0.25;
  definition.palette.perParticleHueVariation = 30;
  definition.palette.perParticleSaturationVariation = 0.25;
  definition.palette.perParticleBrightnessVariation = 0.25;
  definition.presentation.projectileEmissiveStrength = 12;
  definition.presentation.particleEmissiveStrength = 12;
  definition.presentation.flightLightIntensity = 150;
  definition.presentation.flightLightRange = 20;
  definition.presentation.flightLightDecay = 4;
  definition.presentation.impactLightIntensity = 150;
  definition.presentation.impactLightRange = 20;
  definition.presentation.impactLightDecay = 4;
  definition.presentation.sparkLightIntensity = 150;
  definition.presentation.sparkLightRange = 20;
  definition.presentation.sparkLightDecay = 4;
  return definition;
}

test("maximum Fireball tuning and rapid revisions stay bounded below 8 ms simulation p99", () => {
  const map = new GridMap(16, 9, undefined, { x: 2.5, z: 4.5 });
  for (let z = 1; z < map.height - 1; z += 1) map.set(6, z, 1);
  map.set(5, 1, 1);
  map.set(5, map.height - 2, 1);

  const definition = maximumStressDefinition();
  const simulation = new Simulation({
    map,
    seed: 0x5ee_d5eed,
    initialFireballDefinition: definition,
  });
  const totalTicks = 480;
  const warmupTicks = 30;
  const samples = new Float64Array(totalTicks - warmupTicks);
  const heapBefore = process.memoryUsage().heapUsed;
  let sampleIndex = 0;

  for (let tick = 0; tick < totalTicks; tick += 1) {
    const actions = [];
    if (tick > 0 && tick % 8 === 0) {
      const next = cloneFireballDefinition(definition);
      next.palette.projectile = tick % 16 === 0 ? "#40A0FF" : "#FF834D";
      next.emission.gravity = tick % 16 === 0 ? 10 : -40;
      actions.push({
        type: "applySpellDefinition",
        spellId: "fireball",
        expectedRevision: simulation.getSpellDefinition("fireball").revision,
        definition: next,
      });
    }
    const started = performance.now();
    simulation.tick({
      actions,
      cast: tick % 4 === 0
        ? { x: 12.5, z: 4.5 }
        : null,
    });
    const elapsed = performance.now() - started;
    if (tick >= warmupTicks) samples[sampleIndex++] = elapsed;
    assert.ok(simulation.projectiles.activeCount <= simulation.projectiles.capacity);
    assert.ok(simulation.particles.activeCount <= simulation.particles.capacity);
  }

  const sorted = Array.from(samples).sort((left, right) => left - right);
  const p99 = sorted[Math.ceil(sorted.length * 0.99) - 1];
  const heapAfter = process.memoryUsage().heapUsed;
  const diagnostics = simulation.spellDiagnostics("fireball");
  assert.ok(p99 < 8, `spell simulation p99 ${p99.toFixed(3)} ms exceeded 8 ms`);
  assert.equal(diagnostics.appliedRevision, 60);
  assert.ok(diagnostics.retainedRevisions <= 257);
  assert.ok(simulation.impactEvents.length > 0);
  assert.ok(simulation.particles.dropped > 0);
  assert.ok(simulation.particles.wallBounces > 0);
  assert.ok(heapAfter - heapBefore < 64 * 2 ** 20, "spell stress exceeded 64 MiB");
  assert.doesNotThrow(() => JSON.stringify(simulation.snapshot()));
  console.log(JSON.stringify({
    hardware: `${os.cpus()[0]?.model ?? "unknown CPU"} (${os.cpus().length} logical)`,
    node: process.version,
    ticks: totalTicks,
    revisions: diagnostics.retainedRevisions,
    particleDrops: simulation.particles.dropped,
    particleWallBounces: simulation.particles.wallBounces,
    simP99Ms: Number(p99.toFixed(3)),
    heapDeltaMiB: Number(((heapAfter - heapBefore) / 2 ** 20).toFixed(2)),
  }));
});
