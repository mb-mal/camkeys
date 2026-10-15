import test from "node:test";
import assert from "node:assert/strict";
import { PersonalNetwork } from "../src/network.js";
import { wordPath, resample } from "../src/core.js";
test("network refuses untrained inference and insufficient data", async () => {
  const n = new PersonalNetwork();
  assert.deepEqual(await n.predict(wordPath("hello", "en")), []);
  await assert.rejects(n.train([]), /двух слов/);
});
test("training, holdout, finite inference and weight round trip (artificial fixtures only)", async () => {
  const n = new PersonalNetwork(),
    clips = [];
  for (const word of ["hello", "world"])
    for (let i = 0; i < 4; i++)
      clips.push({
        word,
        lang: "en",
        source: "pointer",
        frames: [],
        path: resample(wordPath(word, "en"), 40).map((p) => ({
          ...p,
          x: p.x + i * 0.001,
        })),
      });
  const result = await n.train(clips, () => {}, 8);
  assert.equal(result.holdoutCount, 2);
  assert.ok(result.parameters < 20000);
  const pred = await n.predict(wordPath("hello", "en"));
  assert.equal(pred.length, 2);
  assert.ok(pred.every((p) => Number.isFinite(p.probability)));
  const saved = await n.serialize(),
    loaded = new PersonalNetwork();
  await loaded.restore(saved);
  const after = await loaded.predict(wordPath("hello", "en"));
  assert.ok(Math.abs(pred[0].probability - after[0].probability) < 1e-6);
  assert.rejects(loaded.restore({ ...saved, labels: ["<script>"] }));
  n.dispose();
  loaded.dispose();
});
