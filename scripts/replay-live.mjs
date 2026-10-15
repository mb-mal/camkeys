import fs from "node:fs";
import assert from "node:assert/strict";
import { InputSession } from "../src/input-session.js";
import { rankToken, homography, keys } from "../src/core.js";
import { installRussianDictionary } from "../src/russian-dictionary.js";
import { projectTrackedHands } from "../src/hand-input.js";
import { DepthGate } from "../src/depth.js";
const rows = JSON.parse(
  fs.readFileSync("test-results/live-proizvedenie.json"),
).rows;
const count = installRussianDictionary(
  fs.readFileSync("public/dictionaries/ru_50k.txt", "utf8"),
);
const captures = rows.filter((r) => r.event === "calibration-capture");
const inverse = homography(
  captures.slice(0, 4).map((r) => [r.point.x, r.point.y]),
  captures.slice(0, 4).map((r) => {
    const k = keys("ru").find((k) => k.letter === r.letter.toLowerCase());
    return [k.x, k.y];
  }),
);
const gate = new DepthGate(),
  results = [];
const s = new InputSession({
  recognize(token) {
    if (!token.final) return;
    const begin = performance.now();
    const candidates = rankToken(token);
    s.accept(token, candidates);
    results.push({
      time: s.lastTime,
      session: token.session,
      points: token.path.length,
      path: token.path,
      candidates,
      ms: performance.now() - begin,
    });
  },
});
for (const r of rows.filter((r) => r.event === "tracker-frame")) {
  const projected = projectTrackedHands(
    r.hands,
    r.time,
    r.aspect,
    inverse,
    gate,
    false,
  );
  if (r.time <= captures.at(-1).time) continue;
  s.step({
    tips: projected.tips,
    observed: projected.activityTips,
    time: r.time,
    layout: "ru",
    calibrated: true,
  });
}
s.step({ tips: [], observed: [], time: s.lastTime + 500, layout: "ru" });
fs.writeFileSync(
  "test-results/live-replay.json",
  JSON.stringify({ dictionarySize: count, results }, null, 2),
);
// Expected text is used only for evaluation, never passed to the decoder.
assert.ok(results.length >= 2);
assert.deepEqual(
  results.slice(-2).map((r) => r.candidates[0]?.word),
  ["произведение", "произведение"],
);
console.log(
  JSON.stringify(
    { dictionarySize: count, results: results.map(({ path, ...r }) => r) },
    null,
    2,
  ),
);
