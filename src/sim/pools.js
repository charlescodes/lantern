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
    this.ownerId = new Uint32Array(capacity);
    this.ownerKind = new Uint8Array(capacity);
    this.ownerTeam = new Uint8Array(capacity);
    this.spellCode = new Uint8Array(capacity);
    this.definitionRevision = new Uint32Array(capacity);
    this.effectId = new Uint32Array(capacity);
    this.effectSeed = new Uint32Array(capacity);
  }

  reset() {
    this.activeCount = 0;
    this.dropped = 0;
    this.nextId = 1;
  }

  /** @param {{x:number,z:number,vx:number,vz:number,lifetime:number,radius:number,ownerId?:number,ownerKind?:number,ownerTeam?:number,spellCode?:number,definitionRevision?:number,effectId?:number,effectSeed?:number}} value */
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
    this.ownerId[index] = value.ownerId ?? 0;
    this.ownerKind[index] = value.ownerKind ?? 1;
    this.ownerTeam[index] = value.ownerTeam ?? 1;
    this.spellCode[index] = value.spellCode ?? 0;
    this.definitionRevision[index] = value.definitionRevision ?? 0;
    this.effectId[index] = value.effectId ?? 0;
    this.effectSeed[index] = value.effectSeed ?? 0;
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
      this.ownerId[index] = this.ownerId[last];
      this.ownerKind[index] = this.ownerKind[last];
      this.ownerTeam[index] = this.ownerTeam[last];
      this.spellCode[index] = this.spellCode[last];
      this.definitionRevision[index] = this.definitionRevision[last];
      this.effectId[index] = this.effectId[last];
      this.effectSeed[index] = this.effectSeed[last];
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

