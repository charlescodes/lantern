import test from "node:test";
import assert from "node:assert/strict";

import * as THREE from "three/webgpu";

import { DEAD_BODY } from "../src/config.js";
import { DebugRenderer } from "../src/browser/renderer.js";
import { Camera2D } from "../src/browser/camera.js";
import {
  HEALTH_BAR,
  healthBarColor,
  healthBarRatio,
} from "../src/presentation/combat_visuals.js";
import { Camera3D } from "../src/presentation/camera_3d.js";
import { enemyFacingTriangle } from "../src/presentation/enemy_facing.js";
import {
  ENEMY_BODY_HEIGHT_METERS,
  enemyDeadBodyPose,
} from "../src/presentation/dead_body_pose.js";
import {
  parsePresentationOptions,
  PresentationFlags,
} from "../src/presentation/options.js";
import { ThreePresentation } from "../src/presentation/three_presentation.js";
import {
  shouldFadeWall,
  WALL_FADED_OPACITY,
  WALL_FADE_RADIUS_METERS,
  WALL_HEIGHT_METERS,
  WALL_OPACITY_ATTRIBUTE,
} from "../src/presentation/wall_occlusion.js";
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
    arc(x, y, radius, start, end, counterclockwise = false) {
      currentPath.push({
        type: "arc",
        x,
        y,
        radius,
        start,
        end,
        counterclockwise,
      });
    },
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
  return { canvas, context, fillRects, filledPaths };
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

test("Canvas2D draws a fallen enemy body as the shared oriented capsule", () => {
  const simulation = new Simulation({ particleBurstCount: 0 });
  simulation.dynamicDeadBodies.spawn({
    id: 99,
    spawnSequence: 4,
    deathTick: simulation.tickCount,
    x: 8,
    z: 9,
    vx: 0,
    vz: 0,
    facingX: 1,
    facingZ: 0,
    radius: 0.3,
    massKg: 75,
  });
  const snapshot = simulation.snapshot();
  snapshot.deadBodies.dynamic[0].ageTicks = DEAD_BODY.fallTicks;
  snapshot.debugFlags.gridCoordinates = false;
  snapshot.debugFlags.velocityVectors = false;
  snapshot.debugFlags.contacts = false;
  snapshot.debugFlags.explosionForces = false;
  const { canvas, filledPaths } = fakeCanvas2d();
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

  const bodyFill = filledPaths.find((entry) => entry.color === "#583237");
  assert.ok(bodyFill);
  const arcs = bodyFill.path.filter((entry) => entry.type === "arc");
  assert.equal(arcs.length, 2);
  assert.ok(Math.abs(Math.abs(arcs[0].x - arcs[1].x) - 1) < 1e-6);
  assert.ok(arcs.every((arc) => Math.abs(arc.radius - 0.3) < 1e-6));
});

