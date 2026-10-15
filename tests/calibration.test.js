import test from "node:test";
import assert from "node:assert/strict";
import {
  CalibrationWizard,
  CalibrationPressDetector,
} from "../src/calibration.js";
import { homography, project } from "../src/core.js";
import { projectTrackedHands } from "../src/hand-input.js";
import { DepthGate } from "../src/depth.js";
import { depthDemoHands } from "../src/depth-demo.js";
import { displayCorners } from "../src/scene.js";
const unit = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ],
  corners = [
    [0.12, 0.35],
    [0.86, 0.39],
    [0.91, 0.9],
    [0.08, 0.86],
  ],
  h = homography(unit, corners);
test("RU and EN letter sequences fit and independently validate a camera mapping", () => {
  for (const lang of ["ru", "en"]) {
    const wizard = new CalibrationWizard(lang);
    while (wizard.active) {
      const target = wizard.target;
      wizard.capture(project(h, target.x, target.y), wizard.step * 600);
    }
    assert.equal(wizard.phase, "done");
    assert.ok(wizard.result.maxError < 1e-8);
    const p = project(wizard.result.inverse, ...corners[0]);
    assert.ok(Math.hypot(p.x, p.y) < 1e-8);
  }
});
test("collapsed presses and wrong control points cannot commit; a consistent mirrored mapping is valid", () => {
  const collapsed = new CalibrationWizard("ru");
  for (let i = 0; i < 4; i++) collapsed.capture({ x: 0.5, y: 0.5 }, i * 600);
  assert.equal(collapsed.phase, "failed");
  assert.equal(collapsed.result, null);
  const wrong = new CalibrationWizard("en");
  for (let i = 0; i < wrong.targets.length; i++) {
    const p = project(h, wrong.target.x, wrong.target.y);
    wrong.capture(
      i === wrong.targets.length - 1 ? { x: p.x + 0.12, y: p.y } : p,
      i * 600,
    );
  }
  assert.equal(wrong.phase, "failed");
  assert.equal(wrong.result, null);
  const flipped = new CalibrationWizard("en");
  for (let i = 0; i < flipped.targets.length; i++) {
    const p = project(h, flipped.target.x, flipped.target.y);
    flipped.capture({ x: 1 - p.x, y: p.y }, i * 600);
  }
  assert.equal(flipped.phase, "done");
});
test("actual 45 degree rendered centers fit both languages; duplicate anchors recover from Й/Q and controls retry the identified letter", () => {
  const screen = homography(unit, displayCorners());
  for (const lang of ["ru", "en"]) {
    const w = new CalibrationWizard(lang);
    for (let i = 0; i < 4; i++)
      w.capture(project(screen, w.targets[0].x, w.targets[0].y), i * 600);
    assert.equal(w.phase, "failed");
    assert.equal(w.retryIndex, 0);
    w.back();
    assert.equal(w.step, 0);
    while (w.active)
      w.capture(project(screen, w.target.x, w.target.y), 3000 + w.step * 600);
    assert.equal(w.phase, "done");
    assert.ok(w.result.maxError < 1e-8);
    const wrong = new CalibrationWizard(lang);
    for (let i = 0; i < wrong.targets.length; i++) {
      const target = project(screen, wrong.target.x, wrong.target.y);
      wrong.capture(
        i === 5 ? { ...target, x: target.x + 0.04 } : target,
        i * 600,
      );
    }
    assert.equal(wrong.retryIndex, 5);
    wrong.back();
    assert.equal(wrong.step, 5);
    while (wrong.active)
      wrong.capture(
        project(screen, wrong.target.x, wrong.target.y),
        7000 + wrong.step * 600,
      );
    assert.equal(wrong.phase, "done");
  }
});
test("moving eligible index wins calibration over a nearer stationary second hand", () => {
  const d = new CalibrationPressDetector();
  for (let i = 0; i < 25; i++)
    d.update(
      [
        {
          id: "hand2-1",
          x: 0.1,
          y: 0.3,
          z: -0.1,
          pointing: true,
          distanceRatio: 0.7,
        },
        {
          id: "hand1-1",
          x: 0.3 + i * 0.008,
          y: 0.6,
          z: -0.05,
          pointing: true,
          distanceRatio: 1,
        },
      ],
      i * 40,
      0.07,
    );
  for (let i = 25; i < 40; i++)
    d.update(
      [
        {
          id: "hand2-1",
          x: 0.1,
          y: 0.3,
          z: -0.1,
          pointing: true,
          distanceRatio: 0.7,
        },
        {
          id: "hand1-1",
          x: 0.492,
          y: 0.6,
          z: -0.05,
          pointing: true,
          distanceRatio: 1,
        },
      ],
      i * 40,
      0.07,
    );
  assert.equal(d.candidate.id, "hand1-1");
});
test("a small resolvable perspective plane is valid while crossed anchor order is rejected", () => {
  const compact = homography(unit, [
    [0.3, 0.6],
    [0.366, 0.6],
    [0.374, 0.67],
    [0.292, 0.67],
  ]);
  const w = new CalibrationWizard("ru");
  while (w.active)
    w.capture(project(compact, w.target.x, w.target.y), w.step * 600);
  assert.equal(w.phase, "done");
  const crossed = new CalibrationWizard("ru"),
    points = crossed.targets.slice(0, 4).map((p) => project(h, p.x, p.y));
  for (const [i, p] of [points[1], points[0], points[2], points[3]].entries())
    crossed.capture(p, i * 600);
  assert.equal(crossed.phase, "failed");
  assert.match(crossed.error, /Порядок/);
});
test("debounce, undo, pause and cancellation leave safe state", () => {
  const w = new CalibrationWizard("ru"),
    p = project(h, w.target.x, w.target.y);
  w.capture(p, 0);
  w.capture(p, 100);
  assert.equal(w.step, 1);
  w.pause("lost");
  assert.equal(w.active, true);
  assert.throws(() => w.capture(p, 600), /пауз/);
  w.resume();
  w.back();
  assert.equal(w.step, 0);
  w.cancel();
  assert.equal(w.active, false);
  assert.equal(w.result, null);
});
test("camera presses require stable raw positions; confirmation uses a real stable sample", () => {
  const detector = new CalibrationPressDetector(),
    tip = { id: "hand1-1", x: 0.3, y: 0.6, z: 0, pointing: true };
  for (let t = 0; t <= 300; t += 100) detector.update([tip], t, 0.07);
  assert.deepEqual(detector.candidate.point, { x: 0.3, y: 0.6 });
  assert.equal(detector.update([{ ...tip, z: -0.13 }], 400, 0.07).press, null);
  const event = detector.update([tip], 500, 0.07);
  assert.deepEqual(event.press, { x: 0.3, y: 0.6 });
  detector.update([], 600, 0.07);
  assert.equal(detector.candidate, null);
  detector.update([{ ...tip, x: 0.8 }], 700, 0.07);
  assert.equal(detector.candidate, null);
});
test("steady approach without flexion enables confirmation at high and low frame rates; folded/lost tips disable it", () => {
  for (const dt of [8, 16, 33, 100]) {
    const d = new CalibrationPressDetector();
    const p = { id: "hand1-1", x: 0.3, y: 0.6, z: 0, pointing: true };
    for (let t = 0; t < 300; t += dt)
      d.update([{ ...p, x: 0.1 + t / 1500 }], t, 0.07);
    for (let t = 300; t < 650; t += dt)
      assert.equal(d.update([p], t, 0.07).press, null);
    assert.ok(d.candidate, `stable at ${dt} ms without z press`);
    d.update([{ ...p, pointing: false }], 700, 0.07);
    assert.equal(d.candidate, null);
    assert.equal(d.readiness, "folded");
    d.update([], 750, 0.07);
    assert.equal(d.readiness, "lost");
  }
});
test("calibration collects raw camera positions without a previous inverse or key hit-test", () => {
  const gate = new DepthGate();
  let result;
  for (let t = 0; t <= 300; t += 60)
    result = projectTrackedHands(
      depthDemoHands(0, 0.5625),
      t,
      0.5625,
      null,
      gate,
      true,
    );
  assert.equal(result.tips.length, 0);
  assert.equal(result.rawTips.length, 5);
  assert.ok(
    result.rawTips.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)),
  );
  const farGate = new DepthGate();
  farGate.configure({ reference: 0.4, limit: 1.35 });
  for (let t = 0; t <= 300; t += 60)
    result = projectTrackedHands(
      depthDemoHands(0, 0.5625),
      t,
      0.5625,
      null,
      farGate,
      true,
    );
  assert.equal(result.rawTips.length, 0);
  assert.equal(result.calibrationTips.length, 10);
});
