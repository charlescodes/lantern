// @ts-check

export const HEALTH_BAR = Object.freeze({
  widthMeters: 0.10,
  heightMeters: 0.90,
  actorGapMeters: 0.14,
  trackColor: 0x161c19,
  trackEdgeColor: 0xc4cec7,
  green: 0x58cf78,
  amber: 0xe0a442,
  red: 0xe05555,
});

/** @param {number} health @param {number} maximumHealth */
export function healthBarRatio(health, maximumHealth) {
  if (!(maximumHealth > 0)) return 0;
  return Math.max(0, Math.min(1, health / maximumHealth));
}

/** @param {number} ratio */
export function healthBarColor(ratio) {
  if (ratio > 0.5) return HEALTH_BAR.green;
  if (ratio > 0.25) return HEALTH_BAR.amber;
  return HEALTH_BAR.red;
}

/** @param {number} color */
export function colorHexCss(color) {
  return `#${(Number(color) >>> 0).toString(16).padStart(6, "0")}`;
}
