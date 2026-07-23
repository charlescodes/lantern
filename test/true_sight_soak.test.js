import test from "node:test";
import assert from "node:assert/strict";

import { PresentationFlags } from "../src/presentation/options.js";
import {
  TRUE_SIGHT_MAX_RAYS,
  TrueSightSystem,
} from "../src/visibility/true_sight.js";

test("TrueSight remains bounded and reuses storage through a sustained moving-observer run", () => {
  const width = 24;
  const height = 24;
  const cells = new Array(width * height).fill(0);
  for (let z = 2; z < 22; z += 3) {
    for (let x = 3; x < 21; x += 4) cells[z * width + x] = 1;
  }
  const flags = new PresentationFlags();
  const system = new TrueSightSystem({ flags });
  const value = {
    tick: 0,
    seed: 0x400,
    map: { width, height, cells },
    player: { x: 12, z: 12, previousX: 12, previousZ: 12 },
  };
  const initial = system.update(value, 0, { mode: "play", deltaMs: 0 });
  const identities = {
    frame: initial,
    logicalMask: initial.logicalMask,
    displayMask: initial.displayMask,
    polygon: initial.polygon,
    rays: initial.rays,
  };

  for (let frameIndex = 1; frameIndex <= 1_200; frameIndex += 1) {
    const angle = frameIndex * 0.013;
    value.tick = frameIndex;
    value.player.previousX = value.player.x;
    value.player.previousZ = value.player.z;
    value.player.x = 12 + Math.cos(angle) * 4;
    value.player.z = 12 + Math.sin(angle) * 4;
    if (frameIndex % 240 === 0) {
      flags.set("sightFade", !flags.values.sightFade);
      flags.set("sightDebug", !flags.values.sightDebug);
    }
    const frame = system.update(value, 0.5, {
      mode: frameIndex % 400 < 20 ? "edit" : "play",
      deltaMs: 1_000 / 60,
    });
    assert.equal(frame, identities.frame);
    assert.equal(frame.logicalMask, identities.logicalMask);
    assert.equal(frame.displayMask, identities.displayMask);
    assert.equal(frame.polygon, identities.polygon);
    assert.equal(frame.rays, identities.rays);
    assert.ok(frame.rayCount <= TRUE_SIGHT_MAX_RAYS);
    assert.ok(frame.polygonVertexCount <= TRUE_SIGHT_MAX_RAYS);
    assert.ok(frame.displayMask.every((entry) => entry >= 0 && entry <= 255));
  }

  assert.equal(system.frame.topologyBuildCount, 1);
  assert.doesNotThrow(() => JSON.stringify(system.frame.diagnostics()));
});
