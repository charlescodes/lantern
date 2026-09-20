import test from "node:test";
import assert from "node:assert/strict";
import { KinematicPush, moverBodyOverlap } from "../src/sim/kinematic_mover.js";

const mover = { x: 1.5, z: 1.5, y: 0, height: 1.9, layerIndex: 0, box: true, halfX: 0.5, halfZ: 0.5 };
const body = (x, extra = {}) => ({ x, z: 1.5, y: 0, height: 1.6, layerIndex: 0, box: false, radius: 0.3, halfX: 0.3, halfZ: 0.3, ...extra });
test("push closure commits only a fully valid chain and leaves source records untouched", () => {
  const bodies = [body(2.3), body(2.9)], before = structuredClone(bodies), scratch = new KinematicPush(8);
  assert.equal(scratch.tryMove(mover, bodies, 2, 0.025, 0, () => false), true);
  assert.ok(scratch.x[1] > bodies[1].x);
  assert.deepEqual(bodies, before);
  assert.equal(moverBodyOverlap(bodies[0], scratch.x[0], 1.5, bodies[1], scratch.x[1], 1.5), false);
  assert.equal(scratch.tryMove(mover, bodies, 2, 0.025, 0, (b, x) => x + b.halfX > 3.2), false);
  assert.deepEqual(bodies, before);
});
test("bounded push ignores overhead/other-floor bodies and rejects immovable or over-budget travel", () => {
  const bodies = [body(2.3, { y: 2 }), body(2.3, { layerIndex: 1 })], scratch = new KinematicPush(8);
  assert.equal(scratch.tryMove(mover, bodies, 2, 0.025, 0, () => false), true);
  assert.equal(scratch.touched[0], 0); assert.equal(scratch.touched[1], 0);
  assert.equal(scratch.tryMove(mover, [], 0, 0.1, 0, () => false), false);
  assert.equal(scratch.tryMove(mover, [], 0, 0.025, 0, () => false, [{ ...mover, x: 2.5 }]), false);
});
