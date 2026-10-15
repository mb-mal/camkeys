import test from "node:test";
import assert from "node:assert/strict";
import { TipActivity } from "../src/tip-activity.js";
const tip = (id, x, y = 0.5, z = 0) => ({ id, x, y, z });
test("more active distant hand cannot intercept an admitted moving finger", () => {
  const a = new TipActivity();
  let r;
  for (let i = 0; i <= 60; i++)
    r = a.update(
      [tip("near", 0.4 + i * 0.0005), tip("far", 0.7 + 0.2 * Math.sin(i))],
      i * 50,
      new Set(["near"]),
    );
  assert.equal(r.id, "near");
  assert.ok(r.scores.find((s) => s.id === "far").score > r.score);
});
test("small deliberate motion accumulates over three seconds without lowering noise thresholds", () => {
  const a = new TipActivity();
  let result;
  for (let i = 0; i <= 60; i++)
    result = a.update(
      [tip("moving", 0.4 + i * 0.0005), tip("still", 0.7)],
      i * 50,
    );
  assert.equal(result.id, "moving");
  assert.ok(result.score >= 0.018);
});
test("relative z fluctuations do not steal input from a tip moving across the image", () => {
  const a = new TipActivity();
  for (let i = 0; i <= 90; i++)
    a.update(
      [tip("moving", 0.3 + i * 0.002), tip("z-noise", 0.7, 0.5, (i % 2) * 0.5)],
      i * 33,
    );
  assert.equal(a.active, "moving");
});
test("camera jitter must not outrank deliberate slow motion", () => {
  const a = new TipActivity();
  for (let i = 0; i <= 150; i++)
    a.update(
      [tip("moving", 0.3 + i * 0.001), tip("jitter", 0.7 + (i % 2) * 0.005)],
      i * 20,
    );
  assert.equal(a.active, "moving");
});
test("most active tip across two hands wins by total movement, not the last frame", () => {
  const a = new TipActivity();
  a.update([tip("hand1-1", 0.1), tip("hand2-3", 0.5)], 0);
  assert.equal(
    a.update([tip("hand1-1", 0.3), tip("hand2-3", 0.5)], 100).id,
    "hand1-1",
  );
  assert.equal(
    a.update([tip("hand1-1", 0.3), tip("hand2-3", 0.6)], 200).id,
    "hand1-1",
  );
  assert.equal(
    a.update([tip("hand1-1", 0.3), tip("hand2-3", 0.85)], 300).id,
    "hand2-3",
  );
});
test("movement older than five seconds expires; loss never bridges trajectories", () => {
  const a = new TipActivity();
  a.update([tip("a", 0.1), tip("b", 0.5)], 0);
  a.update([tip("a", 0.4), tip("b", 0.5)], 100);
  for (let t = 200; t <= 5400; t += 200)
    a.update([tip("a", 0.4), tip("b", 0.5)], t);
  assert.equal(a.update([tip("a", 0.4), tip("b", 0.6)], 5550).id, "b");
  a.update([], 5600);
  assert.equal(a.update([tip("a", 0.9)], 5700).id, null);
});
test("noise is ignored, slow movement accumulates, flexion can select a tapping finger", () => {
  const a = new TipActivity();
  for (let i = 0; i < 20; i++)
    assert.equal(a.update([tip("a", 0.5 + (i % 2) * 0.001)], i * 30).id, null);
  for (let i = 0; i < 15; i++)
    a.update([tip("a", 0.5 + i * 0.003)], 600 + i * 30);
  assert.equal(a.active, "a");
  const b = new TipActivity();
  b.update([tip("a", 0.5), tip("b", 0.6)], 0);
  assert.equal(
    b.update([tip("a", 0.5), tip("b", 0.6, 0.5, -0.12)], 100).id,
    "b",
  );
});
test("a pause preserves recent activity but does not add a jump across missing frames", () => {
  const a = new TipActivity();
  a.update([tip("a", 0.1)], 0);
  const first = a.update([tip("a", 0.3)], 100);
  assert.equal(a.update([tip("a", 0.8)], 1000).score, first.score);
});
test("activity is comparable at 30 and 60 fps; rigid palm motion gives a stable tie", () => {
  const scores = [];
  for (const step of [1000 / 30, 1000 / 60]) {
    const a = new TipActivity();
    let result;
    for (let t = 0; t <= 3000; t += step)
      result = a.update(
        [tip("a", 0.2 + t * 0.0001), tip("b", 0.6 + t * 0.0001)],
        t,
      );
    assert.equal(result.id, "a");
    scores.push(result.score);
  }
  assert.ok(Math.abs(scores[0] - scores[1]) < 0.015);
});
