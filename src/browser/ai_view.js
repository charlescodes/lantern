// @ts-check

import {
  AI_VIEW_MODE,
  aiMobKey,
  buildAiViewFrame,
  collectAiMobs,
  describeAiMobOption,
  formatAiMobDetails,
} from "../presentation/ai_view_model.js";

const COLORS = Object.freeze({
  approach: "#69b9ff",
  engage: "#6bc8a8",
  hold: "#a8b5ad",
  withdraw: "#efbd5f",
  dodge: "#d58cff",
  retreat: "#ff6f67",
  unaware: "#8e9a93",
  noticing: "#f3cf65",
  engaged: "#6bc8a8",
  hunting: "#f39b58",
  returning: "#75a9df",
  unknown: "#d7ddd8",
  goal: "#62d9d0",
  desired: "#e6eee9",
  aim: "#ffcf6a",
  sightClear: "#68d69f",
  sightBlocked: "#ff7069",
  threat: "#ff72bd",
  dodgeVector: "#cf8cff",
  selected: "#fff0ac",
  facing: "#fff3c4",
  memory: "#ff9e6f",
  impact: "#ff6f9f",
  search: "#70d7cf",
  guard: "#84a9ff",
});

/** @param {string} id */
function required(id) {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing AI View element #${id}`);
  return element;
}

/** @param {number} value @param {number} minimum @param {number} maximum */
function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

/** @param {{x:number,y:number}} left @param {{x:number,y:number}} right */
function distance(left, right) {
  return Math.hypot(right.x - left.x, right.y - left.y);
}

/** @param {Array<string>} lines @param {number} [maximumLength] */
function wrapLabelLines(lines, maximumLength = 50) {
  const wrapped = [];
  for (const line of lines) {
    let remaining = line;
    while (remaining.length > maximumLength) {
      const separator = remaining.lastIndexOf(" · ", maximumLength);
      const space = remaining.lastIndexOf(" ", maximumLength);
      const splitAt = separator > 0 ? separator : space > 0 ? space : maximumLength;
      wrapped.push(remaining.slice(0, splitAt).trimEnd());
      remaining = remaining.slice(splitAt).replace(/^\s*·?\s*/, "  ");
    }
    wrapped.push(remaining);
  }
  return wrapped;
}

export class AiView {
  /**
   * @param {{
   * canvas:HTMLCanvasElement,
   * camera:{worldToViewport:(x:number,z:number)=>{x:number,y:number}},
   * announce:(message:string)=>void
   * }} options
   */
  constructor(options) {
    this.options = options;
    this.overlay = /** @type {HTMLCanvasElement} */ (required("ai-view-overlay"));
    const context = this.overlay.getContext("2d");
    if (!context) throw new Error("AI View overlay canvas is unavailable");
    this.context = context;
    this.panel = required("ai-view-panel");
    this.openButton = /** @type {HTMLButtonElement} */ (required("ai-view-open"));
    this.closeButton = /** @type {HTMLButtonElement} */ (required("ai-view-close"));
    this.selector = /** @type {HTMLSelectElement} */ (required("ai-view-mob"));
    this.status = required("ai-view-status");
    this.details = required("ai-view-details");
    this.modeInputs = Array.from(
      document.querySelectorAll("input[name='ai-view-mode']"),
    ).map((element) => /** @type {HTMLInputElement} */ (element));
    this.mode = AI_VIEW_MODE.off;
    this.selectedKey = null;
    this.lastSnapshot = null;
    this.lastFrame = null;
    this.mobOptionSignature = "";
    this.openButton.addEventListener("click", () => this.setOpen(true));
    this.closeButton.addEventListener("click", () => this.setOpen(false));
    this.selector.addEventListener("change", () => {
      this.selectedKey = this.selector.value || null;
      this.#renderPanel();
    });
    for (const input of this.modeInputs) {
      input.addEventListener("change", () => {
        if (input.checked) this.setMode(input.value);
      });
    }
    this.#syncModeInputs();
    this.#clearOverlay();
  }

  /** @param {boolean} open */
  setOpen(open) {
    this.panel.hidden = !open;
    this.openButton.setAttribute("aria-expanded", String(open));
    if (open) this.#renderPanel();
    return open;
  }

