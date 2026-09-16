import test from "node:test";
import assert from "node:assert/strict";

import { setTextContentIfChanged } from "../src/browser/ui.js";

test("unchanged inspector text preserves its existing DOM text node", () => {
  let text = "stable inspection";
  let writes = 0;
  const element = {
    get textContent() {
      return text;
    },
    set textContent(value) {
      writes += 1;
      text = value;
    },
  };

  assert.equal(setTextContentIfChanged(element, "stable inspection"), false);
  assert.equal(writes, 0);
  assert.equal(setTextContentIfChanged(element, "updated inspection"), true);
  assert.equal(writes, 1);
  assert.equal(text, "updated inspection");
});
