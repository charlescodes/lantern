// @ts-check

import * as THREE from "three/webgpu";
import {
  positionWorld,
  texture,
  uniform,
} from "three/tsl";

export const TRUE_SIGHT_TEXTURE_CAPACITY = 256;
export const TRUE_SIGHT_TEXTURE_ALLOCATED_BYTES = (
  TRUE_SIGHT_TEXTURE_CAPACITY * TRUE_SIGHT_TEXTURE_CAPACITY
);

/** @param {number} value @param {number} minimum @param {number} maximum */
function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

/**
 * Owns the fixed-capacity CPU-to-GPU transport for the fading TrueSight mask.
 * Texture, image, storage, uniforms, and nodes remain resident for the
 * presentation lifetime.
 */
export class TrueSightTextureTransport {
  /** @param {import('../visibility/true_sight.js').TrueSightFrame|null} [initialFrame] */
  constructor(initialFrame = null) {
    this.data = new Uint8Array(TRUE_SIGHT_TEXTURE_ALLOCATED_BYTES);
    this.texture = new THREE.DataTexture(
      this.data,
      TRUE_SIGHT_TEXTURE_CAPACITY,
      TRUE_SIGHT_TEXTURE_CAPACITY,
      THREE.RedFormat,
      THREE.UnsignedByteType,
    );
    this.texture.name = "true-sight-display-mask";
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.wrapS = THREE.ClampToEdgeWrapping;
    this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.texture.generateMipmaps = false;
    this.texture.flipY = false;
    this.texture.unpackAlignment = 1;
    this.texture.colorSpace = THREE.NoColorSpace;

    this.mapSize = new THREE.Vector2(1, 1);
    this.activeMaskSize = new THREE.Vector2(1, 1);
    this.minimumActiveTexelCenter = new THREE.Vector2(0.5, 0.5);
    this.maximumActiveTexelCenter = new THREE.Vector2(0.5, 0.5);
    this.mapSizeNode = uniform(this.mapSize);
    this.activeMaskSizeNode = uniform(this.activeMaskSize);
    this.minimumActiveTexelCenterNode = uniform(
      this.minimumActiveTexelCenter,
    );
    this.maximumActiveTexelCenterNode = uniform(
      this.maximumActiveTexelCenter,
    );
    this.uvNode = positionWorld.xz
      .div(this.mapSizeNode)
      .mul(this.activeMaskSizeNode)
      .clamp(
        this.minimumActiveTexelCenterNode,
        this.maximumActiveTexelCenterNode,
      )
      .div(TRUE_SIGHT_TEXTURE_CAPACITY);
    this.opacityNode = texture(this.texture, this.uvNode).r;
    this.maskNode = this.opacityNode.greaterThan(1 / 255);

    this.activeMaskWidth = 0;
    this.activeMaskHeight = 0;
    this.mapWidth = 0;
    this.mapHeight = 0;
    this.uploadCount = 0;
    this.paddingClearCount = 0;
    this.currentFrame = null;

    if (initialFrame) this.stage(initialFrame);
  }

  /** @param {import('../visibility/true_sight.js').TrueSightFrame} frame */
  stage(frame) {
    const width = Number(frame.maskWidth);
    const height = Number(frame.maskHeight);
    const mapWidth = Number(frame.mapWidth);
    const mapHeight = Number(frame.mapHeight);
    if (
      !Number.isInteger(width)
      || !Number.isInteger(height)
      || width < 1
      || height < 1
      || width > TRUE_SIGHT_TEXTURE_CAPACITY
      || height > TRUE_SIGHT_TEXTURE_CAPACITY
    ) {
      throw new RangeError(
        `TrueSight mask ${width}x${height} exceeds the fixed `
        + `${TRUE_SIGHT_TEXTURE_CAPACITY}x${TRUE_SIGHT_TEXTURE_CAPACITY} transport`,
      );
    }
    if (
      !Number.isFinite(mapWidth)
      || !Number.isFinite(mapHeight)
      || mapWidth <= 0
      || mapHeight <= 0
    ) {
      throw new RangeError("TrueSight map dimensions must be finite and positive");
    }
    if (!(frame.displayMask instanceof Uint8Array)) {
      throw new TypeError("TrueSight display mask must be a Uint8Array");
    }
    if (frame.displayMask.length !== width * height) {
      throw new RangeError("TrueSight display mask dimensions do not match its data");
    }

    const dimensionsChanged = (
      width !== this.activeMaskWidth
      || height !== this.activeMaskHeight
    );
    if (dimensionsChanged) {
      this.data.fill(0);
      this.paddingClearCount += 1;
    }

    const source = frame.displayMask;
    for (let row = 0; row < height; row += 1) {
      const sourceOffset = row * width;
      const targetOffset = row * TRUE_SIGHT_TEXTURE_CAPACITY;
      for (let column = 0; column < width; column += 1) {
        this.data[targetOffset + column] = source[sourceOffset + column];
      }
    }

    this.activeMaskWidth = width;
    this.activeMaskHeight = height;
    this.mapWidth = mapWidth;
    this.mapHeight = mapHeight;
    this.mapSize.set(mapWidth, mapHeight);
    this.activeMaskSize.set(width, height);
    this.maximumActiveTexelCenter.set(width - 0.5, height - 0.5);
    this.currentFrame = frame;
    this.texture.needsUpdate = true;
    this.uploadCount += 1;
  }

