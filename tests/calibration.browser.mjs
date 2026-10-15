import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { keys, homography, project } from "../src/core.js";
import { displayCorners } from "../src/scene.js";
import { calibrationLetters } from "../src/calibration.js";
import { pointStraight } from "./hand-fixture.js";
import { depthDemoHands } from "../src/depth-demo.js";
await mkdir("test-results", { recursive: true });
const unit = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ],
  display = homography(unit, displayCorners()),
  physicalCorners = [
    [0.1, 0.28],
    [0.72, 0.31],
    [0.84, 0.9],
    [0.07, 0.86],
  ],
  physical = homography(unit, physicalCorners);
const browser = await chromium.launch({ channel: "msedge", headless: true }),
  context = await browser.newContext({
    viewport: { width: 1440, height: 1100 },
  }),
  page = await context.newPage(),
  errors = [],
  checks = [];
page.setDefaultTimeout(20000);
page.on("pageerror", (e) => errors.push(e.message));
await context.addInitScript(() => {
  if (!sessionStorage.getItem("seeded")) {
    sessionStorage.setItem("seeded", "1");
    localStorage.setItem("camkeys-text", JSON.stringify("не теряется"));
    localStorage.setItem(
      "camkeys-corners",
      JSON.stringify([
        [0.06, 0.38],
        [0.94, 0.38],
        [0.94, 0.9],
        [0.06, 0.9],
      ]),
    );
  }
});
const oldCorners = JSON.stringify([
  [0.06, 0.38],
  [0.94, 0.38],
  [0.94, 0.9],
  [0.06, 0.9],
]);
const saved = () =>
  page.evaluate(() => localStorage.getItem("camkeys-corners"));