export class EnemyWizardPool {
  /** @param {number} capacity */
  constructor(capacity) {
    this.capacity = capacity;
    this.activeCount = 0;
    this.dropped = 0;
    this.nextId = 1;
    this.id = new Uint32Array(capacity);
    this.spawnSequence = new Uint32Array(capacity);
    this.spawnTick = new Uint32Array(capacity);
    this.x = new Float32Array(capacity);
    this.z = new Float32Array(capacity);
    this.previousX = new Float32Array(capacity);
    this.previousZ = new Float32Array(capacity);
    this.vx = new Float32Array(capacity);
    this.vz = new Float32Array(capacity);
    this.desiredVx = new Float32Array(capacity);
    this.desiredVz = new Float32Array(capacity);
    this.locomotionVx = new Float32Array(capacity);
    this.locomotionVz = new Float32Array(capacity);
    this.externalVx = new Float32Array(capacity);
    this.externalVz = new Float32Array(capacity);
    this.radius = new Float32Array(capacity);
    this.massKg = new Float32Array(capacity);
    this.inverseMass = new Float32Array(capacity);
    this.health = new Float32Array(capacity);
    this.maximumHealth = new Float32Array(capacity);
    this.damageFreeTicks = new Uint32Array(capacity);
    this.lastDamageTick = new Uint32Array(capacity);
    this.cooldown = new Float32Array(capacity);
    this.castSequence = new Uint32Array(capacity);
    this.shotReadyTick = new Uint32Array(capacity);
    this.aiState = new Uint8Array(capacity);
    this.lineOfSight = new Uint8Array(capacity);
    this.movementGoalKind = new Uint8Array(capacity);
    this.movementGoalX = new Float32Array(capacity);
    this.movementGoalZ = new Float32Array(capacity);
    this.movementGoalCx = new Int16Array(capacity);
    this.movementGoalCz = new Int16Array(capacity);
    this.navigationCost = new Uint32Array(capacity);
    this.navigationVersion = new Uint32Array(capacity);
    this.strafeDirection = new Int8Array(capacity);
    this.strafeChangeTick = new Uint32Array(capacity);
    this.strafeDecisionSequence = new Uint32Array(capacity);
    this.predictedAimX = new Float32Array(capacity);
    this.predictedAimZ = new Float32Array(capacity);
    this.aimInterceptTime = new Float32Array(capacity);
    this.aimLeadTime = new Float32Array(capacity);
    this.trackedThreatEffectId = new Uint32Array(capacity);
    this.trackedThreatProjectileId = new Uint32Array(capacity);
    this.dodgeTicksRemaining = new Uint16Array(capacity);
    this.dodgeCooldownTicks = new Uint16Array(capacity);
    this.dodgeDirectionX = new Float32Array(capacity);
    this.dodgeDirectionZ = new Float32Array(capacity);
    this.dodgeSide = new Int8Array(capacity);
    this.retreating = new Uint8Array(capacity);
    this.perceptionState = new Uint8Array(capacity);
    this.knowledgeSource = new Uint8Array(capacity);
    this.perceptionLane = new Uint8Array(capacity);
    this.currentVisibility = new Uint8Array(capacity);
    this.visibilitySampleTick = new Uint32Array(capacity);
    this.exposureStartTick = new Uint32Array(capacity);
    this.exposureProgress = new Uint16Array(capacity);
    this.noticingResumeState = new Uint8Array(capacity);
    this.candidateTargetKind = new Uint8Array(capacity);
    this.candidateTargetId = new Uint32Array(capacity);
    this.candidateTargetTeam = new Uint8Array(capacity);
    this.confirmedTargetKind = new Uint8Array(capacity);
    this.confirmedTargetId = new Uint32Array(capacity);
    this.confirmedTargetTeam = new Uint8Array(capacity);
    this.facingX = new Float32Array(capacity);
    this.facingZ = new Float32Array(capacity);
    this.guardX = new Float32Array(capacity);
    this.guardZ = new Float32Array(capacity);
    this.guardBaseFacingX = new Float32Array(capacity);
    this.guardBaseFacingZ = new Float32Array(capacity);
    this.guardSweepPhase = new Uint16Array(capacity);
    this.guardReturnStartTick = new Uint32Array(capacity);
    this.guardUnreachableStartTick = new Uint32Array(capacity);
    this.hasLastSeen = new Uint8Array(capacity);
    this.lastSeenX = new Float32Array(capacity);
    this.lastSeenZ = new Float32Array(capacity);
    this.lastSeenVx = new Float32Array(capacity);
    this.lastSeenVz = new Float32Array(capacity);
    this.lastSeenTick = new Uint32Array(capacity);
    this.huntPhase = new Uint8Array(capacity);
    this.huntAnchorX = new Float32Array(capacity);
    this.huntAnchorZ = new Float32Array(capacity);
    this.huntTravelStartTick = new Uint32Array(capacity);
    this.searchStartTick = new Uint32Array(capacity);
    this.searchEndTick = new Uint32Array(capacity);
    this.hasSearchGoal = new Uint8Array(capacity);
    this.searchGoalX = new Float32Array(capacity);
    this.searchGoalZ = new Float32Array(capacity);
    this.searchGoalCx = new Int16Array(capacity);
    this.searchGoalCz = new Int16Array(capacity);
    this.searchGoalStartTick = new Uint32Array(capacity);
    this.searchSequence = new Uint16Array(capacity);
    this.hasStimulus = new Uint8Array(capacity);
    this.stimulusX = new Float32Array(capacity);
    this.stimulusZ = new Float32Array(capacity);
    this.stimulusTick = new Uint32Array(capacity);
    this.navigationSlot = new Int16Array(capacity);
  }

  reset() {
    this.activeCount = 0;
    this.dropped = 0;
    this.nextId = 1;
  }

