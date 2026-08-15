// @ts-check

/** @param {Array<Record<string, any>>} definitions */
export function groupPaletteDefinitions(definitions) {
  const groups = [];
  const byCategory = new Map();
  for (const definition of definitions) {
    let group = byCategory.get(definition.category);
    if (!group) {
      group = {
        id: String(definition.category),
        label: String(definition.categoryLabel ?? definition.category),
        definitions: [],
      };
      byCategory.set(definition.category, group);
      groups.push(group);
    }
    group.definitions.push(definition);
  }
  return groups;
}

export class MapPalette {
  /**
   * @param {{
   * root?:HTMLElement|null,
   * definitions:Array<Record<string, any>>,
   * selectedId?:string,
   * onSelect?:(id:string)=>void,
   * onTool?:(tool:string)=>void,
   * onChannel?:(channel:string)=>void,
   * onRotate?:()=>void,
   * onUndo?:()=>void,
   * onRedo?:()=>void,
   * onExtents?:(value:boolean)=>void,
   * onRestore?:()=>void
   * }} options
   */
  constructor(options) {
    this.root = options.root ?? document.getElementById("map-palette");
    if (!this.root) throw new Error("Missing #map-palette");
    this.definitions = [...options.definitions];
    this.definitionIds = new Set(this.definitions.map((definition) => definition.id));
    this.onSelect = options.onSelect ?? (() => {});
    this.onTool = options.onTool ?? (() => {});
    this.onChannel = options.onChannel ?? (() => {});
    this.onRotate = options.onRotate ?? (() => {});
    this.onUndo = options.onUndo ?? (() => {});
    this.onRedo = options.onRedo ?? (() => {});
    this.onExtents = options.onExtents ?? (() => {});
    this.onRestore = options.onRestore ?? (() => {});
    this.selectedId = this.definitionIds.has(options.selectedId)
      ? String(options.selectedId)
      : this.definitions[0]?.id ?? null;
    this.collapsed = false;
    this.activeTool = "paint";
    this.activeChannel = "structure";
    this.previewRotation = 0;
    this.showAuthoringExtents = false;
    this.history = {
      canUndo: false,
      canRedo: false,
      dirty: false,
      nextUndoLabel: null,
      nextRedoLabel: null,
    };
    this.definitionButtons = new Map();
    this.toolButtons = new Map();
    this.channelButtons = new Map();
    this.#render();
    this.#applyVisualState();
  }

  #render() {
    this.root.replaceChildren();
    this.root.dataset.collapsed = "false";

    const heading = document.createElement("header");
    heading.className = "map-palette-heading";
    const titleWrap = document.createElement("div");
    const eyebrow = document.createElement("p");
    eyebrow.className = "eyebrow";
    eyebrow.textContent = "Catalog-driven authoring";
    const title = document.createElement("h2");
    title.textContent = "Map palette";
    titleWrap.append(eyebrow, title);
    this.collapseButton = document.createElement("button");
    this.collapseButton.type = "button";
    this.collapseButton.textContent = "Collapse";
    this.collapseButton.setAttribute("aria-expanded", "true");
    this.collapseButton.addEventListener("click", () => this.setCollapsed(!this.collapsed));
    heading.append(titleWrap, this.collapseButton);

    this.body = document.createElement("div");
    this.body.className = "map-palette-body";
    this.body.id = "map-palette-body";
    this.collapseButton.setAttribute("aria-controls", this.body.id);
    const selection = document.createElement("p");
    selection.className = "map-palette-selection";
    selection.append("Selected ");
    this.selectionOutput = document.createElement("output");
    selection.append(this.selectionOutput);
    this.body.append(selection);

    const history = document.createElement("div");
    history.className = "map-palette-history";
    const historyButtons = document.createElement("div");
    historyButtons.className = "map-palette-history-buttons";
    this.undoButton = document.createElement("button");
    this.undoButton.type = "button";
    this.undoButton.textContent = "Undo";
    this.undoButton.addEventListener("click", () => this.onUndo());
    this.redoButton = document.createElement("button");
    this.redoButton.type = "button";
    this.redoButton.textContent = "Redo";
    this.redoButton.addEventListener("click", () => this.onRedo());
    historyButtons.append(this.undoButton, this.redoButton);
    this.dirtyOutput = document.createElement("output");
    this.dirtyOutput.className = "map-palette-dirty";
    history.append(historyButtons, this.dirtyOutput);
    this.body.append(history);

