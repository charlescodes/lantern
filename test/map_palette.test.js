import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { listPlaceableDefinitions } from "../src/authoring/definition_catalog.js";
import { groupPaletteDefinitions } from "../src/browser/map_palette.js";

test("the centralized catalog contains the representative M1A definitions", () => {
  const definitions = listPlaceableDefinitions();
  const ids = new Set(definitions.map((definition) => definition.id));
  for (const id of [
    "surface.stone",
    "surface.moss",
    "structure.wall",
    "object.rock.medium",
    "object.pillar",
    "object.torch",
  ]) {
    assert.equal(ids.has(id), true, `missing ${id}`);
  }
  assert.equal(definitions.find((value) => value.id === "surface.moss")?.traits.blocksMovement, false);
  assert.equal(definitions.find((value) => value.id === "structure.wall")?.traits.blocksMovement, true);
  assert.equal(definitions.find((value) => value.id === "object.pillar")?.traits.blocksSight, true);
  assert.equal(definitions.find((value) => value.id === "object.torch")?.renderAsset, null);
});

test("palette groups are derived from catalog categories in stable order", () => {
  const groups = groupPaletteDefinitions(listPlaceableDefinitions());
  assert.deepEqual(groups.map((group) => group.id), ["surface", "structure", "object"]);
  assert.deepEqual(
    groups[0].definitions.map((definition) => definition.id),
    ["surface.stone", "surface.moss"],
  );
  assert.equal(groups[1].definitions[0].placementMode, "paint");
  assert.equal(groups[2].definitions.every((definition) => definition.placementMode === "stamp"), true);
});

test("editor markup provides one generated palette mount instead of per-definition buttons", async () => {
  const [html, main] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../src/main.js", import.meta.url), "utf8"),
  ]);
  assert.match(html, /id="map-palette"[\s\S]*?data-developer-surface/);
  assert.doesNotMatch(html, /data-editor-tool=/);
  assert.match(main, /new MapPalette\(\{[\s\S]*?simulation\.listPlaceableDefinitions\(\)/);
});
