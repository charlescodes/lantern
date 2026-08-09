import test from "node:test";
import assert from "node:assert/strict";

import * as THREE from "three/webgpu";

import { Camera2D } from "../src/browser/camera.js";
import { Camera3D } from "../src/presentation/camera_3d.js";
import { CanvasPresentation } from "../src/presentation/canvas_presentation.js";
import {
  SCORCH_CORE_TRIANGLE_COUNT,
  SCORCH_FLECK_TRIANGLE_COUNT,
  SCORCH_MARK_CAPACITY,
  SCORCH_STYLE,
} from "../src/presentation/scorch_marks.js";
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
  return { canvas, fillRects, filledPaths };
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

function openImpactPoint(snapshot) {
  const { map } = snapshot;
  const obelisks = new Set(
    (snapshot.obelisks ?? []).map((obelisk) => `${obelisk.cell.cx}:${obelisk.cell.cz}`),
  );
  for (let cz = 1; cz < map.height - 1; cz += 1) {
    for (let cx = 1; cx < map.width - 1; cx += 1) {
      let open = true;
      for (let dz = -1; dz <= 1; dz += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (
            map.cells[(cz + dz) * map.width + cx + dx] !== 0
            || obelisks.has(`${cx + dx}:${cz + dz}`)
          ) {
            open = false;
          }
        }
      }
      if (open) return { x: cx + 0.5, z: cz + 0.5 };
    }
  }
  throw new Error("Test map has no open scorch footprint");
}

function addImpact(snapshot, id = 1) {
  const point = openImpactPoint(snapshot);
  snapshot.tick += 1;
  snapshot.recentEvents = [{
    type: "explosion",
    id,
    tick: snapshot.tick,
    effectSeed: 0x1234_abcd,
    hit: { kind: "rock", id: 1 },
    originX: point.x,
    originZ: point.z,
    y: 0.9,
    nx: 1,
    nz: 0,
    radius: 2.5,
    pressureImpulse: 800,
    cell: null,
    responses: [],
  }];
  return snapshot;
}

test("Three keeps two resident unlit scorch batches and publishes new impacts in place", () => {
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
    coreMesh: presentation.scorchCoreMesh,
    fleckMesh: presentation.scorchFleckMesh,
    corePositions: presentation.scorchCorePositions,
    fleckPositions: presentation.scorchFleckPositions,
  };

  presentation.render(snapshot, 0, view(snapshot, sightFrame));
  assert.equal(presentation.floorMaterial.color.getHex(), 0x626d67);
  assert.equal(presentation.scorchCoreMaterial.isMeshBasicNodeMaterial, true);
  assert.equal(presentation.scorchFleckMaterial.isMeshBasicNodeMaterial, true);
  assert.equal(presentation.scorchCoreMaterial.opacity, SCORCH_STYLE.coreOpacity);
  assert.equal(presentation.scorchFleckMaterial.opacity, SCORCH_STYLE.fleckOpacity);
  assert.equal(presentation.scorchCoreMaterial.depthWrite, false);
  assert.equal(presentation.scorchFleckMaterial.depthWrite, false);
  assert.equal(
    presentation.scorchCorePositions.length,
    SCORCH_MARK_CAPACITY * SCORCH_CORE_TRIANGLE_COUNT * 9,
  );
  assert.equal(
    presentation.scorchFleckPositions.length,
    SCORCH_MARK_CAPACITY * SCORCH_FLECK_TRIANGLE_COUNT * 9,
  );
  assert.equal(presentation.scorchCoreMesh.visible, false);
  assert.equal(presentation.scorchFleckMesh.visible, false);

  const impacted = addImpact(snapshot);
  const before = JSON.stringify(impacted);
  presentation.render(impacted, 0, view(impacted, sightFrame));
  assert.equal(JSON.stringify(impacted), before);
  assert.equal(presentation.scorchMarks.length, 1);
  assert.equal(
    presentation.scorchCoreGeometry.drawRange.count,
    SCORCH_CORE_TRIANGLE_COUNT * 3,
  );
  assert.equal(
    presentation.scorchFleckGeometry.drawRange.count,
    SCORCH_FLECK_TRIANGLE_COUNT * 3,
  );
  assert.equal(presentation.scorchCoreMesh, identities.coreMesh);
  assert.equal(presentation.scorchFleckMesh, identities.fleckMesh);
  assert.equal(presentation.scorchCorePositions, identities.corePositions);
  assert.equal(presentation.scorchFleckPositions, identities.fleckPositions);
  assert.equal(presentation.scorchCoreMesh.visible, true);
  assert.equal(presentation.scorchFleckMesh.visible, true);
  for (let index = 1; index < presentation.scorchCoreGeometry.drawRange.count * 3; index += 3) {
    assert.ok(Math.abs(presentation.scorchCorePositions[index] - 0.012) < 1e-6);
  }
  assert.deepEqual(presentation.diagnostics().scorchMarks, {
    capacity: 200,
    active: 1,
    overwrites: 0,
    ingested: 1,
    missedEvents: 0,
    duplicateEvents: 0,
    skippedEvents: 0,
    resets: 0,
    coreTriangles: 8,
    fleckTriangles: 16,
  });
});

test("Canvas uses the lifted concrete palette and draws both scorch layers", () => {
  const snapshot = new Simulation({ particleBurstCount: 0 }).snapshot();
  const { canvas, fillRects, filledPaths } = fakeCanvas2d();
  const options = parsePresentationOptions("?renderer=2d");
  const presentation = new CanvasPresentation(
    canvas,
    new Camera2D(),
    snapshot,
    options,
    new PresentationFlags(options),
  );
  const previousWindow = globalThis.window;
  globalThis.window = { devicePixelRatio: 1 };
  try {
    addImpact(snapshot);
    presentation.render(snapshot, 0, view(snapshot));
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }

  assert.ok(fillRects.some((entry) => entry.color === "#586358"));
  assert.ok(fillRects.some((entry) => entry.color === "#5b665b"));
  const core = filledPaths.find((entry) => entry.color === SCORCH_STYLE.coreCss);
  const flecks = filledPaths.find((entry) => entry.color === SCORCH_STYLE.fleckCss);
  assert.ok(core);
  assert.ok(flecks);
  assert.equal(core.path.filter((entry) => entry.type === "close").length, 8);
  assert.equal(flecks.path.filter((entry) => entry.type === "close").length, 16);
  assert.equal(presentation.diagnostics().scorchMarks.active, 1);
});
