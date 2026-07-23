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
  const activeCount = enabled ? Math.min(lights.length, assignments.length) : 0;
  for (let index = 0; index < lights.length; index += 1) {
    const light = lights[index];
    const assignment = index < activeCount ? assignments[index] : null;
    light.visible = true;
    light.castShadow = false;
    light.userData ??= {};
    if (!assignment) {
      light.intensity = 0;
      light.userData.assignment = null;
      continue;
    }
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
  return activeCount;
}
