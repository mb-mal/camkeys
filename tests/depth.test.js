import test from "node:test";
import assert from "node:assert/strict";
import { DepthGate, palmScale } from "../src/depth.js";
import { Segmenter } from "../src/core.js";
import { projectTrackedHands } from "../src/hand-input.js";
import { depthDemoHands } from "../src/depth-demo.js";
function hand(x = 0.3, scale = 0.16, aspect = 0.75) {
  const p = Array.from({ length: 21 }, () => ({ x, y: 0.7, z: 0 }));
  p[9] = { x, y: 0.7 - scale / Math.sqrt(2) / aspect, z: 0 };
  p[5] = { x: x - scale / 2 / Math.sqrt(2), y: p[9].y, z: 0 };
  p[17] = { x: x + scale / 2 / Math.sqrt(2), y: p[9].y, z: 0 };
  return p;
}
const settle = (gate, hands, aspect = 0.75) => {
  let result;
  for (let t = 0; t <= 300; t += 60) result = gate.update(hands, t, aspect);
  return result;
};
test("palm size respects aspect ratio and ignores wrist-relative z", () => {
  const p = hand(0.3, 0.16);
  assert.ok(Math.abs(palmScale(p, 0.75) - 0.16) < 1e-8);
  p.forEach((v) => (v.z = 500));
  assert.ok(Math.abs(palmScale(p, 0.75) - 0.16) < 1e-8);
  assert.ok(Math.abs(palmScale(hand(0.3, 0.16, 1), 1) - 0.16) < 1e-8);
});
test("far hand and all its fingers excluded; near hand admitted after settling", () => {
  const gate = new DepthGate();
  const r = settle(gate, [hand(0.25, 0.16), hand(0.7, 0.07)]);
  assert.equal(r.accepted.length, 1);
  assert.equal(r.excluded.length, 1);
  assert.equal(r.excluded[0].reason, "far");
  assert.ok(r.excluded[0].ratio > 2);
  assert.ok(Math.abs(r.accepted[0].ratio - 1) < 1e-8);
});
test("any depth beyond the threshold exits immediately; hysteresis prevents flicker", () => {
  const gate = new DepthGate();
  settle(gate, [hand()]);
  const tooFar = gate.update([hand(0.3, 0.16 / 1.36)], 360, 0.75);
  assert.equal(tooFar.accepted.length, 0);
  for (let t = 420; t < 1000; t += 60)
    assert.equal(
      gate.update([hand(0.3, 0.16 / 1.32)], t, 0.75).accepted.length,
      0,
    );
  for (let t = 1020; t <= 1500; t += 60)
    gate.update([hand(0.3, 0.16)], t, 0.75);
  assert.equal(gate.update([hand(0.3, 0.16)], 1560, 0.75).accepted.length, 1);
});
test("identities survive detection ordering and a change of closest hand", () => {
  const gate = new DepthGate();
  let r = settle(gate, [hand(0.2, 0.16), hand(0.7, 0.15)]);
  const ids = r.accepted.map((v) => v.id);
  r = gate.update([hand(0.7, 0.17), hand(0.2, 0.15)], 360, 0.75);
  assert.deepEqual(
    r.accepted.map((v) => v.id),
    [ids[1], ids[0]],
  );
});
test("ambiguous overlaps and occlusion do not reuse an active hand identity", () => {
  const gate = new DepthGate();
  const before = settle(gate, [hand(0.4), hand(0.6)]).accepted.map((v) => v.id);
  const overlap = gate.update([hand(0.5), hand(0.5)], 360, 0.75);
  assert.equal(overlap.ambiguous, true);
  assert.equal(overlap.accepted.length, 0);
  const later = gate.update([hand(0.4)], 1000, 0.75);
  assert.ok(!before.includes(later.excluded[0].id));
});
test("active hand leaving range discards the partial gesture even if another stays", () => {
  const gate = new DepthGate(),
    s = new Segmenter();
  let r = settle(gate, [hand(0.3), hand(0.7)]);
  const tips = () =>
    r.accepted.map((h) => ({ id: h.id + "-1", x: h.hand[0].x, y: 0.5, z: 0 }));
  s.update(tips(), 300);
  r = gate.update([hand(0.34), hand(0.7)], 360, 0.75);
  assert.equal(s.update(tips(), 360).type, "moving");
  r = gate.update([hand(0.34, 0.07), hand(0.7)], 420, 0.75);
  assert.equal(s.update(tips(), 420).type, "lost");
  assert.equal(s.path.length, 0);
});
test("calibration needs stable samples, changes reference, and rejects invalid settings", () => {
  const gate = new DepthGate();
  assert.throws(() => gate.calibrate(), /кадров/);
  settle(gate, [hand(0.3, 0.12)]);
  assert.ok(Math.abs(gate.calibrate() - 0.12) < 1e-8);
  assert.throws(() => gate.configure({ limit: NaN }));
  assert.throws(() => gate.configure({ reference: 0 }));
});
test("invalid landmarks fail closed, and an old frame cannot retain identities", () => {
  const gate = new DepthGate();
  assert.equal(settle(gate, [hand()]).accepted.length, 1);
  const bad = hand();
  bad[9].x = NaN;
  assert.equal(gate.update([bad], 360, 0.75).accepted.length, 0);
  assert.equal(gate.update([hand()], 100, 0.75).accepted.length, 0);
});
test("projection and recording input contain only accepted hands, independent of far finger z", () => {
  const gate = new DepthGate(),
    inverse = [1, 0, 0, 0, 1, 0, 0, 0, 1],
    far = hand(0.7, 0.07);
  far.forEach((p) => (p.z = -100));
  let r;
  for (let time = 0; time <= 300; time += 60)
    r = projectTrackedHands([hand(0.3), far], time, 0.75, inverse, gate);
  assert.equal(r.tips.length, 5);
  assert.equal(r.hands.length, 1);
  assert.ok(r.tips.every((p) => p.id.startsWith(r.depth.accepted[0].id + "-")));
  const frame = { t: 300, tips: r.tips };
  assert.ok(frame.tips.every((p) => p.x < 0.5 && p.z === 0));
  assert.throws(() => gate.calibrate(1000), /свежих/);
});
test("depth fixture stays near/far and exits for every available threshold", () => {
  for (const limit of [0.8, 1.35, 2.5]) {
    const gate = new DepthGate();
    gate.configure({ limit });
    let r;
    for (let t = 0; t <= 300; t += 60)
      r = gate.update(depthDemoHands(t, 0.5625, 0.16, limit), t, 0.5625);
    assert.equal(r.accepted.length, 1);
    assert.equal(r.excluded[0].reason, "far");
    r = gate.update(depthDemoHands(2500, 0.5625, 0.16, limit), 2500, 0.5625);
    assert.equal(r.accepted.length, 0);
    assert.ok(r.excluded.every((h) => h.reason === "far"));
  }
});
