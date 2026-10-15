export const layouts = {
  ru: ["ёйцукенгшщзхъ", "фывапролджэ", "ячсмитьбю"],
  en: ["qwertyuiop", "asdfghjkl", "zxcvbnm"],
};
const offsets = { ru: [0, 0.6, 1.3], en: [1, 0.6, 1.3] };
export function keys(lang) {
  if (!layouts[lang]) throw new Error("Неизвестная раскладка");
  return layouts[lang].flatMap((row, r) =>
    [...row].map((letter, c) => ({
      letter,
      x: (c + offsets[lang][r] + 0.5) / 13,
      y: (r + 0.5) / 3,
      row: r,
    })),
  );
}
export function nearestKey(p, lang) {
  if (p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1) return null;
  return keys(lang).reduce((a, b) =>
    Math.hypot(p.x - a.x, p.y - a.y) < Math.hypot(p.x - b.x, p.y - b.y) ? a : b,
  );
}
export function wordPath(word, lang) {
  const map = new Map(keys(lang).map((k) => [k.letter, k]));
  return [...word.toLowerCase()].map((c) => {
    if (!map.has(c)) throw new Error("Слово содержит символ вне раскладки");
    return { ...map.get(c), z: 0 };
  });
}
function solve(matrix) {
  const n = matrix.length;
  for (let c = 0; c < n; c++) {
    let pivot = c;
    for (let r = c + 1; r < n; r++)
      if (Math.abs(matrix[r][c]) > Math.abs(matrix[pivot][c])) pivot = r;
    [matrix[c], matrix[pivot]] = [matrix[pivot], matrix[c]];
    if (Math.abs(matrix[c][c]) < 1e-10)
      throw new Error("Калибровка вырождена: выберите четыре разных угла");
    const d = matrix[c][c];
    matrix[c] = matrix[c].map((v) => v / d);
    for (let r = 0; r < n; r++)
      if (r !== c) {
        const f = matrix[r][c];
        matrix[r] = matrix[r].map((v, i) => v - f * matrix[c][i]);
      }
  }
  return matrix.map((row) => row[n]);
}
export function homography(from, to) {
  if (from.length !== 4 || to.length !== 4)
    throw new Error("Нужны четыре угла");
  // A homography must be invertible, even when a linear solve finds a zero map.
  for (const quad of [from, to]) {
    if (quad.flat().some((v) => !Number.isFinite(v)))
      throw new Error("Некорректные углы");
    const turns = quad.map((p, i) => {
      const q = quad[(i + 1) % 4],
        r = quad[(i + 2) % 4];
      return (q[0] - p[0]) * (r[1] - q[1]) - (q[1] - p[1]) * (r[0] - q[0]);
    });
    if (!turns.every((v) => v > 1e-5) && !turns.every((v) => v < -1e-5))
      throw new Error(
        "Углы должны образовывать выпуклый четырёхугольник по порядку",
      );
  }
  const rows = [];
  from.forEach(([x, y], i) => {
    const [u, v] = to[i];
    rows.push(
      [x, y, 1, 0, 0, 0, -u * x, -u * y, u],
      [0, 0, 0, x, y, 1, -v * x, -v * y, v],
    );
  });
  return [...solve(rows), 1];
}
export function project(h, x, y) {
  const d = h[6] * x + h[7] * y + h[8];
  if (Math.abs(d) < 1e-10) throw new Error("Точка вне проекции");
  return {
    x: (h[0] * x + h[1] * y + h[2]) / d,
    y: (h[3] * x + h[4] * y + h[5]) / d,
  };
}
export function resample(points, count = 32) {
  if (!points.length || count < 2) throw new Error("Пустая траектория");
  const distances = [0];
  for (let i = 1; i < points.length; i++)
    distances.push(
      distances[i - 1] +
        Math.hypot(
          points[i].x - points[i - 1].x,
          points[i].y - points[i - 1].y,
        ),
    );
  const total = distances.at(-1);
  if (total < 1e-8)
    return Array.from({ length: count }, () => ({ ...points[0] }));
  let j = 1;
  return Array.from({ length: count }, (_, i) => {
    const target = (total * i) / (count - 1);
    while (j < distances.length - 1 && distances[j] < target) j++;
    const a = points[j - 1],
      b = points[j],
      span = distances[j] - distances[j - 1],
      t = span > 0 ? (target - distances[j - 1]) / span : 0;
    return {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      z: (a.z || 0) + ((b.z || 0) - (a.z || 0)) * t,
    };
  });
}
export const vocabulary = {
  ru: "привет мир приветствие камера клавиатура слово текст рука палец движение работа работает спасибо пожалуйста да нет хорошо доброе утро добрый день вечер как дела меня зовут это тест проект хочу писать читаю книга дом время сегодня завтра сейчас открыть закрыть сохранить помощь обучение русский язык новый мы вы они он она приветик".split(
    " ",
  ),
  en: "hello world camera keyboard word text hand finger motion work works thanks please yes no good morning day evening how are you my name is this test project want write read book home time today tomorrow now open close save help learning english language new we they he she".split(
    " ",
  ),
};
const contexts = {
  доброе: ["утро"],
  добрый: ["день", "вечер"],
  как: ["дела"],
  привет: ["мир"],
  hello: ["world"],
  good: ["morning", "day", "evening"],
  how: ["are"],
  are: ["you"],
  my: ["name"],
  name: ["is"],
};
const templateCache = new Map();
export function rankWords(
  path,
  context = "",
  languages = ["ru", "en"],
  extra = [],
  tapStrings = null,
) {
  if (path.length < 2 && !tapStrings) return [];
  const input = path.length ? resample(path, 32) : [];
  const previous = context.trim().toLowerCase().split(/\s+/).at(-1);
  const candidates = [];
  for (const lang of languages) {
    const words = new Set([
      ...vocabulary[lang],
      ...extra.filter((c) => c.lang === lang).map((c) => c.word),
    ]);
    for (const word of words) {
      let error;
      if (tapStrings) {
        const raw = tapStrings[lang] || "";
        error = editDistance(raw, word) / Math.max(raw.length, word.length, 1);
      } else {
        const cacheKey = lang + ":" + word;
        if (!templateCache.has(cacheKey))
          templateCache.set(cacheKey, resample(wordPath(word, lang), 32));
        const templates = [
          templateCache.get(cacheKey),
          ...extra
            .filter(
              (c) => c.lang === lang && c.word === word && c.path?.length > 1,
            )
            .map((c) => resample(c.path, 32)),
        ];
        // The endpoint term is a lower bound on the full score. Skip only
        // candidates that cannot enter the top five; no vocabulary shortlist.
        const bound = Math.min(
          ...templates.map(
            (t) =>
              (Math.hypot(input[0].x - t[0].x, input[0].y - t[0].y) +
                Math.hypot(
                  input.at(-1).x - t.at(-1).x,
                  input.at(-1).y - t.at(-1).y,
                )) *
              0.15,
          ),
        );
        if (
          candidates.length >= 5 &&
          bound - (contexts[previous]?.includes(word) ? 0.025 : 0) >
            candidates.at(-1).score
        )
          continue;
        error = Math.min(
          ...templates.map((points) => trajectoryError(input, points)),
        );
      }
      const score = error - (contexts[previous]?.includes(word) ? 0.025 : 0);
      candidates.push({
        word,
        lang,
        error,
        score,
        method: tapStrings ? "Нажатия + словарь" : "Геометрия + словарь",
      });
      candidates.sort((a, b) => a.score - b.score);
      if (candidates.length > 5) candidates.length = 5;
    }
    if (tapStrings?.[lang] && !words.has(tapStrings[lang]))
      candidates.push({
        word: tapStrings[lang],
        lang,
        error: 0.12,
        score: 0.12,
        method: "Буквы нажатий",
      });
  }
  return candidates.sort((a, b) => a.score - b.score).slice(0, 5);
}
function trajectoryError(input, template) {
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  let previous = Array(33).fill(Infinity);
  previous[0] = 0;
  for (let i = 1; i <= 32; i++) {
    const row = Array(33).fill(Infinity);
    for (let j = Math.max(1, i - 6); j <= Math.min(32, i + 6); j++)
      row[j] =
        dist(input[i - 1], template[j - 1]) +
        Math.min(previous[j], row[j - 1], previous[j - 1]);
    previous = row;
  }
  const length = (points) =>
    points.slice(1).reduce((s, p, i) => s + dist(p, points[i]), 0);
  const endpoints =
    (dist(input[0], template[0]) + dist(input.at(-1), template.at(-1))) / 2;
  const ratio = Math.abs(
    Math.log((length(input) + 0.02) / (length(template) + 0.02)),
  );
  return (
    (previous[32] / 32) * 0.65 + endpoints * 0.3 + Math.min(ratio, 3) * 0.025
  );
}

