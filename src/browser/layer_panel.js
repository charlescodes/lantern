// @ts-check

/** @param {unknown} value */
function finiteNumber(value) {
  if (typeof value === "string" && value.trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/** @param {Record<string,any>} diagnostic */
function diagnosticText(diagnostic) {
  const path = diagnostic.path ? `${diagnostic.path}: ` : "";
  return `${path}${diagnostic.message ?? diagnostic.code ?? "Invalid map"}`;
}

export class LayerPanel {
  /**
   * @param {{
   * root?:HTMLElement|null,
   * onActivate?:(layerId:string)=>boolean,
   * onReference?:(layerId:string|null)=>boolean,
   * onCreate?:(direction:"above"|"below")=>string|null,
   * onRename?:(layerId:string,name:string)=>boolean,
   * onBaseY?:(layerId:string,baseY:number)=>boolean,
   * onDelete?:(layerId:string)=>boolean,
   * onSetStart?:(layerId:string)=>boolean,
   * onValidate?:()=>Record<string,any>,
   * }} [options]
   */
  constructor(options = {}) {
    this.root = options.root ?? document.getElementById("layer-panel");
    if (!this.root) throw new Error("Missing #layer-panel");
    this.onActivate = options.onActivate ?? (() => false);
    this.onReference = options.onReference ?? (() => false);
    this.onCreate = options.onCreate ?? (() => null);
    this.onRename = options.onRename ?? (() => false);
    this.onBaseY = options.onBaseY ?? (() => false);
    this.onDelete = options.onDelete ?? (() => false);
    this.onSetStart = options.onSetStart ?? (() => false);
    this.onValidate = options.onValidate ?? (() => ({
      diagnostics: [],
      errorCount: 0,
      warningCount: 0,
    }));
    this.collapsed = false;
    this.editor = null;
    this.externalValidation = null;
    this.externalRevision = null;
    this.signature = "";
    this.#renderShell();
  }

  #renderShell() {
    this.root.replaceChildren();
    this.root.dataset.collapsed = "false";
    const heading = document.createElement("header");
    heading.className = "layer-panel-heading";
    const titleWrap = document.createElement("div");
    const eyebrow = document.createElement("p");
    eyebrow.className = "eyebrow";
    eyebrow.textContent = "Stable floor identity";
    const title = document.createElement("h2");
    title.textContent = "Layers";
    titleWrap.append(eyebrow, title);
    this.collapseButton = document.createElement("button");
    this.collapseButton.type = "button";
    this.collapseButton.textContent = "Collapse";
    this.collapseButton.setAttribute("aria-expanded", "true");
    this.collapseButton.addEventListener("click", () => this.setCollapsed(!this.collapsed));
    heading.append(titleWrap, this.collapseButton);

    this.body = document.createElement("div");
    this.body.id = "layer-panel-body";
    this.body.className = "layer-panel-body";
    this.collapseButton.setAttribute("aria-controls", this.body.id);
    this.root.append(heading, this.body);
  }

  /** @param {Record<string,any>} editor */
  sync(editor) {
    this.editor = editor;
    const currentRevision = editor.history?.currentRevisionId ?? null;
    if (this.externalValidation && this.externalRevision !== currentRevision) {
      this.externalValidation = null;
      this.externalRevision = null;
    }
    const validation = this.externalValidation ?? editor.validation ?? {};
    const signature = JSON.stringify({
      active: editor.activeLayerId,
      reference: editor.referenceLayerId,
      start: editor.playerStartLayerId,
      capacity: editor.layerCapacity,
      layers: editor.layers,
      revision: editor.history?.currentRevisionId ?? null,
      diagnostics: validation.diagnostics ?? [],
    });
    if (signature === this.signature) return;
    const focused = document.activeElement;
    if (
      focused
      && this.root.contains(focused)
      && focused.matches?.("input, textarea, select, [contenteditable='true']")
    ) return;
    this.signature = signature;
    this.#renderBody(validation);
  }

  /** Display rejected parse/migration/load diagnostics without replacing the current map. */
  setExternalDiagnostics(validation) {
    this.externalValidation = validation
      ? {
        diagnostics: (validation.diagnostics ?? []).map((entry) => ({ ...entry })),
        errorCount: Number(validation.errorCount ?? 0),
        warningCount: Number(validation.warningCount ?? 0),
      }
      : null;
    this.externalRevision = this.externalValidation
      ? this.editor?.history?.currentRevisionId ?? null
      : null;
    this.signature = "";
    if (this.editor) this.sync(this.editor);
  }

  clearExternalDiagnostics() {
    if (!this.externalValidation) return;
    this.externalValidation = null;
    this.externalRevision = null;
    this.signature = "";
    if (this.editor) this.sync(this.editor);
  }

  /** @param {Record<string,any>} validation */
  #renderBody(validation) {
    const editor = this.editor;
    if (!editor) return;
    this.body.replaceChildren();

    const summary = document.createElement("p");
    summary.className = "layer-panel-summary";
    const active = editor.layers.find((layer) => layer.id === editor.activeLayerId);
    summary.textContent = active
      ? `Editing ${active.name} · ${active.baseY} m · ${editor.layers.length}/${editor.layerCapacity}`
      : "No active layer";
    this.body.append(summary);

    const createControls = document.createElement("div");
    createControls.className = "layer-panel-actions";
    for (const [direction, label] of [["above", "New above"], ["below", "New below"]]) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.disabled = editor.layers.length >= editor.layerCapacity;
      button.addEventListener("click", () => this.onCreate(/** @type {"above"|"below"} */ (direction)));
      createControls.append(button);
    }
    const startButton = document.createElement("button");
    startButton.type = "button";
    startButton.textContent = "Go to start";
    startButton.disabled = editor.activeLayerId === editor.playerStartLayerId;
    startButton.addEventListener("click", () => this.onActivate(editor.playerStartLayerId));
    createControls.append(startButton);
    this.body.append(createControls);

    const referenceLabel = document.createElement("label");
    referenceLabel.className = "layer-reference-control";
    referenceLabel.append("Reference overlay");
    const referenceSelect = document.createElement("select");
    const noReference = document.createElement("option");
    noReference.value = "";
    noReference.textContent = "None";
    referenceSelect.append(noReference);
    for (const layer of editor.layers) {
      if (layer.id === editor.activeLayerId) continue;
      const option = document.createElement("option");
      option.value = layer.id;
      option.textContent = `${layer.name} (${layer.baseY} m)`;
      option.selected = layer.id === editor.referenceLayerId;
      referenceSelect.append(option);
    }
    referenceSelect.addEventListener("change", () => {
      this.onReference(referenceSelect.value || null);
    });
    referenceLabel.append(referenceSelect);
    this.body.append(referenceLabel);

    const list = document.createElement("div");
    list.className = "layer-list";
    for (const layer of editor.layers) list.append(this.#layerRow(layer, editor));
    this.body.append(list);

    const validationSection = document.createElement("section");
    validationSection.className = "layer-validation";
    const validationHeading = document.createElement("div");
    validationHeading.className = "layer-validation-heading";
    const validationOutput = document.createElement("output");
    const errorCount = Number(validation.errorCount ?? 0);
    const warningCount = Number(validation.warningCount ?? 0);
    validationOutput.textContent = `${errorCount} errors · ${warningCount} warnings`;
    validationOutput.dataset.valid = String(errorCount === 0);
    const validateButton = document.createElement("button");
    validateButton.type = "button";
    validateButton.textContent = "Validate map";
    validateButton.addEventListener("click", () => {
      const currentValidation = this.onValidate();
      this.externalValidation = null;
      this.externalRevision = null;
      this.signature = "";
      this.#renderBody(currentValidation);
    });
    validationHeading.append(validationOutput, validateButton);
    validationSection.append(validationHeading);
    const diagnostics = validation.diagnostics ?? [];
    if (diagnostics.length > 0) {
      const entries = document.createElement("ul");
      for (const diagnostic of diagnostics) {
        const item = document.createElement("li");
        item.dataset.severity = diagnostic.severity ?? "error";
        const text = document.createElement(diagnostic.layerId ? "button" : "span");
        if (diagnostic.layerId) {
          text.type = "button";
          text.addEventListener("click", () => this.onActivate(diagnostic.layerId));
        }
        text.textContent = diagnosticText(diagnostic);
        item.append(text);
        entries.append(item);
      }
      validationSection.append(entries);
    }
    this.body.append(validationSection);
  }

  /** @param {Record<string,any>} layer @param {Record<string,any>} editor */
  #layerRow(layer, editor) {
    const row = document.createElement("article");
    row.className = "layer-row";
    row.dataset.active = String(layer.id === editor.activeLayerId);
    row.dataset.playerStart = String(layer.id === editor.playerStartLayerId);

    const heading = document.createElement("div");
    heading.className = "layer-row-heading";
    const activate = document.createElement("button");
    activate.type = "button";
    activate.textContent = layer.id === editor.activeLayerId ? "Active" : "Edit";
    activate.disabled = layer.id === editor.activeLayerId;
    activate.addEventListener("click", () => this.onActivate(layer.id));
    const identity = document.createElement("span");
    identity.textContent = `${layer.id}${layer.id === editor.playerStartLayerId ? " · START" : ""}`;
    heading.append(activate, identity);

    const fields = document.createElement("div");
    fields.className = "layer-row-fields";
    const nameLabel = document.createElement("label");
    nameLabel.append("Name");
    const name = document.createElement("input");
    name.type = "text";
    name.value = layer.name;
    name.maxLength = 80;
    name.addEventListener("change", () => {
      if (!this.onRename(layer.id, name.value)) name.value = layer.name;
    });
    nameLabel.append(name);
    const baseLabel = document.createElement("label");
    baseLabel.append("Base Y");
    const baseY = document.createElement("input");
    baseY.type = "number";
    baseY.step = "0.1";
    baseY.value = String(layer.baseY);
    baseY.addEventListener("change", () => {
      const value = finiteNumber(baseY.value);
      if (value === null || !this.onBaseY(layer.id, value)) baseY.value = String(layer.baseY);
    });
    baseLabel.append(baseY);
    fields.append(nameLabel, baseLabel);

    const meta = document.createElement("p");
    meta.textContent = `${layer.width}×${layer.height} · ${layer.instanceCount} instances`;
    const actions = document.createElement("div");
    actions.className = "layer-row-actions";
    if (layer.id !== editor.playerStartLayerId) {
      const setStart = document.createElement("button");
      setStart.type = "button";
      setStart.textContent = "Set start";
      setStart.addEventListener("click", () => this.onSetStart(layer.id));
      actions.append(setStart);
    }
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "danger-button";
    remove.textContent = "Delete";
    remove.disabled = editor.layers.length <= 1 || layer.id === editor.playerStartLayerId;
    remove.title = layer.id === editor.playerStartLayerId
      ? "Move the player start before deleting this layer"
      : editor.layers.length <= 1
        ? "A map must retain one layer"
        : "Delete this layer";
    remove.addEventListener("click", () => {
      if (window.confirm(`Delete layer "${layer.name}" and all of its authored contents?`)) {
        this.onDelete(layer.id);
      }
    });
    actions.append(remove);
    row.append(heading, fields, meta, actions);
    return row;
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
