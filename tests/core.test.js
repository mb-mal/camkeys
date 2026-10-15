import test from "node:test";
import assert from "node:assert/strict";
import {
  homography,
  project,
  wordPath,
  rankWords,
  resample,
  Segmenter,
  validateDataset,
  keys,
} from "../src/core.js";

test("perspective calibration maps corners and round trips", () => {
  const a = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ],
    b = [
      [0.1, 0.2],
      [0.9, 0.1],
      [0.8, 0.9],
      [0.2, 0.8],
    ];
  const h = homography(a, b),
    inv = homography(b, a);
  for (let i = 0; i < 4; i++) {
    const p = project(h, ...a[i]);
    assert.ok(Math.hypot(p.x - b[i][0], p.y - b[i][1]) < 1e-8);
  }
  const p = project(h, 0.3, 0.6),
    q = project(inv, p.x, p.y);
  assert.ok(Math.hypot(q.x - 0.3, q.y - 0.6) < 1e-8);
  assert.throws(() =>
    homography(a, [
      [0, 0],
      [0, 0],
      [0, 0],
      [0, 0],
    ]),
  );
});
test("word trajectories select RU and EN automatically", () => {
  for (const [word, lang] of [
    ["привет", "ru"],
    ["hello", "en"],
  ]) {
    const result = rankWords(resample(wordPath(word, lang), 64), "", [
      "ru",
      "en",
    ]);
    assert.equal(result[0].word, word);
    assert.equal(result[0].lang, lang);
  }
  assert.equal(keys("ru").length, 33);
});
test("resampling preserves endpoints and handles duplicate points", () => {
  const p = resample(
    [
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ],
    32,
  );
  assert.equal(p.length, 32);
  assert.equal(p[0].x, 0);
  assert.equal(p.at(-1).y, 1);
  assert.throws(() => resample([], 32));
});
test("tracking loss discards partial gesture and emits no word", () => {
  const s = new Segmenter();
  s.update([{ id: "a", x: 0.1, y: 0.2, z: 0 }], 0);
  s.update([{ id: "a", x: 0.4, y: 0.2, z: 0 }], 100);
  assert.equal(s.update([], 200).type, "lost");
  assert.equal(s.path.length, 0);
  assert.equal(
    s.update([{ id: "b", x: 0.8, y: 0.8, z: 0 }], 1200).type,
    "idle",
  );
});
test("movement ends on dwell; a stationary finger never swipes", () => {
  const s = new Segmenter();
  s.update([{ id: "a", x: 0.1, y: 0.2, z: 0 }], 0);
  s.update([{ id: "a", x: 0.4, y: 0.2, z: 0 }], 100);
  assert.equal(
    s.update([{ id: "a", x: 0.4, y: 0.2, z: 0 }], 900).type,
    "swipe",
  );
  assert.equal(
    s.update([{ id: "a", x: 0.4, y: 0.2, z: 0 }], 1800).type,
    "idle",
  );
});
test("slow continuous movement accumulates from its origin and recognizes hello", () => {
  const s = new Segmenter(),
    path = resample(wordPath("hello", "en"), 90);
  let completed = null;
  for (let t = 0; t < 3200; t += 16) {
    const p = path[Math.min(89, Math.floor(t / 22))];
    const event = s.update([{ ...p, id: "a" }], t);
    if (event.type === "swipe") completed = event.path;
  }
  assert.ok(completed, "Slow trajectory must end as a swipe");
  assert.equal(rankWords(completed)[0].word, "hello");
});
test("depth flexion yields one tap without forcing swipe mode", () => {
  const s = new Segmenter(),
    tip = { id: "a", x: 0.5, y: 0.5, z: 0 };
  s.update([tip], 0);
  assert.equal(s.update([{ ...tip, z: -0.12 }], 100).taps.length, 0);
  const up = s.update([tip], 200);
  assert.equal(up.taps.length, 1);
  assert.equal(up.type, "idle");
  s.update([{ ...tip, z: -0.12 }], 250);
  assert.equal(s.update([tip], 300).taps.length, 0);
});
test("tap dictionary keeps literal out-of-vocabulary letters as fallback", () => {
  const r = rankWords([], "", ["en"], [], { en: "foobar" });
  assert.ok(r.some((c) => c.word === "foobar"));
});
test("selected fingertip alone supplies the path and taps; a switch never joins paths", () => {
  const s = new Segmenter();
  const tips = (a, b, z = 0) => [
    { id: "a", x: a, y: 0.5, z: 0 },
    { id: "b", x: b, y: 0.5, z },
  ];
  s.update(tips(0.1, 0.5), 0, 0.07, "a");
  s.update(tips(0.3, 0.7, -0.12), 100, 0.07, "a");
  const event = s.update(tips(0.35, 0.8), 200, 0.07, "a");
  assert.equal(event.taps.length, 0);
  assert.ok(s.path.every((p) => p.id === "a"));
  s.update(tips(0.4, 0.85), 300, 0.07, "b");
  assert.equal(s.path.length, 0);
  s.update(tips(0.5, 0.95), 400, 0.07, "b");
  assert.ok(s.path.length >= 2);
  assert.ok(s.path.every((p) => p.id === "b"));
});
test("dataset rejects malformed, synthetic training records and invalid labels", () => {
  const clip = {
    word: "hello",
    lang: "en",
    source: "pointer",
    path: wordPath("hello", "en"),
    frames: [],
  };
  assert.equal(validateDataset({ version: 1, clips: [clip] }).length, 1);
  for (const changes of [
    { word: "<script>" },
    { path: [{ x: NaN, y: 0 }] },
    { source: "demo" },
  ])
    assert.throws(() =>
      validateDataset({ version: 1, clips: [{ ...clip, ...changes }] }),
    );
});
