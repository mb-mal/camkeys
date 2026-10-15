// Screen-space control: never use coordinates projected onto the keyboard plane.
export class StageControl {
  constructor(duration = 2000) {
    this.duration = duration;
    this.reset();
  }
  reset() {
    this.id = null;
    this.since = null;
    this.lastTime = -Infinity;
    this.latched = false;
  }
  update({ tips, observed = tips, owner, bounds, time }) {
    if (time <= this.lastTime)
      return { busy: !!this.id, progress: 0, fired: false };
    const contains = (p) =>
      Math.hypot(
        ((p.cameraX ?? p.x) - bounds.x) / bounds.rx,
        ((p.cameraY ?? p.y) - bounds.y) / bounds.ry,
      ) <= 1;
    let seen = observed.find((p) => p.id === this.id);
    if (this.id && !seen && time - this.lastTime > 400) {
      const returning = observed.filter((p) => p.id.endsWith("-1"));
      if (returning.length === 1 && this.latched) {
        // The tracker can assign a new hand ID after a dropout. Carry the
        // fired latch across that recovery, and require a visible exit.
        this.id = returning[0].id;
        seen = returning[0];
      } else if (!this.latched) this.reset();
    }
    if (seen && !contains(seen)) this.reset();
    const eligible = tips.filter(
      (p) => p.pointing && p.id.endsWith("-1") && contains(p),
    );
    const point = this.id
      ? eligible.find((p) => p.id === this.id)
      : owner
        ? eligible.find((p) => p.id.split("-")[0] === owner.split("-")[0])
        : eligible.length === 1
          ? eligible[0]
          : null;
    if (!point) {
      this.since = null;
      const busy =
        !!this.id && (seen ? contains(seen) : time - this.lastTime <= 400);
      // A tracking dropout must not rearm a button that has already fired.
      return { busy, progress: 0, fired: false };
    }
    if (time - this.lastTime > 400) this.since = null;
    this.id = point.id;
    this.lastTime = time;
    this.since ??= time;
    const progress = Math.min(1, (time - this.since) / this.duration);
    const fired = !this.latched && progress >= 1;
    if (fired) this.latched = true;
    return { busy: true, progress: this.latched ? 1 : progress, fired };
  }
}
