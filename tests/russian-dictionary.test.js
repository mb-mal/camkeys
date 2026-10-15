import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { installRussianDictionary } from "../src/russian-dictionary.js";
import { rankWords, wordPath, vocabulary } from "../src/core.js";
test("full local Russian lexicon ranks unrelated ideal words without a target argument", () => {
  assert.throws(() => installRussianDictionary("слово 1"), /неполон/);
  const count = installRussianDictionary(
    fs.readFileSync("public/dictionaries/ru_50k.txt", "utf8"),
  );
  assert.ok(count > 40000);
  for (const word of [
    "генератор",
    "облако",
    "программа",
    "словарь",
    "движение",
    "произведение",
  ]) {
    assert.ok(vocabulary.ru.includes(word));
    assert.equal(rankWords(wordPath(word, "ru"), "", ["ru"])[0].word, word);
  }
});
