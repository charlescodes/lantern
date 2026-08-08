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
  return event;
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
  return { canvas, camera, input };
}

/** @param {number} actual @param {number} expected */
function closeTo(actual, expected) {
  assert.ok(Math.abs(actual - expected) <= 1e-9);
}

test("play camera input stays locked while edit mode retains free pan", () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    writable: true,
    value: new EventTarget(),
  });
  try {
    const { canvas, camera, input } = createInput();

    dispatch(canvas, "mousedown", {
      button: 1,
      clientX: 400,
      clientY: 200,
    });
    dispatch(canvas, "pointermove", { clientX: 500, clientY: 200 });
    assert.equal(camera.centerX, 10);
    assert.equal(camera.centerZ, 20);
    dispatch(window, "mouseup", {
      button: 1,
      clientX: 500,
      clientY: 200,
    });

    input.setMode("edit");
    dispatch(canvas, "mousedown", {
      button: 1,
      clientX: 400,
      clientY: 200,
    });
    dispatch(canvas, "pointermove", { clientX: 500, clientY: 200 });
    closeTo(camera.centerX, 4);
    assert.equal(camera.centerZ, 20);
  } finally {
    if (previousWindow) {
      Object.defineProperty(globalThis, "window", previousWindow);
    } else {
      delete globalThis.window;
    }
  }
});

test("play zoom preserves camera center and refreshes pointer targeting", () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    writable: true,
    value: new EventTarget(),
  });
  try {
    const { canvas, camera, input } = createInput();
    dispatch(canvas, "pointermove", { clientX: 620, clientY: 90 });
    dispatch(canvas, "wheel", { clientX: 620, clientY: 90, deltaY: -100 });

    assert.equal(camera.centerX, 10);
    assert.equal(camera.centerZ, 20);
    assert.ok(camera.visibleHeightMeters < 24);
    const expected = camera.viewportToWorld(620, 90);
    closeTo(input.mouseWorld.x, expected.x);
    closeTo(input.mouseWorld.z, expected.z);

    camera.focus(14, 25);
    dispatch(canvas, "mousedown", {
      button: 2,
      clientX: 620,
      clientY: 90,
    });
    camera.focus(16, 28);
    const command = input.sampleCommand();
    const movedTarget = camera.viewportToWorld(620, 90);
    closeTo(command.move.x, movedTarget.x);
    closeTo(command.move.z, movedTarget.z);
  } finally {
    if (previousWindow) {
      Object.defineProperty(globalThis, "window", previousWindow);
    } else {
      delete globalThis.window;
    }
  }
});

test("edit zoom remains anchored to the pointer's ground position", () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    writable: true,
    value: new EventTarget(),
  });
  try {
    const { canvas, camera, input } = createInput();
    input.setMode("edit");
    dispatch(canvas, "pointermove", { clientX: 620, clientY: 90 });
    const before = { ...input.mouseWorld };
    dispatch(canvas, "wheel", { clientX: 620, clientY: 90, deltaY: -100 });

    closeTo(input.mouseWorld.x, before.x);
    closeTo(input.mouseWorld.z, before.z);
    assert.notEqual(camera.centerX, 10);
    assert.notEqual(camera.centerZ, 20);
  } finally {
    if (previousWindow) {
      Object.defineProperty(globalThis, "window", previousWindow);
    } else {
      delete globalThis.window;
    }
  }
});
