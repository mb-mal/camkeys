import test from "node:test";
import assert from "node:assert/strict";
import { trimApproach } from "../src/word-boundaries.js";
import { InputSession } from "../src/input-session.js";
import { keys } from "../src/core.js";
const tip = (x, t, pointing = true) => ({
  id: "hand1-1",
  x,
  y: 0.5,
  z: 0,
  pointing,
  t,
  cameraX: x,
  cameraY: 0.5,
  distanceRatio: 1,
});
test("brief uncertain pose keeps a continuous same-finger word; release preserves a final candidate", () => {
  const requests = [];
  const s = new InputSession({ recognize: (r) => requests.push(r) });
  for (let t = 0; t <= 1000; t += 50)
    s.step({ tips: [tip(0.2 + t * 0.0002, t, t < 300 || t > 500)], time: t });
  assert.equal(s.owner, "hand1-1");
  assert.equal(s.phase, "drawing");
  const serial = s.serial;
  for (let t = 1050; t <= 1500; t += 50)
    s.step({ tips: [], observed: [], time: t });
  assert.equal(s.phase, "ready");
  assert.equal(s.detached, true);
  assert.equal(s.serial, serial);
  assert.ok(s.path.length > 10);
  assert.equal(requests.filter((r) => r.final).length, 1);
  const token = requests.at(-1);
  assert.equal(
    s.accept(token, [{ word: "тест", error: 0.1, score: 0.1 }]),
    true,
  );
  s.step({ tips: [], observed: [], time: 1600 });
  assert.equal(s.results[0].word, "тест");
});
test("a short missing observation resumes only the same nearby owner", () => {
  const s = new InputSession();
  for (let t = 0; t <= 300; t += 50)
    s.step({ tips: [tip(0.2 + t * 0.0002, t)], time: t });
  const serial = s.serial,
    n = s.path.length;
  s.step({ tips: [], observed: [], time: 350 });
  s.step({ tips: [tip(0.28, 400)], time: 400 });
  assert.equal(s.serial, serial);
  assert.equal(s.owner, "hand1-1");
  assert.ok(s.path.length >= n);
});
test("boundary selection removes an off-key approach and departure without knowing the word", () => {
  const a = keys("ru").find((k) => k.letter === "к"),
    b = keys("ru").find((k) => k.letter === "м");
  const path = [];
  let t = 0;
  for (let i = 0; i < 5; i++) path.push({ x: a.x, y: 1.2, t: (t += 50) });
  for (let i = 0; i < 6; i++) path.push({ ...a, t: (t += 50) });
  for (let i = 0; i < 10; i++)
    path.push({
      x: a.x + ((b.x - a.x) * i) / 9,
      y: a.y + ((b.y - a.y) * i) / 9,
      t: (t += 50),
    });
  for (let i = 0; i < 6; i++) path.push({ ...b, t: (t += 50) });
  for (let i = 0; i < 4; i++) path.push({ x: b.x, y: 1.1, t: (t += 50) });
  const cut = trimApproach(path);
  assert.equal(cut[0].x, a.x);
  assert.equal(cut[0].y, a.y);
  assert.equal(cut.at(-1).y, b.y);
  assert.ok(cut.length < path.length);
});
