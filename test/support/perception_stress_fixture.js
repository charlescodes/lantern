// @ts-check

import {
  ACTOR_TEAM,
  COMBAT,
  ENEMY_AI_PROFILE_INVESTIGATIVE,
  ENEMY_WIZARD,
  PERCEPTIVE_WIZARD,
  PROJECTILE_OWNER_KIND,
} from "../../src/config.js";
import {
  FIREBALL_SPELL_CODE,
  FIREBALL_SPELL_ID,
} from "../../src/spells/fireball_definition.js";
import { GridMap } from "../../src/sim/grid_map.js";
import {
  deterministicGuardHeading,
  HUNT_PHASE,
  INVESTIGATION_PRIORITY,
  KNOWLEDGE_SOURCE,
  PERCEPTION_STATE,
  TARGET_KIND,
} from "../../src/sim/perceptive_wizard.js";
import { ArenaScenario } from "../../src/sim/scenario.js";
import { Simulation } from "../../src/sim/simulation.js";

export const PERCEPTION_STRESS_MOBS = 50;
export const PERCEPTION_STRESS_CASTERS = 12;

function borderedStressMap() {
  const map = new GridMap(64, 48, undefined, { x: 12.5, z: 24.5 });
  for (let x = 0; x < map.width; x += 1) {
    map.set(x, 0, 1);
    map.set(x, map.height - 1, 1);
  }
  for (let z = 0; z < map.height; z += 1) {
    map.set(0, z, 1);
    map.set(map.width - 1, z, 1);
  }
  for (const wallX of [24, 40]) {
    for (let z = 1; z < map.height - 1; z += 1) {
      if (z !== 8 && z !== 24 && z !== 40) map.set(wallX, z, 1);
    }
  }
  return map;
}

/** @param {number} index */
function stressPosition(index) {
  if (index < PERCEPTION_STRESS_CASTERS) {
    const angle = index * Math.PI * 2 / PERCEPTION_STRESS_CASTERS;
    const radius = index % 2 === 0 ? 7 : 8.25;
    return {
      x: 12.5 + Math.cos(angle) * radius,
      z: 24.5 + Math.sin(angle) * radius,
    };
  }
  const ordinal = index - PERCEPTION_STRESS_CASTERS;
  const columns = [28.5, 31.5, 34.5, 37.5, 43.5, 46.5, 49.5, 52.5, 55.5, 58.5];
  return {
    x: columns[ordinal % columns.length],
    z: 4.5 + Math.floor(ordinal / columns.length) * 10,
  };
}

/** @param {Simulation} simulation @param {number} index */
function spawnStressEnemy(simulation, index) {
  const position = stressPosition(index);
  const heading = deterministicGuardHeading(simulation.seed, index + 1);
  const towardPlayerX = simulation.player.x - position.x;
  const towardPlayerZ = simulation.player.z - position.z;
  const towardLength = Math.hypot(towardPlayerX, towardPlayerZ) || 1;
  const caster = index < PERCEPTION_STRESS_CASTERS;
  return simulation.enemies.spawn({
    spawnSequence: index + 1,
    spawnTick: simulation.tickCount,
    x: position.x,
    z: position.z,
    radius: ENEMY_WIZARD.radius,
    massKg: ENEMY_WIZARD.massKg,
    maximumHealth: COMBAT.maximumHealth,
    shotReadyTick: caster ? simulation.tickCount + 1 + index * 6 : 0xffff_ffff,
    facingX: caster ? towardPlayerX / towardLength : heading.x,
    facingZ: caster ? towardPlayerZ / towardLength : heading.z,
    guardX: position.x,
    guardZ: position.z,
    guardBaseFacingX: caster ? towardPlayerX / towardLength : heading.x,
    guardBaseFacingZ: caster ? towardPlayerZ / towardLength : heading.z,
    perceptionLane: (index + 1) % PERCEPTIVE_WIZARD.perceptionLanes,
    guardSweepPhase: (index * 47) % PERCEPTIVE_WIZARD.guardSweepCycleTicks,
  });
}

