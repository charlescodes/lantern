// @ts-check
import { wallFace } from "../authoring/mechanism_catalog.js";

/** Runtime floor and editor selection are independent; draw devices on the visible floor. */
export function visibleMechanismInstances(snapshot) {
  const instances = snapshot.authoring?.instances ?? [];
  if (!snapshot.mechanisms) return instances;
  return [
    ...instances.filter((instance) => !instance.definitionId.startsWith("mechanism.")),
    ...snapshot.mechanisms.devices.filter((device) => device.layerId === snapshot.map.layerId),
  ];
}

export function mechanismVisual(instance, runtime, alpha = 1) {
  const kind = instance.definitionId;
  if (!kind.startsWith("mechanism.")) return null;
  const face = ["mechanism.button", "mechanism.chain", "mechanism.bolt-emitter", "mechanism.spell-emitter", "mechanism.wall-spear"].includes(kind) ? wallFace(instance) : instance;
  if (kind === "mechanism.gate") return { x: face.x, z: face.z, y: runtime?.open ? 0.035 : 0.95,
    width: 0.98, depth: 0.98, height: runtime?.open ? 0.07 : 1.9, color: runtime?.blocked ? 0xd39944 : 0x527b82 };
  if (kind === "mechanism.mover" || kind === "mechanism.spiked-mover") return {
    x: runtime?.previousX === undefined ? runtime?.x ?? face.x : runtime.previousX + (runtime.x - runtime.previousX) * alpha,
    z: runtime?.previousZ === undefined ? runtime?.z ?? face.z : runtime.previousZ + (runtime.z - runtime.previousZ) * alpha,
    y: 0.95, width: 1, depth: 1, height: 1.9,
    color: runtime?.blocked ? 0xd39944 : kind === "mechanism.spiked-mover" ? 0x914f51 : 0x777c83 };
  if (kind === "mechanism.floor-spikes") {
    const height = Math.max(0.025, (runtime?.phase ?? 0) / 12 * 0.8);
    return { x: face.x, z: face.z, y: height / 2, width: 0.85, depth: 0.85, height, color: height >= 0.4 ? 0xc84c4c : 0x676d75 };
  }
  if (kind === "mechanism.wall-spear") {
    const reach = runtime?.reach ?? 0;
    return { x: face.x + face.dx * reach / 2, z: face.z + face.dz * reach / 2, y: 0.9,
      width: Math.max(0.08, Math.abs(face.dx) * reach), depth: Math.max(0.08, Math.abs(face.dz) * reach), height: 0.08, color: 0xc4c7cb };
  }
  if (kind === "mechanism.bolt-emitter" || kind === "mechanism.spell-emitter") return {
    x: face.x, z: face.z, y: 0.9, width: 0.25, depth: 0.25, height: 0.25,
    color: kind === "mechanism.spell-emitter" ? 0xeb763a : 0xaab8c5 };
  if (kind === "mechanism.lever") return { x: face.x, z: face.z, y: 0.3, width: 0.15,
    depth: runtime?.on ? 0.5 : 0.22, height: runtime?.on ? 0.2 : 0.6, color: runtime?.on ? 0x8fe0aa : 0xe9cc86 };
  return { x: face.x, z: face.z, y: kind === "mechanism.chain" ? 0.85 : 0.8,
    width: kind === "mechanism.chain" ? 0.09 : 0.24, depth: 0.12,
    height: kind === "mechanism.chain" ? 0.9 : 0.24, color: 0xe9cc86 };
}

/** Bounded edit-only segments with explicit arrow heads. Logic stays in the panel. */
export function mechanismWires(authoring, selectedId) {
  const nodes = new Map((authoring?.mechanismNodes ?? []).map((n) => [n.id,
    n.nodeKind === "connector" ? { ...n, layerId: [n.lowerLayerId, n.upperLayerId].includes(authoring?.activeLayer?.id)
      ? authoring.activeLayer.id : `${n.lowerLayerId}/${n.upperLayerId}` } : n]));
  const layer = authoring?.activeLayer?.id, segments = [], badges = [];
  for (const link of authoring?.mechanisms?.links ?? []) {
    const from = nodes.get(link.from.nodeId), to = nodes.get(link.to.nodeId);
    if (!from || !to) continue;
    const selected = from.id === selectedId || to.id === selectedId;
    const color = selected ? 0xfff1b0 : 0x76d2ff;
    if (from.layerId === layer && to.layerId === layer) {
      segments.push({ from, to, color });
      const dx = to.x - from.x, dz = to.z - from.z, distance = Math.hypot(dx, dz) || 1;
      const x = from.x + dx * 0.75, z = from.z + dz * 0.75;
      for (const sign of [-1, 1]) segments.push({ from: { x, z }, to: {
        x: x - dx / distance * 0.25 + sign * dz / distance * 0.15,
        z: z - dz / distance * 0.25 - sign * dx / distance * 0.15 }, color });
    } else {
      for (const [local, remote, arrow] of [[from, to, "→"], [to, from, "←"]]) {
        if (local.layerId === layer) badges.push({ x: local.x, z: local.z, color,
          label: `${arrow} ${remote.layerId ?? "logic"}: ${remote.id}` });
      }
    }
  }
  return { segments, badges };
}
