import { Dwell } from "./dwell.js";
import { project } from "./core.js";

// A separate round key in the unused right end of the bottom keyboard row.
export const layoutKey = { x: 0.94, y: 5 / 6, rx: 0.045, ry: 0.12 };
export function layoutKeyOutline(forward) {
  return Array.from({ length: 49 }, (_, i) => {
    const angle = (i / 48) * Math.PI * 2;
    return project(
      forward,
      layoutKey.x + layoutKey.rx * Math.cos(angle),
      layoutKey.y + layoutKey.ry * Math.sin(angle),
    );
  });
}

export class StageControl {
  constructor(duration = 2000) {
    this.duration = duration;
    this.dwell = new Dwell(duration);
    this.reset();
  }
  reset() {
    this.dwell.reset();
    this.id = null;
    this.lastTime = -Infinity;
    this.latched = false;
  }
  update({ tips, observed = tips, owner, bounds, time }) {
    if (time <= this.lastTime)
      return { busy: !!this.id, progress: 0, fired: false };
    const contains = (p) =>
      Math.hypot((p.x - bounds.x) / bounds.rx, (p.y - bounds.y) / bounds.ry) <=
      1;
    let seen = observed.find((p) => p.id === this.id);
    if (this.id && !seen && time - this.lastTime > 400) {
      const digit = this.id.split("-").at(-1);
      const returning = observed.filter((p) => p.id.endsWith(`-${digit}`));
      if (returning.length === 1 && this.latched) {
        // The tracker can assign a new hand ID after a dropout. Carry the
        // fired latch across that recovery, and require a visible exit.
        this.id = returning[0].id;
        seen = returning[0];
      } else if (!this.latched) this.reset();
    }
    if (seen && !contains(seen)) this.reset();
    const eligible = tips.filter((p) => p.pointing && contains(p));
    const point = this.id
      ? eligible.find((p) => p.id === this.id)
      : owner
        ? eligible.find((p) => p.id === owner) ||
          eligible.find(
            (p) =>
              p.id.endsWith("-1") && p.id.split("-")[0] === owner.split("-")[0],
          )
        : eligible.length === 1
          ? eligible[0]
          : null;
    if (!point) {
      this.dwell.update({ point: null, time, eligible: false });
      const busy =
        !!this.id && (seen ? contains(seen) : time - this.lastTime <= 400);
      // A tracking dropout must not rearm a button that has already fired.
      return { busy, progress: 0, fired: false };
    }
    this.id = point.id;
    this.lastTime = time;
    if (this.latched) return { busy: true, progress: 1, fired: false };
    const event = this.dwell.update({
      point,
      id: point.id,
      key: "layout",
      time,
      eligible: true,
    });
    const progress = this.dwell.elapsed / this.duration;
    if (event) this.latched = true;
    return { busy: true, progress, fired: !!event };
  }
}
