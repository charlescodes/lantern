import test from "node:test";
import assert from "node:assert/strict";

import {
  AUTHORING_MAP_FORMAT,
  AUTHORING_MAP_VERSION,
  loadAuthoringMap,
  migrateLegacyMap,
} from "../src/authoring/authoring_map.js";
import {
  paintStructure,
  paintSurface,
  placeInstance,
} from "../src/authoring/authoring_commands.js";
import { compileAuthoringMap } from "../src/authoring/map_compiler.js";
import { GridMap } from "../src/sim/grid_map.js";
import { ArenaScenario } from "../src/sim/scenario.js";
import { Simulation } from "../src/sim/simulation.js";

function borderedMap(width = 8, height = 8, spawn = { x: 2.5, z: 2.5 }) {
  const map = new GridMap(width, height, undefined, spawn);
  for (let x = 0; x < width; x += 1) {
    map.set(x, 0, 1);
    map.set(x, height - 1, 1);
  }
  for (let z = 0; z < height; z += 1) {
    map.set(0, z, 1);
    map.set(width - 1, z, 1);
  }
  return map;
}

function sourceDocument() {
  return new ArenaScenario(borderedMap()).toAuthoringJSON();
}

function comparableCompilation(compiled) {
  return {
    document: compiled.document,
    activeLayer: compiled.activeLayer,
    map: compiled.map.toJSON(),
    surface: {
      legend: compiled.surface.legend,
      cells: Array.from(compiled.surface.cells),
    },
    structure: {
      legend: compiled.structure.legend,
      cells: Array.from(compiled.structure.cells),
    },
    solidMask: Array.from(compiled.solidMask),
    occluderMask: Array.from(compiled.occluderMask),
    instances: compiled.instances,
    entities: compiled.entities,
    runtimeMappings: compiled.runtimeMappings,
  };
}

test("legacy map and scenario documents migrate without changing playable geometry", () => {
  const map = borderedMap(9, 8, { x: 2.5, z: 3.5 });
  map.set(6, 4, 1);
  const legacy = {
    version: 3,
    width: map.width,
    height: map.height,
    cells: Array.from(map.cells),
    playerSpawn: { ...map.playerSpawn },
    entities: [
      { kind: "rock", archetype: "medium", x: 4.5, z: 4.5 },
      { kind: "obelisk", x: 6.5, z: 4.5 },
    ],
  };

  const migrated = migrateLegacyMap(legacy);
  const compiled = compileAuthoringMap(migrated);
  assert.equal(migrated.format, AUTHORING_MAP_FORMAT);
  assert.equal(migrated.version, AUTHORING_MAP_VERSION);
  assert.deepEqual(Array.from(compiled.map.cells), legacy.cells);
  assert.deepEqual(compiled.map.playerSpawn, legacy.playerSpawn);
  assert.equal(compiled.entities.filter((entity) => entity.kind === "rock").length, 1);
  assert.deepEqual(compiled.entities.find((entity) => entity.kind === "obelisk")?.x, 6.5);

  const loadedLegacyMap = ArenaScenario.fromJSON(map.toJSON());
  assert.deepEqual(Array.from(loadedLegacyMap.map.cells), Array.from(map.cells));
});

test("new-format save/load round trips stable placed-instance IDs", () => {
  const first = placeInstance(sourceDocument(), "object.torch", 4.5, 4.5);
  const second = placeInstance(first.document, "object.rock.small", 5.5, 5.5);
  const serialized = JSON.stringify(second.document);
  const restored = loadAuthoringMap(serialized);

  assert.deepEqual(restored, second.document);
  assert.deepEqual(
    restored.layers[0].instances.map((instance) => instance.id),
    [first.instanceId, second.instanceId],
  );
  assert.deepEqual(
    ArenaScenario.fromJSON(serialized).toAuthoringJSON(),
    second.document,
  );
});

test("painting a surface changes material data without changing collision", () => {
  const source = sourceDocument();
  const before = compileAuthoringMap(source);
  const painted = paintSurface(source, 3, 3, "surface.moss");
  const after = compileAuthoringMap(painted);

  assert.deepEqual(Array.from(after.solidMask), Array.from(before.solidMask));
  assert.deepEqual(Array.from(after.map.cells), Array.from(before.map.cells));
  const index = 3 * after.map.width + 3;
  assert.equal(after.surface.legend[after.surface.cells[index]], "surface.moss");
});

test("wall compilation changes the solid and occluder masks", () => {
  const source = sourceDocument();
  const index = 3 * 8 + 3;
  const compiled = compileAuthoringMap(
    paintStructure(source, 3, 3, "structure.wall"),
  );

  assert.equal(compiled.solidMask[index], 1);
  assert.equal(compiled.occluderMask[index], 1);
  assert.equal(compiled.map.get(3, 3), 1);
});

