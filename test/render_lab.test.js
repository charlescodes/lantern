import test from "node:test";
import assert from "node:assert/strict";

import {
  recoveryPresentationSearch,
  renderLabDiagnosticsText,
} from "../src/presentation/render_lab.js";
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

test("Render Lab reports fixed TrueSight texture transport diagnostics", () => {
  const text = renderLabDiagnosticsText({
    activeBackend: "webgpu",
    trueSightTransport: {
      textureCapacity: { width: 256, height: 256 },
      activeMaskDimensions: { width: 192, height: 128 },
      allocatedBytes: 65_536,
      textureVersion: 9,
      uploadCount: 8,
    },
  }, {});
  assert.match(
    text,
    /TrueSight GPU 256×256 fixed  active 192×128  65536 B  v9  8 uploads/,
  );
  assert.match(
    renderLabDiagnosticsText({
      activeBackend: "canvas2d",
      trueSightTransport: null,
    }, {}),
    /TrueSight GPU n\/a \(Canvas2D\)/,
  );
});
