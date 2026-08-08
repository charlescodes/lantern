import test from "node:test";
import assert from "node:assert/strict";

import { Camera2D } from "../src/browser/camera.js";
import { InputController } from "../src/browser/input.js";

class FakeCanvas extends EventTarget {
  constructor() {
    super();
    this.capturedPointers = new Set();
  }

  getBoundingClientRect() {
    return { left: 0, top: 0, width: 800, height: 400 };
  }

  /** @param {number} pointerId */
  setPointerCapture(pointerId) {
    this.capturedPointers.add(pointerId);
  }

  /** @param {number} pointerId */
  hasPointerCapture(pointerId) {
    return this.capturedPointers.has(pointerId);
  }

  /** @param {number} pointerId */
  releasePointerCapture(pointerId) {
    this.capturedPointers.delete(pointerId);
  }
}

/** @param {EventTarget} target @param {string} type @param {Record<string,number>} values */
function dispatch(target, type, values) {
  const event = new Event(type, { cancelable: true });
  for (const [name, value] of Object.entries(values)) {
    Object.defineProperty(event, name, { value });
  }
  target.dispatchEvent(event);
}

function createInput() {
  const canvas = new FakeCanvas();
  const camera = new Camera2D({ centerX: 10, centerZ: 20 });
  camera.resize(800, 400);
  const input = new InputController(
    /** @type {any} */ (canvas),
    camera,
    {
      inject: () => {},
      togglePause: () => {},
      step: () => {},
      reset: () => {},
      toggleMode: () => {},
      focusPlayer: () => {},
      pinAt: () => {},
      editAt: () => {},
    },
  );
  return { canvas, input };
}

/** @param {(context:{canvas:FakeCanvas,input:InputController,window:EventTarget})=>void} run */
function withInput(run) {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const fakeWindow = new EventTarget();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    writable: true,
    value: fakeWindow,
  });
  try {
    const { canvas, input } = createInput();
    run({ canvas, input, window: fakeWindow });
  } finally {
    if (previousWindow) {
      Object.defineProperty(globalThis, "window", previousWindow);
    } else {
      delete globalThis.window;
    }
  }
}

test("right-button movement and left-button casting remain independent in a mouse chord", () => {
  withInput(({ canvas, input, window }) => {
    dispatch(canvas, "pointermove", { clientX: 620, clientY: 90 });
    const target = { ...input.mouseWorld };

    // A mouse emits pointerdown only for the first pressed button, while
    // mousedown still reports each additional button in the chord.
    dispatch(canvas, "pointerdown", {
      button: 2,
      clientX: 620,
      clientY: 90,
      pointerId: 4,
    });
    dispatch(canvas, "mousedown", { button: 2, clientX: 620, clientY: 90 });
    dispatch(canvas, "mousedown", { button: 0, clientX: 620, clientY: 90 });

    assert.deepEqual(input.sampleCommand(), {
      move: { ...target },
      cast: { ...target },
    });

    // Releasing RMB while LMB remains down emits mouseup but not pointerup.
    dispatch(window, "mouseup", { button: 2, clientX: 620, clientY: 90 });
    assert.deepEqual(input.sampleCommand(), { move: null, cast: null });

    dispatch(canvas, "pointerup", {
      button: 0,
      clientX: 620,
      clientY: 90,
      pointerId: 4,
    });
    dispatch(window, "mouseup", { button: 0, clientX: 620, clientY: 90 });
  });
});

test("right-button movement can begin while the left button remains held", () => {
  withInput(({ canvas, input, window }) => {
    dispatch(canvas, "pointermove", { clientX: 570, clientY: 120 });
    const target = { ...input.mouseWorld };

    dispatch(canvas, "pointerdown", {
      button: 0,
      clientX: 570,
      clientY: 120,
      pointerId: 5,
    });
    dispatch(canvas, "mousedown", { button: 0, clientX: 570, clientY: 120 });
    assert.deepEqual(input.sampleCommand(), { move: null, cast: target });

    dispatch(canvas, "mousedown", { button: 2, clientX: 570, clientY: 120 });
    assert.deepEqual(input.sampleCommand(), { move: target, cast: null });

    dispatch(window, "mouseup", { button: 2, clientX: 570, clientY: 120 });
    assert.deepEqual(input.sampleCommand(), { move: null, cast: null });

    dispatch(canvas, "pointerup", {
      button: 0,
      clientX: 570,
      clientY: 120,
      pointerId: 5,
    });
    dispatch(window, "mouseup", { button: 0, clientX: 570, clientY: 120 });
  });
});
