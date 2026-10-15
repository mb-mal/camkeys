import { TipActivity } from "./tip-activity.js";
import { RightFlick, LeftFlick } from "./gesture-control.js";
import { nearestKey } from "./core.js";
import { Dwell } from "./dwell.js";
import { trimApproach } from "./word-boundaries.js";
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const inside = (p) => p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1;
export class InputSession {
  constructor({
    recognize = () => {},
    commit = () => {},
    retract = () => {},
  } = {}) {
    this.recognize = recognize;
    this.commitText = commit;
    this.retractText = retract;
    this.activity = new TipActivity();
    this.flick = new RightFlick();
    this.leftFlick = new LeftFlick();
    this.serial = 0;
    this.reset();
  }
  reset(reason = "") {
    this.serial++;
    this.phase = "idle";
    this.reason = reason;
    this.owner = null;
    this.path = [];
    this.samples = [];
    this.lastConfidentTime = -Infinity;
    this.detached = false;
    this.reentry = null;
    this.commandHand = null;
    this.lastCommandPalm = null;
    this.otherCommandHands = new Set();
    this.confirmRequested = false;
    this.recognized = null;
    this.recentCommit = false;
    this.frames = [];
    this.results = [];
    this.version = 0;
    this.applied = -1;
    this.anchor = null;
    this.smooth = null;
    this.lastPoint = null;
    this.lastTime = -Infinity;
    this.lastMotion = 0;
    this.lastDecode = -Infinity;
    this.pause = null;
    this.letters = "";
    this.entryMode = null;
    this.hold = new Dwell(500);
    this.tap = null;
    this.tapCount = 0;
    this.blockedUntil = -Infinity;
    this.command = { type: "idle", dx: 0, speed: 0 };
    this.flick.reset();
    this.leftFlick.reset();
  }
  cancel(reason) {
    this.reset(reason);
    this.phase = "paused";
  }
  request(final = false) {
    this.lastDecode = this.lastTime;
    this.recognize({
      session: this.serial,
      version: this.version,
      path: (final && this.samples.length > 3
        ? trimApproach(this.samples, this.layout)
        : this.path
      ).map((p) => ({ ...p })),
      alternatePath: final ? this.path.map((p) => ({ ...p })) : undefined,
      letters: this.letters,
      layout: this.layout,
      final,
      complete: final && (this.detached || this.confirmRequested),
      confirmRequested: this.confirmRequested,
    });
  }
  finish(reason) {
    if (this.entryMode !== "swipe" || this.samples.length < 4) {
      this.cancel(reason);
      return;
    }
    this.phase = "ready";
    this.pause = null;
    this.owner = null;
    this.detached = true;
    this.reason =
      reason +
      " Траектория сохранена: выберите слово или начните новое движение.";
    this.version++;
    this.request(true);
  }
  accept(token, results) {
    if (
      token.session !== this.serial ||
      token.layout !== this.layout ||
      token.version < this.applied ||
      (this.phase === "ready" && token.version < this.version)
    )
      return false;
    this.results = results;
    this.applied = token.version;
    return true;
  }
  commitRecognized(token, automatic = false, time = this.lastTime) {
    if (
      !token.final ||
      token.session !== this.serial ||
      token.version !== this.version ||
      this.phase !== "ready"
    )
      return false;
    const best = this.results[0];
    if (
      !token.confirmRequested &&
      best?.word?.length > 1 &&
      new Set(
        this.path
          .map((p) => nearestKey(p, this.layout)?.letter)
          .filter(Boolean),
      ).size < 2 &&
      this.entryMode === "swipe"
    ) {
      this.reason =
        "Движение осталось возле одной клавиши. Выберите слово вручную или начните новый набор.";
      return false;
    }
    if (
      !best ||
      !Number.isFinite(best.error) ||
      best.error > 0.12 ||
      !best.word
    ) {
      this.confirmRequested = false;
      this.reason =
        "Жест завершён, но совпадение слабое. Выберите вариант вручную.";
      return false;
    }
    if (token.confirmRequested) return this.confirm(best.word, token.session);
    const previous = this.recognized;
    this.recognized = {
      token,
      word: best.word,
      motion: this.lastMotion,
      since:
        previous &&
        previous.token.session === token.session &&
        previous.word === best.word &&
        previous.motion === this.lastMotion
          ? previous.since
          : time,
    };
    return this.tick(time, automatic);
  }
  tick(time, automatic = false) {
    const r = this.recognized;
    if (
      !automatic ||
      !r ||
      this.phase !== "ready" ||
      r.token.session !== this.serial ||
      r.token.version !== this.version ||
      this.lastMotion !== r.motion ||
      time - r.since < 1500 ||
      ["pending", "commit"].includes(this.command.type)
    )
      return false;
    return this.confirm(r.word, r.token.session);
  }
  cancelByGesture(time, observedPoint = this.lastPoint) {
    const undoRecent = this.recentCommit && !this.path.length && !this.letters;
    this.retractText({ undoRecent });
    const point = observedPoint,
      hand = this.commandHand,
      commandPalm = this.lastCommandPalm,
      otherHands = this.otherCommandHands;
    this.cancel(
      undoRecent
        ? "Последняя вставка отменена взмахом влево."
        : "Текущее слово отменено взмахом влево.",
    );
    this.lastPoint = point;
    this.commandHand = hand;
    this.lastCommandPalm = commandPalm;
    this.otherCommandHands = otherHands;
    this.detached = !!point;
    this.blockedUntil = time + 800;
    this.lastTime = time;
  }
  confirm(word = null, session = this.serial) {
    if (session !== this.serial || !["drawing", "ready"].includes(this.phase))
      return false;
    if (this.phase !== "ready") {
      this.phase = "ready";
      this.request(true);
    }
    const best = this.results[0];
    if (
      !word &&
      (!best ||
        best.error > 0.16 ||
        (this.results[1] && this.results[1].score - best.score < 0.012))
    ) {
      this.reason = "Выберите вариант или исправьте слово вручную.";
      return false;
    }
    const chosen = word ? this.results.find((c) => c.word === word) : best;
    if (!chosen) {
      this.reason =
        "Нет подходящего кандидата. Запишите правильное слово для обучения.";
      return false;
    }
    const completed = {
      path: this.path.map((p) => ({ ...p })),
      frames: this.frames.slice(),
      layout: this.layout,
    };
    const owner = this.owner,
      point = this.lastPoint,
      selection = this.selection,
      time = this.lastTime,
      hold = this.hold,
      mode = this.entryMode,
      hand = this.commandHand,
      commandPalm = this.lastCommandPalm,
      otherHands = this.otherCommandHands;
    this.reset();
    this.owner = owner;
    this.anchor = point;
    this.lastPoint = point;
    this.smooth = point;
    this.selection = selection;
    this.phase = "armed";
    this.lastTime = time;
    this.hold = hold;
    this.commandHand = hand;
    this.lastCommandPalm = commandPalm;
    this.otherCommandHands = otherHands;
    this.recentCommit = true;
    if (mode === "letters") this.entryMode = "letters";
    if (mode === "swipe") {
      // After insertion, require the same deliberate re-entry as after a
      // completed word. Casual hand movements between words are not a prefix.
      this.owner = null;
      this.detached = true;
    }
    this.blockedUntil = time + (mode === "swipe" ? 800 : 0);
    this.commitText(chosen, completed);
    return true;
  }
  updateTap(p, time, threshold) {
    if (!this.tap || this.tap.id !== p.id)
      this.tap = {
        id: p.id,
        base: p.z,
        down: false,
        last: -Infinity,
        point: p,
      };
    const s = this.tap;
    if (!s.down && p.z < s.base - threshold && time - s.last > 350) {
      s.down = true;
      s.start = time;
      s.point = { ...p };
    } else if (s.down && p.z > s.base - threshold * 0.3) {
      if (time - s.start < 700 && distance(p, s.point) < 0.025) {
        this.tapCount++;
        s.last = time;
        // Camera flexion is diagnostic; dwell supplies letters. It must not
        // duplicate a held letter or replace an in-progress swipe.
      }
      s.down = false;
    }
    if (s.down && time - s.start >= 700) s.down = false;
    if (!s.down) s.base = s.base * 0.98 + p.z * 0.02;
  }
  step({
    tips,
    observed = tips,
    palms = [],
    time,
    layout = "ru",
    calibrated = true,
    tapThreshold = 0.07,
  }) {
    if (!Number.isFinite(time) || time <= this.lastTime) return this;
    if (this.layout && layout !== this.layout)
      this.reset("Раскладка изменена. Начните новое слово.");
    this.layout = layout;
    const priorTime = this.lastTime;
    if (this.owner && time - priorTime > 400 && !this.confirmRequested) {
      this.lastTime = time;
      this.finish("Нет свежих наблюдений.");
      return this;
    }
    this.lastTime = time;
    const usable = tips.filter((p) => p.pointing),
      visible = observed.filter((p) => p.pointing);
    this.selection = this.activity.update(
      observed,
      time,
      new Set((usable.length ? usable : visible).map((p) => p.id)),
    );
    if (!calibrated) {
      this.phase = "needs-calibration";
      this.reason =
        "Пройдите буквенную калибровку: текущая плоскость не подтверждена.";
      return this;
    }
    const commandOwner = this.commandHand || this.owner?.split("-")[0];
    let commandPalm = palms.find((h) => h.id === commandOwner);
    const commandContext =
      ["ready", "paused"].includes(this.phase) || this.recentCommit;
    if (commandPalm)
      for (const other of palms)
        if (other.id !== commandPalm.id) this.otherCommandHands.add(other.id);
    if (
      !commandPalm &&
      commandContext &&
      palms.length === 1 &&
      this.lastCommandPalm &&
      time - this.lastCommandPalm.time <= 2500
    ) {
      const next = palms[0],
        previous = this.lastCommandPalm;
      if (
        !this.otherCommandHands.has(next.id) &&
        distance(next, previous) <= 0.3 &&
        (!next.scale ||
          !previous.scale ||
          Math.abs(Math.log(next.scale / previous.scale)) < 0.5)
      ) {
        commandPalm = next;
        this.commandHand = next.id;
        this.flick.reset();
        this.leftFlick.reset();
      }
    }
    if (commandPalm) this.lastCommandPalm = { ...commandPalm, time };
    const left = this.leftFlick.update(
      commandPalm,
      time,
      ((this.path.length > 1 || !!this.letters) &&
        ["ready", "paused"].includes(this.phase)) ||
        this.recentCommit,
    );
    if (left.type === "commit") {
      this.command = { ...left, type: "cancel" };
      this.cancelByGesture(
        time,
        tips.find((p) => p.id === this.lastPoint?.id) || this.lastPoint,
      );
      return this;
    }
    this.command = this.flick.update(
      commandPalm,
      time,
      (this.path.length > 1 || !!this.letters) &&
        ["ready", "paused"].includes(this.phase),
    );
    if (left.type === "pending")
      this.command = { ...left, type: "pending", direction: "left" };
    if (this.command.type === "commit") {
      this.confirmRequested = true;
      if (this.entryMode === "letters") this.request(true);
      else this.finish("Подтверждение взмахом вправо.");
      return this;
    }
    if (
      this.command.type === "pending" &&
      ["ready", "paused"].includes(this.phase)
    )
      return this;
    // Keep the explicit confirmation's session/version until its asynchronous
    // dictionary response arrives. A settling flick is not a new word. Left
    // cancellation above remains available throughout this wait.
    if (this.confirmRequested) return this;
    if (this.detached) {
      if (time < this.blockedUntil) return this;
      const next = usable.find(
        (p) =>
          inside(p) && distance(p, this.path.at(-1) || this.lastPoint) > 0.06,
      );
      if (!next) {
        this.reentry = null;
        return this;
      }
      if (
        !this.reentry ||
        this.reentry.id !== next.id ||
        distance(next, this.reentry) > 0.025
      ) {
        this.reentry = { ...next, since: time };
        return this;
      }
      if (time - this.reentry.since < 150) return this;
      this.reset();
      this.layout = layout;
      this.lastTime = time;
    }
    if (this.owner) {
      const seen = observed.find((p) => p.id === this.owner),
        p = tips.find((p) => p.id === this.owner);
      if (!seen) {
        this.pause ??= { time, phase: this.phase, point: this.lastPoint };
        this.pause.lostSince ??= time;
        this.phase = "paused";
        this.reason = "Краткая потеря пальца: сохраняю траекторию до 400 мс.";
        if (time - this.pause.lostSince >= 400)
          this.finish("Рука убрана из кадра.");
        return this;
      }
      if (this.pause) this.pause.lostSince = null;
      if (!p) {
        if (this.entryMode === "swipe" && this.samples.length >= 4) {
          this.finish(
            "Рука вышла из рабочей глубины. Допущенная траектория сохранена.",
          );
          return this;
        }
        this.cancel("Рука вышла из рабочей глубины. Слово отменено.");
        this.lastTime = time;
        this.phase = "blocked-depth";
        return this;
      }
      if (p.pointing) this.lastConfidentTime = time;
      const previous = this.lastPoint;
      const continuous =
        previous &&
        Math.hypot(
          (p.cameraX ?? p.x) - (previous.cameraX ?? previous.x),
          (p.cameraY ?? p.y) - (previous.cameraY ?? previous.y),
        ) <= Math.min(0.18, 0.025 + (time - priorTime) * 0.001);
      const softPose =
        this.entryMode === "swipe" &&
        !p.pointing &&
        inside(p) &&
        time - this.lastConfidentTime <= 350 &&
        continuous;
      if (previous?.pointing === false && !continuous) {
        this.pause ??= { time, phase: this.phase, point: this.lastPoint };
        this.phase = "paused";
        this.reason =
          "Неясная поза: слово сохранено, ожидаю продолжения той же рукой.";
        this.lastPoint = { ...p };
        return this;
      }
      if (
        (!p.pointing && !softPose) ||
        (!inside(p) && this.phase !== "ready")
      ) {
        this.hold.reset({ keepLatch: true });
        if (!this.pause)
          this.pause = { time, phase: this.phase, point: this.lastPoint };
        this.phase = "paused";
        this.reason = p.pointing
          ? "Верните кончик в калиброванную плоскость."
          : "Поза неясна: позиции не добавляются в слово.";
        // Visible same-hand pose changes do not end a word. In particular,
        // moving from И to final Е can briefly fail the pointing classifier.
        this.lastPoint = { ...p };
        return this;
      }
      if (this.pause) {
        if (!continuous) {
          this.lastPoint = { ...p };
          return this;
        }
        this.phase = this.pause.phase;
        this.pause = null;
        this.smooth = { ...p };
      }
    }
    if (!this.owner) {
      if (!usable.length) {
        this.phase = visible.length ? "blocked-depth" : "idle";
        this.reason = visible.length
          ? "Руки видны, но ввод не допущен по глубине. Примите рабочую позицию за 1×."
          : observed.length
            ? "Вытяните палец: кулак не участвует во вводе."
            : "Покажите руки камере.";
        return this;
      }
      const preferred =
        usable.find((p) => p.id === this.selection.id) ||
        usable
          .slice()
          .sort((a, b) => a.distanceRatio - b.distanceRatio || a.z - b.z)[0];
      if (!inside(preferred)) {
        this.phase = "paused";
        this.reason = "Кончик вне плоскости: проверьте буквенную калибровку.";
        return this;
      }
      this.owner = preferred.id;
      this.commandHand = preferred.id.split("-")[0];
      this.anchor = { ...preferred, t: time };
      this.smooth = { ...preferred };
      this.lastPoint = { ...preferred };
      this.phase = "armed";
      this.reason = "Проведите выбранным пальцем по буквам.";
      this.lastConfidentTime = time;
    }
    const p = tips.find((p) => p.id === this.owner);
    if (!p) return this;
    this.samples.push({ ...p, t: time });
    if (this.samples.length > 2048) this.samples.shift();
    if (time < this.blockedUntil) {
      this.anchor = { ...p, t: time };
      this.smooth = { ...p };
      this.lastPoint = { ...p };
      this.reason = "Слово вставлено. Защита от повторного взмаха: 0.8 с.";
      return this;
    }
    // Before a word starts, follow a proven activity leader. During a word the
    // owner is immutable: diagnostics cannot cancel or concatenate its path.
    if (
      this.phase === "armed" &&
      this.selection.id &&
      this.selection.id !== this.owner
    ) {
      const next = usable.find((p) => p.id === this.selection.id);
      if (next && inside(next)) {
        this.owner = next.id;
        this.commandHand = next.id.split("-")[0];
        this.anchor = { ...next, t: time };
        this.smooth = { ...next };
        this.lastPoint = { ...next };
        this.tap = null;
        this.hold.reset();
        return this;
      }
    }
    const alpha =
      priorTime === -Infinity
        ? 1
        : 1 - Math.exp(-Math.min(150, time - priorTime) / 40);
    this.smooth = {
      ...p,
      x: this.smooth.x + alpha * (p.x - this.smooth.x),
      y: this.smooth.y + alpha * (p.y - this.smooth.y),
      t: time,
    };
    this.lastPoint = { ...p };
    this.updateTap(p, time, tapThreshold);
    const key = nearestKey(p, this.layout),
      overKey =
        key && Math.abs(p.x - key.x) <= 0.037 && Math.abs(p.y - key.y) <= 0.125;
    const holdLetter = () => {
      const event = this.hold.update({
        point: p,
        id: p.id,
        key: key?.letter,
        time,
        eligible: !!overKey,
      });
      if (!event) return;
      if (this.letters.length >= 32) {
        this.cancel("Слишком много букв. Подтвердите короткое слово.");
        this.lastTime = time;
        return;
      }
      this.entryMode = "letters";
      this.letters += event.key;
      this.lastMotion = time;
      this.phase = "ready";
      this.version++;
      this.reason = `Зафиксирована ${event.key.toUpperCase()} · буквы: ${this.letters}. Наведите на следующую букву или выберите вариант для вставки.`;
      this.request(true);
    };
    if (this.entryMode === "letters") {
      holdLetter();
      return this;
    }
    if (this.phase === "ready") {
      if (distance(this.smooth, this.path.at(-1) || this.smooth) <= 0.03)
        return this;
      // A half-second pause supplies candidates, but does not lock the path:
      // the same finger can continue spelling a longer word.
      this.phase = "drawing";
      this.hold.reset();
    }
    if (this.phase === "armed" && distance(this.smooth, this.anchor) > 0.018) {
      this.serial++;
      this.entryMode = "swipe";
      this.hold.reset();
      this.phase = "drawing";
      this.path = [{ ...this.anchor }, { ...this.smooth }];
      this.frames = [];
      this.letters = "";
      this.results = [];
      this.version = 1;
      this.applied = -1;
      this.lastMotion = time;
      this.reason =
        "Рисуйте слово. Владелец закреплён; сгибания не меняют swipe.";
      this.request();
    } else if (this.phase === "drawing") {
      const last = this.path.at(-1),
        delta = distance(this.smooth, last);
      if (delta > Math.max(0.18, (time - last.t) * 0.008)) {
        this.cancel("Скачок координат. Слово отменено, повторите движение.");
        this.lastTime = time;
        return this;
      }
      if (delta > 0.006) {
        this.path.push({ ...this.smooth });
        this.version++;
        this.lastMotion = time;
        this.hold.reset();
      }
      if (this.path.length > 2048) {
        this.cancel(
          "Слишком длинная траектория. Начните короткое слово заново.",
        );
        this.lastTime = time;
        return this;
      }
      const held = this.hold.update({
        point: this.smooth,
        id: p.id,
        key: "swipe",
        time,
        eligible: true,
      });
      if (held) {
        this.phase = "ready";
        this.reason =
          "Слово готово: взмах вправо, «Пробел / завершить» или выбор варианта.";
        this.request(true);
      } else if (time - this.lastDecode >= 150) this.request();
    } else if (this.phase === "armed") holdLetter();
    if (this.phase === "drawing") {
      this.frames.push({ t: time, tips: [{ ...p }] });
      if (this.frames.length > 300) this.frames.shift();
    }
    return this;
  }
}
