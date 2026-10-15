import "./style.css";
import { telemetry, mountTelemetry } from "./telemetry.js";
import {
  homography,
  project,
  nearestKey,
  wordPath,
  resample,
  rankWords,
  rankToken,
  Segmenter,
  validateDataset,
  vocabulary,
} from "./core.js";
import { drawWorkspace } from "./render.js";
import { DepthGate } from "./depth.js";
import { depthDemoHands } from "./depth-demo.js";
import { projectTrackedHands } from "./hand-input.js";
import { acquireCameraStream, waitForVideoFrame } from "./camera.js";
import { displayCorners } from "./scene.js";
import { CalibrationController } from "./calibration-ui.js";
import { InputSession } from "./input-session.js";
import { StageControl, layoutKey, layoutKeyOutline } from "./stage-control.js";
import { WordOverlay } from "./word-overlay.js";
import { PrefixDecoder, PrefixConsensus } from "./prefix-decoder.js";
import { removeKnownSample, SAMPLE_CLEANUP_REQUEST } from "./sample-cleanup.js";
const $ = (id) => document.getElementById(id);
const layoutHold = new StageControl(2000);
const unit = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ],
  defaults = [
    [0.06, 0.38],
    [0.94, 0.38],
    [0.94, 0.9],
    [0.06, 0.9],
  ];
const visualCorners = displayCorners();
const state = {
  source: "pointer",
  lang: "ru",
  corners: defaults,
  visualCorners,
  forward: homography(unit, visualCorners),
  displayInverse: homography(visualCorners, unit),
  inverse: homography(defaults, unit),
  tips: [],
  hands: [],
  excludedHands: [],
  trails: new Map(),
  active: null,
  calibrating: false,
  calibrated: false,
  calibrationVerified: false,
};
let clips = [],
  lastClip = null,
  frames = [],
  candidates = [],
  undo = [],
  pointerPath = null,
  demoFrame = 0,
  revision = 0;
let cameraWorker = null,
  stream = null,
  cameraFrame = 0,
  busy = false,
  lastFrame = 0,
  lastVideoTime = -1,
  cameraGeneration = 0,
  starting = false;
let tapStrings = { ru: "", en: "" },
  tapTimer = null,
  lastDecode = 0,
  previewBusy = false;
let overlayVisible = true,
  demoText = "";
let candidateSignature = "",
  cameraPredictionBusy = false,
  lastCameraClipSerial = null;
const wordOverlay = new WordOverlay($("camera-text"));
const fallbackPrefixes = new Map();
const prefixConsensus = new PrefixConsensus();
let previewPending = null,
  previewId = 0,
  previewApplied = 0,
  previewTime = -Infinity;
let overlayInputKey = null,
  pointerPreviewSession = 0,
  pointerPreviewFinished = true;
let lastCameraInsertion = null;
let dictionaryWorker,
  dictionaryReady = false,
  dictionaryBusy = false,
  dictionaryPending = null,
  dictionaryTimer;
function dispatchDictionary() {
  if (
    !dictionaryReady ||
    dictionaryBusy ||
    (!dictionaryPending && !previewPending)
  )
    return;
  dictionaryBusy = true;
  if (dictionaryPending) {
    const token = dictionaryPending;
    dictionaryPending = null;
    dictionaryWorker.postMessage({
      type: "decode",
      token,
      context: $("text").value,
      extra: clips,
    });
  } else {
    dictionaryWorker.postMessage(previewPending);
    previewPending = null;
  }
  clearTimeout(dictionaryTimer);
  dictionaryTimer = setTimeout(() => {
    dictionaryReady = false;
    dictionaryBusy = false;
    dictionaryWorker.terminate();
    cameraInput.confirmRequested = false;
    $("dictionary-status").textContent =
      "Словарь не ответил за 10 с. Работает ограниченный резервный словарь; перезагрузите страницу.";
  }, 10000);
}
function applyPrefix(token, preview) {
  if (
    token.source !== state.source ||
    token.layout !== state.lang ||
    token.id <= previewApplied ||
    state.calibrating
  )
    return;
  if (token.source === "camera") {
    if (
      token.session !== cameraInput.serial ||
      currentCameraWord() ||
      cameraInput.entryMode !== "swipe"
    )
      return;
  } else if (token.session !== pointerPreviewSession || pointerPreviewFinished)
    return;
  previewApplied = token.id;
  const text = prefixConsensus.update(
    preview,
    performance.now(),
    token.source === "pointer" &&
      !prefixConsensus.text &&
      preview.text.length === 1,
  );
  wordOverlay.show(
    text,
    "letters",
    `${token.source}:${token.session}:preview:${token.id}`,
  );
  telemetry.record("prefix-preview", { token, ...preview, displayed: text });
}
function currentCameraWord() {
  const r = cameraInput.recognized;
  return cameraInput.phase === "ready" &&
    r?.token.version === cameraInput.version &&
    r.motion === cameraInput.lastMotion
    ? r
    : null;
}
function renderFlickState(now = performance.now()) {
  const recognized = currentCameraWord();
  $("flick-state").textContent = recognized
    ? $("auto-camera-insert").checked
      ? `Автовставка через ${(Math.max(0, 1500 - (now - recognized.since)) / 1000).toFixed(1)} с · влево отменить · вправо вставить сейчас`
      : "Влево отменить · вправо вставить"
    : cameraInput.entryMode === "letters"
      ? "Буквы накоплены: выберите вариант или «Пробел / завершить». Движение к другой букве не вставляет слово."
      : cameraInput.phase === "ready"
        ? "Подтвердите взмахом вправо или выбором варианта"
        : "Взмах доступен после остановки слова";
}
function previewPath(path, source, session, version) {
  const key = `${source}:${session}`;
  if (overlayInputKey !== key) {
    overlayInputKey = key;
    previewTime = -Infinity;
    prefixConsensus.reset();
    wordOverlay.show("", "letters");
  }
  const now = performance.now();
  if (now - previewTime < 120) return;
  previewTime = now;
  const token = {
    source,
    session,
    version,
    layout: state.lang,
    id: ++previewId,
  };
  if (dictionaryReady) {
    previewPending = {
      type: "preview",
      token,
      path: path.map((p) => ({ ...p })),
    };
    dispatchDictionary();
  } else {
    if (!fallbackPrefixes.has(state.lang))
      fallbackPrefixes.set(
        state.lang,
        new PrefixDecoder(vocabulary[state.lang], state.lang),
      );
    applyPrefix(
      token,
      fallbackPrefixes
        .get(state.lang)
        .predict(path, { requireStartHold: source === "camera" }),
    );
  }
}
function initializeDictionary() {
  const label = document.createElement("p");
  label.id = "dictionary-status";
  label.className = "small";
  label.textContent = "Загрузка словарей RU / EN…";
  $("candidates").before(label);
  dictionaryWorker = new Worker(
    new URL("./decoder.worker.js", import.meta.url),
    { type: "module" },
  );
  const failed = (message) => {
    clearTimeout(dictionaryTimer);
    dictionaryReady = false;
    dictionaryBusy = false;
    cameraInput.confirmRequested = false;
    label.textContent =
      "Большой словарь недоступен: " +
      message +
      ". Используется ограниченный резервный словарь.";
    telemetry.record("dictionary-error", { message });
  };
  dictionaryWorker.onerror = (e) => failed(e.message);
  dictionaryWorker.onmessage = ({ data }) => {
    clearTimeout(dictionaryTimer);
    if (data.type === "ready") {
      dictionaryReady = true;
      label.textContent =
        ["ru", "en"]
          .map(
            (lang) =>
              `${lang.toUpperCase()}: ${data.counts[lang] === null ? `резервный словарь (${data.errors[lang]})` : data.counts[lang].toLocaleString("ru") + " слов"}`,
          )
          .join(" · ") + " · локально";
    } else if (data.type === "preview") {
      dictionaryBusy = false;
      applyPrefix(data.token, data.preview);
    } else if (data.type === "error") {
      failed(data.message);
      return;
    } else {
      dictionaryBusy = false;
      if (data.token.source === "pointer") {
        if (
          state.source === "pointer" &&
          data.token.version === revision &&
          data.token.layout === state.lang
        )
          presentPointerResults(data.results, true);
        dispatchDictionary();
        return;
      }
      const accepted = cameraInput.accept(data.token, data.results);
      telemetry.record("dictionary-result", { ...data, accepted });
      if (accepted) {
        $("decoder-ms").textContent = data.ms.toFixed(1) + " мс";
        const inserted = cameraInput.commitRecognized(
          data.token,
          $("auto-camera-insert").checked,
          performance.now(),
        );
        telemetry.record("insertion-decision", {
          session: data.token.session,
          complete: data.token.complete,
          automatic: $("auto-camera-insert").checked,
          gesture: data.token.confirmRequested,
          inserted,
          reason: cameraInput.reason,
        });
        if (inserted && state.source === "camera") presentCamera();
        else renderCandidates(inserted ? [] : data.results);
      }
    }
    dispatchDictionary();
  };
  dictionaryTimer = setTimeout(() => failed("таймаут загрузки 10 с"), 10000);
  dictionaryWorker.postMessage({ type: "init" });
}
const segmenter = new Segmenter();
const cameraInput = new InputSession({
  recognize: recognizeCamera,
  commit: (candidate, clip) => {
    telemetry.record("commit", { candidate, points: clip.path.length });
    frames = clip.frames;
    remember(clip.path, "camera");
    lastCameraClipSerial = null;
    const before = $("text").value;
    commit(candidate.word, candidate.lang);
    lastCameraInsertion = { before, after: $("text").value };
    $("flick-result").textContent = `Вставлено: ${candidate.word}`;
  },
  retract: ({ undoRecent }) => {
    let undone = false;
    if (
      undoRecent &&
      lastCameraInsertion &&
      $("text").value === lastCameraInsertion.after
    ) {
      $("text").value = lastCameraInsertion.before;
      if (undo.at(-1) === lastCameraInsertion.before) undo.pop();
      textChanged();
      lastCameraInsertion = null;
      undone = true;
    }
    telemetry.record("cancel-left", { undoRecent, undone });
    wordOverlay.clear();
    renderCandidates([]);
    $("flick-result").textContent = undone
      ? "Последняя вставка отменена влево"
      : "Текущее слово отменено влево";
  },
});
const depthGate = new DepthGate();
const calibration = new CalibrationController({
  state,
  resetInput: () => {
    resetGesture();
    lastClip = null;
    renderCandidates([]);
  },
  apply: (result) => {
    state.inverse = result.inverse;
    state.corners = result.corners;
    state.calibrated = true;
    state.calibrationVerified = true;
    renderCalibrationStatus();
    return (
      store("camkeys-corners", result.corners) &&
      store("camkeys-calibrated", true)
    );
  },
  status,
  draw,
});
let depthCalibrated = false;
const learningWorker = new Worker(
  new URL("./learning.worker.js", import.meta.url),
  { type: "module" },
);
let callId = 0,
  networkReady = false,
  training = false;
