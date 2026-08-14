import test from "node:test";
import assert from "node:assert/strict";

import * as THREE from "three/webgpu";

import { Camera3D } from "../src/presentation/camera_3d.js";
import {
  parsePresentationOptions,
  PresentationFlags,
} from "../src/presentation/options.js";
import { Simulation } from "../src/sim/simulation.js";
import { ThreePresentation } from "../src/presentation/three_presentation.js";
import { TrueSightSystem } from "../src/visibility/true_sight.js";

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
  const snapshot = new Simulation().snapshot();
  const sightFrame = new TrueSightSystem({ flags }).update(
    snapshot,
    0,
    { mode: "play", deltaMs: 0 },
  );
  const presentation = new ThreePresentation(
    fakeCanvas(),
    new Camera3D(),
    options,
    performance.now(),
    flags,
    sightFrame,
  );
  const materials = [
    presentation.floorMaterial,
    presentation.scorchCoreMaterial,
    presentation.scorchFleckMaterial,
    presentation.kineticFragmentMaterial,
    presentation.rockMaterial,
    presentation.torchPoleMaterial,
    presentation.torchLampMaterial,
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
  assert.equal(presentation.sightTexture.image.width, 256);
  assert.equal(presentation.sightTexture.image.height, 256);
  assert.equal(presentation.sightTexture.image.data.length, 65_536);
  assert.equal(presentation.sightTransport.currentFrame, sightFrame);
  assert.equal(presentation.sightTransport.uploadCount, 1);
  assert.equal(presentation.warmup.snapshot().state, "warming");

  for (const material of materials) {
    assert.equal(material.isNodeMaterial, true);
    assert.equal(material.opacityNode, presentation.sightOpacityNode);
    assert.equal(material.maskNode, presentation.sightMaskNode);
    assert.equal(material.maskShadowNode, presentation.sightMaskNode);
    assert.equal(material.alphaHash, true);
    assert.equal(material.alphaToCoverage, true);
  }
  assert.equal(presentation.floorMaterial.isMeshStandardNodeMaterial, true);
  assert.equal(
    presentation.wallMaterial.opacityNode,
    presentation.wallCompositeOpacityNode,
  );
  assert.equal(presentation.wallMaterial.maskNode, presentation.sightMaskNode);
  assert.equal(presentation.wallMaterial.maskShadowNode, presentation.sightMaskNode);
  assert.equal(presentation.wallMaterial.transparent, true);
  assert.equal(presentation.wallMaterial.depthWrite, true);
  assert.equal(presentation.wallMaterial.alphaHash, false);
  assert.equal(presentation.wallMaterial.alphaToCoverage, false);
  assert.equal(presentation.editCellPreview.material.isMeshBasicNodeMaterial, true);
  assert.equal(presentation.sightRayLines.material.isLineBasicNodeMaterial, true);
  assert.equal(presentation.sightHitMesh.count, 0);
});

