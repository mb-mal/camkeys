import { keys, homography, project, Segmenter } from "./core.js";
import { TipActivity } from "./tip-activity.js";
const unit = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
];
export const calibrationLetters = {
  ru: ["й", "ъ", "ю", "я", "п", "е", "м", "й", "ю", "п"],
  en: ["q", "p", "m", "z", "g", "r", "v", "q", "m", "g"],
};
const area = (quad) =>
  quad.reduce((s, p, i) => {
    const q = quad[(i + 1) % quad.length];
    return s + p[0] * q[1] - q[0] * p[1];
  }, 0) / 2;
export class CalibrationWizard {
  constructor(lang, { frameWidth = 960, frameHeight = 540 } = {}) {
    if (!calibrationLetters[lang]) throw new Error("Неизвестный язык мастера");
    this.lang = lang;
    this.targets = calibrationLetters[lang].map((letter) =>
      keys(lang).find((k) => k.letter === letter),
    );
    this.samples = [];
    this.phase = "collect";
    this.error = "";
    this.result = null;
    this.candidate = null;
    this.lastTime = -Infinity;
    this.frameWidth = frameWidth;
    this.frameHeight = frameHeight;
    this.retryIndex = 0;
  }
  get active() {
    return ["collect", "check", "paused"].includes(this.phase);
  }
  get step() {
    return this.samples.length;
  }
  get target() {
    if (this.phase === "failed") return this.targets[this.retryIndex];
    return this.targets[
      Math.max(
        0,
        Math.min(
          this.step - (this.phase === "failed" ? 1 : 0),
          this.targets.length - 1,
        ),
      )
    ];
  }
  pause(reason) {
    if (!this.active) return;
    if (this.phase !== "paused") this.resumePhase = this.phase;
    this.phase = "paused";
    this.error = reason;
  }
  resume() {
    if (this.phase === "paused") {
      this.phase = this.resumePhase || "collect";
      this.error = "";
    }
  }
  cancel() {
    this.phase = "cancelled";
    this.result = null;
  }
  back() {
    if (this.phase === "failed") {
      this.samples.splice(this.retryIndex);
    } else if (this.samples.length) this.samples.pop();
    this.result = null;
    this.error = "";
    this.lastTime = -Infinity;
    this.phase = this.step < 4 ? "collect" : "check";
    if (this.step < 4) this.candidate = null;
  }
  capture(point, time) {
    if (this.phase === "paused")
      throw new Error(
        "Мастер на паузе: дождитесь стабильной руки в рабочей зоне",
      );
    if (!this.active) return false;
    if (time - this.lastTime < 450) {
      this.error = "Подождите перед следующим нажатием";
      return false;
    }
    if (
      ![point.x, point.y, time].every(Number.isFinite) ||
      point.x < 0 ||
      point.x > 1 ||
      point.y < 0 ||
      point.y > 1
    )
      throw new Error("Позиция нажатия вне кадра");
    this.samples.push({ x: point.x, y: point.y });
    this.lastTime = time;
    this.error = "";
    try {
      if (this.step === 4) {
        const from = this.targets.slice(0, 4).map((p) => [p.x, p.y]),
          to = this.samples.map((p) => [p.x, p.y]);
        this.retryIndex = 0;
        for (let i = 0; i < to.length; i++)
          for (let j = 0; j < i; j++)
            if (
              Math.hypot(
                (to[i][0] - to[j][0]) * this.frameWidth,
                (to[i][1] - to[j][1]) * this.frameHeight,
              ) < 8
            )
              throw new Error(
                `${this.targets[j].letter.toUpperCase()} и ${this.targets[i].letter.toUpperCase()} записаны почти в одной позиции. Повторите четыре опорные буквы.`,
              );
        if (Math.abs(area(to)) < 64 / (this.frameWidth * this.frameHeight))
          throw new Error(
            "Опорные позиции лежат почти на одной линии. Повторите четыре опорные буквы.",
          );
        let forward;
        try {
          forward = homography(from, to);
        } catch {
          throw new Error(
            "Порядок опорных позиций нарушен. Повторите четыре буквы в указанном порядке.",
          );
        }
        const corners = unit.map(([x, y]) => {
          const p = project(forward, x, y);
          return [p.x, p.y];
        });
        if (
          corners.flat().some((v) => v < -1e-6 || v > 1 + 1e-6) ||
          Math.abs(area(corners)) < 128 / (this.frameWidth * this.frameHeight)
        )
          throw new Error(
            "По опорным позициям клавиатура выходит из кадра или слишком сжата. Повторите четыре опорные буквы.",
          );
        const inverse = homography(corners, unit);
        this.candidate = { forward, inverse, corners };
        this.phase = "check";
      }
      if (this.step === this.targets.length) {
        const errors = this.samples.slice(4).map((p, i) => {
          const q = project(this.candidate.inverse, p.x, p.y),
            target = this.targets[i + 4];
          return Math.hypot(q.x - target.x, q.y - target.y);
        });
        const maxError = Math.max(...errors);
        if (maxError > 0.045) {
          this.retryIndex = errors.indexOf(maxError) + 4;
          throw new Error(
            `Повторите ${this.targets[this.retryIndex].letter.toUpperCase()} на шаге ${this.retryIndex + 1}: отклонение ${(maxError * 100).toFixed(1)}%. Опорные позиции сохранены.`,
          );
        }
        this.result = { ...this.candidate, maxError };
        this.phase = "done";
      }
      return true;
    } catch (e) {
      this.phase = "failed";
      this.error = e.message;
      this.result = null;
      return false;
    }
  }
}
export class CalibrationPressDetector {
  constructor() {
    this.reset();
  }
  reset({ preserveSelection = false } = {}) {
    const previousActivity = this.activity,
      previousId = this.selectedId;
    this.segmenter = new Segmenter();
    this.history = new Map();
    this.candidate = null;
    this.readiness = "lost";
    this.selectedId = preserveSelection ? previousId : null;
    this.activity =
      preserveSelection && previousActivity
        ? previousActivity
        : new TipActivity();
  }
  stable(id, time) {
    const rows = (this.history.get(id) || []).filter((p) => time - p.t <= 250);
    if (rows.length < 3 || rows.at(-1).t - rows[0].t < 180) return null;
    const point = {
      x: rows.reduce((s, p) => s + p.x, 0) / rows.length,
      y: rows.reduce((s, p) => s + p.y, 0) / rows.length,
    };
    return rows.every((p) => Math.hypot(p.x - point.x, p.y - point.y) <= 0.015)
      ? point
      : null;
  }
  update(tips, time, threshold, displayedTarget = null) {
    const visible = tips.filter(
      (p) =>
        [p.x, p.y, p.z, time].every(Number.isFinite) &&
        p.x >= 0 &&
        p.x <= 1 &&
        p.y >= 0 &&
        p.y <= 1,
    );
    if (!visible.length) {
      this.reset();
      return { press: null };
    }
    // Only an extended index can confirm a calibration position. Curled tips
    // and other digits must not fire the alternative flexion detector.
    const indices = visible.filter(
      (p) => p.id.endsWith("-1") && p.pointing === true,
    );
    if (!indices.length) {
      this.reset();
      this.readiness = "folded";
      return { press: null };
    }
    const selection = this.activity.update(
      indices,
      time,
      new Set(indices.map((p) => p.id)),
    );
    const leader = indices.find((p) => p.id === selection.id),
      held = indices.find((p) => p.id === this.selectedId);
    const initial = displayedTarget
      ? indices
          .slice()
          .sort(
            (a, b) =>
              Math.hypot(a.x - displayedTarget.x, a.y - displayedTarget.y) -
              Math.hypot(b.x - displayedTarget.x, b.y - displayedTarget.y),
          )[0]
      : leader;
    // Display proximity breaks a stationary tie; it never gates registration
    // or substitutes a target coordinate for an observed point.
    const index =
      selection.planarScore >= 0.018 ? leader : held || initial || indices[0];
    if (this.selectedId !== index.id) {
      this.history.clear();
      this.segmenter.reset();
      this.candidate = null;
      this.selectedId = index.id;
    }
    for (const p of [index]) {
      const rows = this.history.get(p.id) || [];
      if (rows.length && time - rows.at(-1).t > 400) rows.length = 0;
      rows.push({ ...p, t: time });
      this.history.set(p.id, rows.filter((q) => time - q.t <= 500).slice(-128));
    }
    for (const id of this.history.keys())
      if (!visible.some((p) => p.id === id)) this.history.delete(id);
    const candidate = this.stable(index.id, time);
    this.candidate = candidate ? { id: index.id, point: candidate } : null;
    this.readiness = candidate ? "ready" : "moving";
    const event = this.segmenter.update([index], time, threshold);
    const taps = event.taps.map((p) => this.stable(p.id, time)).filter(Boolean);
    return {
      press: taps.length === 1 ? taps[0] : null,
      error:
        taps.length > 1
          ? "Нажмите одной рукой, одним пальцем"
          : event.taps.length && !taps.length
            ? "Удержите палец стабильнее и повторите нажатие"
            : "",
    };
  }
}
