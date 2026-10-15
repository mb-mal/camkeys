import test from "node:test";
import assert from "node:assert/strict";
import { sceneProject, sceneTip } from "../src/scene.js";
import {
  VIEW_ANGLE_DEG,
  sceneCameraCoordinates,
  displayCorners,
} from "../src/scene.js";
import { DepthGate } from "../src/depth.js";
import { depthDemoHands } from "../src/depth-demo.js";

test("keyboard leaves at least twenty percent of the frame below for the palm", () => {
  assert.ok(Math.max(...displayCorners().map((p) => p[1])) <= 0.8);
});

test("far edge of keyboard is upper and narrower; near edge is lower and wider", () => {
  const far = sceneProject(0.1, 0, 1, 600, 220),
    near = sceneProject(0.1, 1, 1, 600, 220);
  assert.ok(far.depth > near.depth);
  assert.ok(far.y < near.y);
  assert.ok(Math.abs(far.x - 300) < Math.abs(near.x - 300));
});
test("display plane is explicitly rotated 45 degrees", () => {
  const a = sceneCameraCoordinates(0.5, 0),
    b = sceneCameraCoordinates(0.5, 1);
  assert.equal(VIEW_ANGLE_DEG, 45);
  assert.ok(
    Math.abs(
      (Math.atan2(Math.abs(b.z - a.z), Math.abs(b.y - a.y)) * 180) / Math.PI -
        45,
    ) < 1e-10,
  );
});
test("greater distance goes toward the vanishing point and shrinks, independently of flexion z", () => {
  const near = sceneTip(
    { x: 0.2, y: 0.5, z: -2, distanceRatio: 0.8 },
    600,
    220,
  );
  const far = sceneTip({ x: 0.2, y: 0.5, z: 2, distanceRatio: 1.4 }, 600, 220);
  assert.ok(near.y > far.y);
  assert.ok(near.radius > far.radius);
  assert.ok(Math.abs(near.x - 300) > Math.abs(far.x - 300));
  assert.deepEqual(
    sceneTip({ x: 0.2, y: 0.5, z: -2, distanceRatio: 1 }, 600, 220),
    sceneTip({ x: 0.2, y: 0.5, z: 2, distanceRatio: 1 }, 600, 220),
  );
  assert.throws(() => sceneProject(0.5, 0.5, 0, 600, 220));
});
test("larger palm is closer, calibration is 1x, smaller palm is farther and excluded", () => {
  const gate = new DepthGate();
  let r;
  for (let t = 0; t <= 600; t += 60)
    r = gate.update([depthDemoHands(0, 0.5625, 0.2)[0]], t, 0.5625);
  assert.ok(r.accepted[0].ratio < 1);
  gate.calibrate();
  for (let t = 660; t <= 1200; t += 60)
    r = gate.update([depthDemoHands(0, 0.5625, 0.2)[0]], t, 0.5625);
  assert.ok(Math.abs(r.accepted[0].ratio - 1) < 1e-8);
  const reference = sceneTip(
    { x: 0.2, y: 0.5, distanceRatio: r.accepted[0].ratio },
    600,
    220,
  );
  for (let t = 1260; t <= 1800; t += 60)
    r = gate.update([depthDemoHands(0, 0.5625, 0.1)[0]], t, 0.5625);
  assert.equal(r.accepted.length, 0);
  assert.ok(r.excluded[0].ratio > 1.35);
  const far = sceneTip(
    { x: 0.2, y: 0.5, distanceRatio: r.excluded[0].ratio },
    600,
    220,
  );
  assert.ok(far.y < reference.y);
  assert.ok(far.radius < reference.radius);
});
