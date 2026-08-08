// @ts-check

import * as THREE from "three/webgpu";
import { instancedDynamicBufferAttribute, pass } from "three/tsl";
import { bloom } from "three/addons/tsl/display/BloomNode.js";

import { ENEMY_WIZARD, ROCK_ARCHETYPES } from "../config.js";
import {
  HEALTH_BAR,
  healthBarColor,
  healthBarRatio,
} from "./combat_visuals.js";
import { normalizedEnemyFacing } from "./enemy_facing.js";
import {
  completeInstancedPoolSubmission,
  createDynamicInstancedPool,
  publishInstancedPool,
  setInstancedEmissiveAt,
} from "./instanced_pool.js";
import { PresentationLightBudget } from "./light_budget.js";
import { applyLightPool } from "./light_pool.js";
import { PresentationFlags } from "./options.js";
import { interpolateRenderValue } from "./player_camera.js";
import { PresentationProfiler } from "./profiler.js";
import { TrueSightTextureTransport } from "./true_sight_transport.js";
import { PresentationWarmupStatus } from "./warmup.js";
import { TRUE_SIGHT_MAX_RAYS } from "../visibility/true_sight.js";
import {
  FIREBALL_COLOR_CORE,
  FIREBALL_COLOR_PARTICLE,
  FIREBALL_COLOR_PROJECTILE,
  writeFireballPaletteColor,
} from "../spells/palette.js";
import { fireballDefinitionFromSnapshot } from "../spells/snapshot.js";

const WALL_HEIGHT_METERS = 2.5;
const PLAYER_HEIGHT_METERS = 1.6;
const FIREBALL_CHEST_HEIGHT_METERS = 0.9;
const ACTOR_CYLINDER_RADIAL_SEGMENTS = 16;
const ENEMY_FACING_MARKER_RADIUS_METERS = 0.11;
const ENEMY_FACING_MARKER_LENGTH_METERS = 0.34;
const ENEMY_FACING_MARKER_OVERLAP_METERS = 0.02;

/** @param {number} value @param {number} minimum @param {number} maximum */
function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

/** @param {{width:number,height:number,cells:number[]}} map @param {Array<{cell:{cx:number,cz:number}}>} [obelisks] */
function hashMap(map, obelisks = []) {
  let hash = 2_166_136_261;
  hash = Math.imul(hash ^ map.width, 16_777_619);
  hash = Math.imul(hash ^ map.height, 16_777_619);
  for (const cell of map.cells) hash = Math.imul(hash ^ cell, 16_777_619);
  for (const obelisk of obelisks) {
    hash = Math.imul(hash ^ obelisk.cell.cx, 16_777_619);
    hash = Math.imul(hash ^ obelisk.cell.cz, 16_777_619);
  }
  return hash >>> 0;
}

/** @param {THREE.Material|THREE.Material[]} material */
function setMaterialColor(material, color) {
  if (Array.isArray(material)) return;
  if ("color" in material && material.color instanceof THREE.Color) {
    material.color.set(color);
  }
}

export class ThreePresentation {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {import('./camera_3d.js').Camera3D} camera
   * @param {ReturnType<import('./options.js').parsePresentationOptions>} options
   * @param {number} [warmupStartedAt]
   * @param {PresentationFlags} [flags]
   * @param {import('../visibility/true_sight.js').TrueSightFrame|null} [initialSightFrame]
   */
  constructor(
    canvas,
    camera,
    options,
    warmupStartedAt = performance.now(),
    flags = new PresentationFlags(options),
    initialSightFrame = null,
  ) {
    this.canvas = canvas;
    this.camera = camera;
    this.options = options;
    this.flags = flags;
    this.activeBackend = "initializing";
    this.width = 0;
    this.height = 0;
    this.backingScale = 0;
    this.pixelDensityCap = options.dpr;
    this.activeLightCount = 0;
    this.residentLightCount = 0;
    this.mapHash = -1;
    this.mapWidth = 0;
    this.mapHeight = 0;
    this.gridLines = null;
    this.wallMesh = null;
    this.rockMesh = null;
    this.projectileMesh = null;
    this.particleMesh = null;
    this.lightBudget = new PresentationLightBudget({ capacity: options.lights });
    this.profiler = new PresentationProfiler();
    this.warmup = new PresentationWarmupStatus(
      true,
      () => performance.now(),
      warmupStartedAt,
    );
    // Keep this before WebGPURenderer construction: warmup must see the final
    // texture allocation and the first real mask, never a resizable placeholder.
    this.currentSightFrame = initialSightFrame;
    this.sightTransport = new TrueSightTextureTransport(initialSightFrame);
    this.sightTexture = this.sightTransport.texture;
    this.sightMapSize = this.sightTransport.mapSize;
    this.sightMapSizeNode = this.sightTransport.mapSizeNode;
    this.sightOpacityNode = this.sightTransport.opacityNode;
    this.sightMaskNode = this.sightTransport.maskNode;
    this._sampleSightVisibility = (x, z) => (
      this.currentSightFrame
        ? this.sightTransport.sampleVisibilityAt(x, z)
        : 1
    );

    this.webRenderer = new THREE.WebGPURenderer({
      canvas,
      alpha: false,
      antialias: options.aa,
      forceWebGL: options.forceWebGL,
    });
    this.webRenderer.setClearColor(0x080b10, 1);
    this.webRenderer.outputColorSpace = THREE.SRGBColorSpace;
    this.webRenderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.webRenderer.toneMappingExposure = 0.9;
    this.webRenderer.shadowMap.enabled = false;
    this.webRenderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x080b10);
    this.threeCamera = new THREE.OrthographicCamera(-12, 12, 12, -12, 0.1, 128);
    this.scene.add(this.threeCamera);

    this.ambientLight = new THREE.AmbientLight(0x26344c, 0.7);
    this.directionalLight = new THREE.DirectionalLight(0xb9c7ca, 1.15);
    this.directionalLight.position.set(-9, 18, -7);
    this.directionalLight.castShadow = false;
    this.directionalLight.shadow.mapSize.set(1_024, 1_024);
    this.directionalLight.shadow.camera.left = -24;
    this.directionalLight.shadow.camera.right = 24;
    this.directionalLight.shadow.camera.top = 24;
    this.directionalLight.shadow.camera.bottom = -24;
    this.directionalLight.shadow.camera.near = 0.1;
    this.directionalLight.shadow.camera.far = 64;
    this.directionalLight.shadow.bias = -0.0002;
    this.scene.add(
      this.ambientLight,
      this.directionalLight,
      this.directionalLight.target,
    );