const pointerTarget = async (letter, wrong = false, lang = "ru") => {
  await page.locator("#overlay").scrollIntoViewIfNeeded();
  const k = keys(lang).find((k) => k.letter === letter),
    p = wrong ? { x: 0.5, y: 0.6 } : project(display, k.x, k.y),
    b = await page.locator("#overlay").boundingBox();
  await page.mouse.click(b.x + p.x * b.width, b.y + p.y * b.height);
};
try {
  await page.goto("http://127.0.0.1:5173/");
  await page.locator("#calibrate").click();
  for (const letter of calibrationLetters.ru) {
    await pointerTarget(letter);
    await page.waitForTimeout(500);
  }
  assert.match(
    await page.locator("#wizard-feedback").textContent(),
    /Контроль пройден/,
  );
  assert.equal(await saved(), oldCorners);
  checks.push(
    "Pointer completes ten RU presses including repeats; camera geometry untouched",
  );
  await page.locator("#layout-toggle").click();
  await page.locator("#calibrate").click();
  for (const letter of calibrationLetters.en) {
    await pointerTarget(letter, false, "en");
    await page.waitForTimeout(500);
  }
  assert.match(
    await page.locator("#wizard-feedback").textContent(),
    /Контроль пройден/,
  );
  assert.equal(await saved(), oldCorners);
  checks.push("EN letter targets and repeats complete in browser");
  await page.locator("#layout-toggle").click();
  await page.locator("#calibrate").click();
  await pointerTarget("й");
  await page.locator("#wizard-cancel").click();
  assert.equal(await saved(), oldCorners);
  checks.push("Cancel preserves previous calibration");
  await page.locator("#calibrate").click();
  for (let i = 0; i < 4; i++) {
    await pointerTarget(calibrationLetters.ru[i], true);
    await page.waitForTimeout(500);
  }
  assert.match(
    await page.locator("#wizard-feedback").textContent(),
    /Прежняя геометрия сохранена/,
  );
  assert.equal(await saved(), oldCorners);
  await page.locator("#wizard-restart").click();
  for (const letter of calibrationLetters.ru) {
    await pointerTarget(letter);
    await page.waitForTimeout(500);
  }
  assert.match(
    await page.locator("#wizard-feedback").textContent(),
    /Контроль пройден/,
  );
  checks.push("Collapsed geometry rejected; restart completes");
  // Camera sequence uses controlled artificial raw landmarks, never old-calibration hit testing.
  const base = depthDemoHands(0, 0.5625)[0];
  await context.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const c = document.createElement("canvas");
      c.width = 960;
      c.height = 540;
      const ctx = c.getContext("2d");
      ctx.fillRect(0, 0, 960, 540);
      setInterval(() => ctx.fillRect(0, 0, 960, 540), 80);
      return c.captureStream(15);
    };
    window.__rawPoint = null;
    const clear = CanvasRenderingContext2D.prototype.clearRect,
      arc = CanvasRenderingContext2D.prototype.arc;
    CanvasRenderingContext2D.prototype.clearRect = function (...args) {
      if (this.canvas.id === "overlay") window.__rawPoint = null;
      return clear.apply(this, args);
    };
    CanvasRenderingContext2D.prototype.arc = function (x, y, r, ...args) {
      if (this.canvas.id === "overlay" && r === 11)
        window.__rawPoint = { x: x / 960, y: y / 540 };
      return arc.call(this, x, y, r, ...args);
    };
  });
  await page.route("**/tracking.worker.js", (r) =>
    r.fulfill({
      contentType: "application/javascript",
      body: `let pose={x:.3,y:.6,flex:0,visible:true,far:false,folded:false,stale:false};const straighten=${pointStraight.toString()};const channel=new BroadcastChannel('calibration-fixture');channel.onmessage=({data})=>Object.assign(pose,data);self.onmessage=({data})=>{if(data.type==='init'){self.postMessage({type:'ready'});return;}const base=${JSON.stringify(base)},dx=pose.x-.03-base[5].x,dy=pose.y+.02-base[5].y;const hand=base.map(p=>({...p,x:p.x+dx,y:p.y+dy}));straighten(hand,1,{x:pose.x,y:pose.y,z:-.1+pose.flex*.11313708499});if(pose.folded){const a=hand[5];hand[6]={x:a.x,y:a.y-.04,z:-.02};hand[7]={x:a.x+.01,y:a.y-.005,z:-.03};hand[8]={x:a.x,y:a.y+.035,z:-.005};}if(pose.far){const wrist={...hand[0]};for(let i=1;i<hand.length;i++){hand[i].x=wrist.x+(hand[i].x-wrist.x)*.45;hand[i].y=wrist.y+(hand[i].y-wrist.y)*.45;}}const landmarks=pose.visible?[hand.map(p=>({...p,x:1-p.x}))]:[];data.bitmap.close();self.postMessage({type:'result',time:pose.stale?data.time-1000:data.time,inferenceMs:0,result:{landmarks}});};`,
    }),
  );
  await page.reload();
  await page.locator("#camera").click();
  await page.waitForFunction(
    () =>
      document.getElementById("source-badge").textContent === "Живая камера",
  );
  await page.locator("#calibrate").click();
  const send = (payload) =>
    page.evaluate((p) => {
      const c = new BroadcastChannel("calibration-fixture");
      c.postMessage(p);
      c.close();
    }, payload);
  await send({ visible: false });
  await page.waitForFunction(() =>
    document.getElementById("wizard-instruction").textContent.includes("Пауза"),
  );
  assert.match(await page.locator("#wizard-step").textContent(), /Шаг 1/);
  await send({ visible: true, far: true });
  await page.waitForFunction(() =>
    document.getElementById("depth-status").textContent.includes("далеко: 1"),
  );
  await page.waitForFunction(
    () => !document.getElementById("camera-confirm").disabled,
  );
  assert.match(await page.locator("#wizard-step").textContent(), /Шаг 1/);
  checks.push(
    "Old depth exclusion cannot block calibration raw positions; it still blocks normal input",
  );
  await send({ far: false, folded: true });
  await page.waitForFunction(
    () =>
      document.getElementById("camera-confirm").disabled &&
      document
        .getElementById("camera-readiness")
        .textContent.includes("Вытяните"),
  );
  await send({ folded: false });
  await page.waitForFunction(
    () => !document.getElementById("camera-confirm").disabled,
  );
  await send({ stale: true });
  await page.waitForFunction(
    () =>
      document.getElementById("camera-confirm").disabled &&
      document
        .getElementById("camera-readiness")
        .textContent.includes("устарел"),
  );
  assert.match(await page.locator("#wizard-step").textContent(), /Шаг 1/);
  await send({ stale: false });
  const firstKey = keys("ru").find((k) => k.letter === "й"),
    firstPosition = project(physical, firstKey.x, firstKey.y);
  for (let i = 1; i <= 6; i++) {
    await send({
      x: 0.3 + ((firstPosition.x - 0.3) * i) / 6,
      y: 0.6 + ((firstPosition.y - 0.6) * i) / 6,
      flex: 0,
    });
    await page.waitForTimeout(90);
  }
  assert.match(await page.locator("#wizard-step").textContent(), /Шаг 1/);
  for (let i = 0; i < calibrationLetters.ru.length; i++) {
    const letter = calibrationLetters.ru[i],
      k = keys("ru").find((k) => k.letter === letter),
      p = project(physical, k.x, k.y);
    await send({ ...p, flex: 0 });
    await page.waitForTimeout(550);
    await page.waitForFunction((p) => {
      const q = window.__rawPoint;
      return (
        !document.getElementById("wizard-confirm").disabled &&
        q &&
        Math.hypot(q.x - p.x, q.y - p.y) < 0.003
      );
    }, p);
    if (i === 0) {
      assert.match(
        await page.locator("#camera-confirm").textContent(),
        /Подтвердить Й → Ъ/,
      );
      assert.match(
        await page.locator("#camera-readiness").textContent(),
        /Позиция стабильна/,
      );
      assert.match(await page.locator("#wizard-step").textContent(), /Шаг 1/);
      await page.screenshot({
        path: "test-results/calibration-ready.png",
        fullPage: true,
      });
      const stage = await page.locator("#stage").boundingBox(),
        button = await page.locator("#camera-confirm").boundingBox();
      assert.ok(
        button.x >= stage.x &&
          button.y >= stage.y &&
          button.x + button.width <= stage.x + stage.width &&
          button.y + button.height <= stage.y + stage.height,
      );
      await page.setViewportSize({ width: 320, height: 900 });
      const narrowStage = await page.locator("#stage").boundingBox(),
        narrowButton = await page.locator("#camera-confirm").boundingBox();
      assert.ok(
        narrowButton.x >= narrowStage.x &&
          narrowButton.y >= narrowStage.y &&
          narrowButton.x + narrowButton.width <=
            narrowStage.x + narrowStage.width &&
          narrowButton.y + narrowButton.height <=
            narrowStage.y + narrowStage.height,
        "confirmation stays inside video at 320px",
      );
      await page.setViewportSize({ width: 1440, height: 1100 });
    }
    await page.locator("#camera-confirm").click();
    await page.waitForFunction(
      ({ step, total }) =>
        document
          .getElementById("wizard-step")
          .textContent.startsWith(
            step === total ? "Проверка завершена" : `Шаг ${step + 1} /`,
          ),
      { step: i + 1, total: calibrationLetters.ru.length },
    );
    if (i === 0) {
      await page.locator("#wizard-back").click();
      assert.match(await page.locator("#wizard-step").textContent(), /Шаг 1/);
      await page.waitForFunction(
        () => !document.getElementById("camera-confirm").disabled,
      );
      await page.locator("#camera-confirm").click();
      await page.waitForFunction(() =>
        document.getElementById("wizard-step").textContent.startsWith("Шаг 2"),
      );
      checks.push(
        "First Й advances to Ъ without z flexion; repeat returns to Й and can reconfirm",
      );
    }
    if (i < calibrationLetters.ru.length - 1)
      assert.equal(await saved(), oldCorners);
  }
  const newCorners = JSON.parse(await saved());
  assert.ok(
    newCorners.every(
      (p, i) =>
        Math.hypot(p[0] - physicalCorners[i][0], p[1] - physicalCorners[i][1]) <
        0.02,
    ),
  );
  assert.equal(await page.locator("#text").inputValue(), "не теряется");
  checks.push(
    "Camera completes all ten positions with zero z flexion; lost/folded/stale observations disable confirmation; only final validated geometry commits",
  );
  await page.screenshot({
    path: "test-results/calibration.png",
    fullPage: true,
  });
  await page.locator("#calibrate").click();
  await page.locator("#stop").click();
  assert.equal(await page.locator("#wizard").isVisible(), false);
  const stored = await saved();
  await page.locator("#camera").click();
  await page.waitForFunction(
    () =>
      document.getElementById("source-badge").textContent === "Живая камера",
  );
  assert.equal(await page.locator("#wizard").isVisible(), false);
  assert.equal(await saved(), stored);
  await page.locator("#stop").click();
  checks.push(
    "Stop/restart cancels unfinished wizard and preserves committed calibration",
  );
  assert.deepEqual(errors, []);
  const report = {
    checks,
    errors,
    scope:
      "Mouse and artificial video/landmarks, with a straight index and no flexion; human camera presses NOT verified",
  };
  await writeFile(
    "test-results/calibration-report.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} catch (e) {
  await page.screenshot({
    path: "test-results/calibration-failure.png",
    fullPage: true,
  });
  await writeFile(
    "test-results/calibration-failure.json",
    JSON.stringify(
      {
        error: e.message,
        errors,
        step: await page.locator("#wizard-step").textContent(),
        feedback: await page.locator("#wizard-feedback").textContent(),
        instruction: await page.locator("#wizard-instruction").textContent(),
        point: await page.evaluate(() => window.__rawPoint),
      },
      null,
      2,
    ),
  );
  throw e;
} finally {
  await browser.close();
}
