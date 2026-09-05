// @ts-check

import { InputController } from "./browser/input.js";
import { AiView } from "./browser/ai_view.js";
import { DeveloperToolbox } from "./browser/developer_toolbox.js";
import { AuthoringEditorController } from "./browser/authoring_editor.js";
import { AuthoringInspector } from "./browser/authoring_inspector.js";
import { LayerPanel } from "./browser/layer_panel.js";
import { MapPalette } from "./browser/map_palette.js";
import { SpellLab } from "./browser/spell_lab.js";
import { ArenaUi } from "./browser/ui.js";
import { APPLICATION_VERSION, SCHEMA_VERSION } from "./config.js";
import { createPresentation } from "./presentation/factory.js";
import { createNavigationTopologyView } from "./presentation/navigation_topology_view.js";
import {
  focusCameraOnPlayer,
  syncPlayerCamera,
} from "./presentation/player_camera.js";
import {
  parsePresentationOptions,
  PresentationFlags,
} from "./presentation/options.js";
import {
  collectDeviceBrowserFacts,
  PerformanceCapture,
} from "./presentation/performance_capture.js";
import { RenderLab } from "./presentation/render_lab.js";
import { FixedStepRuntime } from "./runtime/fixed_step_runtime.js";
import { normalizeQuarterTurns } from "./authoring/footprint.js";
import {
  AuthoringHistory,
  commandFromAuthoringAction,
} from "./authoring/authoring_history.js";
import {
  ArenaScenario,
  createHoleDebugArenaScenario,
  createNavigationDebugArenaScenario,
  createVerticalDebugArenaScenario,
} from "./sim/scenario.js";
import { Simulation } from "./sim/simulation.js";
import { TrueSightSystem } from "./visibility/true_sight.js";
import {
  queryVisibleAt,
  resolveVisibleSelection,
} from "./visibility/presentation_gate.js";

const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById("arena"));
if (!canvas) throw new Error("Missing #arena canvas");

