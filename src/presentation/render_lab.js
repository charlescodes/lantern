// @ts-check

import {
  PRESENTATION_FLAG_NAMES,
  parsePresentationOptions,
  presentationOptionMode,
  presentationOptionsToSearch,
  updatePresentationSearch,
} from "./options.js";

/** @param {number} value @param {number} [digits] */
function formatted(value, digits = 2) {
  return Number.isFinite(value) ? Number(value).toFixed(digits) : "--";
}

/** @param {string} id */
function required(id) {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing Render Lab element #${id}`);
  return element;
}

/**
 * Produces a direct recovery route without introducing non-URL persistence.
 * @param {string|URLSearchParams} search
 * @param {"lower-lights"|"webgl"|"canvas"} recovery
 */
export function recoveryPresentationSearch(search, recovery) {
  const options = parsePresentationOptions(search);
  if (recovery === "canvas") {
    return presentationOptionsToSearch({
      ...options,
      renderer: "2d",
      backend: "auto",
      forceWebGL: false,
    });
  }
  if (recovery === "webgl") {
    return presentationOptionsToSearch({
      ...options,
      renderer: "3d",
      backend: "webgl",
      forceWebGL: true,
    });
  }
  const lower = options.lights === 64
    ? 32
    : options.lights === 32
      ? 16
      : 8;
  return presentationOptionsToSearch({
    ...options,
    renderer: "3d",
    lights: lower,
  });
}

