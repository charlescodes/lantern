import test from "node:test";
import assert from "node:assert/strict";

import { GridMap } from "../src/sim/grid_map.js";
import { placeInstance } from "../src/authoring/authoring_commands.js";
import { ArenaScenario } from "../src/sim/scenario.js";
import { Simulation } from "../src/sim/simulation.js";

test("a high-speed projectile cannot tunnel through a one-cell wall", () => {
  const map = new GridMap(8, 5, undefined, { x: 1.5, z: 1.5 });
  map.set(3, 2, 1);
  const simulation = new Simulation({ map, seed: 5, particleBurstCount: 4 });
  const id = simulation.projectiles.spawn({
    x: 1.5,
    z: 2.5,
    vx: 240,
    vz: 0,
    lifetime: 2,
    radius: 0.12,
  });
  simulation.tick(null);
  assert.ok(id > 0);
  assert.equal(simulation.projectiles.activeCount, 0);
  assert.equal(simulation.impactEvents.length, 1);
  const [impact] = simulation.impactEvents.toArray();
  assert.equal(impact.projectileId, id);
  assert.equal(impact.cell.cx, 3);
  assert.ok(impact.x < 3.1);
  assert.equal(simulation.particles.activeCount, 4);
});

test("projectile capacity rejects excess spawns and exposes a dropped count", () => {
  const simulation = new Simulation({ projectileCapacity: 1, particleBurstCount: 1 });
  const spawn = { x: 2, z: 2, vx: 1, vz: 0, lifetime: 2, radius: 0.12 };
  assert.ok(simulation.projectiles.spawn(spawn) > 0);
  assert.equal(simulation.projectiles.spawn(spawn), 0);
  assert.equal(simulation.projectiles.activeCount, 1);
  assert.equal(simulation.projectiles.dropped, 1);
});

function projectileAgainstDefinition(definitionId) {
  const map = new GridMap(10, 5, undefined, { x: 1.5, z: 2.5 });
  const source = placeInstance(
    new ArenaScenario(map).toAuthoringJSON(),
    definitionId,
    4.5,
    2.5,
  );
  const simulation = new Simulation({
    scenario: new ArenaScenario(source.document),
    particleBurstCount: 0,
  });
  simulation.projectiles.spawn({
    x: 2,
    z: 2.5,
    vx: 180,
    vz: 0,
    lifetime: 2,
    radius: 0.12,
  });
  simulation.tick(null);
  return simulation;
}

test("the v18 projectile flight band clears low props and hits tall props", () => {
  for (const definitionId of ["object.table", "object.rock.small", "object.rock.medium"]) {
    const simulation = projectileAgainstDefinition(definitionId);
    assert.equal(simulation.impactEvents.length, 0, `${definitionId} should be cleared`);
    assert.equal(simulation.projectiles.activeCount, 1);
  }
  for (const definitionId of ["object.rock.large", "object.torch"]) {
    const simulation = projectileAgainstDefinition(definitionId);
    assert.equal(simulation.impactEvents.toArray()[0].hit.kind, "rock");
    assert.equal(simulation.projectiles.activeCount, 0);
  }
});

test("projectile world Y is authoritative, survives swap removal, and reaches snapshots and probes", () => {
  const simulation = new Simulation({ particleBurstCount: 0 });
  const first = simulation.projectiles.spawn({
    x: 2,
    z: 2,
    vx: 0,
    vz: 0,
    lifetime: 2,
    radius: 0.12,
    worldY: 4.25,
  });
  const second = simulation.projectiles.spawn({
    x: 3,
    z: 2,
    vx: 0,
    vz: 0,
    lifetime: 2,
    radius: 0.12,
    worldY: 5.5,
  });
  simulation.projectiles.removeSwap(0);
  const index = simulation.projectiles.findIndexById(second);
  assert.equal(index, 0);
  assert.equal(simulation.projectiles.worldY[index], 5.5);
  const snapshot = simulation.snapshot();
  assert.equal(snapshot.projectiles[0].worldY, 5.5);
  assert.equal(snapshot.projectiles[0].previousWorldY, 5.5);
  assert.equal(simulation.resolveSelection({ kind: "projectile", id: second }).position.y, 5.5);
  assert.equal(first > 0, true);
});
