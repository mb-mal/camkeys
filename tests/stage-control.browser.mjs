import { chromium } from "playwright";
import assert from "node:assert/strict";
import { depthDemoHands } from "../src/depth-demo.js";
import { homography, project } from "../src/core.js";
import { displayCorners } from "../src/scene.js";
import { pointStraight } from "./hand-fixture.js";
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.addInitScript(() => {
  localStorage.setItem("camkeys-text", JSON.stringify("сохранить"));
  localStorage.setItem(
    "camkeys-corners",
    JSON.stringify([
      [0.06, 0.38],
      [0.94, 0.38],
      [0.94, 0.9],
      [0.06, 0.9],
    ]),
  );
  localStorage.setItem("camkeys-calibrated", "true");
  navigator.mediaDevices.getUserMedia = async () => {
    const c = document.createElement("canvas");
    c.width = 960;
    c.height = 540;
    setInterval(() => c.getContext("2d").fillRect(0, 0, 960, 540), 40);
    return c.captureStream(25);
  };
});
const base = depthDemoHands(0, 0.5625)[0];
await page.route("**/tracking.worker.js", (r) =>
  r.fulfill({
    contentType: "application/javascript",
    body: `
 const straight=${pointStraight.toString()}, base=${JSON.stringify(base)};
 let point={x:.5,y:.5},lost=false;
 new BroadcastChannel('stage-button').onmessage=({data})=>{if('lost'in data)lost=data.lost;if('x'in data)point=data;};
 onmessage=({data})=>{if(data.type==='init'){postMessage({type:'ready'});return;}
 const hand=base.map(q=>({...q,x:q.x+point.x-.03-base[5].x,y:point.y-.08-(q.y-base[5].y)}));straight(hand,1,{...point,z:-.1});data.bitmap.close();
 setTimeout(()=>postMessage({type:'result',time:data.time,inferenceMs:0,result:{landmarks:lost?[]:[hand.map(q=>({...q,x:1-q.x}))]}}),40);};
`,
  }),
);
const send = (data) =>
  page.evaluate((data) => {
    const c = new BroadcastChannel("stage-button");
    c.postMessage(data);
    c.close();
  }, data);
const lang = () => page.locator("#layout-toggle").getAttribute("data-layout");
try {
  await page.goto("http://127.0.0.1:5173/");
  await page.locator("#camera").click();
  await page.waitForFunction(
    () =>
      document.getElementById("source-badge").textContent === "Живая камера",
  );
  await page.locator("#stage").scrollIntoViewIfNeeded();
  const screenPoint = await page.evaluate(() => {
    const s = document.getElementById("stage").getBoundingClientRect(),
      b = document.getElementById("layout-toggle").getBoundingClientRect();
    return {
      x: (b.x + b.width / 2 - s.x) / s.width,
      y: (b.y + b.height / 2 - s.y) / s.height,
    };
  });
  const unit = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ];
  const keyboardPoint = project(
    homography(displayCorners(), unit),
    screenPoint.x,
    screenPoint.y,
  );
  const point = project(
    homography(unit, [
      [0.06, 0.38],
      [0.94, 0.38],
      [0.94, 0.9],
      [0.06, 0.9],
    ]),
    keyboardPoint.x,
    keyboardPoint.y,
  );
  await send(point);
  await page.waitForFunction(
    () =>
      document.getElementById("layout-toggle").classList.contains("holding"),
    null,
    { timeout: 3000 },
  );
  const started = Date.now();
  await page.waitForTimeout(1300);
  assert.equal(await lang(), "ru");
  await page.waitForFunction(
    () => document.getElementById("layout-toggle").dataset.layout === "en",
    null,
    { timeout: 2500 },
  );
  const elapsed = Date.now() - started;
  assert.ok(elapsed >= 1850 && elapsed < 2600, String(elapsed));
  await page.waitForTimeout(2300);
  assert.equal(await lang(), "en");
  assert.equal(await page.locator("#text").inputValue(), "сохранить");
  assert.equal(await page.locator("#candidates button").count(), 0);
  await send({ lost: true });
  await page.waitForTimeout(600);
  await send({ lost: false });
  await page.waitForTimeout(2200);
  assert.equal(await lang(), "en");
  await send({ x: point.x - 0.15, y: point.y });
  await page.waitForFunction(
    () =>
      !document.getElementById("layout-toggle").classList.contains("holding"),
  );
  await send(point);
  await page.waitForTimeout(800);
  await send({ x: point.x - 0.15, y: point.y });
  await page.waitForTimeout(1700);
  assert.equal(await lang(), "en");
  await send(point);
  await page.waitForFunction(
    () => document.getElementById("layout-toggle").dataset.layout === "ru",
    null,
    { timeout: 3000 },
  );
  assert.equal(await page.locator("#text").inputValue(), "сохранить");
  await page.screenshot({ path: "test-results/layout-camera-hold.png" });
  // Returning to a normal letter must resume the same calibrated input path.
  await send({ x: 0.06 + 0.88 * (1.5 / 13), y: 0.38 + 0.52 / 6 });
  await page.waitForFunction(
    () => document.getElementById("gesture").textContent === "Буквы: Й",
    null,
    { timeout: 3000 },
  );
  assert.equal(await page.locator("#text").inputValue(), "сохранить");
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify(
      {
        firstHoldMs: elapsed,
        checks: [
          "2s camera hold",
          "no repeated switch during long hold or tracking dropout",
          "short pass ignored",
          "exit and reentry rearms",
          "control motion produces no letters, flicks or insertion",
          "existing text preserved",
          "normal letter dwell resumes after leaving the layout key",
        ],
        errors,
      },
      null,
      2,
    ),
  );
} finally {
  await page.close();
  await browser.close();
}
