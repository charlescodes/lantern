// @ts-check

/**
 * A body riding a connector remains visually continuous between its authored
 * floor handoffs. The active runtime layer may still be the lower or upper
 * endpoint while the support carries it through world Y.
 * @param {Record<string, any>} body
 * @param {string | null | undefined} visibleLayerId
 * @param {Array<Record<string, any>> | undefined} elevators
 */
export function bodyVisibleOnRuntimeLayer(body, visibleLayerId, elevators) {
  if (body.layerId === visibleLayerId) return true;
  if (body.supportKind !== "elevator") return false;
  const supportId = Number(body.supportId ?? body.transitConnectorId);
  if (!Number.isFinite(supportId)) return false;
  for (const elevator of elevators ?? []) {
    if (Number(elevator.id) !== supportId) continue;
    return elevator.lowerLayerId === visibleLayerId
      || elevator.upperLayerId === visibleLayerId;
  }
  return false;
}

/**
 * Lower-floor presentation owns the visible piston for the whole cycle. An
 * upper-floor observer sees the platform only while it is crossing the floor
 * plane; once it drops below that narrow band, the endpoint reads as a hole.
 * The local rider is the exception so camera continuity is preserved during a
 * descent before its per-body lower-layer handoff.
 * @param {Record<string, any>} elevator
 * @param {string | null | undefined} visibleLayerId
 * @param {Record<string, any> | null | undefined} player
 * @param {number} upperBandMeters
 */
export function elevatorVisibleOnRuntimeLayer(
  elevator,
  visibleLayerId,
  player,
  upperBandMeters,
) {
  if (elevator.lowerLayerId === visibleLayerId) return true;
  if (elevator.upperLayerId !== visibleLayerId) return false;
  const playerRidesElevator = player?.supportKind === "elevator"
    && Number(player.supportId) === Number(elevator.id);
  return playerRidesElevator
    || elevator.currentY >= elevator.upperY - upperBandMeters;
}
