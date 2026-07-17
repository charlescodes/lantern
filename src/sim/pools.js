// @ts-check

export class ProjectilePool {
  /** @param {number} capacity */
  constructor(capacity) {
    this.capacity = capacity;
    this.activeCount = 0;
    this.dropped = 0;
    this.nextId = 1;
    this.id = new Uint32Array(capacity);
    this.x = new Float32Array(capacity);
    this.z = new Float32Array(capacity);
    this.previousX = new Float32Array(capacity);
    this.previousZ = new Float32Array(capacity);
    this.vx = new Float32Array(capacity);
    this.vz = new Float32Array(capacity);
    this.age = new Float32Array(capacity);
    this.lifetime = new Float32Array(capacity);
    this.radius = new Float32Array(capacity);
  }

  reset() {
    this.activeCount = 0;
    this.dropped = 0;
    this.nextId = 1;
  }

  /** @param {{x:number,z:number,vx:number,vz:number,lifetime:number,radius:number}} value */
  spawn(value) {
    if (this.activeCount >= this.capacity) {
      this.dropped += 1;
      return 0;
    }
    const index = this.activeCount;
    const id = this.nextId;
    this.nextId = (this.nextId + 1) >>> 0 || 1;
    this.id[index] = id;
    this.x[index] = value.x;
    this.z[index] = value.z;
    this.previousX[index] = value.x;
    this.previousZ[index] = value.z;
    this.vx[index] = value.vx;
    this.vz[index] = value.vz;
    this.age[index] = 0;
    this.lifetime[index] = value.lifetime;
    this.radius[index] = value.radius;
    this.activeCount += 1;
    return id;
  }

  /** @param {number} index */
  removeSwap(index) {
    if (index < 0 || index >= this.activeCount) return false;
    const last = this.activeCount - 1;
    if (index !== last) {
      this.id[index] = this.id[last];
      this.x[index] = this.x[last];
      this.z[index] = this.z[last];
      this.previousX[index] = this.previousX[last];
      this.previousZ[index] = this.previousZ[last];
      this.vx[index] = this.vx[last];
      this.vz[index] = this.vz[last];
      this.age[index] = this.age[last];
      this.lifetime[index] = this.lifetime[last];
      this.radius[index] = this.radius[last];
    }
    this.activeCount = last;
    return true;
  }

  /** @param {number} id */
  findIndexById(id) {
    for (let index = 0; index < this.activeCount; index += 1) {
      if (this.id[index] === id) return index;
    }
    return -1;
  }
}

export class ParticlePool {
  /** @param {number} capacity */
  constructor(capacity) {
    this.capacity = capacity;
    this.activeCount = 0;
    this.dropped = 0;
    this.nextId = 1;
    this.id = new Uint32Array(capacity);
    this.x = new Float32Array(capacity);
    this.y = new Float32Array(capacity);
    this.z = new Float32Array(capacity);
    this.vx = new Float32Array(capacity);
    this.vy = new Float32Array(capacity);
    this.vz = new Float32Array(capacity);
    this.age = new Float32Array(capacity);
    this.lifetime = new Float32Array(capacity);
    this.size = new Float32Array(capacity);
    this.bounced = new Uint8Array(capacity);
  }

  reset() {
    this.activeCount = 0;
    this.dropped = 0;
    this.nextId = 1;
  }

  /** @param {{x:number,y:number,z:number,vx:number,vy:number,vz:number,lifetime:number,size:number}} value */
  spawn(value) {
    if (this.activeCount >= this.capacity) {
      this.dropped += 1;
      return 0;
    }
    const index = this.activeCount;
    const id = this.nextId;
    this.nextId = (this.nextId + 1) >>> 0 || 1;
    this.id[index] = id;
    this.x[index] = value.x;
    this.y[index] = value.y;
    this.z[index] = value.z;
    this.vx[index] = value.vx;
    this.vy[index] = value.vy;
    this.vz[index] = value.vz;
    this.age[index] = 0;
    this.lifetime[index] = value.lifetime;
    this.size[index] = value.size;
    this.bounced[index] = 0;
    this.activeCount += 1;
    return id;
  }

  /** @param {number} index */
  removeSwap(index) {
    if (index < 0 || index >= this.activeCount) return false;
    const last = this.activeCount - 1;
    if (index !== last) {
      this.id[index] = this.id[last];
      this.x[index] = this.x[last];
      this.y[index] = this.y[last];
      this.z[index] = this.z[last];
      this.vx[index] = this.vx[last];
      this.vy[index] = this.vy[last];
      this.vz[index] = this.vz[last];
      this.age[index] = this.age[last];
      this.lifetime[index] = this.lifetime[last];
      this.size[index] = this.size[last];
      this.bounced[index] = this.bounced[last];
    }
    this.activeCount = last;
    return true;
  }

  /** @param {number} id */
  findIndexById(id) {
    for (let index = 0; index < this.activeCount; index += 1) {
      if (this.id[index] === id) return index;
    }
    return -1;
  }
}
