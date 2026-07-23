// @ts-check

import * as THREE from "three/webgpu";
import { pass } from "three/tsl";
import { bloom } from "three/addons/tsl/display/BloomNode.js";

import { ROCK_ARCHETYPES } from "../config.js";
import {
  completeInstancedPoolSubmission,
  createDynamicInstancedPool,
  publishInstancedPool,
} from "./instanced_pool.js";
import { PresentationLightBudget, writeSparkFireColor } from "./light_budget.js";
import { applyLightPool } from "./light_pool.js";
import { PresentationFlags } from "./options.js";
import { PresentationProfiler } from "./profiler.js";
import { PresentationWarmupStatus } from "./warmup.js";

const MAXIMUM_CANVAS_BACKING_SCALE = 2;
const WALL_HEIGHT_METERS = 2.5;
const PLAYER_HEIGHT_METERS = 1.6;
const FIREBALL_CHEST_HEIGHT_METERS = 0.9;

/** @param {number} value @param {number} minimum @param {number} maximum */
function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

/** @param {{width:number,height:number,cells:number[]}} map */
function hashMap(map) {
  let hash = 2_166_136_261;
  hash = Math.imul(hash ^ map.width, 16_777_619);
  hash = Math.imul(hash ^ map.height, 16_777_619);
  for (const cell of map.cells) hash = Math.imul(hash ^ cell, 16_777_619);
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
   * @param {{renderer:"2d"|"3d",backend:"auto"|"webgl",forceWebGL:boolean}} options
   * @param {number} [warmupStartedAt]
   */
  constructor(canvas, camera, options, warmupStartedAt = performance.now()) {
    this.canvas = canvas;
    this.camera = camera;
    this.options = options;
    this.flags = new PresentationFlags();
    this.activeBackend = "initializing";
    this.width = 0;
    this.height = 0;
    this.backingScale = 0;
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
    this.lightBudget = new PresentationLightBudget();
    this.profiler = new PresentationProfiler();
    this.warmup = new PresentationWarmupStatus(
      true,
      () => performance.now(),
      warmupStartedAt,
    );

    this.webRenderer = new THREE.WebGPURenderer({
      canvas,
      alpha: false,
      antialias: true,
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

    this.floorMaterial = new THREE.MeshStandardMaterial({
      color: 0x182124,
      roughness: 0.94,
      metalness: 0,
    });
    this.floor = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.floorMaterial);
    this.floor.name = "arena-floor";
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.receiveShadow = true;
    this.scene.add(this.floor);

    this.wallGeometry = new THREE.BoxGeometry(1, WALL_HEIGHT_METERS, 1);
    this.wallMaterial = new THREE.MeshStandardMaterial({
      color: 0x485453,
      roughness: 0.78,
      metalness: 0.02,
    });
    this.rockGeometry = new THREE.IcosahedronGeometry(1, 1);
    this.rockMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.9,
      metalness: 0,
      vertexColors: true,
    });
    this.projectileGeometry = new THREE.IcosahedronGeometry(1, 1);
    this.projectileMaterial = new THREE.MeshStandardMaterial({
      color: 0xffcb72,
      emissive: 0xff4d0d,
      emissiveIntensity: 3.8,
      roughness: 0.25,
      metalness: 0,
    });
    this.particleGeometry = new THREE.IcosahedronGeometry(1, 0);
    this.particleMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xff3b08,
      emissiveIntensity: 2.6,
      roughness: 0.36,
      metalness: 0,
      vertexColors: true,
    });

    this.player = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({
        color: 0xe2bc67,
        emissive: 0x211607,
        emissiveIntensity: 0.35,
        roughness: 0.68,
        metalness: 0.03,
      }),
    );
    this.player.name = "player-block";
    this.player.castShadow = true;
    this.player.receiveShadow = true;
    this.scene.add(this.player);

    this.spawnMarker = this.#createGroundRing(0x69d4b3, 0.085, 0.12, 0.82);
    this.spawnMarker.visible = true;
    this.cursorMarker = this.#createGroundRing(0x69d4b3, 0.07, 0.095, 0.88);
    this.hoverMarker = this.#createGroundRing(0x69d4b3, 0.88, 1, 0.82);
    this.selectedMarker = this.#createGroundRing(0xfff1b0, 0.86, 1, 0.96);
    this.editCellPreview = new THREE.Mesh(
      new THREE.BoxGeometry(1, 0.035, 1),
      new THREE.MeshBasicMaterial({
        color: 0xff834d,
        transparent: true,
        opacity: 0.38,
        depthWrite: false,
      }),
    );
    this.editCellPreview.visible = false;
    this.scene.add(this.editCellPreview);
    this.editRockPreview = new THREE.Mesh(
      this.rockGeometry,
      new THREE.MeshBasicMaterial({
        color: 0x69d4b3,
        wireframe: true,
        transparent: true,
        opacity: 0.72,
        depthTest: false,
      }),
    );
    this.editRockPreview.visible = false;
    this.editRockPreview.renderOrder = 10;
    this.scene.add(this.editRockPreview);

    this._matrix = new THREE.Matrix4();
    this._position = new THREE.Vector3();
    this._quaternion = new THREE.Quaternion();
    this._scale = new THREE.Vector3();
    this._color = new THREE.Color();
    this._cameraTarget = new THREE.Vector3();
    this._bloomEnabled = false;
    this.renderPipeline = null;
    this.bloomOutput = null;
  }

  /** @param {ReturnType<import('../sim/simulation.js').Simulation['snapshot']>} initialSnapshot */
  async initialize(initialSnapshot) {
    try {
      await this.webRenderer.init();
      this.activeBackend = this.webRenderer.backend.isWebGPUBackend === true
        ? "webgpu"
        : "webgl2";
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
      MAXIMUM_CANVAS_BACKING_SCALE,
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
   * @param {{mouseWorld:{x:number,z:number},mouseInside:boolean,hover:Record<string,unknown>|null,selected:Record<string,unknown>|null,mode:string,editorTool:string,placementValid:boolean}} view
   */
  render(snapshot, alpha, view) {
    const totalStarted = performance.now();
    this.resize();
    this.#syncCamera();
    this.#updateMap(snapshot.map);
    this.#updatePlayer(snapshot.player, alpha);
    this.#updateRocks(snapshot, alpha);
    this.#updateProjectiles(snapshot, alpha);
    this.#updateParticles(snapshot);
    this.#updateView(snapshot, view);
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
    this._bloomEnabled = bloomEnabled;
    const submitFinished = performance.now();
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
      this.activeLightCount = applyLightPool(this.dynamicLights, [], false);
    }
    if (name === "shadows") this.#applyShadowFlag();
    return true;
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
      warmup: this.warmup.snapshot(),
      presentationCpuMs: this.profiler.summary(),
      recentSpikes: this.profiler.recentSpikes(),
      flags: this.flags.snapshot(),
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
    this.#updateMap(snapshot.map);
    this.#updatePlayer(snapshot.player, 0);
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
      this.projectileMesh,
      this.particleMesh,
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

  /** @param {{width:number,height:number,cells:number[],playerSpawn:{x:number,z:number}}} map */
  #updateMap(map) {
    const nextHash = hashMap(map);
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
        new THREE.LineBasicMaterial({ color: 0x334247, transparent: true, opacity: 0.72 }),
      );
      this.gridLines.name = "metric-grid";
      this.scene.add(this.gridLines);
      this.#replaceWallMesh(map.width * map.height);
    }

    if (!this.wallMesh) this.#replaceWallMesh(map.width * map.height);
    let wallCount = 0;
    for (let cz = 0; cz < map.height; cz += 1) {
      for (let cx = 0; cx < map.width; cx += 1) {
        if (map.cells[cz * map.width + cx] !== 1) continue;
        this._position.set(cx + 0.5, WALL_HEIGHT_METERS / 2, cz + 0.5);
        this._scale.set(1, 1, 1);
        this._matrix.compose(this._position, this._quaternion, this._scale);
        this.wallMesh.setMatrixAt(wallCount, this._matrix);
        wallCount += 1;
      }
    }
    publishInstancedPool(this.wallMesh, wallCount);
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
    const x = player.previousX + (player.x - player.previousX) * alpha;
    const z = player.previousZ + (player.z - player.previousZ) * alpha;
    this.player.position.set(x, PLAYER_HEIGHT_METERS / 2, z);
    this.player.scale.set(player.radius * 2, PLAYER_HEIGHT_METERS, player.radius * 2);
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
    }
    publishInstancedPool(this.projectileMesh, snapshot.projectiles.length);
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
        { instanceColors: true },
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
      writeSparkFireColor(this._color, life);
      this.particleMesh.setColorAt(index, this._color);
    }
    publishInstancedPool(this.particleMesh, snapshot.particles.length, {
      deferCountGrowth: true,
      instanceColors: true,
    });
  }

  /** @param {ReturnType<import('../sim/simulation.js').Simulation['snapshot']>} snapshot */
  #updateLights(snapshot) {
    const assignments = this.lightBudget.allocate(
      snapshot,
      this.flags.values.dynamicLights,
    );
    this.activeLightCount = applyLightPool(
      this.dynamicLights,
      assignments,
      this.flags.values.dynamicLights,
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

  /** @param {number} color @param {number} inner @param {number} outer @param {number} opacity */
  #createGroundRing(color, inner, outer, opacity) {
    const marker = new THREE.Mesh(
      new THREE.RingGeometry(inner, outer, 32),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    marker.rotation.x = -Math.PI / 2;
    marker.renderOrder = 20;
    marker.visible = false;
    this.scene.add(marker);
    return marker;
  }

}
