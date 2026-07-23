import test from "node:test";
import assert from "node:assert/strict";

import { recoveryPresentationSearch } from "../src/presentation/render_lab.js";
import { parsePresentationOptions } from "../src/presentation/options.js";

test("renderer failure recovery lowers one resident-light tier with an eight-light floor", () => {
  assert.equal(
    parsePresentationOptions(recoveryPresentationSearch(
      "?renderer=3d&lights=64&dpr=2",
      "lower-lights",
    )).lights,
    32,
  );
  assert.equal(
    parsePresentationOptions(recoveryPresentationSearch(
      "?renderer=3d&lights=16",
      "lower-lights",
    )).lights,
    8,
  );
  assert.equal(
    parsePresentationOptions(recoveryPresentationSearch(
      "?renderer=3d&lights=8",
      "lower-lights",
    )).lights,
    8,
  );
});

test("renderer failure recovery can force WebGL 2 or return directly to Canvas2D", () => {
  const webgl = parsePresentationOptions(recoveryPresentationSearch(
    "?renderer=3d&lights=32",
    "webgl",
  ));
  assert.equal(webgl.renderer, "3d");
  assert.equal(webgl.backend, "webgl");
  assert.equal(webgl.forceWebGL, true);
  assert.equal(webgl.lights, 32);

  const canvas = parsePresentationOptions(recoveryPresentationSearch(
    "?renderer=3d&backend=webgl&lights=64",
    "canvas",
  ));
  assert.equal(canvas.renderer, "2d");
  assert.equal(canvas.backend, "auto");
  assert.equal(canvas.forceWebGL, false);
  assert.equal(canvas.lights, 64);
});