/** @param {import('../../src/sim/pools.js').EnemyWizardPool} pool @param {number} index */
function clearPerceptionState(pool, index) {
  pool.currentVisibility[index] = 0;
  pool.exposureStartTick[index] = 0;
  pool.exposureProgress[index] = 0;
  pool.noticingResumeState[index] = PERCEPTION_STATE.unaware;
  pool.candidateTargetKind[index] = TARGET_KIND.none;
  pool.candidateTargetId[index] = 0;
  pool.candidateTargetTeam[index] = 0;
  pool.confirmedTargetKind[index] = TARGET_KIND.none;
  pool.confirmedTargetId[index] = 0;
  pool.confirmedTargetTeam[index] = 0;
  pool.hasLastSeen[index] = 0;
  pool.lastSeenX[index] = Number.NaN;
  pool.lastSeenZ[index] = Number.NaN;
  pool.lastSeenVx[index] = 0;
  pool.lastSeenVz[index] = 0;
  pool.lastSeenTick[index] = 0;
  pool.huntPhase[index] = HUNT_PHASE.none;
  pool.huntAnchorX[index] = Number.NaN;
  pool.huntAnchorZ[index] = Number.NaN;
  pool.huntTravelStartTick[index] = 0;
  pool.searchStartTick[index] = 0;
  pool.searchEndTick[index] = 0;
  pool.hasSearchGoal[index] = 0;
  pool.searchGoalX[index] = Number.NaN;
  pool.searchGoalZ[index] = Number.NaN;
  pool.searchGoalCx[index] = -1;
  pool.searchGoalCz[index] = -1;
  pool.searchGoalStartTick[index] = 0;
  pool.searchSequence[index] = 0;
  pool.hasStimulus[index] = 0;
  pool.stimulusX[index] = Number.NaN;
  pool.stimulusZ[index] = Number.NaN;
  pool.stimulusTick[index] = 0;
  pool.investigationSource[index] = KNOWLEDGE_SOURCE.none;
  pool.investigationPriority[index] = INVESTIGATION_PRIORITY.none;
  pool.investigationAnchorX[index] = Number.NaN;
  pool.investigationAnchorZ[index] = Number.NaN;
  pool.investigationObservationTick[index] = 0;
  pool.investigationAcceptedTick[index] = 0;
  pool.investigationEffectId[index] = 0;
  pool.investigationProjectileId[index] = 0;
  pool.investigationProjectileX[index] = Number.NaN;
  pool.investigationProjectileZ[index] = Number.NaN;
  pool.investigationProjectileVx[index] = 0;
  pool.investigationProjectileVz[index] = 0;
  pool.investigationProjectileAge[index] = 0;
  pool.investigationOriginX[index] = Number.NaN;
  pool.investigationOriginZ[index] = Number.NaN;
  pool.guardReturnStartTick[index] = 0;
  pool.guardUnreachableStartTick[index] = 0;
  pool.navigationSlot[index] = -1;
}

/**
 * Rebuilds the representative 12-engaged plus 38 occluded guard/search/return
 * arrangement after deliberate deaths or resets.
 * @param {Simulation} simulation
 */