  /** @param {{spawnSequence:number,spawnTick:number,x:number,z:number,radius:number,massKg:number,maximumHealth:number,shotReadyTick:number,facingX?:number,facingZ?:number,guardX?:number,guardZ?:number,guardBaseFacingX?:number,guardBaseFacingZ?:number,perceptionLane?:number,guardSweepPhase?:number}} value */
  spawn(value) {
    if (this.activeCount >= this.capacity) {
      this.dropped += 1;
      return 0;
    }
    const index = this.activeCount;
    const id = this.nextId;
    this.nextId = (this.nextId + 1) >>> 0 || 1;
    this.id[index] = id;
    this.spawnSequence[index] = value.spawnSequence;
    this.spawnTick[index] = value.spawnTick;
    this.x[index] = value.x;
    this.z[index] = value.z;
    this.previousX[index] = value.x;
    this.previousZ[index] = value.z;
    this.vx[index] = 0;
    this.vz[index] = 0;
    this.desiredVx[index] = 0;
    this.desiredVz[index] = 0;
    this.locomotionVx[index] = 0;
    this.locomotionVz[index] = 0;
    this.externalVx[index] = 0;
    this.externalVz[index] = 0;
    this.radius[index] = value.radius;
    this.massKg[index] = value.massKg;
    this.inverseMass[index] = 1 / value.massKg;
    this.health[index] = value.maximumHealth;
    this.maximumHealth[index] = value.maximumHealth;
    this.damageFreeTicks[index] = 0;
    this.lastDamageTick[index] = 0;
    this.cooldown[index] = 0;
    this.castSequence[index] = 0;
    this.shotReadyTick[index] = value.shotReadyTick;
    this.aiState[index] = 0;
    this.lineOfSight[index] = 0;
    this.movementGoalKind[index] = 0;
    this.movementGoalX[index] = Number.NaN;
    this.movementGoalZ[index] = Number.NaN;
    this.movementGoalCx[index] = -1;
    this.movementGoalCz[index] = -1;
    this.navigationCost[index] = 0xffff_ffff;
    this.navigationVersion[index] = 0;
    this.strafeDirection[index] = 0;
    this.strafeChangeTick[index] = 0;
    this.strafeDecisionSequence[index] = 0;
    this.predictedAimX[index] = Number.NaN;
    this.predictedAimZ[index] = Number.NaN;
    this.aimInterceptTime[index] = 0;
    this.aimLeadTime[index] = 0;
    this.trackedThreatEffectId[index] = 0;
    this.trackedThreatProjectileId[index] = 0;
    this.dodgeTicksRemaining[index] = 0;
    this.dodgeCooldownTicks[index] = 0;
    this.dodgeDirectionX[index] = 0;
    this.dodgeDirectionZ[index] = 0;
    this.dodgeSide[index] = 0;
    this.retreating[index] = 0;
    this.perceptionState[index] = 0;
    this.knowledgeSource[index] = 0;
    this.perceptionLane[index] = value.perceptionLane ?? 0;
    this.currentVisibility[index] = 0;
    this.visibilitySampleTick[index] = 0;
    this.exposureStartTick[index] = 0;
    this.exposureProgress[index] = 0;
    this.noticingResumeState[index] = 0;
    this.candidateTargetKind[index] = 0;
    this.candidateTargetId[index] = 0;
    this.candidateTargetTeam[index] = 0;
    this.confirmedTargetKind[index] = 0;
    this.confirmedTargetId[index] = 0;
    this.confirmedTargetTeam[index] = 0;
    const facingLength = Math.hypot(value.facingX ?? 1, value.facingZ ?? 0);
    this.facingX[index] = facingLength > 1e-9 ? (value.facingX ?? 1) / facingLength : 1;
    this.facingZ[index] = facingLength > 1e-9 ? (value.facingZ ?? 0) / facingLength : 0;
    this.guardX[index] = value.guardX ?? value.x;
    this.guardZ[index] = value.guardZ ?? value.z;
    const guardFacingLength = Math.hypot(
      value.guardBaseFacingX ?? this.facingX[index],
      value.guardBaseFacingZ ?? this.facingZ[index],
    );
    this.guardBaseFacingX[index] = guardFacingLength > 1e-9
      ? (value.guardBaseFacingX ?? this.facingX[index]) / guardFacingLength
      : 1;
    this.guardBaseFacingZ[index] = guardFacingLength > 1e-9
      ? (value.guardBaseFacingZ ?? this.facingZ[index]) / guardFacingLength
      : 0;
    this.guardSweepPhase[index] = value.guardSweepPhase ?? 0;
    this.guardReturnStartTick[index] = 0;
    this.guardUnreachableStartTick[index] = 0;
    this.hasLastSeen[index] = 0;
    this.lastSeenX[index] = Number.NaN;
    this.lastSeenZ[index] = Number.NaN;
    this.lastSeenVx[index] = 0;
    this.lastSeenVz[index] = 0;
    this.lastSeenTick[index] = 0;
    this.huntPhase[index] = 0;
    this.huntAnchorX[index] = Number.NaN;
    this.huntAnchorZ[index] = Number.NaN;
    this.huntTravelStartTick[index] = 0;
    this.searchStartTick[index] = 0;
    this.searchEndTick[index] = 0;
    this.hasSearchGoal[index] = 0;
    this.searchGoalX[index] = Number.NaN;
    this.searchGoalZ[index] = Number.NaN;
    this.searchGoalCx[index] = -1;
    this.searchGoalCz[index] = -1;
    this.searchGoalStartTick[index] = 0;
    this.searchSequence[index] = 0;
    this.hasStimulus[index] = 0;
    this.stimulusX[index] = Number.NaN;
    this.stimulusZ[index] = Number.NaN;
    this.stimulusTick[index] = 0;
    this.navigationSlot[index] = -1;
    this.activeCount += 1;
    return id;
  }

