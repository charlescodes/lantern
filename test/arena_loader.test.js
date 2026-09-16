import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { arenaMapUrl, loadArenaScenario } from "../src/browser/arena_loader.js";
import {
  createDebugArenaScenario,
  createHoleDebugArenaScenario,
  createNavigationDebugArenaScenario,
  createVerticalDebugArenaScenario,
} from "../src/sim/scenario.js";
import { Simulation } from "../src/sim/simulation.js";

async function fetchSavedMap(url, options) {
  assert.equal(options.cache, "no-store");
  return { ok: true, json: async () => JSON.parse(await readFile(url, "utf8")) };
}

test("arena routes select saved files independently of renderer and support new map names", () => {
  assert.equal(arenaMapUrl().pathname.split("/").pop(), "default.json");
  assert.equal(arenaMapUrl("?arena=holes&renderer=2d").href,
    arenaMapUrl("?arena=holes&renderer=3d").href);
  assert.equal(arenaMapUrl("?arena=my-new-map").pathname.split("/").pop(), "my-new-map.json");
  for (const name of ["../secret", "/tmp/map", "navigation.json", "a/b"]) {
    assert.throws(() => arenaMapUrl(`?arena=${encodeURIComponent(name)}`), /Arena name/);
  }
});

test("saved arenas preserve the exported layouts with only the requested navigation settings", async () => {
  for (const [name, factory] of Object.entries({
    default: createDebugArenaScenario,
    elevator: createVerticalDebugArenaScenario,
    holes: createHoleDebugArenaScenario,
    navigation: createNavigationDebugArenaScenario,
  })) {
    const expected = factory().toAuthoringJSON();
    expected.metadata.id = name;
    expected.metadata.name = `Lantern ${name} arena`;
    if (name === "navigation") {
      const obelisk = expected.layers.flatMap((layer) => layer.instances)
        .find((instance) => instance.definitionId === "object.obelisk");
      obelisk.properties = { enemyArchetype: "urchin", maximumAlive: 1, spawnIntervalTicks: 600 };
    }
    const scenario = await loadArenaScenario(`?arena=${name}`, fetchSavedMap);
    assert.deepEqual(scenario.toAuthoringJSON(), expected, name);
  }
});

test("navigation settings survive save, reset, and replay without changing spawn rules", async () => {
  const scenario = await loadArenaScenario("?arena=navigation&renderer=3d", fetchSavedMap);
  const simulation = new Simulation({ scenario, particleBurstCount: 0 });
  assert.equal(simulation.enemies.activeCount, 0);
  simulation.tick(null);
  assert.equal(simulation.snapshot().enemies[0].archetype, "urchin");
  const encounter = simulation.snapshot().encounter.obelisks[0];
  assert.equal(encounter.maximumAlive, 1);
  assert.equal(encounter.spawnIntervalTicks, 600);
  assert.equal(encounter.nextSpawnTick, 601);
  assert.deepEqual(JSON.parse(simulation.saveScenario()), scenario.toAuthoringJSON());
  const recording = simulation.exportCommandLog();
  assert.deepEqual(recording.initialAuthoringMap, scenario.toAuthoringJSON());
  assert.deepEqual(Simulation.replay(recording).snapshot(), simulation.snapshot());
  simulation.tick({ actions: [{ type: "reset" }] });
  assert.deepEqual(JSON.parse(simulation.saveScenario()), scenario.toAuthoringJSON());
});

test("missing, unreadable, and invalid maps fail explicitly without a procedural fallback", async () => {
  await assert.rejects(loadArenaScenario("?arena=missing", async () => ({
    ok: false, status: 404,
  })), /missing\.json: HTTP 404/);
  await assert.rejects(loadArenaScenario("?arena=navigation", async () => {
    throw new Error("network unavailable");
  }), /navigation\.json: network unavailable/);
  await assert.rejects(loadArenaScenario("?arena=navigation", async () => ({
    ok: true, json: async () => { throw new SyntaxError("invalid JSON"); },
  })), /navigation\.json: invalid JSON/);
  await assert.rejects(loadArenaScenario("?arena=navigation", async () => ({
    ok: true, json: async () => ({ format: "lantern-authoring-map", version: 999 }),
  })), /Could not load arena map/);
});