const calls = new Map();
function status(message, error = false) {
  $("status").textContent = message;
  $("status").classList.toggle("error", error);
}
function store(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    status(
      `Не удалось сохранить на устройстве: ${e.message}. Данные остаются в текущей вкладке; используйте экспорт.`,
      true,
    );
    return false;
  }
}
function read(key) {
  const value = localStorage.getItem(key);
  return value ? JSON.parse(value) : null;
}
function call(type, payload) {
  return new Promise((resolve, reject) => {
    const id = ++callId;
    const timeout = setTimeout(
      () => {
        calls.delete(id);
        reject(new Error("Сеть не ответила вовремя"));
      },
      type === "train" ? 120000 : 15000,
    );
    calls.set(id, { resolve, reject, timeout });
    learningWorker.postMessage({ id, type, payload });
  });
}
learningWorker.onmessage = ({ data }) => {
  if (data.progress) {
    $("network-status").textContent =
      `Обучение: ${data.progress.epoch} / ${data.progress.epochs}, loss ${data.progress.loss.toFixed(3)}`;
    return;
  }
  const c = calls.get(data.id);
  if (!c) return;
  clearTimeout(c.timeout);
  calls.delete(data.id);
  data.error ? c.reject(new Error(data.error)) : c.resolve(data.result);
};
learningWorker.onerror = (e) => {
  networkReady = false;
  for (const c of calls.values()) {
    clearTimeout(c.timeout);
    c.reject(new Error("Ошибка потока нейросети"));
  }
  calls.clear();
  $("network-status").textContent =
    `Нейросеть недоступна: ${e.message}. Используется геометрия.`;
};
function languages() {
  return [state.lang];
}
function renderLayout() {
  const button = $("layout-toggle");
  button.textContent = state.lang.toUpperCase();
  button.dataset.layout = state.lang;
  const label =
    state.lang === "ru"
      ? "Язык клавиатуры: русский. Переключить на английский"
      : "Язык клавиатуры: английский. Переключить на русский";
  button.title =
    label +
    ". Удерживайте указательный палец на кнопке 2 секунды или нажмите мышью.";
  button.setAttribute("aria-label", button.title);
  $("active-lang").textContent = `${state.lang.toUpperCase()} · вручную`;
}
function changeLayout(lang) {
  if (lang === state.lang) return;
  if (layoutHold.id) layoutHold.latched = true;
  const wasCalibrating = state.calibrating;
  if (wasCalibrating) calibration.cancel();
  if (state.source === "demo") stop(true);
  resetGesture();
  lastClip = null;
  renderCandidates([]);
  state.lang = lang;
  store("camkeys-layout", lang);
  renderLayout();
  $("last-clip").textContent = "Раскладка изменена. Начните новое слово.";
  status(
    `${lang.toUpperCase()} выбрана вручную. ${wasCalibrating ? "Мастер отменён; запустите его заново. " : ""}Незавершённое слово сброшено.`,
  );
  draw();
}
const russianPlural = new Intl.PluralRules("ru");
function countLabel(count, one, few, many) {
  const form = { one, few, many }[russianPlural.select(count)] || many;
  return `${count} ${form}`;
}
function updateSamples() {
  const groups = new Map();
  clips.forEach((c) => {
    const k = `${c.word} · ${c.lang.toUpperCase()}`;
    groups.set(k, (groups.get(k) || 0) + 1);
  });
  $("sample-count").textContent = countLabel(
    clips.length,
    "запись",
    "записи",
    "записей",
  );
  $("samples").replaceChildren(
    ...[...groups].map(([word, n]) => {
      const el = document.createElement("span");
      el.textContent = `${word} × ${n}`;
      return el;
    }),
  );
}
function textChanged() {
  demoText = "";
  store("camkeys-text", $("text").value);
  updateWordCount();
}
function updateWordCount() {
  const words = $("text").value.trim().split(/\s+/).filter(Boolean);
  const count = words.length;
  $("camera-text").hidden = !overlayVisible;
  $("stage").classList.toggle("has-text", overlayVisible);
  $("toggle-camera-text").textContent = overlayVisible
    ? "Скрыть в камере"
    : "Показать в камере";
  $("toggle-camera-text").setAttribute("aria-pressed", String(overlayVisible));
  $("word-count").textContent = countLabel(count, "слово", "слова", "слов");
}
function commit(word, lang) {
  if (lang && lang !== state.lang) {
    status("Кандидат относится к другой раскладке. Начните новое слово.", true);
    return;
  }
  if (state.source === "demo") {
    demoText = `${demoText}${demoText ? " " : ""}${word}`;
    resetGesture(false);
    wordOverlay.show(`Демо · ${word}`, "word");
    renderCandidates([]);
    updateWordCount();
    status(
      "Демонстрационный текст показан временно. Ваш текст и записи сохранены.",
    );
    return;
  }
  undo.push($("text").value);
  if (undo.length > 50) undo.shift();
  const text = $("text").value;
  $("text").value = text + (text && !/\s$/.test(text) ? " " : "") + word + " ";
  textChanged();
  if (state.source !== "camera") resetGesture(false);
  wordOverlay.insert(word);
  renderCandidates([]);
  draw();
}
function renderCandidates(results) {
  candidates = results;
  const signature = JSON.stringify([state.source, cameraInput.serial, results]);
  if (signature === candidateSignature) return;
  candidateSignature = signature;
  $("candidates").replaceChildren(
    ...results.slice(0, 4).map((c) => {
      const button = document.createElement("button");
      button.textContent = c.word;
      const small = document.createElement("small");
      small.textContent = c.lang.toUpperCase();
      button.append(small);
      const session = cameraInput.serial;
      button.onclick = () => {
        if (state.source === "camera") {
          cameraInput.confirm(c.word, session);
          presentCamera();
        } else commit(c.word, c.lang);
      };
      return button;
    }),
  );
  if (!results.length) {
    const p = document.createElement("p");
    p.textContent = "Недостаточно движения для слова.";
    $("candidates").append(p);
  }
  $("method").textContent = results[0]?.method || "Геометрия";
}
async function decode(path, final = false, taps = null) {
  const token = ++revision,
    start = performance.now();
  let result = rankWords(path, $("text").value, languages(), clips, taps);
  if (networkReady && !training && !taps && path.length > 2) {
    try {
      const learned = (await call("predict", path)).filter((c) =>
        languages().includes(c.lang),
      );
      const top = learned[0];
      const geometric =
        top &&
        rankWords(path, "", [top.lang], [top]).find((c) => c.word === top.word);
      if (top && top.probability > 0.75 && geometric?.error < 0.16) {
        result = [
          { ...top, error: geometric.error, score: geometric.score },
          ...result.filter((c) => c.word !== top.word),
        ].slice(0, 5);
      }
    } catch (e) {
      networkReady = false;
      $("network-status").textContent =
        `Ошибка сети: ${e.message}. Используется геометрия.`;
    }
  }
  if (token !== revision) return;
  $("decoder-ms").textContent = `${(performance.now() - start).toFixed(1)} мс`;
  if (final && dictionaryReady && state.source === "pointer") {
    renderCandidates(result);
    dictionaryPending = {
      source: "pointer",
      version: token,
      session: pointerPreviewSession,
      layout: state.lang,
      path,
      letters: taps?.[state.lang] || "",
      final: true,
    };
    dispatchDictionary();
    return;
  }
  presentPointerResults(result, final);
}
function presentPointerResults(result, final) {
  renderCandidates(result);
  if (final && result[0]) wordOverlay.show(result[0].word, "word");
  if (
    final &&
    $("auto-commit").checked &&
    result[0] &&
    result[0].error < 0.05 &&
    (!result[1] || result[1].score - result[0].score > 0.04)
  )
    commit(result[0].word, result[0].lang);
  draw();
}
function remember(path, source) {
  if (path.length < 2) return;
  lastClip = {
    path: path.map((p) => ({ ...p })),
    source,
    frames: frames
      .slice(-300)
      .map((f) => ({ ...f, tips: f.tips.map((p) => ({ ...p })) })),
  };
  $("last-clip").textContent =
    source === "demo"
      ? "Синтетическое демо: запись для обучения отключена."
      : `Последняя траектория: ${path.length} точек · ${source === "camera" ? "камера" : "мышь"}`;
  frames = [];
}
function addTaps(tips) {
  for (const p of tips)
    for (const lang of languages()) {
      const k = nearestKey(p, lang);
      if (k) tapStrings[lang] += k.letter;
    }
  if (tips.length) {
    $("gesture").textContent = "Нажатия · эксперимент";
    clearTimeout(tapTimer);
    tapTimer = setTimeout(finishTaps, 900);
    void decode([], false, tapStrings);
  }
}
function finishTaps() {
  clearTimeout(tapTimer);
  tapTimer = null;
  if (Object.values(tapStrings).some(Boolean)) {
    const raw = { ...tapStrings };
    tapStrings = { ru: "", en: "" };
    void decode([], true, raw);
  }
}
function ingest(tips, time, hands = []) {
  // Synthetic demos use the legacy segmenter; physical camera input has one controller.
  state.hands = hands;
  state.tips = tips;
  const event = segmenter.update(tips, time, Number($("tap-threshold").value));
  state.active = segmenter.active;
  $("finger-count").textContent = tips.length + " / 10";
  $("tracking").textContent = "Синтетические точки · НЕ камера";
  if (state.active) {
    const path = segmenter.path.map((p) => ({ ...p }));
    state.trails = new Map([[state.active, path]]);
    frames.push({ t: time, tips: tips.filter((p) => p.id === state.active) });
    if (frames.length > 300) frames.shift();
  }
  if (event.type === "lost") {
    revision++;
    frames = [];
    lastClip = null;
    state.trails.clear();
    renderCandidates([]);
  } else if (event.type === "swipe") {
    remember(event.path, state.source);
    void decode(event.path, true);
  } else if (
    event.type === "moving" &&
    time - lastDecode > 150 &&
    !previewBusy
  ) {
    lastDecode = time;
    previewBusy = true;
    decode(segmenter.path).finally(() => (previewBusy = false));
  }
  draw();
}
function renderCalibrationStatus() {
  $("calibration-status").textContent = state.calibrated
    ? state.calibrationVerified
      ? "Контроль пройден · буквенная плоскость сохранена."
      : "Сохранена прежняя плоскость; прохождение контроля неизвестно. Проверьте её через «Калибровка»."
    : "Буквенная калибровка не подтверждена. Нажмите «Калибровка» и пройдите контроль.";
}
function presentCamera(result = null) {
  if (
    lastCameraClipSerial !== null &&
    lastCameraClipSerial !== cameraInput.serial
  ) {
    lastClip = null;
    lastCameraClipSerial = null;
    $("last-clip").textContent =
      "Незавершённая траектория отменена. Начните новое слово.";
  }
  if (result) {
    state.hands = result.hands;
    state.tips = result.tips;
    state.activityTip =
      result.activityTips.find((p) => p.id === cameraInput.owner) ||
      result.activityTips.find((p) => p.id === cameraInput.selection?.id);
  }
  state.active = cameraInput.owner;
  state.inputPhase = cameraInput.phase;
  if (
    cameraInput.entryMode &&
    (cameraInput.samples.length || cameraInput.letters)
  ) {
    const recognized = currentCameraWord();
    if (recognized || cameraInput.entryMode === "letters") {
      const text = recognized ? recognized.word : cameraInput.letters;
      wordOverlay.show(
        text,
        recognized ? "word" : "letters",
        `${cameraInput.serial}:${cameraInput.version}:${text}`,
      );
    } else
      previewPath(
        cameraInput.samples,
        "camera",
        cameraInput.serial,
        cameraInput.version,
      );
  }
  state.trails = cameraInput.owner
    ? new Map([[cameraInput.owner, cameraInput.path]])
    : new Map();
  $("finger-count").textContent = state.tips.length + " / 10";
  $("active-tip").dataset.tipId =
    cameraInput.owner || cameraInput.selection?.id || "";
  $("active-tip").textContent = cameraInput.owner
    ? ["большой", "указательный", "средний", "безымянный", "мизинец"][
        Number(cameraInput.owner.split("-").at(-1))
      ] +
      " · " +
      cameraInput.owner +
      " · " +
      (cameraInput.selection?.method === "удержание" ? "удержание · " : "") +
      "закреплён на время слова · окно 5 с"
    : cameraInput.phase === "needs-calibration" && cameraInput.selection?.id
      ? cameraInput.selection.id +
        " · выбран для анализа; ввод требует калибровки"
      : cameraInput.phase === "blocked-depth"
        ? "Выбранный кончик вне рабочей глубины · ввод запрещён"
        : state.tips.length && !state.tips.some((p) => p.pointing)
          ? "Пальцы согнуты · ввод запрещён"
          : "Активный палец не выбран · окно 5 с";
  $("tracking").textContent = cameraInput.reason;
  const labels = {
    idle: "Ожидание пальца",
    armed: "Готов к набору",
    drawing: "Скольжение",
    tapping: "Нажатия",
    ready: "Слово готово",
    paused: "Пауза",
    "blocked-depth": "Вне глубины",
    "needs-calibration": "Нужна калибровка",
  };
  $("gesture").textContent =
    cameraInput.entryMode === "letters"
      ? `Буквы: ${cameraInput.letters.toUpperCase() || "—"}`
      : labels[cameraInput.phase] || cameraInput.phase;
  $("input-dwell").textContent =
    cameraInput.hold.state === "holding"
      ? `Удержание: ${(cameraInput.hold.elapsed / 1000).toFixed(1)} / 0.5 с`
      : cameraInput.hold.state === "fixed"
        ? "Удержание зафиксировано один раз. Для новой буквы уйдите и наведите снова."
        : "Удержание над клавишей 0.5 с фиксирует букву; остановка swipe 0.5 с анализирует слово.";
  renderFlickState();
  const command = cameraInput.command;
  $("flick-motion").textContent =
    (command.dx * 100).toFixed(1) +
    "% кадра · " +
    command.speed.toFixed(2) +
    " шир./с";
  if (cameraInput.path.length > 1) {
    lastCameraClipSerial = cameraInput.serial;
    lastClip = {
      path: cameraInput.path.map((p) => ({ ...p })),
      frames: cameraInput.frames.slice(),
      source: "camera",
    };
    $("last-clip").textContent =
      "Камера · " +
      cameraInput.path.length +
      " точек · " +
      labels[cameraInput.phase];
  }
  renderCandidates(cameraInput.results);
  draw();
}
function recognizeCamera(token) {
  telemetry.record("decode-request", token);
  const start = performance.now();
  const taps = token.letters ? { [token.layout]: token.letters } : null;
  const baseline = rankToken(token, $("text").value, clips);
  if (token.letters)
    baseline.forEach((c) => (c.method = "Удержание + словарь"));
  const accepted = cameraInput.accept(token, baseline);
  if (token.final) {
    dictionaryPending = token;
    dispatchDictionary();
  }
  telemetry.record("decode-result", {
    session: token.session,
    version: token.version,
    accepted,
    candidates: baseline,
    networkReady,
    cameraPredictionBusy,
  });
  $("decoder-ms").textContent = (performance.now() - start).toFixed(1) + " мс";
  if (
    !networkReady ||
    training ||
    taps ||
    token.path.length < 3 ||
    cameraPredictionBusy
  )
    return;
  cameraPredictionBusy = true;
  // Inference cannot replace results from another word, layout or a newer frame.
  void call("predict", token.path)
    .then((learned) => {
      const top = learned.find((c) => c.lang === token.layout);
      const geometry =
        top &&
        rankWords(token.path, "", [token.layout], [...clips, top]).find(
          (c) => c.word === top.word,
        );
      if (top?.probability > 0.75 && geometry?.error < 0.16) {
        const results = [
          { ...top, error: geometry.error, score: geometry.score },
          ...baseline.filter((c) => c.word !== top.word),
        ].slice(0, 5);
        if (
          cameraInput.accept(token, results) &&
          state.source === "camera" &&
          !state.calibrating
        )
          presentCamera();
      }
    })
    .catch((error) => {
      networkReady = false;
      $("network-status").textContent =
        "Ошибка сети: " + error.message + ". Используется геометрия.";
    })
    .finally(() => {
      cameraPredictionBusy = false;
    });
}

