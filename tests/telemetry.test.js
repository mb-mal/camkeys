import test from "node:test";
import assert from "node:assert/strict";
import { Telemetry } from "../src/telemetry.js";
test("telemetry is opt in, snapshots mutable state, and stops at its cap without overwriting", () => {
  const trace = new Telemetry(3);
  trace.record("ignored");
  assert.equal(trace.rows.length, 0);
  trace.start();
  const p = { x: 0.2 };
  trace.record("frame", { p });
  p.x = 0.9;
  trace.record("frame", { p });
  trace.record("overflow");
  assert.equal(trace.active, false);
  assert.equal(trace.rows.length, 3);
  assert.equal(JSON.parse(trace.json()).rows[1].p.x, 0.2);
});