test("warmup scene assets retain mask, shadow, bloom, and light topology coverage", () => {
  const options = parsePresentationOptions(
    "?renderer=3d&aa=1&lights=8&bloom=1&shadows=1",
  );
  const flags = new PresentationFlags(options);
  const snapshot = new Simulation().snapshot();
  const sightFrame = new TrueSightSystem({ flags }).update(
    snapshot,
    0,
    { mode: "play", deltaMs: 0 },
  );
  const presentation = new ThreePresentation(
    fakeCanvas(),
    new Camera3D(),
    options,
    performance.now(),
    flags,
    sightFrame,
  );
  const transportIdentities = {
    texture: presentation.sightTexture,
    image: presentation.sightTexture.image,
    data: presentation.sightTexture.image.data,
    opacityNode: presentation.sightOpacityNode,
    maskNode: presentation.sightMaskNode,
  };
  const lightIdentities = [...presentation.dynamicLights];
  const materialIdentities = {
    floor: presentation.floorMaterial,
    wall: presentation.wallMaterial,
    scorchCore: presentation.scorchCoreMaterial,
    scorchFleck: presentation.scorchFleckMaterial,
    kineticFragment: presentation.kineticFragmentMaterial,
    rock: presentation.rockMaterial,
    torchPole: presentation.torchPoleMaterial,
    torchLamp: presentation.torchLampMaterial,
    projectile: presentation.projectileMaterial,
    particle: presentation.particleMaterial,
    player: presentation.player.material,
    spawn: presentation.spawnMarker.material,
    cursor: presentation.cursorMarker.material,
    hover: presentation.hoverMarker.material,
    selected: presentation.selectedMarker.material,
    editCell: presentation.editCellPreview.material,
    editRock: presentation.editRockPreview.material,
  };

  presentation.resize = () => {};
  presentation.webRenderer.render = () => {};
  presentation.render(snapshot, 0, {
    mouseWorld: { x: snapshot.player.x, z: snapshot.player.z },
    mouseInside: true,
    hover: null,
    selected: null,
    mode: "play",
    editorTool: "wall",
    placementValid: true,
    sightFrame,
  });

  const coveredMaterials = [
    ...Object.values(materialIdentities),
    presentation.gridLines.material,
    presentation.scorchCoreMesh.material,
    presentation.scorchFleckMesh.material,
    presentation.kineticFragmentMesh.material,
    presentation.rockMesh.material,
    presentation.torchPoleMesh.material,
    presentation.torchLampMesh.material,
    presentation.projectileMesh.material,
    presentation.particleMesh.material,
  ];
  for (const material of coveredMaterials) {
    if (material === presentation.wallMaterial) continue;
    assert.equal(material.opacityNode, presentation.sightOpacityNode);
    assert.equal(material.maskNode, presentation.sightMaskNode);
    assert.equal(material.maskShadowNode, presentation.sightMaskNode);
  }
  assert.equal(presentation.wallMesh.material, presentation.wallMaterial);
  assert.equal(
    presentation.wallMesh.geometry.getAttribute("wallOpacity"),
    presentation.wallOpacityAttribute,
  );
  assert.equal(
    presentation.wallMaterial.opacityNode,
    presentation.wallCompositeOpacityNode,
  );
  assert.equal(presentation.wallMaterial.maskNode, presentation.sightMaskNode);
  assert.equal(presentation.wallMaterial.maskShadowNode, presentation.sightMaskNode);
  assert.equal(presentation.scorchCoreMesh.material, presentation.scorchCoreMaterial);
  assert.equal(presentation.scorchFleckMesh.material, presentation.scorchFleckMaterial);
  assert.equal(
    presentation.kineticFragmentMesh.material,
    presentation.kineticFragmentMaterial,
  );
  assert.equal(presentation.rockMesh.material, presentation.rockMaterial);
  assert.equal(presentation.torchPoleMesh.material, presentation.torchPoleMaterial);
  assert.equal(presentation.torchLampMesh.material, presentation.torchLampMaterial);
  assert.equal(presentation.projectileMesh.material, presentation.projectileMaterial);
  assert.equal(presentation.particleMesh.material, presentation.particleMaterial);
  assert.equal(presentation.projectileMaterial.emissive.getHex(), 0xff4d0d);
  assert.equal(presentation.particleMaterial.emissive.getHex(), 0xff3b08);
  assert.equal(presentation.sightRayLines.material.opacityNode, null);
  assert.equal(presentation.sightPolygonLine.material.opacityNode, null);
  assert.equal(presentation.sightHitMaterial.opacityNode, null);
  assert.deepEqual(
    {
      texture: presentation.sightTexture,
      image: presentation.sightTexture.image,
      data: presentation.sightTexture.image.data,
      opacityNode: presentation.sightOpacityNode,
      maskNode: presentation.sightMaskNode,
    },
    transportIdentities,
  );
  assert.deepEqual(
    {
      floor: presentation.floorMaterial,
      wall: presentation.wallMaterial,
      scorchCore: presentation.scorchCoreMaterial,
      scorchFleck: presentation.scorchFleckMaterial,
      kineticFragment: presentation.kineticFragmentMaterial,
      rock: presentation.rockMaterial,
      torchPole: presentation.torchPoleMaterial,
      torchLamp: presentation.torchLampMaterial,
      projectile: presentation.projectileMaterial,
      particle: presentation.particleMaterial,
      player: presentation.player.material,
      spawn: presentation.spawnMarker.material,
      cursor: presentation.cursorMarker.material,
      hover: presentation.hoverMarker.material,
      selected: presentation.selectedMarker.material,
      editCell: presentation.editCellPreview.material,
      editRock: presentation.editRockPreview.material,
    },
    materialIdentities,
  );
  assert.ok(
    presentation.dynamicLights.every(
      (light, index) => light === lightIdentities[index] && light.visible,
    ),
  );
  assert.equal(presentation.residentLightCount, 8);
  assert.equal(presentation.sightTransport.uploadCount, 2);
});

