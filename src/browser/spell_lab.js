// @ts-check

import {
  cloneFireballDefinition,
  DEFAULT_FIREBALL_DEFINITION,
  FIREBALL_DEFINITION_DESCRIPTORS,
  FIREBALL_DEFINITION_SECTIONS,
  FIREBALL_SPELL_ID,
  getFireballDefinitionValue,
  setFireballDefinitionValue,
  validateFireballDefinition,
} from "../spells/fireball_definition.js";

/** @param {string} id */
function required(id) {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing Spell Lab element #${id}`);
  return element;
}

/** @param {unknown} value */
function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, clone(item)]),
    );
  }
  return value;
}

/** @param {number} value */
function seedHex(value) {
  return `0x${(Number(value) >>> 0).toString(16).padStart(8, "0")}`;
}

/** @param {string} value */
function parseSeed(value) {
  const text = String(value).trim();
  if (!/^(?:0x)?[0-9a-fA-F]{1,8}$/.test(text)) return null;
  return Number.parseInt(text.replace(/^0x/i, ""), 16) >>> 0;
}

/** @param {unknown} value */
function rounded(value) {
  if (typeof value === "number") return Number(value.toFixed(4));
  if (Array.isArray(value)) return value.map(rounded);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, rounded(item)]),
    );
  }
  return value;
}

export class SpellLab {
  /**
   * @param {{
   * listSpells:()=>Array<Record<string,any>>,
   * getDefinition:(id:string)=>Record<string,any>|null,
   * inject:(command:unknown)=>boolean,
   * diagnostics:(id:string)=>Record<string,any>,
   * announce:(message:string)=>void
   * }} options
   */
  constructor(options) {
    this.options = options;
    this.panel = required("spell-lab");
    this.body = required("spell-lab-body");
    this.toggleButton = /** @type {HTMLButtonElement} */ (
      required("spell-lab-toggle")
    );
    this.openButton = /** @type {HTMLButtonElement} */ (
      required("spell-lab-open")
    );
    this.selector = /** @type {HTMLSelectElement} */ (
      required("spell-selector")
    );
    this.controlRoot = required("spell-controls");
    this.status = required("spell-lab-status");
    this.diagnosticsOutput = required("spell-lab-diagnostics");
    this.validationOutput = required("spell-validation");
    this.applyButton = /** @type {HTMLButtonElement} */ (
      required("spell-apply")
    );
    this.revertButton = /** @type {HTMLButtonElement} */ (
      required("spell-revert")
    );
    this.resetButton = /** @type {HTMLButtonElement} */ (
      required("spell-reset-defaults")
    );
    this.copyButton = /** @type {HTMLButtonElement} */ (
      required("spell-copy")
    );
    this.downloadButton = /** @type {HTMLButtonElement} */ (
      required("spell-download")
    );
    this.importButton = /** @type {HTMLButtonElement} */ (
      required("spell-import")
    );
    this.importInput = /** @type {HTMLInputElement} */ (
      required("spell-import-input")
    );
    this.recastButton = /** @type {HTMLButtonElement} */ (
      required("spell-recast")
    );
    this.clearButton = /** @type {HTMLButtonElement} */ (
      required("spell-clear")
    );
    this.lockSeed = /** @type {HTMLInputElement} */ (
      required("spell-lock-seed")
    );
    this.seedInput = /** @type {HTMLInputElement} */ (
      required("spell-seed")
    );
    this.newVariationButton = /** @type {HTMLButtonElement} */ (
      required("spell-new-variation")
    );
    this.controls = new Map();
    this.selectedId = FIREBALL_SPELL_ID;
    this.appliedRevision = 0;
    this.appliedDefinition = clone(DEFAULT_FIREBALL_DEFINITION);
    this.draft = clone(DEFAULT_FIREBALL_DEFINITION);
    this.validation = validateFireballDefinition(this.draft);
    this.lastTarget = null;
    this.latestDiagnostics = null;
    this.pendingApplyJson = null;
    this.lastStateRender = 0;
    this.#buildSelector();
    this.#buildControls();
    this.#install();
    this.#loadSelectedDefinition(true);
  }