  /**
   * Mirrors the resident TSL world-to-packed-texture transform for diagnostics
   * and regression tests.
   *
   * @param {number} x
   * @param {number} z
   * @param {{x:number,y:number}} [target]
   */
  textureUvAt(x, z, target = { x: 0, y: 0 }) {
    if (
      this.activeMaskWidth < 1
      || this.activeMaskHeight < 1
      || this.mapWidth <= 0
      || this.mapHeight <= 0
    ) {
      target.x = 0.5 / TRUE_SIGHT_TEXTURE_CAPACITY;
      target.y = 0.5 / TRUE_SIGHT_TEXTURE_CAPACITY;
      return target;
    }
    const activeX = clamp(
      (Number(x) / this.mapWidth) * this.activeMaskWidth,
      0.5,
      this.activeMaskWidth - 0.5,
    );
    const activeZ = clamp(
      (Number(z) / this.mapHeight) * this.activeMaskHeight,
      0.5,
      this.activeMaskHeight - 0.5,
    );
    target.x = activeX / TRUE_SIGHT_TEXTURE_CAPACITY;
    target.y = activeZ / TRUE_SIGHT_TEXTURE_CAPACITY;
    return target;
  }

  /**
   * Samples the packed staging data with the same clamp-to-edge linear
   * filtering used by the GPU.
   *
   * @param {number} x
   * @param {number} z
   */
  sampleVisibilityAt(x, z) {
    const worldX = Number(x);
    const worldZ = Number(z);
    if (
      this.activeMaskWidth < 1
      || this.activeMaskHeight < 1
      || !Number.isFinite(worldX)
      || !Number.isFinite(worldZ)
      || worldX < 0
      || worldZ < 0
      || worldX >= this.mapWidth
      || worldZ >= this.mapHeight
    ) return 0;

    const textureX = clamp(
      (worldX / this.mapWidth) * this.activeMaskWidth - 0.5,
      0,
      this.activeMaskWidth - 1,
    );
    const textureZ = clamp(
      (worldZ / this.mapHeight) * this.activeMaskHeight - 0.5,
      0,
      this.activeMaskHeight - 1,
    );
    const x0 = Math.floor(textureX);
    const z0 = Math.floor(textureZ);
    const x1 = Math.min(this.activeMaskWidth - 1, x0 + 1);
    const z1 = Math.min(this.activeMaskHeight - 1, z0 + 1);
    const fx = textureX - x0;
    const fz = textureZ - z0;
    const upperLeft = this.data[z0 * TRUE_SIGHT_TEXTURE_CAPACITY + x0];
    const upperRight = this.data[z0 * TRUE_SIGHT_TEXTURE_CAPACITY + x1];
    const lowerLeft = this.data[z1 * TRUE_SIGHT_TEXTURE_CAPACITY + x0];
    const lowerRight = this.data[z1 * TRUE_SIGHT_TEXTURE_CAPACITY + x1];
    const upper = upperLeft + (upperRight - upperLeft) * fx;
    const lower = lowerLeft + (lowerRight - lowerLeft) * fx;
    return (upper + (lower - upper) * fz) / 255;
  }

  diagnostics() {
    return {
      textureCapacity: {
        width: TRUE_SIGHT_TEXTURE_CAPACITY,
        height: TRUE_SIGHT_TEXTURE_CAPACITY,
      },
      activeMaskDimensions: {
        width: this.activeMaskWidth,
        height: this.activeMaskHeight,
      },
      allocatedBytes: this.data.byteLength,
      textureVersion: this.texture.version,
      uploadCount: this.uploadCount,
    };
  }
}