const requestedArena = new URLSearchParams(window.location.search).get("arena");
const elevatorArenaRequested = requestedArena === "elevator";
const holeArenaRequested = requestedArena === "holes";
const navigationArenaRequested = requestedArena === "navigation";
const simulation = new Simulation({
  ...(elevatorArenaRequested
    ? { scenario: createVerticalDebugArenaScenario() }
    : holeArenaRequested
      ? { scenario: createHoleDebugArenaScenario() }
      : navigationArenaRequested
        ? { scenario: createNavigationDebugArenaScenario() }
        : {}),
});
const initialSnapshot = simulation.snapshot();
const ui = new ArenaUi();
const presentationOptions = parsePresentationOptions(window.location.search);
const presentationFlags = new PresentationFlags(presentationOptions);
const trueSight = new TrueSightSystem({ flags: presentationFlags });
let mode = /** @type {"play"|"edit"} */ ("play");
let sightFrame = trueSight.update(initialSnapshot, 0, {
  mode,
  deltaMs: 0,
});
const renderLab = new RenderLab(presentationOptions);
const developerToolbox = new DeveloperToolbox({
  focusTarget: canvas,
  onClose: () => {
    renderLab.close();
    if (mode === "edit") toggleMode();
  },
});
document.body.dataset.renderer = presentationOptions.renderer;
ui.beginPresentationWarmup(presentationOptions.renderer);
let presentationBundle = null;
try {
  presentationBundle = await createPresentation(
    canvas,
    presentationOptions,
    initialSnapshot,
    presentationFlags,
    sightFrame,
  );
} catch (error) {
  ui.failPresentationWarmup();
  ui.showError(error);
  developerToolbox.setOpen(true);
  renderLab.showFailure(error);
}
if (presentationBundle) {
const { camera, presentation } = presentationBundle;
renderLab.attachPresentation(presentation);
document.body.dataset.backend = presentation.diagnostics().activeBackend;
let resumeAfterEdit = false;
let editorLayerBeforePlay = initialSnapshot.authoring.playerStartLayerId;
let pinned = /** @type {{kind:string,id:number|string}|null} */ (null);
let input;
let spellLab;
let aiView;
let performanceCapture;
let mapPalette;
let layerPanel;
let authoringEditor;
let authoringInspector;
let authoringHistory;

function presentationDiagnostics() {
  const diagnostics = presentation.diagnostics();
  return {
    ...diagnostics,
    flags: presentationFlags.snapshot(),
    trueSightCpuMs: sightFrame.timing.totalMs,
    trueSight: {
      rayCount: sightFrame.rayCount,
      polygonVertexCount: sightFrame.polygonVertexCount,
      visibleWallCount: sightFrame.visibleWallCount,
      maskWidth: sightFrame.maskWidth,
      maskHeight: sightFrame.maskHeight,
      fallbackUsed: sightFrame.fallbackUsed,
    },
  };
}

const runtime = new FixedStepRuntime({
  simulation,
  commandProvider: () => input.sampleCommand(),
  render: (snapshot, alpha, metrics) => {
    if (snapshot.level.state === "defeated" && runtime.paused && mode === "play") {
      runtime.resume();
    }
    if (syncPlayerCamera(camera, snapshot.player, alpha, mode)) {
      input.refreshPointerWorld();
    }
    sightFrame = trueSight.update(snapshot, alpha, { mode });
    const developerToolsOpen = developerToolbox.isOpen;
    const cursorVisible = mode === "edit"
      || sightFrame.isPointVisible(input.mouseWorld.x, input.mouseWorld.z);
    const hover = developerToolsOpen && input.mouseInside
      ? queryVisibleAt(
        simulation,
        sightFrame,
        input.mouseWorld.x,
        input.mouseWorld.z,
        mode,
      )
      : null;
    const selection = developerToolsOpen
      ? resolveVisibleSelection(simulation, sightFrame, pinned)
      : { entity: null, hidden: false };
    const selected = selection.entity;
    const pinnedHidden = selection.hidden;
    const editorView = authoringEditor
      ? mode === "edit"
        ? authoringEditor.sync(snapshot, {
          x: input.mouseWorld.x,
          z: input.mouseWorld.z,
          inside: input.mouseInside && developerToolsOpen,
        })
        : authoringEditor.snapshot()
      : null;
    if (editorView) {
      mapPalette?.sync(editorView);
      layerPanel?.sync(editorView);
      authoringInspector?.update(snapshot, editorView);
    }
    const presentationSnapshot = mode === "edit" && snapshot.editorMap
      ? { ...snapshot, map: snapshot.editorMap }
      : snapshot;
    const navigationTopologySnapshot = developerToolsOpen
      ? simulation.navigationTopologySnapshot()
      : null;
    const selectedAiKey = aiView?.snapshot().selectedKey ?? null;
    const selectedAiId = selectedAiKey?.startsWith("enemyWizard:")
      ? Number(selectedAiKey.slice("enemyWizard:".length))
      : Number.NaN;
    const selectedAiEnemy = snapshot.enemies.find((enemy) => enemy.id === selectedAiId);
    const topologyPresentationInput = navigationTopologySnapshot && selectedAiEnemy?.navigationRoute
      ? {
        ...navigationTopologySnapshot,
        selectedRoute: selectedAiEnemy.navigationRoute.ports,
        localGoal: selectedAiEnemy.navigationRoute.localGoal,
      }
      : navigationTopologySnapshot;
    const navigationTopology = createNavigationTopologyView({
      topology: topologyPresentationInput,
      editor: editorView,
      developerToolsOpen,
    });
    presentation.render(presentationSnapshot, alpha, {
      mouseWorld: input.mouseWorld,
      mouseInside: input.mouseInside && cursorVisible,
      hover,
      selected,
      mode,
      editorTool: editorView?.selectedDefinitionId ?? "structure.wall",
      placementValid: editorView?.placementPreview?.valid ?? true,
      authoringEditor: editorView,
      navigationTopology,
      sightFrame,
      developerToolsOpen,
    });
    aiView?.update(
      navigationTopologySnapshot ? { ...snapshot, navigationTopology: navigationTopologySnapshot } : snapshot,
      alpha,
      sightFrame,
      developerToolsOpen,
    );
    const currentPresentationDiagnostics = presentationDiagnostics();
    ui.update(snapshot, metrics, {
      mouseWorld: input.mouseWorld,
      hover,
      inspected: selected,
      pinnedHidden,
      mode,
      developerToolsOpen,
    }, currentPresentationDiagnostics);
    if (developerToolsOpen) {
      spellLab?.update(snapshot);
      renderLab.update(currentPresentationDiagnostics, metrics);
    }
    performanceCapture?.observe(
      snapshot,
      metrics,
      currentPresentationDiagnostics,
    );
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

/** Runs a mutation immediately so history advances only after fixed-tick acceptance. */
function applyImmediateMutation(command) {
  const resumeAfter = !runtime.paused && mode === "play";
  if (!runtime.paused) runtime.pause();
  const accepted = injectMutation(command);
  const error = accepted ? simulation.lastError : "Runtime command queue is full";
  const result = {
    ok: accepted && !error,
    error,
    snapshot: simulation.snapshot(),
  };
  if (resumeAfter) runtime.resume();
  return result;
}

/** @param {Record<string,any>} command @param {"forward"|"reverse"} direction */
function applyHistoryCommand(command, direction) {
  trueSight.requestSnap("map");
  pinned = null;
  return applyImmediateMutation({
    type: "applyAuthoringCommand",
    command,
    direction,
  });
}

const LAYER_SCOPED_AUTHORING_ACTIONS = new Set([
  "setTile",
  "paintSurface",
  "paintSurfaceStroke",
  "eraseSurface",
  "eraseSurfaceStroke",
  "paintStructure",
  "paintStructureStroke",
  "eraseStructure",
  "eraseStructureStroke",
  "placeRock",
  "placeInstance",
  "removeInstance",
  "updateInstanceTransform",
  "updateInstanceProperties",
  "placeNavigationNode",
  "moveNavigationNode",
  "removeNavigationNode",
  "updateNavigationNode",
  "placeNavigationLink",
  "removeNavigationLink",
]);

/** @param {Record<string,unknown>} action */
function commitAuthoringAction(action) {
  try {
    const scopedAction = LAYER_SCOPED_AUTHORING_ACTIONS.has(String(action.type))
      && typeof action.layerId !== "string"
      && authoringEditor
      ? { ...action, layerId: authoringEditor.snapshot().activeLayerId }
      : action;
    const command = commandFromAuthoringAction(simulation.authoringDocument(), scopedAction);
    const result = authoringHistory.execute(command);
    return {
      ok: result.ok,
      error: result.error,
      snapshot: result.snapshot ?? simulation.snapshot(),
      recorded: result.recorded,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      snapshot: simulation.snapshot(),
      recorded: false,
    };
  }
}

function singleStep() {
  if (simulation.levelState === "defeated") {
    runtime.resume();
    ui.announce("Defeat countdown continues automatically");
    return;
  }
  runtime.pause();
  runtime.step(1);
}

function togglePause() {
  if (simulation.levelState === "defeated") {
    runtime.resume();
    ui.announce("Defeat countdown cannot be paused");
    return false;
  }
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
  trueSight.requestSnap("reset");
  runtime.reset(seed);
  pinned = null;
  ui.announce(newSeed ? `Reset with seed 0x${seed.toString(16)}` : "Reset current seed");
}

function toggleMode() {
  if (simulation.levelState === "defeated") {
    runtime.resume();
    ui.announce("Editing resumes after the arena restarts");
    return;
  }
  if (mode === "play") {
    resumeAfterEdit = !runtime.paused;
    runtime.pause();
    mode = "edit";
    // Begin editing where the live player currently is.  This changes only
    // the editor/view recipe; it never rewinds a body to its authored start.
    const runtimeLayerId = simulation.authoringSnapshot().runtimeLayerId;
    if (runtimeLayerId && runtimeLayerId !== simulation.authoringSnapshot().activeLayerId) {
      if (!authoringEditor?.activateLayer(runtimeLayerId)) {
        ui.showError(`Could not activate runtime layer "${runtimeLayerId}" for editing`);
      }
    }
  } else {
    authoringEditor?.cancel();
    editorLayerBeforePlay = authoringEditor?.snapshot().activeLayerId
      ?? simulation.authoringSnapshot().playerStartLayerId;
    authoringEditor?.setReferenceLayer(null);
    // Leaving edit mode resumes the same disposable simulation.  The explicit
    // Restore positions control remains the only authored-state rewind.
    trueSight.requestSnap("map");
    pinned = null;
    mode = "play";
    if (resumeAfterEdit) runtime.resume();
    resumeAfterEdit = false;
  }
  input.setMode(mode);
  if (mode === "edit") {
    authoringEditor?.sync(simulation.snapshot(), {
      x: input.mouseWorld.x,
      z: input.mouseWorld.z,
      inside: input.mouseInside,
    });
  }
  if (syncPlayerCamera(
    camera,
    runtime.lastSnapshot.player,
    runtime.metrics().alpha,
    mode,
  )) {
    input.refreshPointerWorld();
  }
  ui.setMode(mode);
  ui.announce(
    mode === "edit"
      ? "Edit mode paused: choose a catalog definition"
      : "Play mode resumed: RMB move, LMB cast",
  );
}

function focusPlayer() {
  focusCameraOnPlayer(
    camera,
    runtime.lastSnapshot.player,
    runtime.metrics().alpha,
  );
  input?.refreshPointerWorld();
}

/** @param {number} x @param {number} z */
function focusWorldPoint(x, z) {
  camera.focus(x, z);
  input?.refreshPointerWorld();
}

/** @param {number} x @param {number} z */
function pinAt(x, z) {
  if (!developerToolbox.isOpen) return;
  if (mode !== "edit" && !sightFrame.isPointVisible(x, z)) {
    ui.announce("Hidden locations cannot be pinned");
    return;
  }
  const entity = simulation.queryAt(x, z);
  if (pinned && pinned.kind === entity.kind && String(pinned.id) === String(entity.id)) {
    pinned = null;
    ui.announce("Inspector unpinned");
  } else {
    pinned = { kind: entity.kind, id: entity.id };
    aiView?.selectMob(entity.kind, entity.id);
    ui.announce(`Pinned ${entity.kind} ${entity.id}`);
  }
}

authoringHistory = new AuthoringHistory({
  apply: applyHistoryCommand,
});

authoringEditor = new AuthoringEditorController({
  snapshot: initialSnapshot,
  validatePlacement: (definitionId, x, z, rotation, ignoreId, layerId) => (
    simulation.validateInstanceTransform(definitionId, x, z, rotation, ignoreId, layerId)
  ),
  commit: commitAuthoringAction,
  activateLayer: (layerId) => {
    trueSight.requestSnap("map");
    pinned = null;
    return applyImmediateMutation({ type: "activateLayer", layerId });
  },
  layerSnapshot: (layerId) => simulation.authoringLayerSnapshot(layerId),
  validateMap: () => simulation.authoringValidation(),
  historySnapshot: () => authoringHistory.snapshot(),
  undo: () => authoringHistory.undo(),
  redo: () => authoringHistory.redo(),
  announce: (message) => ui.announce(message),
});

spellLab = new SpellLab({
  listSpells: () => simulation.listSpells(),
  getDefinition: (id) => simulation.getSpellDefinition(id),
  inject: injectMutation,
  diagnostics: (id) => simulation.spellDiagnostics(id),
  announce: (message) => ui.announce(message),
});

aiView = new AiView({
  canvas,
  camera,
  announce: (message) => ui.announce(message),
});

input = new InputController(canvas, camera, {
  inject: injectMutation,
  togglePause,
  step: singleStep,
  reset,
  toggleMode,
  developerToolsOpen: () => developerToolbox.isOpen,
  focusPlayer,
  pinAt,
  editorPointerMove: (x, z, inside) => authoringEditor.pointerMove(x, z, inside),
  editorPointerLeave: () => authoringEditor.pointerLeave(),
  editorPointerDown: (button, x, z) => authoringEditor.pointerDown(button, x, z),
  editorPointerUp: (button, x, z, options) => (
    authoringEditor.pointerUp(button, x, z, options)
  ),
  cancelEditorAction: () => authoringEditor.cancel(),
  rotateEditorSelection: () => authoringEditor.rotate(),
  undoEditor: () => authoringEditor.undo(),
  redoEditor: () => authoringEditor.redo(),
  createCast: (x, z) => spellLab.createCast(x, z),
});

function restoreAuthoredPositions() {
  trueSight.requestSnap("reset");
  injectMutation({ type: "restoreScenario" });
  pinned = null;
  ui.announce("Restored authored body positions");
}

mapPalette = new MapPalette({
  definitions: simulation.listPlaceableDefinitions(),
  selectedId: authoringEditor.snapshot().selectedDefinitionId,
  onSelect: (definitionId) => {
    authoringEditor.setDefinition(definitionId);
    ui.setEditorTool(definitionId);
  },
  onTool: (tool) => authoringEditor.setTool(tool),
  onChannel: (channel) => authoringEditor.setChannel(channel),
  onRotate: () => authoringEditor.rotate(),
  onUndo: () => authoringEditor.undo(),
  onRedo: () => authoringEditor.redo(),
  onExtents: (value) => authoringEditor.setShowAuthoringExtents(value),
  onRestore: restoreAuthoredPositions,
});
mapPalette.sync(authoringEditor.snapshot());

layerPanel = new LayerPanel({
  onActivate: (layerId) => authoringEditor.activateLayer(layerId),
  onReference: (layerId) => authoringEditor.setReferenceLayer(layerId),
  onCreate: (direction) => {
    const layerId = authoringEditor.createLayer(direction);
    if (layerId) layerPanel.clearExternalDiagnostics();
    return layerId;
  },
  onRename: (layerId, name) => {
    const ok = authoringEditor.renameLayer(layerId, name);
    if (ok) layerPanel.clearExternalDiagnostics();
    return ok;
  },
  onBaseY: (layerId, baseY) => {
    const ok = authoringEditor.setLayerBaseY(layerId, baseY);
    if (ok) layerPanel.clearExternalDiagnostics();
    return ok;
  },
  onDelete: (layerId) => {
    const ok = authoringEditor.deleteLayer(layerId);
    if (ok) layerPanel.clearExternalDiagnostics();
    return ok;
  },
  onSetStart: (layerId) => {
    const ok = authoringEditor.setPlayerStartLayer(layerId);
    if (ok) layerPanel.clearExternalDiagnostics();
    return ok;
  },
  onValidate: () => authoringEditor.validateMap(),
});
layerPanel.sync(authoringEditor.snapshot());

authoringInspector = new AuthoringInspector({
  onUpdate: (instanceId, transform) => {
    const ok = authoringEditor.updateInstanceTransform(instanceId, transform);
    return { ok, message: authoringEditor.snapshot().status.message };
  },
  onUpdateProperties: (instanceId, properties) => {
    const ok = authoringEditor.updateInstanceProperties(instanceId, properties);
    return { ok, message: authoringEditor.snapshot().status.message };
  },
  onRotate: (instanceId) => {
    const instance = simulation.getAuthoredInstance(instanceId);
    const ok = Boolean(instance && authoringEditor.updateInstanceTransform(instanceId, {
      x: instance.x,
      z: instance.z,
      rotation: normalizeQuarterTurns(instance.rotation + 1),
    }));
    return { ok, message: authoringEditor.snapshot().status.message };
  },
  onDelete: (instanceId) => {
    const ok = authoringEditor.removeInstance(instanceId);
    return { ok, message: authoringEditor.snapshot().status.message };
  },
  onUpdateConnector: (connectorId, changes) => {
    const ok = authoringEditor.updateConnector(connectorId, changes);
    return { ok, message: authoringEditor.snapshot().status.message };
  },
  onDeleteConnector: (connectorId) => {
    const ok = authoringEditor.removeConnector(connectorId);
    return { ok, message: authoringEditor.snapshot().status.message };
  },
  onUpdateNavigationNode: (nodeId, changes) => {
    const ok = authoringEditor.updateNavigationNode(nodeId, changes);
    return { ok, message: authoringEditor.snapshot().status.message };
  },
  onDeleteNavigationNode: (nodeId) => {
    const ok = authoringEditor.removeNavigationNode(nodeId);
    return { ok, message: authoringEditor.snapshot().status.message };
  },
});
authoringInspector.update(simulation.snapshot(), authoringEditor.snapshot());

/** @param {string} id @param {()=>void} handler */
function onButton(id, handler) {
  document.getElementById(id)?.addEventListener("click", handler);
}

onButton("pause-button", togglePause);
onButton("step-button", singleStep);
onButton("reset-button", () => reset(false));
onButton("mode-button", toggleMode);
onButton("focus-button", focusPlayer);

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
  return true;
}

/** @param {unknown} error */
function validationFromError(error) {
  const issues = error && typeof error === "object" && Array.isArray(error.issues)
    ? error.issues.map((entry) => ({ ...entry }))
    : [{
      severity: "error",
      code: "load-or-save-failed",
      path: "map",
      message: error instanceof Error ? error.message : String(error),
    }];
  return {
    diagnostics: issues,
    errorCount: issues.filter((entry) => entry.severity !== "warning").length,
    warningCount: issues.filter((entry) => entry.severity === "warning").length,
  };
}

onButton("save-map-button", () => {
  try {
    const validation = authoringEditor.validateMap();
    layerPanel.setExternalDiagnostics(validation);
    if (validation.errorCount > 0) throw new RangeError("Map validation errors block saving");
    downloadJson("lantern-scenario.json", simulation.saveScenario());
    authoringHistory.markSaved();
    layerPanel.clearExternalDiagnostics();
    ui.announce("Scenario JSON exported; saved revision updated");
  } catch (error) {
    layerPanel.setExternalDiagnostics(validationFromError(error));
    ui.showError(error);
  }
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

/** @param {string|unknown} json */
function loadAuthoringJson(json) {
  const loadedScenario = ArenaScenario.fromJSON(json);
  const result = applyImmediateMutation({
    type: "loadScenario",
    json: loadedScenario.toAuthoringJSON(),
  });
  if (!result.ok) throw new RangeError(result.error ?? "Scenario load was rejected");
  authoringHistory.clear();
  authoringEditor.replaceDocument(result.snapshot);
  editorLayerBeforePlay = result.snapshot.authoring.playerStartLayerId;
  layerPanel.clearExternalDiagnostics();
  return loadedScenario;
}

mapFileInput.addEventListener("change", async () => {
  const file = mapFileInput.files?.[0];
  if (!file) return;
  try {
    const json = await file.text();
    const loadedScenario = loadAuthoringJson(json);
    pinned = null;
    focusWorldPoint(loadedScenario.map.playerSpawn.x, loadedScenario.map.playerSpawn.z);
    ui.clearError();
    ui.announce(`Loaded ${file.name}`);
  } catch (error) {
    layerPanel.setExternalDiagnostics(validationFromError(error));
    ui.showError(error);
  } finally {
    mapFileInput.value = "";
  }
});

const probe = Object.freeze({
  pause() {
    if (simulation.levelState === "defeated") return false;
    runtime.pause();
    return true;
  },
  resume() {
    if (mode === "edit") return false;
    runtime.resume();
    return true;
  },
  step(count = 1) {
    if (simulation.levelState === "defeated") {
      runtime.resume();
      return simulation.snapshot();
    }
    runtime.pause();
    return runtime.step(count);
  },
  reset(seed = simulation.seed) {
    trueSight.requestSnap("reset");
    runtime.reset(seed);
    return true;
  },
  snapshot() {
    return { ...simulation.snapshot(), runtime: runtime.metrics() };
  },
  metrics() {
    return runtime.metrics();
  },
  presentation() {
    const runtimeMetrics = runtime.metrics();
    return {
      ...presentationDiagnostics(),
      snapshotMs: runtimeMetrics.snapshotMs,
      renderCpuMs: runtimeMetrics.renderMs,
    };
  },
  trueSight() {
    return sightFrame.diagnostics();
  },
  encounterDiagnostics() {
    return simulation.encounterDiagnostics();
  },
  enemyDiagnostics(id) {
    return simulation.enemyDiagnostics(id === undefined ? undefined : Number(id));
  },
  navigationTopology() {
    return simulation.navigationTopologySnapshot();
  },
  navigationRouteEvents() {
    return simulation.navigationRouteEvents();
  },
  developerTools() {
    return {
      open: developerToolbox.isOpen,
      shortcut: ";",
    };
  },
  setDeveloperTools(open) {
    return developerToolbox.setOpen(Boolean(open));
  },
  aiView() {
    return aiView.snapshot();
  },
  setAiView(viewMode, id, kind = "enemyWizard") {
    if (id !== undefined && !aiView.selectMob(String(kind), id)) return false;
    return aiView.setMode(viewMode);
  },
  isVisible(x, z, radius = 0) {
    return sightFrame.isCircleVisible(
      Number(x),
      Number(z),
      Math.max(0, Number(radius) || 0),
    );
  },
  queryAt(x, z) {
    return simulation.queryAt(Number(x), Number(z));
  },
  elevators() {
    return simulation.snapshot().elevators.map((elevator) => structuredClone(elevator));
  },
  holes(layerId = null) {
    const snapshot = simulation.snapshot();
    if (layerId === null || layerId === undefined) return structuredClone(snapshot.map.holes ?? []);
    return structuredClone(simulation.authoringLayerSnapshot(String(layerId))?.holes ?? []);
  },
  holeDiagnostics() {
    const snapshot = simulation.snapshot();
    return {
      metrics: structuredClone(snapshot.holeMetrics ?? {}),
      recentEvents: structuredClone(snapshot.recentHoleEvents ?? []),
    };
  },
  pressurePlates() {
    return structuredClone(simulation.snapshot().pressurePlates ?? []);
  },
  pressurePlateEvents() {
    return structuredClone(simulation.snapshot().recentPressurePlateEvents ?? []);
  },
  breakawayFloors() {
    return structuredClone(simulation.snapshot().breakawayFloors ?? []);
  },
  breakawayFloorEvents() {
    return structuredClone(simulation.snapshot().recentBreakawayFloorEvents ?? []);
  },
  verticalBody(kind, id) {
    return simulation.resolveSelection({ kind: String(kind), id: Number(id) });
  },
  cycleElevator(connectorId) {
    return injectMutation({ type: "cycleElevator", connectorId: String(connectorId) });
  },
  summonElevator(connectorId, stop = "lower") {
    if (stop !== "lower" && stop !== "upper") return false;
    return injectMutation({ type: "summonElevator", connectorId: String(connectorId), stop });
  },
  authoring() {
    const editor = authoringEditor.snapshot();
    const history = editor.history;
    return {
      ...simulation.authoringSnapshot(),
      selectedPaletteDefinition: mapPalette.snapshot().selectedDefinitionId,
      palette: mapPalette.snapshot(),
      editor,
      activeTool: editor.activeTool,
      activeChannel: editor.activeChannel,
      selectedDefinitionId: editor.selectedDefinitionId,
      hoveredTarget: editor.hoveredTarget,
      selectedTarget: editor.selectedTarget,
      placementPreview: editor.placementPreview,
      showAuthoringExtents: editor.showAuthoringExtents,
      history,
      canUndo: history.canUndo,
      canRedo: history.canRedo,
      undoDepth: history.undoDepth,
      redoDepth: history.redoDepth,
      historyCapacity: history.capacity,
      currentCommandLabel: history.currentCommandLabel,
      nextUndoLabel: history.nextUndoLabel,
      nextRedoLabel: history.nextRedoLabel,
      dirty: history.dirty,
      currentAuthoringRevisionId: history.currentRevisionId,
      savedAuthoringRevisionId: history.savedRevisionId,
      transactionActive: history.transactionActive,
      activeEditorLayerId: editor.activeLayerId,
      referenceLayerId: editor.referenceLayerId,
      playerStartLayerId: editor.playerStartLayerId,
      currentRuntimeLayerId: simulation.authoringSnapshot().runtimeLayerId,
      compiledLayerIds: [...simulation.authoringSnapshot().compiledLayerIds],
      layerCapacity: simulation.authoringSnapshot().layerCapacity,
      layerSummaries: editor.layers.map((layer) => ({ ...layer })),
      validation: {
        diagnostics: editor.validation.diagnostics.map((entry) => ({ ...entry })),
        errorCount: editor.validation.errorCount,
        warningCount: editor.validation.warningCount,
      },
    };
  },
  editor() {
    return authoringEditor.snapshot();
  },
  authoringHistory() {
    return { ...authoringEditor.snapshot().history };
  },
  undoAuthoring() {
    return mode === "edit" && authoringEditor.undo();
  },
  redoAuthoring() {
    return mode === "edit" && authoringEditor.redo();
  },
  listPlaceableDefinitions() {
    return simulation.listPlaceableDefinitions();
  },
  setPaletteDefinition(definitionId) {
    return mapPalette.setSelected(
      definitionId === null || definitionId === "erase" ? null : String(definitionId),
    );
  },
  setEditorTool(tool) {
    return mapPalette.setTool(String(tool));
  },
  setAuthoringChannel(channel) {
    return mapPalette.setChannel(String(channel));
  },
  setAuthoringExtents(value) {
    return mapPalette.setExtents(Boolean(value));
  },
  activateAuthoringLayer(layerId) {
    return mode === "edit" && authoringEditor.activateLayer(String(layerId));
  },
  setReferenceLayer(layerId) {
    if (mode !== "edit") return false;
    return authoringEditor.setReferenceLayer(
      layerId === null || layerId === "" ? null : String(layerId),
    );
  },
  createAuthoringLayer(direction = "above") {
    if (mode !== "edit" || (direction !== "above" && direction !== "below")) return null;
    return authoringEditor.createLayer(direction);
  },
  renameAuthoringLayer(layerId, name) {
    return mode === "edit" && authoringEditor.renameLayer(String(layerId), String(name));
  },
  setAuthoringLayerBaseY(layerId, baseY) {
    return mode === "edit"
      && authoringEditor.setLayerBaseY(String(layerId), Number(baseY));
  },
  deleteAuthoringLayer(layerId) {
    return mode === "edit" && authoringEditor.deleteLayer(String(layerId));
  },
  setPlayerStartLayer(layerId) {
    return mode === "edit" && authoringEditor.setPlayerStartLayer(String(layerId));
  },
  validateAuthoringMap() {
    return authoringEditor.validateMap();
  },
  authoringLayer(layerId) {
    return simulation.authoringLayerSnapshot(String(layerId));
  },
  selectAuthoringAt(x, z) {
    return authoringEditor.selectAt(Number(x), Number(z));
  },
  getAuthoredInstance(authoringId) {
    return simulation.getAuthoredInstance(String(authoringId));
  },
  getAuthoredConnector(connectorId) {
    return simulation.getAuthoredConnector(String(connectorId));
  },
  placeElevatorConnector(lowerLayerId, upperLayerId, x, z, options = {}) {
    if (mode !== "edit") return false;
    return commitAuthoringAction({
      ...options,
      type: "placeConnector",
      definitionId: "connector.elevator.two-stop",
      lowerLayerId: String(lowerLayerId),
      upperLayerId: String(upperLayerId),
      x: Number(x),
      z: Number(z),
    }).ok;
  },
  updateElevatorConnector(connectorId, changes = {}) {
    return mode === "edit"
      && authoringEditor.updateConnector(String(connectorId), changes);
  },
  removeElevatorConnector(connectorId) {
    return mode === "edit" && authoringEditor.removeConnector(String(connectorId));
  },
  setTile(cx, cz, tile) {
    if (!simulation.map.inBounds(Math.trunc(cx), Math.trunc(cz))) return false;
    return commitAuthoringAction({ type: "setTile", cx, cz, tile }).ok;
  },
  paintSurface(cx, cz, definitionId = "surface.stone") {
    if (!simulation.map.inBounds(Math.trunc(cx), Math.trunc(cz))) return false;
    return commitAuthoringAction({ type: "paintSurface", cx, cz, definitionId }).ok;
  },
  paintHole(cx, cz) {
    if (!simulation.map.inBounds(Math.trunc(cx), Math.trunc(cz))) return false;
    return commitAuthoringAction({ type: "paintSurface", cx, cz, definitionId: "surface.hole" }).ok;
  },
  paintStructure(cx, cz, definitionId = "structure.wall") {
    if (!simulation.map.inBounds(Math.trunc(cx), Math.trunc(cz))) return false;
    return commitAuthoringAction({ type: "paintStructure", cx, cz, definitionId }).ok;
  },
  eraseSurface(cx, cz) {
    if (!simulation.map.inBounds(Math.trunc(cx), Math.trunc(cz))) return false;
    return commitAuthoringAction({ type: "eraseSurface", cx, cz }).ok;
  },
  eraseStructure(cx, cz) {
    if (!simulation.map.inBounds(Math.trunc(cx), Math.trunc(cz))) return false;
    return commitAuthoringAction({ type: "eraseStructure", cx, cz }).ok;
  },
  saveMap() {
    const json = simulation.saveMap();
    authoringHistory.markSaved();
    return json;
  },
  saveScenario() {
    const json = simulation.saveScenario();
    authoringHistory.markSaved();
    return json;
  },
  loadMap(json) {
    try {
      const loadedScenario = loadAuthoringJson(json);
      focusWorldPoint(loadedScenario.map.playerSpawn.x, loadedScenario.map.playerSpawn.z);
      return true;
    } catch (error) {
      layerPanel.setExternalDiagnostics(validationFromError(error));
      ui.showError(error);
      return false;
    }
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
    return commitAuthoringAction({ type: "placeRock", archetype, x, z }).ok;
  },
  canPlaceInstance(definitionId, x, z, rotation = 0) {
    return simulation.canPlaceDefinition(
      String(definitionId),
      Number(x),
      Number(z),
      Number(rotation),
    );
  },
  placeInstance(definitionId, x, z, options = {}) {
    const id = String(definitionId);
    const rotation = Number(options.rotation ?? 0);
    if (!simulation.canPlaceDefinition(id, Number(x), Number(z), rotation)) return false;
    return commitAuthoringAction({
      type: "placeInstance",
      definitionId: id,
      x,
      z,
      rotation,
      ...(options.properties === undefined ? {} : { properties: options.properties }),
    }).ok;
  },
  removeInstance(authoringId) {
    if (!simulation.authoringSnapshot().instances.some((instance) => instance.id === String(authoringId))) {
      return false;
    }
    return commitAuthoringAction({ type: "removeInstance", authoringId }).ok;
  },
  updateInstanceTransform(authoringId, transform = {}) {
    const instance = simulation.getAuthoredInstance(String(authoringId));
    if (!instance) return false;
    return authoringEditor.updateInstanceTransform(instance.id, {
      x: Number(transform.x ?? instance.x),
      z: Number(transform.z ?? instance.z),
      rotation: Number(transform.rotation ?? instance.rotation),
    });
  },
  moveInstance(authoringId, x, z) {
    const instance = simulation.getAuthoredInstance(String(authoringId));
    if (!instance) return false;
    return authoringEditor.updateInstanceTransform(instance.id, {
      x: Number(x),
      z: Number(z),
      rotation: instance.rotation,
    });
  },
  rotateInstance(authoringId, delta = 1) {
    const instance = simulation.getAuthoredInstance(String(authoringId));
    if (!instance) return false;
    return authoringEditor.updateInstanceTransform(instance.id, {
      x: instance.x,
      z: instance.z,
      rotation: normalizeQuarterTurns(instance.rotation + Number(delta)),
    });
  },
  updateInstanceProperties(authoringId, properties = {}) {
    return authoringEditor.updateInstanceProperties(String(authoringId), properties);
  },
  removeEntity(kind, id) {
    if (String(kind) !== "rock") return false;
    const authoringId = simulation.authoringIdForRuntimeBodyId(Number(id));
    return authoringId
      ? commitAuthoringAction({ type: "removeInstance", authoringId }).ok
      : false;
  },
  restoreScenario() {
    trueSight.requestSnap("reset");
    return injectMutation({ type: "restoreScenario" });
  },
  injectCommand(command) {
    if (command && typeof command === "object" && !Array.isArray(command)) {
      const action = /** @type {Record<string,any>} */ (command);
      if (action.type === "loadMap" || action.type === "loadScenario") {
        return this.loadMap(action.json);
      }
      if (
        LAYER_SCOPED_AUTHORING_ACTIONS.has(String(action.type))
        || new Set([
          "createLayer",
          "deleteLayer",
          "renameLayer",
          "setLayerBaseY",
          "setPlayerStartLayer",
          "placeConnector",
          "removeConnector",
          "updateConnector",
          "placeNavigationLink",
          "removeNavigationLink",
        ]).has(String(action.type))
      ) {
        return commitAuthoringAction(action).ok;
      }
    }
    return injectMutation(command);
  },
  exportCommandLog() {
    return simulation.exportCommandLog();
  },
  listSpells() {
    return simulation.listSpells();
  },
  getSpellDefinition(id) {
    return simulation.getSpellDefinition(String(id));
  },
  applySpellDefinition(id, definition, expectedRevision) {
    const spellId = String(id);
    const before = simulation.getSpellDefinition(spellId);
    const validation = simulation.validateSpellDefinition(
      spellId,
      definition,
      expectedRevision === undefined ? undefined : Number(expectedRevision),
    );
    if (!validation.ok) {
      return {
        ok: false,
        spellId,
        queued: false,
        errors: validation.errors,
      };
    }
    const requestedRevision = expectedRevision === undefined
      ? before?.revision
      : Number(expectedRevision);
    const consumedImmediately = runtime.paused;
    const accepted = injectMutation({
      type: "applySpellDefinition",
      spellId,
      expectedRevision,
      definition,
    });
    const after = simulation.getSpellDefinition(spellId);
    const applied = Boolean(
      accepted
      && consumedImmediately
      && before
      && after
      && after.revision === before.revision + 1,
    );
    const immediateErrors = consumedImmediately
      && simulation.lastSpellResult?.ok === false
      ? simulation.lastSpellResult.errors
      : [];
    return {
      ok: accepted && immediateErrors.length === 0,
      spellId,
      queued: accepted && !consumedImmediately,
      applied,
      revision: applied ? after?.revision ?? null : null,
      expectedRevision: requestedRevision,
      nextRevision: applied
        ? after?.revision ?? null
        : before
          ? before.revision + 1
          : null,
      errors: immediateErrors.length > 0
        ? immediateErrors
        : !accepted
          ? [{
            path: "",
            code: "command_queue",
            message: "Runtime command queue is full",
          }]
          : [],
    };
  },
  castSpell(id, x, z, options = {}) {
    const spellId = String(id);
    if (!simulation.getSpellDefinition(spellId)) {
      return {
        ok: false,
        queued: false,
        errors: [{
          path: "spellId",
          code: "unknown_spell",
          message: `Unknown spell "${spellId}"`,
        }],
      };
    }
    const castX = Number(x);
    const castZ = Number(z);
    if (!Number.isFinite(castX) || !Number.isFinite(castZ)) {
      return {
        ok: false,
        queued: false,
        errors: [{
          path: "cast",
          code: "finite_number",
          message: "Cast x and z must be finite",
        }],
      };
    }
    const cast = { x: castX, z: castZ, spellId };
    if (options && Object.hasOwn(options, "variationSeed")) {
      const seed = options.variationSeed;
      if (
        typeof seed !== "number"
        || !Number.isInteger(seed)
        || seed < 0
        || seed > 0xffff_ffff
      ) {
        return {
          ok: false,
          queued: false,
          errors: [{
            path: "options.variationSeed",
            code: "uint32",
            message: "variationSeed must be a uint32",
          }],
        };
      }
      Object.assign(cast, { variationSeed: seed >>> 0 });
    }
    const accepted = injectMutation({ cast });
    return {
      ok: accepted,
      queued: accepted,
      spellId,
      cast,
      errors: accepted
        ? []
        : [{
          path: "",
          code: "command_queue",
          message: "Runtime command queue is full",
        }],
    };
  },
  clearSpellEffects(id) {
    const spellId = String(id);
    if (!simulation.getSpellDefinition(spellId)) {
      return {
        ok: false,
        queued: false,
        errors: [{
          path: "spellId",
          code: "unknown_spell",
          message: `Unknown spell "${spellId}"`,
        }],
      };
    }
    const accepted = injectMutation({ type: "clearSpellEffects", spellId });
    return {
      ok: accepted,
      queued: accepted,
      spellId,
      errors: accepted
        ? []
        : [{
          path: "",
          code: "command_queue",
          message: "Runtime command queue is full",
        }],
    };
  },
  spellDiagnostics(id) {
    return simulation.spellDiagnostics(String(id));
  },
  setDebugFlag(name, value) {
    if (!Object.hasOwn(simulation.debugFlags, String(name))) return false;
    return injectMutation({ type: "setDebugFlag", name, value });
  },
  setPresentationFlag(name, value) {
    return presentation.setPresentationFlag(String(name), value);
  },
  setPixelDensityCap(value) {
    return presentation.setPixelDensityCap(Number(value));
  },
  resetPerformanceMetrics() {
    runtime.resetPerformanceMetrics();
    presentation.resetPerformanceMetrics();
    trueSight.resetPerformanceMetrics();
    return true;
  },
  capturePerformance() {
    return performanceCapture.capture();
  },
  startPerformanceCapture() {
    return performanceCapture.capture();
  },
  latestPerformanceReport() {
    return performanceCapture.latestReport;
  },
  performanceReport() {
    return performanceCapture.latestReport;
  },
});

performanceCapture = new PerformanceCapture({
  applicationVersion: APPLICATION_VERSION,
  resetMetrics: () => {
    runtime.resetPerformanceMetrics();
    presentation.resetPerformanceMetrics();
    trueSight.resetPerformanceMetrics();
  },
  runtimeMetrics: () => runtime.metrics(),
  presentationDiagnostics,
  deviceFacts: () => collectDeviceBrowserFacts(window, navigator),
  beginGpuCapture: () => presentation.beginGpuTimingCapture(),
  endGpuCapture: () => presentation.endGpuTimingCapture(),
});
renderLab.setCaptureHandler(() => performanceCapture.capture());

Object.defineProperty(window, "__lantern", {
  value: probe,
  configurable: false,
  enumerable: false,
  writable: false,
});
ui.setMode(mode);
ui.setEditorTool(authoringEditor.snapshot().selectedDefinitionId);
focusPlayer();
runtime.start();
ui.finishPresentationWarmup();
window.dispatchEvent(new CustomEvent("lantern:ready", {
  detail: {
    schemaVersion: SCHEMA_VERSION,
    presentation: presentationDiagnostics(),
  },
}));
}