test("Three preallocates bounded combat pools without recreating resident instances", () => {
  const simulation = new Simulation({ particleBurstCount: 0 });
  simulation.tick(null);
  const snapshot = simulation.snapshot();
  snapshot.player.health = 60;
  snapshot.enemies[0].health = 25;
  const { presentation, camera, sightFrame } = threePresentation(snapshot);
  const identities = {
    enemies: presentation.enemyMesh,
    facing: presentation.enemyFacingMesh,
    tracks: presentation.healthTrackMesh,
    fills: presentation.healthFillMesh,
    obelisk: presentation.obeliskGroup,
    lights: [...presentation.dynamicLights],
  };
  presentation.render(snapshot, 0, view(snapshot, sightFrame));

  assert.equal(presentation.enemyMesh.instanceMatrix.count, 64);
  assert.equal(presentation.enemyFacingMesh.instanceMatrix.count, 64);
  assert.equal(presentation.healthTrackMesh.instanceMatrix.count, 65);
  assert.equal(presentation.healthFillMesh.instanceMatrix.count, 65);
  assert.equal(presentation.healthFillMesh.instanceColor.count, 65);
  assert.equal(presentation.deadBodyMesh.instanceMatrix.count, 116);
  assert.equal(presentation.enemyMesh.count, 1);
  assert.equal(presentation.enemyFacingMesh.count, 1);
  assert.equal(presentation.healthTrackMesh.count, 2);
  assert.equal(presentation.healthFillMesh.count, 2);
  assert.equal(presentation.deadBodyMesh.count, 0);
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
  const wallMesh = presentation.wallMesh;
  const wallOpacityAttribute = presentation.wallOpacityAttribute;
  const wallOpacityArray = wallOpacityAttribute.array;
  const wallCells = [];
  const obeliskCells = new Set(
    snapshot.obelisks.map(({ cell }) => `${cell.cx}:${cell.cz}`),
  );
  for (let cz = 0; cz < snapshot.map.height; cz += 1) {
    for (let cx = 0; cx < snapshot.map.width; cx += 1) {
      if (snapshot.map.cells[cz * snapshot.map.width + cx] !== 1) continue;
      if (obeliskCells.has(`${cx}:${cz}`)) continue;
      wallCells.push({ cx, cz });
    }
  }
  const forward = camera.groundForward;
  const expectedInitialFadedCount = wallCells.filter(({ cx, cz }) => (
    shouldFadeWall(
      snapshot.player.x,
      snapshot.player.z,
      cx,
      cz,
      forward.x,
      forward.z,
    )
  )).length;
  assert.equal(presentation.fadedWallCount, expectedInitialFadedCount);
  assert.equal(
    presentation.wallOpacityAttribute.count,
    snapshot.map.width * snapshot.map.height,
  );
  assert.equal(presentation.wallOpacityAttribute.usage, THREE.DynamicDrawUsage);
  assert.equal(
    presentation.wallGeometry.getAttribute(WALL_OPACITY_ATTRIBUTE),
    presentation.wallOpacityAttribute,
  );
  const wallMatrix = new THREE.Matrix4();
  const wallPosition = new THREE.Vector3();
  presentation.wallMesh.getMatrixAt(0, wallMatrix);
  wallMatrix.decompose(wallPosition, quaternion, new THREE.Vector3());
  assert.ok(Math.abs(wallPosition.y - WALL_HEIGHT_METERS / 2) < 1e-9);

  const wallPositions = presentation.wallGeometry.getAttribute("position");
  const wallIndex = presentation.wallGeometry.index;
  let topTriangleCount = 0;
  for (let offset = 0; offset < wallIndex.count; offset += 3) {
    const onTop = [0, 1, 2].every((triangleOffset) => (
      Math.abs(
        wallPositions.getY(wallIndex.getX(offset + triangleOffset))
          - WALL_HEIGHT_METERS / 2,
      ) < 1e-9
    ));
    if (onTop) topTriangleCount += 1;
  }
  assert.equal(topTriangleCount, 2);

  snapshot.player.x = 1.3;
  snapshot.player.previousX = 1.3;
  snapshot.player.z = 10.5;
  snapshot.player.previousZ = 10.5;
  presentation.render(snapshot, 0, view(snapshot, sightFrame));
  const expectedNearbyFadedCount = wallCells.filter(({ cx, cz }) => (
    shouldFadeWall(
      snapshot.player.x,
      snapshot.player.z,
      cx,
      cz,
      forward.x,
      forward.z,
    )
  )).length;
  assert.equal(presentation.wallMesh, wallMesh);
  assert.equal(presentation.wallOpacityAttribute, wallOpacityAttribute);
  assert.equal(presentation.wallOpacityAttribute.array, wallOpacityArray);
  assert.equal(presentation.wallMesh.count, wallCells.length);
  assert.equal(presentation.fadedWallCount, expectedNearbyFadedCount);
  assert.ok(expectedNearbyFadedCount > 0);
  let measuredFadedCount = 0;
  for (let index = 0; index < wallCells.length; index += 1) {
    const opacity = presentation.wallOpacityAttribute.getX(index);
    if (Math.abs(opacity - WALL_FADED_OPACITY) < 1e-6) {
      measuredFadedCount += 1;
    } else {
      assert.equal(opacity, 1);
    }
  }
  assert.equal(measuredFadedCount, expectedNearbyFadedCount);
  assert.deepEqual(presentation.diagnostics().wallOcclusion, {
    total: wallCells.length,
    opaque: wallCells.length - expectedNearbyFadedCount,
    faded: expectedNearbyFadedCount,
    fadedOpacity: WALL_FADED_OPACITY,
    proximityRadiusMeters: WALL_FADE_RADIUS_METERS,
  });

  const unchangedVersion = presentation.wallOpacityAttribute.version;
  presentation.render(snapshot, 0, view(snapshot, sightFrame));
  assert.equal(presentation.wallOpacityAttribute.version, unchangedVersion);
  camera.yawDegrees = 225;
  presentation.render(snapshot, 0, view(snapshot, sightFrame));
  assert.equal(presentation.wallOpacityAttribute.version, unchangedVersion + 1);
  const rotatedForward = camera.groundForward;
  let expectedRotatedFadedCount = 0;
  for (let index = 0; index < wallCells.length; index += 1) {
    const cell = wallCells[index];
    const faded = shouldFadeWall(
      snapshot.player.x,
      snapshot.player.z,
      cell.cx,
      cell.cz,
      rotatedForward.x,
      rotatedForward.z,
    );
    if (faded) expectedRotatedFadedCount += 1;
    assert.ok(Math.abs(
      presentation.wallOpacityAttribute.getX(index)
        - (faded ? WALL_FADED_OPACITY : 1),
    ) < 1e-6);
  }
  assert.equal(presentation.fadedWallCount, expectedRotatedFadedCount);
  assert.equal(presentation.enemyMesh, identities.enemies);
  assert.equal(presentation.enemyFacingMesh, identities.facing);
  assert.equal(presentation.healthTrackMesh, identities.tracks);
  assert.equal(presentation.healthFillMesh, identities.fills);
  assert.equal(presentation.obeliskGroup, identities.obelisk);
  assert.ok(presentation.dynamicLights.every((light, index) => light === identities.lights[index]));
});

