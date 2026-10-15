import test from "node:test";
import assert from "node:assert/strict";
import { CalibrationController } from "../src/calibration-ui.js";
import { homography, project } from "../src/core.js";
import { displayCorners } from "../src/scene.js";
import { DepthGate } from "../src/depth.js";
import { projectTrackedHands } from "../src/hand-input.js";

test("camera calibration advances after two seconds even at 7 FPS without a short-window candidate", () => {
  const elements = new Map();
  const previous = globalThis.document;
  globalThis.document = {
    getElementById(id) {
      if (!elements.has(id))
        elements.set(id, {
          value: 0.07,
          width: 960,
          height: 540,
          classList: { toggle() {} },
        });
      return elements.get(id);
    },
  };
  const unit = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ];
  const corners = displayCorners();
  const state = {
    source: "camera",
    lang: "ru",
    forward: homography(unit, corners),
    displayInverse: homography(corners, unit),
  };
  const controller = new CalibrationController({
    state,
    resetInput() {},
    apply() {
      return true;
    },
    status() {},
    draw() {},
  });
  try {
    controller.start();
    const target = controller.wizard.target;
    const point = project(state.forward, target.x, target.y);
    const start = performance.now();
    for (let elapsed = 0; elapsed <= 2002; elapsed += 143) {
      controller.update(
        [{ ...point, z: -0.1, id: "hand1-1", pointing: true }],
        start + elapsed,
      );
    }
    assert.equal(
      controller.wizard.step,
      1,
      "visible held finger must advance the wizard",
    );
    for (let elapsed = 2145; elapsed <= 10000; elapsed += 143) {
      controller.update(
        [{ ...point, z: -0.1, id: "hand1-1", pointing: true }],
        start + elapsed,
      );
    }
    assert.equal(
      controller.wizard.step,
      1,
      "same point must not capture the next target",
    );
    const second = controller.wizard.target;
    controller.capture(
      project(state.forward, second.x, second.y),
      start + 10100,
    );
    assert.equal(controller.wizard.target.letter, "ю");
    const third = controller.wizard.target;
    const targetPoint = project(state.forward, third.x, third.y);
    // A straight index aimed down/toward the camera, its tip nearer the
    // wrist than the knuckle. Also force an excluded depth to ensure the
    // ordinary typing gate cannot block calibration at Ю.
    const hand = Array.from({ length: 21 }, () => ({
      x: targetPoint.x + 0.03,
      y: targetPoint.y - 0.12,
      z: 0,
    }));
    hand[0] = { x: targetPoint.x, y: targetPoint.y + 0.03, z: 0 };
    hand[17].x = targetPoint.x + 0.06;
    for (let j = 0; j < 4; j++)
      hand[5 + j] = {
        x: targetPoint.x,
        y: targetPoint.y - 0.12 + j * 0.04,
        z: -j * 0.02,
      };
    const gate = new DepthGate();
    gate.configure({ reference: 0.8 });
    for (let elapsed = 10200; elapsed <= 12400; elapsed += 100) {
      const result = projectTrackedHands(
        hand.length ? [hand] : [],
        start + elapsed,
        0.5625,
        state.displayInverse,
        gate,
        true,
      );
      assert.equal(result.depth.excluded[0].reason, "far");
      controller.update(result.calibrationTips, start + elapsed);
    }
    assert.equal(
      controller.wizard.step,
      3,
      "Ю advances despite camera-facing pose and far palm estimate",
    );
  } finally {
    controller.cancel();
    globalThis.document = previous;
  }
});
