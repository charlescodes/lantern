import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("browser perception stress uses production adapters without a gameplay mutation API", async () => {
  const harness = await readFile(
    new URL("./browser/perception_stress_harness.js", import.meta.url),
    "utf8",
  );
  const html = await readFile(
    new URL("./browser/perception_stress.html", import.meta.url),
    "utf8",
  );
  assert.match(harness, /createPresentation/);
  assert.match(harness, /createPerceptionStressSimulation/);
  assert.match(harness, /TrueSightSystem/);
  assert.doesNotMatch(harness, /window\.__lantern/);
  assert.match(html, /perception_stress_harness\.js/);
});
