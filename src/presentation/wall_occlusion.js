// @ts-check

import { MOVEMENT_SOUND } from "../config.js";

export const WALL_HEIGHT_METERS = 2.5;
export const WALL_FADE_RADIUS_METERS = MOVEMENT_SOUND.walkTargetRadiusMeters;
export const WALL_FADED_OPACITY = 0.33;
export const WALL_OPACITY_ATTRIBUTE = "wallOpacity";

/**
 * Returns true when an ordinary wall is close enough to matter and lies
 * camera-side of the player. Camera ground-forward points toward screen top,
 * so a positive player offset puts the player in the projected top triangle.
 *
 * @param {number} playerX
 * @param {number} playerZ
 * @param {number} cellX
 * @param {number} cellZ
 * @param {number} cameraForwardX
 * @param {number} cameraForwardZ
 * @param {number} [radiusMeters]
 */
export function shouldFadeWall(
  playerX,
  playerZ,
  cellX,
  cellZ,
  cameraForwardX,
  cameraForwardZ,
  radiusMeters = WALL_FADE_RADIUS_METERS,
) {
  const nearestX = Math.max(cellX, Math.min(cellX + 1, playerX));
  const nearestZ = Math.max(cellZ, Math.min(cellZ + 1, playerZ));
  const dx = playerX - nearestX;
  const dz = playerZ - nearestZ;
  if (dx * dx + dz * dz > radiusMeters * radiusMeters) return false;

  const centerOffsetX = playerX - (cellX + 0.5);
  const centerOffsetZ = playerZ - (cellZ + 0.5);
  return centerOffsetX * cameraForwardX
    + centerOffsetZ * cameraForwardZ > 1e-9;
}
