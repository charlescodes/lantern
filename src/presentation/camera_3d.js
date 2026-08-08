// @ts-check

const DEFAULT_VISIBLE_HEIGHT_METERS = 24;
const MIN_VISIBLE_HEIGHT_METERS = 4;
const MAX_VISIBLE_HEIGHT_METERS = 64;
const DEFAULT_YAW_DEGREES = 45;
const DEFAULT_DOWNWARD_PITCH_DEGREES = 55;
const DEFAULT_CAMERA_DISTANCE_METERS = 64;

/** @param {number} value @param {number} minimum @param {number} maximum */
function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

/** @param {number} degrees */
function radians(degrees) {
  return degrees * Math.PI / 180;
}

export class Camera3D {
  /**
   * @param {{
   * centerX?:number,
   * centerZ?:number,
   * visibleHeightMeters?:number,
   * minimumVisibleHeightMeters?:number,
   * maximumVisibleHeightMeters?:number,
   * yawDegrees?:number,
   * downwardPitchDegrees?:number,
   * cameraDistanceMeters?:number
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
    this.yawDegrees = Number(options.yawDegrees ?? DEFAULT_YAW_DEGREES);
    this.downwardPitchDegrees = Number(
      options.downwardPitchDegrees ?? DEFAULT_DOWNWARD_PITCH_DEGREES,
    );
    this.cameraDistanceMeters = Number(
      options.cameraDistanceMeters ?? DEFAULT_CAMERA_DISTANCE_METERS,
    );
    if (
      !Number.isFinite(this.centerX)
      || !Number.isFinite(this.centerZ)
      || !Number.isFinite(this.minimumVisibleHeightMeters)
      || !Number.isFinite(this.maximumVisibleHeightMeters)
      || !Number.isFinite(this.yawDegrees)
      || !Number.isFinite(this.downwardPitchDegrees)
      || !Number.isFinite(this.cameraDistanceMeters)
      || this.minimumVisibleHeightMeters <= 0
      || this.maximumVisibleHeightMeters < this.minimumVisibleHeightMeters
      || this.downwardPitchDegrees <= 0
      || this.downwardPitchDegrees >= 90
      || this.cameraDistanceMeters <= 0
    ) {
      throw new RangeError("3D camera options must define finite metric bounds and pose");
    }
    const visibleHeightMeters = Number(
      options.visibleHeightMeters ?? DEFAULT_VISIBLE_HEIGHT_METERS,
    );
    if (!Number.isFinite(visibleHeightMeters)) {
      throw new RangeError("3D camera visible height must be finite");
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
    return this.visibleHeightMeters * this.viewportWidth / this.viewportHeight;
  }

  get yawRadians() {
    return radians(this.yawDegrees);
  }

  get downwardPitchRadians() {
    return radians(this.downwardPitchDegrees);
  }

  get groundForward() {
    return {
      x: Math.sin(this.yawRadians),
      z: Math.cos(this.yawRadians),
    };
  }

  get groundRight() {
    const forward = this.groundForward;
    return { x: -forward.z, z: forward.x };
  }

  /** @param {number} x @param {number} z */
  worldToViewport(x, z) {
    const deltaX = x - this.centerX;
    const deltaZ = z - this.centerZ;
    const forward = this.groundForward;
    const right = this.groundRight;
    const scale = this.worldToViewportScale;
    const horizontal = deltaX * right.x + deltaZ * right.z;
    const vertical = (
      deltaX * forward.x + deltaZ * forward.z
    ) * Math.sin(this.downwardPitchRadians);
    return {
      x: this.viewportWidth / 2 + horizontal * scale,
      y: this.viewportHeight / 2 - vertical * scale,
    };
  }

  /**
   * Intersects the orthographic pointer ray with the gameplay ground plane Y=0.
   * @param {number} x
   * @param {number} y
   */
  viewportToWorld(x, y) {
    const scale = this.worldToViewportScale;
    const horizontal = (x - this.viewportWidth / 2) / scale;
    const verticalProjection = (this.viewportHeight / 2 - y) / scale;
    const groundVertical = verticalProjection / Math.sin(this.downwardPitchRadians);
    const forward = this.groundForward;
    const right = this.groundRight;
    return {
      x: this.centerX + right.x * horizontal + forward.x * groundVertical,
      z: this.centerZ + right.z * horizontal + forward.z * groundVertical,
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

  /**
   * Returns a backend-neutral pose mirrored by the Three.js orthographic camera.
   */
  renderPose() {
    const forward = this.groundForward;
    const pitch = this.downwardPitchRadians;
    const direction = {
      x: Math.cos(pitch) * forward.x,
      y: -Math.sin(pitch),
      z: Math.cos(pitch) * forward.z,
    };
    return {
      left: -this.visibleWidthMeters / 2,
      right: this.visibleWidthMeters / 2,
      top: this.visibleHeightMeters / 2,
      bottom: -this.visibleHeightMeters / 2,
      near: 0.1,
      far: this.cameraDistanceMeters * 2,
      position: {
        x: this.centerX - direction.x * this.cameraDistanceMeters,
        y: -direction.y * this.cameraDistanceMeters,
        z: this.centerZ - direction.z * this.cameraDistanceMeters,
      },
      target: { x: this.centerX, y: 0, z: this.centerZ },
      direction,
    };
  }
}
