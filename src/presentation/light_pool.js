// @ts-check

/**
 * Applies logical light assignments without changing renderer topology.
 * Every resident slot stays visible and non-shadow-casting for its lifetime.
 *
 * @param {Array<Record<string, any>>} lights
 * @param {Array<Record<string, any>>} assignments
 * @param {boolean} [enabled]
 */
export function applyLightPool(lights, assignments, enabled = true) {
  for (const light of lights) {
    light.visible = true;
    light.castShadow = false;
    light.userData ??= {};
  }
  if (!enabled) {
    for (const light of lights) light.intensity = 0;
    return 0;
  }

  const pending = assignments.slice(0, lights.length);
  const slotted = pending.filter((assignment) => (
    Number.isInteger(assignment.residentSlot)
    && assignment.residentSlot >= 0
    && assignment.residentSlot < lights.length
  ));
  if (slotted.length > 0) {
    const appliedSlots = new Set();
    for (const assignment of slotted) {
      if (appliedSlots.has(assignment.residentSlot)) continue;
      applyAssignment(lights[assignment.residentSlot], assignment);
      appliedSlots.add(assignment.residentSlot);
    }
    for (let index = 0; index < lights.length; index += 1) {
      if (appliedSlots.has(index)) continue;
      lights[index].intensity = 0;
      lights[index].userData.assignment = null;
    }
    return appliedSlots.size;
  }

  const assignmentByKey = new Map(
    pending.map((assignment) => [assignment.key, assignment]),
  );
  const appliedKeys = new Set();
  let activeCount = 0;

  for (const light of lights) {
    const key = light.userData.assignment;
    const assignment = key === null || key === undefined
      ? null
      : assignmentByKey.get(key);
    if (!assignment || appliedKeys.has(key)) {
      light.intensity = 0;
      light.userData.assignment = null;
      continue;
    }
    applyAssignment(light, assignment);
    appliedKeys.add(key);
    activeCount += 1;
  }

  for (const assignment of pending) {
    if (appliedKeys.has(assignment.key)) continue;
    const light = lights.find(
      (candidate) => candidate.userData.assignment === null,
    );
    if (!light) break;
    applyAssignment(light, assignment);
    appliedKeys.add(assignment.key);
    activeCount += 1;
  }

  return activeCount;
}

/**
 * @param {Record<string, any>} light
 * @param {Record<string, any>} assignment
 */
function applyAssignment(light, assignment) {
  light.position.set(assignment.x, assignment.y, assignment.z);
  light.color.setRGB(
    assignment.color.r,
    assignment.color.g,
    assignment.color.b,
  );
  light.intensity = assignment.intensity;
  light.distance = assignment.distance;
  light.decay = assignment.decay;
  light.userData.assignment = assignment.key;
}
