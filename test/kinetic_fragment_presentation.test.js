import test from "node:test";
import assert from "node:assert/strict";

import * as THREE from "three/webgpu";

import { Camera2D } from "../src/browser/camera.js";
import { Camera3D } from "../src/presentation/camera_3d.js";
import { CanvasPresentation } from "../src/presentation/canvas_presentation.js";
import {
  KINETIC_FRAGMENT_CAPACITY,
  KINETIC_FRAGMENT_STYLE,
  kineticFragmentPresentationSize,
  writeKineticFragmentTriangle,
} from "../src/presentation/kinetic_fragments.js";
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
  const filledPaths = [];
  let currentPath = [];
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
    beginPath() {
      currentPath = [];
    },
    closePath() {
      currentPath.push({ type: "close" });
    },
    moveTo(x, y) {
      currentPath.push({ type: "move", x, y });
    },
    lineTo(x, y) {
      currentPath.push({ type: "line", x, y });
    },
    arc() {},
    fill() {
      filledPaths.push({ color: this.fillStyle, path: [...currentPath] });
    },
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
    fillRect() {},
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
  return { canvas, filledPaths };
}

function view(snapshot, sightFrame = null) {
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

function addExplosion(snapshot, id = 1) {
  snapshot.tick += 1;
  snapshot.recentEvents = [{
    type: "explosion",
    id,
    tick: snapshot.tick,
    effectSeed: 0x1234_abcd,
    hit: { kind: "rock", id: 1 },
    originX: snapshot.player.x + 1,
    originZ: snapshot.player.z,
    y: 0.25,
    nx: 1,
    nz: 0,
    radius: 2.5,
    pressureImpulse: 800,
    responses: [],
  }];
  return snapshot;
}

test("Three uses one resident unlit instanced triangle pool without light allocation", () => {
  const snapshot = new Simulation({ particleBurstCount: 0 }).snapshot();
  const options = parsePresentationOptions("?renderer=3d&aa=1&lights=8");
  const flags = new PresentationFlags(options);
  const sightFrame = new TrueSightSystem({ flags }).update(
    snapshot,
    0,
    { mode: "play", deltaMs: 0 },
  );
  const presentation = new ThreePresentation(
    fakeThreeCanvas(),
    new Camera3D(),
    options,
    performance.now(),
    flags,
    sightFrame,
  );
  presentation.resize = () => {};
  presentation.webRenderer.render = () => {};
  const identities = {
    mesh: presentation.kineticFragmentMesh,
    geometry: presentation.kineticFragmentGeometry,
    material: presentation.kineticFragmentMaterial,
    instanceMatrix: presentation.kineticFragmentMesh.instanceMatrix,
    x: presentation.kineticFragments.x,
    rotationX: presentation.kineticFragments.rotationX,
    dynamicLights: [...presentation.dynamicLights],
  };

  presentation.render(snapshot, 0, view(snapshot, sightFrame));
  assert.equal(presentation.kineticFragmentMesh.count, 0);
  assert.equal(presentation.kineticFragmentMesh.userData.capacity, 512);
  assert.equal(
    presentation.kineticFragmentMesh.instanceMatrix.count,
    KINETIC_FRAGMENT_CAPACITY,
  );
  assert.equal(presentation.kineticFragmentGeometry.getAttribute("position").count, 3);
  assert.equal(presentation.kineticFragmentMaterial.isMeshBasicNodeMaterial, true);
  assert.equal(presentation.kineticFragmentMaterial.side, THREE.DoubleSide);
  assert.equal(presentation.kineticFragmentMaterial.color.getHex(), KINETIC_FRAGMENT_STYLE.color);
  assert.equal(presentation.kineticFragmentMesh.castShadow, false);
  assert.equal(presentation.kineticFragmentMesh.receiveShadow, false);

  const impacted = addExplosion(snapshot);
  const before = JSON.stringify(impacted);
  presentation.render(impacted, 0, view(impacted, sightFrame));
  assert.equal(JSON.stringify(impacted), before);
  assert.equal(presentation.kineticFragments.activeCount, 16);
  assert.equal(presentation.kineticFragmentMesh.count, 16);
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  presentation.kineticFragmentMesh.getMatrixAt(0, matrix);
  matrix.decompose(position, quaternion, scale);
  assert.ok(Math.abs(position.x - presentation.kineticFragments.x[0]) < 1e-5);
  assert.ok(Math.abs(position.y - presentation.kineticFragments.y[0]) < 1e-5);
  assert.ok(Math.abs(position.z - presentation.kineticFragments.z[0]) < 1e-5);
  const expectedPresentationSize = kineticFragmentPresentationSize(
    presentation.kineticFragments,
    0,
    0,
    presentation.camera.worldToViewportScale,
  );
  assert.ok(Math.abs(scale.x - expectedPresentationSize) < 1e-5);
  assert.ok(Math.abs(scale.x - scale.y) < 1e-6);
  assert.ok(Math.abs(scale.y - scale.z) < 1e-6);
  const sharedTriangle = new Float32Array(9);
  writeKineticFragmentTriangle(
    presentation.kineticFragments,
    0,
    0,
    sharedTriangle,
    presentation.camera.worldToViewportScale,
  );
  const positions = presentation.kineticFragmentGeometry.getAttribute("position");
  const transformed = new THREE.Vector3();
  for (let vertex = 0; vertex < 3; vertex += 1) {
    transformed.fromBufferAttribute(positions, vertex).applyMatrix4(matrix);
    assert.ok(Math.abs(transformed.x - sharedTriangle[vertex * 3]) < 1e-5);
    assert.ok(Math.abs(transformed.y - sharedTriangle[vertex * 3 + 1]) < 1e-5);
    assert.ok(Math.abs(transformed.z - sharedTriangle[vertex * 3 + 2]) < 1e-5);
  }

  impacted.tick += 1;
  presentation.render(impacted, 1, view(impacted, sightFrame));
  assert.equal(presentation.kineticFragmentMesh, identities.mesh);
  assert.equal(presentation.kineticFragmentGeometry, identities.geometry);
  assert.equal(presentation.kineticFragmentMaterial, identities.material);
  assert.equal(presentation.kineticFragmentMesh.instanceMatrix, identities.instanceMatrix);
  assert.equal(presentation.kineticFragments.x, identities.x);
  assert.equal(presentation.kineticFragments.rotationX, identities.rotationX);
  assert.deepEqual(presentation.dynamicLights, identities.dynamicLights);
  assert.deepEqual(
    {
      capacity: presentation.diagnostics().kineticFragments.capacity,
      active: presentation.diagnostics().kineticFragments.active,
      dropped: presentation.diagnostics().kineticFragments.dropped,
      ingestedExplosions:
        presentation.diagnostics().kineticFragments.ingestedExplosions,
      resets: presentation.diagnostics().kineticFragments.resets,
    },
    {
      capacity: 512,
      active: 16,
      dropped: 0,
      ingestedExplosions: 1,
      resets: 0,
    },
  );

  impacted.tick = 0;
  impacted.seed += 1;
  impacted.recentEvents = [];
  presentation.render(impacted, 0, view(impacted, sightFrame));
  assert.equal(presentation.kineticFragments.activeCount, 0);
  assert.equal(presentation.kineticFragmentMesh.count, 0);
  assert.equal(presentation.diagnostics().kineticFragments.resets, 1);
});

test("Canvas batches the same tumbling triangle state into one charcoal path", () => {
  const snapshot = new Simulation({ particleBurstCount: 0 }).snapshot();
  const { canvas, filledPaths } = fakeCanvas2d();
  const options = parsePresentationOptions("?renderer=2d");
  const presentation = new CanvasPresentation(
    canvas,
    new Camera2D(),
    snapshot,
    options,
    new PresentationFlags(options),
  );
  const x = presentation.kineticFragments.x;
  const rotationX = presentation.kineticFragments.rotationX;
  const previousWindow = globalThis.window;
  globalThis.window = { devicePixelRatio: 1 };
  try {
    const impacted = addExplosion(snapshot);
    presentation.render(impacted, 0.5, view(impacted));
    impacted.tick += 1;
    presentation.render(impacted, 0.5, view(impacted));
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }

  const fragmentPaths = filledPaths.filter(
    (entry) => entry.color === KINETIC_FRAGMENT_STYLE.css,
  );
  assert.equal(fragmentPaths.length, 2);
  assert.equal(
    fragmentPaths[0].path.filter((entry) => entry.type === "close").length,
    16,
  );
  const firstTriangle = fragmentPaths[1].path.slice(0, 4);
  assert.deepEqual(firstTriangle.map((entry) => entry.type), [
    "move",
    "line",
    "line",
    "close",
  ]);
  const areaTwice = Math.abs(
    (firstTriangle[1].x - firstTriangle[0].x)
      * (firstTriangle[2].y - firstTriangle[0].y)
      - (firstTriangle[1].y - firstTriangle[0].y)
        * (firstTriangle[2].x - firstTriangle[0].x),
  );
  const projectedAreaTwice = areaTwice
    * presentation.renderer.camera.worldToViewportScale ** 2;
  assert.ok(projectedAreaTwice > 0.5);
  assert.equal(presentation.kineticFragments.x, x);
  assert.equal(presentation.kineticFragments.rotationX, rotationX);
  assert.equal(presentation.diagnostics().kineticFragments.active, 16);
});
