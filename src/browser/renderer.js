// @ts-check

import { EXPLOSION, ROCK_ARCHETYPES } from "../config.js";

const COLORS = Object.freeze({
  void: "#090c0b",
  floorA: "#111714",
  floorB: "#131b17",
  grid: "#26332b",
  gridMajor: "#3d4c40",
  wall: "#344137",
  wallEdge: "#8ca377",
  wallTop: "#455547",
  player: "#f3c969",
  playerEdge: "#fff2bd",
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
   * @param {{mouseWorld:{x:number,z:number},mouseInside:boolean,hover:Record<string,unknown>|null,selected:Record<string,unknown>|null,mode:string,editorTool:string,placementValid:boolean,sightFrame?:import('../visibility/true_sight.js').TrueSightFrame}} view
   */
  render(snapshot, alpha, view) {
    this.resize();
    const context = this.context;
    const scale = this.camera.worldToViewportScale;
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

    this.#drawMap(snapshot, view);
    if (snapshot.debugFlags.explosionForces) this.#drawExplosionForces(snapshot);
    this.#drawParticles(snapshot);
    this.#drawRocks(snapshot, alpha);
    this.#drawProjectiles(snapshot);
    this.#drawPlayer(snapshot, alpha);
    if (snapshot.debugFlags.contacts) this.#drawContacts(snapshot.contacts);
    this.#drawInspection(view.hover, view.selected);
    if (view.mouseInside) {
      this.#drawMouse(view.mouseWorld, view.mode, view.editorTool, view.placementValid);
    }
    if (view.sightFrame) {
      this.#drawSightOverlay(view.sightFrame);
      if (view.sightFrame.flags.sightDebug) {
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

  /** @param {ReturnType<import('../sim/simulation.js').Simulation['snapshot']>} snapshot @param {{hover:Record<string,unknown>|null,selected:Record<string,unknown>|null}} view */
  #drawMap(snapshot, view) {
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
        const tile = map.cells[cz * map.width + cx];
        if (tile === 0) {
          context.fillStyle = (cx + cz) % 2 === 0 ? COLORS.floorA : COLORS.floorB;
          context.fillRect(cx, cz, 1, 1);
        } else {
          context.fillStyle = COLORS.wall;
          context.fillRect(cx + line, cz + line, 1 - line * 2, 1 - line * 2);
          context.fillStyle = COLORS.wallTop;
          context.fillRect(cx + line * 3, cz + line * 3, 1 - line * 6, 0.12);
          context.strokeStyle = COLORS.wallEdge;
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
      snapshot.debugFlags.gridCoordinates
      && this.camera.worldLengthToViewport(1) >= GRID_LABEL_MINIMUM_VIEWPORT_SIZE
    ) {
      this.#drawGridLabels(minX, maxX, minZ, maxZ);
    }

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

  /** @param {ReturnType<import('../sim/simulation.js').Simulation['snapshot']>} snapshot */
  #drawParticles(snapshot) {
    const context = this.context;
    const line = this.camera.viewportLengthToWorld(1);
    for (const particle of snapshot.particles) {
      const life = 1 - particle.age / particle.lifetime;
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
      if (snapshot.debugFlags.particleStems) {
        context.beginPath();
        context.moveTo(particle.x, particle.z);
        context.lineTo(particle.x, liftedZ);
        context.strokeStyle = `rgba(255, 155, 70, ${clamp(life * 0.35, 0, 0.35)})`;
        context.lineWidth = line;
        context.stroke();
      }
      context.beginPath();
      context.arc(particle.x, liftedZ, particle.currentSize, 0, Math.PI * 2);
      context.fillStyle = life > 0.55 ? COLORS.particle : COLORS.projectile;
      context.globalAlpha = clamp(life, 0, 1);
      context.fill();
      context.globalAlpha = 1;
    }
  }

  /** @param {ReturnType<import('../sim/simulation.js').Simulation['snapshot']>} snapshot @param {number} alpha */
  #drawRocks(snapshot, alpha) {
    const context = this.context;
    const line = this.camera.viewportLengthToWorld(1);
    for (const rock of snapshot.rocks) {
      const x = rock.previousX + (rock.x - rock.previousX) * alpha;
      const z = rock.previousZ + (rock.z - rock.previousZ) * alpha;
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
      if (snapshot.debugFlags.velocityVectors) {
        this.#drawArrow(x, z, rock.vx * 0.3, rock.vz * 0.3, COLORS.velocity);
      }
    }
  }

  /** @param {ReturnType<import('../sim/simulation.js').Simulation['snapshot']>} snapshot */
  #drawExplosionForces(snapshot) {
    const context = this.context;
    const line = this.camera.viewportLengthToWorld(1);
    for (const event of snapshot.recentEvents) {
      if (event.type !== "explosion") continue;
      const age = snapshot.tick - event.tick;
      if (age < 0 || age > EXPLOSION.debugTicks) continue;
      const life = 1 - age / EXPLOSION.debugTicks;
      context.save();
      context.globalAlpha = 0.2 + life * 0.45;
      context.beginPath();
      context.arc(event.originX, event.originZ, event.radius, 0, Math.PI * 2);
      context.strokeStyle = COLORS.explosion;
      context.lineWidth = line * 1.5;
      context.setLineDash([line * 5, line * 4]);
      context.stroke();
      context.setLineDash([]);
      context.beginPath();
      context.arc(event.originX, event.originZ, 0.08 + (1 - life) * 0.18, 0, Math.PI * 2);
      context.fillStyle = COLORS.explosion;
      context.fill();
      for (const response of event.responses) {
        if (!response?.position) continue;
        context.beginPath();
        context.moveTo(event.originX, event.originZ);
        context.lineTo(response.position.x, response.position.z);
        context.strokeStyle = response.blocked ? COLORS.blocked : COLORS.explosion;
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
  #drawProjectiles(snapshot) {
    const context = this.context;
    const line = this.camera.viewportLengthToWorld(1);
    for (const projectile of snapshot.projectiles) {
      context.beginPath();
      context.moveTo(projectile.previousX, projectile.previousZ);
      context.lineTo(projectile.x, projectile.z);
      context.strokeStyle = "rgba(255, 126, 69, 0.6)";
      context.lineWidth = line * 2;
      context.stroke();
      context.beginPath();
      context.arc(projectile.x, projectile.z, projectile.radius * 1.6, 0, Math.PI * 2);
      context.fillStyle = "rgba(255, 91, 47, 0.18)";
      context.fill();
      context.beginPath();
      context.arc(projectile.x, projectile.z, projectile.radius, 0, Math.PI * 2);
      context.fillStyle = COLORS.projectile;
      context.fill();
      context.beginPath();
      context.arc(projectile.x, projectile.z, projectile.radius * 0.42, 0, Math.PI * 2);
      context.fillStyle = COLORS.projectileCore;
      context.fill();
    }
  }

  /** @param {ReturnType<import('../sim/simulation.js').Simulation['snapshot']>} snapshot @param {number} alpha */
  #drawPlayer(snapshot, alpha) {
    const context = this.context;
    const player = snapshot.player;
    const x = player.previousX + (player.x - player.previousX) * alpha;
    const z = player.previousZ + (player.z - player.previousZ) * alpha;
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
    if (snapshot.debugFlags.velocityVectors) {
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
      const definition = Object.hasOwn(ROCK_ARCHETYPES, editorTool)
        ? ROCK_ARCHETYPES[editorTool]
        : null;
      if (definition) {
        const x = Math.round(mouse.x * 10) / 10;
        const z = Math.round(mouse.z * 10) / 10;
        context.beginPath();
        context.arc(x, z, definition.radius, 0, Math.PI * 2);
        context.fillStyle = placementValid ? "rgba(107, 200, 168, 0.2)" : "rgba(255, 111, 103, 0.2)";
        context.fill();
        context.strokeStyle = placementValid ? COLORS.hover : COLORS.blocked;
        context.lineWidth = this.camera.viewportLengthToWorld(1.5);
        context.stroke();
        return;
      }
      const cx = Math.floor(mouse.x);
      const cz = Math.floor(mouse.z);
      context.strokeStyle = editorTool === "erase" ? COLORS.blocked : COLORS.projectile;
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
