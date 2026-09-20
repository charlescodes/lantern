import test from "node:test";
import assert from "node:assert/strict";
import { Simulation } from "../src/sim/simulation.js";
import { ArenaScenario } from "../src/sim/scenario.js";
import { GridMap } from "../src/sim/grid_map.js";
import { placeInstance, editMechanisms, paintStructure } from "../src/authoring/authoring_commands.js";
import { ENEMY_AI_PROFILE_NONE, GAMEPLAY_PROFILE_PRE_COMBAT, PROJECTILE_KIND } from "../src/config.js";
import { deriveMechanismCastSeed } from "../src/spells/random.js";

function device(definitionId, properties = {}) {
  let document = new ArenaScenario(new GridMap(12, 12, undefined, { x: 2.5, z: 5.5 })).toAuthoringJSON();
  document = placeInstance(document, "mechanism.lever", 3.5, 3.5, { properties: { initialOn: true } }).document;
  const lever = document.layers[0].instances.at(-1).id;
  const floor = definitionId === "mechanism.floor-spikes";
  if (!floor) document = paintStructure(document, 5, 5, "structure.wall");
  document = placeInstance(document, definitionId, 5.5, 5.5, { properties, rotation: 1 }).document;
  const id = document.layers[0].instances.at(-1).id;
  if (floor) document = editMechanisms(document, { type: "addMechanismLink", from: { nodeId: lever, port: "on" }, to: { nodeId: id, port: "extended" } });
  else {
    document = editMechanisms(document, { type: "addMechanismNode", definitionId: "logic.repeater", properties: { intervalTicks: 300 } });
    document = editMechanisms(document, { type: "addMechanismLink", from: { nodeId: lever, port: "on" }, to: { nodeId: "logic-0001", port: "enabled" } });
    document = editMechanisms(document, { type: "addMechanismLink", from: { nodeId: "logic-0001", port: "pulse" }, to: { nodeId: id, port: definitionId === "mechanism.wall-spear" ? "thrust" : "fire" } });
  }
  return { document, id };
}
const sim = document => new Simulation({ scenario: new ArenaScenario(document), particleBurstCount: 0,
  enemyAiProfile: ENEMY_AI_PROFILE_NONE, gameplayProfile: GAMEPLAY_PROFILE_PRE_COMBAT });

test("environmental bolts hit players without exploding and replay exactly", () => {
  const { document, id } = device("mechanism.bolt-emitter"), s = sim(document);
  s.tick(null); s.tick(null);
  assert.equal(s.snapshot().projectiles[0].sourceAuthoringId, id);
  assert.equal(s.snapshot().projectiles[0].owner.id, id);
  for (let i = 2; i < 20; i++) s.tick(null);
  assert.equal(s.player.health, 85);
  assert.equal(s.impactEvents.length, 0);
  assert.equal(s.projectiles.activeCount, 0);
  assert.equal(s.snapshot().recentCombatEvents.find(e => e.type === "damage").owner.team, "environment");
  assert.deepEqual(Simulation.replay(s.exportCommandLog()).snapshot(), s.snapshot());
});

test("environmental bolts damage enemies without team immunity", () => {
  let { document } = device("mechanism.bolt-emitter");
  document = placeInstance(document, "actor.enemy.wizard", 4.5, 5.5).document;
  const s = sim(document);
  for (let i = 0; i < 20; i++) s.tick(null);
  assert.equal(s.enemies.health[0], 85);
  assert.equal(s.player.health, 100);
  assert.equal(s.snapshot().recentCombatEvents.find(e => e.type === "damage").owner.team, "environment");
});

test("instant Fireball needs no projectile slot and captures a source-local seed/revision", () => {
  const { document, id } = device("mechanism.spell-emitter", { mode: "instant-impact" }), s = sim(document);
  while (s.projectiles.activeCount < s.projectiles.capacity) s.projectiles.spawn({ x: 8, z: 8, vx: 0, vz: 0, radius: 0.01, lifetime: 100, projectileKind: PROJECTILE_KIND.bolt });
  s.tick(null); s.tick(null);
  assert.equal(s.projectiles.activeCount, s.projectiles.capacity);
  assert.equal(s.impactEvents.length, 1);
  const event = s.impactEvents.toArray()[0];
  assert.equal(event.projectileId, null); assert.equal(event.hit.kind, "emitter");
  assert.equal(event.effectSeed, deriveMechanismCastSeed(s.seed, id, event.spellCode, 0));
  assert.equal(event.definitionRevision, 1);
});

test("floor spikes activate at progress six, have source cooldown and no standing damage timer", () => {
  const { document } = device("mechanism.floor-spikes"), s = sim(document);
  s.player.x = 5.5;
  for (let i = 0; i < 5; i++) s.tick(null);
  assert.equal(s.player.health, 100);
  s.tick(null); assert.equal(s.player.health, 75);
  for (let i = 0; i < 60; i++) s.tick(null);
  assert.equal(s.player.health, 75);
  s.player.x = 7.5; s.tick(null); s.player.x = 5.5; s.tick(null);
  assert.equal(s.player.health, 50);
});

test("spear damages once per thrust, ignores busy pulses, and retracts to idle", () => {
  const { document, id } = device("mechanism.wall-spear"), s = sim(document);
  s.player.x = 4;
  for (let i = 0; i < 16; i++) s.tick(null);
  assert.equal(s.player.health, 75);
  s.mechanisms.write("logic-0001", "pulse"); s.tick(null);
  assert.equal(s.traps.ignored[s.traps.byId.get(id)], 1);
  for (let i = 0; i < 20; i++) s.tick(null);
  assert.equal(s.player.health, 75);
  assert.equal(s.traps.phase[s.traps.byId.get(id)], 0);
});
