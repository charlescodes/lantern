// @ts-check

import * as THREE from "three/webgpu";

import { MOVEMENT_SOUND } from "../config.js";

export const WALL_HEIGHT_METERS = 2.5;
export const WALL_CAP_RELIEF_RADIUS_METERS = MOVEMENT_SOUND.walkTargetRadiusMeters;

/**
 * Returns true when a wall cell's top should be omitted to keep the nearby
 * player readable. The distance is measured from the player center to the
 * nearest point on the cell's X/Z footprint.
 *
 * @param {number} playerX
 * @param {number} playerZ
 * @param {number} cellX
 * @param {number} cellZ
 * @param {number} [radiusMeters]
 */
export function shouldSuppressWallCap(
  playerX,
  playerZ,
  cellX,
  cellZ,
  radiusMeters = WALL_CAP_RELIEF_RADIUS_METERS,
) {
  const nearestX = Math.max(cellX, Math.min(cellX + 1, playerX));
  const nearestZ = Math.max(cellZ, Math.min(cellZ + 1, playerZ));
  const dx = playerX - nearestX;
  const dz = playerZ - nearestZ;
  return dx * dx + dz * dz <= radiusMeters * radiusMeters;
}

/**
 * Builds the ordinary one-meter wall shell without its two upward-facing
 * triangles. A separate resident cap mesh can then be culled per cell without
 * changing wall collision or rebuilding the wall sides.
 */
export function createOpenTopWallGeometry() {
  const indexed = new THREE.BoxGeometry(1, WALL_HEIGHT_METERS, 1);
  const source = indexed.toNonIndexed();
  indexed.dispose();
  const sourcePositions = source.getAttribute("position");
  const sourceNormals = source.getAttribute("normal");
  const sourceUvs = source.getAttribute("uv");
  const positions = [];
  const normals = [];
  const uvs = [];
  const topY = WALL_HEIGHT_METERS / 2;

  for (let vertex = 0; vertex < sourcePositions.count; vertex += 3) {
    const isTop = [0, 1, 2].every(
      (offset) => Math.abs(sourcePositions.getY(vertex + offset) - topY) < 1e-9,
    );
    if (isTop) continue;
    for (let offset = 0; offset < 3; offset += 1) {
      const index = vertex + offset;
      positions.push(
        sourcePositions.getX(index),
        sourcePositions.getY(index),
        sourcePositions.getZ(index),
      );
      normals.push(
        sourceNormals.getX(index),
        sourceNormals.getY(index),
        sourceNormals.getZ(index),
      );
      uvs.push(sourceUvs.getX(index), sourceUvs.getY(index));
    }
  }
  source.dispose();

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

export function createWallCapGeometry() {
  const geometry = new THREE.PlaneGeometry(1, 1);
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}