  /** @param {number} index */
  removeSwap(index) {
    if (index < 0 || index >= this.activeCount) return false;
    const last = this.activeCount - 1;
    if (index !== last) {
      for (const component of [
        this.id,
        this.spawnSequence,
        this.spawnTick,
        this.x,
        this.z,
        this.previousX,
        this.previousZ,
        this.vx,
        this.vz,
        this.desiredVx,
        this.desiredVz,
        this.locomotionVx,
        this.locomotionVz,
        this.externalVx,
        this.externalVz,
        this.radius,
        this.massKg,
        this.inverseMass,
        this.health,
        this.maximumHealth,
        this.damageFreeTicks,
        this.lastDamageTick,
        this.cooldown,
        this.castSequence,
        this.shotReadyTick,
        this.aiState,
        this.lineOfSight,
        this.movementGoalKind,
        this.movementGoalX,
        this.movementGoalZ,
        this.movementGoalCx,
        this.movementGoalCz,
        this.navigationCost,
        this.navigationVersion,
        this.strafeDirection,
        this.strafeChangeTick,
        this.strafeDecisionSequence,
        this.predictedAimX,
        this.predictedAimZ,
        this.aimInterceptTime,
        this.aimLeadTime,
        this.trackedThreatEffectId,
        this.trackedThreatProjectileId,
        this.dodgeTicksRemaining,
        this.dodgeCooldownTicks,
        this.dodgeDirectionX,
        this.dodgeDirectionZ,
        this.dodgeSide,
        this.retreating,
        this.perceptionState,
        this.knowledgeSource,
        this.perceptionLane,
        this.currentVisibility,
        this.visibilitySampleTick,
        this.exposureStartTick,
        this.exposureProgress,
        this.noticingResumeState,
        this.candidateTargetKind,
        this.candidateTargetId,
        this.candidateTargetTeam,
        this.confirmedTargetKind,
        this.confirmedTargetId,
        this.confirmedTargetTeam,
        this.facingX,
        this.facingZ,
        this.guardX,
        this.guardZ,
        this.guardBaseFacingX,
        this.guardBaseFacingZ,
        this.guardSweepPhase,
        this.guardReturnStartTick,
        this.guardUnreachableStartTick,
        this.hasLastSeen,
        this.lastSeenX,
        this.lastSeenZ,
        this.lastSeenVx,
        this.lastSeenVz,
        this.lastSeenTick,
        this.huntPhase,
        this.huntAnchorX,
        this.huntAnchorZ,
        this.huntTravelStartTick,
        this.searchStartTick,
        this.searchEndTick,
        this.hasSearchGoal,
        this.searchGoalX,
        this.searchGoalZ,
        this.searchGoalCx,
        this.searchGoalCz,
        this.searchGoalStartTick,
        this.searchSequence,
        this.hasStimulus,
        this.stimulusX,
        this.stimulusZ,
        this.stimulusTick,
        this.navigationSlot,
      ]) {
        component[index] = component[last];
      }
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

export class RockPool {
  /** @param {number} capacity */
  constructor(capacity) {
    this.capacity = capacity;
    this.activeCount = 0;
    this.dropped = 0;
    this.speedClamped = 0;
    this.nextId = 1;
    this.id = new Uint32Array(capacity);
    this.spawnId = new Uint32Array(capacity);
    this.archetype = new Uint8Array(capacity);
    this.x = new Float32Array(capacity);
    this.z = new Float32Array(capacity);
    this.previousX = new Float32Array(capacity);
    this.previousZ = new Float32Array(capacity);
    this.vx = new Float32Array(capacity);
    this.vz = new Float32Array(capacity);
    this.radius = new Float32Array(capacity);
    this.massKg = new Float32Array(capacity);
    this.inverseMass = new Float32Array(capacity);
  }

  reset() {
    this.activeCount = 0;
    this.dropped = 0;
    this.speedClamped = 0;
    this.nextId = 1;
  }

  /** @param {{spawnId:number,archetype:number,x:number,z:number,radius:number,massKg:number}} value */
  spawn(value) {
    if (this.activeCount >= this.capacity) {
      this.dropped += 1;
      return 0;
    }
    const index = this.activeCount;
    const id = this.nextId;
    this.nextId = (this.nextId + 1) >>> 0 || 1;
    this.id[index] = id;
    this.spawnId[index] = value.spawnId;
    this.archetype[index] = value.archetype;
    this.x[index] = value.x;
    this.z[index] = value.z;
    this.previousX[index] = value.x;
    this.previousZ[index] = value.z;
    this.vx[index] = 0;
    this.vz[index] = 0;
    this.radius[index] = value.radius;
    this.massKg[index] = value.massKg;
    this.inverseMass[index] = 1 / value.massKg;
    this.activeCount += 1;
    return id;
  }

  /** @param {number} index */
  removeSwap(index) {
    if (index < 0 || index >= this.activeCount) return false;
    const last = this.activeCount - 1;
    if (index !== last) {
      this.id[index] = this.id[last];
      this.spawnId[index] = this.spawnId[last];
      this.archetype[index] = this.archetype[last];
      this.x[index] = this.x[last];
      this.z[index] = this.z[last];
      this.previousX[index] = this.previousX[last];
      this.previousZ[index] = this.previousZ[last];
      this.vx[index] = this.vx[last];
      this.vz[index] = this.vz[last];
      this.radius[index] = this.radius[last];
      this.massKg[index] = this.massKg[last];
      this.inverseMass[index] = this.inverseMass[last];
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

  /** @param {number} spawnId */
  findIndexBySpawnId(spawnId) {
    for (let index = 0; index < this.activeCount; index += 1) {
      if (this.spawnId[index] === spawnId) return index;
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
    this.wallBounces = 0;
    this.groundBounces = 0;
    this.collisionDiscards = 0;
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
    this.wallBounceCount = new Uint16Array(capacity);
    this.spellCode = new Uint8Array(capacity);
    this.definitionRevision = new Uint32Array(capacity);
    this.effectId = new Uint32Array(capacity);
    this.effectSeed = new Uint32Array(capacity);
    this.sampleOrdinal = new Uint16Array(capacity);
    this.sampleSeed = new Uint32Array(capacity);
  }

  reset() {
    this.activeCount = 0;
    this.dropped = 0;
    this.wallBounces = 0;
    this.groundBounces = 0;
    this.collisionDiscards = 0;
    this.nextId = 1;
  }

  /** @param {{x:number,y:number,z:number,vx:number,vy:number,vz:number,lifetime:number,size:number,spellCode?:number,definitionRevision?:number,effectId?:number,effectSeed?:number,sampleOrdinal?:number,sampleSeed?:number}} value */
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
    this.wallBounceCount[index] = 0;
    this.spellCode[index] = value.spellCode ?? 0;
    this.definitionRevision[index] = value.definitionRevision ?? 0;
    this.effectId[index] = value.effectId ?? 0;
    this.effectSeed[index] = value.effectSeed ?? 0;
    this.sampleOrdinal[index] = value.sampleOrdinal ?? 0;
    this.sampleSeed[index] = value.sampleSeed ?? 0;
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
      this.wallBounceCount[index] = this.wallBounceCount[last];
      this.spellCode[index] = this.spellCode[last];
      this.definitionRevision[index] = this.definitionRevision[last];
      this.effectId[index] = this.effectId[last];
      this.effectSeed[index] = this.effectSeed[last];
      this.sampleOrdinal[index] = this.sampleOrdinal[last];
      this.sampleSeed[index] = this.sampleSeed[last];
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