// Raw boundary trimming and the admitted smoothed trajectory are independent
// views of the same gesture. Trimming must not erase its final intended stroke.
export function rankToken(token, context = "", extra = []) {
  const taps = token.letters ? { [token.layout]: token.letters } : null;
  const paths = [token.path];
  if (!taps && token.alternatePath?.length > 1) paths.push(token.alternatePath);
  const words = new Map();
  for (const path of paths) {
    for (const result of rankWords(
      path,
      context,
      [token.layout],
      extra,
      taps,
    )) {
      const previous = words.get(result.word);
      if (!previous || result.score < previous.score)
        words.set(result.word, result);
    }
  }
  const results = [...words.values()];
  if (token.alternatePath?.length > 1 && !taps) {
    const end = token.alternatePath.at(-1);
    for (const result of results) {
      const target = wordPath(result.word, token.layout).at(-1);
      const ending =
        0.15 * Math.min(0.3, Math.hypot(end.x - target.x, end.y - target.y));
      result.error += ending;
      result.score += ending;
    }
  }
  return results.sort((a, b) => a.score - b.score).slice(0, 5);
}
function editDistance(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++)
      row[j] = Math.min(
        row[j - 1] + 1,
        prev[j] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    prev = row;
  }
  return prev[b.length];
}

export class Segmenter {
  constructor() {
    this.reset();
  }
  reset() {
    this.path = [];
    this.active = null;
    this.previous = new Map();
    this.origins = new Map();
    this.lastMotion = 0;
    this.tapStates = new Map();
  }
  update(tips, time, tapThreshold = 0.07, preferredId = undefined) {
    const visible = tips.filter(
      (p) => p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1,
    );
    if (
      !visible.length ||
      (this.active && !visible.some((p) => p.id === this.active))
    ) {
      this.reset();
      return { type: "lost", taps: [] };
    }
    const taps = [];
    for (const p of visible) {
      let state = this.tapStates.get(p.id);
      if (!state) state = { base: p.z, down: false, last: -Infinity, start: 0 };
      // Relative depth is an experimental flexion proxy, not physical contact.
      if (
        !state.down &&
        p.z < state.base - tapThreshold &&
        time - state.last > 350
      ) {
        state.down = true;
        state.start = time;
      } else if (state.down && p.z > state.base - tapThreshold * 0.3) {
        if (time - state.start < 700) {
          taps.push(p);
          state.last = time;
        }
        state.down = false;
      }
      if (state.down && time - state.start > 700) state.down = false;
      if (!state.down) state.base = state.base * 0.98 + p.z * 0.02;
      this.tapStates.set(p.id, state);
    }
    if (
      preferredId !== undefined &&
      this.active &&
      this.active !== preferredId
    ) {
      this.path = [];
      this.active = null;
      this.origins = new Map(visible.map((p) => [p.id, { ...p, t: time }]));
    }
    if (!this.active) {
      let best = null,
        delta = 0.018;
      for (const p of visible) {
        if (!this.origins.has(p.id)) this.origins.set(p.id, { ...p, t: time });
        if (preferredId !== undefined && p.id !== preferredId) continue;
        const q = this.origins.get(p.id);
        const d = Math.hypot(p.x - q.x, p.y - q.y);
        if (d > delta) {
          best = p;
          delta = d;
        }
      }
      if (best) {
        this.active = best.id;
        this.path = [{ ...this.origins.get(best.id) }, { ...best, t: time }];
        this.lastMotion = time;
      }
    } else {
      const p = visible.find((p) => p.id === this.active),
        last = this.path.at(-1);
      if (Math.hypot(p.x - last.x, p.y - last.y) > 0.008) {
        this.path.push({ ...p, t: time });
        this.lastMotion = time;
      }
      if (this.path.length > 2048) {
        this.reset();
        return { type: "overflow", taps: [] };
      }
      if (time - this.lastMotion > 700) {
        const path = this.path;
        this.path = [];
        this.active = null;
        this.previous = new Map(visible.map((p) => [p.id, p]));
        this.origins = new Map(visible.map((p) => [p.id, { ...p, t: time }]));
        return {
          type: "swipe",
          path,
          taps:
            preferredId === undefined
              ? taps
              : taps.filter((p) => p.id === preferredId),
        };
      }
    }
    this.previous = new Map(visible.map((p) => [p.id, p]));
    for (const id of this.tapStates.keys())
      if (!this.previous.has(id)) this.tapStates.delete(id);
    for (const id of this.origins.keys())
      if (!this.previous.has(id)) this.origins.delete(id);
    return {
      type: this.active ? "moving" : "idle",
      taps:
        preferredId === undefined
          ? taps
          : taps.filter((p) => p.id === preferredId),
    };
  }
}
export function validateDataset(data) {
  if (
    data?.version !== 1 ||
    !Array.isArray(data.clips) ||
    data.clips.length > 500
  )
    throw new Error("Ожидается Camkeys JSON v1, до 500 записей");
  return data.clips.map((c) => {
    if (
      !c ||
      !["ru", "en"].includes(c.lang) ||
      !["camera", "pointer"].includes(c.source) ||
      typeof c.word !== "string" ||
      c.word.length < 2 ||
      c.word.length > 32 ||
      !Array.isArray(c.path) ||
      c.path.length < 2 ||
      c.path.length > 2048
    )
      throw new Error("Некорректная запись: слово, источник или траектория");
    wordPath(c.word, c.lang);
    const path = c.path.map((p) => {
      if (
        !Number.isFinite(p.x) ||
        !Number.isFinite(p.y) ||
        p.x < 0 ||
        p.x > 1 ||
        p.y < 0 ||
        p.y > 1 ||
        (p.z !== undefined && !Number.isFinite(p.z))
      )
        throw new Error("Некорректные координаты");
      return { x: p.x, y: p.y, z: p.z || 0, t: Number.isFinite(p.t) ? p.t : 0 };
    });
    if (!Array.isArray(c.frames) || c.frames.length > 2048)
      throw new Error("Некорректные кадры");
    const frames = c.frames.map((f) => {
      if (!Number.isFinite(f.t) || !Array.isArray(f.tips) || f.tips.length > 10)
        throw new Error("Некорректный кадр");
      return {
        t: f.t,
        tips: f.tips.map((p) => {
          if (
            typeof p.id !== "string" ||
            p.id.length > 32 ||
            ![p.x, p.y, p.z].every(Number.isFinite)
          )
            throw new Error("Некорректный палец");
          return { id: p.id, x: p.x, y: p.y, z: p.z };
        }),
      };
    });
    return {
      word: c.word.toLowerCase(),
      lang: c.lang,
      source: c.source,
      path,
      frames,
    };
  });
}
