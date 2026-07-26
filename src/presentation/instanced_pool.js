// @ts-check

import * as THREE from "three/webgpu";

/**
 * @param {THREE.BufferGeometry} geometry
 * @param {THREE.Material} material
 * @param {number} capacity
 * @param {string} name
 * @param {{instanceColors?:boolean,instanceEmissive?:boolean}} [options]
 */
export function createDynamicInstancedPool(
  geometry,
  material,
  capacity,
  name,
  options = {},
) {
  const count = Math.max(1, Math.trunc(capacity));
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.name = name;
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  if (options.instanceColors) {
    mesh.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(count * 3).fill(1),
      3,
    );
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  }
  mesh.userData.capacity = capacity;
  if (options.instanceEmissive) {
    const emissive = new THREE.InstancedBufferAttribute(
      new Float32Array(count * 3),
      3,
    );
    emissive.setUsage(THREE.DynamicDrawUsage);
    mesh.userData.instanceEmissive = emissive;
  }
  return mesh;
}

/** @param {THREE.BufferAttribute} attribute @param {number} scalarCount */
function markActiveRange(attribute, scalarCount) {
  attribute.clearUpdateRanges();
  attribute.addUpdateRange(0, scalarCount);
  attribute.needsUpdate = true;
}

/**
 * Publishes only the active prefix. An empty pool changes draw count without
 * touching either backing buffer or its pending upload ranges.
 *
 * @param {THREE.InstancedMesh} mesh
 * @param {number} activeCount
 * @param {{instanceColors?:boolean,instanceEmissive?:boolean,deferCountGrowth?:boolean}} [options]
 */
export function publishInstancedPool(mesh, activeCount, options = {}) {
  const capacity = Math.max(0, Math.trunc(Number(mesh.userData.capacity)));
  const count = Math.max(0, Math.min(capacity, Math.trunc(activeCount)));
  const deferCountGrowth = options.deferCountGrowth === true;
  const state = deferCountGrowth
    ? (mesh.userData.instancePoolState ??= {
      pendingDrawCount: 0,
    })
    : null;

  if (count === 0) {
    mesh.count = 0;
    mesh.visible = false;
    if (state) state.pendingDrawCount = 0;
    return;
  }

  markActiveRange(mesh.instanceMatrix, count * mesh.instanceMatrix.itemSize);
  if (options.instanceColors && mesh.instanceColor) {
    markActiveRange(mesh.instanceColor, count * mesh.instanceColor.itemSize);
  }
  if (options.instanceEmissive && mesh.userData.instanceEmissive) {
    markActiveRange(
      mesh.userData.instanceEmissive,
      count * mesh.userData.instanceEmissive.itemSize,
    );
  }
  mesh.visible = true;

  if (state) {
    const safeDrawCount = Math.max(0, Math.min(capacity, mesh.count));
    if (count > safeDrawCount) {
      // Three keeps an internal instance buffer. Keep drawing only the prefix
      // submitted by an earlier frame while this frame uploads newly active
      // slots. This covers overlapping bursts as well as empty reactivation.
      state.pendingDrawCount = count;
      mesh.count = safeDrawCount;
      return;
    }

    state.pendingDrawCount = 0;
  }

  mesh.count = count;
}

/**
 * Writes one preallocated emissive RGB value without replacing its backing
 * attribute or changing renderer topology.
 *
 * @param {THREE.InstancedMesh} mesh
 * @param {number} index
 * @param {{r:number,g:number,b:number}} color
 * @param {number} strength
 */
export function setInstancedEmissiveAt(mesh, index, color, strength) {
  const attribute = mesh.userData.instanceEmissive;
  if (!attribute || index < 0 || index >= attribute.count) return false;
  attribute.setXYZ(
    index,
    Number(color.r) * strength,
    Number(color.g) * strength,
    Number(color.b) * strength,
  );
  return true;
}

/**
 * Reveals deferred count growth only after its upload submission.
 *
 * @param {THREE.InstancedMesh|null} mesh
 * @returns {boolean}
 */
export function completeInstancedPoolSubmission(mesh) {
  const state = mesh?.userData.instancePoolState;
  if (!state || state.pendingDrawCount <= 0) return false;
  mesh.count = state.pendingDrawCount;
  state.pendingDrawCount = 0;
  return true;
}
