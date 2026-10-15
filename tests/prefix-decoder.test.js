import test from "node:test";
import assert from "node:assert/strict";
import { wordPath } from "../src/core.js";
import { PrefixDecoder, PrefixConsensus } from "../src/prefix-decoder.js";

const timed = (word, hold = false) => {
  const points = wordPath(word, "ru"),
    path = [];
  for (let i = 0; i < points.length - 1; i++) {
    for (let j = 0; j < 12; j++) {
      const a = points[i],
        b = points[i + 1],
        f = j / 12;
      path.push({
        x: a.x + (b.x - a.x) * f,
        y: a.y + (b.y - a.y) * f,
        t: path.length * 20,
      });
    }
  }
  path.push({ ...points.at(-1), t: path.length * 20 });
  if (hold)
    for (let i = 0; i < 8; i++)
      path.push({ ...points.at(-1), t: path.length * 20 });
  return path;
};
const decoder = () =>
  new PrefixDecoder(
    [
      "привет",
      "приветствие",
      "произведение",
      "программа",
      "мир",
      "воображение",
    ],
    "ru",
  );

test("prefix preview ignores keys crossed between intended letters", () => {
  const result = decoder().predict(timed("прив", true));
  assert.equal(result.text, "прив");
  assert.ok(result.confidence >= 0.75);
});
test("moving endpoint is provisional; a turn or short hold provides evidence", () => {
  const d = decoder();
  assert.equal(d.predict(timed("при")).text, "пр");
  assert.equal(d.predict(timed("при", true)).text, "при");
});
test("dictionary can infer letters on a straight segment without enumerating crossed keys", () => {
  assert.equal(decoder().predict(timed("про", true)).text, "про");
});
test("unrelated or out-of-plane motion does not invent a dictionary word", () => {
  assert.equal(
    decoder().predict([
      { x: 1.4, y: -1, t: 0 },
      { x: 1.5, y: -1, t: 200 },
    ]).text,
    "",
  );
});

test("preview ignores a moving approach before the first stable intended key", () => {
  const approach = timed("ип");
  const intended = timed("прив", true).map((p) => ({
    ...p,
    t: p.t + approach.at(-1).t + 20,
  }));
  // Hold the actual starting key, then trace the intended word.
  const first = intended[0];
  const hold = Array.from({ length: 8 }, (_, i) => ({
    ...first,
    t: first.t + i * 20,
  }));
  const path = [
    ...approach,
    ...hold,
    ...intended.map((p) => ({ ...p, t: p.t + 160 })),
  ];
  assert.equal(
    decoder().predict(path, { requireStartHold: true }).text,
    "прив",
  );
});
test("prefix consensus waits for support and never shrinks on a brief ambiguous result", () => {
  const c = new PrefixConsensus();
  assert.equal(c.update({ text: "при", confidence: 0.95 }, 0), "");
  assert.equal(c.update({ text: "при", confidence: 0.95 }, 180), "при");
  assert.equal(c.update({ text: "", confidence: 0 }, 200), "при");
  assert.equal(c.update({ text: "п", confidence: 1 }, 300), "при");
  assert.equal(c.update({ text: "прив", confidence: 0.95 }, 400), "при");
  assert.equal(c.update({ text: "прив", confidence: 0.95 }, 580), "прив");
  c.reset();
  assert.equal(c.text, "");
});
