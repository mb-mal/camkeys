import fs from "node:fs";
import assert from "node:assert/strict";
import { InputSession } from "../src/input-session.js";
import { projectTrackedHands } from "../src/hand-input.js";
import { DepthGate } from "../src/depth.js";
import { rankToken } from "../src/core.js";
import { installRussianDictionary } from "../src/russian-dictionary.js";
const rows = JSON.parse(
  fs.readFileSync("test-results/live-new-words.json"),
).rows;
const meta = rows[0],
  gate = new DepthGate(),
  commits = [],
  decodes = [];
gate.configure({ reference: meta.depthReference, limit: meta.depthLimit });
const count = installRussianDictionary(
  fs.readFileSync("public/dictionaries/ru_50k.txt", "utf8"),
);
const input = new InputSession({
  recognize(token) {
    if (!token.final) return;
    const results = rankToken(token);
    const accepted = input.accept(token, results);
    decodes.push({
      time: input.lastTime,
      session: token.session,
      complete: token.complete,
      top: results.slice(0, 3),
    });
    if (accepted) input.commitRecognized?.(token, true);
  },
  commit(candidate) {
    commits.push({ word: candidate.word, time: input.lastTime });
  },
});
for (const r of rows.filter((r) => r.event === "tracker-frame")) {
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
    palms: result.depth.accepted.map((h) => ({
      id: h.id,
      x: h.hand[0].x,
      y: h.hand[0].y,
    })),
    time: r.time,
    layout: "ru",
    calibrated: true,
  });
  input.tick(r.time, true);
}
input.step({
  tips: [],
  observed: [],
  time: input.lastTime + 500,
  layout: "ru",
  calibrated: true,
});
input.tick(input.lastTime + 1500, true);
fs.writeFileSync(
  "test-results/live-new-words-replay.json",
  JSON.stringify({ count, commits, decodes }, null, 2),
);
console.log(JSON.stringify({ count, commits, decodes }, null, 2));
assert.deepEqual(
  commits.map((c) => c.word),
  ["привет", "воображение"],
);
