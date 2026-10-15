import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { installEnglishDictionary } from "../src/english-dictionary.js";
import { rankWords, wordPath, vocabulary, resample } from "../src/core.js";
import { PrefixDecoder } from "../src/prefix-decoder.js";
import { InputSession } from "../src/input-session.js";
import { rankToken } from "../src/core.js";
test("English corpus recognizes unseen words and contractions only in the selected language", () => {
  const russian = [...vocabulary.ru];
  assert.throws(() => installEnglishDictionary("hello 10"), /неполон/);
  const count = installEnglishDictionary(
    fs.readFileSync("public/dictionaries/en_50k.txt", "utf8"),
  );
  assert.ok(count > 40000);
  assert.deepEqual(vocabulary.ru, russian);
  for (const word of [
    "keyboard",
    "recognition",
    "possibilities",
    "computer",
    "language",
    "don't",
    "can't",
  ]) {
    assert.ok(vocabulary.en.includes(word));
    const result = rankWords(wordPath(word, "en"), "", ["en"]);
    assert.equal(result[0].word, word, word);
    assert.ok(result.every((c) => c.lang === "en"));
  }
  assert.equal(rankWords([], "", ["en"], [], { en: "dont" })[0].word, "don't");
  const decoder = new PrefixDecoder(vocabulary.en, "en");
  const path = resample(wordPath("keyboard", "en"), 160).map((p, i) => ({
    ...p,
    t: i * 20,
  }));
  for (let i = 1; i <= 4; i++)
    path.push({ ...path.at(-1), t: path.at(-1).t + 50 });
  assert.equal(decoder.predict(path).text, "keyboard");
});

test("English camera sessions decode noisy trajectories and insert once without changing layout", () => {
  installEnglishDictionary(
    fs.readFileSync("public/dictionaries/en_50k.txt", "utf8"),
  );
  for (const word of ["keyboard", "recognition", "don't"]) {
    const inserted = [];
    const s = new InputSession({
      recognize: (token) => {
        if (!token.final) return;
        const results = rankToken(token);
        if (s.accept(token, results))
          s.commitRecognized(token, true, s.lastTime);
      },
      commit: (c) => inserted.push(c.word),
    });
    const points = resample(wordPath(word, "en"), 120);
    let time = 0;
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      s.step({
        tips: [
          {
            ...p,
            x: p.x + Math.sin(i) * 0.002,
            y: p.y + Math.cos(i) * 0.004,
            id: "hand1-1",
            pointing: true,
          },
        ],
        time: (time += 25),
        layout: "en",
        calibrated: true,
      });
      s.tick(time, true);
    }
    for (let i = 0; i < 100; i++) {
      s.step({
        tips: [{ ...points.at(-1), id: "hand1-1", pointing: true }],
        time: (time += 25),
        layout: "en",
        calibrated: true,
      });
      s.tick(time, true);
    }
    assert.deepEqual(inserted, [word], word);
    assert.equal(s.layout, "en");
  }
});
