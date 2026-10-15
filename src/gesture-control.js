// Display-space palm movement: positive x is right in the mirrored camera.
export class RightFlick {
  constructor(direction = 1) {
    this.direction = direction;
    this.cooldownUntil = 0;
    this.reset();
  }
  reset() {
    this.previous = null;
    this.pending = null;
  }
  update(palm, time, armed) {
    if (palm && this.direction === -1) palm = { ...palm, x: -palm.x };
    const previous = this.previous;
    if (
      !palm ||
      !Number.isFinite(time) ||
      ![palm.x, palm.y].every(Number.isFinite)
    ) {
      this.reset();
      return { type: "lost", dx: 0, speed: 0 };
    }
    this.previous = { ...palm, t: time };
    if (
      !previous ||
      previous.id !== palm.id ||
      time - previous.t > 250 ||
      time <= previous.t
    ) {
      this.pending = null;
      return {
        type: time < this.cooldownUntil ? "cooldown" : "idle",
        dx: 0,
        speed: 0,
      };
    }
    const step = palm.x - previous.x;
    const speed = (step * 1000) / (time - previous.t);
    if (time < this.cooldownUntil) {
      this.pending = null;
      return {
        type: "cooldown",
        dx: step,
        speed,
      };
    }
    if (
      !this.pending &&
      step > 0.004 &&
      speed > 0.35 &&
      Math.abs(palm.y - previous.y) < step * 0.7
    )
      this.pending = { ...previous, armed };
    if (!this.pending) return { type: "idle", dx: step, speed };
    const dx = palm.x - this.pending.x;
    const dy = palm.y - this.pending.y;
    const duration = time - this.pending.t;
    const average = (dx * 1000) / duration;
    if (duration > 650 || step < -0.008 || Math.abs(dy) > 0.12) {
      this.pending = null;
      return { type: "rejected", dx, speed: average };
    }
    if (
      dx >= 0.12 &&
      duration >= 60 &&
      average >= 0.35 &&
      dx >= Math.abs(dy) * 1.5
    ) {
      const type = this.pending.armed ? "commit" : "empty";
      this.pending = null;
      this.cooldownUntil = time + 800;
      return { type, dx, speed: average };
    }
    return { type: "pending", dx, speed: average };
  }
}
export class LeftFlick extends RightFlick {
  constructor() {
    super(-1);
  }
}
