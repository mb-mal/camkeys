import test from "node:test";
import assert from "node:assert/strict";
import {
  StageControl,
  layoutKey,
  layoutKeyOutline,
} from "../src/stage-control.js";
import { Dwell } from "../src/dwell.js";
import { keys, homography, project } from "../src/core.js";
import { displayCorners } from "../src/scene.js";
import { InputSession } from "../src/input-session.js";
const bounds = { x: 0.9, y: 0.9, rx: 0.04, ry: 0.07 };
const tip = (x = 0.9, id = "hand1-1") => ({ id, x, y: 0.9, pointing: true });
test("layout key stays in the calibrated plane and clear of letter hit areas", () => {
  const unit = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ];
  const forward = homography(unit, displayCorners());
  const outline = layoutKeyOutline(forward);
  assert.ok(outline.every((p) => p.x > 0 && p.x < 1 && p.y > 0 && p.y < 0.8));
  const camera = project(
    homography(unit, [
      [0.06, 0.38],
      [0.94, 0.38],
      [0.94, 0.9],
      [0.06, 0.9],
    ]),
    layoutKey.x,
    layoutKey.y,
  );
  assert.ok(
    camera.x < 0.94 && camera.y < 0.9,
    "button is reachable before the physical calibration edge",
  );
  for (const lang of ["ru", "en"])
    assert.ok(
      keys(lang).every(
        (k) =>
          Math.abs(k.x - layoutKey.x) > 0.037 + layoutKey.rx ||
          Math.abs(k.y - layoutKey.y) > 0.125 + layoutKey.ry,
      ),
    );
});
test("the active digit uses the same dwell engine as letter keys and far observations cannot press", () => {
  const c = new StageControl();
  assert.ok(c.dwell instanceof Dwell);
  const p = tip(0.9, "hand1-2");
  for (let time = 0; time < 2000; time += 100)
    assert.equal(
      c.update({ tips: [p], owner: p.id, bounds, time }).fired,
      false,
    );
  assert.equal(
    c.update({ tips: [p], owner: p.id, bounds, time: 2000 }).fired,
    true,
  );
  c.reset();
  for (let time = 0; time < 2500; time += 100)
    assert.equal(
      c.update({ tips: [], observed: [p], owner: p.id, bounds, time }).fired,
      false,
    );
});
test("camera button uses calibrated keyboard coordinates, holds 2 seconds, and rearms only on exit", () => {
  const c = new StageControl();
  const update = (time, p = tip()) => c.update({ tips: [p], bounds, time });
  assert.equal(update(0).fired, false);
  for (let t = 100; t < 2000; t += 100) assert.equal(update(t).fired, false);
  assert.equal(
    update(2000, { ...tip(), cameraX: 0.1, cameraY: 0.2 }).fired,
    true,
  );
  for (let t = 2100; t < 10000; t += 100) assert.equal(update(t).fired, false);
  c.update({ tips: [], bounds, time: 10100 });
  assert.equal(update(10500).fired, false);
  update(10600, tip(0.7));
  update(10700);
  for (let t = 10800; t < 12700; t += 100) update(t);
  assert.equal(update(12700).fired, true);
});
test("brief passes, folded fingers, another hand, and gaps cannot activate the button", () => {
  const c = new StageControl();
  const update = (time, tips, observed = tips) =>
    c.update({ tips, observed, owner: "hand1-1", bounds, time });
  assert.equal(update(0, [tip(0.9, "hand2-1")]).busy, false);
  assert.equal(update(100, [tip(0.9, "hand1-2")]).busy, false);
  assert.equal(update(200, [{ ...tip(), pointing: false }]).busy, false);
  update(300, [tip()]);
  update(1200, [tip()]);
  assert.equal(update(1300, [tip()]).progress, 0);
  update(1400, [], [tip(0.7)]);
  assert.equal(update(1500, [tip()]).progress, 0);
});
test("tracker ID recovery preserves the fired latch and allows rearming after visible exit", () => {
  const c = new StageControl();
  const update = (time, tips) => c.update({ tips, bounds, time });
  for (let t = 0; t <= 2000; t += 100) update(t, [tip()]);
  update(2700, []);
  for (let t = 2800; t <= 5000; t += 100)
    assert.equal(update(t, [tip(0.9, "hand2-1")]).fired, false);
  update(5100, [tip(0.7, "hand2-1")]);
  for (let t = 5200; t < 7200; t += 100) update(t, [tip(0.9, "hand2-1")]);
  assert.equal(update(7200, [tip(0.9, "hand2-1")]).fired, true);
});
test("control pauses insertion and preserves a word; delayed decoder results resume safely", () => {
  const inserted = [];
  const s = new InputSession({ commit: (v) => inserted.push(v) });
  s.layout = "ru";
  s.phase = "ready";
  s.path = [
    { x: 0.2, y: 0.2 },
    { x: 0.8, y: 0.7 },
  ];
  s.results = [{ word: "привет", error: 0.01 }];
  const token = { final: true, session: s.serial, version: s.version };
  s.suspendControl(1000);
  assert.equal(s.commitRecognized(token, true, 1100), false);
  assert.equal(s.tick(5000, true), false);
  assert.equal(s.path.length, 2);
  assert.equal(inserted.length, 0);
  s.resumeControl(5000);
  assert.equal(s.tick(6499, true), false);
  assert.equal(s.tick(6500, true), true);
  assert.equal(inserted.length, 1);
});
