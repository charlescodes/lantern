import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  AI_VIEW_MODE,
  aiMobKey,
  buildAiViewFrame,
  collectAiMobs,
  describeAiMobOption,
  formatAiMobDetails,
} from "../src/presentation/ai_view_model.js";

function enemy(id, overrides = {}) {
  return {
    kind: "enemyWizard",
    id,
    team: "enemy",
    x: 10 + id,
    z: 8 + id,
    previousX: 9 + id,
    previousZ: 8 + id,
    vx: 1,
    vz: 0,
    desiredVx: 3.5,
    desiredVz: 0,
    radius: 0.3,
    health: 75,
    maximumHealth: 100,
    behaviorState: "engage",
    aiState: "engage",
    movementGoal: { kind: "strafe", x: 12, z: 9, cell: null },
    navigationField: { cost: 84, version: 3 },
    strafe: { direction: "left", ticksUntilChange: 42 },
    predictedAimPoint: { x: 4.5, z: 6.5 },
    aimLeadTime: 0.375,
    aimInterceptTime: 0.5,
    trackedThreatEffectId: 77,
    trackedThreatProjectileId: 9,
    dodge: {
      ticksRemaining: 12,
      cooldownTicks: 0,
      side: "left",
      direction: { x: 0, z: 1 },
    },
    retreating: false,
    lineOfSight: true,
    cooldowns: { fireball: 0.25 },
    castSequence: 4,
    ...overrides,
  };
}

function snapshot() {
  return {
    enemyAiProfile: "tactical-wizard-v1",
    navigation: { version: 3, building: true, stale: true },
    player: { x: 4, z: 5 },
    enemies: [enemy(1), enemy(2, {
      behaviorState: "retreat",
      aiState: "retreat",
      retreating: true,
      lineOfSight: false,
    })],
    projectiles: [{ id: 9, effectId: 77, x: 8, z: 9 }],
  };
}

test("AI View filters off, selected, and all modes by stable mob identity", () => {
  const value = snapshot();
  const firstKey = aiMobKey(value.enemies[0]);
  const off = buildAiViewFrame(value, 0.5, {
    mode: AI_VIEW_MODE.off,
    selectedKey: firstKey,
    isVisible: () => false,
  });
  assert.equal(off.availableMobs.length, 2);
  assert.equal(off.mobs.length, 0);
  assert.equal(off.engagementRings.length, 0);
  assert.equal(off.selectedSightVisible, false);

  const selected = buildAiViewFrame(value, 0.5, {
    mode: AI_VIEW_MODE.selected,
    selectedKey: firstKey,
    isVisible: () => false,
  });
  assert.equal(selected.mobs.length, 1);
  assert.equal(selected.mobs[0].key, firstKey);
  assert.equal(selected.mobs[0].selected, true);
  assert.equal(selected.mobs[0].sightVisible, false);
  assert.deepEqual(selected.mobs[0].position, { x: 10.5, z: 9 });
  assert.deepEqual(selected.mobs[0].threatPoint, { x: 8, z: 9 });
  assert.equal(selected.engagementRings[0].radius, 6);
  assert.equal(selected.engagementRings[1].radius, 9);

  value.enemies.reverse();
  const reordered = buildAiViewFrame(value, 0.5, {
    mode: AI_VIEW_MODE.selected,
    selectedKey: firstKey,
  });
  assert.equal(reordered.mobs[0].id, 1, "selection must survive pool/list reordering");

  const all = buildAiViewFrame(value, 1, {
    mode: AI_VIEW_MODE.all,
    selectedKey: firstKey,
  });
  assert.deepEqual(all.mobs.map((mob) => mob.id), [2, 1]);
  assert.equal(all.mobs.find((mob) => mob.id === 1).selected, true);
});

test("AI View model is generic enough for future friendly and critter collections", () => {
  const friendly = enemy(5, {
    kind: "friendlyCritter",
    team: "friendly",
    behaviorState: "follow",
  });
  const value = {
    ...snapshot(),
    aiMobs: [friendly],
    friendlies: [friendly],
  };
  const mobs = collectAiMobs(value);
  assert.deepEqual(mobs.map(aiMobKey), ["friendlyCritter:5", "enemyWizard:1", "enemyWizard:2"]);
  assert.equal(
    describeAiMobOption(friendly),
    "Friendly Critter #5 · FOLLOW",
  );
});

test("AI View prints tactical truth without mutating the snapshot", () => {
  const value = snapshot();
  const before = structuredClone(value);
  const mob = value.enemies[0];
  const text = formatAiMobDetails(value, mob, false);
  assert.match(text, /profile\s+tactical-wizard-v1/);
  assert.match(text, /visibility\s+hidden \(AI View still shown\)/);
  assert.match(text, /goal\s+strafe 12\.0,9\.0/);
  assert.match(text, /navigation\s+cost 84 · v3/);
  assert.match(text, /aim\s+4\.5,6\.5 · lead 0\.375s/);
  assert.match(text, /threat\s+effect #77 · projectile #9 · dodge 12t/);
  assert.match(text, /field\s+v3 · building · stale/);
  buildAiViewFrame(value, 0.25, {
    mode: AI_VIEW_MODE.all,
    selectedKey: aiMobKey(mob),
  });
  assert.deepEqual(value, before);
});

test("AI View panel wording cannot be mistaken for an AI behavior toggle", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /<h2>AI View<\/h2>/);
  assert.match(html, /Draw diagnostics/);
  assert.match(html, /Selected mob/);
  assert.match(html, /All mobs/);
  assert.match(html, /This view never toggles mob AI/);
  assert.doesNotMatch(html, />Enable AI</);
  assert.doesNotMatch(html, />Disable AI</);
});