function draw() {
  const outline = layoutKeyOutline(state.forward);
  const left = Math.min(...outline.map((p) => p.x));
  const top = Math.min(...outline.map((p) => p.y));
  Object.assign($("layout-toggle").style, {
    left: `${left * 100}%`,
    top: `${top * 100}%`,
    width: `${(Math.max(...outline.map((p) => p.x)) - left) * 100}%`,
    height: `${(Math.max(...outline.map((p) => p.y)) - top) * 100}%`,
  });
  $("stage").style.setProperty(
    "--keyboard-top",
    `${Math.min(...state.visualCorners.map(([, y]) => y)) * 100}%`,
  );
  drawWorkspace($("overlay"), $("scene"), state);
}
function invalidateDepthInput() {
  resetGesture();
  lastClip = null;
  $("last-clip").textContent =
    "Движение сброшено при смене рабочей глубины. Начните новое слово.";
  renderCandidates([]);
  if (state.calibrating && state.source === "camera")
    calibration.update(
      [],
      performance.now(),
      "Пауза: рабочая глубина изменилась. Дождитесь стабильной руки; шаг сохранён.",
    );
}
function processTrackedHands(hands, time, aspect) {
  telemetry.record("tracker-frame", {
    time,
    age: performance.now() - time,
    hands,
    aspect,
    calibrating: state.calibrating,
  });
  if (
    state.source === "camera" &&
    state.calibrating &&
    time <= calibration.latestFrame
  )
    return;
  if (
    state.source === "camera" &&
    !state.calibrating &&
    time <= cameraInput.lastTime
  )
    return;
  const result = projectTrackedHands(
    hands,
    time,
    aspect,
    state.inverse,
    depthGate,
    state.calibrating,
  );
  if (state.source === "camera") {
    const control = layoutHold.update({
      tips: result.tips.length
        ? result.tips
        : result.rawTips.map((p) => ({
            ...p,
            ...project(state.inverse, p.x, p.y),
          })),
      observed: result.activityTips.map((p) => ({
        ...p,
        ...project(state.inverse, p.x, p.y),
      })),
      owner: cameraInput.owner,
      time,
      bounds: layoutKey,
    });
    state.layoutControl = control;
    $("layout-toggle").classList.toggle("holding", control.busy);
    if (control.busy) {
      cameraInput.suspendControl(time);
      telemetry.record("layout-hold", {
        time,
        ...control,
        finger: layoutHold.id,
        layout: state.lang,
      });
      if (control.fired) {
        changeLayout(state.lang === "ru" ? "en" : "ru");
        cameraInput.suspendControl(time);
      }
      state.hands = result.hands;
      const controlTip = result.rawTips.find((p) => p.id === layoutHold.id);
      state.tips = controlTip
        ? [
            {
              ...controlTip,
              ...project(state.inverse, controlTip.x, controlTip.y),
            },
          ]
        : [];
      state.active = layoutHold.id;
      state.activityTip = null;
      $("tracking").textContent =
        control.progress >= 1
          ? "Раскладка переключена · уберите палец с кнопки"
          : `Переключение раскладки · ${(control.progress * 2).toFixed(1)} / 2 с`;
      draw();
      return;
    }
    cameraInput.resumeControl(time);
  }
  telemetry.record("projection", {
    time,
    tips: result.tips,
    calibrationTips: result.calibrationTips,
    reference: depthGate.reference,
    limit: depthGate.limit,
    hands: [...result.depth.accepted, ...result.depth.excluded].map(
      ({ id, ratio, rawRatio, reason }) => ({ id, ratio, rawRatio, reason }),
    ),
  });
  state.excludedHands = result.depth.excluded;
  const names = {
    near: "в зоне",
    far: "далеко",
    settling: "ожидание допуска",
    identity: "неясная идентичность",
    invalid: "нет оценки",
  };
  const all = [...result.depth.accepted, ...result.depth.excluded];
  const far = result.depth.excluded.filter((h) => h.reason === "far").length;
  $("depth-status").textContent =
    `Допущено рук: ${result.depth.accepted.length}; исключено: ${result.depth.excluded.length} (далеко: ${far}). ` +
    all
      .map(
        (h) =>
          `${h.id.replace("hand", "Рука ")}: ${h.ratio === null ? "—" : h.ratio.toFixed(2) + "×"} · ${names[h.reason]}`,
      )
      .join("; ");
  if (state.calibrating) {
    state.hands = [...result.depth.accepted, ...result.depth.excluded]
      .filter((h) => ["near", "far", "settling"].includes(h.reason))
      .map((h) => h.hand);
    state.tips = [];
    $("finger-count").textContent = "0 / 10";
    $("tracking").textContent = "Мастер букв · ввод на паузе";
    calibration.update(
      result.calibrationTips,
      time,
      !hands.length
        ? "Пауза: трекер потерял всю кисть. Верните в кадр ладонь и запястье, особенно у нижнего ряда. Шаг сохранён."
        : result.depth.ambiguous
          ? "Пауза: руки перекрываются, не удалось определить руку. Оставьте одну кисть в кадре. Шаг сохранён."
          : "Пауза: не удалось оценить геометрию ладони. Покажите кисть целиком. Дальняя граница в мастере не блокирует ввод; шаг сохранён.",
    );
    draw();
    return;
  }
  if (state.source !== "camera") {
    ingest(result.tips, time, result.hands);
    return;
  }
  cameraInput.step({
    tips: result.tips,
    observed: result.activityTips,
    palms: result.commandPalms,
    time,
    layout: state.lang,
    calibrated: state.calibrated,
    tapThreshold: Number($("tap-threshold").value),
  });
  presentCamera(result);
  telemetry.record("input-state", {
    time,
    phase: cameraInput.phase,
    reason: cameraInput.reason,
    owner: cameraInput.owner,
    selection: cameraInput.selection,
    session: cameraInput.serial,
    version: cameraInput.version,
    calibrated: state.calibrated,
    mode: cameraInput.entryMode,
    letters: cameraInput.letters,
    lastPoint: cameraInput.lastPoint,
    pathLength: cameraInput.path.length,
    candidates: cameraInput.results,
    dwellState: cameraInput.hold.state,
    dwellMs: cameraInput.hold.elapsed,
    command: cameraInput.command,
    detached: cameraInput.detached,
  });
}
function updateDepthControls() {
  $("depth-limit").value = depthGate.limit;
  $("depth-limit-value").textContent = depthGate.limit.toFixed(2) + "×";
  $("depth-reference").textContent = depthCalibrated
    ? "1× · ваша калибровка"
    : "1× · начальная оценка";
}
function resetGesture(resetActivity = true) {
  wordOverlay.clear();
  overlayInputKey = null;
  previewPending = null;
  pointerPreviewFinished = true;
  if (lastCameraClipSerial !== null) {
    lastClip = null;
    lastCameraClipSerial = null;
  }
  revision++;
  segmenter.reset();
  cameraInput.reset();
  if (resetActivity) cameraInput.activity.reset();
  frames = [];
  state.tips = [];
  state.hands = [];
  state.excludedHands = [];
  state.trails.clear();
  state.active = null;
  state.activityTip = null;
  $("active-tip").dataset.tipId = "";
  $("active-tip").textContent = "Активный палец не выбран · окно 5 с";
  tapStrings = { ru: "", en: "" };
  clearTimeout(tapTimer);
  pointerPath = null;
  tapTimer = null;
  draw();
}
function stop(silent = false) {
  layoutHold.reset();
  state.layoutControl = null;
  $("layout-toggle").classList.remove("holding");
  cameraGeneration++;
  starting = false;
  cancelAnimationFrame(demoFrame);
  cancelAnimationFrame(cameraFrame);
  demoFrame = 0;
  if (cameraWorker) cameraWorker.terminate();
  cameraWorker = null;
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = null;
  $("video").srcObject = null;
  $("video").hidden = true;
  busy = false;
  calibration.cancel();
  depthGate.reset();
  if (
    !silent &&
    state.source === "camera" &&
    cameraInput.entryMode === "swipe"
  ) {
    cameraInput.resumeControl(performance.now());
    if (!cameraInput.detached) cameraInput.finish("Камера остановлена.");
    renderCandidates(cameraInput.results);
  } else resetGesture();
  state.source = "pointer";
  demoText = "";
  updateWordCount();
  $("source-badge").textContent = "Без камеры";
  $("camera").disabled = false;
  $("demo").disabled = false;
  $("stop").disabled = true;
  $("stage-hint").hidden = false;
  $("tracking").textContent = "Ожидание";
  $("finger-count").textContent = "0 / 10";
  $("tracker-ms").textContent = "—";
  $("depth-status").textContent =
    "Отсечение работает в режиме камеры и демо глубины. Мышь и обычное демо не измеряют расстояние.";
  if (!silent)
    status("Остановлено. Текст сохранён. Можно рисовать траектории мышью.");
  draw();
}
async function startCamera() {
  stop(true);
  const generation = cameraGeneration;
  starting = true;
  $("camera").disabled = true;
  $("demo").disabled = true;
  $("stop").disabled = false;
  status("Ожидание разрешения и видеопотока камеры…");
  try {
    if (!navigator.mediaDevices?.getUserMedia)
      throw new Error(
        "Камера требует localhost или HTTPS и современный браузер",
      );
    const media = await acquireCameraStream(
      () =>
        navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 960 },
            height: { ideal: 540 },
            facingMode: "user",
          },
          audio: false,
        }),
      () => generation === cameraGeneration,
    );
    if (generation !== cameraGeneration) {
      media.getTracks().forEach((t) => t.stop());
      return;
    }
    stream = media;
    $("video").srcObject = media;
    $("video").hidden = false;
    state.source = "camera";
    $("stage-hint").hidden = true;
    $("source-badge").textContent = "Камера · подготовка";
    draw();
    status("Камера подключена. Ожидание первого видеокадра…");
    await waitForVideoFrame($("video"));
    if (generation !== cameraGeneration) return;
    status(
      `Видеокадр ${$("video").videoWidth}×${$("video").videoHeight} получен. Загрузка локального трекера…`,
    );
    cameraWorker = new Worker("/tracking.worker.js");
    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Трекер не загрузился за 20 секунд")),
        20000,
      );
      cameraWorker.onerror = (e) => {
        clearTimeout(timer);
        reject(new Error(e.message));
      };
      cameraWorker.onmessage = ({ data }) => {
        if (data.type === "ready") {
          clearTimeout(timer);
          resolve();
        } else if (data.type === "error") {
          clearTimeout(timer);
          reject(new Error(data.message));
        }
      };
      cameraWorker.postMessage({ type: "init" });
    });
    if (generation !== cameraGeneration) return;
    starting = false;
    state.source = "camera";
    $("video").hidden = false;
    $("source-badge").textContent = "Живая камера";
    $("stage-hint").hidden = true;
    lastFrame = performance.now();
    lastVideoTime = -1;
    cameraWorker.onerror = (e) => {
      stop(true);
      status(
        `Ошибка потока камеры: ${e.message}. Можно продолжить мышью.`,
        true,
      );
    };
    cameraWorker.onmessage = ({ data }) => {
      busy = false;
      if (data.type === "error") {
        stop(true);
        status(`Ошибка камеры: ${data.message}`, true);
        return;
      }
      if (data.type !== "result") return;
      lastFrame = performance.now();
      $("tracker-ms").textContent = `${data.inferenceMs.toFixed(1)} мс`;
      const hands = data.result.landmarks.map((hand) =>
        hand.map((p) => ({ x: 1 - p.x, y: p.y, z: p.z })),
      );
      processTrackedHands(
        hands,
        data.time,
        $("video").videoHeight / $("video").videoWidth,
      );
    };
    for (const track of stream.getVideoTracks())
      track.onended = () => {
        stop(true);
        status("Камера отключена. Текст сохранён; доступна мышь.", true);
      };
    status(
      "Живая камера. Для рабочей глубины покажите ладонь и нажмите «Принять текущую глубину за 1×»; затем пройдите мастер нажатий букв.",
    );
    const loop = async () => {
      if (state.source !== "camera") return;
      const now = performance.now();
      if (now - lastFrame > 400) {
        if (state.calibrating)
          calibration.update(
            [],
            now,
            "Пауза: нет свежих кадров трекера. Текущий шаг сохранён.",
          );
        else if (state.tips.length) {
          cameraInput.step({
            tips: [],
            observed: [],
            time: now,
            layout: state.lang,
            calibrated: state.calibrated,
          });
          presentCamera({ tips: [], hands: [], activityTips: [] });
        }
        if (now - lastFrame > 10000) {
          stop(true);
          status(
            "Нет кадров от трекера 10 секунд. Перезапустите камеру.",
            true,
          );
          return;
        }
      }
      if (
        !busy &&
        $("video").readyState >= 2 &&
        $("video").currentTime !== lastVideoTime
      ) {
        busy = true;
        lastVideoTime = $("video").currentTime;
        try {
          const bitmap = await createImageBitmap($("video"));
          if (state.source !== "camera") {
            bitmap.close();
            return;
          }
          cameraWorker.postMessage({ type: "frame", bitmap, time: now }, [
            bitmap,
          ]);
        } catch (e) {
          stop(true);
          status(`Не удалось обработать кадр: ${e.message}`, true);
          return;
        }
      }
      cameraFrame = requestAnimationFrame(loop);
    };
    cameraFrame = requestAnimationFrame(loop);
  } catch (e) {
    if (generation !== cameraGeneration) return;
    stop(true);
    const reason =
      {
        NotAllowedError:
          "Доступ к камере запрещён. Разрешите его в настройках браузера.",
        NotFoundError: "Камера не найдена.",
        NotReadableError: "Камера занята другим приложением.",
      }[e.name] || e.message;
    status(`${reason} Доступны демонстрация и мышь.`, true);
  }
}
function startDemo() {
  stop(true);
  state.source = "demo";
  $("source-badge").textContent = "Демо · синтетика";
  $("stage-hint").hidden = true;
  $("stop").disabled = false;
  $("tracker-ms").textContent = "Не измеряется";
  status(
    "Демо показывает слово в выбранной раскладке. Это проверка конвейера, не качества камеры.",
  );
  const words = state.lang === "ru" ? [["привет", "ru"]] : [["hello", "en"]];
  const start = performance.now();
  let previous = -1;
  const loop = (now) => {
    if (state.source !== "demo") return;
    const elapsed = now - start,
      index = Math.floor(elapsed / 3200);
    if (index >= words.length) {
      demoFrame = 0;
      status(
        "Демонстрация завершена. Выберите кандидат или нарисуйте своё слово мышью.",
      );
      return;
    }
    if (index !== previous) {
      resetGesture();
      previous = index;
    }
    const path = resample(wordPath(...words[index]), 90),
      progress = Math.min(89, Math.floor((elapsed % 3200) / 22)),
      p = path[progress];
    const tips = Array.from({ length: 10 }, (_, i) => ({
      id: `${i < 5 ? "Left" : "Right"}-${i % 5}`,
      x: 0.14 + (i % 5) * 0.09 + (i >= 5 ? 0.32 : 0),
      y: 0.91,
      z: -0.05,
    }));
    tips[1] = { ...p, id: "Left-1", z: -0.04 };
    ingest(tips, now);
    demoFrame = requestAnimationFrame(loop);
  };
  demoFrame = requestAnimationFrame(loop);
}
function startDepthDemo() {
  stop(true);
  state.source = "demo";
  $("source-badge").textContent = "Демо глубины · синтетика";
  $("stage-hint").hidden = true;
  $("stop").disabled = false;
  $("tracker-ms").textContent = "Не измеряется";
  lastClip = null;
  $("last-clip").textContent =
    "Демо глубины: синтетические точки не записываются.";
  status(
    "Демо: ближняя рука движется, затем выходит за дальнюю границу. Дальняя рука исключена сразу. Это искусственные координаты, не камера.",
  );
  const start = performance.now();
  const loop = (now) => {
    if (state.source !== "demo") return;
    const elapsed = now - start;
    processTrackedHands(
      depthDemoHands(elapsed, 0.5625, depthGate.reference, depthGate.limit),
      now,
      0.5625,
    );
    if (elapsed < 4500) demoFrame = requestAnimationFrame(loop);
    else {
      demoFrame = 0;
      status(
        "Демо глубины завершено: обе руки дальше границы. Неполное слово не вставлено.",
      );
    }
  };
  demoFrame = requestAnimationFrame(loop);
}
function canvasPoint(e) {
  const r = $("overlay").getBoundingClientRect();
  return {
    x: (e.clientX - r.left) / r.width,
    y: (e.clientY - r.top) / r.height,
  };
}
$("overlay").onpointerdown = (e) => {
  if (state.calibrating) {
    calibration.pointer(canvasPoint(e), performance.now());
    return;
  }
  if (state.source === "camera" || starting) return;
  if (state.source === "demo") stop(true);
  $("stage-hint").hidden = true;
  resetGesture();
  const p = canvasPoint(e),
    q = project(state.displayInverse, p.x, p.y);
  if (!nearestKey(q, state.lang)) return;
  pointerPath = [{ ...q, z: 0, t: performance.now() }];
  pointerPreviewSession++;
  pointerPreviewFinished = false;
  previewPath(
    pointerPath,
    "pointer",
    pointerPreviewSession,
    pointerPath.length,
  );
  $("overlay").setPointerCapture(e.pointerId);
  state.tips = [{ ...q, z: 0, id: "Pointer-1" }];
  state.trails.set("Pointer-1", [q]);
  draw();
};
$("overlay").onpointermove = (e) => {
  if (!pointerPath) return;
  const p = canvasPoint(e),
    q = project(state.displayInverse, p.x, p.y);
  if (q.x < 0 || q.x > 1 || q.y < 0 || q.y > 1) return;
  if (pointerPath.length >= 2048) {
    pointerPath = null;
    status("Слишком длинная траектория.", true);
    return;
  }
  pointerPath.push({ ...q, z: 0, t: performance.now() });
  previewPath(
    pointerPath,
    "pointer",
    pointerPreviewSession,
    pointerPath.length,
  );
  state.tips = [{ ...q, z: 0, id: "Pointer-1" }];
  state.trails.set("Pointer-1", pointerPath.slice(-64));
  state.active = "Pointer-1";
  draw();
  if (performance.now() - lastDecode > 150) {
    lastDecode = performance.now();
    void decode(pointerPath);
  }
};
$("overlay").onpointerup = () => {
  if (!pointerPath) return;
  const path = pointerPath;
  pointerPath = null;
  pointerPreviewFinished = true;
  const length = path.reduce(
    (sum, p, i) =>
      sum + (i ? Math.hypot(p.x - path[i - 1].x, p.y - path[i - 1].y) : 0),
    0,
  );
  if (path.length > 2 && length > 0.06) {
    clearTimeout(tapTimer);
    tapStrings = { ru: "", en: "" };
    remember(path, "pointer");
    void decode(path, true);
    $("gesture").textContent = "Скольжение мышью";
  } else addTaps([path[0]]);
  state.active = null;
};
$("overlay").onpointercancel = () => {
  pointerPath = null;
  resetGesture();
  status("Движение отменено.");
};
$("camera").onclick = startCamera;
$("demo").onclick = startDemo;
$("stop").onclick = () => stop();
$("depth-demo").onclick = startDepthDemo;
$("depth-limit").oninput = () => {
  depthGate.configure({ limit: Number($("depth-limit").value) });
  invalidateDepthInput();
  updateDepthControls();
  store("camkeys-depth", {
    reference: depthGate.reference,
    limit: depthGate.limit,
    calibrated: depthCalibrated,
  });
  status(
    "Дальняя граница изменена. Начните новое движение внутри рабочей зоны.",
  );
};
$("depth-calibrate").onclick = () => {
  try {
    if (state.source !== "camera")
      throw new Error(
        "Калибровка глубины требует живой камеры. Демо не заменяет вашу ладонь.",
      );
    depthGate.calibrate(performance.now());
    depthCalibrated = true;
    invalidateDepthInput();
    updateDepthControls();
    store("camkeys-depth", {
      reference: depthGate.reference,
      limit: depthGate.limit,
      calibrated: true,
    });
    status(
      depthGate.limit < 1.06
        ? `Ладонь принята за 1×, но граница ${depthGate.limit.toFixed(2)}× не допускает это положение. Увеличьте дальнюю границу выше 1.06×.`
        : "Ближайшая устойчивая ладонь принята за 1×. Дальняя граница задаётся ползунком.",
    );
  } catch (e) {
    status(e.message, true);
  }
};
$("depth-reset").onclick = () => {
  depthGate.configure({ reference: 0.16, limit: 1.35 });
  depthCalibrated = false;
  invalidateDepthInput();
  updateDepthControls();
  store("camkeys-depth", { reference: 0.16, limit: 1.35, calibrated: false });
  status(
    "Начальная оценка глубины восстановлена. Для точной рабочей зоны повторите калибровку ладони.",
  );
};
$("calibrate").onclick = () => {
  if (starting) {
    status("Дождитесь готовности камеры перед запуском мастера.", true);
    return;
  }
  if (state.calibrating) {
    calibration.cancel("Калибровка отменена. Прежняя геометрия сохранена.");
    return;
  }
  if (state.source === "demo") stop(true);
  calibration.start();
};
$("reset-calibration").onclick = () => {
  state.corners = defaults;
  state.inverse = homography(defaults, unit);
  calibration.cancel();
  store("camkeys-corners", defaults);
  state.calibrated = false;
  state.calibrationVerified = false;
  store("camkeys-calibrated", false);
  renderCalibrationStatus();
  resetGesture();
  status("Стандартная плоскость восстановлена.");
};
$("layout-toggle").onclick = () =>
  changeLayout(state.lang === "ru" ? "en" : "ru");