export function configurePerceptionStressFixture(simulation) {
  while (simulation.enemies.activeCount < PERCEPTION_STRESS_MOBS) {
    spawnStressEnemy(simulation, simulation.enemies.activeCount);
  }
  const pool = simulation.enemies;
  const tick = simulation.tickCount;
  for (let index = 0; index < PERCEPTION_STRESS_MOBS; index += 1) {
    const position = stressPosition(index);
    const heading = deterministicGuardHeading(simulation.seed, index + 1);
    pool.x[index] = position.x;
    pool.z[index] = position.z;
    pool.previousX[index] = position.x;
    pool.previousZ[index] = position.z;
    pool.vx[index] = 0;
    pool.vz[index] = 0;
    pool.desiredVx[index] = 0;
    pool.desiredVz[index] = 0;
    pool.locomotionVx[index] = 0;
    pool.locomotionVz[index] = 0;
    pool.externalVx[index] = 0;
    pool.externalVz[index] = 0;
    pool.health[index] = COMBAT.maximumHealth;
    pool.retreating[index] = 0;
    pool.dodgeTicksRemaining[index] = 0;
    pool.dodgeCooldownTicks[index] = 0;
    pool.guardX[index] = position.x;
    pool.guardZ[index] = position.z;
    pool.guardBaseFacingX[index] = heading.x;
    pool.guardBaseFacingZ[index] = heading.z;
    pool.facingX[index] = heading.x;
    pool.facingZ[index] = heading.z;
    clearPerceptionState(pool, index);

    if (index < PERCEPTION_STRESS_CASTERS) {
      const dx = simulation.player.x - position.x;
      const dz = simulation.player.z - position.z;
      const length = Math.hypot(dx, dz) || 1;
      pool.facingX[index] = dx / length;
      pool.facingZ[index] = dz / length;
      pool.perceptionState[index] = PERCEPTION_STATE.engaged;
      pool.knowledgeSource[index] = KNOWLEDGE_SOURCE.visual;
      pool.currentVisibility[index] = 1;
      pool.visibilitySampleTick[index] = tick;
      pool.exposureStartTick[index] = Math.max(0, tick - PERCEPTIVE_WIZARD.exposureTicks);
      pool.exposureProgress[index] = PERCEPTIVE_WIZARD.exposureTicks;
      pool.confirmedTargetKind[index] = TARGET_KIND.player;
      pool.confirmedTargetId[index] = simulation.player.id;
      pool.confirmedTargetTeam[index] = ACTOR_TEAM.player;
      pool.hasLastSeen[index] = 1;
      pool.lastSeenX[index] = simulation.player.x;
      pool.lastSeenZ[index] = simulation.player.z;
      pool.lastSeenTick[index] = tick;
      continue;
    }

    const group = index - PERCEPTION_STRESS_CASTERS;
    if (group < 13) {
      pool.perceptionState[index] = PERCEPTION_STATE.hunting;
      pool.knowledgeSource[index] = KNOWLEDGE_SOURCE.visual;
      pool.confirmedTargetKind[index] = TARGET_KIND.player;
      pool.confirmedTargetId[index] = simulation.player.id;
      pool.confirmedTargetTeam[index] = ACTOR_TEAM.player;
      pool.hasLastSeen[index] = 1;
      pool.lastSeenX[index] = position.x + 1.5;
      pool.lastSeenZ[index] = position.z;
      pool.lastSeenTick[index] = tick;
      pool.huntAnchorX[index] = pool.lastSeenX[index];
      pool.huntAnchorZ[index] = pool.lastSeenZ[index];
      if (simulation.enemyAiProfile === ENEMY_AI_PROFILE_INVESTIGATIVE) {
        pool.investigationSource[index] = KNOWLEDGE_SOURCE.visual;
        pool.investigationPriority[index] = INVESTIGATION_PRIORITY.lastSeen;
        pool.investigationAnchorX[index] = pool.lastSeenX[index];
        pool.investigationAnchorZ[index] = pool.lastSeenZ[index];
        pool.investigationObservationTick[index] = tick;
        pool.investigationAcceptedTick[index] = tick;
      }
      if (group % 2 === 0) {
        pool.huntPhase[index] = HUNT_PHASE.search;
        pool.searchStartTick[index] = tick;
        pool.searchEndTick[index] = tick + PERCEPTIVE_WIZARD.searchTicks;
        pool.hasSearchGoal[index] = 1;
        pool.searchGoalX[index] = position.x + 1;
        pool.searchGoalZ[index] = position.z;
        pool.searchGoalCx[index] = Math.floor(position.x + 1);
        pool.searchGoalCz[index] = Math.floor(position.z);
        pool.searchGoalStartTick[index] = tick;
      } else {
        pool.huntPhase[index] = HUNT_PHASE.travel;
        pool.huntTravelStartTick[index] = tick;
      }
    } else if (group < 26) {
      pool.perceptionState[index] = PERCEPTION_STATE.returning;
      pool.knowledgeSource[index] = KNOWLEDGE_SOURCE.visual;
      pool.confirmedTargetKind[index] = TARGET_KIND.player;
      pool.confirmedTargetId[index] = simulation.player.id;
      pool.confirmedTargetTeam[index] = ACTOR_TEAM.player;
      pool.hasLastSeen[index] = 1;
      pool.lastSeenX[index] = position.x;
      pool.lastSeenZ[index] = position.z;
      pool.lastSeenTick[index] = tick;
      if (simulation.enemyAiProfile === ENEMY_AI_PROFILE_INVESTIGATIVE) {
        pool.investigationSource[index] = KNOWLEDGE_SOURCE.visual;
        pool.investigationPriority[index] = INVESTIGATION_PRIORITY.lastSeen;
        pool.investigationAnchorX[index] = position.x;
        pool.investigationAnchorZ[index] = position.z;
        pool.investigationObservationTick[index] = tick;
        pool.investigationAcceptedTick[index] = tick;
      }
      pool.guardX[index] = position.x + (index % 2 === 0 ? 2 : -2);
      pool.guardReturnStartTick[index] = tick;
      pool.guardUnreachableStartTick[index] = 0;
    } else {
      pool.perceptionState[index] = PERCEPTION_STATE.unaware;
      pool.knowledgeSource[index] = KNOWLEDGE_SOURCE.none;
    }
  }
  simulation.player.maximumHealth = 10_000;
  simulation.player.health = 10_000;
  return simulation;
}

