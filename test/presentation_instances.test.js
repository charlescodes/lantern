import test from "node:test";
import assert from "node:assert/strict";

import * as THREE from "three/webgpu";

import {
  completeInstancedPoolSubmission,
  createDynamicInstancedPool,
  publishInstancedPool,
} from "../src/presentation/instanced_pool.js";

test("4,096-entry matrix and color attributes are preallocated and dynamic", () => {
  const mesh = createDynamicInstancedPool(
    new THREE.IcosahedronGeometry(1, 0),
    new THREE.MeshStandardMaterial({ vertexColors: true }),
    4_096,
    "test-particles",
    { instanceColors: true },
  );

  assert.equal(mesh.count, 0);
  assert.equal(mesh.instanceMatrix.count, 4_096);
  assert.equal(mesh.instanceMatrix.usage, THREE.DynamicDrawUsage);
  assert.ok(mesh.instanceColor);
  assert.equal(mesh.instanceColor.count, 4_096);
  assert.equal(mesh.instanceColor.usage, THREE.DynamicDrawUsage);

  const preallocatedColor = mesh.instanceColor;
  mesh.setColorAt(0, new THREE.Color(0xff8844));
  assert.equal(mesh.instanceColor, preallocatedColor);
});

test("instanced pools upload only active prefixes and preserve empty buffers", () => {
  const mesh = createDynamicInstancedPool(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ vertexColors: true }),
    4_096,
    "test-pool",
    { instanceColors: true },
  );
  const matrixArray = mesh.instanceMatrix.array;
  const colorArray = mesh.instanceColor.array;

  publishInstancedPool(mesh, 37, { instanceColors: true });
  assert.equal(mesh.count, 37);
  assert.deepEqual(mesh.instanceMatrix.updateRanges, [
    { start: 0, count: 37 * 16 },
  ]);
  assert.deepEqual(mesh.instanceColor.updateRanges, [
    { start: 0, count: 37 * 3 },
  ]);

  const matrixVersion = mesh.instanceMatrix.version;
  const colorVersion = mesh.instanceColor.version;
  const matrixRanges = [...mesh.instanceMatrix.updateRanges];
  const colorRanges = [...mesh.instanceColor.updateRanges];
  publishInstancedPool(mesh, 0, { instanceColors: true });

  assert.equal(mesh.count, 0);
  assert.equal(mesh.instanceMatrix.array, matrixArray);
  assert.equal(mesh.instanceColor.array, colorArray);
  assert.equal(mesh.instanceMatrix.version, matrixVersion);
  assert.equal(mesh.instanceColor.version, colorVersion);
  assert.deepEqual(mesh.instanceMatrix.updateRanges, matrixRanges);
  assert.deepEqual(mesh.instanceColor.updateRanges, colorRanges);
});

test("every particle count increase uploads before new slots become drawable", () => {
  const mesh = createDynamicInstancedPool(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ vertexColors: true }),
    4_096,
    "test-particles",
    { instanceColors: true },
  );
  const firstMatrix = new THREE.Matrix4().makeTranslation(3, 0, 4);
  const staleTailMatrix = new THREE.Matrix4().makeTranslation(9, 0, 9);
  const nextMatrix = new THREE.Matrix4().makeTranslation(-8, 0, -6);
  const nextTailMatrix = new THREE.Matrix4().makeTranslation(-5, 0, 7);
  const actualMatrix = new THREE.Matrix4();

  // Empty pools are hidden during gameplay; warmup temporarily reveals them.
  publishInstancedPool(mesh, 0, {
    deferCountGrowth: true,
    instanceColors: true,
  });
  assert.equal(mesh.visible, false);

  mesh.setMatrixAt(0, firstMatrix);
  mesh.setMatrixAt(1, staleTailMatrix);
  publishInstancedPool(mesh, 2, {
    deferCountGrowth: true,
    instanceColors: true,
  });
  assert.equal(mesh.count, 0);
  assert.equal(completeInstancedPoolSubmission(mesh), true);
  assert.equal(mesh.count, 2);

  const matrixArray = mesh.instanceMatrix.array;
  const colorArray = mesh.instanceColor.array;
  publishInstancedPool(mesh, 1, {
    deferCountGrowth: true,
    instanceColors: true,
  });
  assert.equal(mesh.count, 1);

  // A second impact arrives while the first shower is still active. Slots 1
  // and 2 contain fresh CPU data but must not be drawn until this submission.
  mesh.setMatrixAt(1, nextMatrix);
  mesh.setMatrixAt(2, nextTailMatrix);
  const matrixVersion = mesh.instanceMatrix.version;
  const colorVersion = mesh.instanceColor.version;
  publishInstancedPool(mesh, 3, {
    deferCountGrowth: true,
    instanceColors: true,
  });

  mesh.getMatrixAt(1, actualMatrix);
  assert.deepEqual(actualMatrix.elements, nextMatrix.elements);
  assert.equal(mesh.visible, true);
  assert.equal(mesh.count, 1);
  assert.equal(mesh.instanceMatrix.array, matrixArray);
  assert.equal(mesh.instanceColor.array, colorArray);
  assert.equal(mesh.instanceMatrix.version, matrixVersion + 1);
  assert.equal(mesh.instanceColor.version, colorVersion + 1);

  assert.equal(completeInstancedPoolSubmission(mesh), true);
  assert.equal(mesh.count, 3);
  assert.equal(completeInstancedPoolSubmission(mesh), false);

  // Reset/teardown preserves the backing allocation and uses the same guarded
  // growth path the next time particles appear.
  publishInstancedPool(mesh, 0, {
    deferCountGrowth: true,
    instanceColors: true,
  });
  assert.equal(mesh.visible, false);
  assert.equal(mesh.count, 0);
  assert.equal(mesh.instanceMatrix.array, matrixArray);
  assert.equal(mesh.instanceColor.array, colorArray);

  publishInstancedPool(mesh, 1, {
    deferCountGrowth: true,
    instanceColors: true,
  });
  assert.equal(mesh.visible, true);
  assert.equal(mesh.count, 0);
});
