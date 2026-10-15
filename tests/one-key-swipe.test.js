import test from "node:test";
import assert from "node:assert/strict";
import { InputSession } from "../src/input-session.js";
test("a small loop at one key does not automatically invent a multiletter word", () => {
  const requests = [];
  const s = new InputSession({ recognize: (t) => requests.push(t) });
  const p = (x) => ({ id: "hand1-1", x, y: 0.5, z: 0, pointing: true });
  s.step({ tips: [p(0.45)], time: 0 });
  s.step({ tips: [p(0.475)], time: 100 });
  s.step({ tips: [p(0.45)], time: 200 });
  for (let time = 250; time <= 1300; time += 50)
    s.step({ tips: [p(0.45)], time });
  const token = requests.at(-1);
  assert.equal(s.entryMode, "swipe");
  s.accept(token, [{ word: "слово", lang: "ru", error: 0.02, score: 0.02 }]);
  assert.equal(s.commitRecognized(token, true), false);
  assert.equal(s.tick(5000, true), false);
});
