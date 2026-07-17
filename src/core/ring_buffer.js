// @ts-check

export class RingBuffer {
  /** @param {number} capacity */
  constructor(capacity) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new RangeError("RingBuffer capacity must be a positive integer");
    }
    this.capacity = capacity;
    this.values = new Array(capacity);
    this.start = 0;
    this.length = 0;
  }

  /** @param {unknown} value */
  push(value) {
    const index = (this.start + this.length) % this.capacity;
    this.values[index] = value;
    if (this.length < this.capacity) {
      this.length += 1;
      return;
    }
    this.start = (this.start + 1) % this.capacity;
  }

  clear() {
    this.values.fill(undefined);
    this.start = 0;
    this.length = 0;
  }

  /** @param {number} [limit] */
  toArray(limit = this.length) {
    const count = Math.max(0, Math.min(this.length, Math.trunc(limit)));
    const offset = this.length - count;
    const result = new Array(count);
    for (let index = 0; index < count; index += 1) {
      result[index] = this.values[(this.start + offset + index) % this.capacity];
    }
    return result;
  }
}

export class NumericRingBuffer {
  /** @param {number} capacity */
  constructor(capacity) {
    this.capacity = capacity;
    this.values = new Float64Array(capacity);
    this.start = 0;
    this.length = 0;
  }

  /** @param {number} value */
  push(value) {
    const index = (this.start + this.length) % this.capacity;
    this.values[index] = value;
    if (this.length < this.capacity) {
      this.length += 1;
      return;
    }
    this.start = (this.start + 1) % this.capacity;
  }

  clear() {
    this.start = 0;
    this.length = 0;
  }

  toSortedArray() {
    const result = new Array(this.length);
    for (let index = 0; index < this.length; index += 1) {
      result[index] = this.values[(this.start + index) % this.capacity];
    }
    return result.sort((a, b) => a - b);
  }
}

/** @param {number[]} sortedValues @param {number} percentile */
export function percentile(sortedValues, percentile) {
  if (sortedValues.length === 0) return 0;
  const index = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.ceil(percentile * sortedValues.length) - 1),
  );
  return sortedValues[index];
}