test("shared dead-body pose and Three instances fall toward facing around a fixed XZ center", () => {
  const standing = enemyDeadBodyPose({
    ageTicks: 0,
    x: 5,
    z: 7,
    previousX: 4,
    previousZ: 6,
    facing: { x: 3, z: 4 },
    radius: 0.3,
  }, 0);
  assert.deepEqual(standing.facing, { x: 0.6, z: 0.8 });
  assert.equal(standing.angleRadians, 0);
  assert.equal(standing.centerY, ENEMY_BODY_HEIGHT_METERS / 2);
  assert.equal(standing.footprintWidth, 0.6);
  const reusablePose = { facing: { x: 0, z: 0 } };
  assert.equal(enemyDeadBodyPose({
    ageTicks: 0,
    x: 5,
    z: 7,
    facing: { x: 3, z: 4 },
    radius: 0.3,
  }, 0, reusablePose), reusablePose);

  const fallen = enemyDeadBodyPose({
    ageTicks: DEAD_BODY.fallTicks,
    x: 5,
    z: 7,
    previousX: 5,
    previousZ: 7,
    facing: { x: 1, z: 0 },
    radius: 0.3,
  }, 0);
  assert.ok(Math.abs(fallen.angleRadians - Math.PI / 2) < 1e-12);
  assert.ok(Math.abs(fallen.centerY - 0.3) < 1e-12);
  assert.ok(Math.abs(fallen.footprintLength - ENEMY_BODY_HEIGHT_METERS) < 1e-12);

  const simulation = new Simulation({ particleBurstCount: 0 });
  simulation.tick(null);
  simulation.dynamicDeadBodies.spawn({
    id: 99,
    spawnSequence: 4,
    deathTick: simulation.tickCount,
    x: 8,
    z: 9,
    vx: 0,
    vz: 0,
    facingX: 1,
    facingZ: 0,
    radius: 0.3,
    massKg: 75,
  });
  const snapshot = simulation.snapshot();
  const { presentation, sightFrame } = threePresentation(snapshot);
  presentation.render(snapshot, 0, view(snapshot, sightFrame));
  const identity = presentation.deadBodyMesh;
  assert.equal(identity.geometry, presentation.actorGeometry);
  assert.equal(identity.count, 1);

  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const axis = new THREE.Vector3();
  identity.getMatrixAt(0, matrix);
  matrix.decompose(position, quaternion, scale);
  axis.set(0, 1, 0).applyQuaternion(quaternion).normalize();
  assert.ok(Math.abs(axis.y - 1) < 1e-6);
  assert.ok(Math.abs(position.x - 8) < 1e-6);
  assert.ok(Math.abs(position.z - 9) < 1e-6);

  snapshot.deadBodies.dynamic[0].ageTicks = DEAD_BODY.fallTicks;
  presentation.render(snapshot, 0, view(snapshot, sightFrame));
  assert.equal(presentation.deadBodyMesh, identity);
  identity.getMatrixAt(0, matrix);
  matrix.decompose(position, quaternion, scale);
  axis.set(0, 1, 0).applyQuaternion(quaternion).normalize();
  assert.ok(Math.abs(axis.x - 1) < 1e-6);
  assert.ok(Math.abs(axis.y) < 1e-6);
  assert.ok(Math.abs(position.y - 0.3) < 1e-6);
  assert.ok(Math.abs(position.x - 8) < 1e-6);
  assert.ok(Math.abs(position.z - 9) < 1e-6);
  assert.deepEqual(presentation.diagnostics().combatInstances.deadBodies, {
    active: 1,
    capacity: 116,
  });
});

