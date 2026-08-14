// @ts-check

import { getPlaceableDefinition } from "../authoring/definition_catalog.js";

export const MAX_RESIDENT_PROP_LIGHTS = 4;

/** @param {Record<string, any>} left @param {Record<string, any>} right */
function compareStableBodyIdentity(left, right) {
  const leftIdentity = String(left.authoringId ?? left.id ?? "");
  const rightIdentity = String(right.authoringId ?? right.id ?? "");
  return leftIdentity < rightIdentity ? -1 : leftIdentity > rightIdentity ? 1 : 0;
}

/**
 * Adds a bounded set of catalog-declared prop lights without changing the
 * resident Three.js light topology. Prop lights lease the highest numbered
 * slots, replacing transient assignments in those slots when necessary.
 *
 * @param {Array<Record<string, any>>} transientAssignments
 * @param {Array<Record<string, any>>} bodies
 * @param {number} capacity
 */
export function mergeCatalogPropLights(transientAssignments, bodies, capacity) {
  const residentCapacity = Math.max(0, Math.trunc(Number(capacity)));
  if (residentCapacity === 0) return [];
  const maximum = Math.min(
    MAX_RESIDENT_PROP_LIGHTS,
    Math.max(1, Math.floor(residentCapacity / 4)),
  );
  const litBodies = [...bodies]
    .filter((body) => {
      const definition = getPlaceableDefinition(body.definitionId);
      return Boolean(definition?.traits.presentationLight);
    })
    .sort(compareStableBodyIdentity)
    .slice(0, maximum);
  if (litBodies.length === 0) return [...transientAssignments];

  const firstReservedSlot = residentCapacity - litBodies.length;
  const result = transientAssignments.filter((assignment) => (
    !Number.isInteger(assignment.residentSlot)
    || assignment.residentSlot < firstReservedSlot
  ));
  for (let index = 0; index < litBodies.length; index += 1) {
    const body = litBodies[index];
    const definition = getPlaceableDefinition(body.definitionId);
    const light = definition?.traits.presentationLight;
    if (!light) continue;
    result.push({
      key: `prop:${body.authoringId ?? body.id}:light`,
      kind: "catalog-prop",
      sourceId: body.id,
      authoringId: body.authoringId ?? null,
      definitionId: definition.id,
      residentSlot: firstReservedSlot + index,
      x: Number(body.x),
      y: Number(light.height),
      z: Number(body.z),
      color: {
        r: Number(light.color.r),
        g: Number(light.color.g),
        b: Number(light.color.b),
      },
      intensity: Number(light.intensity),
      distance: Number(light.distance),
      decay: Number(light.decay),
    });
  }
  return result;
}
