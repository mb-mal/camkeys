import { depthDemoHands } from "../src/depth-demo.js";
export function pointStraight(hand, f, target) {
  const base = 1 + f * 4,
    a = hand[base];
  for (let j = 1; j <= 3; j++) {
    const t = j / 3;
    hand[base + j] = {
      x: a.x + (target.x - a.x) * t,
      y: a.y + (target.y - a.y) * t,
      z: a.z + (target.z - a.z) * t,
    };
  }
  return hand;
}
export function fistHand(x = 0.3, scale = 0.16) {
  const h = depthDemoHands(0, 0.5625, scale)[0].map((p) => ({
    ...p,
    x: p.x + x - 0.3,
  }));
  for (const f of [1, 2, 3, 4]) {
    const b = 1 + 4 * f,
      a = h[b],
      s = scale / 0.16;
    h[b + 1] = { x: a.x, y: a.y - 0.04 * s, z: -0.02 * s };
    h[b + 2] = { x: a.x + 0.01 * s, y: a.y - 0.005 * s, z: -0.03 * s };
    h[b + 3] = { x: a.x, y: a.y + 0.035 * s, z: -0.005 * s };
  }
  h[1] = { x: x - 0.065, y: 0.7, z: 0 };
  h[2] = { x: x - 0.08, y: 0.63, z: -0.01 };
  h[3] = { x: x - 0.025, y: 0.62, z: -0.02 };
  h[4] = { x: x + 0.005, y: 0.64, z: -0.01 };
  return h;
}
