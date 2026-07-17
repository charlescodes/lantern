// @ts-check

export class InputController {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {import('./camera.js').Camera2D} camera
   * @param {{
   * inject:(command:unknown)=>void,
   * togglePause:()=>void,
   * step:()=>void,
   * reset:(newSeed:boolean)=>void,
   * toggleMode:()=>void,
   * focusPlayer:()=>void,
   * pinAt:(x:number,z:number)=>void
   * }} actions
   */
  constructor(canvas, camera, actions) {
    this.canvas = canvas;
    this.camera = camera;
    this.actions = actions;
    this.mode = "play";
    this.mouseWorld = { x: 0, z: 0 };
    this.mouseInside = false;
    this.rightHeld = false;
    this.pendingCast = null;
    this.paintButton = -1;
    this.lastPaintedCell = "";
    this.panning = false;
    this.lastPointer = { x: 0, y: 0 };
    this.pointerDown = { x: 0, y: 0, button: -1 };
    this.#install();
  }

  sampleCommand() {
    const cast = this.pendingCast;
    this.pendingCast = null;
    return {
      move: this.mode === "play" && this.rightHeld ? { ...this.mouseWorld } : null,
      cast: this.mode === "play" ? cast : null,
    };
  }

  /** @param {"play"|"edit"} mode */
  setMode(mode) {
    this.mode = mode;
    this.rightHeld = false;
    this.paintButton = -1;
    this.lastPaintedCell = "";
  }

  #install() {
    this.canvas.addEventListener("contextmenu", (event) => event.preventDefault());
    this.canvas.addEventListener("pointerenter", () => {
      this.mouseInside = true;
    });
    this.canvas.addEventListener("pointerleave", () => {
      this.mouseInside = false;
    });
    this.canvas.addEventListener("pointermove", (event) => this.#onPointerMove(event));
    this.canvas.addEventListener("pointerdown", (event) => this.#onPointerDown(event));
    this.canvas.addEventListener("pointerup", (event) => this.#onPointerUp(event));
    this.canvas.addEventListener("pointercancel", (event) => this.#onPointerUp(event));
    this.canvas.addEventListener("wheel", (event) => this.#onWheel(event), { passive: false });
    window.addEventListener("blur", () => {
      this.rightHeld = false;
      this.paintButton = -1;
      this.panning = false;
    });
    window.addEventListener("keydown", (event) => this.#onKeyDown(event));
  }

  /** @param {PointerEvent} event */
  #canvasPoint(event) {
    const bounds = this.canvas.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  }

  /** @param {PointerEvent} event */
  #onPointerMove(event) {
    const point = this.#canvasPoint(event);
    if (this.panning) {
      this.camera.panPixels(point.x - this.lastPointer.x, point.y - this.lastPointer.y);
    }
    this.lastPointer = point;
    this.mouseWorld = this.camera.screenToWorld(point.x, point.y);
    if (this.mode === "edit" && this.paintButton >= 0) this.#paintCurrentCell();
  }

  /** @param {PointerEvent} event */
  #onPointerDown(event) {
    const point = this.#canvasPoint(event);
    this.lastPointer = point;
    this.pointerDown = { ...point, button: event.button };
    this.mouseWorld = this.camera.screenToWorld(point.x, point.y);
    this.canvas.setPointerCapture(event.pointerId);
    if (event.button === 1) {
      this.panning = true;
      event.preventDefault();
      return;
    }
    if (this.mode === "edit") {
      if (event.button === 0 || event.button === 2) {
        this.paintButton = event.button;
        this.lastPaintedCell = "";
        this.#paintCurrentCell();
      }
      return;
    }
    if (event.button === 2) this.rightHeld = true;
    if (event.button === 0) this.pendingCast = { ...this.mouseWorld };
  }

  /** @param {PointerEvent} event */
  #onPointerUp(event) {
    const point = this.#canvasPoint(event);
    if (event.button === 1) this.panning = false;
    if (event.button === 2) this.rightHeld = false;
    if (event.button === this.paintButton) this.paintButton = -1;
    const moved = Math.hypot(point.x - this.pointerDown.x, point.y - this.pointerDown.y);
    if (event.button === 0 && moved < 5 && !this.panning) {
      const world = this.camera.screenToWorld(point.x, point.y);
      this.actions.pinAt(world.x, world.z);
    }
    if (this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId);
  }

  #paintCurrentCell() {
    const cx = Math.floor(this.mouseWorld.x);
    const cz = Math.floor(this.mouseWorld.z);
    const key = `${cx}:${cz}:${this.paintButton}`;
    if (key === this.lastPaintedCell) return;
    this.lastPaintedCell = key;
    this.actions.inject({ type: "setTile", cx, cz, tile: this.paintButton === 0 ? 1 : 0 });
  }

  /** @param {WheelEvent} event */
  #onWheel(event) {
    event.preventDefault();
    const bounds = this.canvas.getBoundingClientRect();
    const factor = Math.exp(-event.deltaY * 0.0015);
    this.camera.zoomAt(event.clientX - bounds.left, event.clientY - bounds.top, factor);
  }

  /** @param {KeyboardEvent} event */
  #onKeyDown(event) {
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
      return;
    }
    if (event.code === "Space") {
      event.preventDefault();
      this.actions.togglePause();
    } else if (event.key === ".") {
      event.preventDefault();
      this.actions.step();
    } else if (event.key.toLowerCase() === "r") {
      event.preventDefault();
      this.actions.reset(event.shiftKey);
    } else if (event.key.toLowerCase() === "e") {
      event.preventDefault();
      this.actions.toggleMode();
    } else if (event.key.toLowerCase() === "f") {
      event.preventDefault();
      this.actions.focusPlayer();
    }
  }
}
