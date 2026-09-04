// @ts-check

import { getPlaceableDefinition } from "../authoring/definition_catalog.js";
import { getFootprintBounds, getOccupiedCells } from "../authoring/footprint.js";

/** @param {HTMLElement} list @param {string} label @param {unknown} value */
function appendRow(list, label, value) {
  const term = document.createElement("dt");
  term.textContent = label;
  const detail = document.createElement("dd");
  detail.textContent = String(value);
  list.append(term, detail);
}

/** @param {Record<string,any>} snapshot @param {Record<string,any>} target */
function cellDetails(snapshot, target) {
  const layer = snapshot.authoring.activeLayer;
  const index = target.z * layer.width + target.x;
  const surfaceCode = snapshot.map.surface.cells[index];
  const structureCode = snapshot.map.structure.cells[index];
  return {
    surfaceDefinitionId: snapshot.map.surface.legend[surfaceCode] ?? "empty",
    structureDefinitionId: snapshot.map.structure.legend[structureCode] ?? "empty",
    solid: snapshot.map.cells[index] === 1,
    occluding: snapshot.map.occluderCells[index] === 1,
  };
}

export class AuthoringInspector {
  /**
   * @param {{
   * root?:HTMLElement|null,
   * onUpdate:(instanceId:string,transform:{x:number,z:number,rotation:number})=>boolean|{ok:boolean,message?:string},
   * onUpdateProperties?:(instanceId:string,properties:Record<string,unknown>)=>boolean|{ok:boolean,message?:string},
   * onRotate:(instanceId:string)=>boolean|{ok:boolean,message?:string},
   * onDelete:(instanceId:string)=>boolean|{ok:boolean,message?:string},
   * onUpdateConnector?:(connectorId:string,changes:Record<string,unknown>)=>boolean|{ok:boolean,message?:string},
   * onDeleteConnector?:(connectorId:string)=>boolean|{ok:boolean,message?:string},
   * onUpdateNavigationNode?:(nodeId:string,changes:Record<string,unknown>)=>boolean|{ok:boolean,message?:string},
   * onDeleteNavigationNode?:(nodeId:string)=>boolean|{ok:boolean,message?:string},
   * }} options
   */
  constructor(options) {
    this.root = options.root ?? document.getElementById("authoring-inspector");
    if (!this.root) throw new Error("Missing #authoring-inspector");
    this.onUpdate = options.onUpdate;
    this.onUpdateProperties = options.onUpdateProperties ?? (() => false);
    this.onRotate = options.onRotate;
    this.onDelete = options.onDelete;
    this.onUpdateConnector = options.onUpdateConnector ?? (() => false);
    this.onDeleteConnector = options.onDeleteConnector ?? (() => false);
    this.onUpdateNavigationNode = options.onUpdateNavigationNode ?? (() => false);
    this.onDeleteNavigationNode = options.onDeleteNavigationNode ?? (() => false);
    this.collapsed = false;
    this.signature = "";
    this.#renderShell();
  }

  #renderShell() {
    this.root.replaceChildren();
    this.root.dataset.collapsed = "false";
    const heading = document.createElement("header");
    heading.className = "authoring-inspector-heading";
    const titleWrap = document.createElement("div");
    const eyebrow = document.createElement("p");
    eyebrow.className = "eyebrow";
    eyebrow.textContent = "Stable authoring identity";
    const title = document.createElement("h2");
    title.textContent = "Selection inspector";
    titleWrap.append(eyebrow, title);
    this.collapseButton = document.createElement("button");
    this.collapseButton.type = "button";
    this.collapseButton.textContent = "Collapse";
    this.collapseButton.setAttribute("aria-expanded", "true");
    this.collapseButton.addEventListener("click", () => this.setCollapsed(!this.collapsed));
    heading.append(titleWrap, this.collapseButton);

