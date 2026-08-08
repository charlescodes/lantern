// @ts-check

import { MOVEMENT_SOUND, PERCEPTIVE_WIZARD } from "../config.js";

export const AI_VIEW_MODE = Object.freeze({
  off: "off",
  selected: "selected",
  all: "all",
});

const AI_COLLECTION_NAMES = Object.freeze([
  "aiMobs",
  "mobs",
  "enemies",
  "friendlies",
  "critters",
]);

/** @param {unknown} value */
function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/** @param {unknown} value @param {number} [digits] */
function decimal(value, digits = 2) {
  const number = finite(value);
  return number === null ? "—" : number.toFixed(digits);
}

/** @param {unknown} value */
function integer(value) {
  const number = finite(value);
  return number === null ? "—" : String(Math.trunc(number));
}

/** @param {unknown} value */
function title(value) {
  return String(value ?? "mob")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

/** @param {Record<string,any>} mob */
export function aiMobKey(mob) {
  return `${String(mob.kind ?? "mob")}:${String(mob.id)}`;
}

/**
 * The live schema currently supplies enemy wizards. Named future collections
 * are accepted here so the view remains presentation-generic when friendly or
 * critter AI is introduced; duplicate stable identities are collapsed.
 * @param {Record<string,any>} snapshot
 */
export function collectAiMobs(snapshot) {
  const byKey = new Map();
  for (const name of AI_COLLECTION_NAMES) {
    const entries = snapshot?.[name];
    if (!Array.isArray(entries)) continue;
    for (const mob of entries) {
      if (!mob || typeof mob !== "object" || mob.id === undefined) continue;
      if (finite(mob.x) === null || finite(mob.z) === null) continue;
      if (finite(mob.health) !== null && Number(mob.health) <= 0) continue;
      const key = aiMobKey(mob);
      if (!byKey.has(key)) byKey.set(key, mob);
    }
  }
  return Array.from(byKey.values());
}

/** @param {Record<string,any>} mob */
export function describeAiMobOption(mob) {
  const team = title(mob.team ?? "unassigned");
  const kind = title(mob.kind ?? "mob");
  const state = String(mob.behaviorState ?? mob.aiState ?? "unknown").toUpperCase();
  const kindLower = kind.toLowerCase();
  const teamLower = team.toLowerCase();
  const identity = kindLower === teamLower || kindLower.startsWith(`${teamLower} `)
    ? kind
    : `${team} ${kind}`;
  return `${identity} #${mob.id} · ${state}`;
}

/** @param {Record<string,any>} mob */
function goalText(mob) {
  const goal = mob.movementGoal;
  if (!goal) return "none";
  const cell = goal.cell
    ? ` cell ${integer(goal.cell.cx)},${integer(goal.cell.cz)}`
    : "";
  return `${String(goal.kind ?? "unknown")} ${decimal(goal.x, 1)},${decimal(goal.z, 1)}${cell}`;
}

/** @param {Record<string,any>} mob */
function navText(mob) {
  const field = mob.navigationField ?? {};
  return `cost ${field.cost ?? "unreachable"} · v${integer(field.version)}`;
}

/** @param {Record<string,any>} mob */
function strafeText(mob) {
  const strafe = mob.strafe ?? {};
  return `${strafe.direction ?? "none"} · change ${strafe.ticksUntilChange ?? "—"}t`;
}

/** @param {Record<string,any>} mob */
function aimText(mob) {
  const aim = mob.predictedAimPoint;
  return aim
    ? `${decimal(aim.x, 1)},${decimal(aim.z, 1)} · lead ${decimal(mob.aimLeadTime, 3)}s`
    : "direct/unavailable";
}

/** @param {Record<string,any>} mob */
function threatText(mob) {
  const dodge = mob.dodge ?? {};
  const identities = [];
  if (mob.trackedThreatEffectId) {
    identities.push(`effect #${mob.trackedThreatEffectId}`);
  }
  if (mob.trackedThreatProjectileId) {
    identities.push(`projectile #${mob.trackedThreatProjectileId}`);
  }
  return `${identities.join(" · ") || "none"} · dodge ${integer(dodge.ticksRemaining)}t · cooldown ${integer(dodge.cooldownTicks)}t`;
}

/** @param {Record<string,any>|null|undefined} target */
function targetText(target) {
  if (!target) return "none";
  return `${String(target.kind ?? "actor")} #${integer(target.id)} · ${String(target.team ?? "unknown")}`;
}

/** @param {Record<string,any>} mob */
function pointText(point) {
  if (!point) return "none";
  const value = point.position ?? point;
  return `${decimal(value.x, 1)},${decimal(value.z, 1)}`;
}

/** @param {Record<string,any>} mob */
function huntText(mob) {
  const hunt = mob.hunt ?? {};
  const timers = [];
  if (finite(hunt.travelTimeoutTick) !== null) {
    timers.push(`travel timeout ${integer(hunt.travelTimeoutTick)}t`);
  }
  if (finite(hunt.searchTicksRemaining) !== null) {
    timers.push(`search left ${integer(hunt.searchTicksRemaining)}t`);
  }
  if (finite(hunt.searchGoal?.timeoutTick) !== null) {
    timers.push(`goal timeout ${integer(hunt.searchGoal.timeoutTick)}t`);
  }
  return `${hunt.phase ?? "none"} · anchor ${pointText(hunt.anchor)} · search ${pointText(hunt.searchGoal)} · sequence ${integer(hunt.sequence)}${timers.length > 0 ? ` · ${timers.join(" · ")}` : ""}`;
}

/** @param {Record<string,any>} mob */
function guardText(mob) {
  const guard = mob.guard ?? {};
  const unreachable = finite(guard.unreachableStartTick) === null
    ? ""
    : ` · unreachable ${integer(guard.unreachableStartTick)}→${integer(guard.unreachableTimeoutTick)}t`;
  return `${pointText(guard.point)} · return ${integer(guard.returnStartTick)}t${unreachable}`;
}

/** @param {Record<string,any>} mob */
function investigationText(mob) {
  const investigation = mob.investigation;
  if (!investigation) return "unavailable";
  if (!investigation.active) return "none";
  const identities = [];
  if (investigation.effectId) identities.push(`effect #${integer(investigation.effectId)}`);
  if (investigation.projectileId) {
    identities.push(`projectile #${integer(investigation.projectileId)}`);
  }
  if (investigation.sound?.eventId) {
    identities.push(`sound #${integer(investigation.sound.eventId)}`);
  }
  const sound = investigation.sound
    ? ` · ${investigation.sound.kind} ${decimal(investigation.sound.radius, 1)}m`
    : "";
  return `${investigation.source ?? "none"}${sound} · priority ${integer(investigation.priority)} · observed ${integer(investigation.observationTick)}t · accepted ${integer(investigation.acceptedTick)}t${identities.length > 0 ? ` · ${identities.join(" · ")}` : ""}`;
}

/**
 * @param {Record<string,any>} snapshot
 * @param {Record<string,any>} mob
 * @param {boolean|null} sightVisible
 */
export function formatAiMobDetails(snapshot, mob, sightVisible = null) {
  if (!mob) return "No living AI mob is selected.";
  const state = String(mob.behaviorState ?? mob.aiState ?? "unknown").toUpperCase();
  const playerVisibility = sightVisible === null
    ? "unknown"
    : sightVisible
      ? "visible"
      : "hidden (AI View still shown)";
  const cooldown = mob.cooldowns && typeof mob.cooldowns === "object"
    ? Object.entries(mob.cooldowns)
      .map(([name, value]) => `${name} ${decimal(value, 3)}s`)
      .join(" · ")
    : "none";
  const fieldBuilding = mob.navigationField?.building ?? snapshot.navigation?.building;
  const fieldStale = mob.navigationField?.stale ?? snapshot.navigation?.stale;
  return [
    `identity    ${describeAiMobOption(mob)}`,
    `profile     ${mob.aiProfile ?? snapshot.enemyAiProfile ?? "unknown"}`,
    `player sight ${playerVisibility}`,
    `mob vision  ${mob.currentVisibility ? "target visible" : "target not visible"} · sample ${integer(mob.visibilitySampleTick)}t`,
    `perception  ${String(mob.perceptionState ?? "legacy").toUpperCase()} · source ${mob.knowledgeSource ?? "none"}`,
    `exposure    ${integer(mob.exposure?.progressTicks)} / ${integer(mob.exposure?.thresholdTicks)}t · lane ${integer(mob.perceptionLane)}`,
    `candidate   ${targetText(mob.candidateTarget)} · confirmed ${targetText(mob.confirmedTarget)}`,
    `state       ${state} · retreat ${mob.retreating ? "yes" : "no"}`,
    `health      ${decimal(mob.health, 2)} / ${decimal(mob.maximumHealth, 2)}`,
    `position    ${decimal(mob.x, 2)}, ${decimal(mob.z, 2)}`,
    `velocity    ${decimal(mob.vx, 2)}, ${decimal(mob.vz, 2)}`,
    `desired     ${decimal(mob.desiredVx, 2)}, ${decimal(mob.desiredVz, 2)}`,
    `goal        ${goalText(mob)}`,
    `navigation  ${navText(mob)}`,
    `strafe      ${strafeText(mob)}`,
    `aim         ${aimText(mob)}`,
    `line sight  ${mob.lineOfSight ? "clear" : "blocked"}`,
    `last seen   ${pointText(mob.lastSeen)} · impact ${pointText(mob.stimulus)}`,
    `investigate ${investigationText(mob)}`,
    `hunt        ${huntText(mob)}`,
    `guard       ${guardText(mob)}`,
    `threat      ${threatText(mob)}`,
    `casting     sequence ${integer(mob.castSequence)} · ${cooldown}`,
    `field       slot ${mob.navigationField?.slot ?? "—"} · ${mob.navigationField?.key ?? "none"} · v${integer(mob.navigationField?.version)}${fieldBuilding ? " · building" : ""}${fieldStale ? " · stale" : ""}`,
  ].join("\n");
}

/**
 * @param {Record<string,any>} snapshot
 * @param {Record<string,any>} mob
 * @param {number} alpha
 * @param {boolean|null} sightVisible
 * @param {boolean} selected
 */
function mobView(snapshot, mob, alpha, sightVisible, selected) {
  const x = Number(mob.previousX ?? mob.x)
    + (Number(mob.x) - Number(mob.previousX ?? mob.x)) * alpha;
  const z = Number(mob.previousZ ?? mob.z)
    + (Number(mob.z) - Number(mob.previousZ ?? mob.z)) * alpha;
  const movementGoal = mob.movementGoal
    && finite(mob.movementGoal.x) !== null
    && finite(mob.movementGoal.z) !== null
    ? {
      kind: String(mob.movementGoal.kind ?? "unknown"),
      x: Number(mob.movementGoal.x),
      z: Number(mob.movementGoal.z),
    }
    : null;
  const predictedAimPoint = mob.predictedAimPoint
    && finite(mob.predictedAimPoint.x) !== null
    && finite(mob.predictedAimPoint.z) !== null
    ? {
      x: Number(mob.predictedAimPoint.x),
      z: Number(mob.predictedAimPoint.z),
    }
    : null;
  const dodgeDirection = mob.dodge?.direction
    && finite(mob.dodge.direction.x) !== null
    && finite(mob.dodge.direction.z) !== null
    ? {
      x: Number(mob.dodge.direction.x),
      z: Number(mob.dodge.direction.z),
    }
    : null;
  const threat = (snapshot.projectiles ?? []).find((projectile) => (
    Number(mob.trackedThreatProjectileId) > 0
      ? Number(projectile.id) === Number(mob.trackedThreatProjectileId)
      : Number(mob.trackedThreatEffectId) > 0
        && Number(projectile.effectId) === Number(mob.trackedThreatEffectId)
  )) ?? null;
  const state = String(mob.behaviorState ?? mob.aiState ?? "unknown");
  const facingLength = Math.hypot(Number(mob.facing?.x), Number(mob.facing?.z));
  const facing = Number.isFinite(facingLength) && facingLength > 1e-9
    ? {
      x: Number(mob.facing.x) / facingLength,
      z: Number(mob.facing.z) / facingLength,
    }
    : null;
  const targetIdentity = mob.confirmedTarget ?? mob.candidateTarget ?? null;
  const targetPoint = targetIdentity?.kind === "player" && snapshot.player
    ? { x: Number(snapshot.player.x), z: Number(snapshot.player.z) }
    : null;
  const investigation = mob.investigation ?? null;
  const investigationAnchor = investigation?.anchor
    && finite(investigation.anchor.x) !== null
    && finite(investigation.anchor.z) !== null
    ? { x: Number(investigation.anchor.x), z: Number(investigation.anchor.z) }
    : null;
  const projectileObservationPoint = investigation?.projectileObservation?.position
    && finite(investigation.projectileObservation.position.x) !== null
    && finite(investigation.projectileObservation.position.z) !== null
    ? {
      x: Number(investigation.projectileObservation.position.x),
      z: Number(investigation.projectileObservation.position.z),
    }
    : null;
  const inferredOriginPoint = investigation?.inferredOrigin
    && finite(investigation.inferredOrigin.x) !== null
    && finite(investigation.inferredOrigin.z) !== null
    ? {
      x: Number(investigation.inferredOrigin.x),
      z: Number(investigation.inferredOrigin.z),
    }
    : null;
  return {
    key: aiMobKey(mob),
    id: mob.id,
    kind: String(mob.kind ?? "mob"),
    team: String(mob.team ?? "unassigned"),
    state,
    selected,
    sightVisible,
    mobTargetVisible: Boolean(mob.currentVisibility),
    perceptionState: String(mob.perceptionState ?? "legacy"),
    knowledgeSource: String(mob.knowledgeSource ?? "none"),
    exposure: {
      progressTicks: Math.max(0, Number(mob.exposure?.progressTicks) || 0),
      thresholdTicks: Math.max(0, Number(mob.exposure?.thresholdTicks) || 0),
    },
    position: { x, z },
    radius: Math.max(0, Number(mob.radius) || 0),
    movementGoal,
    facingEnd: facing ? { x: x + facing.x * 1.2, z: z + facing.z * 1.2 } : null,
    perceptionCone: facing
      ? {
        x,
        z,
        facing,
        radius: PERCEPTIVE_WIZARD.visualRangeMeters,
        halfAngleRadians: PERCEPTIVE_WIZARD.fieldOfViewDegrees * Math.PI / 360,
        closeRadius: PERCEPTIVE_WIZARD.closeAwarenessMeters,
      }
      : null,
    targetPoint,
    lastSeenPoint: mob.lastSeen?.position
      ? { x: Number(mob.lastSeen.position.x), z: Number(mob.lastSeen.position.z) }
      : null,
    stimulusPoint: investigation?.source !== "sound" && mob.stimulus?.position
      ? { x: Number(mob.stimulus.position.x), z: Number(mob.stimulus.position.z) }
      : null,
    soundImpactPoint: investigation?.source === "sound" ? investigationAnchor : null,
    soundKind: investigation?.source === "sound"
      ? String(investigation.sound?.kind ?? "fireball-impact")
      : null,
    hearingCircles: selected
      ? [
        {
          x,
          z,
          radius: MOVEMENT_SOUND.footstepHearingMeters,
          label: `FOOTSTEPS ${MOVEMENT_SOUND.footstepHearingMeters}m`,
          kind: "footstep",
        },
        {
          x,
          z,
          radius: PERCEPTIVE_WIZARD.fireballHearingMeters,
          label: `FIREBALL ${PERCEPTIVE_WIZARD.fireballHearingMeters}m`,
          kind: "fireball-impact",
        },
      ]
      : [],
    projectileObservationPoint,
    inferredOriginPoint,
    reverseTrajectory: projectileObservationPoint && inferredOriginPoint
      ? { start: projectileObservationPoint, end: inferredOriginPoint }
      : null,
    searchPoint: mob.hunt?.searchGoal
      ? { x: Number(mob.hunt.searchGoal.x), z: Number(mob.hunt.searchGoal.z) }
      : null,
    guardPoint: mob.guard?.point
      ? { x: Number(mob.guard.point.x), z: Number(mob.guard.point.z) }
      : null,
    navigationState: mob.navigationField ?? null,
    desiredEnd: {
      x: x + Number(mob.desiredVx ?? 0) * 0.35,
      z: z + Number(mob.desiredVz ?? 0) * 0.35,
    },
    predictedAimPoint,
    lineOfSightTarget: snapshot.player
      ? { x: Number(snapshot.player.x), z: Number(snapshot.player.z) }
      : null,
    lineOfSight: Boolean(mob.lineOfSight),
    threatPoint: threat ? { x: Number(threat.x), z: Number(threat.z) } : null,
    dodgeEnd: dodgeDirection
      ? { x: x + dodgeDirection.x * 1.2, z: z + dodgeDirection.z * 1.2 }
      : null,
    labelLines: formatAiMobDetails(snapshot, mob, sightVisible).split("\n"),
    source: mob,
  };
}

/**
 * @param {Record<string,any>} snapshot
 * @param {number} alpha
 * @param {{mode:string,selectedKey?:string|null,isVisible?:(mob:Record<string,any>)=>boolean|null}} state
 */
export function buildAiViewFrame(snapshot, alpha, state) {
  const mode = Object.values(AI_VIEW_MODE).includes(state.mode)
    ? state.mode
    : AI_VIEW_MODE.off;
  const availableMobs = collectAiMobs(snapshot);
  const selectedKey = state.selectedKey ?? null;
  const selectedMob = availableMobs.find((mob) => aiMobKey(mob) === selectedKey) ?? null;
  const selectedSightVisible = selectedMob && state.isVisible
    ? state.isVisible(selectedMob)
    : null;
  const activeMobs = mode === AI_VIEW_MODE.all
    ? availableMobs
    : mode === AI_VIEW_MODE.selected && selectedMob
      ? [selectedMob]
      : [];
  const views = activeMobs.map((mob) => {
    const sightVisible = mob === selectedMob
      ? selectedSightVisible
      : state.isVisible
        ? state.isVisible(mob)
        : null;
    return mobView(snapshot, mob, Math.max(0, Math.min(1, alpha)), sightVisible, mob === selectedMob);
  });
  return {
    mode,
    selectedKey,
    selectedMob,
    selectedSightVisible,
    availableMobs,
    mobs: views,
    engagementRings: views.length > 0 && snapshot.player
      ? [
        { radius: 6, label: "WITHDRAW < 6m" },
        { radius: 9, label: "APPROACH > 9m" },
      ].map((ring) => ({
        ...ring,
        x: Number(snapshot.player.x),
        z: Number(snapshot.player.z),
      }))
      : [],
    navigation: snapshot.navigation ?? null,
    soundMarkers: mode === AI_VIEW_MODE.off
      ? []
      : (snapshot.soundEvents?.recent ?? [])
        .filter((event) => Number(snapshot.tick) - Number(event.tick) <= 30)
        .slice(-8)
        .map((event) => ({
          id: Number(event.id),
          x: Number(event.x),
          z: Number(event.z),
          kind: String(event.kind ?? "sound"),
        })),
  };
}