$("text").oninput = textChanged;
$("toggle-camera-text").onclick = () => {
  overlayVisible = !overlayVisible;
  store("camkeys-text-visible", overlayVisible);
  updateWordCount();
};
$("clear-text").onclick = () => {
  if (state.source === "demo") stop(true);
  if ($("text").value) {
    undo.push($("text").value);
    if (undo.length > 50) undo.shift();
  }
  $("text").value = "";
  demoText = "";
  resetGesture(false);
  renderCandidates([]);
  textChanged();
  status(
    "Текст очищен. «Отменить вставку» вернёт его. Примеры, веса и калибровка сохранены.",
  );
};
$("space").onclick = () => {
  if (state.source === "camera") {
    cameraInput.confirm();
    presentCamera();
    return;
  }
  if (tapTimer) {
    finishTaps();
    return;
  }
  if (candidates[0]) commit(candidates[0].word, candidates[0].lang);
  else {
    undo.push($("text").value);
    $("text").value += " ";
    textChanged();
  }
};
$("undo").onclick = () => {
  if (undo.length) {
    $("text").value = undo.pop();
    textChanged();
  }
};
$("copy").onclick = async () => {
  try {
    await navigator.clipboard.writeText($("text").value);
    status("Текст скопирован.");
  } catch (e) {
    status(
      `Копирование недоступно: ${e.message}. Выделите текст вручную.`,
      true,
    );
  }
};
$("record").onclick = () => {
  try {
    if (!lastClip || lastClip.source === "demo")
      throw new Error(
        "Сначала нарисуйте слово мышью или камерой. Синтетическое демо не записывается.",
      );
    const word = $("label-word").value.trim().toLowerCase(),
      lang = state.lang;
    const clip = validateDataset({
      version: 1,
      clips: [{ ...lastClip, word, lang }],
    })[0];
    if (clips.length >= 500)
      throw new Error("Лимит 500 записей. Экспортируйте и удалите набор.");
    clips.push(clip);
    lastClip = null;
    store("camkeys-clips", { version: 1, clips });
    updateSamples();
    $("last-clip").textContent = `Сохранено: ${word}. Нарисуйте новый повтор.`;
    status("Запись сохранена с правильным словом.");
  } catch (e) {
    status(e.message, true);
  }
};
$("train").onclick = async () => {
  if (training) return;
  training = true;
  $("train").disabled = true;
  try {
    const { metrics, model } = await call("train", clips);
    networkReady = true;
    const saved = store("camkeys-network", model);
    $("network-status").textContent =
      `Conv1D: ${metrics.parameters} параметров. Обучение: ${metrics.trainCount}; отложено: ${metrics.holdoutCount}, точность ${(metrics.holdoutAccuracy * 100).toFixed(0)}%. Малый персональный набор, не оценка общего качества.${saved ? " Веса сохранены." : " Веса только в памяти вкладки."}`;
    status("Сеть обучена. Проверьте её на новых движениях.");
  } catch (e) {
    $("network-status").textContent = `Обучение не завершено: ${e.message}`;
    status(e.message, true);
  } finally {
    training = false;
    $("train").disabled = false;
  }
};
$("export").onclick = () => {
  const blob = new Blob([JSON.stringify({ version: 1, clips }, null, 2)], {
      type: "application/json",
    }),
    url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = "camkeys-trajectories.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  status("Экспортированы траектории и метки, без видео.");
};
$("import").onchange = async (e) => {
  try {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) throw new Error("Файл больше 10 МБ");
    const incoming = validateDataset(JSON.parse(await file.text()));
    if (clips.length + incoming.length > 500)
      throw new Error("После импорта больше 500 записей");
    clips.push(...incoming);
    store("camkeys-clips", { version: 1, clips });
    updateSamples();
    status(
      `Импортировано ${incoming.length} записей. Переобучите сеть для их использования.`,
    );
  } catch (error) {
    status(`Импорт: ${error.message}`, true);
  } finally {
    e.target.value = "";
  }
};
$("clear-learning").onclick = async () => {
  if (training) {
    status("Дождитесь окончания обучения.", true);
    return;
  }
  try {
    await call("clear");
    clips = [];
    networkReady = false;
    localStorage.removeItem("camkeys-clips");
    localStorage.removeItem("camkeys-network");
    updateSamples();
    $("network-status").textContent =
      "Записи и сеть удалены. Работает геометрия.";
  } catch (e) {
    status(`Удаление: ${e.message}`, true);
  }
};
window.addEventListener("pagehide", () => {
  stop(true);
  learningWorker.terminate();
});
window.addEventListener("storage", (event) => {
  if (event.key !== "camkeys-text") return;
  try {
    const text = event.newValue === null ? "" : JSON.parse(event.newValue);
    if (typeof text !== "string") throw new Error("Ожидалась строка");
    if (text === $("text").value) return;
    $("text").value = text;
    demoText = "";
    resetGesture(false);
    renderCandidates([]);
    updateWordCount();
  } catch (error) {
    status(
      `Не удалось синхронизировать текст другой вкладки: ${error.message}`,
      true,
    );
  }
});
async function restore() {
  try {
    const layout = read("camkeys-layout");
    if (["ru", "en"].includes(layout)) state.lang = layout;
    renderLayout();
    const stored = read("camkeys-clips");
    if (stored) clips = validateDataset(stored);
    const depth = read("camkeys-depth");
    if (depth) {
      depthGate.configure(depth);
      depthCalibrated = depth.calibrated === true;
    }
    updateDepthControls();
    const corners = read("camkeys-corners");
    if (corners) {
      state.inverse = homography(corners, unit);
      state.corners = corners;
      state.calibrated = read("camkeys-calibrated") !== false;
      state.calibrationVerified = read("camkeys-calibrated") === true;
    }
    renderCalibrationStatus();
    const text = read("camkeys-text");
    if (typeof text === "string") $("text").value = text;
    const url = new URL(location.href);
    if (url.searchParams.get("cleanupSample") === SAMPLE_CLEANUP_REQUEST) {
      const before = $("text").value,
        after = removeKnownSample(before);
      if (after !== before) {
        if (
          !store("camkeys-sample-cleanup-backup", before) ||
          !store("camkeys-text", after)
        )
          throw new Error(
            "Адресное удаление образца не сохранено; исходный текст оставлен.",
          );
        $("text").value = after;
        status(
          "Подтверждённый чужой образец «привет мир» удалён. Остальной текст и данные сохранены; исходная строка сохранена отдельно.",
        );
      }
      url.searchParams.delete("cleanupSample");
      history.replaceState(null, "", url);
    }
    overlayVisible = read("camkeys-text-visible") !== false;
    updateWordCount();
    updateSamples();
    draw();
    const model = read("camkeys-network");
    if (model) {
      await call("restore", model);
      networkReady = true;
      $("network-status").textContent =
        "Персональная Conv1D восстановлена с этого устройства. Проверяйте кандидатов на новых движениях.";
    }
  } catch (e) {
    status(
      `Восстановление: ${e.message}. Используйте геометрию или удалите повреждённые записи.`,
      true,
    );
  }
}
draw();
initializeDictionary();
mountTelemetry(() => ({
  source: state.source,
  layout: state.lang,
  calibrated: state.calibrated,
  inverse: state.inverse,
  displayInverse: state.displayInverse,
  depthReference: depthGate.reference,
  depthLimit: depthGate.limit,
  calibrationMs: calibration.dwell.duration,
  inputMs: cameraInput.hold.duration,
  videoWidth: $("video").videoWidth,
  videoHeight: $("video").videoHeight,
}));
void restore();
setInterval(() => {
  const now = performance.now();
  if (cameraInput.tick(now, $("auto-camera-insert").checked)) {
    telemetry.record("auto-insert", { delayMs: 1500 });
    if (state.source === "camera") presentCamera();
  } else if (currentCameraWord()) renderFlickState(now);
}, 50);
