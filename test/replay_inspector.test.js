import test from "node:test";
import assert from "node:assert/strict";

import { Simulation } from "../src/sim/simulation.js";

function comparable(simulation) {
  const snapshot = simulation.snapshot();
  return {
    seed: snapshot.seed,
    rngState: snapshot.rngState,
    tick: snapshot.tick,
    player: snapshot.player,
    projectiles: snapshot.projectiles,
    particles: snapshot.particles,
    recentEvents: snapshot.recentEvents,
    pools: snapshot.pools,
  };
}

test("same seed and command log replay to matching simulation state", () => {
  const simulation = new Simulation({ seed: 0xdecafbad, particleBurstCount: 12 });
  for (let tick = 0; tick < 360; tick += 1) {
    simulation.tick({
      move: tick < 180 ? { x: 19.5, z: 18.5 } : { x: 3.5, z: 4.5 },
      cast: tick % 18 === 0 ? { x: 11.5, z: 19.5 } : null,
    });
  }
  const recording = simulation.exportCommandLog();
  const replayed = Simulation.replay(recording);
  assert.deepEqual(comparable(replayed), comparable(simulation));
});

test("pinned projectile identity resolves after swap compaction", () => {
  const simulation = new Simulation({ projectileCapacity: 4, particleBurstCount: 1 });
  const spawn = (x) => simulation.projectiles.spawn({ x, z: 2, vx: 0, vz: 0, lifetime: 2, radius: 0.12 });
  spawn(1);
  spawn(2);
  const pinnedId = spawn(3);
  assert.equal(simulation.projectiles.findIndexById(pinnedId), 2);
  simulation.projectiles.removeSwap(0);
  const inspected = simulation.resolveSelection({ kind: "projectile", id: pinnedId });
  assert.equal(inspected.id, pinnedId);
  assert.equal(inspected.index, 0);
  assert.equal(inspected.position.x, 3);
});

test("map and debug mutations only apply when a tick consumes their command", () => {
  const simulation = new Simulation();
  const before = simulation.map.get(2, 2);
  const command = { type: "setTile", cx: 2, cz: 2, tile: before === 1 ? 0 : 1 };
  assert.equal(simulation.map.get(2, 2), before);
  simulation.tick(command);
  assert.equal(simulation.map.get(2, 2), before === 1 ? 0 : 1);
});

test("snapshots and exported recordings cannot mutate simulation history", () => {
  const simulation = new Simulation({ particleBurstCount: 1 });
  simulation.projectiles.spawn({ x: 1.5, z: 19.5, vx: 600, vz: 0, lifetime: 2, radius: 0.12 });
  simulation.tick({ move: { x: 5, z: 18.5 } });
  const snapshot = simulation.snapshot();
  const originalEventX = simulation.impactEvents.toArray()[0].x;
  snapshot.recentEvents[0].x = -999;
  const recording = simulation.exportCommandLog();
  recording.initialMap.cells[0] = 0;
  recording.commands[0].command.move.x = -999;
  assert.equal(simulation.impactEvents.toArray()[0].x, originalEventX);
  assert.equal(simulation.commandLogMap.cells[0], 1);
  assert.equal(simulation.commandLog.toArray()[0].command.move.x, 5);
});
