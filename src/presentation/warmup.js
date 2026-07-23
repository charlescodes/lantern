// @ts-check

export class PresentationWarmupStatus {
  /**
   * @param {boolean} required
   * @param {()=>number} [now]
   * @param {number} [startedAt]
   */
  constructor(required, now = () => performance.now(), startedAt = now()) {
    this.required = required;
    this.now = now;
    this.startedAt = required ? startedAt : 0;
    this.state = required ? "warming" : "not-required";
    this.durationMs = 0;
  }

  complete() {
    if (!this.required || this.state !== "warming") return;
    this.durationMs = Math.max(0, this.now() - this.startedAt);
    this.state = "ready";
  }

  fail() {
    if (!this.required || this.state !== "warming") return;
    this.durationMs = Math.max(0, this.now() - this.startedAt);
    this.state = "failed";
  }

  snapshot() {
    const durationMs = this.state === "warming"
      ? Math.max(0, this.now() - this.startedAt)
      : this.durationMs;
    return { state: this.state, durationMs };
  }
}
