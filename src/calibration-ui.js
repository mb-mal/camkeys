import { CalibrationWizard, CalibrationPressDetector } from "./calibration.js";
import { project } from "./core.js";
import { Dwell } from "./dwell.js";
import { telemetry } from "./telemetry.js";
const $ = (id) => document.getElementById(id);
export class CalibrationController {
  constructor({ state, resetInput, apply, status, draw }) {
    Object.assign(this, { state, resetInput, apply, status, draw });
    this.wizard = null;
    this.detector = new CalibrationPressDetector();
    this.mode = "pointer";
    this.feedback = "";
    this.dwell = new Dwell(2000);
    const confirm = () => {
      if (this.mode !== "camera" || !this.detector.candidate) return;
      if (performance.now() - this.latestFrame > 400) {
        this.update(
          [],
          performance.now(),
          "Пауза: позиция пальца устарела. Дождитесь свежих кадров.",
        );
        return;
      }
      this.capture(
        this.detector.candidate.point,
        performance.now(),
        "Подтверждена стабильная позиция пальца",
      );
    };
    $("wizard-confirm").onclick = confirm;
    $("camera-confirm").onclick = confirm;
    const retry = () => {
      this.wizard?.back();
      this.detector.reset({ preserveSelection: true });
      this.feedback = "";
      this.dwell.reset();
      this.latestFrame = -Infinity;
      this.render();
    };
    $("wizard-back").onclick = retry;
    $("camera-retry").onclick = retry;
    $("wizard-restart").onclick = () => this.start();
    $("wizard-cancel").onclick = () =>
      this.cancel("Калибровка отменена. Прежняя геометрия сохранена.");
  }
  start() {
    telemetry.record("calibration-start", {
      lang: this.state.lang,
      source: this.state.source,
    });
    this.mode = this.state.source === "camera" ? "camera" : "pointer";
    this.wizard = new CalibrationWizard(this.state.lang, {
      frameWidth: $("video").videoWidth || $("overlay").width,
      frameHeight: $("video").videoHeight || $("overlay").height,
    });
    $("wizard-auto-press").checked = false;
    this.detector.reset();
    this.dwell.reset();
    this.latestFrame = -Infinity;
    clearInterval(this.freshnessTimer);
    if (this.mode === "camera")
      this.freshnessTimer = setInterval(() => {
        if (
          this.state.calibrating &&
          this.detector.candidate &&
          performance.now() - this.latestFrame > 400
        )
          this.update(
            [],
            performance.now(),
            "Пауза: позиция пальца устарела. Дождитесь свежих кадров.",
          );
      }, 100);
    this.resetInput();
    this.state.calibrating = true;
    this.feedback = "";
    $("wizard").hidden = false;
    $("calibrate").textContent = "Отменить калибровку";
    this.render();
    this.status(
      this.mode === "camera"
        ? "Удержите указательный над подсвеченной буквой 2 секунды: мастер перейдёт дальше автоматически. Кнопка — быстрая альтернатива."
        : "Проверка мастера мышью: нажимайте подсвеченные буквы. Геометрия камеры не будет перезаписана.",
    );
  }
  cancel(message = null) {
    this.wizard?.cancel();
    this.detector.reset();
    this.dwell.reset();
    clearInterval(this.freshnessTimer);
    this.state.calibrating = false;
    this.state.calibrationTarget = null;
    this.state.calibrationPoint = null;
    this.state.excludedHands = [];
    $("wizard").hidden = true;
    $("camera-calibration").hidden = true;
    $("calibrate").textContent = "Калибровка";
    if (message) this.status(message);
    this.draw();
  }
  capture(point, time, method = "Нажатие зарегистрировано") {
    if (!this.wizard?.active) return;
    const letter = this.wizard.target.letter.toUpperCase();
    try {
      const accepted = this.wizard.capture(point, time);
      telemetry.record("calibration-capture", {
        letter,
        point,
        time,
        method,
        accepted,
        phase: this.wizard.phase,
        error: this.wizard.error,
        step: this.wizard.step,
      });
      if (accepted || this.wizard.phase === "failed")
        this.dwell.mark(
          point,
          this.detector.candidate?.id || this.detector.selectedId,
          time,
          letter,
        );
      this.feedback = accepted ? `${method}: ${letter}` : this.wizard.error;
      this.detector.reset({ preserveSelection: true });
      this.state.calibrationPoint = null;
      if (this.wizard.phase === "done") {
        clearInterval(this.freshnessTimer);
        const result = this.wizard.result;
        this.state.calibrating = false;
        this.state.calibrationTarget = null;
        this.resetInput();
        const saved = this.mode === "camera" ? this.apply(result) : true;
        $("calibrate").textContent = "Калибровка";
        this.feedback = `Контроль пройден, максимальная ошибка ${(result.maxError * 100).toFixed(1)}%. ${this.mode === "camera" ? (saved ? "Новая геометрия камеры сохранена." : "Геометрия применена только в текущей вкладке: сохранение не удалось.") : "Режим мыши: калибровка камеры сохранена прежней."}`;
        this.status(this.feedback);
      }
    } catch (e) {
      this.feedback = e.message;
    }
    this.render();
  }
  pointer(point, time) {
    if (this.mode === "camera") {
      this.status(
        "Мастер камеры ждёт нажатия пальцем; мышь не заменяет его. При необходимости подтвердите стабильную позицию пальца отдельной кнопкой.",
      );
      return;
    }
    this.capture(point, time);
  }
  update(tips, time, reason) {
    telemetry.record("calibration-frame", {
      time,
      age: performance.now() - time,
      tips,
      target: this.wizard?.target,
      step: this.wizard?.step,
      phase: this.wizard?.phase,
      selectedId: this.detector.selectedId,
      reason,
    });
    if (!this.state.calibrating || !this.wizard) return;
    if (time <= this.latestFrame) return;
    this.latestFrame = time;
    if (performance.now() - time > 400) {
      tips = [];
      reason = "Пауза: кадр трекера устарел. Дождитесь свежего положения руки.";
    }
    if (!tips.length) {
      this.wizard.pause(
        reason ||
          "Пауза: рука не видна или дальше рабочей границы. Настройте 1× ниже; этот шаг не потерян.",
      );
      this.detector.reset();
      this.dwell.update({ time, eligible: false });
      this.state.calibrationPoint = null;
      this.render();
      return;
    }
    this.wizard.resume();
    const event = this.detector.update(
      tips,
      time,
      Number($("tap-threshold").value),
      project(this.state.forward, this.wizard.target.x, this.wizard.target.y),
    );
    this.state.calibrationPoint = this.detector.candidate?.point || null;
    const p = tips.find((p) => p.id === this.detector.selectedId);
    const uv = p && project(this.state.displayInverse, p.x, p.y),
      target = this.wizard.target;
    const overTarget =
      !!uv &&
      Math.abs(uv.x - target.x) <= 0.037 &&
      Math.abs(uv.y - target.y) <= 0.125;
    const held = this.dwell.update({
      point: p,
      id: p?.id,
      key: target.letter,
      time,
      eligible:
        !!p?.pointing &&
        overTarget &&
        this.wizard.active &&
        this.wizard.phase !== "paused",
    });
    telemetry.record("calibration-gate", {
      time,
      target,
      selectedId: this.detector.selectedId,
      point: p,
      uv,
      overTarget,
      pointing: p?.pointing,
      readiness: this.detector.readiness,
      dwellMs: this.dwell.elapsed,
      dwellState: this.dwell.state,
    });
    if (held) {
      // Dwell already validates identity, target, freshness and spatial
      // stability over two seconds. A second 250 ms sample window can
      // never become ready on slower cameras and must not veto this action.
      this.capture(held.point, time, "Удержание 2 с: позиция записана");
      return;
    }
    if (event.press && $("wizard-auto-press").checked && this.wizard.active)
      this.capture(event.press, time);
    else {
      if (event.error) this.feedback = event.error;
      this.render();
    }
  }
  render() {
    const w = this.wizard;
    if (!w) return;
    this.state.calibrationTarget = w.phase === "done" ? null : w.target;
    $("wizard-mode").textContent =
      this.mode === "camera"
        ? "Камера · удержание 2 с"
        : "Мышь · проверка процесса";
    $("wizard-letter").textContent =
      w.phase === "done" ? "✓" : w.target.letter.toUpperCase();
    $("wizard-step").textContent =
      w.phase === "done"
        ? "Проверка завершена"
        : `Шаг ${w.phase === "failed" ? w.retryIndex + 1 : Math.min(w.step + 1, w.targets.length)} / ${w.targets.length} · ${w.phase === "failed" ? "нужно повторить" : w.step < 4 ? "опорная буква" : w.step < 7 ? "контрольная буква" : "повтор для проверки"}`;
    $("wizard-sequence").textContent = w.targets
      .map((t, i) => `${i < w.step ? "✓ " : ""}${t.letter.toUpperCase()}`)
      .join(" → ");
    $("wizard-instruction").textContent =
      w.phase === "paused"
        ? w.error
        : w.phase === "failed"
          ? w.error
          : w.phase === "done"
            ? this.feedback
            : this.mode === "camera"
              ? `Удержите вытянутый указательный над подсвеченной «${w.target.letter.toUpperCase()}» 2 секунды. Позиция запишется автоматически. Затем переместите палец к новой цели. Кнопка позволяет подтвердить раньше.`
              : `Нажмите мышью подсвеченную «${w.target.letter.toUpperCase()}». Это отдельная проверка мастера без камеры.`;
    $("wizard-feedback").textContent =
      w.phase === "failed" ? "Прежняя геометрия сохранена." : this.feedback;
    $("wizard").classList.toggle("failed", w.phase === "failed");
    $("wizard-confirm").hidden = this.mode !== "camera";
    $("wizard-readiness").hidden =
      this.mode !== "camera" || ["done", "failed"].includes(w.phase);
    const ready =
      !!this.detector.candidate &&
      w.active &&
      w.phase !== "paused" &&
      performance.now() - this.latestFrame <= 400 &&
      performance.now() - w.lastTime >= 450;
    const letter = w.target.letter.toUpperCase(),
      next = w.targets[w.step + 1]?.letter.toUpperCase();
    const label = `Подтвердить ${letter} → ${next || "проверить"}`;
    for (const id of ["wizard-confirm", "camera-confirm"]) {
      if ($(id).textContent !== label) $(id).textContent = label;
      $(id).disabled = !ready;
    }
    let readiness =
      !w.active || w.phase === "paused"
        ? w.error || this.feedback
        : ready
          ? `Позиция стабильна. Подтвердите ${letter}, чтобы перейти дальше.`
          : this.detector.readiness === "ready"
            ? "Позиция принята. Подведите палец к следующей букве."
            : this.detector.readiness === "folded"
              ? "Вытяните указательный палец. Согнутый кончик не принимается."
              : this.detector.readiness === "moving"
                ? "Палец виден. Остановите его на 0.2 с для подтверждения."
                : "Покажите указательный палец камере.";
    if (w.active && w.phase !== "paused" && this.dwell.state === "holding") {
      readiness = `Держите ${letter}: ${(this.dwell.elapsed / 1000).toFixed(1)} / 2 с. Дальше — ${next || "контроль"}.`;
    } else if (ready) {
      readiness =
        this.dwell.state === "holding"
          ? `Держите ${letter}: ${(this.dwell.elapsed / 1000).toFixed(1)} / 2 с. Дальше — ${next || "контроль"}.`
          : ["fixed", "leave"].includes(this.dwell.state)
            ? `Предыдущая позиция записана. Переместите палец к ${letter}.`
            : `Позиция стабильна. Подведите палец над подсвеченной ${letter} для удержания 2 с, либо подтвердите кнопкой.`;
    }
    $("camera-dwell").value = Math.min(2000, this.dwell.elapsed);
    $("camera-dwell").hidden = !w.active || this.mode !== "camera";
    for (const id of ["wizard-readiness", "camera-readiness"])
      if ($(id).textContent !== readiness) $(id).textContent = readiness;
    $("camera-target").textContent =
      `${letter} · шаг ${w.phase === "failed" ? w.retryIndex + 1 : Math.min(w.step + 1, w.targets.length)} / ${w.targets.length}`;
    $("camera-confirm").hidden = w.phase === "failed";
    $("camera-retry").hidden = w.phase !== "failed";
    const retryLabel =
      w.phase === "failed" && w.retryIndex === 0
        ? "Повторить опорные буквы"
        : `Повторить ${letter} и продолжить`;
    $("camera-retry").textContent = retryLabel;
    $("wizard-back").textContent =
      w.phase === "failed" ? retryLabel : "Повторить шаг";
    $("camera-calibration").hidden =
      this.mode !== "camera" || w.phase === "done" || !this.state.calibrating;
    $("camera-calibration").classList.toggle("ready", ready);
    $("wizard-back").disabled = w.step === 0 || w.phase === "done";
    this.draw();
  }
}
