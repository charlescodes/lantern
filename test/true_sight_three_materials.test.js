import test from "node:test";
import assert from "node:assert/strict";

import * as THREE from "three/webgpu";

import { Camera3D } from "../src/presentation/camera_3d.js";
import {
  parsePresentationOptions,
  PresentationFlags,
} from "../src/presentation/options.js";
import { ThreePresentation } from "../src/presentation/three_presentation.js";

function fakeCanvas() {
  return {
    width: 1,
    height: 1,
    style: {},
    getContext() {
      return null;
    },
    addEventListener() {},
    removeEventListener() {},
    setAttribute() {},
  };
}

test("Three world materials share one resident red-byte TrueSight node pipeline", () => {
  const options = parsePresentationOptions("?renderer=3d&aa=1");
  const flags = new PresentationFlags(options);
  const presentation = new ThreePresentation(
    fakeCanvas(),
    new Camera3D(),
    options,
    performance.now(),
    flags,
  );
  const materials = [
    presentation.floorMaterial,
    presentation.wallMaterial,
    presentation.rockMaterial,
    presentation.projectileMaterial,
    presentation.particleMaterial,
    presentation.player.material,
    presentation.spawnMarker.material,
    presentation.cursorMarker.material,
    presentation.hoverMarker.material,
    presentation.selectedMarker.material,
    presentation.editCellPreview.material,
    presentation.editRockPreview.material,
  ];

  assert.equal(presentation.flags, flags);
  assert.equal(presentation.sightTexture.format, THREE.RedFormat);
  assert.equal(presentation.sightTexture.type, THREE.UnsignedByteType);
  assert.equal(presentation.sightTexture.minFilter, THREE.LinearFilter);
  assert.equal(presentation.sightTexture.magFilter, THREE.LinearFilter);
  assert.equal(presentation.sightTexture.wrapS, THREE.ClampToEdgeWrapping);
  assert.equal(presentation.sightTexture.wrapT, THREE.ClampToEdgeWrapping);
  assert.equal(presentation.sightTexture.generateMipmaps, false);

  for (const material of materials) {
    assert.equal(material.isNodeMaterial, true);
    assert.equal(material.opacityNode, presentation.sightOpacityNode);
    assert.equal(material.maskNode, presentation.sightMaskNode);
    assert.equal(material.maskShadowNode, presentation.sightMaskNode);
    assert.equal(material.alphaHash, true);
    assert.equal(material.alphaToCoverage, true);
  }
  assert.equal(presentation.floorMaterial.isMeshStandardNodeMaterial, true);
  assert.equal(presentation.editCellPreview.material.isMeshBasicNodeMaterial, true);
  assert.equal(presentation.sightRayLines.material.isLineBasicNodeMaterial, true);
  assert.equal(presentation.sightHitMesh.count, 0);
});
