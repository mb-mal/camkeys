import fs from "node:fs";
import assert from "node:assert/strict";
import { InputSession } from "../src/input-session.js";
import { DepthGate } from "../src/depth.js";
import { projectTrackedHands } from "../src/hand-input.js";
import { installRussianDictionary } from "../src/russian-dictionary.js";
import { rankToken } from "../src/core.js";
const rows = JSON.parse(
  fs.readFileSync("test-results/live-capabilities.json"),
).rows;
const meta = rows[0],
  gate = new DepthGate(),
  commits = [],
  cancels = [],
  decodes = [];
let time = 0,
  text = [];
gate.configure({ reference: meta.depthReference, limit: meta.depthLimit });
installRussianDictionary(
  fs.readFileSync("public/dictionaries/ru_50k.txt", "utf8"),
);
const input = new InputSession({
  recognize(token) {
    if (!token.final) return;
    const results = rankToken(token);
    decodes.push({ time, session: token.session, top: results.slice(0, 3) });
    if (input.accept(token, results)) input.commitRecognized(token, true);
  },
  commit(candidate) {
    commits.push({ time, word: candidate.word });
    text.push(candidate.word);
  },
  retract(event) {
    cancels.push({ time, ...event });
    if (event.undoRecent) text.pop();
  },
});
for (const r of rows.filter((r) => r.event === "tracker-frame")) {
  time = r.time;
  const result = projectTrackedHands(
    r.hands,
    r.time,
    r.aspect,
    meta.inverse,
    gate,
    false,
  );
  input.step({
    tips: result.tips,
    observed: result.activityTips,
    palms:
      result.commandPalms ||
      result.depth.accepted.map((h) => ({
        id: h.id,
        x: h.hand[0].x,
        y: h.hand[0].y,
      })),
    time: r.time,
    layout: "ru",
    calibrated: true,
  });
  input.tick(time, true);
}
fs.writeFileSync(
  "test-results/capabilities-replay.json",
  JSON.stringify({ commits, cancels, decodes, text }, null, 2),
);
console.log({ commits, cancels, text });
assert.ok(
  commits.some((c) => c.word === "возможности"),
  "retained second word must reach dictionary recognition and insertion",
);
assert.ok(cancels.length, "recorded left flick must reach cancellation");
assert.ok(
  !commits.some((c) => c.word === "ими"),
  "correction movement must not become a word",
);