test("a sparse pillar footprint contributes collision and sight occlusion", () => {
  const placed = placeInstance(sourceDocument(), "object.pillar", 3.5, 3.5);
  const compiled = compileAuthoringMap(placed.document);
  const index = 3 * 8 + 3;
  const mapping = compiled.runtimeMappings.find(
    (candidate) => candidate.authoringId === placed.instanceId,
  );

  assert.equal(compiled.map.get(3, 3), 1);
  assert.equal(compiled.occluderMask[index], 1);
  assert.deepEqual(mapping?.collisionCells, [{ cx: 3, cz: 3 }]);
  assert.equal(compiled.entities.some((entity) => entity.authoringId === placed.instanceId), false);
});

test("unknown definitions and malformed legacy data report useful diagnostics", () => {
  const unknown = JSON.parse(JSON.stringify(sourceDocument()));
  unknown.layers[0].surface.legend[0] = "surface.missing";
  assert.throws(() => compileAuthoringMap(unknown), /Unknown definition "surface\.missing"/);
  assert.throws(
    () => migrateLegacyMap({
      version: 3,
      width: 2,
      height: 2,
      cells: [0, 2, 0, 0],
      playerSpawn: { x: 0.5, z: 0.5 },
      entities: [],
    }),
    /legacyMap\.cells\[1\].*0 \(floor\) or 1 \(wall\)/,
  );
  assert.throws(
    () => migrateLegacyMap({
      version: 1,
      width: 2,
      height: 2,
      cells: [0, "1", 0, 0],
      playerSpawn: { x: 0.5, z: 0.5 },
    }),
    /legacyMap\.cells\[1\].*0 \(floor\) or 1 \(wall\)/,
  );
  assert.throws(
    () => migrateLegacyMap({
      version: "1",
      width: 2,
      height: 2,
      cells: [0, 1, 0, 0],
      playerSpawn: { x: 0.5, z: 0.5 },
    }),
    /unsupported legacy map\/scenario version 1/,
  );
});

test("the stateless compiler produces deterministic output", () => {
  let source = paintSurface(sourceDocument(), 2, 3, "surface.moss");
  source = placeInstance(source, "object.pillar", 4.5, 4.5).document;
  source = placeInstance(source, "object.torch", 5.5, 4.5).document;

  assert.deepEqual(
    comparableCompilation(compileAuthoringMap(source)),
    comparableCompilation(compileAuthoringMap(JSON.parse(JSON.stringify(source)))),
  );
});

test("runtime rock movement never rewrites its saved authoring placement", () => {
  const scenario = new ArenaScenario(borderedMap(), [
    { kind: "rock", archetype: "small", x: 4.5, z: 4.5 },
  ]);
  const simulation = new Simulation({ scenario, particleBurstCount: 0 });
  const authoredX = simulation.authoringSnapshot().instances[0].x;
  simulation.rocks.vx[0] = 2;
  simulation.tick(null);

  assert.notEqual(simulation.rocks.x[0], authoredX);
  const saved = JSON.parse(simulation.saveMap());
  assert.equal(saved.layers[0].instances[0].x, authoredX);
  simulation.tick({ type: "restoreScenario" });
  assert.equal(simulation.rocks.x[0], authoredX);
});

test("prepared authoring presentation data is reused between ticks and refreshed after edits", () => {
  const simulation = new Simulation({ particleBurstCount: 0 });
  const before = simulation.snapshot();
  simulation.tick(null);
  const unchanged = simulation.snapshot();

  assert.equal(unchanged.authoring, before.authoring);
  assert.equal(unchanged.map.surface, before.map.surface);
  assert.equal(unchanged.map.structure, before.map.structure);
  assert.equal(Object.isFrozen(unchanged.authoring), true);

  simulation.tick({
    type: "paintSurface",
    cx: 12,
    cz: 12,
    definitionId: "surface.moss",
  });
  const changed = simulation.snapshot();
  assert.notEqual(changed.authoring, unchanged.authoring);
  assert.notEqual(changed.map.surface, unchanged.map.surface);
  const definitionId = changed.map.surface.legend[
    changed.map.surface.cells[12 * changed.map.width + 12]
  ];
  assert.equal(definitionId, "surface.moss");
});

test("new authoring commands remain fixed-tick mutations and replay deterministically", () => {
  const simulation = new Simulation({ particleBurstCount: 0 });
  const before = simulation.map.get(12, 12);
  assert.equal(before, 0);
  const command = {
    type: "placeInstance",
    definitionId: "object.pillar",
    x: 12.5,
    z: 12.5,
    rotation: 0,
  };
  assert.equal(simulation.map.get(12, 12), 0);
  simulation.tick(command);
  assert.equal(simulation.map.get(12, 12), 1);

  const replayed = Simulation.replay(simulation.exportCommandLog());
  assert.equal(replayed.map.get(12, 12), 1);
  assert.deepEqual(replayed.authoringSnapshot(), simulation.authoringSnapshot());
});