export function createPerceptionStressSimulation(
  seed = 0x0900_5000,
  enemyAiProfile = ENEMY_AI_PROFILE_INVESTIGATIVE,
) {
  const simulation = new Simulation({
    scenario: new ArenaScenario(borderedStressMap()),
    seed,
    enemyAiProfile,
    enemyCapacity: ENEMY_WIZARD.capacity,
    encounterMaximumAlive: ENEMY_WIZARD.encounterMaximumAlive,
    particleBurstCount: 0,
  });
  return configurePerceptionStressFixture(simulation);
}

/**
 * @param {Simulation} simulation
 * @param {number} enemyIndex
 * @param {number} effectId
 * @param {{visibleThreat?:boolean,lethal?:boolean}} [options]
 */
export function spawnStressProjectile(simulation, enemyIndex, effectId, options = {}) {
  const pool = simulation.enemies;
  if (enemyIndex < 0 || enemyIndex >= pool.activeCount) return 0;
  const spell = simulation.spells.get(FIREBALL_SPELL_ID);
  const definition = spell?.definitions.get(spell.currentRevision);
  if (!spell || !definition) return 0;
  let x = pool.x[enemyIndex];
  let z = pool.z[enemyIndex];
  let vx = 0;
  let vz = 0;
  if (options.visibleThreat) {
    const dx = pool.x[enemyIndex] - simulation.player.x;
    const dz = pool.z[enemyIndex] - simulation.player.z;
    const length = Math.hypot(dx, dz) || 1;
    x -= dx / length * 4;
    z -= dz / length * 4;
    vx = dx / length * definition.projectile.speed;
    vz = dz / length * definition.projectile.speed;
  }
  if (options.lethal) pool.health[enemyIndex] = COMBAT.directDamage;
  return simulation.projectiles.spawn({
    x,
    z,
    vx,
    vz,
    lifetime: definition.projectile.lifetime,
    radius: definition.projectile.radius,
    ownerId: simulation.player.id,
    ownerKind: PROJECTILE_OWNER_KIND.player,
    ownerTeam: ACTOR_TEAM.player,
    spellCode: FIREBALL_SPELL_CODE,
    definitionRevision: spell.currentRevision,
    effectId,
    effectSeed: effectId ^ 0x0800_5000,
  });
}
