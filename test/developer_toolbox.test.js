import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  DeveloperToolbox,
  isDeveloperToolboxShortcut,
} from "../src/browser/developer_toolbox.js";

function fakeSurface(initial = {}) {
  const attributes = new Map(Object.entries(initial));
  return {
    getAttribute(name) {
      return attributes.has(name) ? attributes.get(name) : null;
    },
    hasAttribute(name) {
      return attributes.has(name);
    },
    setAttribute(name, value) {
      attributes.set(name, String(value));
    },
    removeAttribute(name) {
      attributes.delete(name);
    },
    toggleAttribute(name, force) {
      if (force) attributes.set(name, "");
      else attributes.delete(name);
    },
  };
}

test("semicolon is the sole unshifted developer toolbox gate", () => {
  assert.equal(isDeveloperToolboxShortcut({ code: "Semicolon", key: ";" }), true);
  assert.equal(isDeveloperToolboxShortcut({ code: "Other", key: ";" }), true);
  assert.equal(isDeveloperToolboxShortcut({ code: "Semicolon", key: ":", shiftKey: true }), false);
  assert.equal(isDeveloperToolboxShortcut({ code: "KeyE", key: "e" }), false);
});

test("developer surfaces boot inert, restore prior accessibility state, and close as one toolbox", () => {
  const body = { dataset: { developerTools: "closed" } };
  const visibleSurface = fakeSurface();
  const alwaysHiddenSurface = fakeSurface({ "aria-hidden": "true" });
  let closeCount = 0;
  let focusCount = 0;
  let layoutCount = 0;
  const toolbox = new DeveloperToolbox({
    body,
    surfaces: [visibleSurface, alwaysHiddenSurface],
    eventTarget: null,
    toggleButton: null,
    focusTarget: { focus: () => { focusCount += 1; } },
    onClose: () => { closeCount += 1; },
    requestLayout: () => { layoutCount += 1; },
  });

  assert.equal(toolbox.isOpen, false);
  assert.equal(visibleSurface.getAttribute("aria-hidden"), "true");
  assert.equal(visibleSurface.hasAttribute("inert"), true);

  let prevented = 0;
  assert.equal(toolbox.handleKeyDown({
    code: "Semicolon",
    key: ";",
    repeat: true,
    target: null,
    preventDefault: () => { prevented += 1; },
  }), true);
  assert.equal(toolbox.isOpen, false);
  assert.equal(prevented, 1);

  assert.equal(toolbox.setOpen(true), true);
  assert.equal(body.dataset.developerTools, "open");
  assert.equal(visibleSurface.getAttribute("aria-hidden"), null);
  assert.equal(visibleSurface.hasAttribute("inert"), false);
  assert.equal(alwaysHiddenSurface.getAttribute("aria-hidden"), "true");

  assert.equal(toolbox.setOpen(false), false);
  assert.equal(body.dataset.developerTools, "closed");
  assert.equal(closeCount, 1);
  assert.equal(focusCount, 1);
  assert.equal(layoutCount, 2);
  toolbox.dispose();
});

test("playtest markup starts clean and keeps every developer surface under one CSS gate", async () => {
  const [html, css, main, input, renderer] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../styles.css", import.meta.url), "utf8"),
    readFile(new URL("../src/main.js", import.meta.url), "utf8"),
    readFile(new URL("../src/browser/input.js", import.meta.url), "utf8"),
    readFile(new URL("../src/browser/renderer.js", import.meta.url), "utf8"),
  ]);

  assert.match(html, /<body data-mode="play" data-developer-tools="closed">/);
  assert.match(html, /id="developer-toolbox"[\s\S]*?data-developer-surface/);
  assert.match(html, /id="spell-lab"[\s\S]*?data-collapsed="true"[\s\S]*?hidden/);
  assert.match(html, /id="spell-lab-open"[\s\S]*?aria-expanded="false"/);
  assert.match(css, /body\[data-developer-tools="closed"\] \[data-developer-surface\][\s\S]*?display: none !important/);
  assert.match(css, /body\[data-developer-tools="closed"\] \.workspace[\s\S]*?height: 100dvh/);
  assert.match(main, /developerToolsOpen: \(\) => developerToolbox\.isOpen/);
  assert.match(input, /!this\.actions\.developerToolsOpen\(\)[\s\S]*?return/);
  assert.match(renderer, /developerToolsOpen && snapshot\.debugFlags\.velocityVectors/);
});
