import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("multi-layer UI is one generated fixed panel with guarded semantic controls", async () => {
  const [html, css, main, panel] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../styles.css", import.meta.url), "utf8"),
    readFile(new URL("../src/main.js", import.meta.url), "utf8"),
    readFile(new URL("../src/browser/layer_panel.js", import.meta.url), "utf8"),
  ]);
  assert.match(html, /id="layer-panel"[\s\S]*?data-developer-surface/);
  assert.doesNotMatch(html, /data-layer-id=/);
  assert.match(css, /\.layer-panel \{[\s\S]*?position: absolute/);
  assert.match(css, /body\[data-mode="edit"\] \.layer-panel/);
  assert.match(main, /new LayerPanel\(\{[\s\S]*?onActivate:[\s\S]*?onReference:/);
  assert.match(panel, /New above/);
  assert.match(panel, /New below/);
  assert.match(panel, /Reference overlay/);
  assert.match(panel, /Set start/);
  assert.match(panel, /window\.confirm/);
  assert.match(panel, /Validate map/);
  assert.match(panel, /diagnostic\.layerId[\s\S]*?this\.onActivate/);
});

test("play activation and probes keep editor, reference, start, and runtime IDs distinct", async () => {
  const main = await readFile(new URL("../src/main.js", import.meta.url), "utf8");
  assert.match(main, /editorLayerBeforePlay/);
  assert.match(main, /playerStartLayerId[\s\S]*?type: "activateLayer"/);
  assert.match(main, /activeEditorLayerId: editor\.activeLayerId/);
  assert.match(main, /referenceLayerId: editor\.referenceLayerId/);
  assert.match(main, /currentRuntimeLayerId:/);
  assert.match(main, /activateAuthoringLayer\(layerId\)/);
  assert.match(main, /validateAuthoringMap\(\)/);
});
