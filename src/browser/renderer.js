// @ts-check

import { EXPLOSION, SIMULATION } from "../config.js";
import {
  getPlaceableDefinition,
  isDynamicBodyDefinition,
  isDynamicCircleDefinition,
} from "../authoring/definition_catalog.js";
import { occupiedCellsForTarget } from "../authoring/editor_interaction.js";
import { getFootprintBounds, getOccupiedCells } from "../authoring/footprint.js";
import {
  colorHexCss,
  HEALTH_BAR,
  healthBarColor,
  healthBarRatio,
} from "../presentation/combat_visuals.js";
import { enemyFacingTriangle } from "../presentation/enemy_facing.js";
import { enemyDeadBodyPose } from "../presentation/dead_body_pose.js";
import { interpolateRenderValue } from "../presentation/player_camera.js";
import {
  KINETIC_FRAGMENT_STYLE,
  writeKineticFragmentTriangle,
} from "../presentation/kinetic_fragments.js";
import {
  SCORCH_STYLE,
  SCORCH_WALL_HEIGHT_METERS,
} from "../presentation/scorch_marks.js";
import {
  FIREBALL_COLOR_CORE,
  FIREBALL_COLOR_IMPACT_LIGHT,
  FIREBALL_COLOR_PARTICLE,
  FIREBALL_COLOR_PROJECTILE,
  writeFireballPaletteColor,
} from "../spells/palette.js";
import { fireballDefinitionFromSnapshot } from "../spells/snapshot.js";

const COLORS = Object.freeze({
  void: "#090c0b",
  floorA: "#586358",
  floorB: "#5b665b",
  grid: "#46544b",
  gridMajor: "#667565",
  wall: "#687568",
  wallEdge: "#b8cba8",
  wallTop: "#7d8a79",
  player: "#f3c969",
  playerEdge: "#fff2bd",
  enemy: "#b94852",
  enemyEdge: "#ff9b9e",
  enemyBody: "#583237",
  enemyBodyEdge: "#9a676c",
  obeliskBase: "#232a33",
  obelisk: "#7669a8",
  obeliskEdge: "#c8baff",
  desired: "#68d6b5",
  velocity: "#f29d49",
  externalVelocity: "#8fdcf2",
  rockSmall: "#a7aa91",
  rockMedium: "#828673",
  rockLarge: "#676c5d",
  rockEdge: "#d0d0b1",
  projectile: "#ff834d",
  projectileCore: "#ffe4a3",
  particle: "#ffbd59",
  contact: "#ff5b63",
  explosion: "#efbd5f",
  blocked: "#ff6f67",
  hover: "#69d4b3",
  selected: "#fff7d6",
  text: "#91a797",
});

const GRID_LABEL_MINIMUM_VIEWPORT_SIZE = 26;
const GRID_LABEL_FONT = "10px 'Iosevka', 'Cascadia Code', monospace";
const HEIGHT_PROJECTION_GROUND_METERS_PER_VERTICAL_METER = 0.72;

/** @param {number} value @param {number} min @param {number} max */
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/** @param {{r:number,g:number,b:number}} color @param {number} [alpha] */
function cssColor(color, alpha = 1) {
  const r = Math.round(clamp(color.r, 0, 1) * 255);
  const g = Math.round(clamp(color.g, 0, 1) * 255);
  const b = Math.round(clamp(color.b, 0, 1) * 255);
  return alpha >= 1 ? `rgb(${r} ${g} ${b})` : `rgb(${r} ${g} ${b} / ${alpha})`;
}

export class DebugRenderer {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {import('./camera.js').Camera2D} camera
   * @param {number} [pixelDensityCap]
   */
  constructor(canvas, camera, pixelDensityCap = 1.5) {
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("Canvas2D is not available");
    this.canvas = canvas;
    this.context = context;
    this.camera = camera;
    this.width = 1;
    this.height = 1;
    this.backingScale = 1;
    this.pixelDensityCap = pixelDensityCap;
    this.sightCanvas = null;
    this.sightContext = null;
    this.sightImageData = null;
    this._fireColor = { r: 1, g: 1, b: 1 };
    this._deadBodyPose = { facing: { x: 1, z: 0 } };
    this._scorchPoint = { x: 0, z: 0 };
    this._kineticFragmentTriangle = new Float32Array(9);
  }

  /** @param {number} value */
  setPixelDensityCap(value) {
    if (![1, 1.5, 2].includes(value)) return false;
    this.pixelDensityCap = value;
    this.backingScale = 0;
    return true;
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
    this.canvas.width = Math.round(width * backingScale);
    this.canvas.height = Math.round(height * backingScale);
    this.camera.resize(width, height);
  }

  /**
   * @param {ReturnType<import('../sim/simulation.js').Simulation['snapshot']>} snapshot
   * @param {number} alpha
   * @param {{mouseWorld:{x:number,z:number},mouseInside:boolean,hover:Record<string,unknown>|null,selected:Record<string,unknown>|null,mode:string,editorTool:string,placementValid:boolean,authoringEditor?:Record<string,any>|null,sightFrame?:import('../visibility/true_sight.js').TrueSightFrame,developerToolsOpen?:boolean}} view
   * @param {boolean} [colorVariation]
   * @param {import('../presentation/scorch_marks.js').ScorchMarkPool|null} [scorchMarks]
   * @param {import('../presentation/kinetic_fragments.js').KineticFragmentPool|null} [kineticFragments]
   */
  render(
    snapshot,
    alpha,
    view,
    colorVariation = true,
    scorchMarks = null,
    kineticFragments = null,
  ) {
    this.resize();
    const context = this.context;
    const scale = this.camera.worldToViewportScale;
    const developerToolsOpen = view.developerToolsOpen !== false;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.fillStyle = COLORS.void;
    context.fillRect(0, 0, this.canvas.width, this.canvas.height);
    context.setTransform(
      this.backingScale * scale,
      0,
      0,
      this.backingScale * scale,
      this.backingScale * (this.width / 2 - this.camera.centerX * scale),
      this.backingScale * (this.height / 2 - this.camera.centerZ * scale),
    );
    context.lineCap = "round";
    context.lineJoin = "round";

    this.#drawMap(snapshot, view, developerToolsOpen);
    this.#drawAuthoringInstances(snapshot);
    if (developerToolsOpen && view.mode === "edit" && view.authoringEditor) {
      this.#drawAuthoringOverlays(snapshot, view.authoringEditor);
    }
    if (scorchMarks) this.#drawScorchMarks(scorchMarks);
    this.#drawObelisks(snapshot.obelisks ?? []);
    if (developerToolsOpen && snapshot.debugFlags.explosionForces) {
      this.#drawExplosionForces(snapshot, colorVariation);
    }
    this.#drawParticles(snapshot, colorVariation, developerToolsOpen);
    if (kineticFragments) this.#drawKineticFragments(kineticFragments, alpha);
    this.#drawRocks(snapshot, alpha, developerToolsOpen);
    this.#drawDeadBodies(snapshot, alpha, developerToolsOpen);
    this.#drawProjectiles(snapshot, colorVariation);
    this.#drawEnemies(snapshot, alpha, developerToolsOpen);
    this.#drawPlayer(snapshot, alpha, developerToolsOpen);
    this.#drawHealthBars(snapshot, alpha);
    if (developerToolsOpen && snapshot.debugFlags.contacts) {
      this.#drawContacts(snapshot.contacts);
    }
    if (developerToolsOpen) this.#drawInspection(view.hover, view.selected);
    if (view.mouseInside && view.mode !== "edit") {
      this.#drawMouse(view.mouseWorld, view.mode, view.editorTool, view.placementValid);
    }
    if (view.sightFrame) {
      this.#drawSightOverlay(view.sightFrame);
      if (developerToolsOpen && view.sightFrame.flags.sightDebug) {
        this.#drawSightDebug(view.sightFrame);
      }
    }
  }

