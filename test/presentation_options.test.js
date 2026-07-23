import test from "node:test";
import assert from "node:assert/strict";

import {
  PRESENTATION_DPR_CAPS,
  PRESENTATION_FLAG_NAMES,
  PRESENTATION_LIGHT_CAPACITIES,
  PresentationFlags,
  canonicalizePresentationSearch,
  parsePresentationOptions,
  presentationOptionMode,
  presentationOptionsToSearch,
  updatePresentationSearch,
} from "../src/presentation/options.js";

const BALANCED = {
  renderer: "2d",
  backend: "auto",
  forceWebGL: false,
  lights: 16,
  dpr: 1.5,
  aa: true,
  dynamicLights: true,
  lightColorVariation: true,
  bloom: false,
  shadows: false,
};

test("presentation defaults keep Canvas2D routing and Balanced 3D settings", () => {
  assert.deepEqual(parsePresentationOptions(""), BALANCED);
  assert.deepEqual(PRESENTATION_LIGHT_CAPACITIES, [8, 16, 32, 64]);
  assert.deepEqual(PRESENTATION_DPR_CAPS, [1, 1.5, 2]);
});

test("all 3D startup and live URL values parse canonically", () => {
  assert.deepEqual(
    parsePresentationOptions(
      "?renderer=3d&backend=webgl&lights=64&dpr=2&aa=0"
      + "&dynamicLights=0&lightColorVariation=0&bloom=1&shadows=1",
    ),
    {
      renderer: "3d",
      backend: "webgl",
      forceWebGL: true,
      lights: 64,
      dpr: 2,
      aa: false,
      dynamicLights: false,
      lightColorVariation: false,
      bloom: true,
      shadows: true,
    },
  );
});

test("invalid values fall back independently without escaping bounded tiers", () => {
  assert.deepEqual(
    parsePresentationOptions(
      "?renderer=unknown&backend=webgl&lights=24&dpr=3&aa=yes"
      + "&dynamicLights=no&lightColorVariation=&bloom=true&shadows=-1",
    ),
    BALANCED,
  );
  assert.deepEqual(
    parsePresentationOptions("?renderer=3d&backend=webgpu"),
    { ...BALANCED, renderer: "3d" },
  );
});

test("canonical search output is stable and removes unsupported values", () => {
  const canonical = canonicalizePresentationSearch(
    "?backend=webgl&renderer=3d&lights=bogus&dpr=1&aa=0&bloom=1",
  );
  assert.equal(
    canonical,
    "?renderer=3d&backend=webgl&lights=16&dpr=1&aa=0"
    + "&dynamicLights=1&lightColorVariation=1&bloom=1&shadows=0",
  );
  assert.equal(
    presentationOptionsToSearch(parsePresentationOptions(canonical)),
    canonical,
  );
});

test("option metadata separates reload-required topology from live controls", () => {
  for (const name of ["renderer", "backend", "lights", "aa"]) {
    assert.equal(presentationOptionMode(name), "reload");
  }
  for (const name of [
    "dpr",
    "dynamicLights",
    "lightColorVariation",
    "bloom",
    "shadows",
  ]) {
    assert.equal(presentationOptionMode(name), "live");
  }
  assert.equal(presentationOptionMode("simulationLighting"), null);
  assert.equal(updatePresentationSearch("", "simulationLighting", true), null);
  assert.match(
    updatePresentationSearch("", "lights", 32),
    /lights=32/,
  );
});

test("presentation flags are bounded to visual-only live controls", () => {
  assert.deepEqual(PRESENTATION_FLAG_NAMES, [
    "dynamicLights",
    "lightColorVariation",
    "bloom",
    "shadows",
  ]);
  const flags = new PresentationFlags();
  assert.deepEqual(flags.snapshot(), {
    dynamicLights: true,
    lightColorVariation: true,
    bloom: false,
    shadows: false,
  });
  assert.equal(flags.set("lightColorVariation", false), true);
  assert.equal(flags.set("simulationLighting", true), false);
  assert.deepEqual(flags.snapshot(), {
    dynamicLights: true,
    lightColorVariation: false,
    bloom: false,
    shadows: false,
  });
});