test("Three renders the movable table from its fixed-orientation runtime transform", () => {
  const options = parsePresentationOptions("?renderer=3d&aa=1");
  const flags = new PresentationFlags(options);
  const simulation = new Simulation({ particleBurstCount: 0 });
  simulation.tick({
    type: "placeInstance",
    definitionId: "object.table",
    x: 12.5,
    z: 12.5,
    rotation: 1,
  });
  assert.equal(simulation.lastError, null);
  const snapshot = simulation.snapshot();
  const table = snapshot.authoring.instances.find(
    (instance) => instance.definitionId === "object.table",
  );
  const runtimeTable = snapshot.rocks.find((rock) => rock.kind === "table");
  assert.ok(runtimeTable);
  const sightFrame = new TrueSightSystem({ flags }).update(
    snapshot,
    0,
    { mode: "edit", deltaMs: 0 },
  );
  const presentation = new ThreePresentation(
    fakeCanvas(),
    new Camera3D(),
    options,
    performance.now(),
    flags,
    sightFrame,
  );
  presentation.resize = () => {};
  presentation.webRenderer.render = () => {};
  presentation.render(snapshot, 0, {
    mouseWorld: { x: table.x, z: table.z },
    mouseInside: true,
    hover: null,
    selected: null,
    mode: "edit",
    editorTool: "object.table",
    placementValid: true,
    authoringEditor: {
      hoveredTarget: null,
      selectedTarget: {
        kind: "instance",
        layerId: snapshot.authoring.activeLayer.id,
        instanceId: table.id,
      },
      placementPreview: null,
      showAuthoringExtents: true,
    },
    sightFrame,
  });

  assert.equal(presentation.tableMesh.count, 1);
  assert.equal(presentation.authoringOverlayMesh.count >= 2, true);
  assert.equal(presentation.authoringOverlayMesh.visible, true);
  assert.equal(presentation.tableMaterial.opacityNode, presentation.sightOpacityNode);
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  presentation.tableMesh.getMatrixAt(0, matrix);
  position.setFromMatrixPosition(matrix);
  assert.equal(position.x, 12.5);
  assert.equal(position.z, 13);

  simulation.rocks.x[runtimeTable.index] = 14;
  simulation.rocks.previousX[runtimeTable.index] = 14;
  presentation.render(simulation.snapshot(), 1, {
    mouseWorld: { x: table.x, z: table.z },
    mouseInside: false,
    hover: null,
    selected: null,
    mode: "play",
    editorTool: "select",
    placementValid: false,
    sightFrame,
  });
  presentation.tableMesh.getMatrixAt(0, matrix);
  position.setFromMatrixPosition(matrix);
  assert.equal(position.x, 14);
  assert.equal(position.z, 13);
  assert.equal(runtimeTable.rotation, 1);
});

test("Three renders a movable torch as a two-meter pole and glowing lamp without shadow maps", () => {
  const options = parsePresentationOptions("?renderer=3d&aa=1&lights=16");
  const flags = new PresentationFlags(options);
  const simulation = new Simulation({ particleBurstCount: 0 });
  simulation.tick({
    type: "placeInstance",
    definitionId: "object.torch",
    x: 12.5,
    z: 12.5,
    rotation: 0,
  });
  assert.equal(simulation.lastError, null);
  const snapshot = simulation.snapshot();
  const sightFrame = new TrueSightSystem({ flags }).update(
    snapshot,
    0,
    { mode: "edit", deltaMs: 0 },
  );
  const presentation = new ThreePresentation(
    fakeCanvas(),
    new Camera3D(),
    options,
    performance.now(),
    flags,
    sightFrame,
  );
  presentation.resize = () => {};
  presentation.webRenderer.render = () => {};
  presentation.render(snapshot, 0, {
    mouseWorld: { x: 12.5, z: 12.5 },
    mouseInside: false,
    hover: null,
    selected: null,
    mode: "edit",
    editorTool: "object.torch",
    placementValid: true,
    sightFrame,
  });

  assert.equal(presentation.torchPoleMesh.count, 1);
  assert.equal(presentation.torchLampMesh.count, 1);
  assert.equal(presentation.torchPoleGeometry.parameters.height, 1.72);
  assert.equal(presentation.torchPoleGeometry.parameters.radiusBottom, 0.1);
  assert.equal(presentation.torchLampGeometry.parameters.radius, 0.17);
  assert.equal(presentation.torchPoleMesh.castShadow, false);
  assert.equal(presentation.torchLampMesh.castShadow, false);
  assert.equal(presentation.torchPoleMaterial.opacityNode, presentation.sightOpacityNode);
  assert.equal(presentation.torchLampMaterial.emissiveIntensity, 2.4);
  const torchLight = presentation.dynamicLights.find(
    (light) => String(light.userData.assignment).startsWith("prop:"),
  );
  assert.ok(torchLight);
  assert.equal(torchLight.position.x, 12.5);
  assert.equal(torchLight.position.y, 1.82);
  assert.equal(torchLight.castShadow, false);
});
