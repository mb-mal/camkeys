import test from "node:test";
import assert from "node:assert/strict";
import { Dwell } from "../src/dwell.js";
test("500/3000 ms use timestamps at variable FPS; noise and ten seconds never repeat", () => {
  for (const duration of [500, 3000])
    for (const dt of [16, 40, 100]) {
      const d = new Dwell(duration),
        events = [];
      for (let t = 0; t <= 10000; t += dt) {
        const e = d.update({
          point: { x: 0.3 + 0.001 * Math.sin(t / 53), y: 0.6 },
          id: "tip",
          key: "й",
          time: t,
        });
        if (e) events.push(t);
      }
      assert.equal(events.length, 1);
      assert.ok(events[0] >= duration && events[0] < duration + dt + 1);
    }
});
test("target change at the same location is blocked; leave/reenter rearms the same letter", () => {
  const d = new Dwell(500),
    step = (x, key, time, eligible = true) =>
      d.update({ point: { x, y: 0.5 }, id: "tip", key, time, eligible });
  for (let t = 0; t <= 500; t += 100) step(0.3, "й", t);
  assert.equal(step(0.3, "ъ", 600), null);
  step(0.4, "й", 700, false);
  for (let t = 800; t < 1300; t += 100) assert.equal(step(0.3, "й", t), null);
  assert.ok(step(0.3, "й", 1300));
});
test("loss, excessive jitter, owner switch and frame gaps start a fresh countdown", () => {
  for (const kind of ["loss", "jitter", "owner", "gap"]) {
    const d = new Dwell(3000),
      p = { x: 0.3, y: 0.5 };
    for (let t = 0; t <= 2500; t += 100)
      d.update({ point: p, id: "a", key: "й", time: t });
    d.update({
      point: kind === "jitter" ? { x: 0.4, y: 0.5 } : p,
      id: kind === "owner" ? "b" : "a",
      key: "й",
      time: kind === "gap" ? 3000 : 2600,
      eligible: kind !== "loss",
    });
    const start = kind === "gap" ? 3100 : 2700;
    for (let t = start; t < start + 2900; t += 100)
      assert.equal(
        d.update({ point: p, id: "a", key: "й", time: t }),
        null,
        kind,
      );
  }
});