  #buildSelector() {
    this.selector.replaceChildren();
    for (const spell of this.options.listSpells()) {
      const option = document.createElement("option");
      option.value = spell.id;
      option.textContent = `${spell.name} · #${spell.code}`;
      this.selector.append(option);
    }
    this.selector.value = this.selectedId;
  }

  #buildControls() {
    this.controlRoot.replaceChildren();
    for (const section of FIREBALL_DEFINITION_SECTIONS) {
      const details = document.createElement("details");
      details.className = "spell-section";
      details.open = section === "Essentials";
      const summary = document.createElement("summary");
      summary.textContent = section;
      details.append(summary);
      const grid = document.createElement("div");
      grid.className = "spell-control-grid";
      for (const descriptor of FIREBALL_DEFINITION_DESCRIPTORS) {
        if (descriptor.section !== section) continue;
        grid.append(this.#createControl(descriptor));
      }
      details.append(grid);
      this.controlRoot.append(details);
    }
  }

  /** @param {Record<string,any>} descriptor */
  #createControl(descriptor) {
    const row = document.createElement("label");
    row.className = `spell-control spell-control-${descriptor.type}`;
    row.title = descriptor.description;
    const heading = document.createElement("span");
    heading.className = "spell-control-label";
    heading.textContent = descriptor.label;
    row.append(heading);
    const editors = document.createElement("span");
    editors.className = "spell-control-editors";
    /** @type {Array<HTMLInputElement|HTMLSelectElement>} */
    const inputs = [];
    if (descriptor.type === "number") {
      const slider = document.createElement("input");
      slider.type = "range";
      slider.min = String(descriptor.minimum);
      slider.max = String(descriptor.maximum);
      slider.step = String(descriptor.step);
      slider.setAttribute("aria-label", `${descriptor.label} slider`);
      const numeric = document.createElement("input");
      numeric.type = "number";
      numeric.min = slider.min;
      numeric.max = slider.max;
      numeric.step = slider.step;
      numeric.inputMode = "decimal";
      numeric.setAttribute("aria-label", `${descriptor.label} numeric value`);
      const unit = document.createElement("small");
      unit.textContent = descriptor.unit || "—";
      editors.append(slider, numeric, unit);
      inputs.push(slider, numeric);
      const update = (source) => {
        const value = source.valueAsNumber;
        setFireballDefinitionValue(this.draft, descriptor.path, value);
        if (source === slider) numeric.value = source.value;
        else if (Number.isFinite(value)) slider.value = source.value;
        this.#draftChanged();
      };
      slider.addEventListener("input", () => update(slider));
      numeric.addEventListener("input", () => update(numeric));
    } else if (descriptor.type === "color") {
      const swatch = document.createElement("input");
      swatch.type = "color";
      swatch.setAttribute("aria-label", `${descriptor.label} color swatch`);
      const text = document.createElement("input");
      text.type = "text";
      text.maxLength = 7;
      text.spellcheck = false;
      text.setAttribute("aria-label", `${descriptor.label} #RRGGBB value`);
      editors.append(swatch, text);
      inputs.push(swatch, text);
      swatch.addEventListener("input", () => {
        const value = swatch.value.toUpperCase();
        text.value = value;
        setFireballDefinitionValue(this.draft, descriptor.path, value);
        this.#draftChanged();
      });
      text.addEventListener("input", () => {
        const value = text.value;
        setFireballDefinitionValue(this.draft, descriptor.path, value);
        if (/^#[0-9a-fA-F]{6}$/.test(value)) swatch.value = value;
        this.#draftChanged();
      });
    } else if (descriptor.type === "enum") {
      const select = document.createElement("select");
      select.setAttribute("aria-label", descriptor.label);
      for (const value of descriptor.values) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = value;
        select.append(option);
      }
      editors.append(select);
      inputs.push(select);
      select.addEventListener("change", () => {
        setFireballDefinitionValue(this.draft, descriptor.path, select.value);
        this.#draftChanged();
      });
    } else {
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.setAttribute("aria-label", descriptor.label);
      editors.append(checkbox);
      inputs.push(checkbox);
      checkbox.addEventListener("change", () => {
        setFireballDefinitionValue(this.draft, descriptor.path, checkbox.checked);
        this.#draftChanged();
      });
    }
    row.append(editors);
    this.controls.set(descriptor.path, { descriptor, inputs });
    return row;
  }

  #install() {
    this.toggleButton.addEventListener("click", () => this.toggle());
    this.openButton.addEventListener("click", () => this.setCollapsed(false));
    this.selector.addEventListener("change", () => {
      this.selectedId = this.selector.value;
      this.#loadSelectedDefinition(true);
    });
    this.applyButton.addEventListener("click", () => this.#apply());
    this.revertButton.addEventListener("click", () => {
      this.draft = clone(this.appliedDefinition);
      this.#syncControls();
      this.#draftChanged();
      this.options.announce("Draft reverted to the applied revision");
    });
    this.resetButton.addEventListener("click", () => {
      this.draft = clone(DEFAULT_FIREBALL_DEFINITION);
      this.#syncControls();
      this.#draftChanged();
      this.options.announce("Draft reset to built-in defaults; Apply is still required");
    });
    this.copyButton.addEventListener("click", () => this.#copy());
    this.downloadButton.addEventListener("click", () => this.#download());
    this.importButton.addEventListener("click", () => this.importInput.click());
    this.importInput.addEventListener("change", () => this.#import());
    this.lockSeed.addEventListener("change", () => this.#renderState(true));
    this.seedInput.addEventListener("input", () => {
      this.lockSeed.checked = true;
      this.#renderState(true);
    });
    this.newVariationButton.addEventListener("click", () => {
      const value = new Uint32Array(1);
      crypto.getRandomValues(value);
      this.seedInput.value = seedHex(value[0]);
      this.lockSeed.checked = true;
      this.#renderState(true);
      this.options.announce("New locked variation seed");
    });
    this.recastButton.addEventListener("click", () => {
      if (!this.lastTarget) return;
      const cast = this.createCast(this.lastTarget.x, this.lastTarget.z);
      if (cast) this.options.inject({ cast });
    });
    this.clearButton.addEventListener("click", () => {
      this.options.inject({
        type: "clearSpellEffects",
        spellId: this.selectedId,
      });
      this.options.announce("Clear active spell effects queued");
    });
  }

  toggle() {
    this.setCollapsed(this.panel.dataset.collapsed !== "true");
  }

  /** @param {boolean} collapsed */
  setCollapsed(collapsed) {
    this.panel.dataset.collapsed = String(collapsed);
    this.toggleButton.textContent = collapsed ? "Expand" : "Collapse";
    this.toggleButton.setAttribute("aria-expanded", String(!collapsed));
    this.openButton.hidden = !collapsed;
  }

  #loadSelectedDefinition(replaceDraft) {
    const described = this.options.getDefinition(this.selectedId);
    if (!described) return;
    this.appliedRevision = Number(described.revision);
    this.appliedDefinition = clone(described.definition);
    if (replaceDraft) this.draft = clone(described.definition);
    this.pendingApplyJson = null;
    this.#syncControls();
    this.#draftChanged();
  }

  #syncControls() {
    for (const [path, control] of this.controls) {
      const value = getFireballDefinitionValue(this.draft, path);
      const { descriptor, inputs } = control;
      if (descriptor.type === "number") {
        inputs[0].value = typeof value === "number" ? String(value) : "";
        inputs[1].value = typeof value === "number" ? String(value) : "";
      } else if (descriptor.type === "color") {
        const valid = typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);
        inputs[0].value = valid ? value : "#000000";
        inputs[1].value = typeof value === "string" ? value : "";
      } else if (descriptor.type === "enum") {
        inputs[0].value = typeof value === "string" ? value : "";
      } else {
        /** @type {HTMLInputElement} */ (inputs[0]).checked = value === true;
      }
    }
  }

  #draftChanged() {
    this.validation = validateFireballDefinition(this.draft);
    this.#renderState(true);
  }

  get dirty() {
    return JSON.stringify(this.draft) !== JSON.stringify(this.appliedDefinition);
  }

  #apply() {
    if (!this.validation.ok) return;
    const definition = clone(this.validation.value);
    const expectedRevision = this.appliedRevision;
    this.pendingApplyJson = JSON.stringify(definition);
    const accepted = this.options.inject({
      type: "applySpellDefinition",
      spellId: this.selectedId,
      expectedRevision,
      definition,
    });
    if (!accepted) {
      this.pendingApplyJson = null;
      this.#renderState(true);
      this.options.announce("Apply queue is full");
      return;
    }
    this.#renderState(true);
    this.options.announce(`Apply queued against revision ${expectedRevision}`);
  }

  async #copy() {
    if (!this.validation.ok) return;
    try {
      await navigator.clipboard.writeText(
        JSON.stringify(this.validation.value, null, 2),
      );
      this.options.announce("Valid Fireball JSON copied");
    } catch (error) {
      this.options.announce(
        error instanceof Error ? error.message : "Clipboard is unavailable",
      );
    }
  }

  #download() {
    if (!this.validation.ok) return;
    const content = JSON.stringify(this.validation.value, null, 2);
    const url = URL.createObjectURL(
      new Blob([content], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `lantern-${this.selectedId}-r${this.appliedRevision}-draft.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    this.options.announce("Valid Fireball draft downloaded");
  }

  async #import() {
    const file = this.importInput.files?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      this.draft = clone(parsed);
      this.#syncControls();
      this.#draftChanged();
      this.options.announce(
        this.validation.ok
          ? `${file.name} imported as an unapplied draft`
          : `${file.name} imported with validation errors`,
      );
    } catch (error) {
      this.validationOutput.textContent = error instanceof Error
        ? error.message
        : String(error);
      this.options.announce("Import JSON could not be parsed");
    } finally {
      this.importInput.value = "";
    }
  }

  /**
   * Called by normal LMB input as well as Recast so both paths share seed-lock
   * semantics and the same explicit command shape.
   *
   * @param {number} x
   * @param {number} z
   */
  createCast(x, z) {
    this.lastTarget = { x: Number(x), z: Number(z) };
    const cast = {
      x: this.lastTarget.x,
      z: this.lastTarget.z,
      spellId: this.selectedId,
    };
    if (this.lockSeed.checked) {
      const seed = parseSeed(this.seedInput.value);
      if (seed === null) {
        this.options.announce("Locked seed must be 1-8 hexadecimal digits");
        this.#renderState(true);
        return null;
      }
      Object.assign(cast, { variationSeed: seed });
    }
    this.#renderState(true);
    return cast;
  }

  /** @param {ReturnType<import('../sim/simulation.js').Simulation['snapshot']>} snapshot */
  update(snapshot) {
    const snapshotSpell = snapshot.spells?.find(
      (spell) => spell.id === this.selectedId,
    );
    const revisionChanged = snapshotSpell
      && Number(snapshotSpell.currentRevision) !== this.appliedRevision;
    if (!revisionChanged && performance.now() - this.lastStateRender < 80) return;
    if (revisionChanged) {
      const described = this.options.getDefinition(this.selectedId);
      if (!described) return;
      const pendingMatches = this.pendingApplyJson !== null
        && JSON.stringify(described.definition) === this.pendingApplyJson;
      const draftStillMatchesPending = pendingMatches
        && JSON.stringify(this.draft) === this.pendingApplyJson;
      const replaceDraft = draftStillMatchesPending || !this.dirty;
      this.appliedRevision = Number(described.revision);
      this.appliedDefinition = clone(described.definition);
      if (replaceDraft) {
        this.draft = clone(described.definition);
        this.#syncControls();
      }
      this.pendingApplyJson = null;
      this.validation = validateFireballDefinition(this.draft);
    }
    const diagnostics = this.options.diagnostics(this.selectedId);
    this.latestDiagnostics = diagnostics;
    if (
      !this.lockSeed.checked
      && document.activeElement !== this.seedInput
      && diagnostics?.ok
    ) {
      this.seedInput.value = seedHex(diagnostics.currentSeed);
    }
    this.#renderState(Boolean(revisionChanged), snapshot);
  }

  /**
   * @param {boolean} force
   * @param {ReturnType<import('../sim/simulation.js').Simulation['snapshot']>|null} [snapshot]
   */
  #renderState(force, snapshot = null) {
    const now = performance.now();
    if (!force && now - this.lastStateRender < 80) return;
    this.lastStateRender = now;
    const valid = this.validation.ok;
    const dirty = this.dirty;
    const seedValid = !this.lockSeed.checked || parseSeed(this.seedInput.value) !== null;
    this.applyButton.disabled = this.pendingApplyJson !== null || !valid || !dirty;
    this.copyButton.disabled = !valid;
    this.downloadButton.disabled = !valid;
    this.revertButton.disabled = !dirty;
    this.recastButton.disabled = !this.lastTarget
      || !seedValid
      || Number(this.latestDiagnostics?.cooldownRemaining ?? 0) > 0;
    this.status.textContent = [
      `r${this.appliedRevision}`,
      dirty ? "draft changed" : "draft matches applied",
      valid ? "valid" : `${this.validation.errors.length} error(s)`,
    ].join(" · ");
    this.status.dataset.valid = String(valid);
    this.status.dataset.dirty = String(dirty);
    this.seedInput.setAttribute("aria-invalid", String(!seedValid));
    this.validationOutput.textContent = valid
      ? "Complete document valid. Apply affects future casts only."
      : this.validation.errors
        .slice(0, 6)
        .map((error) => `${error.path || "definition"}: ${error.message}`)
        .join("\n");
    const diagnostics = this.latestDiagnostics;
    if (diagnostics?.ok) {
      const impact = diagnostics.latestImpact;
      const lockedSeed = this.lockSeed.checked
        ? parseSeed(this.seedInput.value)
        : null;
      const displayedSeed = this.lockSeed.checked
        ? (lockedSeed === null ? "invalid" : seedHex(lockedSeed))
        : seedHex(diagnostics.currentSeed);
      this.diagnosticsOutput.textContent = [
        `spell       ${diagnostics.spellId} / code ${diagnostics.spellCode}`,
        `revision    ${diagnostics.appliedRevision} applied · ${diagnostics.retainedRevisions} retained`,
        `seed        ${displayedSeed}${this.lockSeed.checked ? " · locked" : " · next automatic"}`,
        `cooldown    ${Number(diagnostics.cooldownRemaining).toFixed(3)} s`,
        `active      ${diagnostics.active.projectiles} projectile · ${diagnostics.active.particles} particles · ${diagnostics.active.impacts} impacts`,
        `pool drops  ${diagnostics.poolDrops.projectiles} projectile · ${diagnostics.poolDrops.particles} particle · ${diagnostics.poolDrops.collisionDiscards} collision`,
        `impact      ${impact ? `#${impact.id} tick ${impact.tick} r${impact.definitionRevision} seed ${seedHex(impact.effectSeed)}` : "none"}`,
        `samples     ${diagnostics.sampledRanges ? JSON.stringify(rounded({
          speed: diagnostics.sampledRanges.horizontalSpeed,
          lifetime: diagnostics.sampledRanges.lifetime,
          size: diagnostics.sampledRanges.size,
          color: diagnostics.sampledRanges.color,
        })) : "none"}`,
        snapshot ? `tick        ${snapshot.tick}` : "",
      ].filter(Boolean).join("\n");
    }
  }
}