    this.dynamicLights = Array.from(
      { length: this.lightBudget.capacity },
      () => {
        const light = new THREE.PointLight(0xffa13a, 0, 0, 2);
        light.visible = true;
        light.castShadow = false;
        this.scene.add(light);
        return light;
      },
    );
    this.residentLightCount = this.dynamicLights.length;

    this.floorMaterial = this.#configureSightMaterial(new THREE.MeshStandardNodeMaterial({
      color: 0x182124,
      roughness: 0.94,
      metalness: 0,
    }));
    this.floor = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.floorMaterial);
    this.floor.name = "arena-floor";
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.receiveShadow = true;
    this.scene.add(this.floor);

    this.wallGeometry = new THREE.BoxGeometry(1, WALL_HEIGHT_METERS, 1);
    this.wallMaterial = this.#configureSightMaterial(new THREE.MeshStandardNodeMaterial({
      color: 0x485453,
      roughness: 0.78,
      metalness: 0.02,
    }));
    this.rockGeometry = new THREE.IcosahedronGeometry(1, 1);
    this.rockMaterial = this.#configureSightMaterial(new THREE.MeshStandardNodeMaterial({
      color: 0xffffff,
      roughness: 0.9,
      metalness: 0,
      vertexColors: true,
    }));
    this.projectileGeometry = new THREE.IcosahedronGeometry(1, 1);
    this.projectileMaterial = this.#configureSightMaterial(new THREE.MeshStandardNodeMaterial({
      color: 0xffffff,
      emissive: 0xff4d0d,
      emissiveIntensity: 3.8,
      roughness: 0.25,
      metalness: 0,
      vertexColors: true,
    }));
    this.particleGeometry = new THREE.IcosahedronGeometry(1, 0);
    this.particleMaterial = this.#configureSightMaterial(new THREE.MeshStandardNodeMaterial({
      color: 0xffffff,
      emissive: 0xff3b08,
      emissiveIntensity: 2.6,
      roughness: 0.36,
      metalness: 0,
      vertexColors: true,
    }));

    this.actorGeometry = new THREE.CylinderGeometry(
      0.5,
      0.5,
      1,
      ACTOR_CYLINDER_RADIAL_SEGMENTS,
    );
    this.player = new THREE.Mesh(
      this.actorGeometry,
      this.#configureSightMaterial(new THREE.MeshStandardNodeMaterial({
        color: 0xe2bc67,
        emissive: 0x211607,
        emissiveIntensity: 0.35,
        roughness: 0.68,
        metalness: 0.03,
      })),
    );
    this.player.name = "player-cylinder";
    this.player.castShadow = true;
    this.player.receiveShadow = true;
    this.scene.add(this.player);

    this.enemyMaterial = this.#configureSightMaterial(new THREE.MeshStandardNodeMaterial({
      color: 0xb94852,
      emissive: 0x27080c,
      emissiveIntensity: 0.42,
      roughness: 0.68,
      metalness: 0.03,
    }));
    this.enemyMesh = createDynamicInstancedPool(
      this.actorGeometry,
      this.enemyMaterial,
      ENEMY_WIZARD.capacity,
      "enemy-wizards",
    );
    this.enemyMesh.castShadow = true;
    this.enemyMesh.receiveShadow = true;
    this.scene.add(this.enemyMesh);

    this.enemyFacingMaterial = this.#configureSightMaterial(new THREE.MeshStandardNodeMaterial({
      color: 0xff9b9e,
      emissive: 0x31090d,
      emissiveIntensity: 0.32,
      roughness: 0.62,
      metalness: 0.02,
    }));
    this.enemyFacingGeometry = new THREE.ConeGeometry(
      ENEMY_FACING_MARKER_RADIUS_METERS,
      ENEMY_FACING_MARKER_LENGTH_METERS,
      3,
    );
    this.enemyFacingMesh = createDynamicInstancedPool(
      this.enemyFacingGeometry,
      this.enemyFacingMaterial,
      ENEMY_WIZARD.capacity,
      "enemy-facing-markers",
    );
    this.enemyFacingMesh.castShadow = true;
    this.enemyFacingMesh.receiveShadow = true;
    this.scene.add(this.enemyFacingMesh);

    this.healthTrackMaterial = this.#configureSightMaterial(new THREE.MeshBasicNodeMaterial({
      color: HEALTH_BAR.trackColor,
      transparent: true,
      opacity: 0.92,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    }));
    this.healthFillMaterial = this.#configureSightMaterial(new THREE.MeshBasicNodeMaterial({
      color: 0xffffff,
      vertexColors: true,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    }));
    this.healthBarGeometry = new THREE.PlaneGeometry(1, 1);
    this.healthTrackMesh = createDynamicInstancedPool(
      this.healthBarGeometry,
      this.healthTrackMaterial,
      ENEMY_WIZARD.capacity + 1,
      "actor-health-tracks",
    );
    this.healthFillMesh = createDynamicInstancedPool(
      this.healthBarGeometry,
      this.healthFillMaterial,
      ENEMY_WIZARD.capacity + 1,
      "actor-health-fills",
      { instanceColors: true },
    );
    this.healthTrackMesh.renderOrder = 30;
    this.healthFillMesh.renderOrder = 31;
    this.scene.add(this.healthTrackMesh, this.healthFillMesh);

    this.obeliskMaterial = this.#configureSightMaterial(new THREE.MeshStandardNodeMaterial({
      color: 0x7568a8,
      emissive: 0x171027,
      emissiveIntensity: 0.38,
      roughness: 0.52,
      metalness: 0.18,
    }));
    this.obeliskBaseMaterial = this.#configureSightMaterial(new THREE.MeshStandardNodeMaterial({
      color: 0x252d37,
      roughness: 0.8,
      metalness: 0.08,
    }));
    this.obeliskGroup = new THREE.Group();
    this.obeliskGroup.name = "authored-obelisk";
    const obeliskBase = new THREE.Mesh(
      new THREE.BoxGeometry(0.82, 0.28, 0.82),
      this.obeliskBaseMaterial,
    );
    obeliskBase.position.y = 0.14;
    const obeliskShaft = new THREE.Mesh(
      new THREE.ConeGeometry(0.38, 2.05, 4),
      this.obeliskMaterial,
    );
    obeliskShaft.position.y = 1.18;
    obeliskShaft.rotation.y = Math.PI / 4;
    obeliskBase.castShadow = true;
    obeliskBase.receiveShadow = true;
    obeliskShaft.castShadow = true;
    obeliskShaft.receiveShadow = true;
    this.obeliskGroup.add(obeliskBase, obeliskShaft);
    this.obeliskGroup.visible = false;
    this.scene.add(this.obeliskGroup);

    this.spawnMarker = this.#createGroundRing(0x69d4b3, 0.085, 0.12, 0.82);
    this.spawnMarker.visible = true;
    this.cursorMarker = this.#createGroundRing(0x69d4b3, 0.07, 0.095, 0.88);
    this.hoverMarker = this.#createGroundRing(0x69d4b3, 0.88, 1, 0.82);
    this.selectedMarker = this.#createGroundRing(0xfff1b0, 0.86, 1, 0.96);
    this.editCellPreview = new THREE.Mesh(
      new THREE.BoxGeometry(1, 0.035, 1),
      this.#configureSightMaterial(new THREE.MeshBasicNodeMaterial({
        color: 0xff834d,
        transparent: true,
        opacity: 0.38,
        depthWrite: false,
      })),
    );
    this.editCellPreview.visible = false;
    this.scene.add(this.editCellPreview);
    this.editRockPreview = new THREE.Mesh(
      this.rockGeometry,
      this.#configureSightMaterial(new THREE.MeshBasicNodeMaterial({
        color: 0x69d4b3,
        wireframe: true,
        transparent: true,
        opacity: 0.72,
        depthTest: false,
      })),
    );
    this.editRockPreview.visible = false;
    this.editRockPreview.renderOrder = 10;
    this.scene.add(this.editRockPreview);

    this.sightRayPositions = new Float32Array(TRUE_SIGHT_MAX_RAYS * 6);
    this.sightRayGeometry = new THREE.BufferGeometry();
    this.sightRayGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(this.sightRayPositions, 3).setUsage(
        THREE.DynamicDrawUsage,
      ),
    );
    this.sightRayGeometry.setDrawRange(0, 0);
    this.sightRayLines = new THREE.LineSegments(
      this.sightRayGeometry,
      new THREE.LineBasicNodeMaterial({
        color: 0xffb858,
        transparent: true,
        opacity: 0.32,
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.sightRayLines.visible = false;
    this.sightRayLines.renderOrder = 50;
    this.scene.add(this.sightRayLines);

    this.sightPolygonPositions = new Float32Array(
      (TRUE_SIGHT_MAX_RAYS + 1) * 3,
    );
    this.sightPolygonGeometry = new THREE.BufferGeometry();
    this.sightPolygonGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(this.sightPolygonPositions, 3).setUsage(
        THREE.DynamicDrawUsage,
      ),
    );
    this.sightPolygonGeometry.setDrawRange(0, 0);
    this.sightPolygonLine = new THREE.Line(
      this.sightPolygonGeometry,
      new THREE.LineBasicNodeMaterial({
        color: 0x6ce3ff,
        transparent: true,
        opacity: 0.95,
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.sightPolygonLine.visible = false;
    this.sightPolygonLine.renderOrder = 51;
    this.scene.add(this.sightPolygonLine);

    this.sightHitGeometry = new THREE.BoxGeometry(1, 0.025, 1);
    this.sightHitMaterial = new THREE.MeshBasicNodeMaterial({
      color: 0xff5c5c,
      transparent: true,
      opacity: 0.28,
      depthTest: false,
      depthWrite: false,
    });
    this.sightHitMesh = createDynamicInstancedPool(
      this.sightHitGeometry,
      this.sightHitMaterial,
      TRUE_SIGHT_MAX_RAYS,
      "true-sight-hit-wall-cells",
    );
    this.sightHitMesh.visible = false;
    this.sightHitMesh.renderOrder = 49;
    this.scene.add(this.sightHitMesh);

    this._matrix = new THREE.Matrix4();
    this._position = new THREE.Vector3();
    this._quaternion = new THREE.Quaternion();
    this._billboardQuaternion = new THREE.Quaternion();
    this._scale = new THREE.Vector3();
    this._color = new THREE.Color();
    this._emissiveColor = new THREE.Color();
    this._cameraTarget = new THREE.Vector3();
    this._cameraRight = new THREE.Vector3();
    this._cameraUp = new THREE.Vector3();
    this._healthCenter = new THREE.Vector3();
    this._facingDirection = new THREE.Vector3();
    this._facingOrigin = new THREE.Vector3(0, 1, 0);
    this._facingQuaternion = new THREE.Quaternion();
    this._bloomEnabled = false;
    this.renderPipeline = null;
    this.bloomOutput = null;
    this.gpuTimingSupported = false;
    this.gpuCaptureActive = false;
    this.gpuRenderSamples = [];
    this._gpuResolvePromise = null;
    this.#applyShadowFlag();
  }

  /** @param {ReturnType<import('../sim/simulation.js').Simulation['snapshot']>} initialSnapshot */
  async initialize(initialSnapshot) {
    try {
      if (!this.currentSightFrame) {
        throw new Error("Three presentation requires an initial TrueSight frame");
      }
      await this.webRenderer.init();
      this.activeBackend = this.webRenderer.backend.isWebGPUBackend === true
        ? "webgpu"
        : "webgl2";
      this.gpuTimingSupported = this.#detectGpuTimingSupport();
      this.camera.focus(initialSnapshot.player.x, initialSnapshot.player.z);
      this.resize();

      const scenePass = pass(this.scene, this.threeCamera);
      const sceneColor = scenePass.getTextureNode("output");
      const bloomPass = bloom(sceneColor, 0.18, 0.22, 1.05);
      this.renderPipeline = new THREE.RenderPipeline(this.webRenderer, sceneColor);
      this.bloomOutput = sceneColor.add(bloomPass);

      this.#buildWarmupScene(initialSnapshot);
      await this.#compileDefaultPipelines(initialSnapshot);
      this.warmup.complete();
    } catch (error) {
      this.warmup.fail();
      throw error;
    }
  }

  resize() {
    const bounds = this.canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(bounds.width));
    const height = Math.max(1, Math.round(bounds.height));
    const backingScale = Math.min(
      this.pixelDensityCap,
      window.devicePixelRatio || 1,
    );
    if (
      width === this.width
      && height === this.height
      && backingScale === this.backingScale
    ) {
      return;
    }
    this.width = width;
    this.height = height;
    this.backingScale = backingScale;
    this.webRenderer.setPixelRatio(backingScale);
    this.webRenderer.setSize(width, height, false);
    this.camera.resize(width, height);
    this.#syncCamera();
  }

  /**
   * @param {ReturnType<import('../sim/simulation.js').Simulation['snapshot']>} snapshot
   * @param {number} alpha
   * @param {{mouseWorld:{x:number,z:number},mouseInside:boolean,hover:Record<string,unknown>|null,selected:Record<string,unknown>|null,mode:string,editorTool:string,placementValid:boolean,sightFrame?:import('../visibility/true_sight.js').TrueSightFrame,developerToolsOpen?:boolean}} view
   */
  render(snapshot, alpha, view) {
    const totalStarted = performance.now();
    this.resize();
    this.#syncCamera();
    this.#syncSightFrame(view.sightFrame ?? null);
    this.#updateMap(snapshot.map, snapshot.obelisks ?? []);
    this.#updateObelisk(snapshot.obelisks ?? []);
    this.#updatePlayer(snapshot.player, alpha);
    this.#updateEnemies(snapshot, alpha);
    this.#updateHealthBars(snapshot, alpha);
    this.#updateRocks(snapshot, alpha);
    this.#updateProjectiles(snapshot, alpha);
    this.#updateParticles(snapshot);
    this.#updateView(snapshot, view);
    this.#updateSightDebug(
      view.sightFrame ?? null,
      view.developerToolsOpen !== false,
    );
    const updateFinished = performance.now();
    this.#updateLights(snapshot);
    const lightsFinished = performance.now();

    const bloomEnabled = this.flags.values.bloom;
    if (bloomEnabled && this.renderPipeline && this.bloomOutput) {
      if (!this._bloomEnabled) {
        this.renderPipeline.outputNode = this.bloomOutput;
        this.renderPipeline.needsUpdate = true;
      }
      this.renderPipeline.render();
    } else {
      this.webRenderer.render(this.scene, this.threeCamera);
    }
    completeInstancedPoolSubmission(this.particleMesh);
    completeInstancedPoolSubmission(this.projectileMesh);
    this._bloomEnabled = bloomEnabled;
    const submitFinished = performance.now();
    this.#sampleGpuTimer();
    this.profiler.record({
      tick: snapshot.tick,
      projectileCount: snapshot.projectiles.length,
      particleCount: snapshot.particles.length,
      activeLightCount: this.activeLightCount,
      updateMs: updateFinished - totalStarted,
      lightsMs: lightsFinished - updateFinished,
      submitMs: submitFinished - lightsFinished,
      totalMs: submitFinished - totalStarted,
    });
  }

  /** @param {string} name @param {unknown} value */
  setPresentationFlag(name, value) {
    if (!this.flags.set(name, value)) return false;
    if (name === "dynamicLights" && !this.flags.values.dynamicLights) {
      this.lightBudget.reset();
      this.activeLightCount = applyLightPool(this.dynamicLights, [], false);
    }
    if (name === "shadows") this.#applyShadowFlag();
    return true;
  }

  /** @param {unknown} value */
  setPixelDensityCap(value) {
    const cap = Number(value);
    if (![1, 1.5, 2].includes(cap)) return false;
    this.pixelDensityCap = cap;
    this.backingScale = 0;
    return true;
  }

  beginGpuTimingCapture() {
    if (!this.gpuTimingSupported || this.gpuCaptureActive) return false;
    this.gpuRenderSamples = [];
    this.gpuCaptureActive = true;
    this.webRenderer.backend.trackTimestamp = true;
    return true;
  }

  async endGpuTimingCapture() {
    if (!this.gpuCaptureActive) return null;
    this.gpuCaptureActive = false;
    try {
      if (this._gpuResolvePromise) await this._gpuResolvePromise;
    } finally {
      this.webRenderer.backend.trackTimestamp = false;
    }
    return [...this.gpuRenderSamples];
  }

  diagnostics() {
    return {
      requestedRenderer: "3d",
      requestedBackend: this.options.backend,
      activeBackend: this.activeBackend,
      drawCalls: this.webRenderer.info.render.drawCalls,
      triangles: Math.round(this.webRenderer.info.render.triangles),
      activeLightCount: this.activeLightCount,
      residentLightCount: this.residentLightCount,
      cssResolution: {
        width: this.width,
        height: this.height,
      },
      backingResolution: {
        width: this.canvas.width,
        height: this.canvas.height,
      },
      effectiveDpr: this.backingScale,
      gpuTimingAvailable: this.gpuTimingSupported,
      gpuRenderMs: this.gpuRenderSamples.at(-1) ?? null,
      warmup: this.warmup.snapshot(),
      presentationCpuMs: this.profiler.summary(),
      recentSpikes: this.profiler.recentSpikes(),
      flags: this.flags.snapshot(),
      settings: {
        lights: this.lightBudget.capacity,
        dpr: this.pixelDensityCap,
        aa: this.options.aa,
      },
      combatInstances: {
        enemies: {
          active: this.enemyMesh.count,
          capacity: this.enemyMesh.userData.capacity,
        },
        facingMarkers: {
          active: this.enemyFacingMesh.count,
          capacity: this.enemyFacingMesh.userData.capacity,
        },
        healthTracks: {
          active: this.healthTrackMesh.count,
          capacity: this.healthTrackMesh.userData.capacity,
        },
        healthFills: {
          active: this.healthFillMesh.count,
          capacity: this.healthFillMesh.userData.capacity,
        },
        obeliskVisible: this.obeliskGroup.visible,
      },
      lightGroups: this.lightBudget.diagnostics(),
      trueSightTransport: this.sightTransport.diagnostics(),
      trueSightCpuMs: this.currentSightFrame?.timing.totalMs ?? null,
      trueSight: this.currentSightFrame
        ? {
          rayCount: this.currentSightFrame.rayCount,
          polygonVertexCount: this.currentSightFrame.polygonVertexCount,
          visibleWallCount: this.currentSightFrame.visibleWallCount,
          maskWidth: this.currentSightFrame.maskWidth,
          maskHeight: this.currentSightFrame.maskHeight,
        }
        : null,
    };
  }

  resetPerformanceMetrics() {
    this.profiler.reset();
  }

  /** @param {ReturnType<import('../sim/simulation.js').Simulation['snapshot']>} snapshot */
  #buildWarmupScene(snapshot) {
    const view = {
      mouseWorld: { x: snapshot.player.x, z: snapshot.player.z },
      mouseInside: false,
      hover: null,
      selected: null,
      mode: "play",
      editorTool: "wall",
      placementValid: true,
    };
    this.#syncCamera();
    this.#updateMap(snapshot.map, snapshot.obelisks ?? []);
    this.#updateObelisk(snapshot.obelisks ?? []);
    this.#updatePlayer(snapshot.player, 0);
    this.#updateEnemies(snapshot, 0);
    this.#updateHealthBars(snapshot, 0);
    this.#updateRocks(snapshot, 0);
    this.#updateProjectiles(snapshot, 0);
    this.#updateParticles(snapshot);
    this.#updateView(snapshot, view);
    this.#updateLights(snapshot);
    this.profiler.prime({
      projectileCount: snapshot.projectiles.length,
      particleCount: snapshot.particles.length,
      activeLightCount: this.activeLightCount,
    });
  }

  /** @param {ReturnType<import('../sim/simulation.js').Simulation['snapshot']>} snapshot */
  async #compileDefaultPipelines(snapshot) {
    const normallyHidden = [
      this.cursorMarker,
      this.hoverMarker,
      this.selectedMarker,
      this.editCellPreview,
      this.editRockPreview,
      this.enemyMesh,
      this.enemyFacingMesh,
      this.healthTrackMesh,
      this.healthFillMesh,
      this.obeliskGroup,
      this.projectileMesh,
      this.particleMesh,
      this.sightRayLines,
      this.sightPolygonLine,
      this.sightHitMesh,
    ];
    const visibility = normallyHidden.map((mesh) => mesh.visible);
    const frustumCulling = normallyHidden.map((mesh) => mesh.frustumCulled);
    const x = snapshot.player.x;
    const z = snapshot.player.z;
    this.cursorMarker.position.set(x, 0.018, z);
    this.hoverMarker.position.set(x, 0.024, z);
    this.selectedMarker.position.set(x, 0.024, z);
    this.editCellPreview.position.set(Math.floor(x) + 0.5, 0.022, Math.floor(z) + 0.5);
    this.editRockPreview.position.set(x, ROCK_ARCHETYPES.medium.radius, z);
    this.editRockPreview.scale.setScalar(ROCK_ARCHETYPES.medium.radius);
    try {
      for (const mesh of normallyHidden) {
        mesh.visible = true;
        mesh.frustumCulled = false;
      }
      this.scene.updateMatrixWorld(true);
      await this.webRenderer.compileAsync(this.scene, this.threeCamera);
    } finally {
      for (let index = 0; index < normallyHidden.length; index += 1) {
        normallyHidden[index].visible = visibility[index];
        normallyHidden[index].frustumCulled = frustumCulling[index];
      }
    }
  }

  /** @param {THREE.NodeMaterial} material */
  #configureSightMaterial(material) {
    material.opacityNode = this.sightOpacityNode;
    material.maskNode = this.sightMaskNode;
    material.maskShadowNode = this.sightMaskNode;
    material.alphaHash = true;
    material.alphaToCoverage = this.options.aa;
    return material;
  }

  /** @param {import('../visibility/true_sight.js').TrueSightFrame|null} sightFrame */
  #syncSightFrame(sightFrame) {
    this.currentSightFrame = sightFrame;
    if (!sightFrame) return;
    this.sightTransport.stage(sightFrame);
  }

  /** @param {import('../visibility/true_sight.js').TrueSightFrame|null} sightFrame @param {boolean} developerToolsOpen */
  #updateSightDebug(sightFrame, developerToolsOpen) {
    const enabled = Boolean(
      developerToolsOpen
      && sightFrame
      && this.flags.values.sightDebug
    );
    if (!enabled || !sightFrame) {
      this.sightRayLines.visible = false;
      this.sightPolygonLine.visible = false;
      this.sightRayGeometry.setDrawRange(0, 0);
      this.sightPolygonGeometry.setDrawRange(0, 0);
      publishInstancedPool(this.sightHitMesh, 0);
      return;
    }

    for (let index = 0; index < sightFrame.rays.length; index += 1) {
      const ray = sightFrame.rays[index];
      const offset = index * 6;
      this.sightRayPositions[offset] = sightFrame.origin.x;
      this.sightRayPositions[offset + 1] = 0.055;
      this.sightRayPositions[offset + 2] = sightFrame.origin.z;
      this.sightRayPositions[offset + 3] = ray.x;
      this.sightRayPositions[offset + 4] = 0.055;
      this.sightRayPositions[offset + 5] = ray.z;
    }
    const rayAttribute = this.sightRayGeometry.getAttribute("position");
    rayAttribute.clearUpdateRanges();
    rayAttribute.addUpdateRange(0, sightFrame.rays.length * 6);
    rayAttribute.needsUpdate = true;
    this.sightRayGeometry.setDrawRange(0, sightFrame.rays.length * 2);
    this.sightRayLines.visible = sightFrame.rays.length > 0;

    const polygonCount = sightFrame.polygon.length;
    for (let index = 0; index < polygonCount; index += 1) {
      const point = sightFrame.polygon[index];
      const offset = index * 3;
      this.sightPolygonPositions[offset] = point.x;
      this.sightPolygonPositions[offset + 1] = 0.062;
      this.sightPolygonPositions[offset + 2] = point.z;
    }
    if (polygonCount > 0) {
      const offset = polygonCount * 3;
      this.sightPolygonPositions[offset] = sightFrame.polygon[0].x;
      this.sightPolygonPositions[offset + 1] = 0.062;
      this.sightPolygonPositions[offset + 2] = sightFrame.polygon[0].z;
    }
    const polygonAttribute = this.sightPolygonGeometry.getAttribute("position");
    polygonAttribute.clearUpdateRanges();
    polygonAttribute.addUpdateRange(0, (polygonCount + 1) * 3);
    polygonAttribute.needsUpdate = true;
    this.sightPolygonGeometry.setDrawRange(0, polygonCount + 1);
    this.sightPolygonLine.visible = polygonCount > 1;

    const hitCount = Math.min(
      sightFrame.hitWallCells.length,
      TRUE_SIGHT_MAX_RAYS,
    );
    for (let index = 0; index < hitCount; index += 1) {
      const cell = sightFrame.hitWallCells[index];
      this._position.set(cell.cx + 0.5, 0.035, cell.cz + 0.5);
      this._scale.set(1, 1, 1);
      this._matrix.compose(this._position, this._quaternion, this._scale);
      this.sightHitMesh.setMatrixAt(index, this._matrix);
    }
    publishInstancedPool(this.sightHitMesh, hitCount);
  }

  #syncCamera() {
    const pose = this.camera.renderPose();
    this.threeCamera.left = pose.left;
    this.threeCamera.right = pose.right;
    this.threeCamera.top = pose.top;
    this.threeCamera.bottom = pose.bottom;
    this.threeCamera.near = pose.near;
    this.threeCamera.far = pose.far;
    this.threeCamera.position.set(pose.position.x, pose.position.y, pose.position.z);
    this._cameraTarget.set(pose.target.x, pose.target.y, pose.target.z);
    this.threeCamera.lookAt(this._cameraTarget);
    this.threeCamera.updateProjectionMatrix();
    this.threeCamera.updateMatrixWorld();
  }

  /** @param {{width:number,height:number,cells:number[],playerSpawn:{x:number,z:number}}} map @param {Array<{cell:{cx:number,cz:number}}>} obelisks */
  #updateMap(map, obelisks) {
    const nextHash = hashMap(map, obelisks);
    const dimensionsChanged = map.width !== this.mapWidth || map.height !== this.mapHeight;
    if (nextHash === this.mapHash && !dimensionsChanged) return;
    this.mapHash = nextHash;
    this.mapWidth = map.width;
    this.mapHeight = map.height;
    this.floor.position.set(map.width / 2, 0, map.height / 2);
    this.floor.scale.set(map.width, map.height, 1);
    this.spawnMarker.position.set(map.playerSpawn.x, 0.012, map.playerSpawn.z);
    this.directionalLight.target.position.set(map.width / 2, 0, map.height / 2);

    if (dimensionsChanged) {
      if (this.gridLines) {
        this.scene.remove(this.gridLines);
        this.gridLines.geometry.dispose();
        if (!Array.isArray(this.gridLines.material)) this.gridLines.material.dispose();
      }
      const positions = [];
      for (let x = 0; x <= map.width; x += 1) {
        positions.push(x, 0.008, 0, x, 0.008, map.height);
      }
      for (let z = 0; z <= map.height; z += 1) {
        positions.push(0, 0.008, z, map.width, 0.008, z);
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      this.gridLines = new THREE.LineSegments(
        geometry,
        this.#configureSightMaterial(new THREE.LineBasicNodeMaterial({
          color: 0x334247,
          transparent: true,
          opacity: 0.72,
        })),
      );
      this.gridLines.name = "metric-grid";
      this.scene.add(this.gridLines);
      this.#replaceWallMesh(map.width * map.height);
    }

    if (!this.wallMesh) this.#replaceWallMesh(map.width * map.height);
    const obeliskCells = new Set(
      obelisks.map((obelisk) => `${obelisk.cell.cx}:${obelisk.cell.cz}`),
    );
    let wallCount = 0;
    for (let cz = 0; cz < map.height; cz += 1) {
      for (let cx = 0; cx < map.width; cx += 1) {
        if (map.cells[cz * map.width + cx] !== 1) continue;
        if (obeliskCells.has(`${cx}:${cz}`)) continue;
        this._position.set(cx + 0.5, WALL_HEIGHT_METERS / 2, cz + 0.5);
        this._scale.set(1, 1, 1);
        this._matrix.compose(this._position, this._quaternion, this._scale);
        this.wallMesh.setMatrixAt(wallCount, this._matrix);
        wallCount += 1;
      }
    }
    publishInstancedPool(this.wallMesh, wallCount);
  }

  /** @param {Array<{x:number,z:number}>} obelisks */
  #updateObelisk(obelisks) {
    const obelisk = obelisks[0] ?? null;
    this.obeliskGroup.visible = Boolean(obelisk);
    if (obelisk) this.obeliskGroup.position.set(obelisk.x, 0, obelisk.z);
  }

  /** @param {number} capacity */
  #replaceWallMesh(capacity) {
    if (this.wallMesh) this.scene.remove(this.wallMesh);
    this.wallMesh = createDynamicInstancedPool(
      this.wallGeometry,
      this.wallMaterial,
      capacity,
      "solid-wall-cells",
    );
    this.wallMesh.castShadow = true;
    this.wallMesh.receiveShadow = true;
    this.scene.add(this.wallMesh);
  }

  /** @param {Record<string, any>} player @param {number} alpha */
  #updatePlayer(player, alpha) {
    const x = interpolateRenderValue(player.previousX, player.x, alpha);
    const z = interpolateRenderValue(player.previousZ, player.z, alpha);
    this.player.position.set(x, PLAYER_HEIGHT_METERS / 2, z);
    this.player.scale.set(player.radius * 2, PLAYER_HEIGHT_METERS, player.radius * 2);
  }

  /** @param {ReturnType<import('../sim/simulation.js').Simulation['snapshot']>} snapshot @param {number} alpha */
  #updateEnemies(snapshot, alpha) {
    const enemies = snapshot.enemies ?? [];
    for (let index = 0; index < enemies.length; index += 1) {
      const enemy = enemies[index];
      const x = enemy.previousX + (enemy.x - enemy.previousX) * alpha;
      const z = enemy.previousZ + (enemy.z - enemy.previousZ) * alpha;
      this._position.set(x, PLAYER_HEIGHT_METERS / 2, z);
      this._scale.set(enemy.radius * 2, PLAYER_HEIGHT_METERS, enemy.radius * 2);
      this._matrix.compose(this._position, this._quaternion, this._scale);
      this.enemyMesh.setMatrixAt(index, this._matrix);
      const facing = normalizedEnemyFacing(enemy);
      const markerScale = Math.max(0.5, enemy.radius / ENEMY_WIZARD.radius);
      this._facingDirection.set(facing.x, 0, facing.z).normalize();
      this._facingQuaternion.setFromUnitVectors(
        this._facingOrigin,
        this._facingDirection,
      );
      const markerCenterDistance = enemy.radius + markerScale * (
        ENEMY_FACING_MARKER_LENGTH_METERS / 2
        - ENEMY_FACING_MARKER_OVERLAP_METERS
      );
      this._position.set(
        x + facing.x * markerCenterDistance,
        PLAYER_HEIGHT_METERS * 0.66,
        z + facing.z * markerCenterDistance,
      );
      this._scale.setScalar(markerScale);
      this._matrix.compose(this._position, this._facingQuaternion, this._scale);
      this.enemyFacingMesh.setMatrixAt(index, this._matrix);
    }
    publishInstancedPool(this.enemyMesh, enemies.length);
    publishInstancedPool(this.enemyFacingMesh, enemies.length);
  }

  /** @param {ReturnType<import('../sim/simulation.js').Simulation['snapshot']>} snapshot @param {number} alpha */
  #updateHealthBars(snapshot, alpha) {
    const actors = [snapshot.player, ...(snapshot.enemies ?? [])];
    this._billboardQuaternion.copy(this.threeCamera.quaternion);
    this._cameraRight
      .set(1, 0, 0)
      .applyQuaternion(this._billboardQuaternion)
      .normalize();
    this._cameraUp
      .set(0, 1, 0)
      .applyQuaternion(this._billboardQuaternion)
      .normalize();
    let count = 0;
    for (const actor of actors) {
      if (!(actor.health > 0) || count >= ENEMY_WIZARD.capacity + 1) continue;
      const x = actor.previousX + (actor.x - actor.previousX) * alpha;
      const z = actor.previousZ + (actor.z - actor.previousZ) * alpha;
      const ratio = healthBarRatio(actor.health, actor.maximumHealth);
      const rightOffset = actor.radius
        + HEALTH_BAR.actorGapMeters
        + HEALTH_BAR.widthMeters / 2;
      this._healthCenter
        .set(x, PLAYER_HEIGHT_METERS * 0.57, z)
        .addScaledVector(this._cameraRight, rightOffset);

      this._scale.set(HEALTH_BAR.widthMeters, HEALTH_BAR.heightMeters, 1);
      this._matrix.compose(
        this._healthCenter,
        this._billboardQuaternion,
        this._scale,
      );
      this.healthTrackMesh.setMatrixAt(count, this._matrix);

      const fillHeight = Math.max(0.001, HEALTH_BAR.heightMeters * ratio);
      this._position
        .copy(this._healthCenter)
        .addScaledVector(
          this._cameraUp,
          (ratio - 1) * HEALTH_BAR.heightMeters / 2,
        );
      this._scale.set(HEALTH_BAR.widthMeters * 0.78, fillHeight, 1);
      this._matrix.compose(
        this._position,
        this._billboardQuaternion,
        this._scale,
      );
      this.healthFillMesh.setMatrixAt(count, this._matrix);
      this._color.setHex(healthBarColor(ratio));
      this.healthFillMesh.setColorAt(count, this._color);
      count += 1;
    }
    publishInstancedPool(this.healthTrackMesh, count);
    publishInstancedPool(this.healthFillMesh, count, { instanceColors: true });
  }

  /** @param {ReturnType<import('../sim/simulation.js').Simulation['snapshot']>} snapshot @param {number} alpha */
  #updateRocks(snapshot, alpha) {
    const capacity = snapshot.pools.rocks.capacity;
    if (!this.rockMesh || this.rockMesh.userData.capacity !== capacity) {
      if (this.rockMesh) this.scene.remove(this.rockMesh);
      this.rockMesh = createDynamicInstancedPool(
        this.rockGeometry,
        this.rockMaterial,
        capacity,
        "rocks",
        { instanceColors: true },
      );
      this.rockMesh.castShadow = true;
      this.rockMesh.receiveShadow = true;
      this.scene.add(this.rockMesh);
    }
    for (let index = 0; index < snapshot.rocks.length; index += 1) {
      const rock = snapshot.rocks[index];
      const x = rock.previousX + (rock.x - rock.previousX) * alpha;
      const z = rock.previousZ + (rock.z - rock.previousZ) * alpha;
      this._position.set(x, rock.radius, z);
      this._scale.setScalar(rock.radius);
      this._matrix.compose(this._position, this._quaternion, this._scale);
      this.rockMesh.setMatrixAt(index, this._matrix);
      this._color.set(
        rock.archetype === "small"
          ? 0xabb09c
          : rock.archetype === "medium"
            ? 0x858b7c
            : 0x676f65,
      );
      this.rockMesh.setColorAt(index, this._color);
    }
    publishInstancedPool(this.rockMesh, snapshot.rocks.length, {
      instanceColors: true,
    });
  }

  /** @param {ReturnType<import('../sim/simulation.js').Simulation['snapshot']>} snapshot @param {number} alpha */
  #updateProjectiles(snapshot, alpha) {
    const capacity = snapshot.pools.projectiles.capacity;
    if (!this.projectileMesh || this.projectileMesh.userData.capacity !== capacity) {
      if (this.projectileMesh) this.scene.remove(this.projectileMesh);
      this.projectileMesh = createDynamicInstancedPool(
        this.projectileGeometry,
        this.projectileMaterial,
        capacity,
        "fireballs",
        { instanceColors: true, instanceEmissive: true },
      );
      this.projectileMaterial.emissiveNode = instancedDynamicBufferAttribute(
        this.projectileMesh.userData.instanceEmissive,
        "vec3",
      );
      this.scene.add(this.projectileMesh);
    }
    for (let index = 0; index < snapshot.projectiles.length; index += 1) {
      const projectile = snapshot.projectiles[index];
      const x = projectile.previousX + (projectile.x - projectile.previousX) * alpha;
      const z = projectile.previousZ + (projectile.z - projectile.previousZ) * alpha;
      this._position.set(x, FIREBALL_CHEST_HEIGHT_METERS, z);
      this._scale.setScalar(projectile.radius * 1.15);
      this._matrix.compose(this._position, this._quaternion, this._scale);
      this.projectileMesh.setMatrixAt(index, this._matrix);
      const definition = fireballDefinitionFromSnapshot(snapshot, projectile);
      writeFireballPaletteColor(this._color, definition, {
        kind: FIREBALL_COLOR_PROJECTILE,
        effectSeed: projectile.effectSeed,
        variationEnabled: this.flags.values.lightColorVariation,
      });
      this.projectileMesh.setColorAt(index, this._color);
      writeFireballPaletteColor(this._emissiveColor, definition, {
        kind: FIREBALL_COLOR_CORE,
        effectSeed: projectile.effectSeed,
        variationEnabled: this.flags.values.lightColorVariation,
      });
      setInstancedEmissiveAt(
        this.projectileMesh,
        index,
        this._emissiveColor,
        Number(definition.presentation.projectileEmissiveStrength),
      );
    }
    publishInstancedPool(this.projectileMesh, snapshot.projectiles.length, {
      deferCountGrowth: true,
      instanceColors: true,
      instanceEmissive: true,
    });
  }

  /** @param {ReturnType<import('../sim/simulation.js').Simulation['snapshot']>} snapshot */
  #updateParticles(snapshot) {
    const capacity = snapshot.pools.particles.capacity;
    if (!this.particleMesh || this.particleMesh.userData.capacity !== capacity) {
      if (this.particleMesh) this.scene.remove(this.particleMesh);
      this.particleMesh = createDynamicInstancedPool(
        this.particleGeometry,
        this.particleMaterial,
        capacity,
        "spark-particles",
        { instanceColors: true, instanceEmissive: true },
      );
      this.particleMaterial.emissiveNode = instancedDynamicBufferAttribute(
        this.particleMesh.userData.instanceEmissive,
        "vec3",
      );
      this.scene.add(this.particleMesh);
    }
    for (let index = 0; index < snapshot.particles.length; index += 1) {
      const particle = snapshot.particles[index];
      const life = clamp(1 - particle.age / particle.lifetime, 0, 1);
      const size = Math.max(0.001, particle.currentSize);
      this._position.set(particle.x, particle.y, particle.z);
      this._scale.set(size, size * 1.25, size);
      this._matrix.compose(this._position, this._quaternion, this._scale);
      this.particleMesh.setMatrixAt(index, this._matrix);
      const definition = fireballDefinitionFromSnapshot(snapshot, particle);
      writeFireballPaletteColor(this._color, definition, {
        kind: FIREBALL_COLOR_PARTICLE,
        life,
        effectSeed: particle.effectSeed,
        sampleOrdinal: particle.sampleOrdinal,
        sampleSeed: particle.sampleSeed,
        variationEnabled: this.flags.values.lightColorVariation,
      });
      this.particleMesh.setColorAt(index, this._color);
      setInstancedEmissiveAt(
        this.particleMesh,
        index,
        this._color,
        Number(definition.presentation.particleEmissiveStrength),
      );
    }
    publishInstancedPool(this.particleMesh, snapshot.particles.length, {
      deferCountGrowth: true,
      instanceColors: true,
      instanceEmissive: true,
    });
  }

  /** @param {ReturnType<import('../sim/simulation.js').Simulation['snapshot']>} snapshot */
  #updateLights(snapshot) {
    const assignments = this.lightBudget.allocate(
      snapshot,
      this.flags.values.dynamicLights,
      this.flags.values.lightColorVariation,
    );
    this.activeLightCount = applyLightPool(
      this.dynamicLights,
      assignments,
      this.flags.values.dynamicLights,
      this._sampleSightVisibility,
    );
  }

  /** @param {ReturnType<import('../sim/simulation.js').Simulation['snapshot']>} snapshot @param {any} view */
  #updateView(snapshot, view) {
    this.cursorMarker.visible = view.mouseInside && view.mode === "play";
    if (this.cursorMarker.visible) {
      this.cursorMarker.position.set(view.mouseWorld.x, 0.018, view.mouseWorld.z);
    }
    this.#positionInspectionMarker(this.hoverMarker, view.hover);
    this.#positionInspectionMarker(this.selectedMarker, view.selected);

    const editing = view.mouseInside && view.mode === "edit";
    const definition = Object.hasOwn(ROCK_ARCHETYPES, view.editorTool)
      ? ROCK_ARCHETYPES[view.editorTool]
      : null;
    this.editRockPreview.visible = Boolean(editing && definition);
    this.editCellPreview.visible = Boolean(editing && !definition);
    const previewColor = view.placementValid ? 0x69d4b3 : 0xff5b63;
    if (this.editRockPreview.visible && definition) {
      const x = Math.round(view.mouseWorld.x * 10) / 10;
      const z = Math.round(view.mouseWorld.z * 10) / 10;
      this.editRockPreview.position.set(x, definition.radius, z);
      this.editRockPreview.scale.setScalar(definition.radius);
      setMaterialColor(this.editRockPreview.material, previewColor);
    }
    if (this.editCellPreview.visible) {
      const cx = Math.floor(view.mouseWorld.x);
      const cz = Math.floor(view.mouseWorld.z);
      this.editCellPreview.position.set(cx + 0.5, 0.022, cz + 0.5);
      setMaterialColor(
        this.editCellPreview.material,
        view.editorTool === "erase" ? 0xff5b63 : previewColor,
      );
    }
    this.spawnMarker.position.set(
      snapshot.map.playerSpawn.x,
      0.012,
      snapshot.map.playerSpawn.z,
    );
  }

  /** @param {THREE.Mesh} marker @param {Record<string,unknown>|null} entity */
  #positionInspectionMarker(marker, entity) {
    if (!entity || !entity.position) {
      marker.visible = false;
      return;
    }
    const position = /** @type {{x:number,z:number}} */ (entity.position);
    const radius = entity.kind === "cell" ? 0.48 : Math.max(0.08, Number(entity.radius) || 0.16);
    marker.visible = true;
    marker.position.set(position.x, 0.024, position.z);
    marker.scale.setScalar(radius + 0.12);
  }

  #applyShadowFlag() {
    const enabled = this.flags.values.shadows;
    this.webRenderer.shadowMap.enabled = enabled;
    this.directionalLight.castShadow = enabled;
    this.webRenderer.shadowMap.needsUpdate = true;
    for (const light of this.dynamicLights) light.castShadow = false;
  }

  #detectGpuTimingSupport() {
    const backend = this.webRenderer.backend;
    if (backend.isWebGPUBackend === true) {
      return backend.device?.features?.has("timestamp-query") === true;
    }
    if (backend.isWebGLBackend === true) return Boolean(backend.disjoint);
    return false;
  }

  #sampleGpuTimer() {
    if (!this.gpuCaptureActive || this._gpuResolvePromise) return;
    this._gpuResolvePromise = this.webRenderer.resolveTimestampsAsync("render")
      .then((duration) => {
        if (Number.isFinite(duration) && duration >= 0) {
          this.gpuRenderSamples.push(duration);
        }
      })
      .catch(() => {})
      .finally(() => {
        this._gpuResolvePromise = null;
      });
  }

  /** @param {number} color @param {number} inner @param {number} outer @param {number} opacity */
  #createGroundRing(color, inner, outer, opacity) {
    const marker = new THREE.Mesh(
      new THREE.RingGeometry(inner, outer, 32),
      this.#configureSightMaterial(new THREE.MeshBasicNodeMaterial({
        color,
        transparent: true,
        opacity,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
      })),
    );
    marker.rotation.x = -Math.PI / 2;
    marker.renderOrder = 20;
    marker.visible = false;
    this.scene.add(marker);
    return marker;
  }

}