export class RenderLab {
  /** @param {ReturnType<typeof parsePresentationOptions>} bootOptions */
  constructor(bootOptions) {
    this.bootOptions = bootOptions;
    this.presentation = null;
    this.captureHandler = null;
    this.latestReport = null;
    this.lastUpdate = 0;
    this.dialog = /** @type {HTMLDialogElement} */ (required("render-lab-dialog"));
    this.reloadButton = /** @type {HTMLButtonElement} */ (
      required("render-lab-reload")
    );
    this.captureButton = /** @type {HTMLButtonElement} */ (
      required("render-lab-capture")
    );
    this.copyButton = /** @type {HTMLButtonElement} */ (
      required("render-lab-copy")
    );
    this.downloadButton = /** @type {HTMLButtonElement} */ (
      required("render-lab-download")
    );
    this.status = required("render-lab-status");
    this.diagnostics = required("render-lab-diagnostics");
    this.reportOutput = required("render-lab-report");
    this.failure = required("render-lab-failure");
    this.failureMessage = required("render-lab-failure-message");
    this.controls = [...document.querySelectorAll("[data-presentation-option]")];

    required("render-lab-button").addEventListener("click", () => this.open());
    required("render-lab-close").addEventListener("click", () => this.close());
    this.reloadButton.addEventListener("click", () => window.location.reload());
    this.captureButton.addEventListener("click", () => this.#capture());
    this.copyButton.addEventListener("click", () => this.#copyReport());
    this.downloadButton.addEventListener("click", () => this.#downloadReport());
    for (const control of this.controls) {
      control.addEventListener("change", () => this.#change(control));
    }
    for (const button of document.querySelectorAll("[data-render-recovery]")) {
      button.addEventListener("click", () => {
        const recovery = /** @type {HTMLElement} */ (button).dataset.renderRecovery;
        if (
          recovery !== "lower-lights"
          && recovery !== "webgl"
          && recovery !== "canvas"
        ) return;
        this.#navigate(recoveryPresentationSearch(window.location.search, recovery));
      });
    }

    this.#syncControls(bootOptions);
    this.#updateReloadState();
    this.captureButton.disabled = true;
    this.copyButton.disabled = true;
    this.downloadButton.disabled = true;
  }

  open() {
    if (typeof this.dialog.showModal === "function") {
      if (!this.dialog.open) this.dialog.showModal();
    } else {
      this.dialog.setAttribute("open", "");
    }
  }

  close() {
    if (typeof this.dialog.close === "function") this.dialog.close();
    else this.dialog.removeAttribute("open");
  }

  /** @param {Record<string,any>} presentation */
  attachPresentation(presentation) {
    this.presentation = presentation;
    const current = parsePresentationOptions(window.location.search);
    presentation.setPixelDensityCap(current.dpr);
    for (const name of PRESENTATION_FLAG_NAMES) {
      presentation.setPresentationFlag(name, current[name]);
    }
    this.clearFailure();
  }

  /** @param {()=>Promise<Record<string,any>>} handler */
  setCaptureHandler(handler) {
    this.captureHandler = handler;
    this.captureButton.disabled = false;
  }

  /** @param {unknown} error */
  showFailure(error) {
    this.failureMessage.textContent = error instanceof Error
      ? error.message
      : String(error);
    this.failure.hidden = false;
    this.status.textContent = "3D initialization failed. Choose a recovery route.";
    this.open();
  }

  clearFailure() {
    this.failure.hidden = true;
    this.failureMessage.textContent = "";
  }

  /** @param {Record<string,any>} presentation @param {Record<string,any>} runtime */
  update(presentation, runtime) {
    const now = performance.now();
    if (now - this.lastUpdate < 100) return;
    this.lastUpdate = now;
    const css = presentation.cssResolution ?? {};
    const backing = presentation.backingResolution ?? {};
    const frame = runtime.frameMs ?? {};
    const renderer = runtime.renderMs ?? {};
    const phases = presentation.presentationCpuMs?.totalMs ?? {};
    const trueSight = presentation.trueSight ?? {};
    const trueSightCpu = presentation.trueSightCpuMs ?? {};
    this.diagnostics.textContent = [
      `backend       ${presentation.activeBackend ?? "initializing"}`,
      `resolution    CSS ${css.width ?? "--"}×${css.height ?? "--"}  backing ${backing.width ?? "--"}×${backing.height ?? "--"}`,
      `effective DPR ${formatted(presentation.effectiveDpr, 2)}`,
      `lights        ${presentation.activeLightCount ?? 0}/${presentation.residentLightCount ?? 0} active/resident`,
      `frame ms      ${formatted(frame.p50)} / ${formatted(frame.p95)} / ${formatted(frame.p99)}  p50/p95/p99`,
      `renderer CPU  ${formatted(renderer.p50)} / ${formatted(renderer.p95)} / ${formatted(renderer.p99)} ms`,
      `present CPU   ${formatted(phases.p50)} / ${formatted(phases.p95)} / ${formatted(phases.p99)} ms`,
      `TrueSight CPU ${formatted(trueSightCpu.p50)} / ${formatted(trueSightCpu.p95)} / ${formatted(trueSightCpu.p99)} ms`,
      `TrueSight     ${trueSight.rayCount ?? 0} rays  ${trueSight.polygonVertexCount ?? 0} vertices  ${trueSight.visibleWallCount ?? 0} walls  ${trueSight.maskWidth ?? "--"}×${trueSight.maskHeight ?? "--"}`,
      `GPU timing    ${presentation.gpuTimingAvailable ? "available during capture" : "unavailable"}${presentation.gpuRenderMs === null || presentation.gpuRenderMs === undefined ? "" : `  latest ${formatted(presentation.gpuRenderMs)} ms`}`,
    ].join("\n");
  }

  getLatestReport() {
    return this.latestReport;
  }

  /** @param {Element} control */
  #change(control) {
    const element = /** @type {HTMLInputElement|HTMLSelectElement} */ (control);
    const name = element.dataset.presentationOption;
    if (!name) return;
    const value = element instanceof HTMLInputElement && element.type === "checkbox"
      ? element.checked
      : element.value;
    const nextSearch = updatePresentationSearch(
      window.location.search,
      name,
      value,
    );
    if (!nextSearch) return;
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${nextSearch}${window.location.hash}`,
    );
    const options = parsePresentationOptions(nextSearch);
    this.#syncControls(options);
    if (presentationOptionMode(name) === "live" && this.presentation) {
      if (name === "dpr") this.presentation.setPixelDensityCap(options.dpr);
      else this.presentation.setPresentationFlag(name, options[name]);
      this.status.textContent = `${name} applied live`;
    }
    this.#updateReloadState();
  }

  /** @param {ReturnType<typeof parsePresentationOptions>} options */
  #syncControls(options) {
    for (const control of this.controls) {
      const element = /** @type {HTMLInputElement|HTMLSelectElement} */ (control);
      const name = element.dataset.presentationOption;
      if (!name || !(name in options)) continue;
      if (element instanceof HTMLInputElement && element.type === "checkbox") {
        element.checked = Boolean(options[name]);
      } else {
        element.value = String(options[name]);
      }
    }
  }

  #updateReloadState() {
    const current = parsePresentationOptions(window.location.search);
    const reloadRequired = ["renderer", "backend", "lights", "aa"].some(
      (name) => current[name] !== this.bootOptions[name],
    );
    this.reloadButton.disabled = !reloadRequired;
    this.reloadButton.hidden = !reloadRequired;
    if (reloadRequired) this.status.textContent = "Startup setting changed · reload required";
  }

  async #capture() {
    if (!this.captureHandler || this.captureButton.disabled) return;
    this.captureButton.disabled = true;
    this.captureButton.textContent = "Capturing 10s…";
    this.status.textContent = "Recording unscripted gameplay for ten seconds";
    try {
      const report = await this.captureHandler();
      this.latestReport = report;
      this.reportOutput.textContent = JSON.stringify(report, null, 2);
      this.copyButton.disabled = false;
      this.downloadButton.disabled = false;
      this.status.textContent = "Capture complete · report ready";
    } catch (error) {
      this.status.textContent = error instanceof Error ? error.message : String(error);
    } finally {
      this.captureButton.disabled = false;
      this.captureButton.textContent = "Capture 10 seconds";
    }
  }

  async #copyReport() {
    if (!this.latestReport) return;
    const json = JSON.stringify(this.latestReport, null, 2);
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(json);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = json;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.append(textarea);
        textarea.select();
        const copied = document.execCommand("copy");
        textarea.remove();
        if (!copied) throw new Error("Clipboard copy was rejected");
      }
      this.status.textContent = "Report copied";
    } catch {
      this.status.textContent = "Clipboard unavailable · select the JSON report manually";
    }
  }

  #downloadReport() {
    if (!this.latestReport) return;
    const json = JSON.stringify(this.latestReport, null, 2);
    const url = URL.createObjectURL(
      new Blob([json], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `lantern-performance-${Date.now()}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    this.status.textContent = "Report downloaded";
  }

  /** @param {string} search */
  #navigate(search) {
    window.location.assign(
      `${window.location.pathname}${search}${window.location.hash}`,
    );
  }
}
