// @ts-check

const DEFAULT_VISIBLE_HEIGHT_METERS = 24;
const MIN_VISIBLE_HEIGHT_METERS = 4;
const MAX_VISIBLE_HEIGHT_METERS = 64;

/** @param {number} value @param {number} minimum @param {number} maximum */
function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

export class Camera2D {
  /**
   * @param {{
   * centerX?:number,
   * centerZ?:number,
   * visibleHeightMeters?:number,
   * minimumVisibleHeightMeters?:number,
   * maximumVisibleHeightMeters?:number
   * }} [options]
   */
  constructor(options = {}) {
    this.centerX = Number(options.centerX ?? 0);
    this.centerZ = Number(options.centerZ ?? 0);
    this.minimumVisibleHeightMeters = Number(
      options.minimumVisibleHeightMeters ?? MIN_VISIBLE_HEIGHT_METERS,
    );
    this.maximumVisibleHeightMeters = Number(
      options.maximumVisibleHeightMeters ?? MAX_VISIBLE_HEIGHT_METERS,
    );
    if (
      !Number.isFinite(this.centerX)
      || !Number.isFinite(this.centerZ)
      || !Number.isFinite(this.minimumVisibleHeightMeters)
      || !Number.isFinite(this.maximumVisibleHeightMeters)
      || this.minimumVisibleHeightMeters <= 0
      || this.maximumVisibleHeightMeters < this.minimumVisibleHeightMeters
    ) {
      throw new RangeError("Camera options must define finite metric bounds");
    }
    const visibleHeightMeters = Number(
      options.visibleHeightMeters ?? DEFAULT_VISIBLE_HEIGHT_METERS,
    );
    if (!Number.isFinite(visibleHeightMeters)) {
      throw new RangeError("Camera visible height must be finite");
    }
    this.visibleHeightMeters = clamp(
      visibleHeightMeters,
      this.minimumVisibleHeightMeters,
      this.maximumVisibleHeightMeters,
    );
    this.viewportWidth = 1;
    this.viewportHeight = 1;
  }

  /** @param {number} width @param {number} height */
  resize(width, height) {
    this.viewportWidth = Math.max(1, width);
    this.viewportHeight = Math.max(1, height);
  }

  get worldToViewportScale() {
    return this.viewportHeight / this.visibleHeightMeters;
  }

  get visibleWidthMeters() {
    return this.viewportWidth / this.worldToViewportScale;
  }

  /** @param {number} x @param {number} z */
  worldToViewport(x, z) {
    const scale = this.worldToViewportScale;
    return {
      x: this.viewportWidth / 2 + (x - this.centerX) * scale,
      y: this.viewportHeight / 2 + (z - this.centerZ) * scale,
    };
  }

  /** @param {number} x @param {number} y */
  viewportToWorld(x, y) {
    const scale = this.worldToViewportScale;
    return {
      x: this.centerX + (x - this.viewportWidth / 2) / scale,
      z: this.centerZ + (y - this.viewportHeight / 2) / scale,
    };
  }

  /** @param {number} meters */
  worldLengthToViewport(meters) {
    return meters * this.worldToViewportScale;
  }

  /** @param {number} viewportLength */
  viewportLengthToWorld(viewportLength) {
    return viewportLength / this.worldToViewportScale;
  }

  /** @param {number} deltaX @param {number} deltaZ */
  panByWorld(deltaX, deltaZ) {
    this.centerX += deltaX;
    this.centerZ += deltaZ;
  }

  /** @param {number} viewportX @param {number} viewportY @param {number} factor */
  zoomAtViewport(viewportX, viewportY, factor) {
    const before = this.viewportToWorld(viewportX, viewportY);
    if (!this.zoomByFactor(factor)) return false;
    const after = this.viewportToWorld(viewportX, viewportY);
    this.centerX += before.x - after.x;
    this.centerZ += before.z - after.z;
    return true;
  }

  /** @param {number} factor */
  zoomByFactor(factor) {
    if (!Number.isFinite(factor) || factor <= 0) return false;
    this.visibleHeightMeters = clamp(
      this.visibleHeightMeters / factor,
      this.minimumVisibleHeightMeters,
      this.maximumVisibleHeightMeters,
    );
    return true;
  }

  /** @param {number} x @param {number} z */
  focus(x, z) {
    this.centerX = x;
    this.centerZ = z;
  }
}