  /** @param {import('../visibility/true_sight.js').TrueSightFrame} sightFrame */
  #drawSightOverlay(sightFrame) {
    if (
      !this.sightCanvas
      || !this.sightContext
      || !this.sightImageData
      || this.sightCanvas.width !== sightFrame.maskWidth
      || this.sightCanvas.height !== sightFrame.maskHeight
    ) {
      this.sightCanvas = typeof OffscreenCanvas === "function"
        ? new OffscreenCanvas(sightFrame.maskWidth, sightFrame.maskHeight)
        : document.createElement("canvas");
      this.sightCanvas.width = sightFrame.maskWidth;
      this.sightCanvas.height = sightFrame.maskHeight;
      this.sightContext = this.sightCanvas.getContext("2d");
      if (!this.sightContext) throw new Error("TrueSight mask canvas is unavailable");
      this.sightImageData = this.sightContext.createImageData(
        sightFrame.maskWidth,
        sightFrame.maskHeight,
      );
    }
    const pixels = this.sightImageData.data;
    for (let index = 0; index < sightFrame.displayMask.length; index += 1) {
      const offset = index * 4;
      pixels[offset] = 0;
      pixels[offset + 1] = 0;
      pixels[offset + 2] = 0;
      pixels[offset + 3] = 255 - sightFrame.displayMask[index];
    }
    this.sightContext.putImageData(this.sightImageData, 0, 0);
    this.context.save();
    this.context.globalAlpha = 1;
    this.context.imageSmoothingEnabled = true;
    this.context.drawImage(
      /** @type {CanvasImageSource} */ (this.sightCanvas),
      0,
      0,
      sightFrame.maskWidth,
      sightFrame.maskHeight,
      0,
      0,
      sightFrame.mapWidth,
      sightFrame.mapHeight,
    );
    this.context.restore();
  }

  /** @param {import('../visibility/true_sight.js').TrueSightFrame} sightFrame */
  #drawSightDebug(sightFrame) {
    const context = this.context;
    const line = this.camera.viewportLengthToWorld(1);
    context.save();
    context.globalAlpha = 1;
    context.fillStyle = "rgba(255, 92, 92, 0.2)";
    for (const cell of sightFrame.hitWallCells) {
      context.fillRect(cell.cx, cell.cz, 1, 1);
    }
    context.beginPath();
    for (const ray of sightFrame.rays) {
      context.moveTo(sightFrame.origin.x, sightFrame.origin.z);
      context.lineTo(ray.x, ray.z);
    }
    context.strokeStyle = "rgba(255, 184, 88, 0.22)";
    context.lineWidth = line;
    context.stroke();
    if (sightFrame.polygon.length > 0) {
      context.beginPath();
      context.moveTo(sightFrame.polygon[0].x, sightFrame.polygon[0].z);
      for (let index = 1; index < sightFrame.polygon.length; index += 1) {
        context.lineTo(
          sightFrame.polygon[index].x,
          sightFrame.polygon[index].z,
        );
      }
      context.closePath();
      context.strokeStyle = "rgba(108, 227, 255, 0.95)";
      context.lineWidth = line * 2;
      context.stroke();
    }
    context.beginPath();
    context.arc(
      sightFrame.origin.x,
      sightFrame.origin.z,
      line * 3,
      0,
      Math.PI * 2,
    );
    context.fillStyle = "#6ce3ff";
    context.fill();
    context.restore();
  }

  /** @param {ReturnType<import('../sim/simulation.js').Simulation['snapshot']>} snapshot @param {{hover:Record<string,unknown>|null,selected:Record<string,unknown>|null}} view @param {boolean} developerToolsOpen */
  #drawMap(snapshot, view, developerToolsOpen) {
    const context = this.context;
    const { map } = snapshot;
    context.fillStyle = COLORS.floorA;
    context.fillRect(0, 0, map.width, map.height);
    const topLeft = this.camera.viewportToWorld(0, 0);
    const bottomRight = this.camera.viewportToWorld(this.width, this.height);
    const minX = clamp(Math.floor(topLeft.x) - 1, 0, map.width - 1);
    const maxX = clamp(Math.ceil(bottomRight.x) + 1, 0, map.width - 1);
    const minZ = clamp(Math.floor(topLeft.z) - 1, 0, map.height - 1);
    const maxZ = clamp(Math.ceil(bottomRight.z) + 1, 0, map.height - 1);
    const line = this.camera.viewportLengthToWorld(1);

    for (let cz = minZ; cz <= maxZ; cz += 1) {
      for (let cx = minX; cx <= maxX; cx += 1) {
        const index = cz * map.width + cx;
        const surfaceDefinitionId = map.surface
          ? map.surface.legend[map.surface.cells[index]]
          : "surface.stone";
        const surfaceDefinition = getPlaceableDefinition(surfaceDefinitionId);
        context.fillStyle = (cx + cz) % 2 === 0
          ? surfaceDefinition?.debug.fill ?? COLORS.floorA
          : surfaceDefinition?.debug.alternateFill ?? COLORS.floorB;
        context.fillRect(cx, cz, 1, 1);
        const structureDefinitionId = map.structure
          ? map.structure.legend[map.structure.cells[index]]
          : map.cells[index] === 1
            ? "structure.wall"
            : null;
        const obeliskCell = snapshot.obelisks?.some(
          (obelisk) => obelisk.cell.cx === cx && obelisk.cell.cz === cz,
        );
        if (structureDefinitionId && !obeliskCell) {
          const structureDefinition = getPlaceableDefinition(structureDefinitionId);
          context.fillStyle = structureDefinition?.debug.fill ?? COLORS.wall;
          context.fillRect(cx + line, cz + line, 1 - line * 2, 1 - line * 2);
          context.fillStyle = COLORS.wallTop;
          context.fillRect(cx + line * 3, cz + line * 3, 1 - line * 6, 0.12);
          context.strokeStyle = structureDefinition?.debug.stroke ?? COLORS.wallEdge;
          context.lineWidth = line * 1.2;
          context.strokeRect(cx + line, cz + line, 1 - line * 2, 1 - line * 2);
        }
      }
    }

    context.beginPath();
    for (let x = minX; x <= maxX + 1; x += 1) {
      context.moveTo(x, minZ);
      context.lineTo(x, maxZ + 1);
    }
    for (let z = minZ; z <= maxZ + 1; z += 1) {
      context.moveTo(minX, z);
      context.lineTo(maxX + 1, z);
    }
    context.strokeStyle = COLORS.grid;
    context.lineWidth = line;
    context.stroke();
    context.strokeStyle = COLORS.gridMajor;
    context.lineWidth = line * 2;
    context.strokeRect(0, 0, map.width, map.height);

    if (
      developerToolsOpen
      && snapshot.debugFlags.gridCoordinates
      && this.camera.worldLengthToViewport(1) >= GRID_LABEL_MINIMUM_VIEWPORT_SIZE
    ) {
      this.#drawGridLabels(minX, maxX, minZ, maxZ);
    }

    if (developerToolsOpen) {
      context.beginPath();
      context.arc(map.playerSpawn.x, map.playerSpawn.z, 0.12, 0, Math.PI * 2);
      context.strokeStyle = COLORS.desired;
      context.lineWidth = line * 1.5;
      context.stroke();

      for (const entity of [view.hover, view.selected]) {
        if (entity?.kind !== "cell" || !entity.cell) continue;
        const cell = /** @type {{cx:number,cz:number}} */ (entity.cell);
        context.strokeStyle = entity === view.selected ? COLORS.selected : COLORS.hover;
        context.lineWidth = (entity === view.selected ? 3 : 2) * line;
        context.strokeRect(cell.cx + line * 2, cell.cz + line * 2, 1 - line * 4, 1 - line * 4);
      }
    }
  }

  /** @param {ReturnType<import('../sim/simulation.js').Simulation['snapshot']>} snapshot */
  #drawAuthoringInstances(snapshot) {
    const context = this.context;
    const line = this.camera.viewportLengthToWorld(1.5);
    for (const instance of snapshot.authoring?.instances ?? []) {
      const definition = getPlaceableDefinition(instance.definitionId);
      if (!definition || isDynamicBodyDefinition(definition)) continue;
      context.save();
      context.translate(instance.x, instance.z);
      if (definition.traits.shape === "pillar") {
        context.beginPath();
        context.ellipse(0.08, 0.12, 0.34, 0.22, 0, 0, Math.PI * 2);
        context.fillStyle = "rgba(0, 0, 0, 0.34)";
        context.fill();
        context.beginPath();
        context.arc(0, 0, 0.31, 0, Math.PI * 2);
        context.fillStyle = definition.debug.fill;
        context.fill();
        context.strokeStyle = definition.debug.stroke;
        context.lineWidth = line;
        context.stroke();
      } else if (definition.traits.shape === "standing-torch") {
        context.fillStyle = "#554735";
        context.fillRect(-0.045, -0.02, 0.09, 0.34);
        context.beginPath();
        context.arc(0, -0.09, 0.14, 0, Math.PI * 2);
        context.fillStyle = definition.debug.fill;
        context.fill();
        context.strokeStyle = definition.debug.stroke;
        context.lineWidth = line;
        context.stroke();
      }
      if (definition.debug.glyph) {
        const size = this.camera.viewportLengthToWorld(9);
        context.fillStyle = "rgba(15, 19, 16, 0.82)";
        context.font = `600 ${size}px monospace`;
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillText(definition.debug.glyph, 0, 0);
      }
      context.restore();
    }
  }

  /**
   * @param {ReturnType<import('../sim/simulation.js').Simulation['snapshot']>} snapshot
   * @param {Record<string,any>} editor
   */
  #drawAuthoringOverlays(snapshot, editor) {
    const context = this.context;
    const line = this.camera.viewportLengthToWorld(1.5);
    const drawCells = (cells, fill, stroke, width = line) => {
      context.fillStyle = fill;
      context.strokeStyle = stroke;
      context.lineWidth = width;
      for (const cell of cells) {
        context.fillRect(cell.cx + line * 1.5, cell.cz + line * 1.5, 1 - line * 3, 1 - line * 3);
        context.strokeRect(cell.cx + line * 2, cell.cz + line * 2, 1 - line * 4, 1 - line * 4);
      }
    };

    if (editor.referenceLayer) {
      const reference = editor.referenceLayer;
      const referenceCells = [];
      for (let index = 0; index < reference.structure.cells.length; index += 1) {
        const definitionId = reference.structure.legend[reference.structure.cells[index]];
        if (!definitionId) continue;
        referenceCells.push({
          cx: index % reference.width,
          cz: Math.floor(index / reference.width),
        });
      }
      for (const instance of reference.instances) {
        referenceCells.push(...(instance.occupiedCells ?? []));
      }
      context.save();
      context.setLineDash([
        this.camera.viewportLengthToWorld(5),
        this.camera.viewportLengthToWorld(4),
      ]);
      drawCells(
        referenceCells,
        "rgba(103, 165, 197, 0.035)",
        "rgba(120, 190, 224, 0.48)",
      );
      context.strokeStyle = "rgba(120, 190, 224, 0.58)";
      context.lineWidth = line;
      context.strokeRect(0, 0, reference.width, reference.height);
      context.setLineDash([]);
      context.fillStyle = "rgba(174, 217, 238, 0.84)";
      context.font = `600 ${this.camera.viewportLengthToWorld(9)}px monospace`;
      context.textAlign = "left";
      context.textBaseline = "top";
      context.fillText(
        `REF ${reference.name} · ${reference.baseY} m`,
        this.camera.viewportLengthToWorld(5),
        this.camera.viewportLengthToWorld(5),
      );
      context.restore();
    }

    if (editor.showAuthoringExtents) {
      context.save();
      context.setLineDash([
        this.camera.viewportLengthToWorld(4),
        this.camera.viewportLengthToWorld(3),
      ]);
      for (const instance of snapshot.authoring.instances) {
        const definition = getPlaceableDefinition(instance.definitionId);
        if (!definition) continue;
        const cells = getOccupiedCells(definition, instance);
        drawCells(cells, "rgba(106, 125, 112, 0.08)", "rgba(191, 211, 196, 0.72)");
        const bounds = getFootprintBounds(cells);
        if (!bounds) continue;
        const fontSize = this.camera.viewportLengthToWorld(9);
        context.setLineDash([]);
        context.font = `600 ${fontSize}px monospace`;
        context.textAlign = "center";
        context.textBaseline = "bottom";
        context.fillStyle = "rgba(239, 245, 238, 0.94)";
        context.strokeStyle = "rgba(8, 11, 9, 0.9)";
        context.lineWidth = this.camera.viewportLengthToWorld(3);
        const label = `${definition.label} · ${instance.id}`;
        context.strokeText(label, bounds.centerX, bounds.minimumZ - 0.06);
        context.fillText(label, bounds.centerX, bounds.minimumZ - 0.06);
        context.setLineDash([
          this.camera.viewportLengthToWorld(4),
          this.camera.viewportLengthToWorld(3),
        ]);
      }
      context.restore();
    }

    const hoveredCells = occupiedCellsForTarget(snapshot.authoring, editor.hoveredTarget);
    drawCells(hoveredCells, "rgba(105, 212, 179, 0.09)", COLORS.hover, line);
    const selectedCells = occupiedCellsForTarget(snapshot.authoring, editor.selectedTarget);
    drawCells(selectedCells, "rgba(255, 247, 214, 0.11)", COLORS.selected, line * 1.8);

    const preview = editor.placementPreview;
    if (preview?.occupiedCells) {
      const valid = Boolean(preview.valid);
      drawCells(
        preview.occupiedCells,
        valid ? "rgba(105, 212, 179, 0.2)" : "rgba(255, 111, 103, 0.2)",
        valid ? COLORS.hover : COLORS.blocked,
        line * 1.5,
      );
      const definition = getPlaceableDefinition(preview.definitionId);
      if (isDynamicCircleDefinition(definition) && preview.transform) {
        context.beginPath();
        context.arc(
          preview.transform.x,
          preview.transform.z,
          Number(definition.traits.radius),
          0,
          Math.PI * 2,
        );
        context.fillStyle = valid
          ? "rgba(105, 212, 179, 0.22)"
          : "rgba(255, 111, 103, 0.22)";
        context.fill();
        context.strokeStyle = valid ? COLORS.hover : COLORS.blocked;
        context.lineWidth = line * 1.5;
        context.stroke();
      }
    }
  }

  /** @param {import('../presentation/scorch_marks.js').ScorchMarkPool} scorchMarks */
  #drawScorchMarks(scorchMarks) {
    this.#drawScorchLayer(scorchMarks, "coreTriangles", SCORCH_STYLE.coreCss);
    this.#drawScorchLayer(scorchMarks, "fleckTriangles", SCORCH_STYLE.fleckCss);
  }

  /**
   * @param {import('../presentation/scorch_marks.js').ScorchMarkPool} scorchMarks
   * @param {"coreTriangles"|"fleckTriangles"} layer
   * @param {string} color
   */
  #drawScorchLayer(scorchMarks, layer, color) {
    const context = this.context;
    context.beginPath();
    let triangleCount = 0;
    for (let markIndex = 0; markIndex < scorchMarks.length; markIndex += 1) {
      const mark = scorchMarks.at(markIndex);
      if (!mark) continue;
      for (const triangle of mark[layer]) {
        let point = this.#canvasScorchPoint(mark, triangle.u0, triangle.v0);
        context.moveTo(point.x, point.z);
        point = this.#canvasScorchPoint(mark, triangle.u1, triangle.v1);
        context.lineTo(point.x, point.z);
        point = this.#canvasScorchPoint(mark, triangle.u2, triangle.v2);
        context.lineTo(point.x, point.z);
        context.closePath();
        triangleCount += 1;
      }
    }
    if (triangleCount === 0) return;
    context.fillStyle = color;
    context.fill();
  }

  /**
   * @param {NonNullable<ReturnType<import('../presentation/scorch_marks.js').ScorchMarkPool['at']>>} mark
   * @param {number} u
   * @param {number} v
   */
  #canvasScorchPoint(mark, u, v) {
    if (mark.surface.kind === "ground") {
      this._scorchPoint.x = mark.surface.x + u;
      this._scorchPoint.z = mark.surface.z + v;
      return this._scorchPoint;
    }
    const worldY = clamp(
      mark.surface.y + v,
      0,
      SCORCH_WALL_HEIGHT_METERS,
    );
    const inset = 0.04 + worldY / SCORCH_WALL_HEIGHT_METERS * 0.18;
    this._scorchPoint.x = mark.surface.x
      + mark.surface.tx * u
      - mark.surface.nx * inset;
    this._scorchPoint.z = mark.surface.z
      + mark.surface.tz * u
      - mark.surface.nz * inset;
    return this._scorchPoint;
  }

  /** @param {Array<{x:number,z:number}>} obelisks */
  #drawObelisks(obelisks) {
    const context = this.context;
    const line = this.camera.viewportLengthToWorld(1);
    for (const obelisk of obelisks) {
      const x = obelisk.x;
      const z = obelisk.z;
      context.save();
      context.translate(x, z);
      context.rotate(Math.PI / 4);
      context.fillStyle = COLORS.obeliskBase;
      context.fillRect(-0.38, -0.38, 0.76, 0.76);
      context.strokeStyle = COLORS.obeliskEdge;
      context.lineWidth = line * 1.4;
      context.strokeRect(-0.38, -0.38, 0.76, 0.76);
      context.rotate(-Math.PI / 4);
      context.beginPath();
      context.moveTo(0, -0.38);
      context.lineTo(0.25, 0);
      context.lineTo(0, 0.38);
      context.lineTo(-0.25, 0);
      context.closePath();
      context.fillStyle = COLORS.obelisk;
      context.fill();
      context.strokeStyle = COLORS.obeliskEdge;
      context.stroke();
      context.beginPath();
      context.moveTo(0, -0.24);
      context.lineTo(0, 0.24);
      context.strokeStyle = "rgba(232, 224, 255, 0.7)";
      context.lineWidth = line;
      context.stroke();
      context.restore();
    }
  }

  /** @param {ReturnType<import('../sim/simulation.js').Simulation['snapshot']>} snapshot @param {boolean} colorVariation @param {boolean} developerToolsOpen */
  #drawParticles(snapshot, colorVariation, developerToolsOpen) {
    const context = this.context;
    const line = this.camera.viewportLengthToWorld(1);
    for (const particle of snapshot.particles) {
      const life = 1 - particle.age / particle.lifetime;
      const definition = fireballDefinitionFromSnapshot(snapshot, particle);
      writeFireballPaletteColor(this._fireColor, definition, {
        kind: FIREBALL_COLOR_PARTICLE,
        life,
        effectSeed: particle.effectSeed,
        sampleOrdinal: particle.sampleOrdinal,
        sampleSeed: particle.sampleSeed,
        variationEnabled: colorVariation,
      });
      const particleColor = cssColor(this._fireColor);
      const liftedZ =
        particle.z
        - particle.y * HEIGHT_PROJECTION_GROUND_METERS_PER_VERTICAL_METER;
      context.save();
      context.globalAlpha = clamp(life * 0.45, 0, 0.45);
      context.translate(particle.x, particle.z);
      context.scale(1, 0.38);
      context.beginPath();
      context.arc(0, 0, particle.currentSize * 0.8, 0, Math.PI * 2);
      context.fillStyle = "#000000";
      context.fill();
      context.restore();
      if (developerToolsOpen && snapshot.debugFlags.particleStems) {
        context.beginPath();
        context.moveTo(particle.x, particle.z);
        context.lineTo(particle.x, liftedZ);
        context.strokeStyle = cssColor(
          this._fireColor,
          clamp(life * 0.35, 0, 0.35),
        );
        context.lineWidth = line;
        context.stroke();
      }
      context.beginPath();
      context.arc(particle.x, liftedZ, particle.currentSize, 0, Math.PI * 2);
      context.fillStyle = particleColor;
      context.globalAlpha = clamp(life, 0, 1);
      context.fill();
      context.globalAlpha = 1;
    }
  }

  /**
   * @param {import('../presentation/kinetic_fragments.js').KineticFragmentPool} pool
   * @param {number} alpha
   */
  #drawKineticFragments(pool, alpha) {
    if (pool.activeCount === 0) return;
    const context = this.context;
    const triangle = this._kineticFragmentTriangle;
    context.beginPath();
    for (let index = 0; index < pool.activeCount; index += 1) {
      writeKineticFragmentTriangle(
        pool,
        index,
        alpha,
        triangle,
        this.camera.worldToViewportScale,
      );
      context.moveTo(
        triangle[0],
        triangle[2]
          - triangle[1] * HEIGHT_PROJECTION_GROUND_METERS_PER_VERTICAL_METER,
      );
      context.lineTo(
        triangle[3],
        triangle[5]
          - triangle[4] * HEIGHT_PROJECTION_GROUND_METERS_PER_VERTICAL_METER,
      );
      context.lineTo(
        triangle[6],
        triangle[8]
          - triangle[7] * HEIGHT_PROJECTION_GROUND_METERS_PER_VERTICAL_METER,
      );
      context.closePath();
    }
    context.fillStyle = KINETIC_FRAGMENT_STYLE.css;
    context.fill();
  }

  /** @param {ReturnType<import('../sim/simulation.js').Simulation['snapshot']>} snapshot @param {number} alpha @param {boolean} developerToolsOpen */
  #drawRocks(snapshot, alpha, developerToolsOpen) {
    const context = this.context;
    const line = this.camera.viewportLengthToWorld(1);
    for (const rock of snapshot.rocks) {
      const x = rock.previousX + (rock.x - rock.previousX) * alpha;
      const z = rock.previousZ + (rock.z - rock.previousZ) * alpha;
      if (rock.kind === "table") {
        context.save();
        context.translate(x, z);
        context.rotate(rock.rotation * Math.PI / 2);
        context.fillStyle = "rgba(0, 0, 0, 0.34)";
        context.fillRect(-0.82, -0.28, 1.8, 0.72);
        context.fillStyle = "#7b5b3f";
        context.fillRect(-0.9, -0.36, 1.8, 0.72);
        context.strokeStyle = "#e0b47d";
        context.lineWidth = line * 1.5;
        context.strokeRect(-0.9, -0.36, 1.8, 0.72);
        context.fillStyle = "rgba(31, 22, 15, 0.7)";
        for (const dx of [-0.72, 0.72]) {
          for (const dz of [-0.22, 0.22]) {
            context.beginPath();
            context.arc(dx, dz, 0.045, 0, Math.PI * 2);
            context.fill();
          }
        }
        this.#drawArrow(0, 0, 0.46, 0, "#e0b47d");
        context.restore();
        if (developerToolsOpen && snapshot.debugFlags.velocityVectors) {
          this.#drawArrow(x, z, rock.vx * 0.3, rock.vz * 0.3, COLORS.velocity);
        }
        continue;
      }
      if (rock.kind === "torch") {
        context.save();
        context.translate(x, z);
        context.fillStyle = "#554735";
        context.fillRect(-0.045, -0.02, 0.09, 0.34);
        context.beginPath();
        context.arc(0, -0.09, 0.14, 0, Math.PI * 2);
        context.fillStyle = "#ef4e1f";
        context.fill();
        context.strokeStyle = "#ffd08a";
        context.lineWidth = line * 1.5;
        context.stroke();
        context.restore();
        if (developerToolsOpen && snapshot.debugFlags.velocityVectors) {
          this.#drawArrow(x, z, rock.vx * 0.3, rock.vz * 0.3, COLORS.velocity);
        }
        continue;
      }
      context.save();
      context.translate(x + rock.radius * 0.1, z + rock.radius * 0.16);
      context.scale(1, 0.52);
      context.beginPath();
      context.arc(0, 0, rock.radius * 0.95, 0, Math.PI * 2);
      context.fillStyle = "rgba(0, 0, 0, 0.35)";
      context.fill();
      context.restore();

      context.beginPath();
      context.arc(x, z, rock.radius, 0, Math.PI * 2);
      context.fillStyle = rock.archetype === "small"
        ? COLORS.rockSmall
        : rock.archetype === "medium"
          ? COLORS.rockMedium
          : COLORS.rockLarge;
      context.fill();
      context.strokeStyle = COLORS.rockEdge;
      context.lineWidth = line * 1.5;
      context.stroke();

      if (rock.radius >= 0.25) {
        context.beginPath();
        context.moveTo(x - rock.radius * 0.48, z + rock.radius * 0.05);
        context.lineTo(x - rock.radius * 0.08, z - rock.radius * 0.22);
        context.lineTo(x + rock.radius * 0.34, z - rock.radius * 0.06);
        context.strokeStyle = "rgba(35, 39, 32, 0.65)";
        context.lineWidth = line * 1.2;
        context.stroke();
      }
      if (developerToolsOpen && snapshot.debugFlags.velocityVectors) {
        this.#drawArrow(x, z, rock.vx * 0.3, rock.vz * 0.3, COLORS.velocity);
      }
    }
  }

  /** @param {ReturnType<import('../sim/simulation.js').Simulation['snapshot']>} snapshot */
  #drawExplosionForces(snapshot, colorVariation) {
    const context = this.context;
    const line = this.camera.viewportLengthToWorld(1);
    for (const event of snapshot.recentEvents) {
      if (event.type !== "explosion") continue;
      const age = snapshot.tick - event.tick;
      const visualTicks = Math.max(
        1,
        Math.round(
          Number(
            event.visualLifetime
            ?? EXPLOSION.debugTicks / SIMULATION.tickHz,
          ) * SIMULATION.tickHz,
        ),
      );
      if (age < 0 || age > visualTicks) continue;
      const life = 1 - age / visualTicks;
      const definition = fireballDefinitionFromSnapshot(snapshot, event);
      writeFireballPaletteColor(this._fireColor, definition, {
        kind: FIREBALL_COLOR_IMPACT_LIGHT,
        life,
        effectSeed: event.effectSeed,
        variationEnabled: colorVariation,
      });
      const impactColor = cssColor(this._fireColor);
      context.save();
      context.globalAlpha = 0.2 + life * 0.45;
      context.beginPath();
      context.arc(event.originX, event.originZ, event.radius, 0, Math.PI * 2);
      context.strokeStyle = impactColor;
      context.lineWidth = line * 1.5;
      context.setLineDash([line * 5, line * 4]);
      context.stroke();
      context.setLineDash([]);
      context.beginPath();
      context.arc(event.originX, event.originZ, 0.08 + (1 - life) * 0.18, 0, Math.PI * 2);
      context.fillStyle = impactColor;
      context.fill();
      for (const response of event.responses) {
        if (!response?.position) continue;
        context.beginPath();
        context.moveTo(event.originX, event.originZ);
        context.lineTo(response.position.x, response.position.z);
        context.strokeStyle = response.blocked ? COLORS.blocked : impactColor;
        context.lineWidth = response.blocked ? line * 2 : line;
        if (response.blocked) context.setLineDash([line * 3, line * 3]);
        context.stroke();
        context.setLineDash([]);
        if (!response.blocked && response.deltaVelocity) {
          this.#drawArrow(
            response.position.x,
            response.position.z,
            response.deltaVelocity.x * 0.35,
            response.deltaVelocity.z * 0.35,
            COLORS.externalVelocity,
          );
        }
      }
      context.restore();
    }
  }

  /** @param {ReturnType<import('../sim/simulation.js').Simulation['snapshot']>} snapshot */
  #drawProjectiles(snapshot, colorVariation) {
    const context = this.context;
    const line = this.camera.viewportLengthToWorld(1);
    for (const projectile of snapshot.projectiles) {
      const definition = fireballDefinitionFromSnapshot(snapshot, projectile);
      writeFireballPaletteColor(this._fireColor, definition, {
        kind: FIREBALL_COLOR_PROJECTILE,
        effectSeed: projectile.effectSeed,
        variationEnabled: colorVariation,
      });
      const projectileColor = cssColor(this._fireColor);
      context.beginPath();
      context.moveTo(projectile.previousX, projectile.previousZ);
      context.lineTo(projectile.x, projectile.z);
      context.strokeStyle = cssColor(this._fireColor, 0.6);
      context.lineWidth = line * 2;
      context.stroke();
      context.beginPath();
      context.arc(projectile.x, projectile.z, projectile.radius * 1.6, 0, Math.PI * 2);
      context.fillStyle = cssColor(this._fireColor, 0.18);
      context.fill();
      context.beginPath();
      context.arc(projectile.x, projectile.z, projectile.radius, 0, Math.PI * 2);
      context.fillStyle = projectileColor;
      context.fill();
      context.beginPath();
      context.arc(projectile.x, projectile.z, projectile.radius * 0.42, 0, Math.PI * 2);
      writeFireballPaletteColor(this._fireColor, definition, {
        kind: FIREBALL_COLOR_CORE,
        effectSeed: projectile.effectSeed,
        variationEnabled: colorVariation,
      });
      context.fillStyle = cssColor(this._fireColor);
      context.fill();
    }
  }

  /** @param {ReturnType<import('../sim/simulation.js').Simulation['snapshot']>} snapshot @param {number} alpha @param {boolean} developerToolsOpen */
  #drawPlayer(snapshot, alpha, developerToolsOpen) {
    const context = this.context;
    const player = snapshot.player;
    const x = interpolateRenderValue(player.previousX, player.x, alpha);
    const z = interpolateRenderValue(player.previousZ, player.z, alpha);
    const line = this.camera.viewportLengthToWorld(1);
    context.beginPath();
    context.arc(x, z, player.radius, 0, Math.PI * 2);
    context.fillStyle = COLORS.player;
    context.fill();
    context.strokeStyle = COLORS.playerEdge;
    context.lineWidth = line * 2;
    context.stroke();
    context.beginPath();
    context.arc(x, z, line * 2.2, 0, Math.PI * 2);
    context.fillStyle = "#302611";
    context.fill();
    if (developerToolsOpen && snapshot.debugFlags.velocityVectors) {
      this.#drawArrow(x, z, player.vx * 0.25, player.vz * 0.25, COLORS.velocity);
      this.#drawArrow(x, z, player.desiredVx * 0.25, player.desiredVz * 0.25, COLORS.desired);
      this.#drawArrow(
        x,
        z,
        player.externalVx * 0.3,
        player.externalVz * 0.3,
        COLORS.externalVelocity,
      );
    }
  }

  /** @param {ReturnType<import('../sim/simulation.js').Simulation['snapshot']>} snapshot @param {number} alpha @param {boolean} developerToolsOpen */
  #drawEnemies(snapshot, alpha, developerToolsOpen) {
    const context = this.context;
    const line = this.camera.viewportLengthToWorld(1);
    for (const enemy of snapshot.enemies ?? []) {
      if (!(enemy.health > 0)) continue;
      const x = enemy.previousX + (enemy.x - enemy.previousX) * alpha;
      const z = enemy.previousZ + (enemy.z - enemy.previousZ) * alpha;
      context.beginPath();
      context.arc(x, z, enemy.radius, 0, Math.PI * 2);
      context.fillStyle = COLORS.enemy;
      context.fill();
      context.strokeStyle = COLORS.enemyEdge;
      context.lineWidth = line * 2;
      context.stroke();
      context.beginPath();
      context.arc(x, z, line * 2.2, 0, Math.PI * 2);
      context.fillStyle = "#351318";
      context.fill();
      const marker = enemyFacingTriangle(enemy, x, z);
      context.beginPath();
      context.moveTo(marker.tip.x, marker.tip.z);
      context.lineTo(marker.left.x, marker.left.z);
      context.lineTo(marker.right.x, marker.right.z);
      context.closePath();
      context.fillStyle = COLORS.enemyEdge;
      context.fill();
      context.strokeStyle = "#5b1b22";
      context.lineWidth = line;
      context.stroke();
      if (developerToolsOpen && snapshot.debugFlags.velocityVectors) {
        this.#drawArrow(x, z, enemy.vx * 0.25, enemy.vz * 0.25, COLORS.velocity);
        this.#drawArrow(
          x,
          z,
          enemy.desiredVx * 0.25,
          enemy.desiredVz * 0.25,
          COLORS.desired,
        );
        this.#drawArrow(
          x,
          z,
          enemy.externalVx * 0.3,
          enemy.externalVz * 0.3,
          COLORS.externalVelocity,
        );
      }
    }
  }

  /** @param {ReturnType<import('../sim/simulation.js').Simulation['snapshot']>} snapshot @param {number} alpha @param {boolean} developerToolsOpen */
  #drawDeadBodies(snapshot, alpha, developerToolsOpen) {
    const context = this.context;
    const line = this.camera.viewportLengthToWorld(1);
    const inertBodies = snapshot.deadBodies?.inert ?? [];
    const dynamicBodies = snapshot.deadBodies?.dynamic ?? [];
    const bodyCount = inertBodies.length + dynamicBodies.length;
    for (let index = 0; index < bodyCount; index += 1) {
      const body = index < inertBodies.length
        ? inertBodies[index]
        : dynamicBodies[index - inertBodies.length];
      const pose = enemyDeadBodyPose(body, alpha, this._deadBodyPose);
      const radius = pose.footprintWidth / 2;
      const halfSegment = Math.max(0, (pose.footprintLength - pose.footprintWidth) / 2);
      const perpendicularX = -pose.facing.z;
      const perpendicularZ = pose.facing.x;
      const startX = pose.x - pose.facing.x * halfSegment;
      const startZ = pose.z - pose.facing.z * halfSegment;
      const endX = pose.x + pose.facing.x * halfSegment;
      const endZ = pose.z + pose.facing.z * halfSegment;
      const angle = Math.atan2(pose.facing.z, pose.facing.x);
      context.beginPath();
      context.moveTo(
        startX + perpendicularX * radius,
        startZ + perpendicularZ * radius,
      );
      context.lineTo(
        endX + perpendicularX * radius,
        endZ + perpendicularZ * radius,
      );
      context.arc(endX, endZ, radius, angle + Math.PI / 2, angle - Math.PI / 2, true);
      context.lineTo(
        startX - perpendicularX * radius,
        startZ - perpendicularZ * radius,
      );
      context.arc(
        startX,
        startZ,
        radius,
        angle - Math.PI / 2,
        angle + Math.PI / 2,
        true,
      );
      context.closePath();
      context.fillStyle = COLORS.enemyBody;
      context.fill();
      context.strokeStyle = COLORS.enemyBodyEdge;
      context.lineWidth = line * 1.5;
      context.stroke();
      if (
        developerToolsOpen
        && body.interacting
        && snapshot.debugFlags.velocityVectors
      ) {
        this.#drawArrow(
          pose.x,
          pose.z,
          body.vx * 0.25,
          body.vz * 0.25,
          COLORS.externalVelocity,
        );
      }
    }
  }

  /** @param {ReturnType<import('../sim/simulation.js').Simulation['snapshot']>} snapshot @param {number} alpha */
  #drawHealthBars(snapshot, alpha) {
    const actors = [snapshot.player, ...(snapshot.enemies ?? [])];
    const context = this.context;
    const line = this.camera.viewportLengthToWorld(1);
    for (const actor of actors) {
      if (!(actor.health > 0)) continue;
      const x = actor.previousX + (actor.x - actor.previousX) * alpha;
      const z = actor.previousZ + (actor.z - actor.previousZ) * alpha;
      const ratio = healthBarRatio(actor.health, actor.maximumHealth);
      const left = x + actor.radius + HEALTH_BAR.actorGapMeters;
      const top = z - HEALTH_BAR.heightMeters / 2;
      const fillHeight = HEALTH_BAR.heightMeters * ratio;
      context.fillStyle = colorHexCss(HEALTH_BAR.trackColor);
      context.fillRect(
        left,
        top,
        HEALTH_BAR.widthMeters,
        HEALTH_BAR.heightMeters,
      );
      context.strokeStyle = colorHexCss(HEALTH_BAR.trackEdgeColor);
      context.lineWidth = line;
      context.strokeRect(
        left,
        top,
        HEALTH_BAR.widthMeters,
        HEALTH_BAR.heightMeters,
      );
      context.fillStyle = colorHexCss(healthBarColor(ratio));
      context.fillRect(
        left,
        top + HEALTH_BAR.heightMeters - fillHeight,
        HEALTH_BAR.widthMeters,
        fillHeight,
      );
    }
  }

  /** @param {number} x @param {number} z @param {number} vx @param {number} vz @param {string} color */
  #drawArrow(x, z, vx, vz, color) {
    const length = Math.hypot(vx, vz);
    if (length < 0.015) return;
    const context = this.context;
    const nx = vx / length;
    const nz = vz / length;
    const endX = x + vx;
    const endZ = z + vz;
    const head = 0.12;
    const line = this.camera.viewportLengthToWorld(1.8);
    context.beginPath();
    context.moveTo(x, z);
    context.lineTo(endX, endZ);
    context.lineTo(endX - nx * head - nz * head * 0.55, endZ - nz * head + nx * head * 0.55);
    context.moveTo(endX, endZ);
    context.lineTo(endX - nx * head + nz * head * 0.55, endZ - nz * head - nx * head * 0.55);
    context.strokeStyle = color;
    context.lineWidth = line;
    context.stroke();
  }

  /** @param {Array<{x:number,z:number,nx:number,nz:number,penetration:number}>} contacts */
  #drawContacts(contacts) {
    const context = this.context;
    const line = this.camera.viewportLengthToWorld(2);
    for (const contact of contacts) {
      const length = Math.max(0.18, contact.penetration * 3);
      context.beginPath();
      context.moveTo(contact.x, contact.z);
      context.lineTo(contact.x + contact.nx * length, contact.z + contact.nz * length);
      context.strokeStyle = COLORS.contact;
      context.lineWidth = line;
      context.stroke();
      context.beginPath();
      context.arc(contact.x, contact.z, line * 1.6, 0, Math.PI * 2);
      context.fillStyle = COLORS.contact;
      context.fill();
    }
  }

  /** @param {Record<string,unknown>|null} hover @param {Record<string,unknown>|null} selected */
  #drawInspection(hover, selected) {
    for (const entity of [hover, selected]) {
      if (!entity || entity.kind === "cell" || !entity.position) continue;
      const position = /** @type {{x:number,z:number}} */ (entity.position);
      const radius = Number(entity.radius) || 0.16;
      const context = this.context;
      context.beginPath();
      context.arc(position.x, position.z, radius + 0.1, 0, Math.PI * 2);
      context.strokeStyle = entity === selected ? COLORS.selected : COLORS.hover;
      context.lineWidth = this.camera.viewportLengthToWorld(
        entity === selected ? 2.5 : 1.5,
      );
      context.stroke();
    }
  }

  /**
   * @param {{x:number,z:number}} mouse
   * @param {string} mode
   * @param {string} editorTool
   * @param {boolean} placementValid
   */
  #drawMouse(mouse, mode, editorTool, placementValid) {
    const context = this.context;
    const size = this.camera.viewportLengthToWorld(7);
    if (mode === "edit") {
      const definition = getPlaceableDefinition(editorTool);
      if (definition?.placementTarget === "instance") {
        const cellCentered = definition.traits.snap === "cell-center";
        const x = cellCentered
          ? Math.floor(mouse.x) + 0.5
          : Math.round(mouse.x * 10) / 10;
        const z = cellCentered
          ? Math.floor(mouse.z) + 0.5
          : Math.round(mouse.z * 10) / 10;
        const radius = Number(definition.traits.radius ?? 0.34);
        context.beginPath();
        context.arc(x, z, radius, 0, Math.PI * 2);
        context.fillStyle = placementValid ? "rgba(107, 200, 168, 0.2)" : "rgba(255, 111, 103, 0.2)";
        context.fill();
        context.strokeStyle = placementValid ? COLORS.hover : COLORS.blocked;
        context.lineWidth = this.camera.viewportLengthToWorld(1.5);
        context.stroke();
        if (definition.debug.glyph) {
          context.fillStyle = placementValid ? COLORS.hover : COLORS.blocked;
          context.font = `600 ${this.camera.viewportLengthToWorld(9)}px monospace`;
          context.textAlign = "center";
          context.textBaseline = "middle";
          context.fillText(definition.debug.glyph, x, z);
        }
        return;
      }
      const cx = Math.floor(mouse.x);
      const cz = Math.floor(mouse.z);
      context.strokeStyle = editorTool === "erase"
        ? COLORS.blocked
        : definition?.debug.stroke ?? COLORS.projectile;
      context.lineWidth = this.camera.viewportLengthToWorld(1.5);
      context.strokeRect(cx + size * 0.2, cz + size * 0.2, 1 - size * 0.4, 1 - size * 0.4);
      return;
    }
    context.beginPath();
    context.moveTo(mouse.x - size, mouse.z);
    context.lineTo(mouse.x + size, mouse.z);
    context.moveTo(mouse.x, mouse.z - size);
    context.lineTo(mouse.x, mouse.z + size);
    context.strokeStyle = COLORS.hover;
    context.lineWidth = this.camera.viewportLengthToWorld(1);
    context.stroke();
  }

  /** @param {number} minX @param {number} maxX @param {number} minZ @param {number} maxZ */
  #drawGridLabels(minX, maxX, minZ, maxZ) {
    const context = this.context;
    context.save();
    context.setTransform(
      this.backingScale,
      0,
      0,
      this.backingScale,
      0,
      0,
    );
    context.fillStyle = COLORS.text;
    context.font = GRID_LABEL_FONT;
    context.textBaseline = "top";
    for (let cz = minZ; cz <= maxZ; cz += 1) {
      for (let cx = minX; cx <= maxX; cx += 1) {
        const position = this.camera.worldToViewport(cx + 0.08, cz + 0.07);
        context.fillText(`${cx},${cz}`, position.x, position.y);
      }
    }
    context.restore();
  }
}
