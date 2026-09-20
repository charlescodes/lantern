import test from "node:test";
import assert from "node:assert/strict";
import { Simulation } from "../src/sim/simulation.js";
import { ArenaScenario } from "../src/sim/scenario.js";
import { GridMap } from "../src/sim/grid_map.js";
import { placeInstance, editMechanisms, paintStructure } from "../src/authoring/authoring_commands.js";
import { GAMEPLAY_PROFILE_PRE_COMBAT, ENEMY_AI_PROFILE_NONE } from "../src/config.js";

function puzzle(definitionId = "mechanism.mover") {
  let document = new ArenaScenario(new GridMap(12, 12, undefined, { x: 2.5, z: 5.5 })).toAuthoringJSON();
  document = placeInstance(document, "mechanism.lever", 3.5, 5.5).document;
  const lever = document.layers[0].instances.at(-1).id;
  document = placeInstance(document, definitionId, 5.5, 5.5, { rotation: 3, properties: { distanceCells: 3, speed: 2 } }).document;
  const mover = document.layers[0].instances.at(-1).id;
  document = editMechanisms(document, { type: "addMechanismLink", from: { nodeId: lever, port: "on" }, to: { nodeId: mover, port: "positionB" } });
  return { document, mover };
}
const simulation = document => new Simulation({ scenario: new ArenaScenario(document), particleBurstCount: 0,
  enemyAiProfile: ENEMY_AI_PROFILE_NONE, gameplayProfile: GAMEPLAY_PROFILE_PRE_COMBAT });

test("mover travels exact rail endpoints, holds, reverses and replays without baking a wall at A", () => {
  const { document } = puzzle(), s = simulation(document);
  assert.equal(s.map.get(5, 5), 0);
  assert.equal(s.snapshot().map.occluderCells[65], 1);
  s.tick({ interact: true }); for (let i = 0; i < 100; i++) s.tick(null);
  assert.equal(s.movers.x[0], 8.5);
  assert.equal(s.snapshot().map.occluderCells[65], 0);
  const revision = s.mapRevision;
  for (let i = 0; i < 10; i++) s.tick(null);
  assert.equal(s.mapRevision, revision);
  assert.equal(s.mechanisms.events.toArray().filter(event => event.nodeId === s.movers.nodes[0].id && event.kind === "arrivedB").length, 1);
  assert.deepEqual(Simulation.replay(s.exportCommandLog()).snapshot(), s.snapshot());
  s.tick({ interact: true }); for (let i = 0; i < 100; i++) s.tick(null);
  assert.equal(s.movers.x[0], 5.5);
  s.reset(); assert.equal(s.movers.x[0], 5.5);
});

test("mover pushes the player, but safely stalls at a pinch without overlapping", () => {
  const { document, mover } = puzzle(), s = simulation(document);
  s.tick({ interact: true });
  s.player.x = 6.3; s.player.z = 5.5;
  for (let i = 0; i < 20; i++) s.tick(null);
  assert.ok(s.player.x > 6.8);
  // A closed runtime gate/wall is not authored into the rail.
  s.layerMaps[0].set(8, 5, 1);
  for (let i = 0; i < 100; i++) s.tick(null);
  assert.ok(s.player.x + s.player.radius <= 8.001);
  assert.ok(s.movers.x[0] + 0.5 <= s.player.x - s.player.radius + 0.002);
  assert.equal(s.snapshot().mechanisms.devices.find(d => d.id === mover).blocked, true);
});

test("spiked mover damages a living actor once for one continuous contact", () => {
  const { document } = puzzle("mechanism.spiked-mover"), s = simulation(document);
  s.player.x = 6.3; s.player.z = 5.5;
  s.tick({ interact: true });
  for (let i = 0; i < 30; i++) s.tick(null);
  assert.equal(s.player.health, 75);
});

test("mover authoring validates every lane cell", () => {
  const { document } = puzzle();
  assert.throws(() => new ArenaScenario(paintStructure(document, 7, 5, "structure.wall")), /Mover lane/);
});
