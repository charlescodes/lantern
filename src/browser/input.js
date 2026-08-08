// @ts-check

const POINTER_CLICK_SLOP_VIEWPORT_UNITS = 5;

export class InputController {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {import('./camera.js').Camera2D|import('../presentation/camera_3d.js').Camera3D} camera
   * @param {{
   * inject:(command:unknown)=>void,
   * togglePause:()=>void,
   * step:()=>void,
   * reset:(newSeed:boolean)=>void,
   * toggleMode:()=>void,
   * developerToolsOpen?:()=>boolean,
   * focusPlayer:()=>void,
   * pinAt:(x:number,z:number)=>void,
   * editAt:(tool:string,button:number,x:number,z:number)=>void,
   * createCast?:(x:number,z:number)=>Record<string,unknown>|null
   * }} actions
   */
  constructor(canvas, camera, actions) {
    this.canvas = canvas;
    this.camera = camera;
    this.actions = actions;
    this.mode = "play";
    this.editorTool = "wall";
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
    this.refreshPointerWorld();
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
    this.panning = false;
    this.paintButton = -1;
    this.pointerDown.button = -1;
    this.lastPaintedCell = "";
  }

  refreshPointerWorld() {
    const world = this.camera.viewportToWorld(
      this.lastPointer.x,
      this.lastPointer.y,
    );
    this.mouseWorld.x = world.x;
    this.mouseWorld.z = world.z;
    return this.mouseWorld;
  }

  /** @param {string} tool */
  setEditorTool(tool) {
    this.editorTool = tool;
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
    // Pointer capture preserves drags, while mouse events report every button
    // transition in an RMB+LMB chord instead of only the first/last one.
    this.canvas.addEventListener("pointerdown", (event) => this.#capturePointer(event));
    this.canvas.addEventListener("pointerup", (event) => this.#releasePointer(event));
    this.canvas.addEventListener("pointercancel", (event) => {
      this.#releasePointer(event);
      this.rightHeld = false;
      this.paintButton = -1;
      this.panning = false;
      this.pointerDown.button = -1;
    });
    this.canvas.addEventListener("mousedown", (event) => this.#onMouseDown(event));
    this.canvas.addEventListener("wheel", (event) => this.#onWheel(event), { passive: false });
    window.addEventListener("mouseup", (event) => this.#onMouseUp(event));
    window.addEventListener("blur", () => {
      this.rightHeld = false;
      this.paintButton = -1;
      this.panning = false;
      this.pointerDown.button = -1;
    });
    window.addEventListener("keydown", (event) => this.#onKeyDown(event));
  }

  /** @param {MouseEvent|PointerEvent} event */
  #viewportPoint(event) {
    const bounds = this.canvas.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  }

  /** @param {PointerEvent} event */
  #onPointerMove(event) {
    const point = this.#viewportPoint(event);
    if (this.panning) {
      const previousWorld = this.camera.viewportToWorld(
        this.lastPointer.x,
        this.lastPointer.y,
      );
      const currentWorld = this.camera.viewportToWorld(point.x, point.y);
      this.camera.panByWorld(
        previousWorld.x - currentWorld.x,
        previousWorld.z - currentWorld.z,
      );
    }
    this.lastPointer = point;
    this.refreshPointerWorld();
    if (
      this.mode === "edit" &&
      this.paintButton >= 0 &&
      (this.editorTool === "wall" || this.editorTool === "erase")
    ) {
      this.#editCurrentPoint();
    }
  }

  /** @param {PointerEvent} event */
  #capturePointer(event) {
    this.canvas.setPointerCapture(event.pointerId);
  }

  /** @param {PointerEvent} event */
  #releasePointer(event) {
    if (this.canvas.hasPointerCapture(event.pointerId)) {
      this.canvas.releasePointerCapture(event.pointerId);
    }
  }

  /** @param {MouseEvent} event */
  #onMouseDown(event) {
    const point = this.#viewportPoint(event);
    this.lastPointer = point;
    if (event.button === 0) this.pointerDown = { ...point, button: event.button };
    this.refreshPointerWorld();
    if (event.button === 1) {
      this.panning = this.mode === "edit";
      event.preventDefault();
      return;
    }
    if (this.mode === "edit") {
      if (event.button === 0 || event.button === 2) {
        this.paintButton = event.button;
        this.lastPaintedCell = "";
        this.#editCurrentPoint();
      }
      return;
    }
    if (event.button === 2) this.rightHeld = true;
    if (event.button === 0) {
      this.pendingCast = this.actions.createCast
        ? this.actions.createCast(this.mouseWorld.x, this.mouseWorld.z)
        : { ...this.mouseWorld };
    }
  }

  /** @param {MouseEvent} event */
  #onMouseUp(event) {
    const point = this.#viewportPoint(event);
    if (event.button === 1) this.panning = false;
    if (event.button === 2) this.rightHeld = false;
    if (event.button === this.paintButton) this.paintButton = -1;
    const moved = Math.hypot(point.x - this.pointerDown.x, point.y - this.pointerDown.y);
    if (
      this.mode === "play"
      && event.button === 0
      && this.pointerDown.button === 0
      && moved < POINTER_CLICK_SLOP_VIEWPORT_UNITS
      && !this.panning
    ) {
      const world = this.camera.viewportToWorld(point.x, point.y);
      this.actions.pinAt(world.x, world.z);
    }
    if (event.button === 0) this.pointerDown.button = -1;
  }

  #editCurrentPoint() {
    const cx = Math.floor(this.mouseWorld.x);
    const cz = Math.floor(this.mouseWorld.z);
    const key = `${this.editorTool}:${cx}:${cz}:${this.paintButton}`;
    if (key === this.lastPaintedCell) return;
    this.lastPaintedCell = key;
    this.actions.editAt(
      this.editorTool,
      this.paintButton,
      this.mouseWorld.x,
      this.mouseWorld.z,
    );
  }

  /** @param {WheelEvent} event */
  #onWheel(event) {
    event.preventDefault();
    const bounds = this.canvas.getBoundingClientRect();
    const factor = Math.exp(-event.deltaY * 0.0015);
    if (this.mode === "play") {
      this.camera.zoomByFactor(factor);
    } else {
      this.camera.zoomAtViewport(
        event.clientX - bounds.left,
        event.clientY - bounds.top,
        factor,
      );
    }
    this.refreshPointerWorld();
  }

  /** @param {KeyboardEvent} event */
  #onKeyDown(event) {
    const target = event.target;
    if (
      target instanceof HTMLInputElement
      || target instanceof HTMLTextAreaElement
      || target instanceof HTMLSelectElement
      || target instanceof HTMLButtonElement
      || (target instanceof HTMLElement && target.isContentEditable)
    ) {
      return;
    }
    if (this.actions.developerToolsOpen && !this.actions.developerToolsOpen()) {
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
