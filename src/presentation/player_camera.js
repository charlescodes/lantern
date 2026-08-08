// @ts-check

/**
 * Resolves one scalar component of a snapshot pose at the current local
 * render alpha. This is presentation-only interpolation; it is not a network
 * buffer, prediction step, or simulation mutation.
 * @param {number} previous
 * @param {number} current
 * @param {number} alpha
 */
export function interpolateRenderValue(previous, current, alpha) {
  const interpolation = Math.max(0, Math.min(1, Number(alpha) || 0));
  return previous + (current - previous) * interpolation;
}

/**
 * @param {import('../browser/camera.js').Camera2D|import('./camera_3d.js').Camera3D} camera
 * @param {{previousX:number,previousZ:number,x:number,z:number}} player
 * @param {number} alpha
 */
export function focusCameraOnPlayer(camera, player, alpha) {
  camera.focus(
    interpolateRenderValue(player.previousX, player.x, alpha),
    interpolateRenderValue(player.previousZ, player.z, alpha),
  );
}

/**
 * Keeps the play camera attached without overwriting the free edit camera.
 * @param {import('../browser/camera.js').Camera2D|import('./camera_3d.js').Camera3D} camera
 * @param {{previousX:number,previousZ:number,x:number,z:number}} player
 * @param {number} alpha
 * @param {"play"|"edit"} mode
 */
export function syncPlayerCamera(camera, player, alpha, mode) {
  if (mode !== "play") return false;
  focusCameraOnPlayer(camera, player, alpha);
  return true;
}