test("Three actor cylinders match circular collision bounds and expose the facing marker", () => {
  const simulation = new Simulation({ particleBurstCount: 0 });
  simulation.tick(null);
  const snapshot = simulation.snapshot();
  snapshot.enemies[0].facing = { x: 1, z: 0 };
  const enemy = snapshot.enemies[0];
  const { presentation, sightFrame } = threePresentation(snapshot);
  presentation.render(snapshot, 1, view(snapshot, sightFrame));

  const actorParameters = presentation.actorGeometry.parameters;
  assert.equal(presentation.player.geometry, presentation.actorGeometry);
  assert.equal(presentation.enemyMesh.geometry, presentation.actorGeometry);
  assert.equal(presentation.actorGeometry.type, "CylinderGeometry");
  assert.equal(actorParameters.radiusTop, 0.5);
  assert.equal(actorParameters.radiusBottom, 0.5);
  assert.equal(actorParameters.height, 1);
  assert.equal(actorParameters.radialSegments, 16);
  assert.ok(Math.abs(
    presentation.player.scale.x * actorParameters.radiusTop
      - snapshot.player.radius,
  ) < 1e-9);

  const enemyMatrix = new THREE.Matrix4();
  const enemyPosition = new THREE.Vector3();
  const enemyQuaternion = new THREE.Quaternion();
  const enemyScale = new THREE.Vector3();
  presentation.enemyMesh.getMatrixAt(0, enemyMatrix);
  enemyMatrix.decompose(enemyPosition, enemyQuaternion, enemyScale);
  assert.ok(Math.abs(enemyScale.x * actorParameters.radiusTop - enemy.radius) < 1e-6);
  assert.ok(Math.abs(enemyScale.z * actorParameters.radiusBottom - enemy.radius) < 1e-6);

  const markerMatrix = new THREE.Matrix4();
  const markerPosition = new THREE.Vector3();
  const markerQuaternion = new THREE.Quaternion();
  const markerScale = new THREE.Vector3();
  presentation.enemyFacingMesh.getMatrixAt(0, markerMatrix);
  markerMatrix.decompose(markerPosition, markerQuaternion, markerScale);
  const markerCenterDistance = markerPosition.x - enemy.x;
  const markerHalfLength = (
    presentation.enemyFacingGeometry.parameters.height * markerScale.y / 2
  );
  const markerBaseDistance = markerCenterDistance - markerHalfLength;
  const markerTipDistance = markerCenterDistance + markerHalfLength;
  assert.ok(markerBaseDistance >= enemy.radius - 0.021);
  assert.ok(markerBaseDistance < enemy.radius);
  assert.ok(markerTipDistance > enemy.radius + 0.25);
});

test("enemy, obelisk, health, hostile effects, and emissive materials share TrueSight concealment", () => {
  const simulation = new Simulation({ particleBurstCount: 0 });
  simulation.tick(null);
  const snapshot = simulation.snapshot();
  const { presentation, sightFrame } = threePresentation(snapshot);
  presentation.render(snapshot, 0, view(snapshot, sightFrame));
  const maskedMaterials = [
    presentation.enemyMaterial,
    presentation.deadBodyMaterial,
    presentation.enemyFacingMaterial,
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

test("Canvas2D and Three.js facing markers derive the same normalized snapshot direction", () => {
  const simulation = new Simulation({ particleBurstCount: 0 });
  simulation.tick(null);
  const snapshot = simulation.snapshot();
  snapshot.enemies[0].facing = { x: 3, z: 4 };
  const enemy = snapshot.enemies[0];
  const footprint = enemyFacingTriangle(enemy, enemy.x, enemy.z);
  assert.deepEqual(footprint.facing, { x: 0.6, z: 0.8 });

  const { presentation, sightFrame } = threePresentation(snapshot);
  presentation.render(snapshot, 1, view(snapshot, sightFrame));
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  presentation.enemyFacingMesh.getMatrixAt(0, matrix);
  matrix.decompose(position, quaternion, scale);
  const direction = new THREE.Vector3(0, 1, 0).applyQuaternion(quaternion).normalize();
  assert.ok(Math.abs(direction.x - footprint.facing.x) < 1e-6);
  assert.ok(Math.abs(direction.z - footprint.facing.z) < 1e-6);
});
