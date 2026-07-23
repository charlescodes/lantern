// @ts-check

/** @param {import('./true_sight.js').TrueSightFrame} sightFrame @param {Record<string,unknown>|null} entity */
export function isEntityVisible(sightFrame, entity) {
  if (!entity?.position) return false;
  const position = /** @type {{x:number,z:number}} */ (entity.position);
  return sightFrame.isCircleVisible(
    position.x,
    position.z,
    Math.max(0, Number(entity.radius) || 0),
  );
}

/**
 * TrueSight gates the local presentation query without changing the
 * simulation's unrestricted diagnostic queryAt API.
 *
 * @param {{queryAt:(x:number,z:number)=>Record<string,unknown>}} simulation
 * @param {import('./true_sight.js').TrueSightFrame} sightFrame
 * @param {number} x
 * @param {number} z
 * @param {"play"|"edit"} mode
 */
export function queryVisibleAt(simulation, sightFrame, x, z, mode) {
  if (mode !== "edit" && !sightFrame.isPointVisible(x, z)) return null;
  return simulation.queryAt(x, z);
}

/**
 * @param {{resolveSelection:(selection:{kind:string,id:number|string})=>Record<string,unknown>|null}} simulation
 * @param {import('./true_sight.js').TrueSightFrame} sightFrame
 * @param {{kind:string,id:number|string}|null} pinned
 */
export function resolveVisibleSelection(simulation, sightFrame, pinned) {
  if (!pinned) return { entity: null, hidden: false };
  const entity = simulation.resolveSelection(pinned);
  const visible = Boolean(entity && isEntityVisible(sightFrame, entity));
  return {
    entity: visible ? entity : null,
    hidden: Boolean(entity && !visible),
  };
}
