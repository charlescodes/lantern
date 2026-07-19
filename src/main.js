// @ts-check

import { Camera2D } from "./browser/camera.js";
import { InputController } from "./browser/input.js";
import { DebugRenderer } from "./browser/renderer.js";
import { ArenaUi } from "./browser/ui.js";
import { SCHEMA_VERSION } from "./config.js";
import { FixedStepRuntime } from "./runtime/fixed_step_runtime.js";
import { ArenaScenario } from "./sim/scenario.js";
import { Simulation } from "./sim/simulation.js";

const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById("arena"));
if (!canvas) throw new Error("Missing #arena canvas");

const simulation = new Simulation();
const camera = new Camera2D();
const renderer = new DebugRenderer(canvas, camera);
const ui = new ArenaUi();
let mode = /** @type {"play"|"edit"} */ ("play");
let editorTool = "wall";
let resumeAfterEdit = false;
let pinned = /** @type {{kind:string,id:number|string}|null} */ (null);
let input;

const runtime = new FixedStepRuntime({
  simulation,
  commandProvider: () => input.sampleCommand(),
  render: (snapshot, alpha, metrics) => {
    const hover = input.mouseInside
      ? /** @type {Record<string, unknown>} */ (simulation.queryAt(input.mouseWorld.x, input.mouseWorld.z))
      : null;
    const selected = pinned
      ? /** @type {Record<string, unknown>|null} */ (simulation.resolveSelection(pinned))
      : null;
    renderer.render(snapshot, alpha, {
      mouseWorld: input.mouseWorld,
      mouseInside: input.mouseInside,
      hover,
      selected,
      mode,
      editorTool,
      placementValid: editorTool === "small" || editorTool === "medium" || editorTool === "large"
        ? simulation.canPlaceRock(
          editorTool,
          Math.round(input.mouseWorld.x * 10) / 10,
          Math.round(input.mouseWorld.z * 10) / 10,
        )
        : true,
    });
    ui.update(snapshot, metrics, {
      mouseWorld: input.mouseWorld,
      hover,
      inspected: selected,
      mode,
    });
  },
  onError: (error) => ui.showError(error),
});

function flushPausedMutation() {
  if (runtime.paused) runtime.step(1);
}

/** @param {unknown} command */
function injectMutation(command) {
  const accepted = runtime.injectCommand(command);
  if (accepted) flushPausedMutation();
  return accepted;
}

function singleStep() {
  runtime.pause();
  runtime.step(1);
}

function togglePause() {
  if (mode === "edit") {
    ui.announce("Edit mode stays paused");
    return true;
  }
  return runtime.togglePause();
}

/** @param {boolean} newSeed */
function reset(newSeed) {
  let seed = simulation.seed;
  if (newSeed) {
    const values = new Uint32Array(1);
    crypto.getRandomValues(values);
    seed = values[0] || 1;
  }
  runtime.reset(seed);
  pinned = null;
  ui.announce(newSeed ? `Reset with seed 0x${seed.toString(16)}` : "Reset current seed");
}

function toggleMode() {
  if (mode === "play") {
    resumeAfterEdit = !runtime.paused;
    runtime.pause();
    mode = "edit";
  } else {
    mode = "play";
    if (resumeAfterEdit) runtime.resume();
    resumeAfterEdit = false;
  }
  input.setMode(mode);
  ui.setMode(mode);
  ui.announce(
    mode === "edit"
      ? "Edit mode paused: choose a wall or rock tool"
      : "Play mode: RMB move, LMB cast",
  );
}

/** @param {number} x @param {number} z */
function pinAt(x, z) {
  const entity = simulation.queryAt(x, z);
  if (pinned && pinned.kind === entity.kind && String(pinned.id) === String(entity.id)) {
    pinned = null;
    ui.announce("Inspector unpinned");
  } else {
    pinned = { kind: entity.kind, id: entity.id };
    ui.announce(`Pinned ${entity.kind} ${entity.id}`);
  }
}

/** @param {string} tool @param {number} button @param {number} x @param {number} z */
function editAt(tool, button, x, z) {
  const cx = Math.floor(x);
  const cz = Math.floor(z);
  if (button === 2 || tool === "erase") {
    const entity = simulation.queryAt(x, z);
    if (entity.kind === "rock") {
      injectMutation({ type: "removeEntity", kind: "rock", id: entity.id });
      if (pinned?.kind === "rock" && Number(pinned.id) === Number(entity.id)) pinned = null;
    } else {
      injectMutation({ type: "setTile", cx, cz, tile: 0 });
    }
    return;
  }
  if (tool === "wall") {
    injectMutation({ type: "setTile", cx, cz, tile: 1 });
    return;
  }
  if (tool === "small" || tool === "medium" || tool === "large") {
    const snappedX = Math.round(x * 10) / 10;
    const snappedZ = Math.round(z * 10) / 10;
    injectMutation({ type: "placeRock", archetype: tool, x: snappedX, z: snappedZ });
  }
}

input = new InputController(canvas, camera, {
  inject: injectMutation,
  togglePause,
  step: singleStep,
  reset,
  toggleMode,
  focusPlayer: () => camera.focus(simulation.player.x, simulation.player.z),
  pinAt,
  editAt,
});

/** @param {string} id @param {()=>void} handler */
function onButton(id, handler) {
  document.getElementById(id)?.addEventListener("click", handler);
}

