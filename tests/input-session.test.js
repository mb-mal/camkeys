import test from "node:test";
import assert from "node:assert/strict";
import { InputSession } from "../src/input-session.js";
import { rankWords, resample, wordPath, keys } from "../src/core.js";
const p = (id, x, z = 0) => ({
  id,
  x,
  y: 0.5,
  z,
  pointing: true,
  depthReason: "near",
  distanceRatio: 1,
  cameraX: x,
  cameraY: 0.5,
});
test("a louder second tip and repeated flexion cannot steal a drawing word or request tap decoding", () => {
  const calls = [];
  const s = new InputSession({ recognize: (e) => calls.push(e) });
  for (let i = 0; i < 30; i++)
    s.step({
      tips: [
        p("hand1-1", 0.2 + i * 0.006, i % 2 ? -0.2 : 0),
        p("hand2-2", 0.7 + 0.15 * Math.sin(i)),
      ],
      time: i * 50,
    });
  // Deliberately establish owner before adding the competing movement.
  const b = new InputSession({ recognize: (e) => calls.push(e) });
  b.step({ tips: [p("hand1-1", 0.2)], time: 0 });
  b.step({ tips: [p("hand1-1", 0.25)], time: 100 });
  for (let i = 1; i < 25; i++)
    b.step({
      tips: [
        p("hand1-1", 0.25 + i * 0.004, i % 2 ? -0.2 : 0),
        p("hand2-2", 0.7 + 0.15 * Math.sin(i)),
      ],
      time: 100 + i * 50,
    });
  assert.equal(b.owner, "hand1-1");
  assert.equal(b.phase, "drawing");
  assert.ok(b.path.every((x) => x.id === "hand1-1"));
  assert.ok(calls.filter((x) => x.path.length).every((x) => x.letters === ""));
});
test("stop makes one stable ready word; explicit commit is once; loss invalidates async answers", () => {
  const requests = [],
    commits = [];
  const s = new InputSession({
    recognize: (e) => requests.push(e),
    commit: (c) => commits.push(c.word),
  });
  s.step({ tips: [p("hand1-1", 0.2)], time: 0 });
  s.step({ tips: [p("hand1-1", 0.3)], time: 100 });
  for (let t = 150; t <= 8000; t += 50)
    s.step({ tips: [p("hand1-1", 0.3)], time: t });
  assert.equal(s.phase, "ready");
  const token = requests.at(-1);
  s.accept(token, [{ word: "word", lang: "ru", error: 0.01, score: 0.01 }]);
  assert.equal(s.confirm(), true);
  assert.equal(s.confirm(), false);
  assert.deepEqual(commits, ["word"]);
  s.step({ tips: [], observed: [], time: 8050 });
  assert.equal(s.accept(token, [{ word: "stale" }]), false);
});
test("unconfirmed calibration never produces word data; layout change cancels owner and old results", () => {
  const s = new InputSession();
  s.step({ tips: [p("hand1-1", 0.2)], time: 0, calibrated: false });
  assert.equal(s.phase, "needs-calibration");
  assert.equal(s.path.length, 0);
  s.step({ tips: [p("hand1-1", 0.2)], time: 100 });
  s.step({ tips: [p("hand1-1", 0.3)], time: 200 });
  const token = { session: s.serial, layout: "ru", version: s.version };
  s.step({ tips: [p("hand1-1", 0.3)], time: 250, layout: "en" });
  assert.equal(s.path.length, 0);
  assert.equal(s.accept(token, []), false);
});
test("noisy RU/EN curves at different speeds survive competing hands, stop, and confirm exactly once", () => {
  for (const [word, layout] of [
    ["привет", "ru"],
    ["hello", "en"],
    ["клавиатура", "ru"],
    ["camera", "en"],
  ]) {
    for (const dt of [33, 80]) {
      const committed = [];
      const s = new InputSession({
        recognize: (token) =>
          s.accept(
            token,
            rankWords(
              token.path,
              "",
              [token.layout],
              [],
              token.letters ? { [token.layout]: token.letters } : null,
            ),
          ),
        commit: (c) => committed.push(c.word),
      });
      const points = resample(wordPath(word, layout), 90);
      let time = 0;
      const step = (point, i) => {
        const tip = {
          ...p("hand1-1", point.x, i % 12 < 6 ? -0.1 : 0),
          y: point.y,
        };
        const rival = {
          ...p("hand2-2", 0.65 + 0.2 * Math.sin(i)),
          y: 0.5,
          pointing: time > 500,
        };
        s.step({ tips: [tip, rival], time: (time += dt), layout });
      };
      // First acquire the intended finger before a moving second hand appears.
      s.step({
        tips: [{ ...p("hand1-1", points[0].x), y: points[0].y }],
        time: 0,
        layout,
      });
      points.forEach((point, i) =>
        step(
          {
            x: point.x + 0.0015 * Math.sin(i * 1.7),
            y: point.y + 0.0015 * Math.cos(i),
          },
          i,
        ),
      );
      for (let i = 0; i < Math.ceil(8000 / dt); i++) step(points.at(-1), i);
      assert.equal(s.phase, "ready", `${word}/${dt}: ready`);
      assert.equal(s.results[0].word, word, `${word}/${dt}: noisy result`);
      assert.ok(
        s.frames.every(
          (f) => f.tips.length === 1 && f.tips[0].id === "hand1-1",
        ),
      );
      assert.equal(s.confirm(), true, `${word}/${dt}: confirm`);
      assert.equal(s.confirm(), false);
      assert.deepEqual(committed, [word]);
      for (let i = 0; i < Math.floor(700 / dt); i++)
        step({ x: 0.7, y: 0.5 }, i);
      assert.equal(s.path.length, 0, "command tail cannot start another word");
    }
  }
});
test("gaps and depth exclusion never concatenate a partial word", () => {
  for (const interrupt of ["gap", "depth"]) {
    const s = new InputSession();
    s.step({ tips: [p("hand1-1", 0.2)], time: 0 });
    s.step({ tips: [p("hand1-1", 0.3)], time: 100 });
    if (interrupt === "gap") s.step({ tips: [p("hand1-1", 0.4)], time: 600 });
    if (interrupt === "depth")
      s.step({ tips: [], observed: [p("hand1-1", 0.4)], time: 150 });
    assert.equal(s.path.length, 0, interrupt);
    assert.equal(s.owner, null, interrupt);
  }
});
test("uncertain pose with a displaced sample pauses without adding the jump or discarding the word", () => {
  const s = new InputSession();
  s.step({ tips: [p("hand1-1", 0.2)], time: 0 });
  s.step({ tips: [p("hand1-1", 0.3)], time: 100 });
  const before = s.path.map((p) => ({ ...p }));
  s.step({ tips: [{ ...p("hand1-1", 0.3), pointing: false }], time: 150 });
  s.step({ tips: [p("hand1-1", 0.4)], time: 200 });
  assert.deepEqual(s.path, before);
  assert.equal(s.phase, "paused");
  assert.equal(s.owner, "hand1-1");
});
test("ambiguous or poor candidates require a manual choice; saved personal curves affect baseline", () => {
  const s = new InputSession();
  s.step({ tips: [p("hand1-1", 0.2)], time: 0 });
  s.step({ tips: [p("hand1-1", 0.3)], time: 100 });
  s.phase = "ready";
  s.results = [
    { word: "one", error: 0.05, score: 0.05 },
    { word: "two", error: 0.055, score: 0.055 },
  ];
  assert.equal(s.confirm(), false);
  assert.equal(s.confirm("two"), true);
  const personal = resample(wordPath("hello", "en"), 32).map((p) => ({
    ...p,
    x: p.x + 0.025,
    y: p.y + 0.025,
  }));
  const plain = rankWords(personal, "", ["en"]).find((c) => c.word === "hello");
  const trained = rankWords(
    personal,
    "",
    ["en"],
    [{ word: "hello", lang: "en", path: personal }],
  ).find((c) => c.word === "hello");
  assert.ok(trained.error < plain.error);
});
test("stationary camera input had no action before dwell; now a single letter analyzes at 500 ms and holds once for ten seconds", () => {
  for (const lang of ["ru", "en"])
    for (const dt of [20, 100]) {
      const calls = [],
        commits = [],
        key = keys(lang)[1];
      const s = new InputSession({
        recognize: (t) => {
          calls.push(t);
          s.accept(
            t,
            rankWords(
              t.path,
              "",
              [lang],
              [],
              t.letters ? { [lang]: t.letters } : null,
            ),
          );
        },
        commit: (c) => commits.push(c.word),
      });
      const tip = { ...p("hand1-1", key.x), y: key.y };
      for (let t = 0; t < 500; t += dt) {
        s.step({ tips: [tip], time: t, layout: lang });
        assert.equal(s.letters, "");
      }
      s.step({ tips: [tip], time: 500, layout: lang });
      assert.equal(s.letters, key.letter);
      assert.equal(s.results[0].word, key.letter);
      for (let t = 500 + dt; t <= 10000; t += dt)
        s.step({ tips: [tip], time: t, layout: lang });
      assert.equal(calls.length, 1);
      assert.deepEqual(commits, []);
      const away = { ...tip, x: key.x + 0.1 };
      s.step({ tips: [away], time: 10000 + dt, layout: lang });
      s.step({ tips: [tip], time: 10000 + dt * 2, layout: lang });
      for (let t = 10000 + dt * 3; t <= 10000 + dt * 2 + 500; t += dt)
        s.step({ tips: [tip], time: t, layout: lang });
      assert.equal(s.letters, key.letter.repeat(2));
    }
});
test("swipe analyzes after exactly 500 ms of meaningful rest, keeps path and never inserts during ten seconds", () => {
  const requests = [],
    commits = [];
  const s = new InputSession({
    recognize: (t) => requests.push(t),
    commit: (c) => commits.push(c),
  });
  s.step({ tips: [p("hand1-1", 0.2)], time: 0 });
  s.step({ tips: [p("hand1-1", 0.4)], time: 100 });
  let readyAt;
  for (let t = 120; t <= 10000; t += 20) {
    s.step({ tips: [p("hand1-1", 0.4)], time: t });
    if (s.phase === "ready" && !readyAt) readyAt = t;
  }
  assert.ok(readyAt - s.lastMotion >= 500 && readyAt - s.lastMotion < 520);
  assert.equal(s.entryMode, "swipe");
  assert.ok(s.path.length >= 2);
  assert.equal(s.letters, "");
  assert.equal(requests.filter((t) => t.final).length, 1);
  assert.deepEqual(commits, []);
});