  /** @param {unknown} mode */
  setMode(mode) {
    const requested = String(mode);
    if (!Object.values(AI_VIEW_MODE).includes(requested)) return false;
    this.mode = requested;
    this.#syncModeInputs();
    if (this.mode === AI_VIEW_MODE.off) this.#clearOverlay();
    this.#renderPanel();
    this.options.announce(
      this.mode === AI_VIEW_MODE.off
        ? "AI View hidden; mob AI continues running"
        : this.mode === AI_VIEW_MODE.selected
          ? "AI View showing the selected mob; mob AI is unchanged"
          : "AI View showing all mobs; mob AI is unchanged",
    );
    return true;
  }

  /** @param {string} kind @param {number|string} id */
  selectMob(kind, id) {
    const key = `${String(kind)}:${String(id)}`;
    const mobs = this.lastSnapshot ? collectAiMobs(this.lastSnapshot) : [];
    if (!mobs.some((mob) => aiMobKey(mob) === key)) return false;
    this.selectedKey = key;
    this.selector.value = key;
    this.#renderPanel();
    return true;
  }

  /**
   * @param {ReturnType<import('../sim/simulation.js').Simulation['snapshot']>} snapshot
   * @param {number} alpha
   * @param {import('../visibility/true_sight.js').TrueSightFrame|null} sightFrame
   */
  update(snapshot, alpha, sightFrame) {
    this.lastSnapshot = snapshot;
    const mobs = collectAiMobs(snapshot);
    if (!this.selectedKey || !mobs.some((mob) => aiMobKey(mob) === this.selectedKey)) {
      this.selectedKey = mobs[0] ? aiMobKey(mobs[0]) : null;
    }
    this.#syncMobOptions(mobs);
    this.lastFrame = buildAiViewFrame(snapshot, alpha, {
      mode: this.mode,
      selectedKey: this.selectedKey,
      isVisible: sightFrame
        ? (mob) => sightFrame.isCircleVisible(
          Number(mob.x),
          Number(mob.z),
          Math.max(0, Number(mob.radius) || 0),
        )
        : undefined,
    });
    this.#draw(this.lastFrame);
    this.#renderPanel();
  }

