import test from "node:test";
import assert from "node:assert/strict";

import * as THREE from "three/webgpu";

import { PresentationFlags } from "../src/presentation/options.js";
import {
  TRUE_SIGHT_TEXTURE_ALLOCATED_BYTES,
  TRUE_SIGHT_TEXTURE_CAPACITY,
  TrueSightTextureTransport,
} from "../src/presentation/true_sight_transport.js";
import {
  TrueSightFrame,
  TrueSightSystem,
} from "../src/visibility/true_sight.js";

function map(width, height, walls = []) {
  const cells = new Array(width * height).fill(0);
  for (const [cx, cz] of walls) cells[cz * width + cx] = 1;
  return { width, height, cells, playerSpawn: { x: 0.5, z: 0.5 } };
}

function snapshot(value, options = {}) {
  const x = options.x ?? Math.min(2.5, value.width - 0.5);
  const z = options.z ?? Math.min(2.5, value.height - 0.5);
  return {
    tick: options.tick ?? 1,
    seed: options.seed ?? 1,
    map: value,
    player: {
      x,
      z,
      previousX: options.previousX ?? x,
      previousZ: options.previousZ ?? z,
    },
  };
}

function syntheticFrame({
  maskWidth,
  maskHeight,
  mapWidth,
  mapHeight,
  values,
}) {
  const frame = new TrueSightFrame();
  frame.maskWidth = maskWidth;
  frame.maskHeight = maskHeight;
  frame.mapWidth = mapWidth;
  frame.mapHeight = mapHeight;
  frame.displayMask = Uint8Array.from(values);
  return frame;
}

function transportIdentities(transport) {
  return {
    texture: transport.texture,
    image: transport.texture.image,
    data: transport.data,
    imageData: transport.texture.image.data,
    mapSize: transport.mapSize,
    activeMaskSize: transport.activeMaskSize,
    maximumActiveTexelCenter: transport.maximumActiveTexelCenter,
    mapSizeNode: transport.mapSizeNode,
    activeMaskSizeNode: transport.activeMaskSizeNode,
    minimumActiveTexelCenterNode: transport.minimumActiveTexelCenterNode,
    maximumActiveTexelCenterNode: transport.maximumActiveTexelCenterNode,
    uvNode: transport.uvNode,
    opacityNode: transport.opacityNode,
    maskNode: transport.maskNode,
  };
}

test("fixed TrueSight transport retains texture, image, storage, uniforms, and nodes", () => {
  const flags = new PresentationFlags();
  const system = new TrueSightSystem({ flags });
  let tick = 1;
  let value = map(24, 24, [[6, 5]]);
  let frame = system.update(
    snapshot(value, { tick: tick++, x: 5, z: 5.5 }),
    0,
    { mode: "play", deltaMs: 0 },
  );
  const transport = new TrueSightTextureTransport(frame);
  const identities = transportIdentities(transport);
  const assertResident = () => {
    assert.deepEqual(transportIdentities(transport), identities);
    assert.equal(transport.texture.image.width, TRUE_SIGHT_TEXTURE_CAPACITY);
    assert.equal(transport.texture.image.height, TRUE_SIGHT_TEXTURE_CAPACITY);
    assert.equal(transport.texture.image.data.length, TRUE_SIGHT_TEXTURE_ALLOCATED_BYTES);
  };

  assertResident();
  assert.equal(transport.texture.format, THREE.RedFormat);
  assert.equal(transport.texture.type, THREE.UnsignedByteType);
  assert.equal(transport.texture.minFilter, THREE.LinearFilter);
  assert.equal(transport.texture.magFilter, THREE.LinearFilter);
  assert.equal(transport.texture.wrapS, THREE.ClampToEdgeWrapping);
  assert.equal(transport.texture.wrapT, THREE.ClampToEdgeWrapping);
  assert.equal(transport.texture.generateMipmaps, false);
  assert.deepEqual(transport.diagnostics(), {
    textureCapacity: { width: 256, height: 256 },
    activeMaskDimensions: { width: 192, height: 192 },
    allocatedBytes: 65_536,
    textureVersion: 1,
    uploadCount: 1,
  });

  const stage = (nextFrame) => {
    const previousVersion = transport.texture.version;
    const previousUploads = transport.uploadCount;
    transport.stage(nextFrame);
    assertResident();
    assert.equal(transport.texture.version, previousVersion + 1);
    assert.equal(transport.uploadCount, previousUploads + 1);
  };

  frame = system.update(
    snapshot(value, { tick: tick++, x: 5.05, z: 5.5, previousX: 5 }),
    0.5,
    { mode: "play", deltaMs: 16 },
  );
  stage(frame);
  flags.set("trueSight", false);
  frame = system.update(
    snapshot(value, { tick: tick++, x: 5.05, z: 5.5 }),
    0,
    { mode: "play", deltaMs: 50 },
  );
  stage(frame);
  flags.set("sightFade", false);
  frame = system.update(
    snapshot(value, { tick: tick++, x: 5.05, z: 5.5 }),
    0,
    { mode: "play", deltaMs: 1 },
  );
  stage(frame);
  frame = system.update(
    snapshot(value, { tick: tick++, x: 5.05, z: 5.5 }),
    0,
    { mode: "edit", deltaMs: 1 },
  );
  stage(frame);
  system.requestSnap("reset");
  frame = system.update(
    snapshot(value, { tick: 1, seed: 2, x: 5.05, z: 5.5 }),
    0,
    { mode: "play", deltaMs: 0 },
  );
  stage(frame);

  value = map(32, 16, [[10, 8]]);
  frame = system.update(
    snapshot(value, { tick: 2, seed: 2, x: 8.5, z: 8.5 }),
    0,
    { mode: "play", deltaMs: 0 },
  );
  stage(frame);
  assert.deepEqual(
    [transport.activeMaskWidth, transport.activeMaskHeight],
    [256, 128],
  );

  value = map(7, 5, [[4, 2]]);
  frame = system.update(
    snapshot(value, { tick: 3, seed: 2, x: 2.5, z: 2.5 }),
    0,
    { mode: "play", deltaMs: 0 },
  );
  stage(frame);
  assert.deepEqual(
    [transport.activeMaskWidth, transport.activeMaskHeight],
    [56, 40],
  );
});

