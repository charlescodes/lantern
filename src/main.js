// @ts-check

import { Camera2D } from "./browser/camera.js";
import { InputController } from "./browser/input.js";
import { DebugRenderer } from "./browser/renderer.js";
import { ArenaUi } from "./browser/ui.js";
import { FixedStepRuntime } from "./runtime/fixed_step_runtime.js";
import { GridMap } from "./sim/grid_map.js";
import { Simulation } from "./sim/simulation.js";

const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById("arena"));
if (!canvas) throw new Error("Missing #arena canvas");

const simulation = new Simulation();
const camera = new Camera2D();
const renderer = new DebugRenderer(canvas, camera);
const ui = new ArenaUi();
let mode = /** @type {"play"|"edit"} */ ("play");
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
  mode = mode === "play" ? "edit" : "play";
  input.setMode(mode);
  ui.setMode(mode);
  ui.announce(mode === "edit" ? "Edit mode: LMB wall, RMB floor" : "Play mode: RMB move, LMB cast");
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

input = new InputController(canvas, camera, {
  inject: injectMutation,
  togglePause: () => runtime.togglePause(),
  step: singleStep,
  reset,
  toggleMode,
  focusPlayer: () => camera.focus(simulation.player.x, simulation.player.z),
  pinAt,
});

/** @param {string} id @param {()=>void} handler */
function onButton(id, handler) {
  document.getElementById(id)?.addEventListener("click", handler);
}

onButton("pause-button", () => runtime.togglePause());
onButton("step-button", singleStep);
onButton("reset-button", () => reset(false));
onButton("mode-button", toggleMode);
onButton("focus-button", () => camera.focus(simulation.player.x, simulation.player.z));

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
  downloadJson("lantern-map.json", simulation.saveMap());
  ui.announce("Map JSON exported");
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
    const loadedMap = GridMap.fromJSON(json);
    injectMutation({ type: "loadMap", json });
    pinned = null;
    camera.focus(loadedMap.playerSpawn.x, loadedMap.playerSpawn.z);
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
  loadMap(json) {
    const loadedMap = GridMap.fromJSON(json);
    const accepted = injectMutation({ type: "loadMap", json });
    if (accepted) camera.focus(loadedMap.playerSpawn.x, loadedMap.playerSpawn.z);
    return accepted;
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
camera.focus(simulation.player.x, simulation.player.z);
runtime.start();
window.dispatchEvent(new CustomEvent("lantern:ready", { detail: { schemaVersion: 1 } }));
