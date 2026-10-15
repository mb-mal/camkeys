import test from "node:test";
import assert from "node:assert/strict";
import { RightFlick, LeftFlick } from "../src/gesture-control.js";
const palm = (x, y = 0.5, id = "hand1") => ({ x, y, id });
test("right palm flick freezes before commit and cannot repeat in cooldown", () => {
  const g = new RightFlick();
  g.update(palm(0.3), 100, true);
  assert.equal(g.update(palm(0.34), 160, true).type, "pending");
  assert.equal(g.update(palm(0.43), 260, true).type, "commit");
  assert.equal(g.update(palm(0.6), 360, true).type, "cooldown");
  g.reset();
  assert.equal(g.update(palm(0.7), 400, false).type, "cooldown");
});
test("slow, left, vertical movement and unarmed empty input never commit", () => {
  for (const [dx, dy, armed] of [
    [0.008, 0, true],
    [-0.04, 0, true],
    [0.04, 0.06, true],
    [0.04, 0, false],
  ]) {
    const g = new RightFlick();
    for (let i = 0; i < 6; i++)
      assert.notEqual(
        g.update(palm(0.3 + i * dx, 0.5 + i * dy), 100 + i * 80, armed).type,
        "commit",
      );
  }
});
test("a flick that starts empty cannot arm itself from its own movement", () => {
  const g = new RightFlick();
  g.update(palm(0.3), 100, false);
  assert.equal(g.update(palm(0.34), 160, false).type, "pending");
  assert.equal(g.update(palm(0.43), 260, true).type, "empty");
});
test("short, reversed or expired flicks reject; loss and identity change reset", () => {
  for (const [next, time] of [
    [palm(0.32), 260],
    [palm(0.35), 700],
    [palm(0.36, 0.6), 260],
  ]) {
    const g = new RightFlick();
    g.update(palm(0.3), 100, true);
    g.update(palm(0.34), 160, true);
    assert.notEqual(g.update(next, time, true).type, "commit");
  }
  const g = new RightFlick();
  g.update(palm(0.3), 100, true);
  g.update(palm(0.34), 160, true);
  assert.equal(g.update(null, 200, true).type, "lost");
  assert.equal(g.update(palm(0.6), 260, true).type, "idle");
  assert.equal(g.update(palm(0.8, 0.5, "hand2"), 300, true).type, "idle");
});
test("a deliberate diagonal left wave can settle over half a second while remaining horizontally dominant", () => {
  const g = new LeftFlick();
  g.update(palm(0.7, 0.9), 0, true);
  g.update(palm(0.67, 0.9), 70, true);
  assert.notEqual(g.update(palm(0.63, 0.96), 250, true).type, "rejected");
  assert.equal(g.update(palm(0.53, 1.0), 480, true).type, "commit");
});