test("rows pack into fixed stride and padding clears only on dimension changes", () => {
  const first = syntheticFrame({
    maskWidth: 3,
    maskHeight: 2,
    mapWidth: 6,
    mapHeight: 4,
    values: [1, 2, 3, 4, 5, 6],
  });
  const transport = new TrueSightTextureTransport(first);
  assert.deepEqual([...transport.data.subarray(0, 4)], [1, 2, 3, 0]);
  assert.deepEqual(
    [...transport.data.subarray(256, 260)],
    [4, 5, 6, 0],
  );
  assert.equal(transport.paddingClearCount, 1);

  transport.data[3] = 77;
  first.displayMask.set([6, 5, 4, 3, 2, 1]);
  transport.stage(first);
  assert.deepEqual([...transport.data.subarray(0, 4)], [6, 5, 4, 77]);
  assert.equal(transport.paddingClearCount, 1);

  const resized = syntheticFrame({
    maskWidth: 2,
    maskHeight: 2,
    mapWidth: 4,
    mapHeight: 4,
    values: [9, 8, 7, 6],
  });
  transport.stage(resized);
  assert.deepEqual([...transport.data.subarray(0, 4)], [9, 8, 0, 0]);
  assert.deepEqual([...transport.data.subarray(256, 260)], [7, 6, 0, 0]);
  assert.equal(transport.data[3], 0);
  assert.equal(transport.paddingClearCount, 2);
});

test("packed UVs clamp to active texel centers and sampling matches TrueSightFrame", () => {
  const frame = syntheticFrame({
    maskWidth: 3,
    maskHeight: 2,
    mapWidth: 6,
    mapHeight: 4,
    values: [0, 64, 255, 255, 128, 32],
  });
  const transport = new TrueSightTextureTransport(frame);
  const target = { x: 0, y: 0 };

  assert.equal(transport.textureUvAt(0, 0, target), target);
  assert.deepEqual(target, { x: 0.5 / 256, y: 0.5 / 256 });
  transport.textureUvAt(6, 4, target);
  assert.deepEqual(target, { x: 2.5 / 256, y: 1.5 / 256 });
  transport.textureUvAt(-100, 100, target);
  assert.deepEqual(target, { x: 0.5 / 256, y: 1.5 / 256 });

  const points = [
    [0, 0],
    [0.0001, 0.0001],
    [1, 1],
    [2, 1],
    [3, 1],
    [4, 1],
    [5.9999, 3.9999],
    [1, 3],
    [3.75, 2.5],
  ];
  for (const [x, z] of points) {
    assert.ok(
      Math.abs(
        transport.sampleVisibilityAt(x, z)
        - frame.displayVisibilityAt(x, z)
      ) < 1e-12,
      `sample mismatch at ${x},${z}`,
    );
  }
  for (const [x, z] of [[-1, 0], [0, -1], [6, 0], [0, 4]]) {
    assert.equal(transport.sampleVisibilityAt(x, z), 0);
    assert.equal(frame.displayVisibilityAt(x, z), 0);
  }
});

test("asymmetric capped masks preserve active rows and visibility at boundaries", () => {
  const system = new TrueSightSystem();
  const frame = system.update(
    snapshot(map(256, 128, [[2, 1], [128, 64]]), {
      x: 1.5,
      z: 1.5,
    }),
    0,
    { deltaMs: 0 },
  );
  const transport = new TrueSightTextureTransport(frame);
  assert.deepEqual([frame.maskWidth, frame.maskHeight], [256, 128]);
  assert.deepEqual(
    transport.diagnostics().activeMaskDimensions,
    { width: 256, height: 128 },
  );
  for (const [x, z] of [
    [0, 0],
    [0.5, 0.5],
    [1.5, 1.5],
    [2.5, 1.5],
    [127.5, 64.5],
    [255.999, 127.999],
  ]) {
    assert.ok(
      Math.abs(
        transport.sampleVisibilityAt(x, z)
        - frame.displayVisibilityAt(x, z)
      ) < 1e-12,
    );
  }
  assert.ok(
    transport.data
      .subarray(128 * TRUE_SIGHT_TEXTURE_CAPACITY)
      .every((value) => value === 0),
  );
});

test("transport rejects masks that exceed its immutable allocation", () => {
  const transport = new TrueSightTextureTransport();
  assert.throws(
    () => transport.stage(syntheticFrame({
      maskWidth: 257,
      maskHeight: 1,
      mapWidth: 257,
      mapHeight: 1,
      values: new Uint8Array(257),
    })),
    /exceeds the fixed 256x256 transport/,
  );
});
