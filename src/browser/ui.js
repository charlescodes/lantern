// @ts-check

/** @param {number} value @param {number} [digits] */
function number(value, digits = 2) {
  return Number.isFinite(value) ? value.toFixed(digits) : "--";
}

/** @param {unknown} value */
function rounded(value) {
  if (typeof value === "number") return Number(value.toFixed(4));
  if (Array.isArray(value)) return value.map(rounded);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, rounded(item)]));
  }
  return value;
}

/** @param {string} id */
function required(id) {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing UI element #${id}`);
  return element;
}

export class ArenaUi {
  constructor() {
    this.pauseButton = /** @type {HTMLButtonElement} */ (required("pause-button"));
    this.modeButton = /** @type {HTMLButtonElement} */ (required("mode-button"));
    this.statusPill = required("run-status");
    this.tickValue = required("tick-value");
    this.seedValue = required("seed-value");
    this.pointerValue = required("pointer-value");
    this.telemetry = required("telemetry-output");
    this.inspector = required("inspector-output");
    this.events = required("events-output");
    this.rockPool = required("rock-pool");
    this.projectilePool = required("projectile-pool");
    this.particlePool = required("particle-pool");
    this.rockBar = /** @type {HTMLElement} */ (required("rock-bar"));
    this.projectileBar = /** @type {HTMLElement} */ (required("projectile-bar"));
    this.particleBar = /** @type {HTMLElement} */ (required("particle-bar"));
    this.error = required("error-output");
    this.toast = required("toast");
    this.lastUiUpdate = 0;
    this.toastTimer = 0;
  }

  /** @param {"play"|"edit"} mode */
  setMode(mode) {
    this.modeButton.textContent = mode === "play" ? "Enter edit" : "Return to play";
    this.modeButton.dataset.mode = mode;
    document.body.dataset.mode = mode;
  }

  /** @param {string} tool */
  setEditorTool(tool) {
    for (const button of document.querySelectorAll("[data-editor-tool]")) {
      const element = /** @type {HTMLButtonElement} */ (button);
      const selected = element.dataset.editorTool === tool;
      element.classList.toggle("is-active", selected);
      element.setAttribute("aria-pressed", String(selected));
    }
  }

  /** @param {string} message */
  announce(message) {
    this.toast.textContent = message;
    this.toast.classList.add("is-visible");
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toast.classList.remove("is-visible"), 1_800);
  }

  /** @param {unknown} error */
  showError(error) {
    this.error.textContent = error instanceof Error ? error.message : String(error);
    this.error.hidden = false;
  }

  clearError() {
    this.error.hidden = true;
    this.error.textContent = "";
  }

  /**
   * @param {ReturnType<import('../sim/simulation.js').Simulation['snapshot']>} snapshot
   * @param {ReturnType<import('../runtime/fixed_step_runtime.js').FixedStepRuntime['metrics']>} metrics
   * @param {{mouseWorld:{x:number,z:number},hover:Record<string,unknown>|null,inspected:Record<string,unknown>|null,mode:string}} view
   */
  update(snapshot, metrics, view) {
    const now = performance.now();
    if (now - this.lastUiUpdate < 80) return;
    this.lastUiUpdate = now;
    this.pauseButton.textContent = metrics.paused ? "Resume" : "Pause";
    this.statusPill.textContent = metrics.paused ? "PAUSED" : "RUNNING";
    this.statusPill.classList.toggle("is-paused", metrics.paused);
    this.tickValue.textContent = String(snapshot.tick);
    this.seedValue.textContent = `0x${snapshot.seed.toString(16).padStart(8, "0")}`;
    const cx = Math.floor(view.mouseWorld.x);
    const cz = Math.floor(view.mouseWorld.z);
    this.pointerValue.textContent = `x ${number(view.mouseWorld.x)}  z ${number(view.mouseWorld.z)}  ·  cell ${cx},${cz}`;
    this.telemetry.textContent = [
      `fps       ${number(metrics.fps, 1)}`,
      `accum     ${number(metrics.accumulator * 1_000, 2)} ms  α ${number(metrics.alpha, 3)}`,
      `sim ms    ${number(metrics.simMs.p50)} / ${number(metrics.simMs.p95)} / ${number(metrics.simMs.p99)}`,
      `render ms ${number(metrics.renderMs.p50)} / ${number(metrics.renderMs.p95)} / ${number(metrics.renderMs.p99)}`,
      `queue     ${metrics.queuedCommands}  dropped ${metrics.droppedCommands}`,
      `log       ${snapshot.commandLog.retained}/${snapshot.commandLog.capacity}  dropped ${snapshot.commandLog.dropped}`,
      `contacts  ${snapshot.contacts.length}  dropped ${snapshot.contactMetrics.dropped}`,
    ].join("\n");
    this.rockPool.textContent = `${snapshot.pools.rocks.active} / ${snapshot.pools.rocks.capacity}  ·  dropped ${snapshot.pools.rocks.dropped}  ·  caps ${snapshot.pools.rocks.speedClamped}`;
    this.projectilePool.textContent = `${snapshot.pools.projectiles.active} / ${snapshot.pools.projectiles.capacity}  ·  dropped ${snapshot.pools.projectiles.dropped}`;
    this.particlePool.textContent = [
      `${snapshot.pools.particles.active} / ${snapshot.pools.particles.capacity}`,
      `dropped ${snapshot.pools.particles.dropped}`,
      `wall bounces ${snapshot.pools.particles.wallBounces}`,
      `collision discards ${snapshot.pools.particles.collisionDiscards}`,
    ].join("  ·  ");
    this.rockBar.style.width = `${(snapshot.pools.rocks.active / snapshot.pools.rocks.capacity) * 100}%`;
    this.projectileBar.style.width = `${(snapshot.pools.projectiles.active / snapshot.pools.projectiles.capacity) * 100}%`;
    this.particleBar.style.width = `${(snapshot.pools.particles.active / snapshot.pools.particles.capacity) * 100}%`;
    const inspected = view.inspected ?? view.hover;
    this.inspector.textContent = inspected
      ? JSON.stringify(rounded(inspected), null, 2)
      : "Move over the arena to inspect. Click to pin.";
    const events = snapshot.recentEvents.slice(-5).reverse();
    this.events.textContent = events.length
      ? events.map((event) => {
        const blocked = event.responses.filter((response) => response.blocked).length;
        const hit = event.hit.kind === "rock" ? `rock ${event.hit.id}` : `cell ${event.hit.cx},${event.hit.cz}`;
        return `#${event.tick} blast p${event.projectileId} -> ${hit}\n  ${event.responses.length} in radius · ${blocked} wall-blocked`;
      }).join("\n")
      : "No explosions recorded.";
    if (snapshot.lastError) {
      this.error.textContent = snapshot.lastError;
      this.error.hidden = false;
    }
  }
}
