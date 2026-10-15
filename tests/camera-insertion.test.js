import test from "node:test";
import assert from "node:assert/strict";
import { InputSession } from "../src/input-session.js";
const p = (x, pointing = true) => ({
  id: "hand1-1",
  x,
  y: 0.5,
  z: 0,
  pointing,
  cameraX: x,
  cameraY: 0.5,
  distanceRatio: 1,
});
const best = [
  { word: "слово", lang: "ru", error: 0.05, score: 0.05 },
  { word: "слова", lang: "ru", error: 0.054, score: 0.054 },
];

test("left flick cancels a pending candidate or retracts the last automatic insertion once", () => {
  for (const afterInsertion of [false, true]) {
    const requests = [],
      inserted = [],
      retractions = [];
    const s = new InputSession({
      recognize: (r) => requests.push(r),
      commit: (c) => inserted.push(c.word),
      retract: (e) => {
        retractions.push(e);
        if (e.undoRecent) inserted.pop();
      },
    });
    for (let t = 0; t <= 300; t += 50)
      s.step({
        tips: [p(0.2 + t * 0.0003)],
        palms: [{ id: "hand1", x: 0.3, y: 0.7 }],
        time: t,
      });
    for (let t = 350; t <= 1200; t += 50)
      s.step({
        tips: [p(0.29)],
        palms: [{ id: "hand1", x: 0.3, y: 0.7 }],
        time: t,
      });
    const token = requests.at(-1);
    s.accept(token, best);
    s.commitRecognized(token, true);
    if (afterInsertion) assert.equal(s.tick(2700, true), true);
    const start = afterInsertion ? 2800 : 1250;
    s.step({
      tips: [],
      observed: [],
      palms: [{ id: "hand1", x: 0.3, y: 0.7 }],
      time: start,
    });
    s.step({
      tips: [],
      observed: [],
      palms: [{ id: "hand1", x: 0.26, y: 0.7 }],
      time: start + 60,
    });
    s.step({
      tips: [],
      observed: [],
      palms: [{ id: "hand1", x: 0.17, y: 0.7 }],
      time: start + 160,
    });
    assert.equal(retractions.length, 1);
    assert.equal(retractions[0].undoRecent, afterInsertion);
    assert.deepEqual(inserted, []);
    assert.equal(s.tick(start + 5000, true), false);
    assert.equal(
      s.accept(token, best),
      false,
      "late decoder result cannot resurrect a cancelled word",
    );
  }
});

test("continuing the finger trajectory invalidates the running insertion deadline", () => {
  const requests = [],
    s = new InputSession({ recognize: (r) => requests.push(r) });
  for (let t = 0; t <= 300; t += 50)
    s.step({ tips: [p(0.2 + t * 0.0003)], time: t });
  for (let t = 350; t <= 1200; t += 50) s.step({ tips: [p(0.29)], time: t });
  const token = requests.at(-1);
  s.accept(token, best);
  s.commitRecognized(token, true);
  s.step({ tips: [p(0.4)], time: 1300 });
  assert.equal(s.tick(5000, true), false);
});
test("automatic insertion waits exactly 1500 ms after recognition without requiring hand removal", () => {
  const requests = [],
    inserted = [];
  const s = new InputSession({
    recognize: (t) => requests.push(t),
    commit: (c) => inserted.push(c.word),
  });
  for (let t = 0; t <= 300; t += 50)
    s.step({ tips: [p(0.2 + t * 0.0003)], time: t });
  for (let t = 350; t <= 1200; t += 50) s.step({ tips: [p(0.29)], time: t });
  const provisional = requests.at(-1);
  assert.equal(provisional.complete, false);
  s.accept(provisional, best);
  assert.equal(s.commitRecognized(provisional, true), false);
  assert.equal(s.tick(2699, true), false);
  assert.equal(s.tick(2700, false), false);
  assert.equal(s.tick(2700, true), true);
  assert.equal(s.tick(3000, true), false);
  assert.equal(s.commitRecognized(provisional, true), false);
  assert.deepEqual(inserted, ["слово"]);
});
test("right flick can confirm a completed word after the fingertip is lost, with automatic insertion disabled", () => {
  const requests = [],
    inserted = [];
  const s = new InputSession({
    recognize: (t) => requests.push(t),
    commit: (c) => inserted.push(c.word),
  });
  for (let t = 0; t <= 300; t += 50)
    s.step({
      tips: [p(0.2 + t * 0.0003)],
      palms: [{ id: "hand1", x: 0.3, y: 0.7 }],
      time: t,
    });
  for (let t = 350; t <= 1000; t += 50)
    s.step({
      tips: [p(0.29)],
      palms: [{ id: "hand1", x: 0.3, y: 0.7 }],
      time: t,
    });
  // Same palm remains available to the command channel, but the input tip is absent.
  for (let t = 1050; t <= 1550; t += 50)
    s.step({
      tips: [],
      observed: [],
      palms: [{ id: "hand1", x: 0.3, y: 0.7 }],
      time: t,
    });
  assert.equal(s.detached, true);
  assert.equal(s.owner, null);
  s.step({
    tips: [],
    observed: [],
    palms: [{ id: "hand1", x: 0.34, y: 0.7 }],
    time: 1610,
  });
  s.step({
    tips: [],
    observed: [],
    palms: [{ id: "hand1", x: 0.43, y: 0.7 }],
    time: 1710,
  });
  const token = requests.at(-1);
  assert.equal(token.confirmRequested, true);
  s.accept(token, best);
  assert.equal(s.commitRecognized(token, false), true);
  assert.deepEqual(inserted, ["слово"]);
});

