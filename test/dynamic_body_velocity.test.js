import test from "node:test";
import assert from "node:assert/strict";

import { resolvePlayerDynamicBodyVelocity } from "../src/sim/dynamic_body_velocity.js";

const RESTITUTION = 0.1;
const FRICTION = 0.35;
const EPSILON = 1e-12;

function playerVelocity({
  locomotionVx = 0,
  locomotionVz = 0,
  externalVx = 0,
  externalVz = 0,
  inverseMass = 1,
} = {}) {
  return {
    vx: locomotionVx + externalVx,
    vz: locomotionVz + externalVz,
    locomotionVx,
    locomotionVz,
    externalVx,
    externalVz,
    inverseMass,
  };
}

function assertClose(actual, expected, message) {
  assert.ok(
    Math.abs(actual - expected) <= EPSILON,
    `${message}: expected ${expected}, received ${actual}`,
  );
}

test("stationary-body contact reacts through locomotion without storing external velocity", () => {
  const player = playerVelocity({ locomotionVx: 4, inverseMass: 1 / 75 });
  const body = { vx: 0, vz: 0, inverseMass: 1 / 300 };

  resolvePlayerDynamicBodyVelocity(
    player,
    body,
    1,
    0,
    RESTITUTION,
    FRICTION,
  );

  assertClose(player.externalVx, 0, "external X velocity");
  assertClose(player.externalVz, 0, "external Z velocity");
  assertClose(player.locomotionVx, 0.8, "locomotion X velocity");
  assertClose(body.vx, 0.8, "body X velocity");
  assertClose(body.vx - player.vx, 0, "unresolved normal velocity");
});

test("an independently incoming body creates restituted external knockback", () => {
  const player = playerVelocity();
  const body = { vx: -2, vz: 0, inverseMass: 1 };

  resolvePlayerDynamicBodyVelocity(
    player,
    body,
    1,
    0,
    RESTITUTION,
    FRICTION,
  );

  assertClose(player.locomotionVx, 0, "locomotion X velocity");
  assertClose(player.externalVx, -1.1, "external X velocity");
  assertClose(body.vx, -0.9, "body X velocity");
  assertClose(body.vx - player.vx, 0.2, "restituted normal velocity");
});

test("mixed external and controller closure writes each reaction to its source channel", () => {
  const player = playerVelocity({ locomotionVx: 2, externalVx: 1 });
  const body = { vx: 0, vz: 0, inverseMass: 1 };

  resolvePlayerDynamicBodyVelocity(
    player,
    body,
    1,
    0,
    RESTITUTION,
    FRICTION,
  );

  assertClose(player.externalVx, 0.45, "external X velocity");
  assertClose(player.locomotionVx, 1.05, "locomotion X velocity");
  assertClose(body.vx, 1.5, "body X velocity");
  assertClose(body.vx - player.vx, 0, "unresolved normal velocity");
});

test("co-moving total velocities cannot create a phantom external impact", () => {
  const player = playerVelocity({ locomotionVx: -2, externalVx: 2 });
  const body = { vx: 0, vz: 0, inverseMass: 1 };

  resolvePlayerDynamicBodyVelocity(
    player,
    body,
    1,
    0,
    RESTITUTION,
    FRICTION,
  );

  assert.deepEqual(player, playerVelocity({ locomotionVx: -2, externalVx: 2 }));
  assert.deepEqual(body, { vx: 0, vz: 0, inverseMass: 1 });
});

test("angled friction stays in the velocity channel that produced the contact", () => {
  const player = playerVelocity({ locomotionVx: 2, locomotionVz: 1 });
  const body = { vx: 0, vz: 0, inverseMass: 1 };

  resolvePlayerDynamicBodyVelocity(
    player,
    body,
    1,
    0,
    RESTITUTION,
    FRICTION,
  );

  assertClose(player.externalVx, 0, "external X velocity");
  assertClose(player.externalVz, 0, "external Z velocity");
  assertClose(player.locomotionVx, 1, "locomotion X velocity");
  assertClose(player.locomotionVz, 0.65, "locomotion Z velocity");
  assertClose(body.vx, 1, "body X velocity");
  assertClose(body.vz, 0.35, "body Z velocity");

  const impactedPlayer = playerVelocity();
  const incomingBody = { vx: -2, vz: 1, inverseMass: 1 };
  resolvePlayerDynamicBodyVelocity(
    impactedPlayer,
    incomingBody,
    1,
    0,
    RESTITUTION,
    FRICTION,
  );

  assertClose(impactedPlayer.locomotionVx, 0, "impacted locomotion X velocity");
  assertClose(impactedPlayer.locomotionVz, 0, "impacted locomotion Z velocity");
  assertClose(impactedPlayer.externalVx, -1.1, "impacted external X velocity");
  assertClose(impactedPlayer.externalVz, 0.385, "impacted external Z velocity");
  assertClose(incomingBody.vx, -0.9, "incoming body X velocity");
  assertClose(incomingBody.vz, 0.615, "incoming body Z velocity");
});
