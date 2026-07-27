import test from "node:test";
import assert from "node:assert/strict";

import * as THREE from "three/webgpu";

import { DebugRenderer } from "../src/browser/renderer.js";
import { Camera2D } from "../src/browser/camera.js";
import {
  HEALTH_BAR,
  healthBarColor,
  healthBarRatio,
} from "../src/presentation/combat_visuals.js";
import { Camera3D } from "../src/presentation/camera_3d.js";
import {
  parsePresentationOptions,
  PresentationFlags,
} from "../src/presentation/options.js";
import { ThreePresentation } from "../src/presentation/three_presentation.js";
import { Simulation } from "../src/sim/simulation.js";
import { TrueSightSystem } from "../src/visibility/true_sight.js";

function fakeThreeCanvas() {
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

function fakeCanvas2d() {
  const fillRects = [];
  const context = {
    fillStyle: "#000000",
    strokeStyle: "#000000",
    lineWidth: 1,
    globalAlpha: 1,
    font: "",
    textBaseline: "top",
    lineCap: "round",
    lineJoin: "round",
    imageSmoothingEnabled: true,
    setTransform() {},
    beginPath() {},
    closePath() {},
    moveTo() {},
    lineTo() {},
    arc() {},
    fill() {},
    stroke() {},
    strokeRect() {},
    setLineDash() {},
    save() {},
    restore() {},
    translate() {},
    rotate() {},
    scale() {},
    fillText() {},
    drawImage() {},
    fillRect(x, y, width, height) {
      fillRects.push({ x, y, width, height, color: this.fillStyle });
    },
  };
  const canvas = {
    width: 1,
    height: 1,
    getContext(kind) {
      return kind === "2d" ? context : null;
    },
    getBoundingClientRect() {
      return { width: 960, height: 640 };
    },
  };
  return { canvas, context, fillRects };
}

function threePresentation(snapshot) {
  const options = parsePresentationOptions("?renderer=3d&aa=1&lights=8");
  const flags = new PresentationFlags(options);
  const sightFrame = new TrueSightSystem({ flags }).update(
    snapshot,
    0,
    { mode: "play", deltaMs: 0 },
  );
  const camera = new Camera3D();
  const presentation = new ThreePresentation(
    fakeThreeCanvas(),
    camera,
    options,
    performance.now(),
    flags,
    sightFrame,
  );
  presentation.resize = () => {};
  presentation.webRenderer.render = () => {};
  return { presentation, camera, sightFrame };
}

function view(snapshot, sightFrame) {
  return {
    mouseWorld: { x: snapshot.player.x, z: snapshot.player.z },
    mouseInside: false,
    hover: null,
    selected: null,
    mode: "play",
    editorTool: "wall",
    placementValid: true,
    sightFrame,
  };
}

test("shared health bands use exact 50 and 25 percent boundaries", () => {
  assert.equal(healthBarRatio(125, 100), 1);
  assert.equal(healthBarRatio(-5, 100), 0);
  assert.equal(healthBarColor(0.500_001), HEALTH_BAR.green);
  assert.equal(healthBarColor(0.5), HEALTH_BAR.amber);
  assert.equal(healthBarColor(0.250_001), HEALTH_BAR.amber);
  assert.equal(healthBarColor(0.25), HEALTH_BAR.red);
});

test("Canvas2D draws 0.10m by 0.90m tracks and bottom-up health fills", () => {
  const simulation = new Simulation({ particleBurstCount: 0 });
  simulation.tick(null);
  const snapshot = simulation.snapshot();
  snapshot.player.health = 50;
  snapshot.enemies[0].health = 25;
  snapshot.debugFlags.gridCoordinates = false;
  snapshot.debugFlags.velocityVectors = false;
  snapshot.debugFlags.contacts = false;
  snapshot.debugFlags.explosionForces = false;
  const { canvas, fillRects } = fakeCanvas2d();
  const camera = new Camera2D();
  camera.focus(snapshot.player.x, snapshot.player.z);
  const renderer = new DebugRenderer(canvas, camera, 1);
  const previousWindow = globalThis.window;
  globalThis.window = { devicePixelRatio: 1 };
  try {
    renderer.render(snapshot, 0, {
      mouseWorld: { x: 0, z: 0 },
      mouseInside: false,
      hover: null,
      selected: null,
      mode: "play",
      editorTool: "wall",
      placementValid: true,
    });
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }

  const tracks = fillRects.filter((call) => (
    Math.abs(call.width - HEALTH_BAR.widthMeters) < 1e-12
    && Math.abs(call.height - HEALTH_BAR.heightMeters) < 1e-12
  ));
  assert.equal(tracks.length, 2);
  const amberFill = fillRects.find((call) => (
    call.color === "#e0a442" && Math.abs(call.height - 0.45) < 1e-12
  ));
  const redFill = fillRects.find((call) => (
    call.color === "#e05555" && Math.abs(call.height - 0.225) < 1e-12
  ));
  assert.ok(amberFill);
  assert.ok(redFill);
  assert.ok(Math.abs(
    amberFill.x
      - (snapshot.player.x + snapshot.player.radius + HEALTH_BAR.actorGapMeters),
  ) < 1e-12);
  assert.ok(Math.abs(
    amberFill.y + amberFill.height
      - (snapshot.player.z + HEALTH_BAR.heightMeters / 2),
  ) < 1e-12);
});

test("Three preallocates four enemies and five resident health track/fill instances", () => {
  const simulation = new Simulation({ particleBurstCount: 0 });
  simulation.tick(null);
  const snapshot = simulation.snapshot();
  snapshot.player.health = 60;
  snapshot.enemies[0].health = 25;
  const { presentation, sightFrame } = threePresentation(snapshot);
  const identities = {
    enemies: presentation.enemyMesh,
    tracks: presentation.healthTrackMesh,
    fills: presentation.healthFillMesh,
    obelisk: presentation.obeliskGroup,
    lights: [...presentation.dynamicLights],
  };
  presentation.render(snapshot, 0, view(snapshot, sightFrame));

  assert.equal(presentation.enemyMesh.instanceMatrix.count, 4);
  assert.equal(presentation.healthTrackMesh.instanceMatrix.count, 5);
  assert.equal(presentation.healthFillMesh.instanceMatrix.count, 5);
  assert.equal(presentation.healthFillMesh.instanceColor.count, 5);
  assert.equal(presentation.enemyMesh.count, 1);
  assert.equal(presentation.healthTrackMesh.count, 2);
  assert.equal(presentation.healthFillMesh.count, 2);
  assert.equal(presentation.obeliskGroup.visible, true);
  assert.equal(presentation.healthTrackMaterial.transparent, true);
  assert.equal(presentation.healthFillMaterial.transparent, true);
  assert.equal(presentation.healthTrackMaterial.depthTest, false);
  assert.equal(presentation.healthFillMaterial.depthTest, false);
  assert.ok(presentation.healthTrackMesh.renderOrder < presentation.healthFillMesh.renderOrder);

  const trackMatrix = new THREE.Matrix4();
  const fillMatrix = new THREE.Matrix4();
  const trackPosition = new THREE.Vector3();
  const fillPosition = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const trackScale = new THREE.Vector3();
  const fillScale = new THREE.Vector3();
  presentation.healthTrackMesh.getMatrixAt(0, trackMatrix);
  presentation.healthFillMesh.getMatrixAt(0, fillMatrix);
  trackMatrix.decompose(trackPosition, quaternion, trackScale);
  fillMatrix.decompose(fillPosition, quaternion, fillScale);
  assert.ok(Math.abs(trackScale.x - 0.10) < 1e-6);
  assert.ok(Math.abs(trackScale.y - 0.90) < 1e-6);
  assert.ok(Math.abs(fillScale.y - 0.54) < 1e-6);
  const cameraUp = new THREE.Vector3(0, 1, 0)
    .applyQuaternion(presentation.threeCamera.quaternion)
    .normalize();
  assert.ok(Math.abs(
    fillPosition.clone().sub(trackPosition).dot(cameraUp) - (0.6 - 1) * 0.45,
  ) < 1e-6);

  const color = new THREE.Color();
  presentation.healthFillMesh.getColorAt(0, color);
  assert.equal(color.getHex(), HEALTH_BAR.green);
  presentation.healthFillMesh.getColorAt(1, color);
  assert.equal(color.getHex(), HEALTH_BAR.red);

  const solidCells = snapshot.map.cells.filter((cell) => cell === 1).length;
  assert.equal(presentation.wallMesh.count, solidCells - 1);
  assert.equal(presentation.enemyMesh, identities.enemies);
  assert.equal(presentation.healthTrackMesh, identities.tracks);
  assert.equal(presentation.healthFillMesh, identities.fills);
  assert.equal(presentation.obeliskGroup, identities.obelisk);
  assert.ok(presentation.dynamicLights.every((light, index) => light === identities.lights[index]));
});

test("enemy, obelisk, health, hostile effects, and emissive materials share TrueSight concealment", () => {
  const simulation = new Simulation({ particleBurstCount: 0 });
  simulation.tick(null);
  const snapshot = simulation.snapshot();
  const { presentation, sightFrame } = threePresentation(snapshot);
  presentation.render(snapshot, 0, view(snapshot, sightFrame));
  const maskedMaterials = [
    presentation.enemyMaterial,
    presentation.healthTrackMaterial,
    presentation.healthFillMaterial,
    presentation.obeliskMaterial,
    presentation.obeliskBaseMaterial,
    presentation.projectileMaterial,
    presentation.particleMaterial,
  ];
  for (const material of maskedMaterials) {
    assert.equal(material.opacityNode, presentation.sightOpacityNode);
    assert.equal(material.maskNode, presentation.sightMaskNode);
    assert.equal(material.maskShadowNode, presentation.sightMaskNode);
  }
  assert.equal(presentation.projectileMaterial.emissiveNode !== null, true);
  assert.equal(presentation.particleMaterial.emissiveNode !== null, true);
  assert.equal(presentation.dynamicLights.length, 8);
});