  #syncModeInputs() {
    for (const input of this.modeInputs) input.checked = input.value === this.mode;
  }

  /** @param {Array<Record<string,any>>} mobs */
  #syncMobOptions(mobs) {
    const signature = mobs.map((mob) => [
      aiMobKey(mob),
      mob.team,
      mob.kind,
      mob.behaviorState ?? mob.aiState,
    ].join("|")).join(";");
    if (signature === this.mobOptionSignature) {
      this.selector.value = this.selectedKey ?? "";
      return;
    }
    this.mobOptionSignature = signature;
    this.selector.replaceChildren();
    if (mobs.length === 0) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "No living AI mobs";
      this.selector.append(option);
      this.selector.disabled = true;
      return;
    }
    this.selector.disabled = false;
    for (const mob of mobs) {
      const option = document.createElement("option");
      option.value = aiMobKey(mob);
      option.textContent = describeAiMobOption(mob);
      this.selector.append(option);
    }
    this.selector.value = this.selectedKey ?? "";
  }

  #renderPanel() {
    const frame = this.lastFrame;
    const availableCount = frame?.availableMobs.length ?? 0;
    const selectedMob = frame?.selectedMob ?? null;
    this.status.textContent = this.mode === AI_VIEW_MODE.off
      ? `View off · ${availableCount} mob${availableCount === 1 ? "" : "s"} available · AI remains active`
      : this.mode === AI_VIEW_MODE.selected
        ? `Selected view · ${selectedMob ? aiMobKey(selectedMob) : "no mob"} · AI remains active`
        : `All-mob view · ${availableCount} mob${availableCount === 1 ? "" : "s"} · AI remains active`;
    this.status.dataset.mode = this.mode;
    this.details.textContent = this.lastSnapshot && selectedMob
      ? formatAiMobDetails(
        this.lastSnapshot,
        selectedMob,
        frame?.selectedSightVisible ?? null,
      )
      : "Waiting for a living AI mob. Selection is read-only.";
  }

  #resizeOverlay() {
    const bounds = this.options.canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(bounds.width));
    const height = Math.max(1, Math.round(bounds.height));
    const backingScale = clamp(
      bounds.width > 0 ? this.options.canvas.width / bounds.width : 1,
      1,
      2,
    );
    const backingWidth = Math.max(1, Math.round(width * backingScale));
    const backingHeight = Math.max(1, Math.round(height * backingScale));
    if (this.overlay.width !== backingWidth || this.overlay.height !== backingHeight) {
      this.overlay.width = backingWidth;
      this.overlay.height = backingHeight;
    }
    this.overlay.style.width = `${width}px`;
    this.overlay.style.height = `${height}px`;
    return { width, height, backingScale };
  }

  #clearOverlay() {
    this.context.setTransform(1, 0, 0, 1, 0, 0);
    this.context.clearRect(0, 0, this.overlay.width, this.overlay.height);
    this.overlay.hidden = this.mode === AI_VIEW_MODE.off;
  }

  /** @param {ReturnType<typeof buildAiViewFrame>} frame */
  #draw(frame) {
    if (frame.mode === AI_VIEW_MODE.off || frame.mobs.length === 0) {
      this.#clearOverlay();
      return;
    }
    const { width, height, backingScale } = this.#resizeOverlay();
    this.overlay.hidden = false;
    const context = this.context;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, this.overlay.width, this.overlay.height);
    context.setTransform(backingScale, 0, 0, backingScale, 0, 0);
    context.lineCap = "round";
    context.lineJoin = "round";
    this.#drawEngagementRings(frame.engagementRings);
    const boxes = [];
    for (let index = 0; index < frame.mobs.length; index += 1) {
      const mob = frame.mobs[index];
      const anchor = this.options.camera.worldToViewport(mob.position.x, mob.position.z);
      if (
        anchor.x < -80 || anchor.y < -80
        || anchor.x > width + 80 || anchor.y > height + 80
      ) {
        continue;
      }
      const stateColor = COLORS[mob.state] ?? COLORS.unknown;
      if (mob.selected) {
        context.beginPath();
        context.arc(anchor.x, anchor.y, 12, 0, Math.PI * 2);
        context.strokeStyle = COLORS.selected;
        context.lineWidth = 2;
        context.stroke();
      }
      this.#drawPerception(mob, anchor);
      if (mob.movementGoal) {
        this.#drawArrow(
          anchor,
          this.options.camera.worldToViewport(mob.movementGoal.x, mob.movementGoal.z),
          COLORS.goal,
          false,
        );
      }
      this.#drawArrow(
        anchor,
        this.options.camera.worldToViewport(mob.desiredEnd.x, mob.desiredEnd.z),
        COLORS.desired,
        false,
      );
      if (mob.predictedAimPoint) {
        this.#drawArrow(
          anchor,
          this.options.camera.worldToViewport(
            mob.predictedAimPoint.x,
            mob.predictedAimPoint.z,
          ),
          COLORS.aim,
          true,
        );
      }
      if (mob.targetPoint) {
        this.#drawLine(
          anchor,
          this.options.camera.worldToViewport(mob.targetPoint.x, mob.targetPoint.z),
          mob.mobTargetVisible ? COLORS.sightClear : COLORS.sightBlocked,
          !mob.mobTargetVisible,
          0.9,
        );
      }
      if (mob.lastSeenPoint) {
        this.#drawWorldMarker(mob.lastSeenPoint, COLORS.memory, "×");
      }
      if (mob.stimulusPoint) {
        this.#drawWorldMarker(mob.stimulusPoint, COLORS.impact, "!");
      }
      if (mob.searchPoint) {
        this.#drawWorldMarker(mob.searchPoint, COLORS.search, "S");
      }
      if (mob.guardPoint) {
        this.#drawWorldMarker(mob.guardPoint, COLORS.guard, "G");
      }
      if (mob.lineOfSightTarget) {
        this.#drawLine(
          anchor,
          this.options.camera.worldToViewport(
            mob.lineOfSightTarget.x,
            mob.lineOfSightTarget.z,
          ),
          mob.lineOfSight ? COLORS.sightClear : COLORS.sightBlocked,
          true,
          0.65,
        );
      }
      if (mob.threatPoint) {
        this.#drawLine(
          anchor,
          this.options.camera.worldToViewport(mob.threatPoint.x, mob.threatPoint.z),
          COLORS.threat,
          true,
          0.9,
        );
      }
      if (mob.dodgeEnd) {
        this.#drawArrow(
          anchor,
          this.options.camera.worldToViewport(mob.dodgeEnd.x, mob.dodgeEnd.z),
          COLORS.dodgeVector,
          false,
        );
      }
      this.#drawMobLabel(mob, anchor, stateColor, index, boxes, width, height);
    }
  }

  /** @param {ReturnType<typeof buildAiViewFrame>['mobs'][number]} mob @param {{x:number,y:number}} anchor */
  #drawPerception(mob, anchor) {
    const cone = mob.perceptionCone;
    if (!cone) return;
    const context = this.context;
    const centerAngle = Math.atan2(cone.facing.z, cone.facing.x);
    context.save();
    context.beginPath();
    context.moveTo(anchor.x, anchor.y);
    const segments = 28;
    for (let index = 0; index <= segments; index += 1) {
      const angle = centerAngle - cone.halfAngleRadians
        + index / segments * cone.halfAngleRadians * 2;
      const point = this.options.camera.worldToViewport(
        cone.x + Math.cos(angle) * cone.radius,
        cone.z + Math.sin(angle) * cone.radius,
      );
      context.lineTo(point.x, point.y);
    }
    context.closePath();
    context.fillStyle = mob.mobTargetVisible
      ? "rgba(104, 214, 159, 0.075)"
      : "rgba(243, 207, 101, 0.05)";
    context.fill();
    context.setLineDash([6, 5]);
    context.strokeStyle = mob.mobTargetVisible
      ? "rgba(104, 214, 159, 0.72)"
      : "rgba(243, 207, 101, 0.48)";
    context.lineWidth = 1;
    context.stroke();
    context.setLineDash([]);
    context.beginPath();
    for (let index = 0; index <= 40; index += 1) {
      const angle = index / 40 * Math.PI * 2;
      const point = this.options.camera.worldToViewport(
        cone.x + Math.cos(angle) * cone.closeRadius,
        cone.z + Math.sin(angle) * cone.closeRadius,
      );
      if (index === 0) context.moveTo(point.x, point.y);
      else context.lineTo(point.x, point.y);
    }
    context.strokeStyle = "rgba(213, 140, 255, 0.62)";
    context.lineWidth = 1.2;
    context.stroke();
    context.restore();
    if (mob.facingEnd) {
      this.#drawArrow(
        anchor,
        this.options.camera.worldToViewport(mob.facingEnd.x, mob.facingEnd.z),
        COLORS.facing,
        false,
      );
    }
    const threshold = mob.exposure.thresholdTicks;
    if (threshold > 0) {
      const ratio = clamp(mob.exposure.progressTicks / threshold, 0, 1);
      const width = 34;
      context.fillStyle = "rgba(4, 8, 6, 0.82)";
      context.fillRect(anchor.x - width / 2, anchor.y + 14, width, 4);
      context.fillStyle = ratio >= 1 ? COLORS.sightClear : COLORS.noticing;
      context.fillRect(anchor.x - width / 2, anchor.y + 14, width * ratio, 4);
    }
  }

  /** @param {{x:number,z:number}} point @param {string} color @param {string} label */
  #drawWorldMarker(point, color, label) {
    const viewport = this.options.camera.worldToViewport(point.x, point.z);
    const context = this.context;
    context.beginPath();
    context.arc(viewport.x, viewport.y, 6, 0, Math.PI * 2);
    context.fillStyle = "rgba(5, 9, 7, 0.8)";
    context.fill();
    context.strokeStyle = color;
    context.lineWidth = 1.5;
    context.stroke();
    context.fillStyle = color;
    context.font = "bold 9px ui-monospace, SFMono-Regular, Consolas, monospace";
    context.fillText(label, viewport.x - 3, viewport.y + 3);
  }

  /** @param {Array<{x:number,z:number,radius:number,label:string}>} rings */
  #drawEngagementRings(rings) {
    const context = this.context;
    for (let ringIndex = 0; ringIndex < rings.length; ringIndex += 1) {
      const ring = rings[ringIndex];
      context.beginPath();
      const points = 64;
      for (let index = 0; index <= points; index += 1) {
        const angle = index / points * Math.PI * 2;
        const point = this.options.camera.worldToViewport(
          ring.x + Math.cos(angle) * ring.radius,
          ring.z + Math.sin(angle) * ring.radius,
        );
        if (index === 0) context.moveTo(point.x, point.y);
        else context.lineTo(point.x, point.y);
      }
      context.setLineDash(ringIndex === 0 ? [5, 4] : [9, 5]);
      context.strokeStyle = ringIndex === 0
        ? "rgba(239, 189, 95, 0.48)"
        : "rgba(105, 185, 255, 0.45)";
      context.lineWidth = 1;
      context.stroke();
      context.setLineDash([]);
      const label = this.options.camera.worldToViewport(ring.x + ring.radius, ring.z);
      context.fillStyle = ringIndex === 0 ? COLORS.withdraw : COLORS.approach;
      context.font = "9px ui-monospace, SFMono-Regular, Consolas, monospace";
      context.fillText(ring.label, label.x + 5, label.y - 4);
    }
  }

  /**
   * @param {ReturnType<typeof buildAiViewFrame>['mobs'][number]} mob
   * @param {{x:number,y:number}} anchor
   * @param {string} stateColor
   * @param {number} index
   * @param {Array<{x:number,y:number,width:number,height:number}>} boxes
   * @param {number} width
   * @param {number} height
   */
  #drawMobLabel(mob, anchor, stateColor, index, boxes, width, height) {
    const context = this.context;
    const lines = wrapLabelLines(mob.labelLines);
    const boxWidth = 292;
    const lineHeight = 12;
    const boxHeight = lines.length * lineHeight + 12;
    let x = index % 2 === 0 ? anchor.x + 16 : anchor.x - boxWidth - 16;
    let y = anchor.y - boxHeight / 2;
    x = clamp(x, 5, Math.max(5, width - boxWidth - 5));
    y = clamp(y, 5, Math.max(5, height - boxHeight - 5));
    let attempts = 0;
    while (attempts < 12 && boxes.some((box) => (
      x < box.x + box.width + 4
      && x + boxWidth + 4 > box.x
      && y < box.y + box.height + 4
      && y + boxHeight + 4 > box.y
    ))) {
      y += 18;
      if (y + boxHeight > height - 5) y = Math.max(5, y - 54);
      attempts += 1;
    }
    boxes.push({ x, y, width: boxWidth, height: boxHeight });
    const connectorX = x > anchor.x ? x : x + boxWidth;
    this.#drawLine(anchor, { x: connectorX, y: y + 14 }, stateColor, false, 0.75);
    context.fillStyle = "rgba(7, 12, 9, 0.90)";
    context.fillRect(x, y, boxWidth, boxHeight);
    context.strokeStyle = stateColor;
    context.lineWidth = mob.selected ? 2 : 1;
    context.setLineDash(mob.sightVisible === false ? [5, 3] : []);
    context.strokeRect(x + 0.5, y + 0.5, boxWidth - 1, boxHeight - 1);
    context.setLineDash([]);
    context.font = "9px ui-monospace, SFMono-Regular, Consolas, monospace";
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      context.fillStyle = lineIndex === 0 ? stateColor : "#c7d1ca";
      context.fillText(lines[lineIndex], x + 7, y + 12 + lineIndex * lineHeight);
    }
  }

  /** @param {{x:number,y:number}} start @param {{x:number,y:number}} end @param {string} color @param {boolean} dashed @param {number} [alpha] */
  #drawLine(start, end, color, dashed, alpha = 1) {
    const context = this.context;
    context.save();
    context.globalAlpha = alpha;
    context.beginPath();
    context.moveTo(start.x, start.y);
    context.lineTo(end.x, end.y);
    context.strokeStyle = color;
    context.lineWidth = 1.35;
    context.setLineDash(dashed ? [5, 4] : []);
    context.stroke();
    context.restore();
  }

  /** @param {{x:number,y:number}} start @param {{x:number,y:number}} end @param {string} color @param {boolean} dashed */
  #drawArrow(start, end, color, dashed) {
    this.#drawLine(start, end, color, dashed);
    const length = distance(start, end);
    if (length < 5) return;
    const angle = Math.atan2(end.y - start.y, end.x - start.x);
    const context = this.context;
    context.beginPath();
    context.moveTo(end.x, end.y);
    context.lineTo(
      end.x - Math.cos(angle - 0.5) * 7,
      end.y - Math.sin(angle - 0.5) * 7,
    );
    context.lineTo(
      end.x - Math.cos(angle + 0.5) * 7,
      end.y - Math.sin(angle + 0.5) * 7,
    );
    context.closePath();
    context.fillStyle = color;
    context.fill();
  }

  snapshot() {
    return {
      open: !this.panel.hidden,
      mode: this.mode,
      selectedKey: this.selectedKey,
      availableMobCount: this.lastFrame?.availableMobs.length ?? 0,
      drawnMobCount: this.lastFrame?.mobs.length ?? 0,
      presentationOnly: true,
    };
  }
}
