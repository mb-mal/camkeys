import { telemetry } from "./telemetry.js";
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
// Elapsed-time action with spatial release. A held point fires once, including
// across target changes; missing frames never bridge a countdown.
export class Dwell {
  constructor(duration, { radius = 0.015, release = 0.03, maxGap = 400 } = {}) {
    Object.assign(this, { duration, radius, release, maxGap });
    this.reset();
  }
  reset({ keepLatch = false } = {}) {
    if (this.pending)
      telemetry.record("dwell-reset", {
        duration: this.duration,
        elapsed: this.elapsed,
        pending: this.pending,
        keepLatch,
      });
    if (!keepLatch) this.latched = null;
    this.pending = null;
    this.elapsed = 0;
    this.state = "outside";
    this.lastTime = -Infinity;
  }
  mark(point, id, time, key) {
    this.latched = { point: { ...point }, id, key };
    this.pending = null;
    this.elapsed = this.duration;
    this.state = "fixed";
    this.lastTime = time;
  }
  update({ point, id, key, time, eligible = true }) {
    if (!telemetry.active)
      return this.advance({ point, id, key, time, eligible });
    const before = {
      state: this.state,
      elapsed: this.elapsed,
      pending: this.pending && { ...this.pending },
      lastTime: this.lastTime,
    };
    const reason =
      time <= this.lastTime
        ? "old-frame"
        : time - this.lastTime > this.maxGap && this.lastTime !== -Infinity
          ? "frame-gap"
          : !point
            ? "no-point"
            : !eligible
              ? "ineligible-or-outside-target"
              : this.pending && this.pending.id !== id
                ? "owner-changed"
                : this.pending && this.pending.key !== key
                  ? "key-changed"
                  : this.pending &&
                      distance(this.pending.point, point) > this.radius
                    ? "spatial-drift"
                    : "continuous";
    const event = this.advance({ point, id, key, time, eligible });
    telemetry.record("dwell", {
      duration: this.duration,
      time,
      point,
      id,
      key,
      eligible,
      reason,
      before,
      state: this.state,
      elapsed: this.elapsed,
      fired: !!event,
    });
    return event;
  }
  advance({ point, id, key, time, eligible = true }) {
    if (!Number.isFinite(time) || time <= this.lastTime) return null;
    const gap =
      time - this.lastTime > this.maxGap && this.lastTime !== -Infinity;
    this.lastTime = time;
    if (
      this.latched &&
      point &&
      distance(point, this.latched.point) > this.release
    )
      this.latched = null;
    if (!eligible || !point || gap) {
      this.pending = null;
      this.elapsed = 0;
      this.state = gap ? "gap" : this.latched ? "leave" : "outside";
      return null;
    }
    if (this.latched) {
      this.pending = null;
      this.elapsed = this.duration;
      this.state = "fixed";
      return null;
    }
    const p = this.pending;
    if (
      !p ||
      p.id !== id ||
      p.key !== key ||
      distance(p.point, point) > this.radius
    ) {
      this.pending = {
        id,
        key,
        point: { ...point },
        since: time,
        x: point.x,
        y: point.y,
        count: 1,
      };
      this.elapsed = 0;
      this.state = "holding";
      return null;
    }
    p.x += point.x;
    p.y += point.y;
    p.count++;
    this.elapsed = time - p.since;
    this.state = "holding";
    if (this.elapsed < this.duration) return null;
    const event = { id, key, point: { x: p.x / p.count, y: p.y / p.count } };
    this.mark(event.point, id, time, key);
    return event;
  }
}