    const stateLine = document.createElement("p");
    stateLine.className = "map-palette-state";
    stateLine.append("Tool ");
    this.toolOutput = document.createElement("output");
    stateLine.append(this.toolOutput, " · channel ");
    this.channelOutput = document.createElement("output");
    stateLine.append(this.channelOutput, " · rotation ");
    this.rotationOutput = document.createElement("output");
    stateLine.append(this.rotationOutput);
    this.body.append(stateLine);

    const tools = document.createElement("div");
    tools.className = "map-palette-tools";
    tools.setAttribute("role", "toolbar");
    tools.setAttribute("aria-label", "Authoring tool");
    for (const [tool, label] of [
      ["select", "Select"],
      ["paint", "Paint / stamp"],
      ["erase", "Erase"],
      ["eyedropper", "Eyedropper"],
    ]) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.editorTool = tool;
      button.textContent = label;
      button.addEventListener("click", () => this.setTool(tool));
      this.toolButtons.set(tool, button);
      tools.append(button);
    }
    this.body.append(tools);

    const channels = document.createElement("div");
    channels.className = "map-palette-channels";
    channels.setAttribute("role", "toolbar");
    channels.setAttribute("aria-label", "Authoring channel");
    for (const [channel, label] of [
      ["surface", "Surface"],
      ["structure", "Structure"],
      ["instance", "Instances"],
    ]) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.authoringChannel = channel;
      button.textContent = label;
      button.addEventListener("click", () => this.setChannel(channel));
      this.channelButtons.set(channel, button);
      channels.append(button);
    }
    this.body.append(channels);

    for (const group of groupPaletteDefinitions(this.definitions)) {
      const section = document.createElement("section");
      section.className = "map-palette-group";
      section.dataset.category = group.id;
      const label = document.createElement("h3");
      label.textContent = group.label;
      const controls = document.createElement("div");
      controls.className = "map-palette-controls";
      for (const definition of group.definitions) {
        const button = document.createElement("button");
        button.type = "button";
        button.dataset.definitionId = definition.id;
        button.dataset.placementMode = definition.placementMode;
        button.textContent = definition.label;
        button.title = `${definition.placementMode} · ${definition.id}`;
        button.addEventListener("click", () => this.setSelected(definition.id));
        this.definitionButtons.set(definition.id, button);
        controls.append(button);
      }
      section.append(label, controls);
      this.body.append(section);
    }

    const actions = document.createElement("div");
    actions.className = "map-palette-actions";
    const rotateButton = document.createElement("button");
    rotateButton.type = "button";
    rotateButton.dataset.paletteAction = "rotate";
    rotateButton.textContent = "Rotate 90°";
    rotateButton.title = "Rotate the stamp preview or selected instance (R)";
    rotateButton.addEventListener("click", () => this.onRotate());
    const restoreButton = document.createElement("button");
    restoreButton.type = "button";
    restoreButton.textContent = "Restore positions";
    restoreButton.addEventListener("click", () => this.onRestore());
    actions.append(rotateButton, restoreButton);
    this.body.append(actions);

    const extentsLabel = document.createElement("label");
    extentsLabel.className = "map-palette-extents";
    this.extentsCheckbox = document.createElement("input");
    this.extentsCheckbox.type = "checkbox";
    this.extentsCheckbox.addEventListener("change", () => {
      this.setExtents(this.extentsCheckbox.checked);
    });
    extentsLabel.append(this.extentsCheckbox, " Show authoring extents");
    this.body.append(extentsLabel);

    this.hoverOutput = document.createElement("output");
    this.hoverOutput.className = "map-palette-hover";
    this.hoverOutput.textContent = "Hover: none";
    this.body.append(this.hoverOutput);

    this.root.append(heading, this.body);
  }

  /** @param {string|null} definitionId */
  setSelected(definitionId) {
    if (definitionId === null) return this.setTool("erase");
    if (!this.definitionIds.has(definitionId)) return false;
    this.selectedId = definitionId;
    const definition = this.definitions.find((candidate) => candidate.id === definitionId);
    this.activeChannel = definition?.placementTarget ?? this.activeChannel;
    this.activeTool = "paint";
    this.previewRotation = 0;
    this.#applyVisualState();
    this.onSelect(definitionId);
    return true;
  }

  /** @param {string} tool */
  setTool(tool) {
    if (!this.toolButtons.has(tool)) return false;
    this.activeTool = tool;
    this.#applyVisualState();
    this.onTool(tool);
    return true;
  }

  /** @param {string} channel */
  setChannel(channel) {
    if (!this.channelButtons.has(channel)) return false;
    this.activeChannel = channel;
    this.#applyVisualState();
    this.onChannel(channel);
    return true;
  }

  /** @param {boolean} value */
  setExtents(value) {
    this.showAuthoringExtents = Boolean(value);
    this.#applyVisualState();
    this.onExtents(this.showAuthoringExtents);
    return true;
  }

  /** @param {Record<string,any>} editor */
  sync(editor) {
    this.selectedId = editor.selectedDefinitionId;
    this.activeTool = editor.activeTool;
    this.activeChannel = editor.activeChannel;
    this.previewRotation = editor.previewRotation;
    this.showAuthoringExtents = Boolean(editor.showAuthoringExtents);
    this.history = { ...this.history, ...(editor.history ?? {}) };
    const hovered = editor.hoveredTarget;
    this.hoverOutput.textContent = editor.hoveredIdentity
      ? `Hover: ${editor.hoveredIdentity.label} · ${editor.hoveredIdentity.authoringId}`
      : hovered?.kind === "cell"
        ? `Hover: cell ${hovered.x}, ${hovered.z}`
        : "Hover: none";
    this.#applyVisualState();
  }

  #applyVisualState() {
    this.root.dataset.selectedDefinition = this.selectedId ?? "";
    this.root.dataset.activeTool = this.activeTool;
    this.root.dataset.activeChannel = this.activeChannel;
    const selected = this.definitions.find((definition) => definition.id === this.selectedId);
    this.selectionOutput.value = selected?.label ?? "None";
    this.selectionOutput.textContent = selected?.label ?? "None";
    this.toolOutput.value = this.activeTool;
    this.toolOutput.textContent = this.activeTool;
    this.channelOutput.value = this.activeChannel;
    this.channelOutput.textContent = this.activeChannel;
    this.rotationOutput.value = `${this.previewRotation * 90}°`;
    this.rotationOutput.textContent = `${this.previewRotation * 90}°`;
    this.extentsCheckbox.checked = this.showAuthoringExtents;
    this.undoButton.disabled = !this.history.canUndo;
    this.redoButton.disabled = !this.history.canRedo;
    this.undoButton.textContent = this.history.nextUndoLabel
      ? `Undo ${this.history.nextUndoLabel}`
      : "Undo";
    this.redoButton.textContent = this.history.nextRedoLabel
      ? `Redo ${this.history.nextRedoLabel}`
      : "Redo";
    this.undoButton.title = this.history.nextUndoLabel
      ? `Undo ${this.history.nextUndoLabel} (Ctrl/Meta+Z)`
      : "Nothing to undo";
    this.redoButton.title = this.history.nextRedoLabel
      ? `Redo ${this.history.nextRedoLabel} (Ctrl/Meta+Shift+Z or Ctrl/Meta+Y)`
      : "Nothing to redo";
    this.dirtyOutput.value = this.history.dirty ? "Unsaved changes" : "Saved";
    this.dirtyOutput.textContent = this.history.dirty ? "Unsaved changes" : "Saved";
    this.dirtyOutput.dataset.dirty = String(Boolean(this.history.dirty));
    for (const [id, button] of this.definitionButtons) {
      const active = id === this.selectedId;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    }
    for (const [id, button] of this.toolButtons) {
      const active = id === this.activeTool;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    }
    for (const [id, button] of this.channelButtons) {
      const active = id === this.activeChannel;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    }
  }

  /** @param {boolean} collapsed */
  setCollapsed(collapsed) {
    this.collapsed = Boolean(collapsed);
    this.root.dataset.collapsed = String(this.collapsed);
    this.body.hidden = this.collapsed;
    this.collapseButton.textContent = this.collapsed ? "Expand" : "Collapse";
    this.collapseButton.setAttribute("aria-expanded", String(!this.collapsed));
  }

  snapshot() {
    return {
      // M1A.1 exposed null while its erase pseudo-tool was active. Keep that
      // compatibility field while the richer editor snapshot retains the
      // actual selected catalog definition independently.
      selectedDefinitionId: this.activeTool === "erase" ? null : this.selectedId,
      selectedTool: this.activeTool,
      activeTool: this.activeTool,
      activeChannel: this.activeChannel,
      previewRotation: this.previewRotation,
      showAuthoringExtents: this.showAuthoringExtents,
      history: { ...this.history },
      collapsed: this.collapsed,
      availableDefinitionIds: [...this.definitionIds],
    };
  }
}
