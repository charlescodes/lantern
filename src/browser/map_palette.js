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
   * onSelect?:(id:string|null)=>void,
   * onRestore?:()=>void
   * }} options
   */
  constructor(options) {
    this.root = options.root ?? document.getElementById("map-palette");
    if (!this.root) throw new Error("Missing #map-palette");
    this.definitions = [...options.definitions];
    this.definitionIds = new Set(this.definitions.map((definition) => definition.id));
    this.onSelect = options.onSelect ?? (() => {});
    this.onRestore = options.onRestore ?? (() => {});
    this.selectedId = this.definitionIds.has(options.selectedId)
      ? String(options.selectedId)
      : this.definitions[0]?.id ?? null;
    this.collapsed = false;
    this.buttons = new Map();
    this.#render();
    this.setSelected(this.selectedId);
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
        this.buttons.set(definition.id, button);
        controls.append(button);
      }
      section.append(label, controls);
      this.body.append(section);
    }

    const actions = document.createElement("div");
    actions.className = "map-palette-actions";
    const eraseButton = document.createElement("button");
    eraseButton.type = "button";
    eraseButton.dataset.paletteAction = "erase";
    eraseButton.textContent = "Erase";
    eraseButton.title = "Remove an instance or erase a structure (RMB also erases)";
    eraseButton.addEventListener("click", () => this.setSelected(null));
    this.buttons.set("erase", eraseButton);
    const restoreButton = document.createElement("button");
    restoreButton.type = "button";
    restoreButton.textContent = "Restore positions";
    restoreButton.addEventListener("click", () => this.onRestore());
    actions.append(eraseButton, restoreButton);
    this.body.append(actions);

    this.root.append(heading, this.body);
  }

  /** @param {string|null} definitionId */
  setSelected(definitionId) {
    if (definitionId !== null && !this.definitionIds.has(definitionId)) return false;
    this.selectedId = definitionId;
    this.root.dataset.selectedDefinition = definitionId ?? "erase";
    const selected = definitionId === null
      ? null
      : this.definitions.find((definition) => definition.id === definitionId);
    this.selectionOutput.value = selected?.label ?? "Erase";
    this.selectionOutput.textContent = selected?.label ?? "Erase";
    for (const [id, button] of this.buttons) {
      const active = id === (definitionId ?? "erase");
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    }
    this.onSelect(definitionId);
    return true;
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
      selectedDefinitionId: this.selectedId,
      selectedTool: this.selectedId ?? "erase",
      collapsed: this.collapsed,
      availableDefinitionIds: [...this.definitionIds],
    };
  }
}
