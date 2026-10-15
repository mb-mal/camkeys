import test from "node:test";
import assert from "node:assert/strict";
import { pointingFingers } from "../src/hand-pose.js";
import { TipActivity } from "../src/tip-activity.js";
const hand = () => Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
const set = (h, ids, ps) =>
  ids.forEach(
    (id, i) => (h[id] = { x: 0.5 + ps[i][0], y: 0.5 + ps[i][1], z: ps[i][2] }),
  );
test("extended index towards camera is eligible; curled fingers and fist are not", () => {
  const h = hand();
  const folded = [
    [0, 0, 0],
    [0.02, -0.03, -0.02],
    [0.01, 0.01, -0.02],
    [0, 0.015, 0],
  ];
  for (const ids of [
    [1, 2, 3, 4],
    [5, 6, 7, 8],
    [9, 10, 11, 12],
    [13, 14, 15, 16],
    [17, 18, 19, 20],
  ])
    set(h, ids, folded);
  assert.deepEqual(pointingFingers(h, 1), [false, false, false, false, false]);
  set(
    h,
    [5, 6, 7, 8],
    [
      [0, 0, 0],
      [0.001, -0.003, -0.04],
      [0.002, -0.006, -0.08],
      [0.003, -0.009, -0.12],
    ],
  );
  assert.deepEqual(pointingFingers(h, 1), [false, true, false, false, false]);
  const rotated = h.map((p) => ({ x: p.z + 0.5, y: p.x, z: p.y - 0.5 }));
  assert.equal(pointingFingers(rotated, 1)[1], true);
});
test("all extended digits work, invalid geometry fails closed", () => {
  const h = hand();
  for (const ids of [
    [1, 2, 3, 4],
    [5, 6, 7, 8],
    [9, 10, 11, 12],
    [13, 14, 15, 16],
    [17, 18, 19, 20],
  ])
    set(h, ids, [
      [0, 0, 0],
      [0.03, -0.03, -0.01],
      [0.06, -0.06, -0.02],
      [0.09, -0.09, -0.03],
    ]);
  assert.deepEqual(pointingFingers(h, 0.5625), Array(5).fill(true));
  assert.deepEqual(pointingFingers(hand(), 1), Array(5).fill(false));
  assert.deepEqual(pointingFingers([], 1), Array(5).fill(false));
});

test("straight index aimed down and toward the camera is not rejected for being nearer the wrist", () => {
  const h = hand();
  h[0] = { x: 0.5, y: 0.8, z: 0 };
  h[9] = { x: 0.53, y: 0.65, z: 0 };
  h[17] = { x: 0.56, y: 0.66, z: 0 };
  set(
    h,
    [5, 6, 7, 8],
    [
      [0, 0.15, 0],
      [0, 0.19, -0.02],
      [0, 0.23, -0.04],
      [0, 0.27, -0.06],
    ],
  );
  assert.equal(pointingFingers(h, 0.5625)[1], true);
});
test("an explicitly empty eligibility set never falls back to selecting a fist", () => {
  const a = new TipActivity();
  a.update([{ id: "fist", x: 0.1, y: 0.5, z: 0 }], 0, new Set());
  assert.equal(
    a.update([{ id: "fist", x: 0.6, y: 0.5, z: -0.5 }], 100, new Set()).id,
    null,
  );
});
test("folded movement is discarded before the digit extends; z breaks ties only within one hand", () => {
  const a = new TipActivity();
  a.update(
    [{ id: "hand1-1", x: 0.1, y: 0.5, z: 0, pointing: false }],
    0,
    new Set(),
  );
  a.update(
    [{ id: "hand1-1", x: 0.8, y: 0.5, z: -0.5, pointing: false }],
    100,
    new Set(),
  );
  assert.equal(
    a.update(
      [{ id: "hand1-1", x: 0.9, y: 0.5, z: -0.5, pointing: true }],
      200,
      new Set(["hand1-1"]),
    ).id,
    null,
  );
  const b = new TipActivity();
  const tips = (x) => [
    { id: "hand1-0", x, y: 0.5, z: -0.03, pointing: true },
    { id: "hand1-1", x, y: 0.5, z: -0.1, pointing: true },
  ];
  b.update(tips(0.3), 0);
  assert.equal(b.update(tips(0.5), 100).id, "hand1-1");
});
