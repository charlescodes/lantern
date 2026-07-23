// @ts-check

const CONTACT_VELOCITY_EPSILON = 1e-12;

/** @param {number} value @param {number} maximum */
function clampMagnitude(value, maximum) {
  return Math.max(-maximum, Math.min(maximum, value));
}

/**
 * Returns the part of `source` that is still present in `unresolved`.
 * Opposing source velocities cannot create a correction in the other direction.
 * @param {number} source
 * @param {number} unresolved
 */
function cappedAlignedVelocity(source, unresolved) {
  if (Math.abs(unresolved) <= CONTACT_VELOCITY_EPSILON || source * unresolved <= 0) {
    return 0;
  }
  return Math.sign(unresolved) * Math.min(Math.abs(source), Math.abs(unresolved));
}

/**
 * Resolves one player-versus-dynamic-body contact without allocating.
 *
 * Body and player external momentum use the physical restitution response.
 * Any closure still attributable to controller locomotion uses zero restitution,
 * so pressing into a body cannot store a delayed reaction in external velocity.
 *
 * @param {{
 *   vx:number,
 *   vz:number,
 *   locomotionVx:number,
 *   locomotionVz:number,
 *   externalVx:number,
 *   externalVz:number,
 *   inverseMass:number
 * }} player
 * @param {{vx:number,vz:number,inverseMass:number}} body
 * @param {number} nx contact normal from the player toward the body
 * @param {number} nz contact normal from the player toward the body
 * @param {number} restitution
 * @param {number} friction
 */
export function resolvePlayerDynamicBodyVelocity(
  player,
  body,
  nx,
  nz,
  restitution,
  friction,
) {
  const inverseMassSum = player.inverseMass + body.inverseMass;
  player.vx = player.locomotionVx + player.externalVx;
  player.vz = player.locomotionVz + player.externalVz;
  if (inverseMassSum <= 0) return;

  const tangentX = -nz;
  const tangentZ = nx;
  let totalRelativeVx = body.vx - player.vx;
  let totalRelativeVz = body.vz - player.vz;
  let unresolvedNormalSpeed = totalRelativeVx * nx + totalRelativeVz * nz;
  if (unresolvedNormalSpeed >= -CONTACT_VELOCITY_EPSILON) return;

  const genuineRelativeVx = body.vx - player.externalVx;
  const genuineRelativeVz = body.vz - player.externalVz;
  const genuineNormalSpeed = genuineRelativeVx * nx + genuineRelativeVz * nz;
  const genuineClosingSpeed = Math.min(
    Math.max(-genuineNormalSpeed, 0),
    -unresolvedNormalSpeed,
  );

  if (genuineClosingSpeed > CONTACT_VELOCITY_EPSILON) {
    const normalImpulse =
      ((1 + restitution) * genuineClosingSpeed) / inverseMassSum;
    const impulseX = normalImpulse * nx;
    const impulseZ = normalImpulse * nz;
    player.externalVx -= impulseX * player.inverseMass;
    player.externalVz -= impulseZ * player.inverseMass;
    body.vx += impulseX * body.inverseMass;
    body.vz += impulseZ * body.inverseMass;

    totalRelativeVx =
      body.vx - player.externalVx - player.locomotionVx;
    totalRelativeVz =
      body.vz - player.externalVz - player.locomotionVz;
    const unresolvedTangentSpeed =
      totalRelativeVx * tangentX + totalRelativeVz * tangentZ;
    const genuineTangentSpeed =
      (body.vx - player.externalVx) * tangentX
      + (body.vz - player.externalVz) * tangentZ;
    const frictionSourceSpeed = cappedAlignedVelocity(
      genuineTangentSpeed,
      unresolvedTangentSpeed,
    );
    const tangentImpulse = clampMagnitude(
      -frictionSourceSpeed / inverseMassSum,
      normalImpulse * friction,
    );
    const frictionX = tangentX * tangentImpulse;
    const frictionZ = tangentZ * tangentImpulse;
    player.externalVx -= frictionX * player.inverseMass;
    player.externalVz -= frictionZ * player.inverseMass;
    body.vx += frictionX * body.inverseMass;
    body.vz += frictionZ * body.inverseMass;
  }

  totalRelativeVx =
    body.vx - player.externalVx - player.locomotionVx;
  totalRelativeVz =
    body.vz - player.externalVz - player.locomotionVz;
  unresolvedNormalSpeed = totalRelativeVx * nx + totalRelativeVz * nz;
  const locomotionNormalSpeed =
    -player.locomotionVx * nx - player.locomotionVz * nz;
  const locomotionClosingSpeed = Math.min(
    Math.max(-locomotionNormalSpeed, 0),
    Math.max(-unresolvedNormalSpeed, 0),
  );

  if (locomotionClosingSpeed > CONTACT_VELOCITY_EPSILON) {
    const normalImpulse = locomotionClosingSpeed / inverseMassSum;
    const impulseX = normalImpulse * nx;
    const impulseZ = normalImpulse * nz;
    player.locomotionVx -= impulseX * player.inverseMass;
    player.locomotionVz -= impulseZ * player.inverseMass;
    body.vx += impulseX * body.inverseMass;
    body.vz += impulseZ * body.inverseMass;

    totalRelativeVx =
      body.vx - player.externalVx - player.locomotionVx;
    totalRelativeVz =
      body.vz - player.externalVz - player.locomotionVz;
    const unresolvedTangentSpeed =
      totalRelativeVx * tangentX + totalRelativeVz * tangentZ;
    const locomotionTangentSpeed =
      -player.locomotionVx * tangentX - player.locomotionVz * tangentZ;
    const frictionSourceSpeed = cappedAlignedVelocity(
      locomotionTangentSpeed,
      unresolvedTangentSpeed,
    );
    const tangentImpulse = clampMagnitude(
      -frictionSourceSpeed / inverseMassSum,
      normalImpulse * friction,
    );
    const frictionX = tangentX * tangentImpulse;
    const frictionZ = tangentZ * tangentImpulse;
    player.locomotionVx -= frictionX * player.inverseMass;
    player.locomotionVz -= frictionZ * player.inverseMass;
    body.vx += frictionX * body.inverseMass;
    body.vz += frictionZ * body.inverseMass;
  }

  player.vx = player.locomotionVx + player.externalVx;
  player.vz = player.locomotionVz + player.externalVz;
}
