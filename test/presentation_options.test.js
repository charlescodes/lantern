import test from "node:test";
import assert from "node:assert/strict";

import {
  PRESENTATION_FLAG_NAMES,
  PresentationFlags,
  parsePresentationOptions,
} from "../src/presentation/options.js";

test("renderer options default to the Canvas2D regression path", () => {
  assert.deepEqual(parsePresentationOptions(""), {
    renderer: "2d",
    backend: "auto",
    forceWebGL: false,
  });
  assert.deepEqual(parsePresentationOptions("?renderer=unknown&backend=webgl"), {
    renderer: "2d",
    backend: "auto",
    forceWebGL: false,
  });
});

test("renderer options select automatic 3D or force the WebGL 2 backend", () => {
  assert.deepEqual(parsePresentationOptions("?renderer=3d"), {
    renderer: "3d",
    backend: "auto",
    forceWebGL: false,
  });
  assert.deepEqual(parsePresentationOptions("?backend=webgl&renderer=3d"), {
    renderer: "3d",
    backend: "webgl",
    forceWebGL: true,
  });
  assert.deepEqual(parsePresentationOptions("?renderer=3d&backend=webgpu"), {
    renderer: "3d",
    backend: "auto",
    forceWebGL: false,
  });
});

test("presentation flags are bounded to visual-only A/B controls", () => {
  assert.deepEqual(PRESENTATION_FLAG_NAMES, ["dynamicLights", "bloom", "shadows"]);
  const flags = new PresentationFlags();
  assert.deepEqual(flags.snapshot(), {
    dynamicLights: true,
    bloom: false,
    shadows: false,
  });
  assert.equal(flags.set("bloom", true), true);
  assert.equal(flags.set("simulationLighting", true), false);
  assert.deepEqual(flags.snapshot(), {
    dynamicLights: true,
    bloom: true,
    shadows: false,
  });
});
