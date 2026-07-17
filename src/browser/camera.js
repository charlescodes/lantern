// @ts-check

import { WORLD } from "../config.js";

export class Camera2D {
  constructor() {
    this.centerX = WORLD.width / 2;
    this.centerZ = WORLD.height / 2;
    this.pixelsPerMeter = WORLD.pixelsPerMeter;
    this.viewportWidth = 1;
    this.viewportHeight = 1;
  }

  /** @param {number} width @param {number} height */
  resize(width, height) {
    this.viewportWidth = Math.max(1, width);
    this.viewportHeight = Math.max(1, height);
  }

  /** @param {number} x @param {number} z */
  worldToScreen(x, z) {
    return {
      x: this.viewportWidth / 2 + (x - this.centerX) * this.pixelsPerMeter,
      y: this.viewportHeight / 2 + (z - this.centerZ) * this.pixelsPerMeter,
    };
  }

  /** @param {number} x @param {number} y */
  screenToWorld(x, y) {
    return {
      x: this.centerX + (x - this.viewportWidth / 2) / this.pixelsPerMeter,
      z: this.centerZ + (y - this.viewportHeight / 2) / this.pixelsPerMeter,
    };
  }

  /** @param {number} deltaX @param {number} deltaY */
  panPixels(deltaX, deltaY) {
    this.centerX -= deltaX / this.pixelsPerMeter;
    this.centerZ -= deltaY / this.pixelsPerMeter;
  }

  /** @param {number} screenX @param {number} screenY @param {number} factor */
  zoomAt(screenX, screenY, factor) {
    const before = this.screenToWorld(screenX, screenY);
    this.pixelsPerMeter = Math.max(12, Math.min(112, this.pixelsPerMeter * factor));
    const after = this.screenToWorld(screenX, screenY);
    this.centerX += before.x - after.x;
    this.centerZ += before.z - after.z;
  }

  /** @param {number} x @param {number} z */
  focus(x, z) {
    this.centerX = x;
    this.centerZ = z;
  }
}
