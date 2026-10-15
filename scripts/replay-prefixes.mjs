import fs from "node:fs";
import assert from "node:assert/strict";
import { InputSession } from "../src/input-session.js";
import { projectTrackedHands } from "../src/hand-input.js";
import { DepthGate } from "../src/depth.js";
import { rankToken, vocabulary } from "../src/core.js";
import { installRussianDictionary } from "../src/russian-dictionary.js";
import { PrefixDecoder, PrefixConsensus } from "../src/prefix-decoder.js";
const rows = JSON.parse(
  fs.readFileSync("test-results/live-new-words.json"),
).rows;
const meta = rows[0],
  gate = new DepthGate(),
  output = [],
  commits = [];
gate.configure({ reference: meta.depthReference, limit: meta.depthLimit });
installRussianDictionary(
  fs.readFileSync("public/dictionaries/ru_50k.txt", "utf8"),
);
const decoder = new PrefixDecoder(vocabulary.ru, "ru"),
  consensus = new PrefixConsensus();
let session = null,
  last = -Infinity;
const input = new InputSession({
  recognize(token) {
    if (!token.final) return;
    const results = rankToken(token);
    if (input.accept(token, results)) input.commitRecognized(token, true);
  },
  commit(candidate) {
    commits.push(candidate.word);
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
  if (
    input.entryMode !== "swipe" ||
    !input.samples.length ||
    r.time - last < 120
  )
    continue;
  last = r.time;
  if (session !== input.serial) {
    session = input.serial;
    consensus.reset();
  }
  const start = performance.now(),
    preview = decoder.predict(input.samples, { requireStartHold: true });
  const text = consensus.update(preview, r.time);
  output.push({
    session,
    time: r.time,
    text,
    preview,
    ms: performance.now() - start,
  });
}
const sequences = [...new Set(output.map((r) => r.session))].map((session) => {
  let last = "";
  return output
    .filter(
      (r) =>
        r.session === session && r.text && r.text !== last && (last = r.text),
    )
    .map((r) => r.text);
});
fs.writeFileSync(
  "test-results/prefix-replay.json",
  JSON.stringify({ commits, sequences, output }, null, 2),
);
console.log({
  commits,
  sequences,
  maxMs: Math.max(...output.map((r) => r.ms)),
});
assert.deepEqual(commits, ["привет", "воображение"]);
for (const [i, word] of ["привет", "воображение"].entries()) {
  assert.ok(
    sequences[i].length >= 3,
    "preview must grow before the completed word",
  );
  assert.ok(
    sequences[i].every((text) => word.startsWith(text)),
    "no transit or unrelated letters in the displayed prefix",
  );
  assert.ok(
    sequences[i].every((text, j) => !j || text.startsWith(sequences[i][j - 1])),
    "ambiguous samples must not shrink the prefix",
  );
}
