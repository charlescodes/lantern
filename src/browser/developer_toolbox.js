// @ts-check

export const DEVELOPER_TOOLBOX_STATE = Object.freeze({
  closed: "closed",
  open: "open",
});

/**
 * Uses the physical semicolon key while still accepting a literal semicolon
 * from layouts that report a different code.
 *
 * @param {{code?:string,key?:string,shiftKey?:boolean}} event
 */
export function isDeveloperToolboxShortcut(event) {
  return !event.shiftKey && (
    event.code === "Semicolon"
    || event.key === ";"
  );
}

/** @param {EventTarget|null} target */
function isEditableTarget(target) {
  if (
    typeof Element === "undefined"
    || !(target instanceof Element)
  ) return false;
  return Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}

/**
 * Owns the single presentation-only gate around Lantern's developer chrome.
 * It never injects a simulation command or changes a recording.
 */
export class DeveloperToolbox {
  /**
   * @param {{
   * body?:HTMLElement,
   * surfaces?:HTMLElement[],
   * eventTarget?:Window|null,
   * toggleButton?:HTMLButtonElement|null,
   * focusTarget?:HTMLElement|null,
   * onClose?:()=>void,
   * requestLayout?:()=>void,
   * }} [options]
   */
  constructor(options = {}) {
    this.body = options.body ?? document.body;
    this.surfaces = options.surfaces
      ?? Array.from(document.querySelectorAll("[data-developer-surface]"));
    this.eventTarget = options.eventTarget === undefined ? window : options.eventTarget;
    this.toggleButton = options.toggleButton === undefined
      ? /** @type {HTMLButtonElement|null} */ (
        document.getElementById("developer-tools-toggle")
      )
      : options.toggleButton;
    this.focusTarget = options.focusTarget ?? null;
    this.onClose = options.onClose ?? (() => {});
    this.requestLayout = options.requestLayout ?? (() => {
      window.requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
    });
    this.originalSurfaceState = new Map(
      this.surfaces.map((surface) => [surface, {
        ariaHidden: surface.getAttribute("aria-hidden"),
        inert: surface.hasAttribute("inert"),
      }]),
    );
    this.open = this.body.dataset.developerTools === DEVELOPER_TOOLBOX_STATE.open;
    this.boundKeydown = (event) => this.handleKeyDown(event);
    this.boundToggle = () => this.toggle();
    this.#applyState();
    this.eventTarget?.addEventListener("keydown", this.boundKeydown);
    this.toggleButton?.addEventListener("click", this.boundToggle);
  }

  get isOpen() {
    return this.open;
  }

  toggle() {
    return this.setOpen(!this.open);
  }

  /** @param {boolean} open */
  setOpen(open) {
    const next = Boolean(open);
    if (next === this.open) return this.open;
    if (!next) this.onClose();
    this.open = next;
    this.#applyState();
    if (!next) this.focusTarget?.focus({ preventScroll: true });
    this.requestLayout();
    return this.open;
  }

  /** @param {KeyboardEvent} event */
  handleKeyDown(event) {
    if (
      !isDeveloperToolboxShortcut(event)
      || isEditableTarget(event.target)
    ) return false;
    event.preventDefault();
    if (!event.repeat) this.toggle();
    return true;
  }

  dispose() {
    this.eventTarget?.removeEventListener("keydown", this.boundKeydown);
    this.toggleButton?.removeEventListener("click", this.boundToggle);
  }

  #applyState() {
    const open = this.open;
    this.body.dataset.developerTools = open
      ? DEVELOPER_TOOLBOX_STATE.open
      : DEVELOPER_TOOLBOX_STATE.closed;
    this.toggleButton?.setAttribute("aria-expanded", String(open));
    for (const surface of this.surfaces) {
      const original = this.originalSurfaceState.get(surface);
      if (!open) {
        surface.setAttribute("aria-hidden", "true");
        surface.setAttribute("inert", "");
        continue;
      }
      if (original?.ariaHidden === null || original?.ariaHidden === undefined) {
        surface.removeAttribute("aria-hidden");
      } else {
        surface.setAttribute("aria-hidden", original.ariaHidden);
      }
      surface.toggleAttribute("inert", original?.inert ?? false);
    }
  }
}
