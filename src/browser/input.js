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
   * editorPointerMove?:(x:number,z:number,inside:boolean)=>void,
   * editorPointerLeave?:()=>void,
   * editorPointerDown?:(button:number,x:number,z:number)=>void,
   * editorPointerUp?:(button:number,x:number,z:number,options:{moved:boolean})=>void,
   * cancelEditorAction?:()=>void,
   * rotateEditorSelection?:()=>void,
   * undoEditor?:()=>void,
   * redoEditor?:()=>void,
   * createCast?:(x:number,z:number)=>Record<string,unknown>|null
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
    this.pendingJump = false;
    this.pendingJumpTarget = null;
    this.editorButton = -1;
    this.panning = false;
    this.lastPointer = { x: 0, y: 0 };
    this.pointerDown = { x: 0, y: 0, button: -1 };
    this.#install();
  }

  sampleCommand() {
    this.refreshPointerWorld();
    const cast = this.pendingCast;
    const jump = this.pendingJump;
    const jumpTarget = this.pendingJumpTarget;
    this.pendingCast = null;
    this.pendingJump = false;
    this.pendingJumpTarget = null;
    return {
      move: this.mode === "play" && this.rightHeld ? { ...this.mouseWorld } : null,
      cast: this.mode === "play" ? cast : null,
      ...(this.mode === "play" && jump ? { jump: true } : {}),
      ...(this.mode === "play" && jumpTarget ? { jumpTarget } : {}),
    };
  }

  /** @param {"play"|"edit"} mode */
  setMode(mode) {
    this.mode = mode;
    this.rightHeld = false;
    this.pendingJump = false;
    this.pendingJumpTarget = null;
    this.panning = false;
    this.editorButton = -1;
    this.pointerDown.button = -1;
    this.actions.cancelEditorAction?.();
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

  #install() {
    this.canvas.addEventListener("contextmenu", (event) => event.preventDefault());
    this.canvas.addEventListener("pointerenter", () => {
      this.mouseInside = true;
      this.refreshPointerWorld();
      if (this.mode === "edit") {
        this.actions.editorPointerMove?.(this.mouseWorld.x, this.mouseWorld.z, true);
      }
    });
    this.canvas.addEventListener("pointerleave", () => {
      this.mouseInside = false;
      if (this.mode === "edit") this.actions.editorPointerLeave?.();
    });
    this.canvas.addEventListener("pointermove", (event) => this.#onPointerMove(event));
    // Pointer capture preserves drags, while mouse events report every button
    // transition in an RMB+LMB chord instead of only the first/last one.
    this.canvas.addEventListener("pointerdown", (event) => this.#capturePointer(event));
    this.canvas.addEventListener("pointerup", (event) => this.#releasePointer(event));
    this.canvas.addEventListener("pointercancel", (event) => {
      this.#releasePointer(event);
      this.rightHeld = false;
      this.editorButton = -1;
      this.panning = false;
      this.pointerDown.button = -1;
      this.actions.cancelEditorAction?.();
    });
    this.canvas.addEventListener("mousedown", (event) => this.#onMouseDown(event));
    this.canvas.addEventListener("wheel", (event) => this.#onWheel(event), { passive: false });
    window.addEventListener("mouseup", (event) => this.#onMouseUp(event));
    window.addEventListener("blur", () => {
      this.rightHeld = false;
      this.pendingJump = false;
      this.pendingJumpTarget = null;
      this.editorButton = -1;
      this.panning = false;
      this.pointerDown.button = -1;
      this.actions.cancelEditorAction?.();
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
    if (this.mode === "edit") {
      this.actions.editorPointerMove?.(
        this.mouseWorld.x,
        this.mouseWorld.z,
        this.mouseInside,
      );
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
    if (event.button === 0 || (this.mode === "edit" && event.button === 2)) {
      this.pointerDown = { ...point, button: event.button };
    }
    this.refreshPointerWorld();
    if (event.button === 1) {
      this.panning = this.mode === "edit";
      event.preventDefault();
      return;
    }
    if (this.mode === "edit") {
      if (event.button === 0 || event.button === 2) {
        this.editorButton = event.button;
        this.actions.editorPointerDown?.(
          event.button,
          this.mouseWorld.x,
          this.mouseWorld.z,
        );
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
    if (this.mode === "edit") {
      if (event.button === this.editorButton) {
        this.lastPointer = point;
        this.refreshPointerWorld();
        const moved = Math.hypot(
          point.x - this.pointerDown.x,
          point.y - this.pointerDown.y,
        );
        this.actions.editorPointerUp?.(
          event.button,
          this.mouseWorld.x,
          this.mouseWorld.z,
          { moved: moved >= POINTER_CLICK_SLOP_VIEWPORT_UNITS },
        );
        this.editorButton = -1;
        this.pointerDown.button = -1;
      }
      return;
    }
    if (event.button === 2) this.rightHeld = false;
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
    const isInstance = (name, value) => (
      typeof globalThis[name] === "function"
      && value instanceof globalThis[name]
    );
    const editingText = isInstance("HTMLInputElement", target)
      || isInstance("HTMLTextAreaElement", target)
      || isInstance("HTMLSelectElement", target)
      || (isInstance("HTMLElement", target) && target.isContentEditable);
    if (editingText) {
      return;
    }
    const key = String(event.key ?? "").toLowerCase();
    const commandModifier = event.ctrlKey || event.metaKey;
    if (this.mode === "edit" && commandModifier && !event.altKey) {
      const redo = key === "y" || (key === "z" && event.shiftKey);
      if (key === "z" || key === "y") {
        event.preventDefault();
        if (redo) this.actions.redoEditor?.();
        else this.actions.undoEditor?.();
        return;
      }
    }
    if (isInstance("HTMLButtonElement", target)) return;
    if (event.code === "Space") {
      event.preventDefault();
      if (this.mode === "play" && !event.repeat) {
        this.refreshPointerWorld();
        this.pendingJump = true;
        this.pendingJumpTarget = { ...this.mouseWorld };
      }
      return;
    }
    if (this.actions.developerToolsOpen && !this.actions.developerToolsOpen()) {
      return;
    }
    if (key === "p") {
      event.preventDefault();
      this.actions.togglePause();
    } else if (event.key === ".") {
      event.preventDefault();
      this.actions.step();
    } else if (event.key === "Escape" && this.mode === "edit") {
      event.preventDefault();
      this.actions.cancelEditorAction?.();
    } else if (key === "r" && this.mode === "edit") {
      event.preventDefault();
      this.actions.rotateEditorSelection?.();
    } else if (key === "r") {
      event.preventDefault();
      this.actions.reset(event.shiftKey);
    } else if (key === "e") {
      event.preventDefault();
      this.actions.toggleMode();
    } else if (key === "f") {
      event.preventDefault();
      this.actions.focusPlayer();
    }
  }
}