    this.body = document.createElement("div");
    this.body.className = "authoring-inspector-body";
    this.body.id = "authoring-inspector-body";
    this.collapseButton.setAttribute("aria-controls", this.body.id);
    this.content = document.createElement("div");
    this.content.className = "authoring-inspector-content";
    this.status = document.createElement("output");
    this.status.className = "authoring-inspector-status";
    this.status.dataset.valid = "true";
    this.status.textContent = "Select an authored cell or instance.";
    this.body.append(this.content, this.status);
    this.root.append(heading, this.body);
  }

  /** @param {Record<string,any>} snapshot @param {Record<string,any>} editor */
  update(snapshot, editor) {
    const target = editor.selectedTarget;
    const targetKey = target?.kind === "instance"
      ? `instance:${target.layerId}:${target.instanceId}`
      : target?.kind === "connector"
        ? `connector:${target.layerId}:${target.connectorId}`
      : target?.kind === "navigation-node"
        ? `navigation-node:${target.layerId}:${target.nodeId}`
      : target?.kind === "connector-endpoint"
        ? `connector-endpoint:${target.layerId}:${target.connectorId}:${target.stop}`
      : target?.kind === "cell"
        ? `cell:${target.layerId}:${target.x}:${target.z}`
        : "none";
    const signature = `${snapshot.authoring.revision}:${targetKey}`;
    if (signature !== this.signature) {
      this.signature = signature;
      this.#renderSelection(snapshot, target);
    }
    if (editor.status?.message) {
      this.showStatus(editor.status.message, editor.status.valid);
    }
  }

  /** @param {Record<string,any>} snapshot @param {Record<string,any>|null} target */
  #renderSelection(snapshot, target) {
    this.content.replaceChildren();
    if (!target) {
      const empty = document.createElement("p");
      empty.className = "authoring-inspector-empty";
      empty.textContent = "Use Select, then click a cell or sparse instance.";
      this.content.append(empty);
      this.showStatus("No authoring selection", true);
      return;
    }
    if (target.kind === "cell") {
      const details = cellDetails(snapshot, target);
      const list = document.createElement("dl");
      list.className = "authoring-inspector-list";
      appendRow(list, "Layer", target.layerId);
      appendRow(list, "Cell", `${target.x}, ${target.z}`);
      appendRow(list, "Surface", details.surfaceDefinitionId);
      appendRow(list, "Structure", details.structureDefinitionId);
      appendRow(list, "Solid", details.solid ? "yes" : "no");
      appendRow(list, "Occluding", details.occluding ? "yes" : "no");
      this.content.append(list);
      this.showStatus("Compiled flags are read-only diagnostics", true);
      return;
    }
    if (target.kind === "connector") {
      this.#renderConnector(snapshot, target);
      return;
    }
    if (target.kind === "navigation-node") {
      this.#renderNavigationNode(snapshot, target);
      return;
    }
    if (target.kind === "connector-endpoint") {
      const list = document.createElement("dl");
      list.className = "authoring-inspector-list";
      appendRow(list, "Endpoint", `${target.connectorId} · ${target.stop}`);
      appendRow(list, "Layer", target.layerId);
      appendRow(list, "Use", "Link tool endpoint");
      this.content.append(list);
      this.showStatus("Connector endpoint is a topology link anchor", true);
      return;
    }

    const instance = snapshot.authoring.instances.find(
      (candidate) => candidate.id === target.instanceId,
    );
    if (!instance) {
      this.showStatus("The selected instance no longer exists", false);
      return;
    }
    const definition = getPlaceableDefinition(instance.definitionId);
    if (!definition) {
      this.showStatus(`Unknown definition ${instance.definitionId}`, false);
      return;
    }
    const occupiedCells = getOccupiedCells(definition, instance);
    const bounds = getFootprintBounds(occupiedCells);
    const list = document.createElement("dl");
    list.className = "authoring-inspector-list";
    appendRow(list, "Authoring ID", instance.id);
    appendRow(list, "Definition", `${definition.label} · ${definition.id}`);
    appendRow(list, "Layer", target.layerId);
    appendRow(
      list,
      "Footprint",
      `${bounds?.width ?? 0}×${bounds?.height ?? 0} · ${occupiedCells.map((cell) => `${cell.cx},${cell.cz}`).join(" · ")}`,
    );
    appendRow(list, "Blocks movement", definition.traits.blocksMovement ? "yes" : "no");
    appendRow(list, "Blocks sight", definition.traits.blocksSight ? "yes" : "no");
    this.content.append(list);

    const form = document.createElement("form");
    form.className = "authoring-transform-form";
    const xLabel = document.createElement("label");
    xLabel.textContent = "X";
    const xInput = document.createElement("input");
    xInput.name = "x";
    xInput.type = "number";
    xInput.step = definition.traits.snap === "tenth" ? "0.1" : "1";
    xInput.value = String(instance.x);
    xLabel.append(xInput);
    const zLabel = document.createElement("label");
    zLabel.textContent = "Z";
    const zInput = document.createElement("input");
    zInput.name = "z";
    zInput.type = "number";
    zInput.step = definition.traits.snap === "tenth" ? "0.1" : "1";
    zInput.value = String(instance.z);
    zLabel.append(zInput);
    const rotationLabel = document.createElement("label");
    rotationLabel.textContent = "Rotation";
    const rotationInput = document.createElement("select");
    rotationInput.name = "rotation";
    for (let turns = 0; turns < 4; turns += 1) {
      const option = document.createElement("option");
      option.value = String(turns);
      option.textContent = `${turns * 90}°`;
      option.selected = turns === instance.rotation;
      rotationInput.append(option);
    }
    rotationLabel.append(rotationInput);
    const applyButton = document.createElement("button");
    applyButton.type = "submit";
    applyButton.className = "accent-button";
    applyButton.textContent = "Apply transform";
    form.append(xLabel, zLabel, rotationLabel, applyButton);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const x = Number(xInput.value);
      const z = Number(zInput.value);
      const rotation = Number(rotationInput.value);
      if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isInteger(rotation)) {
        this.showStatus("X/Z must be finite and rotation must be a quarter turn", false);
        return;
      }
      const result = this.onUpdate(instance.id, { x, z, rotation });
      const ok = typeof result === "boolean" ? result : result.ok;
      if (!ok) this.showStatus(
        typeof result === "object" && result.message
          ? result.message
          : "Transform rejected; authored source was not changed",
        false,
      );
    });
    this.content.append(form);

    const actions = document.createElement("div");
    actions.className = "authoring-inspector-actions";
    const rotateButton = document.createElement("button");
    rotateButton.type = "button";
    rotateButton.textContent = "Rotate 90°";
    rotateButton.addEventListener("click", () => {
      const result = this.onRotate(instance.id);
      const ok = typeof result === "boolean" ? result : result.ok;
      if (!ok) this.showStatus(
        typeof result === "object" && result.message
          ? result.message
          : "Rotation rejected; authored source was not changed",
        false,
      );
    });
    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "danger-button";
    deleteButton.textContent = "Delete instance";
    deleteButton.addEventListener("click", () => {
      const result = this.onDelete(instance.id);
      const ok = typeof result === "boolean" ? result : result.ok;
      if (!ok) this.showStatus(
        typeof result === "object" && result.message
          ? result.message
          : "Delete rejected; instance may no longer exist",
        false,
      );
    });
    actions.append(rotateButton, deleteButton);
    this.content.append(actions);

    const properties = document.createElement("details");
    const summary = document.createElement("summary");
    summary.textContent = "Definition-specific properties";
    const propertyForm = document.createElement("form");
    propertyForm.className = "authoring-properties-form";
    const propertyInput = document.createElement("textarea");
    propertyInput.name = "properties";
    propertyInput.rows = 5;
    propertyInput.spellcheck = false;
    propertyInput.value = JSON.stringify(instance.properties ?? {}, null, 2);
    propertyInput.setAttribute("aria-label", "Instance properties JSON");
    const propertyButton = document.createElement("button");
    propertyButton.type = "submit";
    propertyButton.textContent = "Apply properties";
    propertyForm.append(propertyInput, propertyButton);
    propertyForm.addEventListener("submit", (event) => {
      event.preventDefault();
      let parsed;
      try {
        parsed = JSON.parse(propertyInput.value);
      } catch (error) {
        this.showStatus(
          `Properties must be valid JSON: ${error instanceof Error ? error.message : String(error)}`,
          false,
        );
        return;
      }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        this.showStatus("Properties must be a JSON object", false);
        return;
      }
      const result = this.onUpdateProperties(instance.id, parsed);
      const ok = typeof result === "boolean" ? result : result.ok;
      if (!ok) this.showStatus(
        typeof result === "object" && result.message
          ? result.message
          : "Properties rejected; authored source was not changed",
        false,
      );
    });
    properties.append(summary, propertyForm);
    this.content.append(properties);
    this.showStatus("Transform edits validate and commit through authoring actions", true);
  }

  /** @param {Record<string,any>} snapshot @param {Record<string,any>} target */
  #renderConnector(snapshot, target) {
    const connector = (snapshot.authoring.connectors ?? []).find(
      (candidate) => candidate.id === target.connectorId,
    );
    if (!connector) {
      this.showStatus("The selected connector no longer exists", false);
      return;
    }
    const definition = getPlaceableDefinition(connector.definitionId);
    const list = document.createElement("dl");
    list.className = "authoring-inspector-list";
    appendRow(list, "Connector ID", connector.id);
    appendRow(list, "Definition", `${definition?.label ?? connector.definitionId} · ${connector.definitionId}`);
    appendRow(list, "Visible endpoint", target.layerId);
    appendRow(list, "Lower layer", connector.lowerLayerId);
    appendRow(list, "Upper layer", connector.upperLayerId);
    this.content.append(list);

    const form = document.createElement("form");
    form.className = "authoring-transform-form";
    const addSelect = (labelText, name, value, values) => {
      const label = document.createElement("label");
      label.textContent = labelText;
      const select = document.createElement("select");
      select.name = name;
      for (const item of values) {
        const option = document.createElement("option");
        option.value = String(item.value);
        option.textContent = String(item.label);
        option.selected = String(item.value) === String(value);
        select.append(option);
      }
      label.append(select);
      form.append(label);
      return select;
    };
    const addNumber = (labelText, name, value, step) => {
      const label = document.createElement("label");
      label.textContent = labelText;
      const input = document.createElement("input");
      input.type = "number";
      input.name = name;
      input.step = step;
      input.value = String(value);
      label.append(input);
      form.append(label);
      return input;
    };
    const layerOptions = snapshot.authoring.layers.map((layer) => ({
      value: layer.id,
      label: `${layer.name} · ${layer.baseY} m`,
    }));
    const lower = addSelect("Lower layer", "lowerLayerId", connector.lowerLayerId, layerOptions);
    const upper = addSelect("Upper layer", "upperLayerId", connector.upperLayerId, layerOptions);
    const x = addNumber("X", "x", connector.x, "0.1");
    const z = addNumber("Z", "z", connector.z, "0.1");
    const platformWidth = addNumber("Platform width", "platformWidth", connector.platformWidth, "0.01");
    const apertureWidth = addNumber("Aperture width", "apertureWidth", connector.apertureWidth, "0.01");
    const travelDurationSeconds = addNumber(
      "Travel duration (seconds)",
      "travelDurationSeconds",
      connector.travelDurationSeconds,
      "0.1",
    );
    const dwellSeconds = addNumber("Dwell seconds", "dwellSeconds", connector.dwellSeconds, "0.05");
    const initialStop = addSelect("Initial stop", "initialStop", connector.initialStop, [
      { value: "lower", label: "Lower" },
      { value: "upper", label: "Upper" },
    ]);
    const apply = document.createElement("button");
    apply.type = "submit";
    apply.className = "accent-button";
    apply.textContent = "Apply connector";
    form.append(apply);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const changes = {
        lowerLayerId: lower.value,
        upperLayerId: upper.value,
        x: Number(x.value),
        z: Number(z.value),
        platformWidth: Number(platformWidth.value),
        apertureWidth: Number(apertureWidth.value),
        travelDurationSeconds: Number(travelDurationSeconds.value),
        dwellSeconds: Number(dwellSeconds.value),
        initialStop: initialStop.value,
      };
      if ([changes.x, changes.z, changes.platformWidth, changes.apertureWidth,
        changes.travelDurationSeconds, changes.dwellSeconds].some((value) => !Number.isFinite(value))) {
        this.showStatus("Connector numeric values must be finite", false);
        return;
      }
      const result = this.onUpdateConnector(connector.id, changes);
      const ok = typeof result === "boolean" ? result : result.ok;
      if (!ok) this.showStatus(
        typeof result === "object" && result.message
          ? result.message
          : "Connector update was rejected",
        false,
      );
    });
    this.content.append(form);

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "danger-button";
    deleteButton.textContent = "Delete connector";
    deleteButton.addEventListener("click", () => {
      const result = this.onDeleteConnector(connector.id);
      const ok = typeof result === "boolean" ? result : result.ok;
      if (!ok) this.showStatus(
        typeof result === "object" && result.message
          ? result.message
          : "Connector deletion was rejected",
        false,
      );
    });
    this.content.append(deleteButton);
    this.showStatus("Live motion is runtime state and is never authored", true);
  }

  /** @param {Record<string,any>} snapshot @param {Record<string,any>} target */
  #renderNavigationNode(snapshot, target) {
    const node = (snapshot.authoring.navigationNodes ?? []).find((candidate) => candidate.id === target.nodeId);
    if (!node) {
      this.showStatus("The selected navigation node no longer exists", false);
      return;
    }
    const list = document.createElement("dl");
    list.className = "authoring-inspector-list";
    appendRow(list, "Navigation ID", node.id);
    appendRow(list, "Layer", node.layerId);
    appendRow(list, "Cell", `${node.cx}, ${node.cz}`);
    this.content.append(list);

    const form = document.createElement("form");
    form.className = "authoring-transform-form";
    const addNumber = (labelText, name, value) => {
      const label = document.createElement("label");
      label.textContent = labelText;
      const input = document.createElement("input");
      input.type = "number";
      input.name = name;
      input.step = "1";
      input.value = String(value);
      label.append(input);
      form.append(label);
      return input;
    };
    const cx = addNumber("Cell X", "cx", node.cx);
    const cz = addNumber("Cell Z", "cz", node.cz);
    const patrolLabel = document.createElement("label");
    const patrol = document.createElement("input");
    patrol.type = "checkbox";
    patrol.name = "patrol";
    patrol.checked = node.patrol === true;
    patrolLabel.append(patrol, " Patrol node");
    const apply = document.createElement("button");
    apply.type = "submit";
    apply.className = "accent-button";
    apply.textContent = "Apply navigation node";
    form.append(patrolLabel, apply);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const changes = { cx: Number(cx.value), cz: Number(cz.value), patrol: patrol.checked };
      if (!Number.isInteger(changes.cx) || !Number.isInteger(changes.cz)) {
        this.showStatus("Cell X/Z must be integers", false);
        return;
      }
      const result = this.onUpdateNavigationNode(node.id, changes);
      const ok = typeof result === "boolean" ? result : result.ok;
      if (!ok) this.showStatus(
        typeof result === "object" && result.message
          ? result.message
          : "Navigation node update was rejected",
        false,
      );
    });
    this.content.append(form);

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "danger-button";
    deleteButton.textContent = "Delete navigation node";
    deleteButton.addEventListener("click", () => {
      const result = this.onDeleteNavigationNode(node.id);
      const ok = typeof result === "boolean" ? result : result.ok;
      if (!ok) this.showStatus(
        typeof result === "object" && result.message
          ? result.message
          : "Navigation node deletion was rejected",
        false,
      );
    });
    this.content.append(deleteButton);
    this.showStatus("Cell edits use the same authored-grid validation as pointer edits", true);
  }

  /** @param {string} message @param {boolean} valid */
  showStatus(message, valid) {
    this.status.textContent = message;
    this.status.dataset.valid = String(Boolean(valid));
  }

  /** @param {boolean} collapsed */
  setCollapsed(collapsed) {
    this.collapsed = Boolean(collapsed);
    this.root.dataset.collapsed = String(this.collapsed);
    this.body.hidden = this.collapsed;
    this.collapseButton.textContent = this.collapsed ? "Expand" : "Collapse";
    this.collapseButton.setAttribute("aria-expanded", String(!this.collapsed));
  }
}
