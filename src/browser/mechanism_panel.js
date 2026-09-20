// @ts-check
import { MECHANISM_DEFINITIONS, mechanismProperties } from "../authoring/mechanism_catalog.js";

/** Shared descriptor-driven properties: both physical devices and graph nodes. */
export function mechanismPropertyForm(definitionId, properties, onApply) {
  const form = document.createElement("form");
  form.className = "authoring-properties-form";
  const definition = MECHANISM_DEFINITIONS[definitionId], inputs = new Map();
  for (const [key, descriptor] of Object.entries(definition.properties)) {
    const label = document.createElement("label"); label.textContent = key;
    const input = document.createElement(descriptor.type === "enum" ? "select" : "input");
    input.name = key;
    const value = properties?.[key] ?? descriptor.default;
    if (descriptor.type === "enum") {
      for (const choice of descriptor.values) {
        const option = document.createElement("option"); option.value = choice; option.textContent = choice;
        option.selected = choice === value; input.append(option);
      }
    } else if (descriptor.type === "boolean") { input.type = "checkbox"; input.checked = value; }
    else { input.type = "number"; input.min = String(descriptor.min); input.max = String(descriptor.max); input.step = descriptor.type === "number" ? "any" : "1"; input.value = String(value); }
    label.append(input); form.append(label); inputs.set(key, input);
  }
  const apply = document.createElement("button"); apply.type = "submit"; apply.textContent = "Apply properties";
  const status = document.createElement("output");
  form.append(apply, status);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    try {
      const values = Object.fromEntries([...inputs].map(([key, input]) => [key,
        definition.properties[key].type === "boolean" ? input.checked
          : ["integer", "number"].includes(definition.properties[key].type) ? Number(input.value) : input.value]));
      const result = onApply(mechanismProperties(definitionId, values));
      status.textContent = result === false || result?.ok === false ? "Edit rejected; see editor status" : "Applied";
    } catch (error) { status.textContent = error.message; }
  });
  return form;
}

export class MechanismPanel {
  constructor(root, editor) {
    this.editor = editor; this.signature = "";
    this.root = document.createElement("section");
    this.root.className = "mechanism-panel"; root.append(this.root);
  }
  update(snapshot, view) {
    this.root.hidden = view.activeChannel !== "mechanisms" && view.activeTool !== "wire";
    if (this.root.hidden) return;
    const signature = JSON.stringify([snapshot.authoring.revision, view.selectedMechanismId, view.wireSource, view.wireTarget, view.activeLayerId]);
    if (signature === this.signature) return;
    this.signature = signature; this.root.replaceChildren();
    const heading = document.createElement("h3"); heading.textContent = "Mechanism graph"; this.root.append(heading);
    const help = document.createElement("p"); help.textContent = "Wire: choose a source, then a target. Select devices on the map or in this list. Floor badges identify cross-floor endpoints."; this.root.append(help);
    const button = (label, callback, root = this.root) => {
      const element = document.createElement("button"); element.type = "button"; element.textContent = label;
      element.addEventListener("click", callback); root.append(element); return element;
    };
    const definitionSelect = document.createElement("select"); definitionSelect.setAttribute("aria-label", "Logic device type");
    for (const id of Object.keys(MECHANISM_DEFINITIONS).filter((id) => id.startsWith("logic."))) {
      const option = document.createElement("option"); option.value = id; option.textContent = id; definitionSelect.append(option);
    }
    this.root.append(definitionSelect);
    button("Add logic device", () => this.editor.editMechanism({ type: "addMechanismNode", definitionId: definitionSelect.value }));
    const list = document.createElement("div"); list.className = "mechanism-node-list"; this.root.append(list);
    for (const node of snapshot.authoring.mechanismNodes ?? []) {
      button(`${node.id} · ${node.definitionId} [${node.nodeKind === "connector" ? `${node.lowerLayerId} ↔ ${node.upperLayerId}` : node.layerId ?? "logic"}]`, () => this.editor.selectMechanism(node.id), list);
    }
    if (view.wireSource) {
      const status = document.createElement("p"); status.textContent = `Source: ${view.wireSource} → ${view.wireTarget ?? "choose target"}`; this.root.append(status);
      button("Cancel wire", () => { this.editor.wireSource = null; this.editor.wireTarget = null; });
      for (const pair of view.wirePairs) button(`${pair.from} → ${pair.to} (${pair.type})`, () => this.editor.completeWire(pair.from, pair.to));
    }
    const selected = snapshot.authoring.mechanismNodes?.find((n) => n.id === view.selectedMechanismId);
    if (selected) {
      const title = document.createElement("h4"); title.textContent = selected.id; this.root.append(title);
      const apply = (properties) => this.editor.editMechanism(selected.layerId
        ? { type: "updateInstanceProperties", authoringId: selected.id, layerId: selected.layerId, properties }
        : { type: "updateMechanismNode", nodeId: selected.id, properties });
      if (selected.nodeKind === "connector") {
        const notice = document.createElement("p"); notice.textContent = "Edit lift timing and mode in the connector inspector."; this.root.append(notice);
      } else this.root.append(mechanismPropertyForm(selected.definitionId, selected.properties, apply));
      if (!selected.layerId && selected.nodeKind !== "connector") button("Delete logic device", () => this.editor.editMechanism({ type: "removeMechanismNode", nodeId: selected.id }));
      const advanced = document.createElement("details"), summary = document.createElement("summary"), json = document.createElement("textarea");
      summary.textContent = "Advanced properties JSON"; json.value = JSON.stringify(selected.properties ?? {}, null, 2); advanced.append(summary, json);
      const status = document.createElement("output");
      button("Apply JSON", () => {
        try { apply(mechanismProperties(selected.definitionId, JSON.parse(json.value))); }
        catch (error) { status.textContent = error.message; }
      }, advanced); advanced.append(status); if (selected.nodeKind !== "connector") this.root.append(advanced);
    }
    for (const link of snapshot.authoring.mechanisms?.links ?? []) {
      if (selected && link.from.nodeId !== selected.id && link.to.nodeId !== selected.id) continue;
      const endpoint = (e) => {
        const node = snapshot.authoring.mechanismNodes.find((n) => n.id === e.nodeId);
        return `${e.nodeId}.${e.port} [${node?.nodeKind === "connector" ? `${node.lowerLayerId} ↔ ${node.upperLayerId}` : node?.layerId ?? "logic"}]`;
      };
      button(`Unwire ${endpoint(link.from)} → ${endpoint(link.to)}`, () => this.editor.editMechanism({ type: "removeMechanismLink", linkId: link.id }));
    }
  }
}