onButton("pause-button", togglePause);
onButton("step-button", singleStep);
onButton("reset-button", () => reset(false));
onButton("mode-button", toggleMode);
onButton("focus-button", () => camera.focus(simulation.player.x, simulation.player.z));
onButton("restore-scenario-button", () => {
  injectMutation({ type: "restoreScenario" });
  pinned = null;
  ui.announce("Restored authored body positions");
});

for (const button of document.querySelectorAll("[data-editor-tool]")) {
  button.addEventListener("click", () => {
    const element = /** @type {HTMLButtonElement} */ (button);
    editorTool = element.dataset.editorTool ?? "wall";
    input.setEditorTool(editorTool);
    ui.setEditorTool(editorTool);
  });
}

for (const checkbox of document.querySelectorAll("[data-debug-flag]")) {
  checkbox.addEventListener("change", () => {
    const inputElement = /** @type {HTMLInputElement} */ (checkbox);
    injectMutation({
      type: "setDebugFlag",
      name: inputElement.dataset.debugFlag,
      value: inputElement.checked,
    });
  });
}

/** @param {string} filename @param {unknown} data */
function downloadJson(filename, data) {
  const content = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  const url = URL.createObjectURL(new Blob([content], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

onButton("save-map-button", () => {
  downloadJson("lantern-scenario.json", simulation.saveScenario());
  ui.announce("Scenario JSON exported");
});
onButton("snapshot-button", () => {
  downloadJson("lantern-snapshot.json", { ...simulation.snapshot(), runtime: runtime.metrics() });
  ui.announce("Bounded snapshot exported");
});
onButton("command-log-button", () => {
  downloadJson("lantern-command-log.json", simulation.exportCommandLog());
  ui.announce("Command log exported");
});

const mapFileInput = /** @type {HTMLInputElement} */ (document.getElementById("map-file-input"));
onButton("load-map-button", () => mapFileInput.click());
mapFileInput.addEventListener("change", async () => {
  const file = mapFileInput.files?.[0];
  if (!file) return;
  try {
    const json = await file.text();
    const loadedScenario = ArenaScenario.fromJSON(json);
    injectMutation({ type: "loadScenario", json });
    pinned = null;
    camera.focus(loadedScenario.map.playerSpawn.x, loadedScenario.map.playerSpawn.z);
    ui.clearError();
    ui.announce(`Loaded ${file.name}`);
  } catch (error) {
    ui.showError(error);
  } finally {
    mapFileInput.value = "";
  }
});

const probe = Object.freeze({
  pause() {
    runtime.pause();
    return true;
  },
  resume() {
    if (mode === "edit") return false;
    runtime.resume();
    return true;
  },
  step(count = 1) {
    runtime.pause();
    return runtime.step(count);
  },
  reset(seed = simulation.seed) {
    runtime.reset(seed);
    return true;
  },
  snapshot() {
    return { ...simulation.snapshot(), runtime: runtime.metrics() };
  },
  metrics() {
    return runtime.metrics();
  },
  queryAt(x, z) {
    return simulation.queryAt(Number(x), Number(z));
  },
  setTile(cx, cz, tile) {
    if (!simulation.map.inBounds(Math.trunc(cx), Math.trunc(cz))) return false;
    return injectMutation({ type: "setTile", cx, cz, tile });
  },
  saveMap() {
    return simulation.saveMap();
  },
  saveScenario() {
    return simulation.saveScenario();
  },
  loadMap(json) {
    const loadedScenario = ArenaScenario.fromJSON(json);
    const accepted = injectMutation({ type: "loadScenario", json });
    if (accepted) {
      camera.focus(loadedScenario.map.playerSpawn.x, loadedScenario.map.playerSpawn.z);
    }
    return accepted;
  },
  loadScenario(json) {
    return this.loadMap(json);
  },
  listRockArchetypes() {
    return simulation.listRockArchetypes();
  },
  canPlaceRock(archetype, x, z) {
    return simulation.canPlaceRock(String(archetype), Number(x), Number(z));
  },
  placeRock(archetype, x, z) {
    if (!simulation.canPlaceRock(String(archetype), Number(x), Number(z))) return false;
    return injectMutation({ type: "placeRock", archetype, x, z });
  },
  removeEntity(kind, id) {
    if (String(kind) !== "rock") return false;
    if (!simulation.resolveSelection({ kind: "rock", id: Number(id) })) return false;
    return injectMutation({ type: "removeEntity", kind: "rock", id });
  },
  restoreScenario() {
    return injectMutation({ type: "restoreScenario" });
  },
  injectCommand(command) {
    return injectMutation(command);
  },
  exportCommandLog() {
    return simulation.exportCommandLog();
  },
  setDebugFlag(name, value) {
    if (!Object.hasOwn(simulation.debugFlags, String(name))) return false;
    return injectMutation({ type: "setDebugFlag", name, value });
  },
});

Object.defineProperty(window, "__lantern", {
  value: probe,
  configurable: false,
  enumerable: false,
  writable: false,
});
ui.setMode(mode);
ui.setEditorTool(editorTool);
camera.focus(simulation.player.x, simulation.player.z);
runtime.start();
window.dispatchEvent(new CustomEvent("lantern:ready", { detail: { schemaVersion: SCHEMA_VERSION } }));
