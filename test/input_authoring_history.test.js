import test from "node:test";
import assert from "node:assert/strict";

import { Camera2D } from "../src/browser/camera.js";
import { InputController } from "../src/browser/input.js";

class FakeCanvas extends EventTarget {
  getBoundingClientRect() {
    return { left: 0, top: 0, width: 800, height: 400 };
  }

  setPointerCapture() {}

  hasPointerCapture() {
    return false;
  }

  releasePointerCapture() {}
}

/** @param {EventTarget} target @param {Record<string,unknown>} values */
function keydown(target, values) {
  const event = new Event("keydown", { cancelable: true });
  for (const [name, value] of Object.entries(values)) {
    Object.defineProperty(event, name, { value });
  }
  target.dispatchEvent(event);
  return event;
}

function actions(overrides = {}) {
  return {
    inject: () => {},
    togglePause: () => {},
    step: () => {},
    reset: () => {},
    toggleMode: () => {},
    focusPlayer: () => {},
    pinAt: () => {},
    ...overrides,
  };
}

test("edit-only Ctrl/Meta undo and redo shortcuts do not depend on gameplay hotkeys", () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const fakeWindow = new EventTarget();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    writable: true,
    value: fakeWindow,
  });
  try {
    const calls = { undo: 0, redo: 0 };
    const camera = new Camera2D();
    camera.resize(800, 400);
    const input = new InputController(
      /** @type {any} */ (new FakeCanvas()),
      camera,
      actions({
        developerToolsOpen: () => false,
        undoEditor: () => { calls.undo += 1; },
        redoEditor: () => { calls.redo += 1; },
      }),
    );

    const playUndo = keydown(fakeWindow, { key: "z", ctrlKey: true, metaKey: false, altKey: false, shiftKey: false });
    assert.equal(playUndo.defaultPrevented, false);
    assert.deepEqual(calls, { undo: 0, redo: 0 });

    input.setMode("edit");
    assert.equal(
      keydown(fakeWindow, { key: "z", ctrlKey: true, metaKey: false, altKey: false, shiftKey: false }).defaultPrevented,
      true,
    );
    keydown(fakeWindow, { key: "y", ctrlKey: true, metaKey: false, altKey: false, shiftKey: false });
    keydown(fakeWindow, { key: "Z", ctrlKey: false, metaKey: true, altKey: false, shiftKey: true });
    assert.deepEqual(calls, { undo: 1, redo: 2 });
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else delete globalThis.window;
  }
});

test("history shortcuts leave native text editing targets alone", () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousInput = Object.getOwnPropertyDescriptor(globalThis, "HTMLInputElement");
  class FakeInput extends EventTarget {}
  const fakeInputWindow = new FakeInput();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    writable: true,
    value: fakeInputWindow,
  });
  Object.defineProperty(globalThis, "HTMLInputElement", {
    configurable: true,
    writable: true,
    value: FakeInput,
  });
  try {
    let undoCount = 0;
    const camera = new Camera2D();
    camera.resize(800, 400);
    const input = new InputController(
      /** @type {any} */ (new FakeCanvas()),
      camera,
      actions({ undoEditor: () => { undoCount += 1; } }),
    );
    input.setMode("edit");
    const event = keydown(fakeInputWindow, {
      key: "z",
      ctrlKey: true,
      metaKey: false,
      altKey: false,
      shiftKey: false,
    });
    assert.equal(event.defaultPrevented, false);
    assert.equal(undoCount, 0);
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else delete globalThis.window;
    if (previousInput) Object.defineProperty(globalThis, "HTMLInputElement", previousInput);
    else delete globalThis.HTMLInputElement;
  }
});
