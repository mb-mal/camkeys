import test from "node:test";
import assert from "node:assert/strict";
import { rankToken, wordPath } from "../src/core.js";
test("an optimistically trimmed word cannot hide a well-supported ending in the admitted trajectory", () => {
  const token = {
    layout: "ru",
    path: wordPath("слово", "ru"),
    alternatePath: wordPath("словари", "ru"),
  };
  const before = structuredClone(token);
  assert.equal(
    rankToken(token, "", [{ word: "словари", lang: "ru" }])[0].word,
    "словари",
  );
  assert.deepEqual(token, before);
});
test("explicitly held letters are not replaced by a competing geometric path", () => {
  const token = {
    layout: "ru",
    letters: "мир",
    path: [],
    alternatePath: wordPath("слово", "ru"),
  };
  assert.equal(rankToken(token)[0].word, "мир");
});