test("confirmation remains attached to its word while a slow decoder answers and the flick settles", () => {
  const requests = [],
    inserted = [];
  const s = new InputSession({
    recognize: (t) => requests.push(t),
    commit: (c) => inserted.push(c.word),
  });
  const step = (time, x, px = 0.3) =>
    s.step({ tips: [p(x)], palms: [{ id: "hand1", x: px, y: 0.7 }], time });
  for (let t = 0; t <= 300; t += 50) step(t, 0.2 + t * 0.0003);
  for (let t = 350; t <= 1100; t += 50) step(t, 0.29);
  const beforeFlick = s.path.map((p) => ({ ...p }));
  step(1160, 0.33, 0.34);
  assert.deepEqual(
    s.path,
    beforeFlick,
    "pending command must not append hand-wave positions to the word",
  );
  step(1260, 0.42, 0.43);
  const token = requests.at(-1);
  assert.equal(token.confirmRequested, true);
  for (let t = 1310; t <= 1910; t += 50) step(t, 0.5, 0.48);
  assert.equal(
    s.serial,
    token.session,
    "settling palm must not start a new word while confirmation is pending",
  );
  assert.equal(s.accept(token, best), true);
  assert.equal(s.commitRecognized(token, false), true);
  assert.deepEqual(inserted, ["слово"]);
});

test("weak confirmation result releases the wait so the word can be corrected", () => {
  const requests = [];
  const s = new InputSession({ recognize: (t) => requests.push(t) });
  for (let time = 0; time <= 300; time += 50)
    s.step({ tips: [p(0.2 + time * 0.0003)], time });
  for (let time = 350; time <= 1100; time += 50)
    s.step({ tips: [p(0.29)], time });
  s.confirmRequested = true;
  s.finish("Подтверждение взмахом вправо.");
  const token = requests.at(-1);
  s.accept(token, [{ word: "неясно", lang: "ru", error: 0.5, score: 0.5 }]);
  assert.equal(s.commitRecognized(token, false), false);
  assert.equal(s.confirmRequested, false);
});

test("a sole returning palm can restore the command channel after tracker ID loss, while a known second hand cannot", () => {
  for (const knownSecond of [false, true]) {
    const requests = [],
      inserted = [];
    const s = new InputSession({
      recognize: (t) => requests.push(t),
      commit: (c) => inserted.push(c.word),
    });
    const palms = [
      { id: "hand1", x: 0.3, y: 0.7 },
      ...(knownSecond ? [{ id: "hand2", x: 0.7, y: 0.7 }] : []),
    ];
    for (let time = 0; time <= 300; time += 50)
      s.step({ tips: [p(0.2 + time * 0.0003)], palms, time });
    for (let time = 350; time <= 1100; time += 50)
      s.step({ tips: [p(0.29)], palms, time });
    for (let time = 1150; time <= 2000; time += 50)
      s.step({ tips: [], observed: [], palms: [], time });
    const id = knownSecond ? "hand2" : "new-id";
    s.step({
      tips: [],
      observed: [],
      palms: [{ id, x: 0.3, y: 0.7 }],
      time: 2050,
    });
    s.step({
      tips: [],
      observed: [],
      palms: [{ id, x: 0.34, y: 0.7 }],
      time: 2110,
    });
    s.step({
      tips: [],
      observed: [],
      palms: [{ id, x: 0.43, y: 0.7 }],
      time: 2210,
    });
    const token = requests.at(-1);
    assert.equal(!!token.confirmRequested, !knownSecond);
    if (token.confirmRequested) {
      s.accept(token, best);
      s.commitRecognized(token, false);
    }
    assert.equal(inserted.length, knownSecond ? 0 : 1);
  }
});

test("depth exclusion preserves a completed swipe for decoding without accepting far coordinates", () => {
  const requests = [];
  const s = new InputSession({ recognize: (t) => requests.push(t) });
  for (let time = 0; time <= 500; time += 50)
    s.step({ tips: [p(0.2 + time * 0.0003)], time });
  const before = s.path.map((p) => ({ ...p }));
  s.step({
    tips: [],
    observed: [{ ...p(0.9), depthReason: "far" }],
    time: 550,
  });
  assert.equal(s.phase, "ready");
  assert.equal(s.owner, null);
  assert.deepEqual(s.path, before);
  assert.ok(requests.at(-1).final);
  assert.ok(requests.at(-1).alternatePath.every((p) => p.x < 0.4));
});
