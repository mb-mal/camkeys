import test from "node:test";
import assert from "node:assert/strict";
import { TipActivity } from "../src/tip-activity.js";
const tip = (id, x, pointing = true) => ({ id, x, y: 0.5, z: 0, pointing });
test("selection survives motion then a visible stationary hold longer than five seconds", () => {
  const a = new TipActivity();
  a.update([tip("a", 0.2)], 0);
  a.update([tip("a", 0.4)], 100);
  for (let t = 150; t <= 11000; t += 50)
    assert.equal(a.update([tip("a", 0.4)], t).id, "a", `lost at ${t}`);
  assert.equal(a.tracks.get("a").steps.length, 0);
  assert.equal(a.update([tip("a", 0.5)], 11050).id, "a");
});
test("continuous motion crosses 3, 5 and 10 seconds without resets at variable frame rate", () => {
  const a = new TipActivity();
  let time = 0,
    last = null;
  for (let frame = 0; time < 12000; frame++) {
    time += [16, 33, 70, 45][frame % 4];
    const r = a.update([tip("a", 0.4 + 0.08 * Math.sin(time / 450))], time);
    if (time > 500) assert.equal(r.id, "a", `lost at ${time}`);
    last = r;
  }
  assert.ok(last.score > 0);
  assert.ok(
    a.tracks.get("a").steps.every((s) => s.t >= time - 5000 && s.t <= time),
  );
});
test("activity between three and five seconds stays in the rolling score", () => {
  const a = new TipActivity();
  a.update([tip("a", 0.2)], 0);
  a.update([tip("a", 0.4)], 100);
  for (let t = 150; t <= 4000; t += 50) a.update([tip("a", 0.4)], t);
  assert.ok(a.tracks.get("a").steps.some((s) => s.t < 1000));
  assert.ok(
    a.tracks.get("a").steps.reduce((sum, s) => sum + s.distance, 0) > 0.1,
  );
});
test("a genuine stronger contender switches; disappearance or ineligibility releases selection", () => {
  const a = new TipActivity();
  a.update([tip("a", 0.2), tip("b", 0.6)], 0);
  a.update([tip("a", 0.3), tip("b", 0.6)], 100);
  let r;
  for (let t = 150; t <= 1100; t += 50)
    r = a.update([tip("a", 0.3), tip("b", 0.6 + 0.15 * Math.sin(t / 90))], t);
  assert.equal(r.id, "b");
  assert.equal(a.update([tip("a", 0.3)], 1150).id, "a");
  assert.equal(a.update([tip("a", 0.3, false)], 1200, new Set()).id, null);
  assert.equal(a.update([], 1250).id, null);
  assert.equal(a.update([tip("b", 0.9)], 1300).id, null);
});
test("duplicate and older timestamps do not reset current selection or mutate its history", () => {
  const a = new TipActivity();
  a.update([tip("a", 0.2)], 0);
  a.update([tip("a", 0.4)], 100);
  const before = JSON.stringify(a.tracks.get("a"));
  assert.equal(a.update([tip("a", 0.9)], 100).id, "a");
  assert.equal(a.update([], 50).id, "a");
  assert.equal(JSON.stringify(a.tracks.get("a")), before);
});
test("relative-z jitter cannot take a held pointer after its planar activity expires", () => {
  const a = new TipActivity();
  a.update([tip("a", 0.2), tip("b", 0.7)], 0);
  a.update([tip("a", 0.4), tip("b", 0.7)], 100);
  for (let t = 150; t <= 10000; t += 50)
    assert.equal(
      a.update(
        [tip("a", 0.4), { ...tip("b", 0.7), z: 0.2 * Math.sin(t / 80) }],
        t,
      ).id,
      "a",
    );
});
